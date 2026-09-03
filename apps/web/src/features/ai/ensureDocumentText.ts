import { getPdfWorkerClient, recognizeImage } from "@pdfloom/core";
import { useLoomStore } from "../../app/store";

const OCR_DPI = 250; // matches OcrDialog.tsx's own constant — keep in sync if that one changes.
const AUTO_OCR_LANGUAGE = "eng";

export interface EnsureDocumentTextResult {
  text: string;
  /** Same content as `text`, broken out per page — for callers (Chat's RAG indexing) that need per-page granularity instead of one combined string, so they don't have to do their own second, unguarded read pass over a `doc`/page-count that could go stale the same way the one this function itself guards against. */
  pages: { pageNumber: number; text: string }[];
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
 * This whole operation can take a while (multi-page OCR, a model
 * download) and nothing in the UI prevents the user from closing the
 * dialog and opening a *different* document while it's still running in
 * the background — closing a dialog doesn't cancel its in-flight promise
 * chain here. Without a check, a since-abandoned OCR run finishing later
 * would call applyPdfMutation with bytes derived from the *old* document
 * against whatever document happens to be open *now*, silently
 * overwriting unrelated content. `meta.id` is a fresh id per file-open
 * (stable across applyPdfMutation itself, which preserves it — only a
 * genuinely new open changes it), so it's checked before every step that
 * reads from or writes to the document, and this throws rather than
 * risking a mismatch if it ever changed underneath.
 *
 * OCR always runs in English — there's no language picker in this
 * automatic path (unlike the manual "Make searchable (OCR)…" dialog,
 * which offers 6). A caller whose document is scanned in another language
 * should surface that this ran in English and point at the manual dialog
 * to redo it with the right one if the result looks wrong.
 */
export async function ensureDocumentText(pageNumbers: number[], onStatus?: (status: string) => void): Promise<EnsureDocumentTextResult> {
  const documentId = useLoomStore.getState().meta?.id;
  if (!documentId) throw new Error("No document is open.");

  const assertSameDocument = () => {
    if (useLoomStore.getState().meta?.id !== documentId) {
      throw new Error("The open document changed while this was running, so it was cancelled rather than risk applying the result to the wrong file.");
    }
  };

  const readAll = async () => {
    const doc = useLoomStore.getState().document;
    if (!doc) throw new Error("No document is open.");
    const pages: { pageNumber: number; text: string }[] = [];
    for (const pageNumber of pageNumbers) {
      assertSameDocument();
      onStatus?.(pageNumbers.length > 1 ? `Reading page ${pageNumber} of ${pageNumbers.length}…` : "Reading page…");
      pages.push({ pageNumber, text: await doc.getFullPageText(pageNumber) });
    }
    const text = pages.map((p) => p.text).join("\n\n");
    return { text, pages };
  };

  const initial = await readAll();
  if (initial.text.trim()) return { ...initial, ranOcr: false };

  assertSameDocument();
  const doc = useLoomStore.getState().document;
  if (!doc) throw new Error("No document is open.");

  onStatus?.("No extractable text found — running OCR automatically (English)…");
  const client = await getPdfWorkerClient();
  let bytes = await doc.getRawBytes();
  const scale = OCR_DPI / 72;

  // Wrapped so a failure here (Tesseract itself, a language-pack fetch, the
  // worker-serialization queue above rejecting a stale call) reaches the
  // caller's own generic error toast tagged as an OCR failure specifically
  // — without this, e.g. Summarize's catch block would show "Couldn't
  // summarize this document" with a raw Tesseract/pdf.js message and no
  // indication that an automatic OCR pre-step even ran, let alone that the
  // manual "Make searchable (OCR)" dialog (with a language picker) exists
  // as a fallback if the hardcoded English pass is what failed.
  try {
    for (let i = 0; i < pageNumbers.length; i++) {
      assertSameDocument();
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Automatic OCR failed partway through (${detail}) — try Convert → "Make searchable (OCR)…" directly, which also lets you pick a language other than English.`);
  }

  assertSameDocument();
  await useLoomStore.getState().applyPdfMutation(bytes);
  const after = await readAll();
  return { ...after, ranOcr: true };
}
