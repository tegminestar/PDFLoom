import { getPdfWorkerClient, parseCsv, type FormFieldInfo, type FormFieldValue } from "@pdfloom/core";
import { Button, Dialog, toast } from "@pdfloom/ui";
import JSZip from "jszip";
import { FileText, Table, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

const TRUTHY = /^(true|yes|y|1|x|checked|on)$/i;

/** A CSV column name matches a field name if they're equal ignoring case, leading/trailing space, and underscore-vs-space (so "First Name" matches "first_name"). */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || "row";
}

/**
 * Fills the same form template once per row of an uploaded spreadsheet —
 * "generate 50 lease applications from this list of tenants" — entirely
 * client-side, same fillFormFields/flattenForm engine the interactive
 * form-fill flow uses, just looped. CSV columns are matched to field names
 * by name (case/whitespace-insensitive) rather than needing a manual
 * mapping step, since spreadsheet headers and PDF field names are usually
 * already close enough — unmatched columns/fields are surfaced as a
 * warning rather than silently ignored, so a typo'd header is noticeable
 * before generating 50 blank fields.
 */
export function MailMergeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [templateFields, setTemplateFields] = useState<FormFieldInfo[] | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [nameColumn, setNameColumn] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const fieldsByNormalizedName = useMemo(() => {
    const map = new Map<string, FormFieldInfo>();
    for (const f of templateFields ?? []) if (!map.has(normalize(f.name))) map.set(normalize(f.name), f);
    return map;
  }, [templateFields]);

  const matchedColumns = useMemo(() => (csv ? csv.headers.filter((h) => fieldsByNormalizedName.has(normalize(h))) : []), [csv, fieldsByNormalizedName]);
  const unmatchedColumns = useMemo(() => (csv ? csv.headers.filter((h) => !fieldsByNormalizedName.has(normalize(h))) : []), [csv, fieldsByNormalizedName]);
  const unmatchedFieldCount = useMemo(() => {
    if (!csv || !templateFields) return 0;
    const matchedNames = new Set(matchedColumns.map(normalize));
    const uniqueFieldNames = new Set(templateFields.map((f) => normalize(f.name)));
    let count = 0;
    for (const name of uniqueFieldNames) if (!matchedNames.has(name)) count++;
    return count;
  }, [csv, templateFields, matchedColumns]);

  const handlePickTemplate = async (file: File | undefined) => {
    if (!file) return;
    setTemplateFile(file);
    setTemplateFields(null);
    try {
      const client = await getPdfWorkerClient();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fields = await client.listFormFields(bytes);
      if (fields.length === 0) {
        toast.warning("No fillable fields found", "This PDF doesn't have an AcroForm — mail merge needs a fillable template.");
      }
      setTemplateFields(fields);
    } catch (error) {
      toast.error("Couldn't read this template", error instanceof Error ? error.message : undefined);
      setTemplateFile(null);
    }
  };

  const handlePickCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
      if (parsed.length < 2) {
        toast.warning("This CSV has no data rows", "The first row is treated as column headers — add at least one row below it.");
        return;
      }
      const [headers, ...rows] = parsed as [string[], ...string[][]];
      setCsv({ headers, rows });
      setNameColumn(headers[0] ?? null);
    } catch (error) {
      toast.error("Couldn't read this CSV", error instanceof Error ? error.message : undefined);
    }
  };

  const handleRun = async () => {
    if (!templateFile || !templateFields || !csv) return;
    setIsRunning(true);
    setProgress({ done: 0, total: csv.rows.length });
    try {
      const client = await getPdfWorkerClient();
      const templateBytes = new Uint8Array(await templateFile.arrayBuffer());
      const zip = new JSZip();
      const usedNames = new Set<string>();
      const nameColumnIndex = nameColumn ? csv.headers.indexOf(nameColumn) : -1;

      for (let rowIndex = 0; rowIndex < csv.rows.length; rowIndex++) {
        const row = csv.rows[rowIndex]!;
        const values: Record<string, FormFieldValue> = {};
        for (const header of matchedColumns) {
          const field = fieldsByNormalizedName.get(normalize(header))!;
          const cell = row[csv.headers.indexOf(header)] ?? "";
          values[field.name] = field.type === "checkbox" ? TRUTHY.test(cell.trim()) : cell;
        }

        let bytes = await client.fillFormFields(templateBytes, values);
        if (flatten) bytes = await client.flattenForm(bytes);

        const baseName = sanitizeFilename(nameColumnIndex >= 0 ? (row[nameColumnIndex] ?? `Row ${rowIndex + 1}`) : `Row ${rowIndex + 1}`);
        let outName = `${baseName}.pdf`;
        let dedupeCount = 2;
        while (usedNames.has(outName)) {
          outName = `${baseName} (${dedupeCount}).pdf`;
          dedupeCount += 1;
        }
        usedNames.add(outName);
        zip.file(outName, bytes);
        setProgress({ done: rowIndex + 1, total: csv.rows.length });
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `pdfloom-mail-merge.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      toast.success("Mail merge complete", `${csv.rows.length} filled PDF${csv.rows.length === 1 ? "" : "s"} downloaded as a zip.`);
      handleClose(false);
    } catch (error) {
      toast.error("Couldn't complete the mail merge", error instanceof Error ? error.message : undefined);
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  };

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTemplateFile(null);
      setTemplateFields(null);
      setCsv(null);
      setNameColumn(null);
    }
    onOpenChange(nextOpen);
  };

  const canRun = !!templateFile && !!templateFields && templateFields.length > 0 && !!csv && matchedColumns.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title="Mail merge"
      description="Fill one form template once per row of a spreadsheet — e.g. 50 lease applications from a list of tenants. Entirely on your device."
      width={520}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={() => handleClose(false)} disabled={isRunning}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" disabled={isRunning || !canRun} onClick={() => void handleRun()}>
            {isRunning ? (progress ? `Filling ${progress.done}/${progress.total}…` : "Filling…") : `Generate ${csv?.rows.length ?? ""} PDF${csv?.rows.length === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-text">1. Template (a fillable PDF)</span>
          {templateFile ? (
            <div className="flex items-center gap-2 rounded-[--radius-sm] border border-border-strong bg-surface p-2">
              <FileText className="h-4 w-4 shrink-0 text-text-faint" />
              <span className="flex-1 truncate text-sm text-text">{templateFile.name}</span>
              <span className="shrink-0 text-xs text-text-faint">{templateFields ? `${new Set(templateFields.map((f) => f.name)).size} fields` : "reading…"}</span>
              <button
                type="button"
                onClick={() => {
                  setTemplateFile(null);
                  setTemplateFields(null);
                  setCsv(null);
                }}
                className="text-text-faint hover:text-text"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => templateInputRef.current?.click()} className="self-start">
              Choose template PDF…
            </Button>
          )}
          <input
            ref={templateInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              void handlePickTemplate(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-text">2. Spreadsheet (.csv — one row per output PDF)</span>
          {csv ? (
            <div className="flex items-center gap-2 rounded-[--radius-sm] border border-border-strong bg-surface p-2">
              <Table className="h-4 w-4 shrink-0 text-text-faint" />
              <span className="flex-1 truncate text-sm text-text">
                {csv.rows.length} row{csv.rows.length === 1 ? "" : "s"}, {csv.headers.length} column{csv.headers.length === 1 ? "" : "s"}
              </span>
              <button type="button" onClick={() => setCsv(null)} className="text-text-faint hover:text-text">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => csvInputRef.current?.click()} disabled={!templateFields} className="self-start">
              Choose CSV…
            </Button>
          )}
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void handlePickCsv(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>

        {csv && templateFields && (
          <div className="flex flex-col gap-2 rounded-[--radius-md] border border-border bg-surface p-3">
            <p className="text-xs text-text-muted">
              Matched {matchedColumns.length} of {csv.headers.length} column{csv.headers.length === 1 ? "" : "s"} to template fields by name.
            </p>
            {unmatchedColumns.length > 0 && (
              <p className="text-xs text-text-faint">Not matched to any field, so ignored: {unmatchedColumns.join(", ")}.</p>
            )}
            {unmatchedFieldCount > 0 && <p className="text-xs text-text-faint">{unmatchedFieldCount} template field(s) have no matching column and will be left as-is.</p>}
            {matchedColumns.length === 0 && (
              <p className="text-xs text-text-faint">No column names matched — rename your CSV's headers to match the template's field names (case and spacing don't matter).</p>
            )}

            <label className="mt-1 flex items-center justify-between gap-2 text-sm text-text">
              Name output files from
              <select
                value={nameColumn ?? ""}
                onChange={(e) => setNameColumn(e.target.value || null)}
                className="h-8 rounded-[--radius-sm] border border-border-strong bg-bg px-2 text-sm text-text outline-none"
              >
                {csv.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-text-muted">
              <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
              Flatten each output (recommended — bakes values in so they can't be accidentally edited later)
            </label>
          </div>
        )}
      </div>
    </Dialog>
  );
}
