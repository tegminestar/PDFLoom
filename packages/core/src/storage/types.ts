export interface OpenedFile {
  id: string;
  name: string;
  sizeBytes: number;
  bytes: Uint8Array;
  /** Only present on browsers supporting the File System Access API (Chromium-family). */
  handle: FileSystemFileHandle | null;
}

export interface StorageCapabilities {
  fileSystemAccess: boolean;
  persistentStorage: boolean;
}

export interface StorageAdapter {
  readonly capabilities: StorageCapabilities;

  /** Opens the browser's native file picker filtered to PDFs. Resolves to null if the user cancels. */
  openFilePicker(): Promise<OpenedFile | null>;

  /** Reads a File already obtained via drag-and-drop or an <input type=file>. */
  openFromFile(file: File, handle?: FileSystemFileHandle): Promise<OpenedFile>;

  /**
   * Persists bytes back to disk. If `file` carries a writable handle, saves
   * in place silently; otherwise falls back to triggering a browser download
   * with `suggestedName`.
   */
  save(bytes: Uint8Array, suggestedName: string, handle?: FileSystemFileHandle | null): Promise<void>;

  /** Always prompts for a new location/name (native save dialog where supported, otherwise a download). */
  saveAs(bytes: Uint8Array, suggestedName: string): Promise<FileSystemFileHandle | null>;
}
