import crypto from "node:crypto";
import type { Request, Response } from "express";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

interface TemplateFieldInput {
  fieldType: FieldType;
  pageNumber: number;
  rect: Rect;
}

interface TemplateRoleInput {
  roleLabel: string;
  orderIndex?: number;
  fields: TemplateFieldInput[];
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

interface AuthResult {
  ok: boolean;
  status: number;
  error?: string;
  userId?: string;
}

async function requireAuthenticatedUser(req: Request, supabase: SupabaseClient): Promise<AuthResult> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) return { ok: false, status: 401, error: "Missing Authorization header" };
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return { ok: false, status: 401, error: "Invalid or expired session" };
  return { ok: true, status: 200, userId: data.user.id };
}

/**
 * Saves a document + reusable field layout as a template: roles are
 * placeholder labels ("Landlord", "Tenant 1"), never real emails — sending
 * from a template (createSignatureRequest's templateId branch) asks for
 * fresh emails per role each time. Same signature-requests storage bucket,
 * under templates/<id>/document.pdf — no new bucket or infra.
 */
export async function createSignatureTemplate(req: Request, res: Response): Promise<void> {
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

  const body = req.body as {
    name?: string;
    filename?: string;
    fileBase64?: string;
    signingMode?: unknown;
    roles?: TemplateRoleInput[];
  };
  const { name, filename, fileBase64, roles } = body;
  if (!name || !filename || !fileBase64 || !Array.isArray(roles) || roles.length === 0) {
    res.status(400).json({ error: "name, filename, fileBase64, and at least one role are required" });
    return;
  }
  for (const [i, role] of roles.entries()) {
    if (!role.roleLabel || !Array.isArray(role.fields) || role.fields.length === 0) {
      res.status(400).json({ error: `Role ${i + 1} needs a label and at least one field` });
      return;
    }
  }
  const signingMode: SigningMode = body.signingMode === "sequential" ? "sequential" : "parallel";

  const templateId = crypto.randomUUID();
  const storagePath = `templates/${templateId}/document.pdf`;
  const fileBytes = Buffer.from(fileBase64, "base64");

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, fileBytes, { contentType: "application/pdf" });
  if (upload.error) {
    res.status(500).json({ error: `Couldn't store the template document: ${upload.error.message}` });
    return;
  }

  const insertTemplate = await supabase
    .from("signature_templates")
    .insert({ id: templateId, owner_id: auth.userId, name, original_filename: filename, storage_path: storagePath, signing_mode: signingMode })
    .select()
    .single();
  if (insertTemplate.error) {
    res.status(500).json({ error: `Couldn't save the template: ${insertTemplate.error.message}` });
    return;
  }

  const roleRows = roles.map((r, i) => ({ template_id: templateId, role_label: r.roleLabel, order_index: r.orderIndex ?? i }));
  const insertRoles = await supabase.from("signature_template_roles").insert(roleRows).select();
  if (insertRoles.error) {
    res.status(500).json({ error: `Couldn't save the template's roles: ${insertRoles.error.message}` });
    return;
  }

  const fieldRows = insertRoles.data.flatMap((row, i) =>
    roles[i]!.fields.map((f) => ({
      template_id: templateId,
      role_id: row.id,
      field_type: f.fieldType,
      page_number: f.pageNumber,
      rect_x: f.rect.x,
      rect_y: f.rect.y,
      rect_width: f.rect.width,
      rect_height: f.rect.height,
    })),
  );
  const insertFields = await supabase.from("signature_template_fields").insert(fieldRows);
  if (insertFields.error) {
    res.status(500).json({ error: `Couldn't save the template's fields: ${insertFields.error.message}` });
    return;
  }

  res.status(200).json({ templateId });
}

/** Owner-only: every template this owner has saved, for "start from a template" in the sending wizard. */
export async function listSignatureTemplates(req: Request, res: Response): Promise<void> {
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

  const { data, error } = await supabase
    .from("signature_templates")
    .select("*, signature_template_roles(id)")
    .eq("owner_id", auth.userId)
    .order("created_at", { ascending: false });
  if (error) {
    res.status(500).json({ error: "Couldn't load your templates" });
    return;
  }

  res.status(200).json({
    templates: (data ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      originalFilename: t.original_filename,
      signingMode: t.signing_mode,
      roleCount: (t.signature_template_roles ?? []).length,
      createdAt: t.created_at,
    })),
  });
}

/** Owner-only: full detail for one template, including a signed document URL and every role's fields — drives "start from template" in the sending wizard. */
export async function getSignatureTemplate(req: Request, res: Response): Promise<void> {
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
    res.status(400).json({ error: "Invalid template id" });
    return;
  }

  const { data: template, error } = await supabase
    .from("signature_templates")
    .select("*, signature_template_roles(*, signature_template_fields(*))")
    .eq("id", id)
    .eq("owner_id", auth.userId)
    .single();
  if (error || !template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  const signedUrl = await supabase.storage.from(BUCKET).createSignedUrl(template.storage_path as string, 300);
  if (signedUrl.error) {
    res.status(500).json({ error: `Couldn't load the template document: ${signedUrl.error.message}` });
    return;
  }

  const roles = (template.signature_template_roles ?? []) as {
    id: string;
    role_label: string;
    order_index: number;
    signature_template_fields: { id: string; field_type: FieldType; page_number: number; rect_x: number; rect_y: number; rect_width: number; rect_height: number }[];
  }[];

  res.status(200).json({
    id: template.id,
    name: template.name,
    originalFilename: template.original_filename,
    signingMode: template.signing_mode,
    documentUrl: signedUrl.data.signedUrl,
    roles: roles
      .sort((a, b) => a.order_index - b.order_index)
      .map((r) => ({
        id: r.id,
        roleLabel: r.role_label,
        orderIndex: r.order_index,
        fields: (r.signature_template_fields ?? []).map((f) => ({
          id: f.id,
          fieldType: f.field_type,
          pageNumber: f.page_number,
          rect: { x: f.rect_x, y: f.rect_y, width: f.rect_width, height: f.rect_height },
        })),
      })),
  });
}

/** Owner-only. Deletes the template's storage object + row (roles/fields cascade via FK) — requests already sent from this template are unaffected (their template_id is set to null, not cascaded). */
export async function deleteSignatureTemplate(req: Request, res: Response): Promise<void> {
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
    res.status(400).json({ error: "Invalid template id" });
    return;
  }

  const { data: template, error: fetchError } = await supabase
    .from("signature_templates")
    .select("id, storage_path")
    .eq("id", id)
    .eq("owner_id", auth.userId)
    .single();
  if (fetchError || !template) {
    res.status(404).json({ error: "Template not found" });
    return;
  }

  await supabase.storage.from(BUCKET).remove([template.storage_path as string]);
  const del = await supabase.from("signature_templates").delete().eq("id", id);
  if (del.error) {
    res.status(500).json({ error: `Couldn't delete the template: ${del.error.message}` });
    return;
  }
  res.status(200).json({ ok: true });
}
