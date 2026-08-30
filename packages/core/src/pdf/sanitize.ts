import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

export interface SanitizeOptions {
  /** Clears Title/Author/Subject/Keywords/Creator/Producer — the fields most likely to contain a real name, username, or internal software/company identifier. */
  clearInfoMetadata?: boolean;
  /** Removes the document's XMP metadata stream (/Metadata on the catalog) — a separate, often-forgotten copy of similar info (and sometimes editing-history hints) that surviving the Info dict alone wouldn't catch. */
  removeXmpMetadata?: boolean;
  /** Removes embedded/attached files (/Names/EmbeddedFiles) — easy to forget a document has these at all. */
  removeEmbeddedFiles?: boolean;
  /** Removes document-level JavaScript (/Names/JavaScript) and a JavaScript /OpenAction (an auto-run-on-open script) — a real, if rare, malware/tracking vector in PDFs. */
  removeJavaScript?: boolean;
}

export interface SanitizeReport {
  clearedInfoMetadata: boolean;
  removedXmpMetadata: boolean;
  removedEmbeddedFileCount: number;
  removedJavaScript: boolean;
}

/**
 * Strips metadata and hidden/embedded data a document may carry beyond its
 * visible page content. Each category is independently opt-in — see
 * SanitizeOptions — and the report tells the caller what was actually
 * found and removed, not just what was requested, so the UI can show an
 * honest "there was nothing to remove" instead of implying something
 * happened when it didn't.
 */
export async function sanitizeDocument(source: Uint8Array, options: SanitizeOptions): Promise<{ bytes: Uint8Array; report: SanitizeReport }> {
  const doc = await loadForMutation(source);
  const report: SanitizeReport = {
    clearedInfoMetadata: false,
    removedXmpMetadata: false,
    removedEmbeddedFileCount: 0,
    removedJavaScript: false,
  };

  if (options.clearInfoMetadata) {
    const hadAny = [doc.getTitle(), doc.getAuthor(), doc.getSubject(), doc.getCreator(), doc.getProducer()].some((v) => !!v) || doc.getKeywords();
    doc.setTitle("");
    doc.setAuthor("");
    doc.setSubject("");
    doc.setKeywords([]);
    doc.setCreator("");
    doc.setProducer("");
    report.clearedInfoMetadata = !!hadAny;
  }

  if (options.removeXmpMetadata) {
    const metadataKey = PDFName.of("Metadata");
    if (doc.catalog.get(metadataKey)) {
      doc.catalog.delete(metadataKey);
      report.removedXmpMetadata = true;
    }
  }

  const namesDict = doc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);

  if (options.removeEmbeddedFiles && namesDict) {
    const embeddedFilesKey = PDFName.of("EmbeddedFiles");
    const embeddedFiles = namesDict.lookupMaybe(embeddedFilesKey, PDFDict);
    if (embeddedFiles) {
      // The name tree's /Names array is a flat [key1, ref1, key2, ref2, ...]
      // list, so each attachment is one key/value pair.
      const namesArray = embeddedFiles.lookupMaybe(PDFName.of("Names"), PDFArray);
      report.removedEmbeddedFileCount = namesArray ? Math.floor(namesArray.size() / 2) : 0;
      namesDict.delete(embeddedFilesKey);
    }
  }

  if (options.removeJavaScript) {
    let removed = false;
    if (namesDict) {
      const jsKey = PDFName.of("JavaScript");
      if (namesDict.get(jsKey)) {
        namesDict.delete(jsKey);
        removed = true;
      }
    }
    const openActionKey = PDFName.of("OpenAction");
    const openAction = doc.catalog.get(openActionKey);
    if (openAction) {
      const resolved = doc.context.lookupMaybe(openAction, PDFDict);
      const subtype = resolved?.get(PDFName.of("S"));
      if (subtype?.toString() === "/JavaScript") {
        doc.catalog.delete(openActionKey);
        removed = true;
      }
    }
    report.removedJavaScript = removed;
  }

  return { bytes: await finish(doc), report };
}
