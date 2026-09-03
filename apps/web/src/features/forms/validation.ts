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
