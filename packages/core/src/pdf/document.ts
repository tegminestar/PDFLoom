import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from "pdfjs-dist";
import { loadPdfjs } from "./worker-setup";
import type { OutlineNode, SearchMatch } from "../types";

export interface RenderPageOptions {
  scale: number;
  /** Degrees, clockwise, one of 0/90/180/270. Added to the page's own baked-in rotation. */
  rotation?: number;
  canvas: HTMLCanvasElement;
  /** Device pixel ratio to render at, for crisp output on HiDPI screens. Defaults to window.devicePixelRatio. */
  devicePixelRatio?: number;
}

export interface RenderTextLayerOptions {
  scale: number;
  rotation?: number;
  container: HTMLDivElement;
}

export interface PageDimensions {
  widthPt: number;
  heightPt: number;
}

interface CachedPageText {
  fullText: string;
  /** Start offset of each text item within fullText, parallel to the pdf.js text-content items array. */
  itemStarts: number[];
}

/**
 * Thin, ergonomic wrapper around a pdf.js document. Owns rendering,
 * outline/bookmark extraction, and full-text search. This is the only
 * module in the engine that talks to pdf.js directly — everything else
 * (viewer UI, search UI) goes through this class.
 */
export class PdfDocument {
  private readonly proxy: PDFDocumentProxy;
  private readonly loadingTask: PDFDocumentLoadingTask;
  private readonly pageCache = new Map<number, PDFPageProxy>();
  private readonly textCache = new Map<number, CachedPageText>();
  private readonly activeRenderTasks = new Map<HTMLCanvasElement, RenderTask>();

  private constructor(proxy: PDFDocumentProxy, loadingTask: PDFDocumentLoadingTask) {
    this.proxy = proxy;
    this.loadingTask = loadingTask;
  }

  static async load(source: ArrayBuffer | Uint8Array, password?: string): Promise<PdfDocument> {
    const pdfjsLib = await loadPdfjs();
    // pdf.js transfers (detaches) the underlying ArrayBuffer to its worker
    // via postMessage rather than copying it — passing the caller's own
    // buffer straight through would silently zero it out from under them,
    // breaking any retry that reuses the same bytes (e.g. re-attempting
    // after a wrong password). Slicing always hands pdf.js a fresh,
    // disposable copy instead.
    const data = source instanceof Uint8Array ? source.slice() : new Uint8Array(source.slice(0));
    const loadingTask = pdfjsLib.getDocument({ data, password, useSystemFonts: true });
    const proxy = await loadingTask.promise;
    return new PdfDocument(proxy, loadingTask);
  }

  get pageCount(): number {
    return this.proxy.numPages;
  }

  get fingerprint(): string {
    return this.proxy.fingerprints[0] ?? "";
  }

  /** The exact bytes this document was loaded from — pdf.js keeps them buffered internally. */
  async getRawBytes(): Promise<Uint8Array> {
    return this.proxy.getData();
  }

  async getMetadata(): Promise<{ title: string | null; author: string | null }> {
    const meta = await this.proxy.getMetadata();
    const info = meta.info as Record<string, unknown>;
    return {
      title: typeof info["Title"] === "string" && info["Title"] ? (info["Title"] as string) : null,
      author: typeof info["Author"] === "string" && info["Author"] ? (info["Author"] as string) : null,
    };
  }

  private async getPage(pageNumber: number): Promise<PDFPageProxy> {
    const cached = this.pageCache.get(pageNumber);
    if (cached) return cached;
    const page = await this.proxy.getPage(pageNumber);
    this.pageCache.set(pageNumber, page);
    return page;
  }

  /**
   * Converts a point in the same CSS-pixel space a page is rendered/laid
   * out in (top-left origin, matching `renderPage`/`renderTextLayer` at the
   * given scale/rotation) into PDF point space (bottom-left origin) —
   * needed to place interactively-drawn annotations at the right spot.
   */
  async screenPointToPdfPoint(pageNumber: number, scale: number, rotation: number, x: number, y: number): Promise<{ x: number; y: number }> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });
    const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y) as [number, number];
    return { x: pdfX, y: pdfY };
  }

  /**
   * The inverse of screenPointToPdfPoint, for a whole rect — converts a PDF
   * points rect (bottom-left origin, as returned by form field widgets)
   * into a CSS-pixel rect (top-left origin) for positioning an HTML overlay
   * over the rendered page. Uses both diagonal corners rather than just
   * width/height deltas so it stays correct under rotation.
   */
  async pdfRectToScreenRect(
    pageNumber: number,
    scale: number,
    rotation: number,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<{ x: number; y: number; width: number; height: number }> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });
    const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y) as [number, number];
    const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y + rect.height) as [number, number];
    return {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  async getPageDimensions(pageNumber: number): Promise<PageDimensions> {
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    return { widthPt: viewport.width, heightPt: viewport.height };
  }

  /**
   * Renders one page into the given canvas at the given scale. If a render
   * is already in flight for that canvas, it's cancelled first — callers
   * (a virtualized scroll view) can call this repeatedly on the same canvas
   * as zoom/scroll changes without manually tracking cancellation.
   */
  async renderPage(pageNumber: number, options: RenderPageOptions): Promise<void> {
    const { canvas, scale, rotation = 0 } = options;
    const dpr = options.devicePixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1);

    const existing = this.activeRenderTasks.get(canvas);
    if (existing) {
      existing.cancel();
      this.activeRenderTasks.delete(canvas);
    }

    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale: scale * dpr, rotation });

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width / dpr)}px`;
    canvas.style.height = `${Math.ceil(viewport.height / dpr)}px`;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context unavailable");

    const task = page.render({ canvasContext: context, viewport, canvas });
    this.activeRenderTasks.set(canvas, task);
    try {
      await task.promise;
    } catch (error) {
      // RenderingCancelledException is expected when a newer render supersedes this one.
      if (error instanceof Error && error.name === "RenderingCancelledException") return;
      throw error;
    } finally {
      if (this.activeRenderTasks.get(canvas) === task) {
        this.activeRenderTasks.delete(canvas);
      }
    }
  }

  cancelRender(canvas: HTMLCanvasElement): void {
    const task = this.activeRenderTasks.get(canvas);
    if (task) {
      task.cancel();
      this.activeRenderTasks.delete(canvas);
    }
  }

  /**
   * Renders selectable/copyable text spans into `container`, positioned to
   * align with a canvas rendered via `renderPage` at the same scale and
   * rotation — this is what gives the viewer real text selection (and is a
   * prerequisite for text-markup annotations, which anchor to selected
   * glyph rects). Mirrors pdf.js's own PDFPageView wiring: sets
   * `--scale-factor` on the container so the layer's CSS (see
   * @pdfloom/ui's tokens.css `.loom-text-layer` rules) can position spans
   * correctly.
   */
  async renderTextLayer(pageNumber: number, options: RenderTextLayerOptions): Promise<TextLayer> {
    const { container, scale, rotation = 0 } = options;
    const pdfjsLib = await loadPdfjs();
    const page = await this.getPage(pageNumber);
    const viewport = page.getViewport({ scale, rotation });

    container.style.setProperty("--scale-factor", String(viewport.scale));
    pdfjsLib.setLayerDimensions(container, viewport);

    const textLayer = new pdfjsLib.TextLayer({
      textContentSource: page.streamTextContent(),
      container,
      viewport,
    });
    await textLayer.render();
    return textLayer;
  }

  async getOutline(): Promise<OutlineNode[]> {
    const raw = await this.proxy.getOutline();
    if (!raw) return [];

    const resolve = async (
      dest: string | unknown[] | null | undefined,
    ): Promise<number | null> => {
      try {
        if (!dest) return null;
        const explicitDest = typeof dest === "string" ? await this.proxy.getDestination(dest) : dest;
        if (!explicitDest || !Array.isArray(explicitDest)) return null;
        const ref = explicitDest[0];
        const pageIndex = await this.proxy.getPageIndex(ref);
        return pageIndex + 1;
      } catch {
        return null;
      }
    };

    const build = async (nodes: typeof raw): Promise<OutlineNode[]> => {
      const result: OutlineNode[] = [];
      for (const node of nodes) {
        result.push({
          title: node.title,
          pageNumber: await resolve(node.dest),
          items: node.items.length > 0 ? await build(node.items) : [],
        });
      }
      return result;
    };

    return build(raw);
  }

  private async getPageText(pageNumber: number): Promise<CachedPageText> {
    const cached = this.textCache.get(pageNumber);
    if (cached) return cached;

    const page = await this.getPage(pageNumber);
    const content = await page.getTextContent();
    let fullText = "";
    const itemStarts: number[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      itemStarts.push(fullText.length);
      fullText += item.str;
      if (item.hasEOL) fullText += "\n";
    }
    const entry: CachedPageText = { fullText, itemStarts };
    this.textCache.set(pageNumber, entry);
    return entry;
  }

  async getFullPageText(pageNumber: number): Promise<string> {
    return (await this.getPageText(pageNumber)).fullText;
  }

  /** Case-insensitive full-text search across every page. Streams results as it goes via onPageSearched. */
  async search(
    query: string,
    onPageSearched?: (pageNumber: number, matches: SearchMatch[]) => void,
  ): Promise<SearchMatch[]> {
    if (query.trim().length === 0) return [];
    const needle = query.toLowerCase();
    const all: SearchMatch[] = [];

    for (let pageNumber = 1; pageNumber <= this.pageCount; pageNumber++) {
      const { fullText } = await this.getPageText(pageNumber);
      const haystack = fullText.toLowerCase();
      const pageMatches: SearchMatch[] = [];

      let fromIndex = 0;
      for (;;) {
        const idx = haystack.indexOf(needle, fromIndex);
        if (idx === -1) break;
        const snippetStart = Math.max(0, idx - 40);
        const snippetEnd = Math.min(fullText.length, idx + needle.length + 40);
        pageMatches.push({
          pageNumber,
          startIndex: idx,
          matchedText: fullText.slice(idx, idx + needle.length),
          contextSnippet: fullText.slice(snippetStart, snippetEnd).replace(/\s+/g, " ").trim(),
        });
        fromIndex = idx + needle.length;
      }

      if (pageMatches.length > 0) {
        all.push(...pageMatches);
        onPageSearched?.(pageNumber, pageMatches);
      }
    }

    return all;
  }

  destroy(): void {
    for (const task of this.activeRenderTasks.values()) task.cancel();
    this.activeRenderTasks.clear();
    this.pageCache.clear();
    this.textCache.clear();
    void this.loadingTask.destroy();
  }
}
