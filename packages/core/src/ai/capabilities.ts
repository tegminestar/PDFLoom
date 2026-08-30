export interface AiCapabilities {
  /** Whether the browser exposes WebGPU — Transformers.js runs meaningfully faster on it than WASM. */
  webgpu: boolean;
  /** WASM is the universal fallback; every browser this app targets supports it. */
  wasm: boolean;
  recommendedDevice: "webgpu" | "wasm";
  /** Rough device memory in GB, when the browser exposes it (Chromium-only, `navigator.deviceMemory`) — used to warn before a large model download, not to block it outright (the API is coarse and absent on Firefox/Safari). */
  deviceMemoryGb: number | null;
}

/**
 * AI features degrade gracefully rather than failing silently: callers
 * check this before offering a capability, and show why it's unavailable
 * instead of a broken button. See the plan's "honesty flags" requirement —
 * this is the mandatory feature-detection gate for every AI feature.
 */
export function detectAiCapabilities(): AiCapabilities {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const webgpu = typeof nav !== "undefined" && "gpu" in nav && nav.gpu != null;
  const deviceMemoryGb = nav && "deviceMemory" in nav ? ((nav as unknown as { deviceMemory?: number }).deviceMemory ?? null) : null;

  return {
    webgpu,
    wasm: true,
    recommendedDevice: webgpu ? "webgpu" : "wasm",
    deviceMemoryGb,
  };
}

let webgpuAdapterProbe: Promise<boolean> | null = null;

/**
 * `navigator.gpu` existing only means the WebGPU *API* is present, not that
 * a real adapter is obtainable — observed directly in a sandboxed headless
 * Chromium, where the API exists but `requestAdapter()` rejects with "No
 * available adapters." This actually asks for one (cached after the first
 * call, since availability doesn't change mid-session) — use it before
 * committing to WebGPU for a model load, rather than trusting the
 * synchronous, API-presence-only check above.
 */
export async function isWebgpuAdapterAvailable(): Promise<boolean> {
  webgpuAdapterProbe ??= (async () => {
    try {
      const nav = typeof navigator !== "undefined" ? navigator : undefined;
      if (!nav || !("gpu" in nav) || !nav.gpu) return false;
      const adapter = await nav.gpu.requestAdapter();
      return adapter != null;
    } catch {
      return false;
    }
  })();
  return webgpuAdapterProbe;
}
