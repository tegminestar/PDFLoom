import { getPdfWorkerClient, recognizeImage } from "@pdfloom/core";
import { useLoomStore } from "../../app/store";

const OCR_DPI = 250; // matches OcrDialog.tsx's own constant — keep in sync if that one changes.
const AUTO_OCR_LANGUAGE = "eng";

export interface EnsureDocumentTextResult {
  text: string;
  ranOcr: boolean;
}

/**
 * Reads full text for the given pages off whatever document is open right
 * now. If none of them have extractable text, runs real OCR on them first
 * — the same rasterize → recognize → addInvisibleTextLayer pipeline
 * OcrDialog.tsx uses, not a throwaway in-memory read, so the document
 * actually becomes searchable going forward too — then re-reads. Every AI
 * feature that needs document text (Summarize, Translate, Chat, Quick
 * Create) goes through this instead of dead-ending on "no extractable
 * text, try running OCR first" and making the user leave, run OCR
 * manually, then come back and retry.
 *
 * Always reads `document` fresh from the store rather than taking it as a
 * parameter: applyPdfMutation destroys the old PdfDocument instance and
 * swaps in a new one once OCR actually writes back to the document, so a
 * caller's own `doc` reference would go stale mid-call.
 *
 * OCR always runs in English — there's no language picker in this
 * automatic path (unlike the manual "Make searchable (OCR)…" dialog,
 * which offers 6). A caller whose document is scanned in another language
 * should surface that this ran in English and point at the manual dialog
 * to redo it with the right one if the result looks wrong.
 */
export async function ensureDocumentText(pageNumbers: number[], onStatus?: (status: string) => void): Promise<EnsureDocumentTextResult> {
  const readAll = async () => {
    const doc = useLoomStore.getState().document;
    if (!doc) throw new Error("No document is open.");
    let text = "";
    for (const pageNumber of pageNumbers) {
      onStatus?.(pageNumbers.length > 1 ? `Reading page ${pageNumber} of ${pageNumbers.length}…` : "Reading page…");
      text += `${await doc.getFullPageText(pageNumber)}\n\n`;
    }
    return text;
  };

  const initial = await readAll();
  if (initial.trim()) return { text: initial, ranOcr: false };

  const doc = useLoomStore.getState().document;
  if (!doc) throw new Error("No document is open.");

  onStatus?.("No extractable text found — running OCR automatically (English)…");
  const client = await getPdfWorkerClient();
  let bytes = await doc.getRawBytes();
  const scale = OCR_DPI / 72;

  for (let i = 0; i < pageNumbers.length; i++) {
    const pageNumber = pageNumbers[i]!;
    onStatus?.(`Auto-OCR: page ${i + 1}/${pageNumbers.length}…`);
    const dims = await doc.getPageDimensions(pageNumber);
    const canvas = window.document.createElement("canvas");
    await doc.renderPage(pageNumber, { canvas, scale });
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Couldn't rasterize page ${pageNumber}`))), "image/png");
    });
    const words = await recognizeImage(blob, AUTO_OCR_LANGUAGE);
    const placements = words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => ({
        text: w.text,
        rect: {
          x: w.bbox.x0 / scale,
          y: dims.heightPt - w.bbox.y1 / scale,
          width: (w.bbox.x1 - w.bbox.x0) / scale,
          height: (w.bbox.y1 - w.bbox.y0) / scale,
        },
      }));
    if (placements.length > 0) {
      bytes = await client.addInvisibleTextLayer(bytes, pageNumber - 1, placements);
    }
  }

  await useLoomStore.getState().applyPdfMutation(bytes);
  const after = await readAll();
  return { text: after, ranOcr: true };
}
