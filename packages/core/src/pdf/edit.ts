import { PDFDocument, rgb } from "pdf-lib";
import type { Rect } from "./annotations";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

export interface ReplaceImageAreaOptions {
  /** true (default) fits the new image inside rect preserving its own aspect ratio, centered; false stretches it to fill rect exactly. */
  preserveAspectRatio?: boolean;
}

/**
 * Best-effort "image edit": pdf.js doesn't expose enough to locate and
 * rewrite a specific XObject inside a page's content stream client-side, so
 * this visually replaces whatever occupies `rect` by painting an opaque
 * white backing (covering the original, including any transparency in it)
 * and drawing the new image on top — not a true content-stream edit. The UI
 * must be honest about this (see the plan's "no silent content mangling"
 * standard), same framing as the text-edit tool below.
 */
export async function replaceImageArea(
  source: Uint8Array,
  pageIndex: number,
  rect: Rect,
  imageBytes: Uint8Array,
  imageType: "png" | "jpg",
  options: ReplaceImageAreaOptions = {},
): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const page = doc.getPage(pageIndex);
  const image = imageType === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);

  page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: rgb(1, 1, 1) });

  let drawWidth = rect.width;
  let drawHeight = rect.height;
  let drawX = rect.x;
  let drawY = rect.y;

  if (options.preserveAspectRatio ?? true) {
    const aspect = image.width / image.height;
    const rectAspect = rect.width / rect.height;
    if (aspect > rectAspect) {
      drawWidth = rect.width;
      drawHeight = rect.width / aspect;
    } else {
      drawHeight = rect.height;
      drawWidth = rect.height * aspect;
    }
    drawX = rect.x + (rect.width - drawWidth) / 2;
    drawY = rect.y + (rect.height - drawHeight) / 2;
  }

  page.drawImage(image, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
  return finish(doc);
}
