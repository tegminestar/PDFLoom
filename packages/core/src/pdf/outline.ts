import { PDFContext, PDFDict, PDFName, PDFNumber, PDFRef, PDFString, PDFDocument } from "pdf-lib";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source, { updateMetadata: false });
}

/**
 * Appends a new top-level bookmark pointing at the given page, as a sibling
 * after whatever outline entries already exist (if any) — nothing about the
 * existing tree is read or altered.
 *
 * Deliberately additive-only: pdf.js (which OutlinePanel's read side uses)
 * and pdf-lib (this write side) are two independent parsers with no shared
 * node identity, so there's no reliable way to say "this OutlineNode the
 * user is looking at is *this* dictionary in pdf-lib's object graph" for a
 * rename/delete/reorder of an *existing* entry without real risk of editing
 * the wrong node on an unusually-structured file. Appending a brand-new
 * sibling has no such ambiguity — it only ever adds a new leaf.
 */
export async function addOutlineEntry(source: Uint8Array, title: string, pageIndex: number): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const context = doc.context;
  const pages = doc.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) throw new Error(`Page ${pageIndex + 1} is out of range for a ${pages.length}-page document`);
  const pageRef = pages[pageIndex]!.ref;

  const catalog = doc.catalog;
  const OutlinesKey = PDFName.of("Outlines");
  let outlinesRef = catalog.get(OutlinesKey) as PDFRef | undefined;
  let outlinesDict: PDFDict;
  if (outlinesRef instanceof PDFRef) {
    outlinesDict = context.lookup(outlinesRef, PDFDict);
  } else {
    outlinesDict = context.obj({ Type: "Outlines" });
    outlinesRef = context.register(outlinesDict);
    catalog.set(OutlinesKey, outlinesRef);
  }

  // [page, /XYZ, left, top, zoom] with left/top/zoom null means "keep the
  // viewer's current position/zoom, just switch to this page" — the same
  // minimal destination form real-world PDFs commonly use for a plain
  // page-level bookmark.
  const dest = context.obj([pageRef, "XYZ", null, null, null]);
  const itemDict: PDFDict = context.obj({ Title: PDFString.of(title), Parent: outlinesRef, Dest: dest });
  const itemRef = context.register(itemDict);

  const LastKey = PDFName.of("Last");
  const lastRef = outlinesDict.get(LastKey) as PDFRef | undefined;
  if (lastRef instanceof PDFRef) {
    const lastDict = context.lookup(lastRef, PDFDict);
    lastDict.set(PDFName.of("Next"), itemRef);
    itemDict.set(PDFName.of("Prev"), lastRef);
  } else {
    outlinesDict.set(PDFName.of("First"), itemRef);
  }
  outlinesDict.set(LastKey, itemRef);

  const CountKey = PDFName.of("Count");
  const countObj = outlinesDict.get(CountKey);
  const currentCount = countObj instanceof PDFNumber ? countObj.asNumber() : 0;
  outlinesDict.set(CountKey, PDFNumber.of(currentCount + 1));

  return doc.save();
}

function getOutlinesDict(doc: PDFDocument): PDFDict {
  const outlinesRef = doc.catalog.get(PDFName.of("Outlines"));
  if (!(outlinesRef instanceof PDFRef)) throw new Error("This document has no bookmarks.");
  return doc.context.lookup(outlinesRef, PDFDict);
}

/** Walks the /First → /Next linked list to find the ref of the Nth (0-based) top-level bookmark — the same order pdf.js's getOutline() reports them in, since both simply follow this list front to back. */
function nthTopLevelItemRef(context: PDFContext, outlinesDict: PDFDict, index: number): PDFRef | undefined {
  let currentRef = outlinesDict.get(PDFName.of("First"));
  let i = 0;
  while (currentRef instanceof PDFRef) {
    if (i === index) return currentRef;
    const dict = context.lookup(currentRef, PDFDict);
    currentRef = dict.get(PDFName.of("Next"));
    i++;
  }
  return undefined;
}

/**
 * Renames the Nth top-level bookmark. Callers are responsible for only ever
 * passing an index they know refers to a bookmark PDFLoom itself created
 * earlier in the same session (see OutlinePanel) — see addOutlineEntry's
 * docstring for why arbitrary pre-existing bookmarks aren't safe to target
 * this way.
 */
export async function renameOutlineEntry(source: Uint8Array, topLevelIndex: number, title: string): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const outlinesDict = getOutlinesDict(doc);
  const itemRef = nthTopLevelItemRef(doc.context, outlinesDict, topLevelIndex);
  if (!itemRef) throw new Error("Bookmark not found.");
  const itemDict = doc.context.lookup(itemRef, PDFDict);
  itemDict.set(PDFName.of("Title"), PDFString.of(title));
  return doc.save();
}

/** Deletes the Nth top-level bookmark, relinking its former neighbors' Prev/Next so the list stays valid. Same caller-responsibility note as renameOutlineEntry. */
export async function deleteOutlineEntry(source: Uint8Array, topLevelIndex: number): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const context = doc.context;
  const outlinesDict = getOutlinesDict(doc);
  const itemRef = nthTopLevelItemRef(context, outlinesDict, topLevelIndex);
  if (!itemRef) throw new Error("Bookmark not found.");
  const itemDict = context.lookup(itemRef, PDFDict);

  const PrevKey = PDFName.of("Prev");
  const NextKey = PDFName.of("Next");
  const prevRef = itemDict.get(PrevKey);
  const nextRef = itemDict.get(NextKey);

  if (prevRef instanceof PDFRef) {
    const prevDict = context.lookup(prevRef, PDFDict);
    if (nextRef instanceof PDFRef) prevDict.set(NextKey, nextRef);
    else prevDict.delete(NextKey);
  } else if (nextRef instanceof PDFRef) {
    outlinesDict.set(PDFName.of("First"), nextRef);
  } else {
    outlinesDict.delete(PDFName.of("First"));
  }

  if (nextRef instanceof PDFRef) {
    const nextDict = context.lookup(nextRef, PDFDict);
    if (prevRef instanceof PDFRef) nextDict.set(PrevKey, prevRef);
    else nextDict.delete(PrevKey);
  } else if (prevRef instanceof PDFRef) {
    outlinesDict.set(PDFName.of("Last"), prevRef);
  } else {
    outlinesDict.delete(PDFName.of("Last"));
  }

  const CountKey = PDFName.of("Count");
  const countObj = outlinesDict.get(CountKey);
  const currentCount = countObj instanceof PDFNumber ? countObj.asNumber() : 1;
  outlinesDict.set(CountKey, PDFNumber.of(Math.max(0, currentCount - 1)));

  return doc.save();
}
