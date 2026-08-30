import type { ChatMessage } from "./webllm-chat";

/**
 * The bounded set of document operations the AI command bar can resolve a
 * natural-language request into. Deliberately a curated subset of the
 * engine's full operation surface, not literally everything the app can
 * do — a ~360M-parameter local model reliably naming and parameterizing a
 * small, well-described set of operations is realistic; reliably picking
 * the right one out of dozens, with correct free-form parameters, is not,
 * and a wrong silent choice on someone's document is a real-harm failure
 * mode. Page numbers throughout are 1-based (what a person would type),
 * converted to 0-based indices at the dispatch site in the UI layer.
 */
export type CommandOperation =
  | { operation: "rotatePages"; pages: number[] | "all"; degrees: 90 | -90 | 180 }
  | { operation: "deletePages"; pages: number[] }
  | { operation: "duplicatePage"; page: number }
  | { operation: "insertBlankPage"; atPage: number }
  | { operation: "addTextWatermark"; text: string };

const OPERATION_CATALOG = `Available operations (respond with EXACTLY one, as JSON):
1. {"operation":"rotatePages","pages":[1,2] or "all","degrees":90 or -90 or 180} — rotate pages
2. {"operation":"deletePages","pages":[1,2]} — remove pages
3. {"operation":"duplicatePage","page":1} — duplicate one page
4. {"operation":"insertBlankPage","atPage":1} — insert a blank page before page N
5. {"operation":"addTextWatermark","text":"DRAFT"} — add a text watermark to every page

Examples:
"rotate page 3 clockwise" -> {"operation":"rotatePages","pages":[3],"degrees":90}
"rotate everything 180" -> {"operation":"rotatePages","pages":"all","degrees":180}
"delete pages 2 and 5" -> {"operation":"deletePages","pages":[2,5]}
"duplicate the first page" -> {"operation":"duplicatePage","page":1}
"add a draft watermark" -> {"operation":"addTextWatermark","text":"DRAFT"}
"insert a blank page at the start" -> {"operation":"insertBlankPage","atPage":1}

Respond with ONLY the JSON object — no explanation, no markdown formatting.`;

export function buildCommandPrompt(request: string, pageCount: number): ChatMessage[] {
  return [
    { role: "system", content: `You turn a plain-language request into ONE structured PDF-editing command. This document has ${pageCount} pages.\n\n${OPERATION_CATALOG}` },
    { role: "user", content: request },
  ];
}

/** Extracts the first {...} JSON object from a model response — small models often wrap output in prose or markdown fences despite instructions not to. Returns null (not a guess) if nothing parseable is found. */
export function extractJsonObject(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number" && Number.isInteger(v));
}

export interface ValidationFailure {
  valid: false;
  reason: string;
}
export interface ValidationSuccess {
  valid: true;
  command: CommandOperation;
}

/** Validates a parsed command against the real document (page numbers must exist, degrees must be one of the allowed values, etc.) — a model can name a real operation with an out-of-range page number, so this is checked here, not assumed. */
export function validateCommand(parsed: unknown, pageCount: number): ValidationSuccess | ValidationFailure {
  if (!parsed || typeof parsed !== "object" || !("operation" in parsed)) {
    return { valid: false, reason: "Couldn't understand that as a command." };
  }
  const p = parsed as Record<string, unknown>;
  const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= pageCount;

  switch (p.operation) {
    case "rotatePages": {
      if (p.pages !== "all" && !isNumberArray(p.pages)) return { valid: false, reason: "Which page(s) to rotate wasn't clear." };
      if (p.pages !== "all" && !(p.pages as number[]).every(inRange)) return { valid: false, reason: `This document only has ${pageCount} page${pageCount === 1 ? "" : "s"}.` };
      if (p.degrees !== 90 && p.degrees !== -90 && p.degrees !== 180) return { valid: false, reason: "Rotation amount wasn't clear (expected 90, -90, or 180)." };
      return { valid: true, command: { operation: "rotatePages", pages: p.pages as number[] | "all", degrees: p.degrees } };
    }
    case "deletePages": {
      if (!isNumberArray(p.pages)) return { valid: false, reason: "Which page(s) to delete wasn't clear." };
      if (!(p.pages as number[]).every(inRange)) return { valid: false, reason: `This document only has ${pageCount} page${pageCount === 1 ? "" : "s"}.` };
      if ((p.pages as number[]).length >= pageCount) return { valid: false, reason: "That would delete every page — not doing that automatically." };
      return { valid: true, command: { operation: "deletePages", pages: p.pages as number[] } };
    }
    case "duplicatePage": {
      if (typeof p.page !== "number" || !inRange(p.page)) return { valid: false, reason: "Which page to duplicate wasn't clear." };
      return { valid: true, command: { operation: "duplicatePage", page: p.page } };
    }
    case "insertBlankPage": {
      if (typeof p.atPage !== "number" || !Number.isInteger(p.atPage) || p.atPage < 1 || p.atPage > pageCount + 1) {
        return { valid: false, reason: "Where to insert the blank page wasn't clear." };
      }
      return { valid: true, command: { operation: "insertBlankPage", atPage: p.atPage } };
    }
    case "addTextWatermark": {
      if (typeof p.text !== "string" || !p.text.trim()) return { valid: false, reason: "Watermark text wasn't clear." };
      return { valid: true, command: { operation: "addTextWatermark", text: p.text } };
    }
    default:
      return { valid: false, reason: `"${String(p.operation)}" isn't something the command bar can do yet.` };
  }
}

/** Turns a validated command into a short, human-readable confirmation line — shown before anything is actually applied, since a small local model's interpretation is worth a human's final say. */
export function describeCommand(command: CommandOperation): string {
  switch (command.operation) {
    case "rotatePages":
      return `Rotate ${command.pages === "all" ? "every page" : `page${command.pages.length === 1 ? "" : "s"} ${command.pages.join(", ")}`} by ${command.degrees}°.`;
    case "deletePages":
      return `Delete page${command.pages.length === 1 ? "" : "s"} ${command.pages.join(", ")}.`;
    case "duplicatePage":
      return `Duplicate page ${command.page}.`;
    case "insertBlankPage":
      return `Insert a blank page before page ${command.atPage}.`;
    case "addTextWatermark":
      return `Add "${command.text}" as a watermark on every page.`;
  }
}
