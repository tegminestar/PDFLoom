import * as Comlink from "comlink";
import type { PdfWorkerApi } from "./pdf-worker";

export type { PdfWorkerApi };

let clientPromise: Promise<Comlink.Remote<PdfWorkerApi>> | null = null;

/**
 * Lazily spins up (once) a dedicated Worker running packages/core's
 * pdf-lib-based organize + annotation operations, and returns a
 * Comlink-proxied client for it. All methods on the returned object are
 * async, mirroring pdf/organize.ts's and pdf/annotations.ts's exports.
 */
export function getPdfWorkerClient(): Promise<Comlink.Remote<PdfWorkerApi>> {
  clientPromise ??= (async () => {
    const worker = new Worker(new URL("./pdf-worker.ts", import.meta.url), { type: "module" });
    return Comlink.wrap<PdfWorkerApi>(worker);
  })();
  return clientPromise;
}
