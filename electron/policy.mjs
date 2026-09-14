import path from 'node:path';

export const APP_URL = 'localmusic://app/';
export const EXTERNAL_LINKS = new Set(['https://essentia.upf.edu/']);

export function isAppUrl(value, devUrl) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (url.protocol === 'localmusic:' && url.host === 'app') ||
      Boolean(devUrl && url.origin === new URL(devUrl).origin);
  } catch { return false; }
}

export function allowedRequest(value, devUrl) {
  if (isAppUrl(value, devUrl)) return true;
  if (value.startsWith('blob:localmusic://app/') || value.startsWith('data:')) return true;
  if (devUrl && (value.startsWith(`blob:${devUrl}`) || value.startsWith(devUrl.replace('http:', 'ws:')))) return true;
  // Existing opt-in lyric analysis is the only remote application request.
  return value === 'https://api.deepseek.com/chat/completions';
}

export function assetPath(value, root) {
  const url = new URL(value);
  if (!isAppUrl(value)) throw new Error('Unknown application origin.');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.includes(':')) throw new Error('Invalid path.');
  const destination = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, destination);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Path outside application.');
  return destination;
}

export function isPagePath(value) {
  return /^\/(?:index\.html|studio|lyrics|search|collection\/(?:tracks|albums)|album\/[^/]+|analyze\/[^/]+)?\/?$/.test(new URL(value).pathname);
}

export function allowedPermission(permission, details = {}) {
  return permission === 'fullscreen' || permission === 'persistent-storage' || permission === 'local-fonts' ||
    (permission === 'fileSystem' && details.fileAccessType === 'readable');
}
