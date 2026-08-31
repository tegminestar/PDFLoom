import { PDFDocument, degrees } from "pdf-lib";

export type RotationDelta = 90 | 180 | 270 | -90;

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source, { ignoreEncryption: false, updateMetadata: false });
}

async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

/** Combines multiple PDFs, in order, into one. */
export async function mergeDocuments(sources: Uint8Array[]): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error("mergeDocuments requires at least one source");
  const merged = await PDFDocument.create();
  for (const source of sources) {
    const src = await loadForMutation(source);
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return finish(merged);
}

export interface PageRange {
  /** Inclusive, 1-based, matching how ranges are shown in UI. */
  start: number;
  end: number;
}

/** Splits a document into one output per range, in the order given. */
export async function splitDocument(source: Uint8Array, ranges: PageRange[]): Promise<Uint8Array[]> {
  const src = await loadForMutation(source);
  const pageCount = src.getPageCount();
  for (const { start, end } of ranges) {
    if (start < 1 || end > pageCount || start > end) {
      throw new Error(`Invalid page range ${start}-${end} for a ${pageCount}-page document`);
    }
  }

  const outputs: Uint8Array[] = [];
  for (const { start, end } of ranges) {
    const out = await PDFDocument.create();
    const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
    const pages = await out.copyPages(src, indices);
    for (const page of pages) out.addPage(page);
    outputs.push(await finish(out));
  }
  return outputs;
}

/** Reorders pages. `newOrder` is a permutation of 0-based indices, e.g. [2,0,1] moves page 3 to the front. */
export async function reorderPages(source: Uint8Array, newOrder: number[]): Promise<Uint8Array> {
  const src = await loadForMutation(source);
  const pageCount = src.getPageCount();
  if (newOrder.length !== pageCount || new Set(newOrder).size !== pageCount) {
    throw new Error("newOrder must be a permutation of every page index exactly once");
  }
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, newOrder);
  for (const page of pages) out.addPage(page);
  return finish(out);
}

/** Rotates specific pages (0-based indices) by a relative delta, added to each page's existing rotation. */
export async function rotatePages(source: Uint8Array, pageIndices: number[], delta: RotationDelta): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const pageCount = doc.getPageCount();
  for (const index of pageIndices) {
    if (index < 0 || index >= pageCount) throw new Error(`Page index ${index} out of range`);
    const page = doc.getPage(index);
    const current = page.getRotation().angle;
    page.setRotation(degrees(((current + delta) % 360 + 360) % 360));
  }
  return finish(doc);
}

/** Removes the given 0-based page indices. Refuses to produce an empty document. */
export async function deletePages(source: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const pageCount = doc.getPageCount();
  const toRemove = new Set(pageIndices);
  if (toRemove.size >= pageCount) throw new Error("Cannot delete every page in a document");
  // Remove from highest index to lowest so earlier removals don't shift later indices.
  for (const index of [...toRemove].sort((a, b) => b - a)) {
    if (index < 0 || index >= pageCount) throw new Error(`Page index ${index} out of range`);
    doc.removePage(index);
  }
  return finish(doc);
}

/** Inserts a blank page at the given 0-based index (page becomes that index after insertion). Defaults to US Letter. */
export async function insertBlankPage(
  source: Uint8Array,
  atIndex: number,
  size: { width: number; height: number } = { width: 612, height: 792 },
): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  doc.insertPage(atIndex, [size.width, size.height]);
  return finish(doc);
}

/** Inserts pages from another document at the given 0-based index. `pageIndices` defaults to all pages, in order. */
export async function insertPagesFrom(
  source: Uint8Array,
  insertSource: Uint8Array,
  atIndex: number,
  pageIndices?: number[],
): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const insertDoc = await loadForMutation(insertSource);
  const indices = pageIndices ?? insertDoc.getPageIndices();
  const copied = await doc.copyPages(insertDoc, indices);
  copied.forEach((page, i) => doc.insertPage(atIndex + i, page));
  return finish(doc);
}

/** Duplicates a single page (0-based index), inserting the copy immediately after the original. */
export async function duplicatePage(source: Uint8Array, pageIndex: number): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const [copy] = await doc.copyPages(doc, [pageIndex]);
  if (!copy) throw new Error(`Page index ${pageIndex} out of range`);
  doc.insertPage(pageIndex + 1, copy);
  return finish(doc);
}

/** Extracts a subset of pages (0-based indices, in the order given) into a new standalone document. */
export async function extractPages(source: Uint8Array, pageIndices: number[]): Promise<Uint8Array> {
  if (pageIndices.length === 0) throw new Error("extractPages requires at least one page index");
  const src = await loadForMutation(source);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, pageIndices);
  for (const page of pages) out.addPage(page);
  return finish(out);
}

export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sets the visible crop box for specific pages (0-based indices), in PDF points from the bottom-left. */
export async function cropPages(source: Uint8Array, pageIndices: number[], box: CropBox): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const pageCount = doc.getPageCount();
  for (const index of pageIndices) {
    if (index < 0 || index >= pageCount) throw new Error(`Page index ${index} out of range`);
    doc.getPage(index).setCropBox(box.x, box.y, box.width, box.height);
  }
  return finish(doc);
}

export interface PageSize {
  width: number;
  height: number;
}

/** Named standard sizes for the resize-pages UI's preset picker, in PDF points. */
export const STANDARD_PAGE_SIZES: Record<string, { label: string; size: PageSize }> = {
  letter: { label: "US Letter (8.5 × 11 in)", size: { width: 612, height: 792 } },
  legal: { label: "US Legal (8.5 × 14 in)", size: { width: 612, height: 1008 } },
  tabloid: { label: "Tabloid (11 × 17 in)", size: { width: 792, height: 1224 } },
  a4: { label: "A4 (210 × 297 mm)", size: { width: 595.28, height: 841.89 } },
  a3: { label: "A3 (297 × 420 mm)", size: { width: 841.89, height: 1190.55 } },
};

/**
 * Resizes specific pages (0-based indices) to a target size in PDF points —
 * matches Acrobat's "Resize Pages": existing content is uniformly scaled to
 * fit within the new size (never stretched/distorted) and centered, not
 * reflowed. `page.scale()` moves size+content+annotations together, so the
 * remaining `setSize`+`translateContent` pair only has to grow the box to
 * the exact target and re-center the now-smaller-on-one-axis content in it.
 */
export async function resizePages(source: Uint8Array, pageIndices: number[], targetSize: PageSize): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const pageCount = doc.getPageCount();
  for (const index of pageIndices) {
    if (index < 0 || index >= pageCount) throw new Error(`Page index ${index} out of range`);
    const page = doc.getPage(index);
    const { width: srcWidth, height: srcHeight } = page.getSize();
    const scale = Math.min(targetSize.width / srcWidth, targetSize.height / srcHeight);
    page.scale(scale, scale);
    const scaledWidth = srcWidth * scale;
    const scaledHeight = srcHeight * scale;
    page.setSize(targetSize.width, targetSize.height);
    page.translateContent((targetSize.width - scaledWidth) / 2, (targetSize.height - scaledHeight) / 2);
  }
  return finish(doc);
}

export interface NUpOptions {
  /** Grid layout — e.g. 2×1 for a classic side-by-side 2-up, 2×2 for 4-up. */
  columns: number;
  rows: number;
  /** Output sheet size — defaults to Letter portrait; pass a landscape size (width > height) for side-by-side layouts. */
  sheetSize?: PageSize;
}

/**
 * Combines multiple source pages onto fewer, larger output sheets in a grid
 * — matches Acrobat/most printers' "Multiple pages per sheet". Each source
 * page is embedded once (`embedPdf`) then drawn into its grid cell, scaled
 * to fit (preserving aspect ratio, centered, not stretched/rotated) rather
 * than assuming a uniform source page size.
 */
export async function nUpPages(source: Uint8Array, pageIndices: number[] | undefined, options: NUpOptions): Promise<Uint8Array> {
  const { columns, rows } = options;
  if (columns < 1 || rows < 1) throw new Error("columns and rows must each be at least 1");
  const src = await loadForMutation(source);
  const indices = pageIndices ?? src.getPageIndices();
  if (indices.length === 0) throw new Error("nUpPages requires at least one page index");
  const sheetSize = options.sheetSize ?? { width: 612, height: 792 };
  const pagesPerSheet = columns * rows;

  const out = await PDFDocument.create();
  const embedded = await out.embedPdf(src, indices);

  const cellWidth = sheetSize.width / columns;
  const cellHeight = sheetSize.height / rows;
  const margin = Math.min(cellWidth, cellHeight) * 0.04;

  for (let sheetStart = 0; sheetStart < embedded.length; sheetStart += pagesPerSheet) {
    const sheetPage = out.addPage([sheetSize.width, sheetSize.height]);
    const sheetPages = embedded.slice(sheetStart, sheetStart + pagesPerSheet);
    sheetPages.forEach((embeddedPage, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      const availWidth = cellWidth - margin * 2;
      const availHeight = cellHeight - margin * 2;
      const scale = Math.min(availWidth / embeddedPage.width, availHeight / embeddedPage.height);
      const drawWidth = embeddedPage.width * scale;
      const drawHeight = embeddedPage.height * scale;
      const cellX = col * cellWidth;
      const cellTopY = sheetSize.height - row * cellHeight;
      const x = cellX + (cellWidth - drawWidth) / 2;
      const y = cellTopY - cellHeight + (cellHeight - drawHeight) / 2;
      sheetPage.drawPage(embeddedPage, { x, y, xScale: scale, yScale: scale });
    });
  }

  return finish(out);
}
