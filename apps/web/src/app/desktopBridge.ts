import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** True only inside the Tauri desktop shell — false for every web deployment (including this exact same bundle served over HTTP). */
export const isDesktopShell: boolean = isTauri();

async function readFileFromPath(path: string): Promise<File> {
  const bytes = await invoke<number[]>("read_file_bytes", { path });
  const name = path.split(/[\\/]/).pop() ?? path;
  return new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
}

/**
 * Bridges the desktop shell's "Open With PDFLoom" / double-click-a-PDF
 * launch path into the same document-open flow drag-and-drop already uses.
 *
 * Two delivery paths from the Rust side (see apps/desktop/src-tauri/src/lib.rs):
 * - `take_pending_open_path` — the file this exact process was launched
 *   with, read once here since by the time this runs the frontend has
 *   already mounted and can act on it immediately.
 * - the `pdfloom://open-file` event — fired when a *second* launch (e.g.
 *   double-clicking another PDF while PDFLoom is already open) gets
 *   redirected into this already-running instance instead of spawning a
 *   new window; the app is already up by then, so this is a live event
 *   rather than something to poll for.
 *
 * A no-op outside the desktop shell (isDesktopShell is false), so this is
 * always safe to call unconditionally from the web build too.
 */
export function initDesktopFileOpen(onFile: (file: File) => void): () => void {
  if (!isDesktopShell) return () => {};

  let cancelled = false;
  void invoke<string | null>("take_pending_open_path")
    .catch(() => null)
    .then(async (path) => {
      if (!path || cancelled) return;
      const file = await readFileFromPath(path).catch(() => null);
      if (file && !cancelled) onFile(file);
    });

  let unlisten: (() => void) | null = null;
  void listen<string>("pdfloom://open-file", (event) => {
    void readFileFromPath(event.payload).then((file) => {
      if (!cancelled) onFile(file);
    });
  }).then((stop) => {
    if (cancelled) stop();
    else unlisten = stop;
  });

  return () => {
    cancelled = true;
    unlisten?.();
  };
}

export interface DesktopUpdate {
  version: string;
  body?: string;
  /** Downloads and installs the update, then relaunches the app into it — the only way an installed build ever picks up a fix, since there's no other update path. */
  install: () => Promise<void>;
}

/**
 * Checks GitHub's "latest release" for a newer version than the one running.
 * A no-op (resolves null) outside the desktop shell, and on any failure —
 * offline, GitHub unreachable, no *published* (non-draft) release yet —
 * since a failed check should never interrupt someone just trying to edit a
 * PDF. See release-desktop.yml: the endpoint only ever resolves once a
 * release is published, not while it's still a draft.
 */
export async function checkForDesktopUpdate(): Promise<DesktopUpdate | null> {
  if (!isDesktopShell) return null;
  try {
    const update = await check();
    if (!update?.available) return null;
    return {
      version: update.version,
      body: update.body,
      install: () => installDesktopUpdate(update),
    };
  } catch {
    return null;
  }
}

async function installDesktopUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall();
  await relaunch();
}
