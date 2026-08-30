import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Rect, RgbColor } from "./annotations";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

// Both the font file (Vite resolves this to a fetchable URL at build time)
// and @pdf-lib/fontkit itself are loaded lazily, on first actual use — a
// typed signature is the only feature in this module that needs custom
// font embedding, so nothing else should pay for fetching a font file or
// pulling fontkit into the bundle.
let cachedFontBytes: Promise<ArrayBuffer> | null = null;
async function getSignatureFontBytes(): Promise<ArrayBuffer> {
  cachedFontBytes ??= import("@fontsource/caveat/files/caveat-latin-700-normal.woff?url").then(({ default: url }) =>
    fetch(url).then((r) => r.arrayBuffer()),
  );
  return cachedFontBytes;
}

export interface TypedSignatureOptions {
  color?: RgbColor;
}

/**
 * Places a "typed" signature as real vector text in a cursive font
 * (Caveat), not a rasterized image — stays crisp at any zoom and print
 * resolution. Requires registering fontkit for custom (non-Standard-14)
 * font embedding, per pdf-lib's own documented pattern for this.
 *
 * `subset: true` is required here, not just an optimization: pdf-lib's
 * non-subset embedding path writes the *original* font file bytes
 * straight into the PDF's FontFile2 stream, unchanged — correct for a
 * source that's already raw TrueType/OpenType, but the Caveat font here
 * ships only as WOFF (a compressed *container* around sfnt table data,
 * not the raw sfnt bytes FontFile2 requires). Embedding it directly
 * produces a PDF pdf.js can't parse ("Required 'loca' table is not
 * found"), which silently falls back to a system sans-serif font instead
 * of erroring — confirmed by reproducing it in isolation and inspecting
 * the result before finding this. `subset: true` routes through
 * fontkit's own createSubset()/encodeStream(), which re-serializes the
 * parsed font into genuine sfnt bytes regardless of the source
 * container, which is what's actually needed here.
 */
export async function placeTypedSignature(
  source: Uint8Array,
  pageIndex: number,
  rect: Rect,
  text: string,
  options: TypedSignatureOptions = {},
): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const { default: fontkit } = await import("@pdf-lib/fontkit");
  doc.registerFontkit(fontkit);
  const fontBytes = await getSignatureFontBytes();
  const font = await doc.embedFont(fontBytes, { subset: true });
  const page = doc.getPage(pageIndex);
  const color = options.color ?? { r: 0.05, g: 0.05, b: 0.2 };

  let fontSize = rect.height * 0.8;
  while (fontSize > 6 && font.widthOfTextAtSize(text, fontSize) > rect.width) fontSize -= 1;
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const x = rect.x + Math.max(0, (rect.width - textWidth) / 2);
  const y = rect.y + (rect.height - fontSize) / 2;

  page.drawText(text, { x, y, size: fontSize, font, color: rgb(color.r, color.g, color.b) });
  return finish(doc);
}

/** Places a drawn (canvas-captured) or uploaded signature/initials image, preserving its aspect ratio, centered within rect. */
export async function placeSignatureImage(
  source: Uint8Array,
  pageIndex: number,
  rect: Rect,
  imageBytes: Uint8Array,
  imageType: "png" | "jpg",
): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const image = imageType === "png" ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
  const page = doc.getPage(pageIndex);

  const aspect = image.width / image.height;
  const rectAspect = rect.width / rect.height;
  let drawWidth = rect.width;
  let drawHeight = rect.height;
  if (aspect > rectAspect) drawHeight = rect.width / aspect;
  else drawWidth = rect.height * aspect;
  const x = rect.x + (rect.width - drawWidth) / 2;
  const y = rect.y + (rect.height - drawHeight) / 2;

  page.drawImage(image, { x, y, width: drawWidth, height: drawHeight });
  return finish(doc);
}

export interface SignedTimestampOptions {
  signerName: string;
  /** Pre-formatted, e.g. "August 29, 2026". */
  date: string;
  /** A SHA-256 hex digest (see computeIntegrityHash) — shown truncated as an extra tamper-evidence line when provided. */
  integrityHashHex?: string;
}

const INK = rgb(0.1, 0.1, 0.12);
const FAINT = rgb(0.45, 0.45, 0.48);
const BORDER = rgb(0.55, 0.55, 0.58);

/**
 * A visible "Signed by X on Y" stamp — this is a visual attestation mark,
 * not a certified PKI digital signature (no certificate, no
 * cryptographic binding recognized by PDF's own /Sig field mechanism).
 * The optional integrity hash is a local, unverifiable-by-third-parties
 * tamper-evidence aid, not a substitute for real legal signing — the UI
 * must label it exactly that way.
 */
export async function placeSignedTimestamp(source: Uint8Array, pageIndex: number, rect: Rect, options: SignedTimestampOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.getPage(pageIndex);

  page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderColor: BORDER, borderWidth: 1 });

  const padding = 6;
  const lines: { text: string; font: typeof regular; size: number; color: typeof INK }[] = [
    { text: `Signed by ${options.signerName}`, font: bold, size: Math.min(11, rect.height * 0.28), color: INK },
    { text: options.date, font: regular, size: Math.min(9, rect.height * 0.22), color: FAINT },
  ];
  if (options.integrityHashHex) {
    lines.push({ text: `Hash: ${options.integrityHashHex.slice(0, 16)}…`, font: regular, size: Math.min(7, rect.height * 0.18), color: FAINT });
  }

  let cursorY = rect.y + rect.height - padding;
  for (const line of lines) {
    cursorY -= line.size;
    page.drawText(line.text, { x: rect.x + padding, y: cursorY, size: line.size, font: line.font, color: line.color });
    cursorY -= line.size * 0.45;
  }

  return finish(doc);
}

/** SHA-256 of the document's exact current bytes, hex-encoded — a local tamper-evidence aid (see placeSignedTimestamp), not a legal digital signature. */
export async function computeIntegrityHash(source: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", source as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
