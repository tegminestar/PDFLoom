import type { FormFieldInfo, FormFieldValue } from "@pdfloom/core";

/**
 * Whether a field counts as "empty" for required-field purposes — checked
 * per-type since "empty" means something different for each (an unchecked
 * required checkbox, same as e.g. a required "I agree to terms" box in an
 * HTML form; no option picked for a radio group/dropdown/option list; an
 * empty/whitespace-only string for text).
 */
export function isFieldValueMissing(type: FormFieldInfo["type"], value: FormFieldValue | undefined): boolean {
  if (type === "checkbox") return value !== true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value !== "string" || value.trim() === "";
}

/**
 * Every required field that's still empty, one entry per field name (not
 * per widget — a radio group's options each get their own FormFieldInfo
 * entry sharing one name, so naively checking every entry would report the
 * same missing field several times).
 */
export function getMissingRequiredFields(fields: FormFieldInfo[], values: Record<string, FormFieldValue>): FormFieldInfo[] {
  const seen = new Set<string>();
  const missing: FormFieldInfo[] = [];
  for (const field of fields) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    if (field.required && isFieldValueMissing(field.type, values[field.name])) missing.push(field);
  }
  return missing;
}

/**
 * One entry per field name, in document order — the list Next/Previous
 * field navigation and the fill-progress indicator both walk, deduped the
 * same way getMissingRequiredFields is (a radio group's widgets all share
 * one name and must count as a single field, not one per option).
 */
export function getUniqueFields(fields: FormFieldInfo[]): FormFieldInfo[] {
  const seen = new Set<string>();
  const unique: FormFieldInfo[] = [];
  for (const field of fields) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    unique.push(field);
  }
  return unique;
}

/** How many of the document's distinct fields (any type, not just required) currently have a value. */
export function getFieldFillProgress(fields: FormFieldInfo[], values: Record<string, FormFieldValue>): { filled: number; total: number } {
  const unique = getUniqueFields(fields);
  const filled = unique.filter((f) => !isFieldValueMissing(f.type, values[f.name])).length;
  return { filled, total: unique.length };
}
