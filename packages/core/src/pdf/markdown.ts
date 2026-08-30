import { blocksToPdf, type CreateDocumentOptions, type DocBlock, type InlineRun } from "./create-document";

/** Splits a line of Markdown inline syntax (bold, italic, inline code) into styled runs. Nesting isn't supported — this is a practical subset, not a full CommonMark inline parser. */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Order matters: match code spans first so ** inside `code` isn't treated as bold.
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) runs.push({ text: text.slice(lastIndex, match.index) });
    if (match[1] !== undefined) runs.push({ text: match[1], code: true });
    else if (match[2] !== undefined) runs.push({ text: match[2], bold: true });
    else if (match[3] !== undefined) runs.push({ text: match[3], italic: true });
    else if (match[4] !== undefined) runs.push({ text: match[4], italic: true });
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) runs.push({ text: text.slice(lastIndex) });
  return runs.length > 0 ? runs : [{ text: "" }];
}

const ATX_HEADING = /^(#{1,6})\s+(.*)$/;
const UNORDERED_ITEM = /^[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^(\d+)\.\s+(.*)$/;
const HR = /^(-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```/;

/**
 * A practical, dependency-free Markdown → block-list parser covering ATX
 * headings, paragraphs (with inline bold/italic/code), unordered/ordered
 * lists, fenced code blocks, and horizontal rules — the common subset that
 * covers the vast majority of real-world Markdown notes/READMEs. Not a full
 * CommonMark implementation (no nested lists, tables, blockquotes, images,
 * or link targets — links render as their visible text only).
 */
export function parseMarkdownToBlocks(markdown: string): DocBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: DocBlock[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: "paragraph", runs: parseInline(paragraphLines.join(" ")) });
    paragraphLines = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      i++;
      continue;
    }

    if (FENCE.test(trimmed)) {
      flushParagraph();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!.trim())) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ type: "code", text: codeLines.join("\n") });
      continue;
    }

    if (HR.test(trimmed)) {
      flushParagraph();
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const heading = ATX_HEADING.exec(trimmed);
    if (heading) {
      flushParagraph();
      const level = Math.min(3, heading[1]!.length) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, runs: parseInline(heading[2]!.trim()) });
      i++;
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(trimmed);
    if (unordered) {
      flushParagraph();
      blocks.push({ type: "listItem", ordered: false, marker: "•", runs: parseInline(unordered[1]!) });
      i++;
      continue;
    }

    const ordered = ORDERED_ITEM.exec(trimmed);
    if (ordered) {
      flushParagraph();
      blocks.push({ type: "listItem", ordered: true, marker: ordered[1]!, runs: parseInline(ordered[2]!) });
      i++;
      continue;
    }

    paragraphLines.push(trimmed);
    i++;
  }
  flushParagraph();

  return blocks;
}

/** Parses Markdown and lays it out into a PDF in one call — the convenience entry point exposed to the UI/worker. */
export async function markdownToPdf(markdown: string, options: CreateDocumentOptions = {}): Promise<Uint8Array> {
  return blocksToPdf(parseMarkdownToBlocks(markdown), options);
}
