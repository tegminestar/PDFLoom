import type { DocBlock, InlineRun } from "@pdfloom/core";

/** Walks inline children (text, <b>/<strong>, <i>/<em>, <code>, <br>, <a>) into styled runs. Nesting flattens to whichever single style applies at each leaf — matches the engine's own single-style-per-run model. */
function collectInlineRuns(node: Node, inherited: { bold?: boolean; italic?: boolean; code?: boolean } = {}): InlineRun[] {
  const runs: InlineRun[] = [];
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? "").replace(/\s+/g, " ");
      if (text.length > 0) runs.push({ text, ...inherited });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") {
      runs.push({ text: "\n" });
      continue;
    }
    if (tag === "b" || tag === "strong") {
      runs.push(...collectInlineRuns(el, { ...inherited, bold: true }));
    } else if (tag === "i" || tag === "em") {
      runs.push(...collectInlineRuns(el, { ...inherited, italic: true }));
    } else if (tag === "code") {
      runs.push(...collectInlineRuns(el, { ...inherited, code: true }));
    } else {
      // Unknown inline element (span, a, etc.) — keep its text, drop the wrapper semantics (best-effort).
      runs.push(...collectInlineRuns(el, inherited));
    }
  }
  return runs;
}

function textRuns(el: Element): InlineRun[] {
  const runs = collectInlineRuns(el);
  return runs.length > 0 ? runs : [{ text: "" }];
}

/**
 * Walks a parsed HTML document's <body> into the same DocBlock[] structure
 * the Markdown parser produces, so both converters share one PDF layout
 * engine (blocksToPdf). Covers headings, paragraphs, lists, <pre>/<code>
 * blocks, and <hr> — the common subset of a real document; layout,
 * embedded images, tables, and CSS styling are intentionally out of scope
 * for a client-side, non-headless-browser converter.
 */
export function parseHtmlToBlocks(html: string): DocBlock[] {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const blocks: DocBlock[] = [];

  function walk(node: Node): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim().length > 0) {
          blocks.push({ type: "paragraph", runs: [{ text: (child.textContent ?? "").trim() }] });
        }
        continue;
      }
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(3, Number.parseInt(tag[1]!, 10)) as 1 | 2 | 3;
        blocks.push({ type: "heading", level, runs: textRuns(el) });
      } else if (tag === "p") {
        blocks.push({ type: "paragraph", runs: textRuns(el) });
      } else if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        let index = 1;
        for (const li of Array.from(el.children)) {
          if (li.tagName.toLowerCase() !== "li") continue;
          blocks.push({ type: "listItem", ordered, marker: String(index), runs: textRuns(li) });
          index++;
        }
      } else if (tag === "pre") {
        blocks.push({ type: "code", text: el.textContent ?? "" });
      } else if (tag === "hr") {
        blocks.push({ type: "hr" });
      } else if (tag === "blockquote") {
        blocks.push({ type: "paragraph", runs: textRuns(el) });
      } else if (tag === "br") {
        // handled as part of inline runs elsewhere; skip as a block
      } else if (["script", "style", "head", "meta", "link"].includes(tag)) {
        // never render document machinery as visible content
      } else {
        // Generic container (div, section, article, span-as-block, etc.) — recurse into it.
        walk(el);
      }
    }
  }

  walk(parsed.body);
  return blocks;
}
