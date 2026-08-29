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
}
