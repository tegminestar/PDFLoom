import { PDFDocument, rgb } from "pdf-lib";
import type { Rect } from "./annotations";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

export interface RedactPageInput {
  pageIndex: number;
  widthPt: number;
  heightPt: number;
  /** The page rasterized to a JPEG — rendering needs a real <canvas>, so the UI does this, not this worker-side module. */
  jpegBytes: Uint8Array;
  /** Black-out boxes, in PDF point space, drawn as solid opaque rectangles on top of the rasterized page. */
  boxes: Rect[];
}

/**
 * True redaction, not just a black overlay: each targeted page is replaced
 * wholesale by its own rasterized image with solid black boxes drawn on
 * top, so the original text (and anything else — hidden layers, stray
 * annotations, an accidental duplicate text run under the box) is gone
 * from that page's content entirely, not merely hidden beneath a shape a
 * reader could delete or select-through. The honest cost, stated plainly
 * in the UI: a redacted page stops being selectable/searchable text,
 * exactly like Compress — this is the same tradeoff, made for the same
 * reason (a guarantee beats an attempt at surgical content-stream editing
 * that risks missing an edge case, which for redaction specifically would
 * mean silently failing to protect sensitive content). Only the pages
 * passed in are touched; every other page in the document is untouched
 * and stays fully text-searchable.
 */
export async function redactPages(source: Uint8Array, pages: RedactPageInput[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("redactPages requires at least one page");
  const doc = await loadForMutation(source);

  for (const { pageIndex, widthPt, heightPt, jpegBytes, boxes } of pages) {
    const image = await doc.embedJpg(jpegBytes);
    doc.removePage(pageIndex);
    const page = doc.insertPage(pageIndex, [widthPt, heightPt]);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
    for (const box of boxes) {
      page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(0, 0, 0) });
    }
  }

  return finish(doc);
}
