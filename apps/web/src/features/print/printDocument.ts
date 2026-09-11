import { toast } from "@pdfloom/ui";
import { useLoomStore } from "../../app/store";

const CLEANUP_DELAY_MS = 60_000; // generous window to interact with the native print dialog before reclaiming the iframe/blob URL.

/**
 * Prints the currently open document via a hidden iframe loading the
 * document's own real PDF bytes as a blob URL, so the browser's native PDF
 * viewer (and its print pipeline) renders and prints it — full vector
 * fidelity, not a rasterized screenshot of rendered canvases.
 *
 * Deliberately not `window.print()` on the app's own page: that would print
 * whatever app chrome (toolbars, rails, dialogs) happens to be visible
 * instead of the document. This is also why Ctrl/Cmd+P is intercepted
 * app-wide (see App.tsx's keyboard shortcut handler) — the browser default
 * for that shortcut is exactly the broken behavior this avoids.
 */
export async function printDocument(): Promise<void> {
  const doc = useLoomStore.getState().document;
  if (!doc) {
    toast.warning("Nothing to print", "Open a document first.");
    return;
  }
  try {
    const bytes = await doc.getRawBytes();
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const iframe = window.document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.src = url;
    iframe.onload = () => {
      // Some browsers need a beat after load before the embedded PDF
      // viewer is actually ready to accept a print() call.
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      }, 250);
    };
    window.document.body.appendChild(iframe);
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(url);
    }, CLEANUP_DELAY_MS);
  } catch (error) {
    toast.error("Couldn't print this document", error instanceof Error ? error.message : undefined);
  }
}
