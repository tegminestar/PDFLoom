import { PDFDocument, type PDFImage } from "pdf-lib";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

export interface SourceImage {
  bytes: Uint8Array;
  type: "png" | "jpg";
}

export type ImagePageSizing =
  | { mode: "auto"; dpi?: number }
  | { mode: "fit"; pageSize?: { width: number; height: number }; margin?: number };

async function embedImage(doc: PDFDocument, image: SourceImage): Promise<PDFImage> {
  return image.type === "png" ? doc.embedPng(image.bytes) : doc.embedJpg(image.bytes);
}

/** One page's target size/placement in PDF points, derived from an embedded image and a sizing strategy. */
async function layoutImagePage(
  embedded: PDFImage,
  sizing: ImagePageSizing,
): Promise<{ pageSize: { width: number; height: number }; draw: { x: number; y: number; width: number; height: number } }> {
  if (sizing.mode === "fit") {
    const pageSize = sizing.pageSize ?? { width: 612, height: 792 };
    const margin = sizing.margin ?? 36;
    const maxW = pageSize.width - margin * 2;
    const maxH = pageSize.height - margin * 2;
    const scale = Math.min(maxW / embedded.width, maxH / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    return { pageSize, draw: { x: (pageSize.width - width) / 2, y: (pageSize.height - height) / 2, width, height } };
  }
  // "auto": the page is sized to the image itself, at a target DPI — 72pt/in is
  // pdf's native unit, so page points = image pixels * (72 / dpi). A photo at
  // full pixel dimensions rendered 1:1 (dpi=72) would produce an enormous
  // page for a modern camera/phone image, so default to a print-realistic DPI.
  const dpi = sizing.dpi ?? 150;
  const width = (embedded.width / dpi) * 72;
  const height = (embedded.height / dpi) * 72;
  return { pageSize: { width, height }, draw: { x: 0, y: 0, width, height } };
}

/** Creates a brand-new PDF with one page per image, in order. */
export async function imagesToPdf(images: SourceImage[], sizing: ImagePageSizing = { mode: "auto" }): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("imagesToPdf requires at least one image");
  const doc = await PDFDocument.create();
  for (const image of images) {
    const embedded = await embedImage(doc, image);
    const { pageSize, draw } = await layoutImagePage(embedded, sizing);
    const page = doc.addPage([pageSize.width, pageSize.height]);
    page.drawImage(embedded, draw);
  }
  return doc.save();
}

/** Inserts each image as its own new page into an existing document, starting at the given 0-based index. */
export async function insertImagePages(
  source: Uint8Array,
  atIndex: number,
  images: SourceImage[],
  sizing: ImagePageSizing = { mode: "auto" },
): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("insertImagePages requires at least one image");
  const doc = await loadForMutation(source);
  for (let i = 0; i < images.length; i++) {
    const embedded = await embedImage(doc, images[i]!);
    const { pageSize, draw } = await layoutImagePage(embedded, sizing);
    const page = doc.insertPage(atIndex + i, [pageSize.width, pageSize.height]);
    page.drawImage(embedded, draw);
  }
  return finish(doc);
}
