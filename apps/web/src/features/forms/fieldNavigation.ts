import type { FormFieldInfo } from "@pdfloom/core";
import { getUniqueFields } from "./validation";

// Plain module state, not store state: this is ephemeral "which field did
// the user last touch" tracking for Next/Previous navigation, not app data
// (no undo/redo or persistence implications), and reading
// document.activeElement at click time doesn't work — clicking the
// Next/Previous toolbar button itself moves focus to that button first, so
// by the time the click handler runs the active element is always the
// button, not the field the user was just in. FormFieldOverlay's onFocus
// handlers keep this current instead.
let lastFocusedFieldName: string | null = null;

export function notifyFieldFocused(name: string): void {
  lastFocusedFieldName = name;
}

function currentFieldIndex(fields: FormFieldInfo[]): number {
  if (!lastFocusedFieldName) return -1;
  return fields.findIndex((f) => f.name === lastFocusedFieldName);
}

/**
 * Waits for a field's live input to actually be in the DOM before focusing
 * it — needed because jumping to a field on a different page means waiting
 * for that page's PageCanvas (and its FormFieldOverlay's own async
 * pdfRectToScreenRect resolution) to mount, which has no single "ready"
 * event to await. Polls instead of a fixed delay so it works the same in
 * continuous, single-page, and two-page scroll modes regardless of how
 * long each happens to take to render.
 */
function waitForFieldElement(name: string, timeoutMs = 2000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const match = Array.from(document.querySelectorAll<HTMLElement>("[data-field-name]")).find((el) => el.dataset.fieldName === name);
      if (match) {
        resolve(match);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      requestAnimationFrame(poll);
    };
    poll();
  });
}

/**
 * Moves keyboard focus to the next (or previous) fillable field in
 * document order, jumping pages if needed. Mirrors Acrobat's field-to-field
 * navigation, which today's fill overlay had no equivalent for — a filled
 * or blank form was otherwise pure "click whatever field you happen to see."
 */
export async function focusAdjacentField(
  allFields: FormFieldInfo[],
  direction: 1 | -1,
  setCurrentPage: (page: number) => void,
): Promise<void> {
  const fields = getUniqueFields(allFields);
  if (fields.length === 0) return;
  const current = currentFieldIndex(fields);
  const nextIndex = current === -1 ? (direction === 1 ? 0 : fields.length - 1) : (current + direction + fields.length) % fields.length;
  const target = fields[nextIndex];
  setCurrentPage(target.pageIndex + 1);
  const el = await waitForFieldElement(target.name);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
  lastFocusedFieldName = target.name;
}
