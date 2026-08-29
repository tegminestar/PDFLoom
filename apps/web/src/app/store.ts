import {
  PdfDocument,
  WebStorageAdapter,
  recentsStore,
  type OpenedFile,
  type OutlineNode,
  type RgbColor,
  type SearchMatch,
  type StampPreset,
} from "@pdfloom/core";
import { create } from "zustand";

export type FitMode = "width" | "page" | "custom";
export type PanelId = "thumbnails" | "outline" | "search" | null;
export type MainView = "read" | "organize";
export type AnnotateTool = "highlight" | "underline" | "strikeout" | "ink" | "square" | "circle" | "line" | "text" | "stamp";

export const ANNOTATE_COLOR_PRESETS: RgbColor[] = [
  { r: 1, g: 0.86, b: 0.2 }, // amber/yellow — default highlight
  { r: 0.95, g: 0.35, b: 0.35 }, // red
  { r: 0.3, g: 0.65, b: 0.95 }, // blue
  { r: 0.35, g: 0.75, b: 0.45 }, // green
  { r: 0.7, g: 0.45, b: 0.9 }, // purple
  { r: 0.15, g: 0.15, b: 0.18 }, // near-black
];

export interface DocumentMeta {
  id: string;
  name: string;
  sizeBytes: number;
  pageCount: number;
  handle: FileSystemFileHandle | null;
}

interface LoomState {
  storage: WebStorageAdapter;
  document: PdfDocument | null;
  meta: DocumentMeta | null;
  isLoading: boolean;
  loadError: string | null;

  currentPage: number;
  /**
   * Bumped only by explicit navigation (page-number entry, thumbnail/outline
   * click, search jump) — never by scroll-driven tracking. The Viewer
   * watches this (not `currentPage` itself) to decide when to actually
   * scroll the container, so it can't mistake "the user scrolled past page
   * 4" for "please scroll to page 4."
   */
  pageNavigationNonce: number;
  zoom: number;
  /** Scale computed by the Viewer from the container width when fitMode is "width"; the source of truth for display whenever fitMode !== "custom". */
  fitWidthScale: number;
  fitMode: FitMode;
  viewRotation: 0 | 90 | 180 | 270;

  activePanel: PanelId;
  outline: OutlineNode[];
  mainView: MainView;

  annotateOpen: boolean;
  annotateTool: AnnotateTool;
  annotateColor: RgbColor;
  annotateStampPreset: StampPreset;

  searchQuery: string;
  searchResults: SearchMatch[];
  isSearching: boolean;
  activeSearchIndex: number;

  openOpenedFile: (opened: OpenedFile) => Promise<void>;
  openViaPicker: () => Promise<void>;
  closeDocument: () => void;
  setMainView: (view: MainView) => void;
  /** Reloads the working document from newly mutated bytes (organize/edit operations) — updates page count, clamps the current page, and re-derives the outline. */
  applyPdfMutation: (newBytes: Uint8Array) => Promise<void>;

  setAnnotateOpen: (open: boolean) => void;
  setAnnotateTool: (tool: AnnotateTool) => void;
  setAnnotateColor: (color: RgbColor) => void;
  setAnnotateStampPreset: (preset: StampPreset) => void;

  /** Explicit navigation — e.g. from the page-number field, thumbnails, outline, or a search jump. Bumps `pageNavigationNonce`. */
  setCurrentPage: (page: number) => void;
  /** Scroll-driven observation only — updates the displayed page number without requesting a scroll. */
  syncVisiblePage: (page: number) => void;
  setZoom: (zoom: number) => void;
  setFitMode: (mode: FitMode) => void;
  setFitWidthScale: (scale: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  rotateView: (delta: 90 | -90) => void;

  setActivePanel: (panel: PanelId) => void;
  toggleActivePanel: (panel: Exclude<PanelId, null>) => void;

  setSearchQuery: (query: string) => void;
  runSearch: (query: string) => Promise<void>;
  goToSearchIndex: (index: number) => void;
  clearSearch: () => void;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.1;

export const useLoomStore = create<LoomState>((set, get) => ({
  storage: new WebStorageAdapter(),
  document: null,
  meta: null,
  isLoading: false,
  loadError: null,

  currentPage: 1,
  pageNavigationNonce: 0,
  zoom: 1,
  fitWidthScale: 1,
  fitMode: "width",
  viewRotation: 0,

  activePanel: null,
  outline: [],
  mainView: "read",

  annotateOpen: false,
  annotateTool: "highlight",
  annotateColor: ANNOTATE_COLOR_PRESETS[0]!,
  annotateStampPreset: "approved",

  searchQuery: "",
  searchResults: [],
  isSearching: false,
  activeSearchIndex: -1,

  openOpenedFile: async (opened) => {
    get().document?.destroy();
    set({ isLoading: true, loadError: null, document: null, meta: null });
    try {
      const doc = await PdfDocument.load(opened.bytes);
      const meta: DocumentMeta = {
        id: opened.id,
        name: opened.name,
        sizeBytes: opened.sizeBytes,
        pageCount: doc.pageCount,
        handle: opened.handle,
      };
      const outline = await doc.getOutline();
      set((s) => ({
        document: doc,
        meta,
        outline,
        isLoading: false,
        currentPage: 1,
        pageNavigationNonce: s.pageNavigationNonce + 1,
        zoom: 1,
        fitMode: "width",
        viewRotation: 0,
        searchQuery: "",
        searchResults: [],
        activeSearchIndex: -1,
        mainView: "read",
      }));
      void recentsStore.record(
        {
          id: meta.id,
          name: meta.name,
          sizeBytes: meta.sizeBytes,
          pageCount: meta.pageCount,
          lastOpenedAt: Date.now(),
          hasFileHandle: meta.handle !== null,
        },
        meta.handle,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.name === "PasswordException"
            ? "This PDF is password-protected. Password support is coming in a later milestone."
            : error.message
          : "Failed to open this file.";
      set({ isLoading: false, loadError: message });
    }
  },

  openViaPicker: async () => {
    const opened = await get().storage.openFilePicker();
    if (opened) await get().openOpenedFile(opened);
  },

  closeDocument: () => {
    get().document?.destroy();
    set({
      document: null,
      meta: null,
      outline: [],
      loadError: null,
      searchQuery: "",
      searchResults: [],
      activeSearchIndex: -1,
      activePanel: null,
      mainView: "read",
      annotateOpen: false,
    });
  },

  setMainView: (mainView) => set({ mainView, annotateOpen: false }),
  setAnnotateOpen: (annotateOpen) => set({ annotateOpen }),
  setAnnotateTool: (annotateTool) => set({ annotateTool }),
  setAnnotateColor: (annotateColor) => set({ annotateColor }),
  setAnnotateStampPreset: (annotateStampPreset) => set({ annotateStampPreset }),

  applyPdfMutation: async (newBytes) => {
    const { document: oldDoc, meta } = get();
    if (!oldDoc || !meta) return;
    const newDoc = await PdfDocument.load(newBytes);
    oldDoc.destroy();
    const outline = await newDoc.getOutline();
    set((s) => ({
      document: newDoc,
      meta: { ...meta, pageCount: newDoc.pageCount },
      outline,
      currentPage: Math.min(s.currentPage, newDoc.pageCount),
      pageNavigationNonce: s.pageNavigationNonce + 1,
    }));
  },

  setCurrentPage: (page) => {
    const count = get().meta?.pageCount ?? 1;
    set((s) => ({
      currentPage: Math.min(Math.max(1, page), count),
      pageNavigationNonce: s.pageNavigationNonce + 1,
    }));
  },

  syncVisiblePage: (page) => {
    const count = get().meta?.pageCount ?? 1;
    set({ currentPage: Math.min(Math.max(1, page), count) });
  },

  setZoom: (zoom) => set({ zoom: Math.min(Math.max(MIN_ZOOM, zoom), MAX_ZOOM), fitMode: "custom" }),
  setFitMode: (fitMode) => set((s) => ({ fitMode, zoom: fitMode === "custom" ? s.zoom : s.fitWidthScale })),
  setFitWidthScale: (fitWidthScale) => set({ fitWidthScale }),
  zoomIn: () =>
    set((s) => {
      const current = s.fitMode === "custom" ? s.zoom : s.fitWidthScale;
      return { zoom: Math.min(MAX_ZOOM, current + ZOOM_STEP), fitMode: "custom" };
    }),
  zoomOut: () =>
    set((s) => {
      const current = s.fitMode === "custom" ? s.zoom : s.fitWidthScale;
      return { zoom: Math.max(MIN_ZOOM, current - ZOOM_STEP), fitMode: "custom" };
    }),
  rotateView: (delta) =>
    set((s) => ({ viewRotation: ((s.viewRotation + delta + 360) % 360) as 0 | 90 | 180 | 270 })),

  setActivePanel: (panel) => set({ activePanel: panel }),
  toggleActivePanel: (panel) => set((s) => ({ activePanel: s.activePanel === panel ? null : panel })),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  runSearch: async (query) => {
    const doc = get().document;
    if (!doc) return;
    set({ isSearching: true, searchQuery: query, searchResults: [], activeSearchIndex: -1 });
    const results = await doc.search(query);
    // Guard against a stale search resolving after the query changed again.
    if (get().searchQuery !== query) return;
    set((s) => ({
      searchResults: results,
      isSearching: false,
      activeSearchIndex: results.length > 0 ? 0 : -1,
      currentPage: results.length > 0 ? results[0]!.pageNumber : s.currentPage,
      pageNavigationNonce: results.length > 0 ? s.pageNavigationNonce + 1 : s.pageNavigationNonce,
    }));
  },

  goToSearchIndex: (index) => {
    const { searchResults } = get();
    if (index < 0 || index >= searchResults.length) return;
    set((s) => ({
      activeSearchIndex: index,
      currentPage: searchResults[index]!.pageNumber,
      pageNavigationNonce: s.pageNavigationNonce + 1,
    }));
  },

  clearSearch: () => set({ searchQuery: "", searchResults: [], activeSearchIndex: -1, isSearching: false }),
}));
