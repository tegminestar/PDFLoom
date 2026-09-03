import type { TranslationPipeline } from "@huggingface/transformers";
import { chunkText } from "./chunk-text";
import { loadPipeline, type ModelLoadProgressCallback } from "./model-loader";

export interface TranslationLanguage {
  code: string;
  label: string;
  /** Xenova/Helsinki-NLP MarianMT model id for English -> this language. Source is fixed at English for V1 — see translate.ts's docstring. */
  modelId: string;
}

// One model per target language (MarianMT is per-language-pair, not
// multilingual) — each is ~75-300MB, downloaded on demand and cached
// per-language after first use, same promise as OCR's language packs.
// Source is fixed to English: covers the common "I have an English PDF,
// translate it" case honestly, without overpromising universal
// any-to-any translation from a single small model.
// Each modelId was confirmed to actually exist on the Hub before being
// listed here (a plausible-looking Xenova/opus-mt-en-pt does NOT exist —
// Portuguese is only available bundled into the multi-target
// Xenova/opus-mt-en-ROMANCE model, which needs a ">>por<<"-style language
// prefix token per input rather than being a plain single-pair model like
// the rest of this list — left out of v1 rather than special-cased).
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: "fr", label: "French", modelId: "Xenova/opus-mt-en-fr" },
  { code: "es", label: "Spanish", modelId: "Xenova/opus-mt-en-es" },
  { code: "de", label: "German", modelId: "Xenova/opus-mt-en-de" },
  { code: "it", label: "Italian", modelId: "Xenova/opus-mt-en-it" },
  { code: "zh", label: "Chinese", modelId: "Xenova/opus-mt-en-zh" },
  { code: "ja", label: "Japanese", modelId: "Xenova/opus-mt-en-jap" },
  { code: "ru", label: "Russian", modelId: "Xenova/opus-mt-en-ru" },
];

// Conservative word budget per chunk — MarianMT's encoder context is
// smaller than the summarization model's, so this stays well under it.
const MAX_WORDS_PER_CHUNK = 300;

export type TranslateStage =
  | { stage: "loading-model"; detail: Parameters<ModelLoadProgressCallback>[0] }
  | { stage: "translating-part"; part: number; totalParts: number }
  | { stage: "done" };

export interface TranslateOptions {
  onProgress?: (info: TranslateStage) => void;
}

export interface TranslateResult {
  translatedText: string;
  chunkCount: number;
}

/**
 * Translates English text to the given target language with a small local
 * MarianMT model, entirely in-browser. Long text is chunked (chunkText)
 * and each chunk translated independently, then rejoined — translation,
 * unlike summarization, doesn't need a reduce pass since concatenating
 * independently-translated chunks is already the correct final output.
 */
export async function translateText(text: string, language: TranslationLanguage, options?: TranslateOptions): Promise<TranslateResult> {
  const trimmed = text.trim();
  if (!trimmed) return { translatedText: "", chunkCount: 0 };

  const onProgress = options?.onProgress;
  const translator = await loadPipeline("translation", language.modelId, {
    dtype: "q8",
    // Same onnxruntime-web WASM bug as summarize.ts's model (tied embedding
    // + merged decoder + quantization → TransposeDQWeightsForMatMulNBits
    // missing-scale error), confirmed directly for this MarianMT model too
    // — see the AI-infra memory notes. Same fix.
    sessionOptions: { graphOptimizationLevel: "disabled" },
    ...(onProgress ? { onProgress: (detail: Parameters<ModelLoadProgressCallback>[0]) => onProgress({ stage: "loading-model", detail }) } : {}),
  });

  const chunks = chunkText(trimmed, MAX_WORDS_PER_CHUNK);
  const translatedChunks: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ stage: "translating-part", part: i + 1, totalParts: chunks.length });
    const output = await (translator as TranslationPipeline)(chunks[i]!);
    const first = Array.isArray(output) ? output[0] : output;
    if (!first || typeof first !== "object" || !("translation_text" in first)) {
      throw new Error("Translation model returned an unexpected result shape.");
    }
    translatedChunks.push((first as { translation_text: string }).translation_text.trim());
  }

  onProgress?.({ stage: "done" });
  return { translatedText: translatedChunks.join(" "), chunkCount: chunks.length };
}

/**
 * Starts downloading one target language's model before the user clicks
 * Translate — call with whichever language is currently selected in the
 * dropdown (the default on dialog-open, then again on every change) so the
 * download overlaps with them reading/deciding. Deliberately NOT one call
 * per language in TRANSLATION_LANGUAGES — that would download all 7
 * models (tens to hundreds of MB each) regardless of which one gets used.
 * Options must match translateText's own loadPipeline call exactly, or
 * this warms a different cache entry.
 */
export function preloadTranslateModel(language: TranslationLanguage): Promise<unknown> {
  return loadPipeline("translation", language.modelId, { dtype: "q8", sessionOptions: { graphOptimizationLevel: "disabled" } });
}
