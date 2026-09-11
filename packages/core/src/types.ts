export interface PageViewport {
  width: number;
  height: number;
}

export interface OutlineNode {
  title: string;
  pageNumber: number | null;
  items: OutlineNode[];
}

export interface SearchMatch {
  pageNumber: number;
  /** Character offset of the match within that page's extracted text. */
  startIndex: number;
  matchedText: string;
  /** A short snippet of surrounding text, for showing in a results list. */
  contextSnippet: string;
}

export interface RecentFileEntry {
  id: string;
  name: string;
  sizeBytes: number;
  lastOpenedAt: number;
  pageCount: number;
  /** Present only when the browser granted a persistable File System Access handle. */
  hasFileHandle: boolean;
  /** Pinned files are exempt from MAX_RECENTS eviction and surface in their own section — a lightweight "workspace" of files the user is actively working with, distinct from the plain most-recently-opened list. */
  pinned?: boolean;
  /** Freeform local labels for organizing recents into ad-hoc groupings (e.g. "RFP-2026", "Acme contract") — entirely local, never synced anywhere. */
  tags?: string[];
  /** The page the reader was on when this file was last open — reopening the same file (by name+size, not just via the Recent list) resumes here instead of always restarting at page 1. */
  lastPageNumber?: number;
}
