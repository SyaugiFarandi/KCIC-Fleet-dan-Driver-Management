function escapeCell(value) {
  const text = value == null ? '' : String(value);
  // Spreadsheet apps execute cells starting with these characters; force them to text.
  const guarded = /^[=+@\t\r]/.test(text) || (/^-/.test(text) && !/^-?\d+(?:[.,]\d+)?$/.test(text)) ? `'${text}` : text;
  return /[",\n;]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCsv(columns, rows) {
  const header = columns.map((column) => escapeCell(column.label)).join(',');
  const body = rows.map((row) => columns.map((column) => escapeCell(row[column.key])).join(','));
  return [header, ...body].join('\r\n');
}

export function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`\uFEFF${toCsv(columns, rows)}`);
}
