// Shared by the renderer and main process. Sanitize before retaining or crossing IPC.
const SECRET_KEY = /(?:token|api.?key|authorization|cookie|password|passphrase|secret|private.?key|encrypted.?key)/i;
export function redactLogText(value) {
  let text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ''}` : String(value ?? '');
  text = text.slice(0, 32768)
    .replace(/\b(?:Cookie|Set-Cookie)\s*:[^\r\n]*/gi, 'Cookie: [REDACTED]')
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization|password|passphrase|secret|cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)[^\r\n]*?(?=,\s*["']?\w+["']?\s*:|$|\r?\n)/gi, '$1[REDACTED]')
    .replace(/\b(https?:\/\/)([^\s/@]+:[^\s/@]+@)/gi, '$1[REDACTED]@')
    .replace(/(https?:\/\/[^\s?#"'<>]+)[?#][^\s"'<>)]*/gi, '$1?[REDACTED]')
    .replace(/file:\/\/[^\s"'<>]+/gi, url => { try { return decodeURIComponent(url); } catch { return '[LOCAL FILE]'; } })
    .replace(/(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|\/(?:Users|home)\/)[^\\/\s"'<>]+/gi, '[USER]')
    .replace(/\/root(?=\/|\b)/g, '[USER]')
    .replace(/\b[A-Za-z]:[\\/]/g, '[DRIVE]/')
    .replace(/\\\\[^\\\s]+\\[^\\\s]+/g, '[NETWORK]')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
  return text;
}
/** Bounded, cycle-safe structured redaction. Never serialize a whole config/request. @returns {any} */
export function redactDiagnostic(value, depth = 0, seen = new WeakSet(), budget = { left: 2000 }) {
  if (--budget.left < 0 || depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return redactLogText(value);
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value !== 'object') return String(value).slice(0, 128);
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return `[BINARY ${value.byteLength} bytes]`;
  if (value instanceof Error) return { name: value.name, message: redactLogText(value.message), stack: redactLogText(value.stack || ''),
    ...(value.cause !== undefined ? { cause: redactDiagnostic(value.cause, depth + 1, seen, budget) } : {}) };
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactDiagnostic(item, depth + 1, seen, budget)).concat(value.length > 200 ? [`[${value.length - 200} more items]`] : []);
  const result = {};
  for (const key of Object.keys(value).slice(0, 100)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    try { result[redactLogText(key)] = SECRET_KEY.test(key) ? '[REDACTED]' : redactDiagnostic(value[key], depth + 1, seen, budget); }
    catch { result[key] = '[UNREADABLE]'; }
  }
  return result;
}
export function sanitizeLogEntry(value) {
  if (!value || !['debug', 'info', 'warn', 'error', 'fatal'].includes(value.level) || typeof value.scope !== 'string' ||
      !/^[\w.-]{1,48}$/.test(value.scope) || typeof value.message !== 'string' || value.message.length > 32768) throw new Error('Invalid diagnostic entry.');
  return { time: new Date().toISOString(), level: value.level, scope: value.scope, message: redactLogText(value.message),
    ...(value.data !== undefined ? { data: redactDiagnostic(value.data) } : {}) };
}

/** Keep every report section present and cap the export independently of log-file limits. */
export function serializeDebugReport(value, maxBytes = 1024 * 1024) {
  const report = Object.fromEntries(Object.entries(value).map(([key, data]) => [redactLogText(key), SECRET_KEY.test(key) ? '[REDACTED]' : redactDiagnostic(data)]));
  const size = text => new TextEncoder().encode(text).byteLength;
  let text = JSON.stringify(report, null, 2);
  for (const key of ['recentDesktopLogs', 'recentLogs', 'recentErrors']) {
    while (size(text) > maxBytes && Array.isArray(report[key]) && report[key].length > 1) {
      report[key] = report[key].slice(Math.ceil(report[key].length / 2)); report.reportTruncated = true; text = JSON.stringify(report, null, 2);
    }
  }
  while (size(text) > maxBytes) {
    const key = Object.keys(report).filter(key => key !== 'reportTruncated').sort((a, b) => JSON.stringify(report[b]).length - JSON.stringify(report[a]).length)[0];
    if (!key || JSON.stringify(report[key]).length < 256) break;
    report[key] = { truncated: true, reason: 'Report size budget exceeded. Narrow the reproduction and export again.' }; report.reportTruncated = true;
    text = JSON.stringify(report, null, 2);
  }
  return text;
}
