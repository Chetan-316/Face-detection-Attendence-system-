/**
 * CSV Generation utility with Formula Injection Protection (CSV Injection / Formula Injection).
 * Any cell value starting with =, +, -, or @ is prepended with a single quote (')
 * so that spreadsheet engines (Excel, LibreOffice, Google Sheets) treat the cell as raw text
 * and do not execute embedded commands or formulas.
 */

const FORMULA_INJECTION_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escapes a cell value for safe CSV export.
 * 1. Checks and neuters formula injection triggers.
 * 2. Wraps in quotes if it contains commas, double quotes, or newlines.
 * 3. Escapes embedded double quotes by doubling them ("").
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str = String(value);

  // Check for formula injection triggers at the beginning of the string
  if (str.length > 0 && FORMULA_INJECTION_CHARS.includes(str.charAt(0))) {
    // Prepend single quote to neutralize formula execution in spreadsheet software
    str = `'${str}`;
  }

  // If cell contains commas, quotes, newlines, or single quote at start, wrap in quotes
  const needsQuotes = str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r');

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converts a table of rows (headers + data) into an RFC 4180 compliant CSV string.
 * Prepends a UTF-8 Byte Order Mark (\uFEFF) so Excel reliably interprets UTF-8 encoding.
 */
export function buildCsv(headers: string[], rows: (unknown[])[]): string {
  const sanitizedHeaders = headers.map(sanitizeCsvCell).join(',');
  const sanitizedRows = rows.map((row) => row.map(sanitizeCsvCell).join(','));

  const csvContent = [sanitizedHeaders, ...sanitizedRows].join('\r\n');
  return `\uFEFF${csvContent}`;
}
