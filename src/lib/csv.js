import { SAMPLE_NOTICE } from '../config/company';

function csvEscape(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

/**
 * @param columns [{ key, label, value?(row) }]
 */
export function toCSV(columns, rows) {
  const lines = [columns.map((c) => csvEscape(c.label)).join(',')];
  rows.forEach((r) => {
    lines.push(
      columns.map((c) => csvEscape(c.value ? c.value(r) : r[c.key])).join(',')
    );
  });
  return lines.join('\n');
}

export function downloadCSV(filename, csv) {
  // The BOM makes Excel open UTF-8 (and the ₹ sign) correctly.
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The sheet with a blank line and the notice under it, so a download carries
 * the same "not final until signed" caveat the printed documents do.
 */
export function withNotice(csv) {
  return `${csv}\n\n${csvEscape(SAMPLE_NOTICE)}`;
}

export function exportCSV(filename, columns, rows) {
  downloadCSV(filename, withNotice(toCSV(columns, rows)));
}
