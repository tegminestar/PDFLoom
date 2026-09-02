import { Document, HeadingLevel, PageBreak, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";

/**
 * Best-effort PDF → Office export: pdf.js text extraction (per page, via
 * PdfDocument.getFullPageText — already used by search) is all a purely
 * client-side converter has to work with. There's no layout/column/table
 * analysis here, so output is plain paragraphs (DOCX), one naive
 * space/tab-delimited row per line (XLSX), or one slide per page (PPTX) —
 * not a layout-preserving conversion. The UI must say so; see
 * ExportOfficeDialog's description copy.
 *
 * pptxgenjs pulls in image-size, which has open, currently unpatched DoS
 * advisories in its ICNS/JXL/HEIF parsers (CVE-2025-71329/71330) — not
 * reachable here, since buildPptx below is text-only and never calls
 * addImage. Re-check this note if image slides are ever added.
 */

export async function buildDocx(pages: string[], title?: string): Promise<Blob> {
  const children: Paragraph[] = [];
  if (title) children.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE }));

  pages.forEach((pageText, pageIndex) => {
    if (pageIndex > 0) children.push(new Paragraph({ children: [new PageBreak()] }));
    const lines = pageText.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      children.push(new Paragraph({ text: "" }));
    } else {
      for (const line of lines) children.push(new Paragraph({ text: line }));
    }
  });

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

/** Naive column detection: splits a line on a tab or 2+ consecutive spaces — good enough for text that was already loosely tabular, honest about not being real table extraction otherwise. */
function splitIntoCells(line: string): string[] {
  const cells = line
    .split(/\t| {2,}/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return cells.length > 0 ? cells : [line];
}

export async function buildXlsx(pages: string[]): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  pages.forEach((pageText, pageIndex) => {
    const sheet = workbook.addWorksheet(`Page ${pageIndex + 1}`);
    const lines = pageText.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) sheet.addRow(splitIntoCells(line));
    if (lines.length === 0) sheet.addRow([""]);
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function buildPptx(pages: string[], title?: string): Promise<Blob> {
  const pptx = new PptxGenJS();
  pages.forEach((pageText, pageIndex) => {
    const slide = pptx.addSlide();
    const lines = pageText.split("\n").filter((l) => l.trim().length > 0);
    const useTitle = pageIndex === 0 && title;
    const heading = useTitle ? title : (lines[0] ?? `Page ${pageIndex + 1}`);
    const bodyLines = useTitle ? lines : lines.slice(1);
    slide.addText(heading, { x: 0.5, y: 0.35, w: "90%", h: 0.9, fontSize: 24, bold: true });
    if (bodyLines.length > 0) {
      slide.addText(bodyLines.join("\n"), { x: 0.5, y: 1.3, w: "90%", h: 4.5, fontSize: 14, valign: "top" });
    }
  });
  const blob = await pptx.write({ outputType: "blob" });
  return blob as Blob;
}
