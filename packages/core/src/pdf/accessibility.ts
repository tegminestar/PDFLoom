import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFStream } from "pdf-lib";

export interface PageImageInfo {
  pageIndex: number;
  /** The resource name this image is registered under in the page's /Resources /XObject dict (e.g. "Im1") — the stable handle used to set its alt text later. */
  resourceName: string;
  widthPx: number;
  heightPx: number;
  /**
   * Raw encoded bytes + a browser-decodable MIME type, when the image's
   * PDF filter is one browsers can decode natively (currently DCTDecode/
   * JPEG only) — null when the filter is something else (FlateDecode raw
   * samples, CCITT, JBIG2, JPX...), which would need PDF-specific decode
   * logic this doesn't attempt. Deliberately honest about the gap rather
   * than a silently-wrong decode: the caller should skip images where
   * this is null, not guess at their content.
   */
  decodable: { bytes: Uint8Array; mimeType: string } | null;
  /** Any /Alt already set on this image (e.g. from a previous run of this same feature) — null if none. Lets a re-scan show what's already there instead of only ever proposing a fresh guess. */
  existingAltText: string | null;
}

/**
 * A PDF stream's /Filter is either a single name or an array of names
 * (applied in order) — this always returns the flat list.
 *
 * dict.lookupMaybe(key, PDFArray) is NOT a safe "is it an array?" check
 * here: it only returns undefined when the entry is *absent* — when it's
 * present but a different type (the common case: /Filter as a bare
 * PDFName), it throws UnexpectedObjectTypeError instead. Branch on the
 * resolved object's actual class instead of relying on that.
 */
function filterNames(dict: PDFDict): string[] {
  const resolved = dict.lookup(PDFName.of("Filter"));
  if (!resolved) return [];
  if (resolved instanceof PDFArray) return resolved.asArray().map((f) => f.toString());
  return [resolved.toString()];
}

function pageImages(doc: PDFDocument, pageIndex: number): PageImageInfo[] {
  const page = doc.getPage(pageIndex);
  const resources = page.node.Resources();
  const xObjectDict = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xObjectDict) return [];

  const images: PageImageInfo[] = [];
  for (const [key, ref] of xObjectDict.entries()) {
    const stream = doc.context.lookupMaybe(ref, PDFStream);
    if (!stream) continue;
    const dict = stream.dict;
    if (dict.get(PDFName.of("Subtype"))?.toString() !== "/Image") continue;

    const widthPx = Number(dict.get(PDFName.of("Width"))?.toString() ?? "0");
    const heightPx = Number(dict.get(PDFName.of("Height"))?.toString() ?? "0");
    const filters = filterNames(dict);
    const isJpeg = filters[filters.length - 1] === "/DCTDecode";
    const existingAlt = dict.lookup(PDFName.of("Alt"));

    images.push({
      pageIndex,
      resourceName: key.toString().replace(/^\//, ""),
      widthPx,
      heightPx,
      decodable: isJpeg ? { bytes: stream.getContents(), mimeType: "image/jpeg" } : null,
      existingAltText: existingAlt && "decodeText" in existingAlt && typeof existingAlt.decodeText === "function" ? existingAlt.decodeText() : null,
    });
  }
  return images;
}

/** Lists every image XObject across every page, with browser-decodable raw bytes where possible (see PageImageInfo.decodable) — one document load for the whole document. */
export async function listAllPageImages(source: Uint8Array): Promise<PageImageInfo[][]> {
  const doc = await PDFDocument.load(source, { updateMetadata: false });
  return doc.getPages().map((_, pageIndex) => pageImages(doc, pageIndex));
}

export interface ImageAltTextUpdate {
  pageIndex: number;
  resourceName: string;
  altText: string;
}

/** Sets (or replaces) the /Alt entry — the same alternate-text mechanism most PDF authoring tools attach to a Figure's tagged image — on every given image XObject, in a single load+save. */
export async function applyImageAltText(source: Uint8Array, updates: ImageAltTextUpdate[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(source, { updateMetadata: false });

  for (const { pageIndex, resourceName, altText } of updates) {
    const page = doc.getPage(pageIndex);
    const resources = page.node.Resources();
    const xObjectDict = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const ref = xObjectDict?.get(PDFName.of(resourceName));
    const stream = ref ? doc.context.lookupMaybe(ref, PDFStream) : undefined;
    if (!stream) throw new Error(`No image resource named "${resourceName}" on page ${pageIndex + 1}`);
    stream.dict.set(PDFName.of("Alt"), PDFHexString.fromText(altText));
  }

  return doc.save();
}
