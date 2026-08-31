export type DropEdge = "before" | "after";

/**
 * Removes `sourcePage` and re-inserts it immediately before/after
 * `targetPage`, in the requested edge — direction-independent (dragging
 * page 2 onto page 5's left half always lands it right before page 5,
 * regardless of whether the drag went forward or backward), unlike naively
 * inserting at the target's pre-removal index, which put the source
 * *after* the target on a forward drag but *before* it on a backward one.
 * All page numbers are 1-based; the returned order is 0-based indices,
 * matching what the reorderPages worker call expects.
 */
export function reorderByEdge(pageNumbers: number[], sourcePage: number, targetPage: number, edge: DropEdge): number[] {
  const order = pageNumbers.map((p) => p - 1);
  const fromIdx = order.indexOf(sourcePage - 1);
  order.splice(fromIdx, 1);
  const targetIdx = order.indexOf(targetPage - 1);
  const insertAt = edge === "before" ? targetIdx : targetIdx + 1;
  order.splice(insertAt, 0, sourcePage - 1);
  return order;
}
