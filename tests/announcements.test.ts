import { expect, mock, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('../src/lib/supabase.ts', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) } } }));
const { default: AnnouncementContent } = await import('../src/components/announcements/AnnouncementContent');

test('announcement formatting escapes HTML and rejects unsafe links', () => {
  const html = renderToStaticMarkup(createElement(AnnouncementContent, {
    body: '## Update\n**Important** <script>alert(1)</script>\n[unsafe](javascript:alert(1))\n{#c2410c|Orange text}',
  }));
  expect(html).toContain('<strong>Important</strong>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('color:#c2410c');
});
