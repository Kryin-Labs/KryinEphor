import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('installable app icons match their declared sizes', async () => {
  const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
    assert.ok(icon, `missing ${size}px icon`);
    const png = await readFile(`public${icon.src}`);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

test('Vercel serves page links through the SPA without swallowing API routes', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  const pages = config.rewrites.filter(rule => rule.destination === '/index.html');
  const isPage = path => pages.some(rule => new RegExp(`^${rule.source}$`).test(path));
  for (const path of ['/announcements', '/announcements/example', '/timetable', '/ai-connections', '/oauth/consent']) {
    assert.ok(isPage(path), `${path} should reach the app`);
  }
  for (const path of ['/api/mcp', '/api/mcp-actions', '/api/oauth/token']) {
    assert.equal(isPage(path), false, `${path} must remain an API endpoint`);
  }
});
