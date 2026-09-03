/**
 * Thin wrapper around Plausible's custom-events API (window.plausible,
 * injected by the tagged-events script tag in index.html). Never sends
 * document content, filenames, or any user-identifying data — only a
 * feature name and small non-sensitive props, consistent with the "your
 * files never leave your device" claim on the landing page/FAQ. A no-op
 * when Plausible hasn't loaded (dev, ad-blockers, script failed) so call
 * sites never need to guard for it themselves.
 */
declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string | number | boolean> }) => void;
  }
}

export function trackEvent(eventName: string, props?: Record<string, string | number | boolean>): void {
  try {
    window.plausible?.(eventName, props ? { props } : undefined);
  } catch {
    // Analytics must never break the app it's measuring.
  }
}
