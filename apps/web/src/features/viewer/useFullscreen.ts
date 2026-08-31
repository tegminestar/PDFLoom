import { useEffect, useState } from "react";

/**
 * Shared so every entry point (toolbar button, command palette) toggles the
 * same way and reflects the real state — each call site gets its own
 * `fullscreenchange` listener, so all of them stay in sync regardless of
 * which one (or the browser's own Escape handling) actually changed it.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };
  return { isFullscreen, toggle };
}
