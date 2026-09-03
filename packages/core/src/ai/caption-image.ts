import type { ImageToTextPipeline } from "@huggingface/transformers";
import { loadPipeline, type ModelLoadProgressCallback } from "./model-loader";

const MODEL_ID = "Xenova/vit-gpt2-image-captioning";

export interface CaptionImageOptions {
  onProgress?: (info: { stage: "loading-model"; detail: Parameters<ModelLoadProgressCallback>[0] } | { stage: "captioning" }) => void;
}

/**
 * Generates a short caption for an image with a small local image-to-text
 * model, entirely in-browser — used to suggest alt text for images found
 * in a PDF (see accessibility.ts). Accepts anything Transformers.js's
 * RawImage can load: a Blob, an HTMLCanvasElement, or a URL.
 */
export async function captionImage(image: Blob | HTMLCanvasElement | string, options?: CaptionImageOptions): Promise<string> {
  const onProgress = options?.onProgress;
  const captioner = await loadPipeline("image-to-text", MODEL_ID, {
    dtype: "q8",
    // Same class of onnxruntime-web WASM bug seen across every other
    // encoder-decoder model in this app so far — applied preemptively
    // rather than waiting to rediscover it (see the AI-infra memory notes).
    sessionOptions: { graphOptimizationLevel: "disabled" },
    ...(onProgress ? { onProgress: (detail: Parameters<ModelLoadProgressCallback>[0]) => onProgress({ stage: "loading-model", detail }) } : {}),
  });

  onProgress?.({ stage: "captioning" });
  const output = await (captioner as ImageToTextPipeline)(image);
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== "object" || !("generated_text" in first)) {
    throw new Error("The captioning model returned an unexpected result shape.");
  }
  return (first as { generated_text: string }).generated_text.trim();
}

/** Starts downloading the captioning model before any image is actually captioned — call the moment the alt-text UI opens. Options must match captionImage's own loadPipeline call exactly, or this warms a different cache entry. */
export function preloadCaptionModel(): Promise<unknown> {
  return loadPipeline("image-to-text", MODEL_ID, { dtype: "q8", sessionOptions: { graphOptimizationLevel: "disabled" } });
}
