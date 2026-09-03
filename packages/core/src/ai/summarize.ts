import type { SummarizationPipeline } from "@huggingface/transformers";
import { chunkText } from "./chunk-text";
import { loadPipeline, type ModelLoadProgressCallback } from "./model-loader";

// Xenova/distilbart-cnn-6-6 (the more obviously "summarization-shaped" model
// name) was tried first, but its merged-decoder ONNX export triggers a real
// onnxruntime-web WASM bug ("TransposeDQWeightsForMatMulNBits: missing
// required scale for model.shared") across every quantization level tested
// (default "q8" and explicit "int8") — the files load fine on the native
// (Node/CPU) backend, so this is specifically an ORT-Web WASM limitation
// with this model's tied+merged-decoder embedding quantization, not a
// broken file. t5-small doesn't share that architecture and was verified
// to load and summarize correctly.
const MODEL_ID = "Xenova/t5-small";
// Conservative word budget per chunk — BPE tokenization runs somewhat
// denser than 1 token/word, so this stays comfortably under the model's
// 1024-token encoder limit even for token-heavy text.
const MAX_WORDS_PER_CHUNK = 600;

export type SummarizeStage =
  | { stage: "loading-model"; detail: Parameters<ModelLoadProgressCallback>[0] }
  | { stage: "summarizing-part"; part: number; totalParts: number }
  | { stage: "combining-parts" }
  | { stage: "done" };

export interface SummarizeOptions {
  onProgress?: (info: SummarizeStage) => void;
  /** Roughly how long the final summary should be, in words. Default 120. */
  targetLengthWords?: number;
}

export interface SummarizeResult {
  summary: string;
  /** True if the document needed multiple chunks — the returned summary is itself a summary-of-summaries in that case. */
  wasChunked: boolean;
  chunkCount: number;
}

async function runSummarizer(summarizer: SummarizationPipeline, text: string, targetLengthWords: number): Promise<string> {
  // The model works in tokens, not words, but max_new_tokens is the
  // knob it exposes — approximating 1.3 tokens/word keeps output length
  // roughly proportional to what the caller asked for.
  const maxNewTokens = Math.max(24, Math.round(targetLengthWords * 1.3));
  const output = await summarizer(text, { max_new_tokens: maxNewTokens, min_new_tokens: Math.min(16, maxNewTokens) });
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== "object" || !("summary_text" in first)) {
    throw new Error("Summarization model returned an unexpected result shape.");
  }
  return (first as { summary_text: string }).summary_text.trim();
}

/**
 * Summarizes arbitrary-length text with a small local model (~78MB at the
 * quantization level pinned below), entirely in-browser. Long documents
 * are map-reduced: each chunk is summarized independently, then — if there
 * was more than one chunk — the chunk summaries are concatenated and
 * summarized again for a single cohesive result, the standard approach for
 * feeding long documents through a fixed-context-window model.
 */
export async function summarizeText(text: string, options?: SummarizeOptions): Promise<SummarizeResult> {
  const trimmed = text.trim();
  if (!trimmed) return { summary: "", wasChunked: false, chunkCount: 0 };

  const targetLengthWords = options?.targetLengthWords ?? 120;

  const onProgress = options?.onProgress;
  const summarizer = await loadPipeline("summarization", MODEL_ID, {
    dtype: "q8",
    // Works around real onnxruntime-web WASM bugs in its own graph
    // optimizer for this model's encoder-decoder architecture (verified
    // directly: the *default* graph-optimized load fails, at "q8" with a
    // DequantizeLinear/MatMulNBits scale error and, separately, at fp16
    // with an unrelated LayerNormFusion index error — different bugs in
    // different optimizer passes, not something dtype selection alone can
    // route around). Model files themselves are fine (confirmed loading
    // and running correctly on the native ONNX Runtime Node backend).
    sessionOptions: { graphOptimizationLevel: "disabled" },
    ...(onProgress ? { onProgress: (detail: Parameters<ModelLoadProgressCallback>[0]) => onProgress({ stage: "loading-model", detail }) } : {}),
  });

  const chunks = chunkText(trimmed, MAX_WORDS_PER_CHUNK);
  if (chunks.length <= 1) {
    const summary = await runSummarizer(summarizer, chunks[0] ?? trimmed, targetLengthWords);
    return { summary, wasChunked: false, chunkCount: 1 };
  }

  const chunkSummaries: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    options?.onProgress?.({ stage: "summarizing-part", part: i + 1, totalParts: chunks.length });
    // Each chunk gets a shorter target so the combined text stays a
    // manageable size for the final reduce pass below.
    chunkSummaries.push(await runSummarizer(summarizer, chunks[i]!, Math.max(40, Math.round(targetLengthWords / 2))));
  }

  options?.onProgress?.({ stage: "combining-parts" });
  const combined = chunkSummaries.join(" ");
  const finalSummary = await runSummarizer(summarizer, combined, targetLengthWords);

  options?.onProgress?.({ stage: "done" });
  return { summary: finalSummary, wasChunked: true, chunkCount: chunks.length };
}

/** Starts downloading the summarization model before any text is summarized — call the moment the summarize UI opens. Options must match summarizeText's own loadPipeline call exactly, or this warms a different cache entry. */
export function preloadSummarizeModel(): Promise<unknown> {
  return loadPipeline("summarization", MODEL_ID, { dtype: "q8", sessionOptions: { graphOptimizationLevel: "disabled" } });
}
