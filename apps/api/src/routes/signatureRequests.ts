import crypto from "node:crypto";
import type { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";

const BUCKET = "signature-requests";

interface SignerInput {
  email: string;
  name?: string;
  pageNumber: number;
  rect: { x: number; y: number; width: number; height: number };
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Bakes a signer's signature image into the document at their assigned
 * spot. Mirrors packages/core/src/pdf/signature.ts's placeSignatureImage —
 * duplicated rather than imported because that package ships raw TS for
 * Vite to consume directly (see its package.json `main`), which this
 * plain tsc-built Express app can't resolve the same way.
 */
async function placeSignatureImage(
  doc: PDFDocument,
  pageIndex: number,
  rect: { x: number; y: number; width: number; height: number },
  imageBytes: Uint8Array,
): Promise<void> {
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

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Signature must be a PNG data URL");
  return new Uint8Array(Buffer.from(match[1]!, "base64"));
}

/**
 * Starts a multi-party signing request: uploads the document (the one
 * intentional exception to this app's "nothing ever leaves your device"
 * design — see SECURITY.md) and creates one unguessable link per signer.
 * No email is sent from here — the owner copies each signUrl and shares it
 * themselves (no outbound-email credential is provisioned for this app yet).
 */
export async function createSignatureRequest(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }
  const supabase = getSupabaseAdmin();
  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const { filename, fileBase64, signers } = req.body as { filename?: string; fileBase64?: string; signers?: SignerInput[] };
  if (!filename || !fileBase64 || !Array.isArray(signers) || signers.length === 0) {
    res.status(400).json({ error: "filename, fileBase64, and at least one signer are required" });
    return;
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
    .insert({ id: requestId, owner_id: userData.user.id, original_filename: filename, storage_path: storagePath })
    .select()
    .single();
  if (insertRequest.error) {
    res.status(500).json({ error: `Couldn't create the request: ${insertRequest.error.message}` });
    return;
  }

  const signerRows = signers.map((s) => ({
    request_id: requestId,
    email: s.email,
    name: s.name ?? null,
    access_token: crypto.randomBytes(32).toString("hex"),
    page_number: s.pageNumber,
    rect_x: s.rect.x,
    rect_y: s.rect.y,
    rect_width: s.rect.width,
    rect_height: s.rect.height,
  }));
  const insertSigners = await supabase.from("signature_request_signers").insert(signerRows).select();
  if (insertSigners.error) {
    res.status(500).json({ error: `Couldn't add signers: ${insertSigners.error.message}` });
    return;
  }

  res.status(200).json({
    requestId,
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
  const token = req.params.token;
  const { data: signer, error } = await supabase
    .from("signature_request_signers")
    .select("*, signature_requests(status, original_filename, storage_path)")
    .eq("access_token", token)
    .single();
  if (error || !signer) {
    res.status(404).json({ error: "This signing link isn't valid." });
    return;
  }
  const request = signer.signature_requests as { status: string; original_filename: string; storage_path: string };
  if (request.status === "voided") {
    res.status(410).json({ error: "This document is no longer available for signing." });
    return;
  }

  const signedUrl = await supabase.storage.from(BUCKET).createSignedUrl(request.storage_path, 300);
  if (signedUrl.error) {
    res.status(500).json({ error: `Couldn't load the document: ${signedUrl.error.message}` });
    return;
  }

  res.status(200).json({
    signerName: signer.name,
    signerEmail: signer.email,
    status: signer.status,
    pageNumber: signer.page_number,
    rect: { x: signer.rect_x, y: signer.rect_y, width: signer.rect_width, height: signer.rect_height },
    documentUrl: signedUrl.data.signedUrl,
    originalFilename: request.original_filename,
    requestStatus: request.status,
  });
}

/** Public — no account needed. Records one signer's signature; bakes the final PDF once everyone's signed. */
export async function submitSignature(req: Request, res: Response): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const token = req.params.token;
  const { signatureDataUrl } = req.body as { signatureDataUrl?: string };
  if (!signatureDataUrl) {
    res.status(400).json({ error: "signatureDataUrl is required" });
    return;
  }

  const { data: signer, error } = await supabase.from("signature_request_signers").select("*").eq("access_token", token).single();
  if (error || !signer) {
    res.status(404).json({ error: "This signing link isn't valid." });
    return;
  }
  if (signer.status === "signed") {
    res.status(409).json({ error: "This has already been signed." });
    return;
  }

  const clientIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null;
  const update = await supabase
    .from("signature_request_signers")
    .update({ status: "signed", signature_data_url: signatureDataUrl, signed_at: new Date().toISOString(), signed_ip: clientIp })
    .eq("access_token", token);
  if (update.error) {
    res.status(500).json({ error: `Couldn't record the signature: ${update.error.message}` });
    return;
  }

  const { data: allSigners } = await supabase.from("signature_request_signers").select("status").eq("request_id", signer.request_id);
  const allComplete = (allSigners ?? []).every((s) => s.status === "signed");

  if (allComplete) {
    const { data: request } = await supabase.from("signature_requests").select("*").eq("id", signer.request_id).single();
    if (request) {
      const original = await supabase.storage.from(BUCKET).download(request.storage_path);
      if (!original.error) {
        const bytes = new Uint8Array(await original.data.arrayBuffer());
        const doc = await PDFDocument.load(bytes);
        const { data: signers } = await supabase.from("signature_request_signers").select("*").eq("request_id", signer.request_id);
        for (const s of signers ?? []) {
          if (!s.signature_data_url) continue;
          await placeSignatureImage(
            doc,
            s.page_number - 1,
            { x: s.rect_x, y: s.rect_y, width: s.rect_width, height: s.rect_height },
            dataUrlToBytes(s.signature_data_url),
          );
        }
        const finalBytes = await doc.save();
        const signedPath = `${signer.request_id}/signed.pdf`;
        await supabase.storage.from(BUCKET).upload(signedPath, Buffer.from(finalBytes), { contentType: "application/pdf", upsert: true });
        await supabase
          .from("signature_requests")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", signer.request_id);
      }
    }
  }

  res.status(200).json({ status: "signed", allComplete });
}

/** Authenticated — the owner checking on a request they created. */
export async function getSignatureRequestStatus(req: Request, res: Response): Promise<void> {
  const authHeader = req.headers.authorization ?? "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!accessToken) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(500).json({ error: "Server is not configured yet" });
    return;
  }
  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  const { data: request, error } = await supabase
    .from("signature_requests")
    .select("*, signature_request_signers(email, name, status, signed_at)")
    .eq("id", req.params.id)
    .eq("owner_id", userData.user.id)
    .single();
  if (error || !request) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  let downloadUrl: string | null = null;
  if (request.status === "completed") {
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(`${request.id}/signed.pdf`, 300);
    downloadUrl = signed.data?.signedUrl ?? null;
  }

  res.status(200).json({
    status: request.status,
    originalFilename: request.original_filename,
    signers: request.signature_request_signers,
    downloadUrl,
  });
}
