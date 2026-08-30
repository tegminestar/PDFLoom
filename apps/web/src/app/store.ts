import {
  PdfDocument,
  WebStorageAdapter,
  getPdfWorkerClient,
  recentsStore,
  type FormFieldInfo,
  type FormFieldValue,
  type OpenedFile,
  type OutlineNode,
  type Rect,
  type RgbColor,
  type SearchMatch,
  type StampPreset,
} from "@pdfloom/core";
import { create } from "zustand";

export type FitMode = "width" | "page" | "custom";
export type PanelId = "thumbnails" | "outline" | "search" | null;
export type MainView = "read" | "organize";
export type AnnotateTool = "highlight" | "underline" | "strikeout" | "ink" | "square" | "circle" | "line" | "text" | "stamp";
export type FormMode = "fill" | "design";
export type FieldDesignTool = "text" | "checkbox" | "radio" | "dropdown";
export type EditTool = "text" | "image";
export interface PendingRedaction {
  pageIndex: number;
  rect: Rect;
}

export type SignPlacementKind = "signature" | "initials" | "date" | "timestamp";
export interface SignatureAsset {
  kind: "typed" | "image";
  text?: string;
  imageBytes?: Uint8Array;
  imageType?: "png" | "jpg";
  /** width/height, for image assets — used to size a sensible default placement rect. */
  aspectRatio?: number;
}

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
  /** Set when opening a file throws pdf.js's PasswordException — the file is held here (not opened yet) until submitPassword/cancelPasswordPrompt resolves it. */
  passwordPromptOpen: boolean;
  pendingOpenFile: OpenedFile | null;
  passwordError: string | null;

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

  formFillOpen: boolean;
  formFields: FormFieldInfo[];
  formFieldValues: Record<string, FormFieldValue>;
  isSavingForm: boolean;
  /** Only meaningful while formFillOpen — "fill" shows the interactive input overlay, "design" shows the click-to-place field palette. */
  formMode: FormMode;
  formDesignTool: FieldDesignTool | null;

  /** Best-effort content edit mode: covers existing text/images with new content rather than truly rewriting the page's content stream. */
  editOpen: boolean;
  editTool: EditTool;

  /** True redaction mode: draw boxes across any pages, then apply — each affected page is rasterized and replaced wholesale (see redact.ts) so nothing under a box survives. */
  redactOpen: boolean;
  redactBoxes: PendingRedaction[];
  isApplyingRedactions: boolean;

  /** E-signature mode: create a signature/initials once (draw/type/upload), then click anywhere to stamp it — or place a date/signed-timestamp mark directly, no creation step needed. */
  signOpen: boolean;
  signPlacementKind: SignPlacementKind | null;
  activeSignature: SignatureAsset | null;
  activeInitials: SignatureAsset | null;
  signerName: string;
  includeIntegrityHash: boolean;
  isPlacingSignature: boolean;

  searchQuery: string;
  searchResults: SearchMatch[];
  isSearching: boolean;
  activeSearchIndex: number;

  openOpenedFile: (opened: OpenedFile) => Promise<void>;
  /** Retries opening the file currently held in pendingOpenFile with the given password. */
  submitPassword: (password: string) => Promise<void>;
  cancelPasswordPrompt: () => void;
  openViaPicker: () => Promise<void>;
  closeDocument: () => void;
  setMainView: (view: MainView) => void;
  /** Reloads the working document from newly mutated bytes (organize/edit operations) — updates page count, clamps the current page, and re-derives the outline. */
  applyPdfMutation: (newBytes: Uint8Array) => Promise<void>;

  setAnnotateOpen: (open: boolean) => void;
  setAnnotateTool: (tool: AnnotateTool) => void;
  setAnnotateColor: (color: RgbColor) => void;
  setAnnotateStampPreset: (preset: StampPreset) => void;

  /** Enters/exits form-fill mode; opening fetches the document's fields and seeds `formFieldValues` from their current values. */
  setFormFillOpen: (open: boolean) => Promise<void>;
  setFormFieldValue: (name: string, value: FormFieldValue) => void;
  /** Writes `formFieldValues` back into the document via fillFormFields, optionally flattening, then exits form-fill mode. */
  saveFormValues: (flatten: boolean) => Promise<void>;
  setFormMode: (mode: FormMode) => void;
  setFormDesignTool: (tool: FieldDesignTool | null) => void;
  /** Re-fetches `formFields` from the current document (and seeds any newly-discovered field into `formFieldValues`) — called after the field designer places a new field, so the fill overlay/count reflect it immediately. */
  refreshFormFields: () => Promise<void>;

  setEditOpen: (open: boolean) => void;
  setEditTool: (tool: EditTool) => void;

  setRedactOpen: (open: boolean) => void;
  addRedactBox: (pageIndex: number, rect: Rect) => void;
  removeRedactBox: (index: number) => void;
  clearRedactBoxes: () => void;
  /** Rasterizes every page with pending boxes (needs a real <canvas>, so the actual rendering is done by the caller/UI and passed in) and applies the redaction, replacing the open document. */
  applyRedactions: (renderedPages: Map<number, { widthPt: number; heightPt: number; jpegBytes: Uint8Array }>) => Promise<void>;

  setSignOpen: (open: boolean) => void;
  setSignPlacementKind: (kind: SignPlacementKind | null) => void;
  saveSignatureAsset: (slot: "signature" | "initials", asset: SignatureAsset) => void;
  setSignerName: (name: string) => void;
  setIncludeIntegrityHash: (value: boolean) => void;
  /** Places whatever signPlacementKind currently is at the given page/rect — dispatches to the matching worker call. */
  placeSignatureAt: (pageIndex: number, rect: Rect) => Promise<void>;

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

type LoomSetter = (partial: Partial<LoomState> | ((s: LoomState) => Partial<LoomState>)) => void;

/** Shared success path for openOpenedFile and submitPassword — resetting view state and recording the file in Recents is identical whether or not a password was needed. */
async function finishOpeningDocument(set: LoomSetter, opened: OpenedFile, doc: PdfDocument): Promise<void> {
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
    annotateOpen: false,
    formFillOpen: false,
    formFields: [],
    formFieldValues: {},
    editOpen: false,
    redactOpen: false,
    redactBoxes: [],
    signOpen: false,
    signPlacementKind: null,
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
}

export const useLoomStore = create<LoomState>((set, get) => ({
  storage: new WebStorageAdapter(),
  document: null,
  meta: null,
  isLoading: false,
  loadError: null,
  passwordPromptOpen: false,
  pendingOpenFile: null,
  passwordError: null,

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

  formFillOpen: false,
  formFields: [],
  formFieldValues: {},
  isSavingForm: false,
  formMode: "fill",
  formDesignTool: null,

  editOpen: false,
  editTool: "text",

  redactOpen: false,
  redactBoxes: [],
  isApplyingRedactions: false,

  signOpen: false,
  signPlacementKind: null,
  activeSignature: null,
  activeInitials: null,
  signerName: "",
  includeIntegrityHash: false,
  isPlacingSignature: false,

  searchQuery: "",
  searchResults: [],
  isSearching: false,
  activeSearchIndex: -1,

  openOpenedFile: async (opened) => {
    get().document?.destroy();
    set({ isLoading: true, loadError: null, document: null, meta: null, passwordPromptOpen: false, pendingOpenFile: null, passwordError: null });
    try {
      const doc = await PdfDocument.load(opened.bytes);
      await finishOpeningDocument(set, opened, doc);
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException") {
        set({ isLoading: false, passwordPromptOpen: true, pendingOpenFile: opened, passwordError: null });
        return;
      }
      const message = error instanceof Error ? error.message : "Failed to open this file.";
      set({ isLoading: false, loadError: message });
    }
  },

  submitPassword: async (password) => {
    const opened = get().pendingOpenFile;
    if (!opened) return;
    set({ isLoading: true, passwordError: null });
    try {
      const doc = await PdfDocument.load(opened.bytes, password);
      set({ passwordPromptOpen: false, pendingOpenFile: null });
      await finishOpeningDocument(set, opened, doc);
    } catch (error) {
      if (error instanceof Error && error.name === "PasswordException") {
        set({ isLoading: false, passwordError: "Incorrect password. Try again." });
      } else {
        const message = error instanceof Error ? error.message : "Failed to open this file.";
        set({ isLoading: false, passwordPromptOpen: false, pendingOpenFile: null, loadError: message });
      }
    }
  },

  cancelPasswordPrompt: () => set({ passwordPromptOpen: false, pendingOpenFile: null, passwordError: null }),

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
      formFillOpen: false,
      formFields: [],
      formFieldValues: {},
      formMode: "fill",
      formDesignTool: null,
      editOpen: false,
      redactOpen: false,
      redactBoxes: [],
      signOpen: false,
      signPlacementKind: null,
    });
  },

  setMainView: (mainView) =>
    set({
      mainView,
      annotateOpen: false,
      formFillOpen: false,
      formMode: "fill",
      formDesignTool: null,
      editOpen: false,
      redactOpen: false,
      signOpen: false,
      signPlacementKind: null,
    }),
  setAnnotateOpen: (annotateOpen) =>
    set({
      annotateOpen,
      formFillOpen: false,
      formMode: "fill",
      formDesignTool: null,
      editOpen: false,
      redactOpen: false,
      signOpen: false,
      signPlacementKind: null,
    }),
  setAnnotateTool: (annotateTool) => set({ annotateTool }),
  setAnnotateColor: (annotateColor) => set({ annotateColor }),
  setAnnotateStampPreset: (annotateStampPreset) => set({ annotateStampPreset }),

  setFormFillOpen: async (open) => {
    if (!open) {
      set({ formFillOpen: false, formFields: [], formFieldValues: {}, formMode: "fill", formDesignTool: null });
      return;
    }
    const { document: doc } = get();
    if (!doc) return;
    set({
      formFillOpen: true,
      annotateOpen: false,
      formMode: "fill",
      formDesignTool: null,
      editOpen: false,
      redactOpen: false,
      signOpen: false,
      signPlacementKind: null,
    });
    await get().refreshFormFields();
  },

  setFormFieldValue: (name, value) => set((s) => ({ formFieldValues: { ...s.formFieldValues, [name]: value } })),

  saveFormValues: async (flatten) => {
    const { document: doc, formFieldValues, applyPdfMutation: apply } = get();
    if (!doc) return;
    set({ isSavingForm: true });
    try {
      const client = await getPdfWorkerClient();
      let bytes = await client.fillFormFields(await doc.getRawBytes(), formFieldValues);
      if (flatten) bytes = await client.flattenForm(bytes);
      await apply(bytes);
      set({ formFillOpen: false, formFields: [], formFieldValues: {}, formMode: "fill", formDesignTool: null });
    } finally {
      set({ isSavingForm: false });
    }
  },

  setFormMode: (formMode) => set({ formMode, formDesignTool: formMode === "design" ? "text" : null }),
  setFormDesignTool: (formDesignTool) => set({ formDesignTool }),

  setEditOpen: (editOpen) =>
    set({
      editOpen,
      annotateOpen: false,
      formFillOpen: false,
      formMode: "fill",
      formDesignTool: null,
      redactOpen: false,
      signOpen: false,
      signPlacementKind: null,
    }),
  setEditTool: (editTool) => set({ editTool }),

  setRedactOpen: (redactOpen) =>
    set({
      redactOpen,
      annotateOpen: false,
      formFillOpen: false,
      formMode: "fill",
      formDesignTool: null,
      editOpen: false,
      signOpen: false,
      signPlacementKind: null,
      ...(redactOpen ? {} : { redactBoxes: [] }),
    }),
  addRedactBox: (pageIndex, rect) => set((s) => ({ redactBoxes: [...s.redactBoxes, { pageIndex, rect }] })),
  removeRedactBox: (index) => set((s) => ({ redactBoxes: s.redactBoxes.filter((_, i) => i !== index) })),
  clearRedactBoxes: () => set({ redactBoxes: [] }),

  applyRedactions: async (renderedPages) => {
    const { document: doc, redactBoxes, applyPdfMutation: apply } = get();
    if (!doc || redactBoxes.length === 0) return;
    set({ isApplyingRedactions: true });
    try {
      const byPage = new Map<number, Rect[]>();
      for (const box of redactBoxes) {
        const list = byPage.get(box.pageIndex) ?? [];
        list.push(box.rect);
        byPage.set(box.pageIndex, list);
      }
      const client = await getPdfWorkerClient();
      const pages = [...byPage.entries()].map(([pageIndex, boxes]) => {
        const rendered = renderedPages.get(pageIndex);
        if (!rendered) throw new Error(`Missing rendered page for page index ${pageIndex}`);
        return { pageIndex, widthPt: rendered.widthPt, heightPt: rendered.heightPt, jpegBytes: rendered.jpegBytes, boxes };
      });
      const bytes = await client.redactPages(await doc.getRawBytes(), pages);
      await apply(bytes);
      set({ redactBoxes: [], redactOpen: false });
    } finally {
      set({ isApplyingRedactions: false });
    }
  },

  setSignOpen: (signOpen) =>
    set({
      signOpen,
      annotateOpen: false,
      formFillOpen: false,
      formMode: "fill",
      formDesignTool: null,
      editOpen: false,
      redactOpen: false,
      ...(signOpen ? {} : { signPlacementKind: null }),
    }),
  setSignPlacementKind: (signPlacementKind) => set({ signPlacementKind }),
  saveSignatureAsset: (slot, asset) =>
    set(
      slot === "signature"
        ? { activeSignature: asset, signPlacementKind: "signature" }
        : { activeInitials: asset, signPlacementKind: "initials" },
    ),
  setSignerName: (signerName) => set({ signerName }),
  setIncludeIntegrityHash: (includeIntegrityHash) => set({ includeIntegrityHash }),

  placeSignatureAt: async (pageIndex, rect) => {
    const { document: doc, signPlacementKind, activeSignature, activeInitials, signerName, includeIntegrityHash, applyPdfMutation: apply } = get();
    if (!doc || !signPlacementKind) return;
    set({ isPlacingSignature: true });
    try {
      const client = await getPdfWorkerClient();
      const bytes = await doc.getRawBytes();
      let result: Uint8Array;

      if (signPlacementKind === "date") {
        const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
        result = await client.placeTypedSignature(bytes, pageIndex, rect, today, { color: { r: 0.1, g: 0.1, b: 0.12 } });
      } else if (signPlacementKind === "timestamp") {
        const hash = includeIntegrityHash ? await client.computeIntegrityHash(bytes) : undefined;
        const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
        result = await client.placeSignedTimestamp(bytes, pageIndex, rect, {
          signerName: signerName.trim() || "Unnamed signer",
          date: today,
          ...(hash ? { integrityHashHex: hash } : {}),
        });
      } else {
        const asset = signPlacementKind === "initials" ? activeInitials : activeSignature;
        if (!asset) return;
        result =
          asset.kind === "typed"
            ? await client.placeTypedSignature(bytes, pageIndex, rect, asset.text ?? "")
            : await client.placeSignatureImage(bytes, pageIndex, rect, asset.imageBytes!, asset.imageType!);
      }

      await apply(result);
    } finally {
      set({ isPlacingSignature: false });
    }
  },

  refreshFormFields: async () => {
    const { document: doc } = get();
    if (!doc) return;
    const client = await getPdfWorkerClient();
    const fields = await client.listFormFields(await doc.getRawBytes());
    const values: Record<string, FormFieldValue> = {};
    for (const field of fields) {
      if (field.value !== null) values[field.name] = field.value;
    }
    // Guard against the user closing form-fill mode (or the doc changing)
    // before this async fetch resolved.
    if (get().formFillOpen) {
      set((s) => ({ formFields: fields, formFieldValues: { ...values, ...s.formFieldValues } }));
    }
  },

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
