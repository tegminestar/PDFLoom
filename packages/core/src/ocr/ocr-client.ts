import { createWorker, type Worker } from "tesseract.js";

export interface OcrWord {
  text: string;
  /** Pixel-space bounding box, in the coordinate system of the image that was recognized (top-left origin, y grows downward — the caller converts to PDF point space). */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** 0-100. */
  confidence: number;
}

export type OcrLanguage = "eng" | "spa" | "fra" | "deu" | "por" | "ita";

export interface OcrProgress {
  /** Tesseract's own phase name, e.g. "loading language traineddata" (first use only, then cached) or "recognizing text". */
  status: string;
  /** 0-1, within the current phase. */
  progress: number;
}

let worker: Worker | null = null;
let workerLang: OcrLanguage | null = null;
let currentProgressCallback: ((p: OcrProgress) => void) | null = null;

/**
 * Lazily creates (or re-langs) a single shared Tesseract.js worker. The
 * worker downloads its language's traineddata from Tesseract's own CDN on
 * first use per language and caches it (Cache API), same "free, no API key,
 * not our bandwidth" model as the AI features elsewhere in the plan. The
 * logger is registered once here (Tesseract.js takes it at construction
 * time, not per-call) and fans out to whichever callback the in-flight
 * recognizeImage call last registered.
 */
async function getWorker(lang: OcrLanguage): Promise<Worker> {
  if (worker && workerLang === lang) return worker;
  if (worker) await worker.terminate();
  worker = await createWorker(lang, undefined, {
    logger: (m) => currentProgressCallback?.({ status: m.status, progress: m.progress }),
  });
  workerLang = lang;
  return worker;
}

/**
 * Runs OCR on one rasterized page image, returning every recognized word
 * with its pixel-space bounding box. The caller is responsible for
 * rasterizing the page (needs a real <canvas>, which this module — safe to
 * run in a Worker — has no access to) and for converting bboxes into PDF
 * point space using the same DPI it rasterized at.
 */
export async function recognizeImage(image: Blob, lang: OcrLanguage, onProgress?: (p: OcrProgress) => void): Promise<OcrWord[]> {
  const w = await getWorker(lang);
  currentProgressCallback = onProgress ?? null;
  try {
    const { data } = await w.recognize(image, {}, { blocks: true });
    const words: OcrWord[] = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          for (const word of line.words) {
            if (word.text.trim().length === 0) continue;
            words.push({ text: word.text, bbox: word.bbox, confidence: word.confidence });
          }
        }
      }
    }
    return words;
  } finally {
    currentProgressCallback = null;
  }
}

export async function terminateOcrWorker(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
    workerLang = null;
  }
}
