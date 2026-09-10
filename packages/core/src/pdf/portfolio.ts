import { PDFDocument, PDFName } from "pdf-lib";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}

export interface PortfolioFile {
  name: string;
  bytes: Uint8Array;
  mimeType?: string;
}

/**
 * Bundles arbitrary files — any type, not just PDFs — into the document as
 * real PDF file attachments and marks it as a PDF Portfolio, so a viewer
 * that understands portfolios (Acrobat, etc.) shows a file-navigator UI
 * for it rather than just page content.
 *
 * pdf-lib's own `attach()` handles the actual embedded-file mechanics
 * (the /Filespec dict, the /EF stream, and — on save() — the whole
 * /Names /EmbeddedFiles name tree and catalog /AF array) with zero manual
 * object-graph work. pdf-lib has no concept of the PDF spec's /Collection
 * dictionary at all (the thing that actually flags a PDF as a portfolio,
 * distinct from a PDF that merely has attachments) — that part is built
 * by hand from pdf-lib's public low-level primitives (PDFName, catalog.set,
 * context.obj), the exact same primitives pdf-lib's own internals use to
 * build the /EmbeddedFiles tree. Deliberately minimal: no /Schema or
 * per-file /CI dicts (column definitions, custom sort order) — a bare
 * {Type: "Collection"} is spec-valid and every viewer falls back to
 * sensible default columns (name/size/modified) without it.
 */
export async function attachFiles(source: Uint8Array, files: PortfolioFile[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error("attachFiles requires at least one file");
  const doc = await loadForMutation(source);

  for (const file of files) {
    await doc.attach(file.bytes, file.name, file.mimeType ? { mimeType: file.mimeType } : {});
  }

  if (!doc.catalog.has(PDFName.of("Collection"))) {
    doc.catalog.set(PDFName.of("Collection"), doc.context.obj({ Type: "Collection" }));
  }

  return doc.save();
}
