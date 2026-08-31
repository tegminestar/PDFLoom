import type { OpenedFile, StorageAdapter, StorageCapabilities } from "./types";

function hasFileSystemAccess(): boolean {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function fileToOpenedFile(file: File, handle: FileSystemFileHandle | null): Promise<OpenedFile> {
  const buffer = await file.arrayBuffer();
  return {
    id: makeId(),
    name: file.name,
    sizeBytes: file.size,
    bytes: new Uint8Array(buffer),
    handle,
  };
}

function triggerDownload(bytes: Uint8Array, filename: string): void {
  // Cast needed: Uint8Array's `buffer` is typed ArrayBufferLike (which
  // includes SharedArrayBuffer) under this TS lib, while BlobPart requires
  // a plain ArrayBuffer-backed view — bytes here always come from
  // arrayBuffer()/file reads, never a SharedArrayBuffer.
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has already started.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts = { mode: "readwrite" } as const;
  const existing = await handle.queryPermission(opts);
  if (existing === "granted") return true;
  const requested = await handle.requestPermission(opts);
  return requested === "granted";
}

export class WebStorageAdapter implements StorageAdapter {
  readonly capabilities: StorageCapabilities;

  constructor() {
    this.capabilities = {
      fileSystemAccess: hasFileSystemAccess(),
      persistentStorage: typeof navigator !== "undefined" && !!navigator.storage?.persist,
    };
  }

  async openFilePicker(): Promise<OpenedFile | null> {
    if (this.capabilities.fileSystemAccess) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
        });
        if (!handle) return null;
        const file = await handle.getFile();
        return fileToOpenedFile(file, handle);
      } catch (error) {
        // AbortError = user cancelled the picker; treat as "no file chosen."
        if (error instanceof DOMException && error.name === "AbortError") return null;
        throw error;
      }
    }

    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/pdf,.pdf";
      input.addEventListener(
        "change",
        () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          fileToOpenedFile(file, null).then(resolve);
        },
        { once: true },
      );
      // Firefox/Safari fire no cancel event reliably; resolve(null) never fires
      // in that path, which just leaves the caller's picker promise pending —
      // acceptable since the UI stays exactly as it was before the click.
      input.click();
    });
  }

  async openFromFile(file: File, handle?: FileSystemFileHandle): Promise<OpenedFile> {
    return fileToOpenedFile(file, handle ?? null);
  }

  async save(bytes: Uint8Array, suggestedName: string, handle?: FileSystemFileHandle | null): Promise<void> {
    if (handle) {
      const permitted = await ensureWritePermission(handle);
      if (permitted) {
        const writable = await handle.createWritable();
        await writable.write(bytes as BufferSource);
        await writable.close();
        return;
      }
    }
    triggerDownload(bytes, suggestedName);
  }

  /**
   * Note: a user cancelling the native save picker throws a DOMException
   * named "AbortError" rather than resolving — this used to be swallowed
   * into a `null` return, indistinguishable from the "no File System
   * Access support, fell back to a real download" case (also `null`),
   * which made every caller show a false "success" toast on cancel.
   * Callers should catch AbortError specifically and treat it as neither
   * success nor failure — see OrganizeView's handleExtract for the pattern.
   */
  async saveAs(bytes: Uint8Array, suggestedName: string): Promise<FileSystemFileHandle | null> {
    if (this.capabilities.fileSystemAccess) {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes as BufferSource);
      await writable.close();
      return handle;
    }
    triggerDownload(bytes, suggestedName);
    return null;
  }
}
