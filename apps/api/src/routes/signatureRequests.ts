import crypto from "node:crypto";
import type { Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const BUCKET = "signature-requests";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldType = "signature" | "initials" | "date";
type SigningMode = "parallel" | "sequential";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FieldInput {
  fieldType: FieldType;
  pageNumber: number;
  rect: Rect;
}

interface SignerInput {
  email: string;
  name?: string;
  orderIndex?: number;
  fields?: FieldInput[];
  // Legacy (pre-multi-field) shape — a single fixed signature spot. Kept
  // working indefinitely: normalizeFields() below synthesizes one
  // 'signature' field from it, so any caller still on the old request
  // shape needs no changes.
  pageNumber?: number;
  rect?: Rect;
}

interface RoleAssignmentInput {
  roleId: string;
  email: string;
  name?: string;
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function getParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function normalizeFields(signer: SignerInput): FieldInput[] | null {
  if (signer.fields && signer.fields.length > 0) return signer.fields;
  if (signer.pageNumber != null && signer.rect) {
    return [{ fieldType: "signature", pageNumber: signer.pageNumber, rect: signer.rect }];
  }
  return null;
}

interface AuthResult {
  ok: boolean;
  status: number;
  error?: string;
  userId?: string;
}

/** Every owner-authenticated endpoint in this file shares this: a valid Supabase session is all that's required — ownership itself is enforced per-row via `owner_id` filters at the query, not here. */
async function requireAuthenticatedUser(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) return { ok: false, status: 401, error: "Missing Authorization header" };
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return { ok: false, status: 401, error: "Invalid or expired session" };
  return { ok: true, status: 200, userId: data.user.id };
}

// ---- Local PDF-baking helpers ----
// Duplicated from packages/core/src/pdf/signature.ts rather than imported:
// that package ships raw TS for Vite to consume directly (its package.json
// `main` points at ./src/index.ts), which this plain tsc-built Express app
// can't resolve the same way. Each helper here mutates an already-loaded
// PDFDocument in place (void return) rather than taking/returning raw
// bytes, since submitSignature below applies many signers' fields to one
// already-open document before a single final doc.save().

/** Bakes a signer's signature or initials image into the document at their assigned spot. Mirrors packages/core's placeSignatureImage. */
async function placeSignatureImage(doc: PDFDocument, pageIndex: number, rect: Rect, imageBytes: Uint8Array): Promise<void> {
  const image = await doc.embedPng(imageBytes);
  const page = doc.getPage(pageIndex);
  const aspect = image.width / image.height;
  const rectAspect = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  if (aspect > rectAspect) drawHeight = rect.width / aspect;
  else drawWidth = rect.height * aspect;
  const x = rect.x + (rect.width - drawWidth) / 2;
  const y = rect.y + (rect.height - drawHeight) / 2;
  page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
}

/** Bakes an auto-filled date field — standard Helvetica (not the cursive signature font), since a date reads as typed/printed, not handwritten. Auto-shrinks to fit, mirroring placeTypedSignature's centered-fit-text logic. */
async function placeDateText(doc: PDFDocument, pageIndex: number, rect: Rect, dateLabel: string): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.getPage(pageIndex);
  let fontSize = rect.height * 0.7;
  while (fontSize > 6 && font.widthOfTextAtSize(dateLabel, fontSize) > rect.width) fontSize -= 1;
  const textWidth = font.widthOfTextAtSize(dateLabel, fontSize);
  const x = rect.x + Math.max(0, (rect.width - textWidth) / 2);
  const y = rect.y + (rect.height - fontSize) / 2;
  page.drawText(dateLabel, { x, y, size: fontSize, font, color: rgb(0.05, 0.05, 0.2) });
}

interface CertificateSignerInfo {
  name: string;
  email: string;
  signedAtIso: string;
  signedIp: string | null;
  orderIndex: number;
}
interface CertificateInfo {
  documentName: string;
  completedAtIso: string;
  signingMode: SigningMode;
  signers: CertificateSignerInfo[];
  integrityHashHex: string;
}

function formatCertDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/** Appends a "Certificate of Completion" page — the audit-trail counterpart to a single signer's stamp, for multi-party requests. Mirrors packages/core's appendCompletionCertificate; same honesty framing baked into the page itself, not left to UI copy. */
async function appendCompletionCertificate(doc: PDFDocument, info: CertificateInfo): Promise<void> {
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lastPage = doc.getPage(doc.getPageCount() - 1);
  const { width, height } = lastPage.getSize();
  const page = doc.addPage([width, height]);

  const margin = 56;
  let cursorY = height - margin;
  const ink = rgb(0.1, 0.1, 0.12);
  const faint = rgb(0.45, 0.45, 0.48);
  const draw = (text: string, font: typeof regular, size: number, color: typeof ink, gapAfter: number) => {
    page.drawText(text, { x: margin, y: cursorY, size, font, color });
    cursorY -= size + gapAfter;
  };

  draw("Certificate of Completion", bold, 20, ink, 10);
  draw(info.documentName, regular, 12, faint, 18);
  draw(`Completed: ${formatCertDate(info.completedAtIso)}`, regular, 10, ink, 4);
  draw(`Signing order: ${info.signingMode === "sequential" ? "Sequential" : "Parallel (any order)"}`, regular, 10, ink, 18);

  const sortedSigners = [...info.signers].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const [i, signer] of sortedSigners.entries()) {
    const prefix = info.signingMode === "sequential" ? `${i + 1}. ` : "";
    draw(`${prefix}${signer.name} <${signer.email}>`, bold, 11, ink, 4);
    draw(`Signed ${formatCertDate(signer.signedAtIso)}${signer.signedIp ? ` from ${signer.signedIp}` : ""}`, regular, 9, faint, 14);
  }

  cursorY -= 8;
  page.drawLine({ start: { x: margin, y: cursorY }, end: { x: width - margin, y: cursorY }, thickness: 0.5, color: rgb(0.55, 0.55, 0.58) });
  cursorY -= 20;

  draw(`Document integrity hash (SHA-256): ${info.integrityHashHex}`, regular, 8, faint, 16);
  draw(
    "This certificate documents visual signing activity recorded by PDFLoom. It is not a certified, PKI-based digital signature.",
    regular,
    8,
    faint,
    0,
  );
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Signature must be a PNG data URL");
  return new Uint8Array(Buffer.from(match[1]!, "base64"));
}

interface SignerRow {
  id: string;
  request_id: string;
  email: string;
  name: string | null;
  access_token: string;
  status: "pending" | "signed" | "declined";
  order_index: number;
  page_number: number | null;
  rect_x: number | null;
  rect_y: number | null;
  rect_width: number | null;
  rect_height: number | null;
  signature_data_url: string | null;
  initials_data_url: string | null;
  signed_at: string | null;
  signed_ip: string | null;
  decline_reason: string | null;
}

interface FieldRow {
  id: string;
  signer_id: string;
  field_type: FieldType;
  page_number: number;
  rect_x: number;
  rect_y: number;
  rect_width: number;
  rect_height: number;
}

/** A signer's fields, falling back to a synthesized single 'signature' field for a pre-migration row that only has the legacy rect_* columns set. */
function resolveSignerFields(signer: SignerRow, fieldRows: FieldRow[]): FieldRow[] {
  const own = fieldRows.filter((f) => f.signer_id === signer.id);
  if (own.length > 0) return own;
  if (signer.page_number != null && signer.rect_x != null && signer.rect_y != null && signer.rect_width != null && signer.rect_height != null) {
    return [
      {
        id: `legacy-${signer.id}`,
        signer_id: signer.id,
        field_type: "signature",
        page_number: signer.page_number,
        rect_x: signer.rect_x,
        rect_y: signer.rect_y,
        rect_width: signer.rect_width,
        rect_height: signer.rect_height,
      },
    ];
  }
  return [];
}

/** Sequential gating: a signer is blocked while any signer with a lower order_index is still 'pending' (a signer who has signed OR declined clears the way for the next one — the request just never reaches 'completed' if anyone declined). Always false in parallel mode. */
function isBlockedBySequentialOrder(allSigners: SignerRow[], signer: SignerRow, signingMode: SigningMode): boolean {
  if (signingMode !== "sequential") return false;
  return allSigners.some((s) => s.order_index < signer.order_index && s.status === "pending");
}

function effectiveRequestStatus(
  requestStatus: "pending" | "completed" | "voided",
  signers: { status: string }[],
): "pending" | "completed" | "voided" | "declined" {
  if (requestStatus === "voided") return "voided";
  if (requestStatus === "completed") return "completed";
  if (signers.some((s) => s.status === "declined")) return "declined";
  return "pending";
}

/**
 * Starts a multi-party signing request: uploads the document (the one
 * intentional exception to this app's "nothing ever leaves your device"
 * design — see SECURITY.md) and creates one unguessable link per signer.
 * No email is sent from here — the owner copies each signUrl and shares it
 * themselves (no outbound-email credential is provisioned for this app yet).
 * Accepts either a from-scratch payload (filename/fileBase64/signers) or a
 * from-template payload (templateId/roleAssignments) — see the two
 * branches below.
 */
export async function createSignatureRequest(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const auth = await requireAuthenticatedUser(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const body = req.body as {
    filename?: string;
    fileBase64?: string;
    signingMode?: unknown;
    signers?: SignerInput[];
    templateId?: string;
    roleAssignments?: RoleAssignmentInput[];
  };
  const signingMode: SigningMode = body.signingMode === "sequential" ? "sequential" : "parallel";

  if (body.templateId) {
    await createFromTemplate(res, supabase, auth.userId!, appUrl, body.templateId, body.roleAssignments ?? [], signingMode);
    return;
  }

  const { filename, fileBase64, signers } = body;
  if (!filename || !fileBase64 || !Array.isArray(signers) || signers.length === 0) {
    res.status(400).json({ error: "filename, fileBase64, and at least one signer are required" });
    return;
  }

  const normalized: { email: string; name?: string; orderIndex: number; fields: FieldInput[] }[] = [];
  for (const [i, s] of signers.entries()) {
    const fields = normalizeFields(s);
    if (!s.email || !fields || fields.length === 0) {
      res.status(400).json({ error: `Signer ${i + 1} needs an email and at least one field to sign` });
      return;
    }
    normalized.push({ email: s.email, name: s.name, orderIndex: s.orderIndex ?? i, fields });
  }

  const requestId = crypto.randomUUID();
  const storagePath = `${requestId}/document.pdf`;
  const fileBytes = Buffer.from(fileBase64, "base64");

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, fileBytes, { contentType: "application/pdf" });
  if (upload.error) {
    res.status(500).json({ error: `Couldn't store the document: ${upload.error.message}` });
    return;
  }

  const insertRequest = await supabase
    .from("signature_requests")
    .insert({ id: requestId, owner_id: auth.userId, original_filename: filename, storage_path: storagePath, signing_mode: signingMode })
    .select()
    .single();
  if (insertRequest.error) {
    res.status(500).json({ error: `Couldn't create the request: ${insertRequest.error.message}` });
    return;
  }

  const signerRows = normalized.map((s) => ({
    request_id: requestId,
    email: s.email,
    name: s.name ?? null,
    access_token: crypto.randomBytes(32).toString("hex"),
    order_index: s.orderIndex,
  }));
  const insertSigners = await supabase.from("signature_request_signers").insert(signerRows).select();
  if (insertSigners.error) {
    res.status(500).json({ error: `Couldn't add signers: ${insertSigners.error.message}` });
    return;
  }

  const fieldRows = insertSigners.data.flatMap((row, i) =>
    normalized[i]!.fields.map((f) => ({
      request_id: requestId,
      signer_id: row.id,
      field_type: f.fieldType,
      page_number: f.pageNumber,
      rect_x: f.rect.x,
      rect_y: f.rect.y,
      rect_width: f.rect.width,
      rect_height: f.rect.height,
    })),
  );
  const insertFields = await supabase.from("signature_request_fields").insert(fieldRows);
  if (insertFields.error) {
    res.status(500).json({ error: `Couldn't place signature fields: ${insertFields.error.message}` });
    return;
  }

  res.status(200).json({
    requestId,
    signingMode,
    signers: insertSigners.data.map((row) => ({ email: row.email, signUrl: `${appUrl}/sign/${row.access_token}` })),
  });
}

async function createFromTemplate(
  res: Response,
  supabase: SupabaseClient,
  ownerId: string,
  appUrl: string,
  templateId: string,
  roleAssignments: RoleAssignmentInput[],
  signingMode: SigningMode,
): Promise<void> {
  if (!UUID_RE.test(templateId)) {
    res.status(400).json({ error: "Invalid template id" });
    return;
  }
  if (roleAssignments.length === 0) {
    res.status(400).json({ error: "roleAssignments is required when sending from a template" });
    return;
  }

  const { data: template, error: templateError } = await supabase
    .from("signature_templates")
    .select("*")
    .eq("id", templateId)
    .eq("owner_id", ownerId)
    .single();
  if (templateError || !template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const { data: roles, error: rolesError } = await supabase
    .from("signature_template_roles")
    .select("*, signature_template_fields(*)")
    .eq("template_id", templateId);
  if (rolesError || !roles || roles.length === 0) {
    res.status(500).json({ error: "Couldn't load the template's roles" });
    return;
  }

  const assignmentByRoleId = new Map(roleAssignments.map((a) => [a.roleId, a]));
  for (const role of roles) {
    if (!assignmentByRoleId.has(role.id)) {
      res.status(400).json({ error: `Missing an email for role "${role.role_label}"` });
      return;
    }
  }

  const requestId = crypto.randomUUID();
  const storagePath = `${requestId}/document.pdf`;
  const copy = await supabase.storage.from(BUCKET).copy(template.storage_path as string, storagePath);
  if (copy.error) {
    res.status(500).json({ error: `Couldn't copy the template's document: ${copy.error.message}` });
    return;
  }

  const insertRequest = await supabase
    .from("signature_requests")
    .insert({
      id: requestId,
      owner_id: ownerId,
      original_filename: template.original_filename as string,
      storage_path: storagePath,
      signing_mode: signingMode,
      template_id: templateId,
    })
    .select()
    .single();
  if (insertRequest.error) {
    res.status(500).json({ error: `Couldn't create the request: ${insertRequest.error.message}` });
    return;
  }

  const signerRows = roles.map((role, i) => {
    const assignment = assignmentByRoleId.get(role.id)!;
    return {
      request_id: requestId,
      email: assignment.email,
      name: assignment.name ?? role.role_label,
      access_token: crypto.randomBytes(32).toString("hex"),
      order_index: role.order_index ?? i,
    };
  });
  const insertSigners = await supabase.from("signature_request_signers").insert(signerRows).select();
  if (insertSigners.error) {
    res.status(500).json({ error: `Couldn't add signers: ${insertSigners.error.message}` });
    return;
  }

  const fieldRows = roles.flatMap((role, i) => {
    const signerId = insertSigners.data[i]!.id;
    const roleFields = (role.signature_template_fields ?? []) as {
      field_type: FieldType;
      page_number: number;
      rect_x: number;
      rect_y: number;
      rect_width: number;
      rect_height: number;
    }[];
    return roleFields.map((f) => ({
      request_id: requestId,
      signer_id: signerId,
      field_type: f.field_type,
      page_number: f.page_number,
      rect_x: f.rect_x,
      rect_y: f.rect_y,
      rect_width: f.rect_width,
      rect_height: f.rect_height,
    }));
  });
  if (fieldRows.length > 0) {
    const insertFields = await supabase.from("signature_request_fields").insert(fieldRows);
    if (insertFields.error) {
      res.status(500).json({ error: `Couldn't place signature fields: ${insertFields.error.message}` });
      return;
    }
  }

  res.status(200).json({
    requestId,
    signingMode,
    signers: insertSigners.data.map((row) => ({ email: row.email, signUrl: `${appUrl}/sign/${row.access_token}` })),
  });
}

/** Public — no account needed. Fetches what a signer's own signing page needs to render. */
export async function getSignerView(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const token = getParam(req, "token");
  const { data: signer, error } = await supabase
    .from("signature_request_signers")
    .select("*, signature_requests(status, original_filename, storage_path, signing_mode)")
    .eq("access_token", token)
    .single();
  if (error || !signer) {
    res.status(404).json({ error: "This signing link isn't valid." });
    return;
  }
  const request = signer.signature_requests as {
    status: "pending" | "completed" | "voided";
    original_filename: string;
    storage_path: string;
    signing_mode: SigningMode;
  };
  if (request.status === "voided") {
    res.status(410).json({ error: "This document is no longer available for signing." });
    return;
  }

  const { data: allSigners } = await supabase
    .from("signature_request_signers")
    .select("*")
    .eq("request_id", signer.request_id);
  const signers = (allSigners ?? []) as SignerRow[];
  const { data: allFields } = await supabase.from("signature_request_fields").select("*").eq("request_id", signer.request_id);
  const fields = resolveSignerFields(signer as SignerRow, (allFields ?? []) as FieldRow[]);

  const blocked = isBlockedBySequentialOrder(signers, signer as SignerRow, request.signing_mode);
  const status: "pending" | "signed" | "declined" | "not_yet_available" =
    signer.status === "declined" ? "declined" : signer.status === "signed" ? "signed" : blocked ? "not_yet_available" : "pending";

  const signedUrl = await supabase.storage.from(BUCKET).createSignedUrl(request.storage_path, 300);
  if (signedUrl.error) {
    res.status(500).json({ error: `Couldn't load the document: ${signedUrl.error.message}` });
    return;
  }

  let completedDocumentUrl: string | null = null;
  if (request.status === "completed") {
    const completed = await supabase.storage.from(BUCKET).createSignedUrl(`${signer.request_id}/signed.pdf`, 300);
    completedDocumentUrl = completed.data?.signedUrl ?? null;
  }

  res.status(200).json({
    signerName: signer.name,
    signerEmail: signer.email,
    status,
    requestStatus: request.status,
    signingMode: request.signing_mode,
    documentUrl: signedUrl.data.signedUrl,
    originalFilename: request.original_filename,
    fields: fields.map((f) => ({
      id: f.id,
      fieldType: f.field_type,
      pageNumber: f.page_number,
      rect: { x: f.rect_x, y: f.rect_y, width: f.rect_width, height: f.rect_height },
    })),
    otherSigners: signers
      .filter((s) => s.id !== signer.id)
      .map((s) => ({ name: s.name, orderIndex: s.order_index, status: s.status })),
    completedDocumentUrl,
  });
}

/** Public — no account needed. Records one signer's signature/initials, and bakes the final PDF (with a completion certificate) once everyone required has finished. */
export async function submitSignature(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const token = getParam(req, "token");
  const { signatureDataUrl, initialsDataUrl } = req.body as { signatureDataUrl?: string; initialsDataUrl?: string };

  const { data: signerData, error } = await supabase
    .from("signature_request_signers")
    .select("*, signature_requests(*)")
    .eq("access_token", token)
    .single();
  if (error || !signerData) {
    res.status(404).json({ error: "This signing link isn't valid." });
    return;
  }
  const signer = signerData as SignerRow;
  const request = signerData.signature_requests as {
    id: string;
    status: "pending" | "completed" | "voided";
    signing_mode: SigningMode;
    storage_path: string;
    original_filename: string;
  };
  if (request.status === "voided") {
    res.status(410).json({ error: "This document is no longer available for signing." });
    return;
  }
  if (signer.status === "signed") {
    res.status(409).json({ error: "This has already been signed." });
    return;
  }
  if (signer.status === "declined") {
    res.status(409).json({ error: "You've already declined to sign this." });
    return;
  }

  const { data: allSignersRaw } = await supabase.from("signature_request_signers").select("*").eq("request_id", signer.request_id);
  const allSigners = (allSignersRaw ?? []) as SignerRow[];
  if (isBlockedBySequentialOrder(allSigners, signer, request.signing_mode)) {
    res.status(403).json({ error: "It isn't your turn to sign yet." });
    return;
  }

  const { data: allFieldsRaw } = await supabase.from("signature_request_fields").select("*").eq("request_id", signer.request_id);
  const myFields = resolveSignerFields(signer, (allFieldsRaw ?? []) as FieldRow[]);
  const needsSignature = myFields.some((f) => f.field_type === "signature");
  const needsInitials = myFields.some((f) => f.field_type === "initials");
  if (needsSignature && !signatureDataUrl) {
    res.status(400).json({ error: "signatureDataUrl is required" });
    return;
  }
  if (needsInitials && !initialsDataUrl) {
    res.status(400).json({ error: "initialsDataUrl is required" });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null;
  const nowIso = new Date().toISOString();
  const update = await supabase
    .from("signature_request_signers")
    .update({
      status: "signed",
      signature_data_url: signatureDataUrl ?? null,
      initials_data_url: initialsDataUrl ?? null,
      signed_at: nowIso,
      signed_ip: clientIp,
    })
    .eq("access_token", token);
  if (update.error) {
    res.status(500).json({ error: `Couldn't record the signature: ${update.error.message}` });
    return;
  }

  const finishedSigners = allSigners.map((s) => (s.id === signer.id ? { ...s, status: "signed" as const, signed_at: nowIso, signed_ip: clientIp } : s));
  const allComplete = finishedSigners.every((s) => s.status === "signed");
  let completedDocumentUrl: string | null = null;

  if (allComplete) {
    const original = await supabase.storage.from(BUCKET).download(request.storage_path);
    if (!original.error) {
      const bytes = new Uint8Array(await original.data.arrayBuffer());
      const doc = await PDFDocument.load(bytes);

      const { data: finalSignersRaw } = await supabase.from("signature_request_signers").select("*").eq("request_id", signer.request_id);
      const finalSigners = (finalSignersRaw ?? []) as SignerRow[];
      const { data: finalFieldsRaw } = await supabase.from("signature_request_fields").select("*").eq("request_id", signer.request_id);
      const finalFields = (finalFieldsRaw ?? []) as FieldRow[];

      for (const s of finalSigners) {
        for (const field of resolveSignerFields(s, finalFields)) {
          const pageIndex = field.page_number - 1;
          const rect = { x: field.rect_x, y: field.rect_y, width: field.rect_width, height: field.rect_height };
          if (field.field_type === "signature" && s.signature_data_url) {
            await placeSignatureImage(doc, pageIndex, rect, dataUrlToBytes(s.signature_data_url));
          } else if (field.field_type === "initials" && s.initials_data_url) {
            await placeSignatureImage(doc, pageIndex, rect, dataUrlToBytes(s.initials_data_url));
          } else if (field.field_type === "date" && s.signed_at) {
            await placeDateText(doc, pageIndex, rect, new Date(s.signed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }));
          }
        }
      }

      const preCertBytes = await doc.save();
      const integrityHashHex = crypto.createHash("sha256").update(Buffer.from(preCertBytes)).digest("hex");
      const completedAtIso = new Date().toISOString();

      await appendCompletionCertificate(doc, {
        documentName: request.original_filename,
        completedAtIso,
        signingMode: request.signing_mode,
        integrityHashHex,
        signers: finalSigners.map((s) => ({
          name: s.name ?? s.email,
          email: s.email,
          signedAtIso: s.signed_at ?? completedAtIso,
          signedIp: s.signed_ip,
          orderIndex: s.order_index,
        })),
      });

      const finalBytes = await doc.save();
      const signedPath = `${signer.request_id}/signed.pdf`;
      await supabase.storage.from(BUCKET).upload(signedPath, Buffer.from(finalBytes), { contentType: "application/pdf", upsert: true });
      await supabase
        .from("signature_requests")
        .update({ status: "completed", completed_at: completedAtIso, completed_pdf_hash: integrityHashHex })
        .eq("id", signer.request_id);

      const completedSignedUrl = await supabase.storage.from(BUCKET).createSignedUrl(signedPath, 300);
      completedDocumentUrl = completedSignedUrl.data?.signedUrl ?? null;
    }
  }

  res.status(200).json({ status: "signed", allComplete, completedDocumentUrl });
}

/** Public — no account needed. A signer declines to sign, with a required reason. */
export async function declineSignature(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const token = getParam(req, "token");
  const { reason } = req.body as { reason?: string };
  if (!reason || !reason.trim()) {
    res.status(400).json({ error: "A reason is required to decline." });
    return;
  }

  const { data: signerData, error } = await supabase
    .from("signature_request_signers")
    .select("*, signature_requests(status)")
    .eq("access_token", token)
    .single();
  if (error || !signerData) {
    res.status(404).json({ error: "This signing link isn't valid." });
    return;
  }
  const request = signerData.signature_requests as { status: string };
  if (request.status === "voided") {
    res.status(410).json({ error: "This document is no longer available for signing." });
    return;
  }
  if (signerData.status === "signed") {
    res.status(409).json({ error: "This has already been signed — it can't be declined now." });
    return;
  }
  if (signerData.status === "declined") {
    res.status(409).json({ error: "This has already been declined." });
    return;
  }

  const update = await supabase
    .from("signature_request_signers")
    .update({ status: "declined", decline_reason: reason.trim(), declined_at: new Date().toISOString() })
    .eq("access_token", token);
  if (update.error) {
    res.status(500).json({ error: `Couldn't record the decline: ${update.error.message}` });
    return;
  }
  res.status(200).json({ status: "declined" });
}

/** Owner-only: cancels a request that hasn't completed yet. Signer links immediately start returning 410 (getSignerView's existing voided check). */
export async function voidSignatureRequest(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const auth = await requireAuthenticatedUser(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const id = getParam(req, "id");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }
  const { reason } = req.body as { reason?: string };

  const { data: request, error: fetchError } = await supabase
    .from("signature_requests")
    .select("id, status")
    .eq("id", id)
    .eq("owner_id", auth.userId)
    .single();
  if (fetchError || !request) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (request.status === "completed") {
    res.status(400).json({ error: "This request already completed — it can't be voided." });
    return;
  }
  if (request.status === "voided") {
    res.status(200).json({ status: "voided" });
    return;
  }

  const update = await supabase
    .from("signature_requests")
    .update({ status: "voided", void_reason: reason?.trim() || null, voided_at: new Date().toISOString() })
    .eq("id", id);
  if (update.error) {
    res.status(500).json({ error: `Couldn't void the request: ${update.error.message}` });
    return;
  }
  res.status(200).json({ status: "voided" });
}

/**
 * Owner-only, irreversible: permanently removes a request's stored
 * document and every row tied to it (signers, fields — cascade via FK),
 * regardless of its status. This is the actual data-deletion path /trust
 * promises: a request that's merely voided still exists (voiding only
 * stops it being usable); this is what makes it actually go away.
 */
export async function deleteSignatureRequest(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const auth = await requireAuthenticatedUser(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const id = getParam(req, "id");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid request id" });
    return;
  }

  const { data: request, error: fetchError } = await supabase
    .from("signature_requests")
    .select("id, storage_path, status")
    .eq("id", id)
    .eq("owner_id", auth.userId)
    .single();
  if (fetchError || !request) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const storagePaths = [request.storage_path as string];
  if (request.status === "completed") storagePaths.push(`${id}/signed.pdf`);
  await supabase.storage.from(BUCKET).remove(storagePaths);

  const del = await supabase.from("signature_requests").delete().eq("id", id);
  if (del.error) {
    res.status(500).json({ error: `Couldn't delete the request: ${del.error.message}` });
    return;
  }
  res.status(200).json({ ok: true });
}

/** Owner-only: every request this owner has ever sent, newest first — the tracking list no earlier version of this feature had. */
export async function listSignatureRequests(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const auth = await requireAuthenticatedUser(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const { data, error } = await supabase
    .from("signature_requests")
    .select("*, signature_request_signers(email, name, status, order_index, access_token, decline_reason, signed_at)")
    .eq("owner_id", auth.userId)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Couldn't load your signature requests" });
    return;
  }

  const requests = await Promise.all(
    (data ?? []).map(async (request) => {
      const signers = (request.signature_request_signers ?? []) as SignerRow[];
      let downloadUrl: string | null = null;
      if (request.status === "completed") {
        const signed = await supabase.storage.from(BUCKET).createSignedUrl(`${request.id}/signed.pdf`, 300);
        downloadUrl = signed.data?.signedUrl ?? null;
      }
      return {
        id: request.id,
        originalFilename: request.original_filename,
        status: request.status,
        effectiveStatus: effectiveRequestStatus(request.status, signers),
        signingMode: request.signing_mode,
        createdAt: request.created_at,
        completedAt: request.completed_at,
        signers: signers
          .sort((a, b) => a.order_index - b.order_index)
          .map((s) => ({
            email: s.email,
            name: s.name,
            status: s.status,
            orderIndex: s.order_index,
            declineReason: s.decline_reason ?? null,
            signUrl: `${appUrl}/sign/${s.access_token}`,
          })),
        downloadUrl,
      };
    }),
  );

  res.status(200).json({ requests });
}

/** Authenticated — the owner checking on one request they created. */
export async function getSignatureRequestStatus(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const auth = await requireAuthenticatedUser(req, supabase);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }

  const { data: request, error } = await supabase
    .from("signature_requests")
    .select("*, signature_request_signers(email, name, status, order_index, access_token, decline_reason, signed_at)")
    .eq("id", getParam(req, "id"))
    .eq("owner_id", auth.userId)
    .single();
  if (error || !request) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const signers = (request.signature_request_signers ?? []) as SignerRow[];
  let downloadUrl: string | null = null;
  if (request.status === "completed") {
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(`${request.id}/signed.pdf`, 300);
    downloadUrl = signed.data?.signedUrl ?? null;
  }

  res.status(200).json({
    id: request.id,
    status: request.status,
    effectiveStatus: effectiveRequestStatus(request.status, signers),
    signingMode: request.signing_mode,
    originalFilename: request.original_filename,
    signers: signers
      .sort((a, b) => a.order_index - b.order_index)
      .map((s) => ({
        email: s.email,
        name: s.name,
        status: s.status,
        orderIndex: s.order_index,
        declineReason: s.decline_reason ?? null,
        signUrl: `${appUrl}/sign/${s.access_token}`,
      })),
    downloadUrl,
  });
}
