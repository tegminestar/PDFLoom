import {
  PDFDocument,
  StandardFonts,
  TextRenderingMode,
  beginText,
  endText,
  moveText,
  setCharacterSqueeze,
  setFontAndSize,
  setTextRenderingMode,
  showText,
} from "pdf-lib";
import type { Rect } from "./annotations";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

export interface OcrWordPlacement {
  text: string;
  /** Already in PDF point space (bottom-left origin) — the caller converts from the OCR engine's pixel-space bbox using the DPI it rasterized at. */
  rect: Rect;
}

/**
 * Bakes OCR'd words onto a page as real, searchable/selectable/copyable
 * text — but invisible (PDF text-rendering mode 3), so the scanned image
 * underneath is all that's ever seen. This is what makes a scanned PDF
 * "searchable" the same way Acrobat's OCR does: the text becomes part of
 * the page's own content stream (via page.pushOperators, not a separate
 * annotation), which is exactly what pdf.js's text layer and our own
 * search already read — no changes needed elsewhere for search/selection
 * to pick up OCR'd pages once this has run.
 *
 * Each word is drawn at a font size derived from its own bbox height, then
 * horizontally scaled (Tz) so its rendered width matches the bbox width —
 * OCR'd glyph widths never match a standard font's metrics exactly, and
 * without this the invisible text drifts out of alignment with the visible
 * scan over the length of a line, which would make selection highlighting
 * look wrong even though the recognized text itself is correct.
 */
export async function addInvisibleTextLayer(source: Uint8Array, pageIndex: number, words: OcrWordPlacement[]): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const page = doc.getPage(pageIndex);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontKey = page.node.newFontDictionary(font.name, font.ref);

  for (const { text, rect } of words) {
    if (text.length === 0 || rect.width <= 0 || rect.height <= 0) continue;
    const fontSize = Math.max(1, rect.height * 0.85);
    const naturalWidth = font.widthOfTextAtSize(text, fontSize);
    if (naturalWidth <= 0) continue;
    const horizontalScalePct = Math.min(400, Math.max(10, (rect.width / naturalWidth) * 100));

    page.pushOperators(
      beginText(),
      setTextRenderingMode(TextRenderingMode.Invisible),
      setFontAndSize(fontKey, fontSize),
      setCharacterSqueeze(horizontalScalePct),
      moveText(rect.x, rect.y),
      showText(font.encodeText(text)),
      endText(),
    );
  }

  return finish(doc);
}
