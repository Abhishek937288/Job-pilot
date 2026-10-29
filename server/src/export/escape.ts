/**
 * Spreadsheet formula injection: titles and companies are untrusted, so a cell that starts with
 * = + - @ (or a tab / carriage return, which some apps strip before evaluating) gets a leading quote.
 */
export function escapeCell(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function escapeRow<T extends Record<string, unknown>>(row: T): T {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, escapeCell(v)])) as T;
}
