import { detectAiCapabilities, isWebgpuAdapterAvailable } from "./capabilities";

// The smallest general-purpose instruct model WebLLM ships prebuilt
// compiled weights for — matches this app's "small local model" ethos for
// every other AI feature. WebLLM (unlike Transformers.js) has no WASM/CPU
// fallback at all: it compiles/runs models as WebGPU compute shaders, so
// there is no smaller-but-slower path to fall back to the way summarize.ts
// etc. can fall back from WebGPU to WASM.
const CHAT_MODEL_ID = "SmolLM2-360M-Instruct-q4f16_1-MLC";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type ChatLoadStage = { stage: "unavailable"; reason: string } | { stage: "loading-model"; progressText: string } | { stage: "ready" };

export interface WebLlmChatOptions {
  onProgress?: (info: ChatLoadStage) => void;
}

/**
 * Whether an in-browser chat model can realistically run here at all —
 * checks the same real WebGPU adapter probe every other AI feature in this
 * app uses (capabilities.ts), not just API presence. Call this BEFORE
 * attempting to load WebLLM, so an unsupported device gets an honest,
 * immediate "not available" message instead of a doomed multi-hundred-MB
 * download attempt. Chat/RAG and the AI command bar both gate on this.
 */
export async function isChatAvailable(): Promise<boolean> {
  const capabilities = detectAiCapabilities();
  if (!capabilities.webgpu) return false;
  return isWebgpuAdapterAvailable();
}

type MLCEngineLike = {
  chat: {
    completions: {
      create(args: { messages: ChatMessage[]; temperature?: number; max_tokens?: number }): Promise<{ choices: { message: { content: string | null } }[] }>;
    };
  };
};

let enginePromise: Promise<MLCEngineLike> | null = null;
// Every caller currently interested in load progress — not just whichever
// call happened to create enginePromise. Without this, a later call (e.g.
// the user hitting Send right after an eager preload already started the
// same download on dialog-open) joins the in-flight promise but never
// hears a single progress update, since CreateMLCEngine only takes one
// initProgressCallback, fixed at creation time.
const progressListeners = new Set<(info: ChatLoadStage) => void>();

/**
 * Lazily creates (or reuses) the shared WebLLM chat engine. Always call
 * isChatAvailable() first — this still has its own WebGPUNotAvailableError/
 * WebGPUNotFoundError handling as defense in depth (mirrors
 * model-loader.ts's WebGPU-adapter catch-and-handle pattern for
 * Transformers.js), but the point of isChatAvailable() is to avoid ever
 * reaching this at all on an unsupported device.
 */
async function loadEngine(options?: WebLlmChatOptions): Promise<MLCEngineLike> {
  if (options?.onProgress) progressListeners.add(options.onProgress);
  if (enginePromise) return enginePromise;

  enginePromise = (async () => {
    const webllm = await import("@mlc-ai/web-llm");
    try {
      const engine = await webllm.CreateMLCEngine(CHAT_MODEL_ID, {
        initProgressCallback: (report) => progressListeners.forEach((listener) => listener({ stage: "loading-model", progressText: report.text })),
      });
      progressListeners.forEach((listener) => listener({ stage: "ready" }));
      return engine as unknown as MLCEngineLike;
    } catch (error) {
      // WebGPUNotAvailableError/WebGPUNotFoundError exist inside the
      // package but aren't part of its public export surface (confirmed
      // by reading its own index.d.ts) — matching on error.name is the
      // only way to identify them from outside, not instanceof.
      const name = error instanceof Error ? error.name : "";
      if (name === "WebGPUNotAvailableError" || name === "WebGPUNotFoundError") {
        throw new Error("This browser/device doesn't support WebGPU, which local AI chat requires. Every other PDFLoom AI feature still works.");
      }
      throw error;
    }
  })();
  enginePromise.catch(() => {
    enginePromise = null;
  });
  return enginePromise;
}

/** Sends a full message history to the local chat model and returns its reply. Caller owns history/context construction (see rag.ts for building a "answer from these excerpts" system prompt). */
export async function sendChatMessage(messages: ChatMessage[], options?: WebLlmChatOptions): Promise<string> {
  const engine = await loadEngine(options);
  const response = await engine.chat.completions.create({ messages, temperature: 0.3, max_tokens: 400 });
  return response.choices[0]?.message.content?.trim() ?? "";
}

/**
 * Starts downloading/compiling the chat engine without sending any message
 * — call this the moment chat is confirmed available (isChatAvailable) so
 * this multi-hundred-MB download overlaps with the user reading/typing
 * their first question instead of only starting once they hit send.
 * loadEngine's own cache means sendChatMessage transparently reuses this
 * same in-flight or completed load.
 */
export function preloadChatModel(options?: WebLlmChatOptions): Promise<unknown> {
  return loadEngine(options);
}
