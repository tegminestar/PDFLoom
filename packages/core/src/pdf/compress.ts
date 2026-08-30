import { PDFDocument } from "pdf-lib";

/**
 * One page's rasterized replacement: a full-page JPEG plus the page's
 * target size in PDF points. The caller (UI) does the actual rasterizing —
 * it needs a real `<canvas>` via `PdfDocument.renderPage`, which this
 * worker-side engine module has no access to — and hands the encoded bytes
 * in here to be reassembled into a PDF.
 */
export interface RasterizedPage {
  widthPt: number;
  heightPt: number;
  jpegBytes: Uint8Array;
}

/**
 * Rebuilds a document as one full-page JPEG per page. This is the
 * "image compression" strategy real PDF compressors use for scanned or
 * image-heavy documents: it can shrink file size dramatically, but it is
 * lossy and every page stops being selectable/searchable text — the UI
 * must present this as an explicit, opted-into tradeoff, not a default.
 * (Lossless structural compression already happens on every save via
 * pdf-lib's `useObjectStreams: true` default, which needs no dedicated
 * tool here.)
 */
export async function rebuildFromPageImages(pages: RasterizedPage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("rebuildFromPageImages requires at least one page");
  const doc = await PDFDocument.create();
  for (const { widthPt, heightPt, jpegBytes } of pages) {
    const image = await doc.embedJpg(jpegBytes);
    const page = doc.addPage([widthPt, heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  }
  return doc.save();
}
