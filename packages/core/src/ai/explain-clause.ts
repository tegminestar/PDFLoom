import type { Text2TextGenerationPipeline } from "@huggingface/transformers";
import { loadPipeline, type ModelLoadProgressCallback } from "./model-loader";

const MODEL_ID = "Xenova/LaMini-Flan-T5-248M";

// Roughly this model's practical input ceiling before quality degrades —
// "explain this clause" is meant for a highlighted passage, not a whole
// document (that's what Summarize is for), so this is a hard cap with an
// honest error rather than silently truncating.
const MAX_INPUT_WORDS = 400;

export type ExplainClauseStage = { stage: "loading-model"; detail: Parameters<ModelLoadProgressCallback>[0] } | { stage: "explaining" };

export interface ExplainClauseOptions {
  onProgress?: (info: ExplainClauseStage) => void;
}

/**
 * Explains a highlighted passage (a contract/legal clause, or any dense
 * text) in plain language, using a small local instruction-tuned model —
 * entirely in-browser. This is NOT legal advice and the result is a
 * best-effort paraphrase from a ~250M-parameter model, not a substitute
 * for a lawyer — the UI must say so explicitly (see ExplainClauseDialog),
 * matching the plan's honesty-flag requirement for this exact feature.
 *
 * Prompt phrasing matters more than usual for a model this small — "What
 * does this mean in plain English?" was verified (against real model
 * output, not assumed) to produce a genuine paraphrase; a more
 * instruction-heavy phrasing ("Rewrite this in simple language...") tended
 * to produce a closer-to-verbatim restatement instead.
 */
export async function explainClause(text: string, options?: ExplainClauseOptions): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > MAX_INPUT_WORDS) {
    throw new Error(`This passage is too long to explain at once (${wordCount} words, limit ${MAX_INPUT_WORDS}) — try a shorter selection.`);
  }

  const onProgress = options?.onProgress;
  const generator = await loadPipeline("text2text-generation", MODEL_ID, {
    dtype: "q8",
    // Same tied-embedding/merged-decoder onnxruntime-web WASM bug as
    // summarize.ts/translate.ts's models — see the AI-infra memory notes.
    sessionOptions: { graphOptimizationLevel: "disabled" },
    ...(onProgress ? { onProgress: (detail: Parameters<ModelLoadProgressCallback>[0]) => onProgress({ stage: "loading-model", detail }) } : {}),
  });

  onProgress?.({ stage: "explaining" });
  const prompt = `What does this mean in plain English? "${trimmed}"`;
  const output = await (generator as Text2TextGenerationPipeline)(prompt, { max_new_tokens: 150 });
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== "object" || !("generated_text" in first)) {
    throw new Error("The explanation model returned an unexpected result shape.");
  }
  return (first as { generated_text: string }).generated_text.trim();
}

/** Starts downloading the explain-clause model before any text is selected — call the moment that UI opens. Options must match explainClause's own loadPipeline call exactly, or this warms a different cache entry. */
export function preloadExplainClauseModel(): Promise<unknown> {
  return loadPipeline("text2text-generation", MODEL_ID, { dtype: "q8", sessionOptions: { graphOptimizationLevel: "disabled" } });
}
