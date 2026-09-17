import { serializeDebugReport } from './log-redaction.mjs';

// A write-only, report-specific IPC path avoids granting general clipboard access.
export function prepareClipboardReport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 1024 * 1024) throw new Error('Debug report exceeds the copy size limit.');
  const value = JSON.parse(text);
  if (!value || Array.isArray(value) || value.reportVersion !== 1) throw new Error('Invalid debug report.');
  return serializeDebugReport(value);
}
