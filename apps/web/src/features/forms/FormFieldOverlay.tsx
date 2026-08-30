import type { PdfDocument } from "@pdfloom/core";
import { cn } from "@pdfloom/ui";
import { useEffect, useState } from "react";
import { useLoomStore } from "../../app/store";

export interface FormFieldOverlayProps {
  doc: PdfDocument;
  pageNumber: number;
  scale: number;
  rotation: 0 | 90 | 180 | 270;
}

// Fixed (not theme-dependent) dark text on a light indigo tint: the page
// canvas underneath is always white/paper-colored regardless of app theme,
// so using the theme's `text-text` token here would go near-white-on-light
// in dark mode — illegible. This is styling *content drawn on the page*,
// not app chrome.
const inputClass = cn(
  "absolute rounded-[2px] border border-primary/50 bg-primary-muted px-1 text-[#16181d] outline-none",
  "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-[--color-focus-ring]",
);

/**
 * Renders real, interactive HTML form controls positioned over a page's
 * AcroForm field widgets — this is what makes form-fill mode actually
 * usable (vs. just detecting fields). Field geometry comes from
 * doc.pdfRectToScreenRect so positions stay correct across zoom/rotation.
 */
export function FormFieldOverlay({ doc, pageNumber, scale, rotation }: FormFieldOverlayProps) {
  const formFillOpen = useLoomStore((s) => s.formFillOpen);
  const formMode = useLoomStore((s) => s.formMode);
  const formFields = useLoomStore((s) => s.formFields);
  const formFieldValues = useLoomStore((s) => s.formFieldValues);
  const setFormFieldValue = useLoomStore((s) => s.setFormFieldValue);

  const fieldsOnPage = formFields.filter((f) => f.pageIndex === pageNumber - 1);
  const [screenRects, setScreenRects] = useState<Map<number, { x: number; y: number; width: number; height: number }>>(new Map());

  useEffect(() => {
    if (!formFillOpen || formMode !== "fill" || fieldsOnPage.length === 0) return;
    let cancelled = false;
    Promise.all(fieldsOnPage.map((f, i) => doc.pdfRectToScreenRect(pageNumber, scale, rotation, f.rect).then((r) => [i, r] as const))).then(
      (entries) => {
        if (!cancelled) setScreenRects(new Map(entries));
      },
    );
    return () => {
      cancelled = true;
    };
    // fieldsOnPage is derived fresh each render from a stable-enough source (formFields only changes on mode enter/doc mutation), so length+doc/scale/rotation is a sufficient dependency signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNumber, scale, rotation, formFillOpen, formMode, fieldsOnPage.length]);

  if (!formFillOpen || formMode !== "fill" || fieldsOnPage.length === 0) return null;

  return (
    <div className="absolute inset-0 z-10">
      {fieldsOnPage.map((field, i) => {
        const rect = screenRects.get(i);
        if (!rect) return null;
        const style = { left: rect.x, top: rect.y, width: rect.width, height: rect.height, fontSize: Math.max(10, rect.height * 0.6) };
        const value = formFieldValues[field.name];

        if (field.type === "text") {
          return field.multiline ? (
            <textarea
              key={`${field.name}-${i}`}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => setFormFieldValue(field.name, e.target.value)}
              disabled={field.readOnly}
              className={cn(inputClass, "resize-none")}
              style={style}
            />
          ) : (
            <input
              key={`${field.name}-${i}`}
              type="text"
              value={typeof value === "string" ? value : ""}
              onChange={(e) => setFormFieldValue(field.name, e.target.value)}
              disabled={field.readOnly}
              className={inputClass}
              style={style}
            />
          );
        }

        if (field.type === "checkbox") {
          return (
            <input
              key={`${field.name}-${i}`}
              type="checkbox"
              checked={typeof value === "boolean" ? value : false}
              onChange={(e) => setFormFieldValue(field.name, e.target.checked)}
              disabled={field.readOnly}
              className="absolute accent-[var(--loom-primary)]"
              style={style}
            />
          );
        }

        if (field.type === "radio") {
          // Every widget for a radio group shares the field name — each
          // FormFieldInfo entry is one option, distinguished by
          // widgetOnValue (the option this specific widget represents).
          if (field.widgetOnValue === undefined) return null;
          return (
            <input
              key={`${field.name}-${i}`}
              type="radio"
              name={field.name}
              checked={value === field.widgetOnValue}
              onChange={() => setFormFieldValue(field.name, field.widgetOnValue!)}
              disabled={field.readOnly}
              className="absolute accent-[var(--loom-primary)]"
              style={style}
            />
          );
        }

        if (field.type === "dropdown" || field.type === "optionList") {
          const selected = Array.isArray(value) ? value[0] : typeof value === "string" ? value : "";
          return (
            <select
              key={`${field.name}-${i}`}
              value={selected}
              onChange={(e) => setFormFieldValue(field.name, e.target.value)}
              disabled={field.readOnly}
              className={inputClass}
              style={style}
            >
              <option value="" disabled>
                —
              </option>
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          );
        }

        return null;
      })}
    </div>
  );
}
