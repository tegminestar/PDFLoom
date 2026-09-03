/**
 * Parses CSV text into rows of string cells, per RFC 4180: a field wrapped
 * in double quotes may contain commas, newlines, and escaped quotes (`""`
 * inside a quoted field means a literal `"`). Handles `\r\n`, `\n`, and a
 * bare trailing `\r` the same way, since spreadsheet exports vary in which
 * one they use. The caller decides whether the first row is a header row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ",") {
      endField();
      i += 1;
    } else if (char === "\n") {
      endRow();
      i += 1;
    } else if (char === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i += 1;
    }
  }
  // A trailing row with no final newline still needs to be flushed — but an
  // empty field/row at the very end of a file that DID end in a newline
  // would otherwise show up as a spurious blank row.
  if (field.length > 0 || row.length > 0) endRow();

  return rows;
}
