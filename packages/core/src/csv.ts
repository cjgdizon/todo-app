/**
 * Minimal RFC 4180 CSV for import and export. Writing guards against spreadsheet formula
 * injection (a cell starting with = + - @ would run as a formula when opened in Excel or
 * Sheets), and reading removes that guard again so data round-trips unchanged.
 */

// A leading apostrophe makes a spreadsheet treat the cell as text.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const GUARDED = /^'[=+\-@\t\r]/;

function writeField(value: string): string {
  const safe = FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows as CSV text with CRLF line endings. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => `${row.map(writeField).join(",")}\r\n`).join("");
}

const readField = (value: string): string => (GUARDED.test(value) ? value.slice(1) : value);

/**
 * CSV text as rows of fields. Handles quoted fields (commas, doubled quotes and line breaks
 * inside), CRLF or LF endings and a leading byte order mark; blank lines are skipped.
 * Throws if a quote is never closed.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  const endRow = () => {
    if (row.length === 0 && value === "") return; // blank line
    row.push(readField(value));
    rows.push(row);
    row = [];
    value = "";
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (inQuotes) {
      if (ch !== '"') value += ch;
      else if (input.charAt(i + 1) === '"') {
        value += '"';
        i++;
      } else inQuotes = false;
    } else if (ch === '"' && value === "") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(readField(value));
      value = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && input.charAt(i + 1) === "\n") i++;
      endRow();
    } else {
      value += ch;
    }
  }
  if (inQuotes) throw new Error("The CSV has a quote that is never closed");
  endRow();
  return rows;
}
