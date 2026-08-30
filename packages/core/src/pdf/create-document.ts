import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** One run of inline-formatted text within a heading/paragraph/list item. */
export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] }
  | { type: "listItem"; ordered: boolean; marker: string; runs: InlineRun[] }
  | { type: "code"; text: string }
  | { type: "hr" };

export interface CreateDocumentOptions {
  /** Drawn once at the top, larger than any heading level. */
  title?: string;
  pageSize?: { width: number; height: number };
  margin?: number;
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;

const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 22, 2: 17, 3: 14 };
const BODY_SIZE = 10.5;
const LINE_HEIGHT_FACTOR = 1.4;
const INK = rgb(0.11, 0.11, 0.13);
const FAINT = rgb(0.5, 0.5, 0.53);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  mono: PDFFont;
}

function fontFor(run: InlineRun, fonts: Fonts): PDFFont {
  if (run.code) return fonts.mono;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

interface LineToken {
  text: string;
  font: PDFFont;
}

/** Word-wraps a sequence of mixed-font inline runs into lines, measuring each word in its own run's font. */
function wrapRuns(runs: InlineRun[], fonts: Fonts, size: number, maxWidth: number): LineToken[][] {
  const tokens: LineToken[] = [];
  for (const run of runs) {
    const font = fontFor(run, fonts);
    // Split on spaces but keep them as their own tokens, so word-wrap can
    // drop a trailing space at a line break without losing inter-word
    // spacing elsewhere.
    for (const piece of run.text.split(/(\s+)/)) {
      if (piece.length > 0) tokens.push({ text: piece, font });
    }
  }

  const lines: LineToken[][] = [];
  let current: LineToken[] = [];
  let currentWidth = 0;
  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token.text);
    const width = token.font.widthOfTextAtSize(token.text, size);
    if (!isSpace && current.length > 0 && currentWidth + width > maxWidth) {
      lines.push(current);
      current = [];
      currentWidth = 0;
    }
    if (isSpace && current.length === 0) continue; // don't start a wrapped line with leading whitespace
    current.push(token);
    currentWidth += width;
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Simple top-down page/cursor tracker shared by every block-drawing function below. */
class Cursor {
  private readonly doc: PDFDocument;
  private readonly pageSize: { width: number; height: number };
  private readonly margin: number;
  page: PDFPage;
  y: number;

  constructor(doc: PDFDocument, pageSize: { width: number; height: number }, margin: number) {
    this.doc = doc;
    this.pageSize = pageSize;
    this.margin = margin;
    this.page = doc.addPage([pageSize.width, pageSize.height]);
    this.y = pageSize.height - margin;
  }

  get contentWidth(): number {
    return this.pageSize.width - this.margin * 2;
  }

  ensureSpace(h: number): void {
    if (this.y - h < this.margin) {
      this.page = this.doc.addPage([this.pageSize.width, this.pageSize.height]);
      this.y = this.pageSize.height - this.margin;
    }
  }

  drawRunLines(lines: LineToken[][], size: number, color = INK): void {
    const lineHeight = size * LINE_HEIGHT_FACTOR;
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      let x = this.margin;
      const baselineY = this.y - size;
      for (const token of line) {
        this.page.drawText(token.text, { x, y: baselineY, size, font: token.font, color });
        x += token.font.widthOfTextAtSize(token.text, size);
      }
      this.y -= lineHeight;
    }
  }
}

async function embedFonts(doc: PDFDocument): Promise<Fonts> {
  return {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
}

/**
 * Renders a sequence of structural blocks (headings, paragraphs with inline
 * bold/italic/code, lists, code blocks, rules) into a real paginated PDF.
 * This is the shared layout engine behind both Markdown→PDF and
 * HTML→PDF — text-only, best-effort layout (no columns, images, or
 * CSS-accurate rendering), which is the honest ceiling for a purely
 * client-side converter with no headless-browser rendering available.
 */
export async function blocksToPdf(blocks: DocBlock[], options: CreateDocumentOptions = {}): Promise<Uint8Array> {
  const pageSize = options.pageSize ?? { width: PAGE_W, height: PAGE_H };
  const margin = options.margin ?? MARGIN;
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc);
  const cursor = new Cursor(doc, pageSize, margin);

  if (options.title) {
    cursor.ensureSpace(34);
    cursor.page.drawText(options.title, { x: margin, y: cursor.y - 26, size: 26, font: fonts.bold, color: INK });
    cursor.y -= 42;
  }

  for (const block of blocks) {
    if (block.type === "heading") {
      const size = HEADING_SIZES[block.level];
      cursor.y -= block.level === 1 ? 6 : 4;
      const lines = wrapRuns(
        block.runs.map((r) => ({ ...r, bold: true })),
        fonts,
        size,
        cursor.contentWidth,
      );
      cursor.drawRunLines(lines, size);
      cursor.y -= 4;
    } else if (block.type === "paragraph") {
      const lines = wrapRuns(block.runs, fonts, BODY_SIZE, cursor.contentWidth);
      cursor.drawRunLines(lines, BODY_SIZE);
      cursor.y -= 8;
    } else if (block.type === "listItem") {
      const marker = block.ordered ? `${block.marker}.` : "•";
      const indent = 18;
      const lines = wrapRuns(block.runs, fonts, BODY_SIZE, cursor.contentWidth - indent);
      // Draw the marker at the first line's baseline, then the wrapped text indented.
      if (lines.length > 0) {
        cursor.ensureSpace(BODY_SIZE * LINE_HEIGHT_FACTOR);
        cursor.page.drawText(marker, { x: margin, y: cursor.y - BODY_SIZE, size: BODY_SIZE, font: fonts.regular, color: INK });
      }
      for (const line of lines) {
        cursor.ensureSpace(BODY_SIZE * LINE_HEIGHT_FACTOR);
        let x = margin + indent;
        const baselineY = cursor.y - BODY_SIZE;
        for (const token of line) {
          cursor.page.drawText(token.text, { x, y: baselineY, size: BODY_SIZE, font: token.font, color: INK });
          x += token.font.widthOfTextAtSize(token.text, BODY_SIZE);
        }
        cursor.y -= BODY_SIZE * LINE_HEIGHT_FACTOR;
      }
      cursor.y -= 2;
    } else if (block.type === "code") {
      const codeSize = 9;
      const lines = block.text.split("\n");
      const lineHeight = codeSize * 1.5;
      const boxHeight = lines.length * lineHeight + 12;
      cursor.ensureSpace(boxHeight);
      cursor.page.drawRectangle({
        x: margin,
        y: cursor.y - boxHeight,
        width: cursor.contentWidth,
        height: boxHeight,
        color: rgb(0.95, 0.95, 0.96),
      });
      let ly = cursor.y - 10;
      for (const line of lines) {
        cursor.page.drawText(line, { x: margin + 8, y: ly - codeSize, size: codeSize, font: fonts.mono, color: INK });
        ly -= lineHeight;
      }
      cursor.y -= boxHeight + 8;
    } else if (block.type === "hr") {
      cursor.ensureSpace(14);
      cursor.page.drawLine({
        start: { x: margin, y: cursor.y },
        end: { x: pageSize.width - margin, y: cursor.y },
        thickness: 0.75,
        color: rgb(0.8, 0.8, 0.82),
      });
      cursor.y -= 16;
    }
  }

  if (blocks.length === 0 && !options.title) {
    cursor.page.drawText("(empty document)", { x: margin, y: cursor.y - BODY_SIZE, size: BODY_SIZE, font: fonts.italic, color: FAINT });
  }

  return doc.save();
}
