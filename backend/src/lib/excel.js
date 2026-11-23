function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function cellFor(value) {
  if (value === null || value === undefined || value === '') {
    return '<Cell><Data ss:Type="String"></Data></Cell>';
  }
  if (value instanceof Date) {
    return `<Cell ss:StyleID="Date"><Data ss:Type="DateTime">${value.toISOString().slice(0, 19)}</Data></Cell>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${value}</Data></Cell>`;
  }
  if (typeof value === 'boolean') {
    return `<Cell><Data ss:Type="Boolean">${value ? 1 : 0}</Data></Cell>`;
  }
  const text = String(value);
  const asNumber = Number(text);
  if (text.trim() !== '' && !Number.isNaN(asNumber) && /^-?\d+(\.\d+)?$/.test(text.trim())) {
    return `<Cell><Data ss:Type="Number">${asNumber}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(text)}</Data></Cell>`;
}

function sheetNameFor(name) {
  return String(name || 'Laporan').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Laporan';
}

/**
 * Dependency-free SpreadsheetML 2003 (.xls) writer. Excel, LibreOffice and
 * Google Sheets open the generated file with the header row styled and frozen.
 */
export function sendXls(res, filename, columns, rows, sheetName = 'Laporan') {
  const columnWidths = columns.map(() => '<Column ss:AutoFitWidth="0" ss:Width="150"/>').join('');
  const headerRow = `<Row ss:Height="20">${columns
    .map((column) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`)
    .join('')}</Row>`;
  const bodyRows = rows
    .map((row) => `<Row>${columns.map((column) => cellFor(row[column.key])).join('')}</Row>`)
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>
<Style ss:ID="header"><Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#831D27" ss:Pattern="Solid"/></Style>
<Style ss:ID="Date"><NumberFormat ss:Format="yyyy-mm-dd hh:mm"/></Style>
</Styles>
<Worksheet ss:Name="${escapeXml(sheetNameFor(sheetName))}">
<Table>
${columnWidths}
${headerRow}
${bodyRows}
</Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
<FreezePanes/>
<FrozenNoSplit/>
<SplitHorizontal>1</SplitHorizontal>
<TopRowBottomPane>1</TopRowBottomPane>
<ActivePane>2</ActivePane>
</WorksheetOptions>
</Worksheet>
</Workbook>`;

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(xml);
}
