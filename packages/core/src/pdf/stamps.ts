import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { RgbColor } from "./annotations";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

function resolvePageIndices(pageIndices: number[] | undefined, pageCount: number): number[] {
  if (!pageIndices) return Array.from({ length: pageCount }, (_, i) => i);
  for (const i of pageIndices) {
    if (i < 0 || i >= pageCount) throw new Error(`Page index ${i} out of range`);
  }
  return pageIndices;
}

// --- Text watermark ----------------------------------------------------------

export interface TextWatermarkOptions {
  text: string;
  fontSize?: number;
  color?: RgbColor;
  opacity?: number;
  /** Degrees, counter-clockwise. */
  rotation?: number;
  /** "center" draws one instance in the middle of the page; "tile" repeats it in a grid. */
  layout?: "center" | "tile";
  /** 0-based page indices; defaults to every page. */
  pageIndices?: number[];
}

export async function addTextWatermark(source: Uint8Array, options: TextWatermarkOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = options.fontSize ?? 64;
  const color = options.color ?? { r: 0.6, g: 0.6, b: 0.6 };
  const opacity = options.opacity ?? 0.25;
  const rotation = options.rotation ?? -45;
  const layout = options.layout ?? "center";
  const textWidth = font.widthOfTextAtSize(options.text, fontSize);
  const textHeight = font.heightAtSize(fontSize);

  const pages = doc.getPages();
  for (const index of resolvePageIndices(options.pageIndices, pages.length)) {
    const page = pages[index]!;
    const { width, height } = page.getSize();
    const drawAt = (x: number, y: number) => {
      page.drawText(options.text, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(color.r, color.g, color.b),
        opacity,
        rotate: degrees(rotation),
      });
    };

    if (layout === "center") {
      drawAt(width / 2 - textWidth / 2, height / 2 - textHeight / 2);
    } else {
      // Tile in a grid generously oversized so rotated text still covers the corners.
      const stepX = textWidth * 1.6;
      const stepY = textHeight * 6;
      const diag = Math.sqrt(width * width + height * height);
      for (let y = -diag; y < diag; y += stepY) {
        for (let x = -diag; x < diag; x += stepX) {
          drawAt(x, y);
        }
      }
    }
  }

  return finish(doc);
}

// --- Image watermark ----------------------------------------------------------

export interface ImageWatermarkOptions {
  /** Fraction of the page's smaller dimension the image's largest side should occupy. */
  scale?: number;
  opacity?: number;
  rotation?: number;
  pageIndices?: number[];
}

export async function addImageWatermark(
  source: Uint8Array,
  imageBytes: Uint8Array,
  imageType: "png" | "jpg",
  options: ImageWatermarkOptions = {},
): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const image = imageType === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
  const scaleFrac = options.scale ?? 0.4;
  const opacity = options.opacity ?? 0.3;
  const rotation = options.rotation ?? 0;

  const pages = doc.getPages();
  for (const index of resolvePageIndices(options.pageIndices, pages.length)) {
    const page = pages[index]!;
    const { width, height } = page.getSize();
    const targetLongSide = Math.min(width, height) * scaleFrac;
    const aspect = image.width / image.height;
    const drawWidth = aspect >= 1 ? targetLongSide : targetLongSide * aspect;
    const drawHeight = aspect >= 1 ? targetLongSide / aspect : targetLongSide;

    page.drawImage(image, {
      x: width / 2 - drawWidth / 2,
      y: height / 2 - drawHeight / 2,
      width: drawWidth,
      height: drawHeight,
      opacity,
      rotate: degrees(rotation),
    });
  }

  return finish(doc);
}

// --- Header / footer -----------------------------------------------------------

export interface HeaderFooterOptions {
  /** Supports {page} and {total} tokens. */
  headerText?: string;
  /** Supports {page} and {total} tokens. */
  footerText?: string;
  fontSize?: number;
  color?: RgbColor;
  marginPt?: number;
  pageIndices?: number[];
}

function renderTemplate(template: string, page: number, total: number): string {
  return template.replaceAll("{page}", String(page)).replaceAll("{total}", String(total));
}

function drawCenteredLine(page: PDFPage, text: string, y: number, font: PDFFont, fontSize: number, color: RgbColor): void {
  const { width } = page.getSize();
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  page.drawText(text, { x: width / 2 - textWidth / 2, y, size: fontSize, font, color: rgb(color.r, color.g, color.b) });
}

export async function addHeaderFooter(source: Uint8Array, options: HeaderFooterOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = options.fontSize ?? 10;
  const color = options.color ?? { r: 0.35, g: 0.35, b: 0.38 };
  const margin = options.marginPt ?? 28;

  const pages = doc.getPages();
  const total = pages.length;
  for (const index of resolvePageIndices(options.pageIndices, pages.length)) {
    const page = pages[index]!;
    const { height } = page.getSize();
    if (options.headerText) {
      drawCenteredLine(page, renderTemplate(options.headerText, index + 1, total), height - margin, font, fontSize, color);
    }
    if (options.footerText) {
      drawCenteredLine(page, renderTemplate(options.footerText, index + 1, total), margin - fontSize * 0.7, font, fontSize, color);
    }
  }

  return finish(doc);
}

// --- Page numbers / Bates numbering --------------------------------------------

export type PageNumberPosition = "bottom-center" | "bottom-left" | "bottom-right" | "top-center" | "top-left" | "top-right";

export interface PageNumberOptions {
  position?: PageNumberPosition;
  fontSize?: number;
  color?: RgbColor;
  marginPt?: number;
  /** Defaults to "Page {page} of {total}". Supports {page} and {total}. */
  format?: string;
  /** First page's displayed number; defaults to 1. */
  startAt?: number;
  pageIndices?: number[];
}

function positionXY(page: PDFPage, position: PageNumberPosition, textWidth: number, margin: number, fontSize: number): { x: number; y: number } {
  const { width, height } = page.getSize();
  const y = position.startsWith("top") ? height - margin : margin - fontSize * 0.7;
  const x = position.endsWith("left") ? margin : position.endsWith("right") ? width - margin - textWidth : width / 2 - textWidth / 2;
  return { x, y };
}

export async function addPageNumbers(source: Uint8Array, options: PageNumberOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = options.fontSize ?? 10;
  const color = options.color ?? { r: 0.35, g: 0.35, b: 0.38 };
  const margin = options.marginPt ?? 28;
  const position = options.position ?? "bottom-center";
  const format = options.format ?? "Page {page} of {total}";
  const startAt = options.startAt ?? 1;

  const pages = doc.getPages();
  const indices = resolvePageIndices(options.pageIndices, pages.length);
  const total = indices.length;
  indices.forEach((pageIndex, i) => {
    const page = pages[pageIndex]!;
    const displayNumber = startAt + i;
    const text = format.replaceAll("{page}", String(displayNumber)).replaceAll("{total}", String(total));
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const { x, y } = positionXY(page, position, textWidth, margin, fontSize);
    page.drawText(text, { x, y, size: fontSize, font, color: rgb(color.r, color.g, color.b) });
  });

  return finish(doc);
}

export interface BatesNumberOptions {
  /** e.g. "ABC" produces "ABC0000001". */
  prefix?: string;
  startNumber: number;
  digits?: number;
  position?: PageNumberPosition;
  fontSize?: number;
  color?: RgbColor;
  marginPt?: number;
  pageIndices?: number[];
}

export async function addBatesNumbers(source: Uint8Array, options: BatesNumberOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = options.fontSize ?? 9;
  const color = options.color ?? { r: 0.35, g: 0.35, b: 0.38 };
  const margin = options.marginPt ?? 24;
  const position = options.position ?? "bottom-right";
  const digits = options.digits ?? 7;
  const prefix = options.prefix ?? "";

  const pages = doc.getPages();
  const indices = resolvePageIndices(options.pageIndices, pages.length);
  indices.forEach((pageIndex, i) => {
    const page = pages[pageIndex]!;
    const number = options.startNumber + i;
    const text = `${prefix}${String(number).padStart(digits, "0")}`;
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    const { x, y } = positionXY(page, position, textWidth, margin, fontSize);
    page.drawText(text, { x, y, size: fontSize, font, color: rgb(color.r, color.g, color.b) });
  });

  return finish(doc);
}
