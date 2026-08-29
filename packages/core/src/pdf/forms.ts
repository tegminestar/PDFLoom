import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  rgb,
  type PDFField,
  type PDFPage,
} from "pdf-lib";

async function loadForMutation(source: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(source);
}
async function finish(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save();
}

export type FormFieldType = "text" | "checkbox" | "radio" | "dropdown" | "optionList" | "button" | "signature" | "unknown";

export interface FormFieldInfo {
  /** Fully-qualified field name — the key used by fillFormFields. */
  name: string;
  type: FormFieldType;
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  value: string | boolean | string[] | null;
  options?: string[];
  multiline?: boolean;
  required?: boolean;
  readOnly?: boolean;
}

function classifyField(field: PDFField): FormFieldType {
  if (field instanceof PDFTextField) return "text";
  if (field instanceof PDFCheckBox) return "checkbox";
  if (field instanceof PDFRadioGroup) return "radio";
  if (field instanceof PDFDropdown) return "dropdown";
  if (field instanceof PDFOptionList) return "optionList";
  if (field instanceof PDFSignature) return "signature";
  if (field instanceof PDFButton) return "button";
  return "unknown";
}

function fieldValue(field: PDFField): FormFieldInfo["value"] {
  if (field instanceof PDFTextField) return field.getText() ?? "";
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFRadioGroup) return field.getSelected() ?? null;
  if (field instanceof PDFDropdown) return field.getSelected();
  if (field instanceof PDFOptionList) return field.getSelected();
  return null;
}

function pageIndexForRef(pages: PDFPage[], ref: unknown): number {
  return pages.findIndex((p) => p.ref === ref);
}

/**
 * Lists every fillable field's widgets (one entry per on-page location — a
 * field can have more than one widget if it's rendered on multiple pages),
 * with enough info to render a positioned interactive overlay: which page,
 * where on that page, and its current value.
 */
export async function listFormFields(source: Uint8Array): Promise<FormFieldInfo[]> {
  const doc = await loadForMutation(source);
  let form;
  try {
    form = doc.getForm();
  } catch {
    return [];
  }
  const pages = doc.getPages();
  const results: FormFieldInfo[] = [];

  for (const field of form.getFields()) {
    const type = classifyField(field);
    const name = field.getName();
    const value = fieldValue(field);
    const options =
      field instanceof PDFDropdown || field instanceof PDFRadioGroup || field instanceof PDFOptionList ? field.getOptions() : undefined;
    const multiline = field instanceof PDFTextField ? field.isMultiline() : undefined;
    const required = field.isRequired();
    const readOnly = field.isReadOnly();

    for (const widget of field.acroField.getWidgets()) {
      const pageRef = widget.P();
      const pageIndex = pageRef ? pageIndexForRef(pages, pageRef) : -1;
      if (pageIndex === -1) continue; // orphaned widget with no resolvable page; skip rather than guess
      results.push({
        name,
        type,
        pageIndex,
        rect: widget.getRectangle(),
        value,
        ...(options ? { options } : {}),
        ...(multiline !== undefined ? { multiline } : {}),
        required,
        readOnly,
      });
    }
  }

  return results;
}

export type FormFieldValue = string | boolean | string[];

/** Sets values on existing fields by name and re-saves. Unknown/missing field names are skipped, not errors — callers may pass a superset intended for other documents in a batch flow. */
export async function fillFormFields(source: Uint8Array, values: Record<string, FormFieldValue>): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;

    if (field instanceof PDFTextField && typeof value === "string") {
      field.setText(value);
    } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
      if (value) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup && typeof value === "string") {
      field.select(value);
    } else if (field instanceof PDFDropdown) {
      field.select(value as string | string[]);
    } else if (field instanceof PDFOptionList) {
      field.select(value as string | string[]);
    }
  }

  return finish(doc);
}

export interface FlattenFormOptions {
  /** Regenerate every field's appearance from its current value before flattening (recommended — off can leave stale-looking flattened text). */
  updateAppearances?: boolean;
}

export async function flattenForm(source: Uint8Array, options: FlattenFormOptions = {}): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();
  form.flatten({ updateFieldAppearances: options.updateAppearances ?? true });
  return finish(doc);
}

// --- Field designer: creating new fields ------------------------------------

export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FIELD_BORDER = rgb(0.6, 0.6, 0.63);

export interface CreateTextFieldOptions {
  name: string;
  pageIndex: number;
  rect: FieldRect;
  defaultValue?: string;
  multiline?: boolean;
}

export async function createTextField(source: Uint8Array, options: CreateTextFieldOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();
  const page = doc.getPage(options.pageIndex);
  const field = form.createTextField(options.name);
  if (options.multiline) field.enableMultiline();
  if (options.defaultValue) field.setText(options.defaultValue);
  field.addToPage(page, { ...options.rect, borderColor: FIELD_BORDER, borderWidth: 1 });
  return finish(doc);
}

export interface CreateCheckBoxOptions {
  name: string;
  pageIndex: number;
  rect: FieldRect;
  defaultChecked?: boolean;
}

export async function createCheckBox(source: Uint8Array, options: CreateCheckBoxOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();
  const page = doc.getPage(options.pageIndex);
  const field = form.createCheckBox(options.name);
  field.addToPage(page, { ...options.rect, borderColor: FIELD_BORDER, borderWidth: 1 });
  if (options.defaultChecked) field.check();
  return finish(doc);
}

export interface CreateRadioGroupOptions {
  name: string;
  pageIndex: number;
  /** One widget per option, each with its own on-page rect. */
  options: { label: string; rect: FieldRect }[];
  defaultSelected?: string;
}

export async function createRadioGroup(source: Uint8Array, options: CreateRadioGroupOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();
  const page = doc.getPage(options.pageIndex);
  const field = form.createRadioGroup(options.name);
  for (const opt of options.options) {
    field.addOptionToPage(opt.label, page, { ...opt.rect, borderColor: FIELD_BORDER, borderWidth: 1 });
  }
  if (options.defaultSelected) field.select(options.defaultSelected);
  return finish(doc);
}

export interface CreateDropdownOptions {
  name: string;
  pageIndex: number;
  rect: FieldRect;
  options: string[];
  defaultSelected?: string;
}

export async function createDropdown(source: Uint8Array, options: CreateDropdownOptions): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();
  const page = doc.getPage(options.pageIndex);
  const field = form.createDropdown(options.name);
  field.addOptions(options.options);
  if (options.defaultSelected) field.select(options.defaultSelected);
  field.addToPage(page, { ...options.rect, borderColor: FIELD_BORDER, borderWidth: 1 });
  return finish(doc);
}

export async function removeField(source: Uint8Array, fieldName: string): Promise<Uint8Array> {
  const doc = await loadForMutation(source);
  const form = doc.getForm();
  form.removeField(form.getField(fieldName));
  return finish(doc);
}
