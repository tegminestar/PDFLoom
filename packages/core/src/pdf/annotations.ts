import {
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFPage,
  PDFRef,
  StandardFonts,
  appendBezierCurve,
  beginText,
  closePath,
  endText,
  fill,
  fillAndStroke,
  lineTo,
  moveText,
  moveTo,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setGraphicsState,
  setLineCap,
  setLineHeight,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  showText,
  stroke,
  type PDFFont,
} from "pdf-lib";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Four corners of one "quad" of marked-up text, PDF units, any winding order pdf.js's rects give us. */
export interface Quad {
  topLeft: Point;
  topRight: Point;
  bottomLeft: Point;
  bottomRight: Point;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const DEFAULT_OPACITY = 1;

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

/** Bounding rect that encloses every quad, used as the annotation's /Rect. */
function boundsOfQuads(quads: Quad[]): Rect {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const q of quads) {
    for (const p of [q.topLeft, q.topRight, q.bottomLeft, q.bottomRight]) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** PDF spec order for a QuadPoints octet is (x1,y1)=top-left,(x2,y2)=top-right,(x3,y3)=bottom-left,(x4,y4)=bottom-right — NOT clockwise. */
function quadPointsArray(quads: Quad[]): number[] {
  const out: number[] = [];
  for (const q of quads) {
    out.push(q.topLeft.x, q.topLeft.y, q.topRight.x, q.topRight.y, q.bottomLeft.x, q.bottomLeft.y, q.bottomRight.x, q.bottomRight.y);
  }
  return out;
}

function colorToArray(c: RgbColor): number[] {
  return [c.r, c.g, c.b];
}

/** Ensures /Annots exists on the page and returns the array, creating it if needed. */
function annotsArray(page: PDFPage): PDFArray {
  const existing = page.node.Annots();
  if (existing) return existing;
  const arr = page.doc.context.obj([]);
  page.node.set(PDFName.of("Annots"), arr);
  return arr;
}

function pushAnnotation(page: PDFPage, ref: PDFRef): void {
  annotsArray(page).push(ref);
}

// --- Text markup (Highlight / Underline / StrikeOut) -----------------------

export interface TextMarkupOptions {
  color?: RgbColor;
  opacity?: number;
  contents?: string;
}

function addTextMarkup(
  doc: PDFDocument,
  pageIndex: number,
  subtype: "Highlight" | "Underline" | "StrikeOut",
  quads: Quad[],
  options: TextMarkupOptions,
): void {
  if (quads.length === 0) throw new Error("addTextMarkup requires at least one quad");
  const page = doc.getPage(pageIndex);
  const { context } = page.doc;
  const color = options.color ?? { r: 1, g: 0.9, b: 0.2 };
  // A fully opaque Highlight fill would completely hide the text it's
  // meant to highlight — real highlighters are semi-transparent so the
  // marked text stays legible underneath. Underline/StrikeOut are thin
  // lines beside/through the text, not a fill, so full opacity is correct
  // for those.
  const opacity = options.opacity ?? (subtype === "Highlight" ? 0.4 : DEFAULT_OPACITY);
  const rect = boundsOfQuads(quads);

  const operators: PDFOperator[] = [setFillingRgbColor(color.r, color.g, color.b), setStrokingRgbColor(color.r, color.g, color.b)];

  // The annotation dict's own /CA is meant to convey opacity, but pdf.js's
  // (and some other viewers') canvas-baking path for annotations doesn't
  // apply it — only the interactive AnnotationLayer does. Baking the alpha
  // directly into the appearance stream via an ExtGState instead makes the
  // transparency intrinsic to the appearance itself, so it renders
  // correctly regardless of which rendering path a viewer takes.
  const extGState = opacity < 1 ? { GS0: { Type: "ExtGState", ca: opacity, CA: opacity } } : undefined;
  if (extGState) operators.unshift(setGraphicsState("GS0"));

  if (subtype === "Highlight") {
    for (const q of quads) {
      operators.push(
        moveTo(q.bottomLeft.x, q.bottomLeft.y),
        lineTo(q.topLeft.x, q.topLeft.y),
        lineTo(q.topRight.x, q.topRight.y),
        lineTo(q.bottomRight.x, q.bottomRight.y),
        closePath(),
        fill(),
      );
    }
  } else {
    // Underline / StrikeOut: a stroked line per quad, at the bottom edge or vertical middle.
    const thickness = Math.max(1, (rect.height || 12) * 0.06);
    operators.push(setLineWidth(thickness));
    for (const q of quads) {
      const yFrac = subtype === "Underline" ? 0.08 : 0.5;
      const leftY = q.bottomLeft.y + (q.topLeft.y - q.bottomLeft.y) * yFrac;
      const rightY = q.bottomRight.y + (q.topRight.y - q.bottomRight.y) * yFrac;
      operators.push(moveTo(q.bottomLeft.x, leftY), lineTo(q.bottomRight.x, rightY), stroke());
    }
  }

  const appearance = context.formXObject(operators, {
    BBox: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    ...(extGState ? { Resources: { ExtGState: extGState } } : {}),
  });
  const appearanceRef = context.register(appearance);

  const dict = context.obj({
    Type: "Annot",
    Subtype: subtype,
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    QuadPoints: quadPointsArray(quads),
    C: colorToArray(color),
    CA: opacity,
    F: 4,
    AP: { N: appearanceRef },
    ...(options.contents ? { Contents: options.contents } : {}),
  });
  pushAnnotation(page, context.register(dict));
}

export async function addHighlight(source: Uint8Array, pageIndex: number, quads: Quad[], options: TextMarkupOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  addTextMarkup(doc, pageIndex, "Highlight", quads, options);
  return finish(doc);
}
export async function addUnderline(source: Uint8Array, pageIndex: number, quads: Quad[], options: TextMarkupOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  addTextMarkup(doc, pageIndex, "Underline", quads, options);
  return finish(doc);
}
export async function addStrikeOut(source: Uint8Array, pageIndex: number, quads: Quad[], options: TextMarkupOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  addTextMarkup(doc, pageIndex, "StrikeOut", quads, options);
  return finish(doc);
}

// --- Freehand ink ------------------------------------------------------------

export interface InkOptions {
  color?: RgbColor;
  lineWidth?: number;
  opacity?: number;
}

export async function addInk(source: Uint8Array, pageIndex: number, strokes: Point[][], options: InkOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const page = doc.getPage(pageIndex);
  const { context } = page.doc;
  const color = options.color ?? { r: 0.1, g: 0.1, b: 0.9 };
  const lineWidth = options.lineWidth ?? 2;
  const opacity = options.opacity ?? DEFAULT_OPACITY;

  const allPoints = strokes.flat();
  if (allPoints.length === 0) throw new Error("addInk requires at least one point");
  const pad = lineWidth;
  const minX = Math.min(...allPoints.map((p) => p.x)) - pad;
  const maxX = Math.max(...allPoints.map((p) => p.x)) + pad;
  const minY = Math.min(...allPoints.map((p) => p.y)) - pad;
  const maxY = Math.max(...allPoints.map((p) => p.y)) + pad;

  const operators: PDFOperator[] = [
    setStrokingRgbColor(color.r, color.g, color.b),
    setLineWidth(lineWidth),
    setLineCap(LineCapStyle.Round),
    setLineJoin(LineJoinStyle.Round),
  ];
  for (const stroke_ of strokes) {
    if (stroke_.length === 0) continue;
    operators.push(moveTo(stroke_[0]!.x, stroke_[0]!.y));
    for (const p of stroke_.slice(1)) operators.push(lineTo(p.x, p.y));
    operators.push(stroke());
  }

  const appearance = context.formXObject(operators, { BBox: [minX, minY, maxX, maxY] });
  const appearanceRef = context.register(appearance);
  const dict = context.obj({
    Type: "Annot",
    Subtype: "Ink",
    Rect: [minX, minY, maxX, maxY],
    InkList: strokes.map((s) => s.flatMap((p) => [p.x, p.y])),
    C: colorToArray(color),
    CA: opacity,
    F: 4,
    AP: { N: appearanceRef },
  });
  pushAnnotation(page, context.register(dict));
  return finish(doc);
}

// --- Shapes: Square / Circle / Line -----------------------------------------

export interface ShapeOptions {
  strokeColor?: RgbColor;
  fillColor?: RgbColor | null;
  lineWidth?: number;
  opacity?: number;
}

export async function addSquare(source: Uint8Array, pageIndex: number, rect: Rect, options: ShapeOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const page = doc.getPage(pageIndex);
  const { context } = page.doc;
  const strokeColor = options.strokeColor ?? { r: 0.86, g: 0.2, b: 0.2 };
  const fillColor = options.fillColor ?? null;
  const lineWidth = options.lineWidth ?? 2;
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  const inset = lineWidth / 2;

  const operators: PDFOperator[] = [setLineWidth(lineWidth), setStrokingRgbColor(strokeColor.r, strokeColor.g, strokeColor.b)];
  if (fillColor) operators.push(setFillingRgbColor(fillColor.r, fillColor.g, fillColor.b));
  operators.push(rectangle(rect.x + inset, rect.y + inset, rect.width - inset * 2, rect.height - inset * 2));
  operators.push(fillColor ? fillAndStroke() : stroke());

  const appearance = context.formXObject(operators, { BBox: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] });
  const appearanceRef = context.register(appearance);
  const dict = context.obj({
    Type: "Annot",
    Subtype: "Square",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    C: colorToArray(strokeColor),
    ...(fillColor ? { IC: colorToArray(fillColor) } : {}),
    CA: opacity,
    BS: { W: lineWidth },
    F: 4,
    AP: { N: appearanceRef },
  });
  pushAnnotation(page, context.register(dict));
  return finish(doc);
}

const BEZIER_CIRCLE_KAPPA = 0.5522847498;

export async function addCircle(source: Uint8Array, pageIndex: number, rect: Rect, options: ShapeOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const page = doc.getPage(pageIndex);
  const { context } = page.doc;
  const strokeColor = options.strokeColor ?? { r: 0.86, g: 0.2, b: 0.2 };
  const fillColor = options.fillColor ?? null;
  const lineWidth = options.lineWidth ?? 2;
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  const inset = lineWidth / 2;

  const x = rect.x + inset;
  const y = rect.y + inset;
  const w = rect.width - inset * 2;
  const h = rect.height - inset * 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * BEZIER_CIRCLE_KAPPA;
  const ky = ry * BEZIER_CIRCLE_KAPPA;

  const operators: PDFOperator[] = [setLineWidth(lineWidth), setStrokingRgbColor(strokeColor.r, strokeColor.g, strokeColor.b)];
  if (fillColor) operators.push(setFillingRgbColor(fillColor.r, fillColor.g, fillColor.b));
  operators.push(
    moveTo(cx + rx, cy),
    appendBezierCurve(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry),
    appendBezierCurve(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy),
    appendBezierCurve(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry),
    appendBezierCurve(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy),
    closePath(),
    fillColor ? fillAndStroke() : stroke(),
  );

  const appearance = context.formXObject(operators, { BBox: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] });
  const appearanceRef = context.register(appearance);
  const dict = context.obj({
    Type: "Annot",
    Subtype: "Circle",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    C: colorToArray(strokeColor),
    ...(fillColor ? { IC: colorToArray(fillColor) } : {}),
    CA: opacity,
    BS: { W: lineWidth },
    F: 4,
    AP: { N: appearanceRef },
  });
  pushAnnotation(page, context.register(dict));
  return finish(doc);
}

export interface LineOptions extends ShapeOptions {
  arrowEnd?: boolean;
}

export async function addLine(source: Uint8Array, pageIndex: number, start: Point, end: Point, options: LineOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const page = doc.getPage(pageIndex);
  const { context } = page.doc;
  const strokeColor = options.strokeColor ?? { r: 0.1, g: 0.1, b: 0.1 };
  const lineWidth = options.lineWidth ?? 2;
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  const arrowSize = Math.max(8, lineWidth * 5);

  const operators: PDFOperator[] = [
    setLineWidth(lineWidth),
    setStrokingRgbColor(strokeColor.r, strokeColor.g, strokeColor.b),
    setFillingRgbColor(strokeColor.r, strokeColor.g, strokeColor.b),
    moveTo(start.x, start.y),
    lineTo(end.x, end.y),
    stroke(),
  ];
  if (options.arrowEnd) {
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const a1 = angle + Math.PI - Math.PI / 7;
    const a2 = angle + Math.PI + Math.PI / 7;
    const p1 = { x: end.x + arrowSize * Math.cos(a1), y: end.y + arrowSize * Math.sin(a1) };
    const p2 = { x: end.x + arrowSize * Math.cos(a2), y: end.y + arrowSize * Math.sin(a2) };
    operators.push(moveTo(end.x, end.y), lineTo(p1.x, p1.y), lineTo(p2.x, p2.y), closePath(), fill());
  }

  const pad = lineWidth + arrowSize;
  const minX = Math.min(start.x, end.x) - pad;
  const maxX = Math.max(start.x, end.x) + pad;
  const minY = Math.min(start.y, end.y) - pad;
  const maxY = Math.max(start.y, end.y) + pad;

  const appearance = context.formXObject(operators, { BBox: [minX, minY, maxX, maxY] });
  const appearanceRef = context.register(appearance);
  const dict = context.obj({
    Type: "Annot",
    Subtype: "Line",
    Rect: [minX, minY, maxX, maxY],
    L: [start.x, start.y, end.x, end.y],
    C: colorToArray(strokeColor),
    CA: opacity,
    BS: { W: lineWidth },
    ...(options.arrowEnd ? { LE: ["None", "OpenArrow"] } : {}),
    F: 4,
    AP: { N: appearanceRef },
  });
  pushAnnotation(page, context.register(dict));
  return finish(doc);
}

// --- FreeText (text box / sticky comment) & Stamp ---------------------------

export interface FreeTextOptions {
  fontSize?: number;
  color?: RgbColor;
  opacity?: number;
  /** When set, draws a filled/stroked box behind the text (used for stamps). */
  box?: { fill?: RgbColor; stroke?: RgbColor; lineWidth?: number };
  bold?: boolean;
  align?: "left" | "center";
}

async function embedFonts(doc: PDFDocument): Promise<{ regular: PDFFont; bold: PDFFont }> {
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { regular, bold };
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let current = "";
    for (const word of paragraph.split(" ")) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines;
}

async function addFreeTextInternal(doc: PDFDocument, pageIndex: number, rect: Rect, text: string, options: FreeTextOptions): Promise<void> {
  const page = doc.getPage(pageIndex);
  const { context } = page.doc;
  const fontSize = options.fontSize ?? 14;
  const color = options.color ?? { r: 0, g: 0, b: 0 };
  const opacity = options.opacity ?? DEFAULT_OPACITY;
  const { regular, bold } = await embedFonts(doc);
  const font = options.bold ? bold : regular;
  const fontKey = options.bold ? "FB" : "FR";

  const operators: PDFOperator[] = [];
  if (options.box) {
    const lw = options.box.lineWidth ?? 1;
    if (options.box.fill) operators.push(setFillingRgbColor(options.box.fill.r, options.box.fill.g, options.box.fill.b));
    if (options.box.stroke) {
      operators.push(setStrokingRgbColor(options.box.stroke.r, options.box.stroke.g, options.box.stroke.b));
      operators.push(setLineWidth(lw));
    }
    operators.push(rectangle(lw / 2, lw / 2, rect.width - lw, rect.height - lw));
    if (options.box.fill && options.box.stroke) operators.push(fillAndStroke());
    else if (options.box.fill) operators.push(fill());
    else if (options.box.stroke) operators.push(stroke());
  }

  const padding = 4;
  const maxWidth = rect.width - padding * 2;
  const lines = wrapText(text, font, fontSize, Math.max(1, maxWidth));
  const lineHeight = fontSize * 1.25;

  operators.push(setFillingRgbColor(color.r, color.g, color.b));
  operators.push(beginText());
  operators.push(setFontAndSize(fontKey, fontSize));
  operators.push(setLineHeight(lineHeight));
  const startY = rect.height - padding - fontSize;
  let firstLine = true;
  for (const line of lines) {
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    const x = options.align === "center" ? Math.max(padding, (rect.width - lineWidth) / 2) : padding;
    operators.push(moveText(x, firstLine ? startY : -lineHeight));
    firstLine = false;
    operators.push(showText(font.encodeText(line)));
  }
  operators.push(endText());

  const appearance = context.formXObject(operators, {
    BBox: [0, 0, rect.width, rect.height],
    Resources: { Font: { FR: regular.ref, FB: bold.ref } },
  });
  const appearanceRef = context.register(appearance);

  const dict = context.obj({
    Type: "Annot",
    Subtype: "FreeText",
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    Contents: text,
    DA: `${color.r} ${color.g} ${color.b} rg /${fontKey} ${fontSize} Tf`,
    C: options.box?.fill ? colorToArray(options.box.fill) : [],
    CA: opacity,
    F: 4,
    AP: { N: appearanceRef },
  });
  pushAnnotation(page, context.register(dict));
}

export async function addFreeText(source: Uint8Array, pageIndex: number, rect: Rect, text: string, options: FreeTextOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  await addFreeTextInternal(doc, pageIndex, rect, text, options);
  return finish(doc);
}

export type StampPreset = "approved" | "draft" | "confidential" | "rejected";

const STAMP_PRESETS: Record<StampPreset, { label: string; color: RgbColor }> = {
  approved: { label: "APPROVED", color: { r: 0.106, g: 0.62, b: 0.42 } },
  draft: { label: "DRAFT", color: { r: 0.55, g: 0.55, b: 0.58 } },
  confidential: { label: "CONFIDENTIAL", color: { r: 0.84, g: 0.24, b: 0.24 } },
  rejected: { label: "REJECTED", color: { r: 0.84, g: 0.24, b: 0.24 } },
};

export async function addStamp(source: Uint8Array, pageIndex: number, rect: Rect, preset: StampPreset): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const { label, color } = STAMP_PRESETS[preset];
  await addFreeTextInternal(doc, pageIndex, rect, label, {
    fontSize: Math.max(12, rect.height * 0.4),
    color,
    bold: true,
    align: "center",
    box: { stroke: color, lineWidth: 3 },
  });
  return finish(doc);
}
