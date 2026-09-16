// Shared by the renderer and main process. No request bodies/config objects are logged.
export function redactLogText(value) {
  const text = value instanceof Error ? `${value.name}: ${value.message}\n${value.stack || ''}` : typeof value === 'string' ? value : 'Unknown error';
  return text.slice(0, 16000)
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'};&]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/[^\s?]+)\?[^\s)]+/g, '$1?[REDACTED]')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 4000);
}
export function sanitizeLogEntry(value) {
  if (!value || !['debug', 'info', 'warn', 'error'].includes(value.level) || typeof value.scope !== 'string' ||
      !/^[\w.-]{1,48}$/.test(value.scope) || typeof value.message !== 'string' || value.message.length > 16000) throw new Error('Invalid diagnostic entry.');
  return { time: new Date().toISOString(), level: value.level, scope: value.scope, message: redactLogText(value.message) };
}
