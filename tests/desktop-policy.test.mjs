import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { isAppUrl, allowedRequest, allowedPermission, assetPath, isPagePath } from '../electron/policy.mjs';

test('desktop origin permits local routes and explicitly configured development only', () => {
  assert.ok(isAppUrl('localmusic://app/studio?trackId=123'));
  for (const url of ['localmusic://evil/', 'localmusic://app.evil/', 'localmusic://user@app/', 'file:///C:/secret', 'https://example.com/']) assert.equal(isAppUrl(url), false);
  assert.equal(isAppUrl('http://127.0.0.1:3000/'), false);
  assert.ok(isAppUrl('http://127.0.0.1:3000/studio', 'http://127.0.0.1:3000/'));
});
test('network policy allows local media, internal DevTools and explicit app endpoints only', () => {
  assert.ok(allowedRequest('blob:localmusic://app/id'));
  assert.ok(allowedRequest('devtools://devtools/bundled/devtools_app.html'));
  assert.ok(allowedRequest('https://api.deepseek.com/chat/completions'));
  for (const url of ['https://example.com/', 'https://api.deepseek.com/other', 'https://api.deepseek.com.evil/chat/completions', 'file:///C:/secret']) assert.equal(allowedRequest(url), false);
});
test('asset paths cannot read outside the bundle and missing assets are not SPA pages', () => {
  const root = path.resolve('build');
  assert.equal(assetPath('localmusic://app/assets/main.js', root), path.join(root, 'assets', 'main.js'));
  for (const suffix of ['%2e%2e%2fsecret', 'C%3A/secret', '%5csecret', '%00']) assert.throws(() => assetPath(`localmusic://app/${suffix}`, root));
  assert.ok(isPagePath('localmusic://app/analyze/track-id'));
  assert.equal(isPagePath('localmusic://app/assets/missing.js'), false);
});
test('permissions retain read-only file selection without opening unrelated desktop capabilities', () => {
  assert.ok(allowedPermission('fileSystem', { fileAccessType: 'readable' }));
  assert.ok(allowedPermission('persistent-storage'));
  assert.ok(allowedPermission('fullscreen'));
  assert.ok(allowedPermission('local-fonts')); 
  for (const permission of ['media', 'notifications', 'openExternal', 'clipboard-read', 'geolocation']) assert.equal(allowedPermission(permission), false);
  assert.equal(allowedPermission('fileSystem', { fileAccessType: 'writable' }), false);
});
