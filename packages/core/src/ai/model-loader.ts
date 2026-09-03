import type { AllTasks, DataType, PipelineType, ProgressInfo } from "@huggingface/transformers";
import type { InferenceSession } from "onnxruntime-common";
import { detectAiCapabilities, isWebgpuAdapterAvailable } from "./capabilities";

export type ModelLoadStage =
  | { stage: "initiating"; file: string }
  | { stage: "downloading"; file: string; progressPct: number; loadedBytes: number; totalBytes: number }
  | { stage: "ready" };

export type ModelLoadProgressCallback = (info: ModelLoadStage) => void;

type TransformersModule = typeof import("@huggingface/transformers");

let transformersPromise: Promise<TransformersModule> | null = null;

/**
 * Transformers.js is a large (multi-hundred-KB) library that only matters
 * once a user actually opens an AI feature — a dynamic import keeps it out
 * of the app's normal load path, mirroring pdf.js's own lazy loadPdfjs().
 * Env config (no local filesystem models, browser Cache API for
 * already-downloaded models) is set exactly once, on first load.
 */
function loadTransformers(): Promise<TransformersModule> {
  transformersPromise ??= import("@huggingface/transformers").then((mod) => {
    mod.env.allowLocalModels = false;
    mod.env.useBrowserCache = true;
    // onnxruntime-web only has SharedArrayBuffer (and so only picks its
    // multi-threaded WASM binary) when the page is cross-origin isolated
    // (see vite.config.ts's COOP/COEP headers and staticwebapp.config.json's
    // matching production headers) — explicit here rather than trusting the
    // library's own default, since that default is a conservative constant
    // rather than a check of what's actually available in this specific
    // browser tab. Measured directly: a realistic 500-page document's
    // Summarize run — sequential per-chunk inference, the one part of "AI
    // at scale" that page-rendering's own virtualization can't help with —
    // took ~21 minutes single-threaded.
    if (globalThis.crossOriginIsolated && mod.env.backends.onnx.wasm) {
      mod.env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
    }
    return mod;
  });
  return transformersPromise;
}

function normalizeProgress(info: ProgressInfo, onProgress: ModelLoadProgressCallback): void {
  switch (info.status) {
    case "initiate":
      onProgress({ stage: "initiating", file: info.file });
      break;
    case "progress":
      onProgress({ stage: "downloading", file: info.file, progressPct: info.progress, loadedBytes: info.loaded, totalBytes: info.total });
      break;
    case "ready":
      onProgress({ stage: "ready" });
      break;
    // "download" (about to start a file) and "done" (one file finished) are
    // both already covered by the "progress" events surrounding them —
    // deliberately not forwarded to avoid noisy, redundant UI updates.
    default:
      break;
  }
}

export interface LoadPipelineOptions {
  onProgress?: ModelLoadProgressCallback;
  /**
   * Overrides Transformers.js's automatic per-device quantization choice.
   * Some models publish a broken export for one quantization level (see
   * summarize.ts, which pins "int8" — the default "q8" export for
   * Xenova/distilbart-cnn-6-6 fails to load with an ONNX Runtime error
   * about a missing dequantization scale) — this lets a caller work around
   * that on a per-model basis instead of guessing a global default.
   */
  dtype?: DataType;
  /** Passed straight through to onnxruntime-web as the session's SessionOptions — see summarize.ts for why. */
  sessionOptions?: InferenceSession.SessionOptions;
}

interface PipelineCacheEntry {
  promise: Promise<unknown>;
  /**
   * Every caller currently interested in this model's download progress —
   * not just whichever call happened to create this cache entry. A later
   * call (e.g. the user actually clicking "Summarize" after an eager
   * background preload already started the same download on dialog-open)
   * joins an in-flight promise and must still see progress, not silence.
   */
  progressListeners: Set<ModelLoadProgressCallback>;
}

const pipelineCache = new Map<string, PipelineCacheEntry>();

/**
 * `navigator.gpu` being present only means the WebGPU *API* exists, not
 * that a real adapter is obtainable — observed directly in a sandboxed
 * headless Chromium (capabilities.ts reports webgpu:true, but
 * `requestAdapter()` fails at runtime with "No available adapters"). Rather
 * than trying to perfectly predict that up front, loadPipeline always has a
 * real runtime fallback: if a WebGPU load fails with an adapter-shaped
 * error, it transparently retries on WASM instead of failing the feature.
 */
function isWebgpuAdapterError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /webgpu|gpu adapter|no available (backend|adapters)/i.test(message);
}

/**
 * Loads (or reuses an already-loaded) Transformers.js pipeline for the
 * given task+model, on the best available device (WebGPU when present and
 * actually usable, WASM otherwise). Cached by task+model — once a device
 * choice succeeds (including a WASM fallback after a WebGPU failure), later
 * calls for the same task+model reuse that same pipeline instance.
 */
export async function loadPipeline<T extends PipelineType>(task: T, model: string, options?: LoadPipelineOptions): Promise<AllTasks[T]> {
  const dtype = options?.dtype;
  const sessionOptions = options?.sessionOptions;
  const cacheKey = `${task}::${model}::${dtype ?? "auto"}::${JSON.stringify(sessionOptions ?? {})}`;
  const onProgress = options?.onProgress;

  const existing = pipelineCache.get(cacheKey);
  if (existing) {
    // Join the in-flight (or already-resolved) load. Registering here —
    // even after the download actually started — is what lets a caller
    // that arrives later than whoever created this entry still receive
    // progress, instead of only the first caller ever seeing it.
    if (onProgress) existing.progressListeners.add(onProgress);
    return existing.promise as Promise<AllTasks[T]>;
  }

  const progressListeners = new Set<ModelLoadProgressCallback>();
  if (onProgress) progressListeners.add(onProgress);

  const promise = (async () => {
    // detectAiCapabilities() is a fast synchronous heuristic (API presence
    // only); actually probing for a real adapter before picking WebGPU
    // avoids ever attempting a load we already know will fail downstream.
    const capabilities = detectAiCapabilities();
    const preferredDevice = capabilities.webgpu && (await isWebgpuAdapterAvailable()) ? "webgpu" : "wasm";

    const { pipeline } = await loadTransformers();
    // Always wired up (even when progressListeners starts empty, e.g. a
    // preload call with no onProgress) — fans out to whichever listeners
    // are registered *at event time*, so one added moments after this
    // pipeline() call kicks off still gets every subsequent event.
    const progressOptions = { progress_callback: (info: ProgressInfo) => progressListeners.forEach((listener) => normalizeProgress(info, listener)) };
    const dtypeOptions = dtype ? { dtype } : {};
    const sessionOptionsOptions = sessionOptions ? { session_options: sessionOptions } : {};
    try {
      return await pipeline(task, model, { device: preferredDevice, ...dtypeOptions, ...sessionOptionsOptions, ...progressOptions });
    } catch (error) {
      // Defense in depth: the adapter probe above should already prevent
      // this, but a WebGPU failure can still surface late (e.g. only once
      // the model actually runs) — fall back to WASM rather than failing
      // the whole feature.
      if (preferredDevice === "webgpu" && isWebgpuAdapterError(error)) {
        return await pipeline(task, model, { device: "wasm", ...dtypeOptions, ...sessionOptionsOptions, ...progressOptions });
      }
      throw error;
    }
  })();

  pipelineCache.set(cacheKey, { promise, progressListeners });
  // Don't cache a failed load — the next call should get a fresh retry, not a permanently-rejected promise.
  promise.catch(() => pipelineCache.delete(cacheKey));
  return promise as Promise<AllTasks[T]>;
}
