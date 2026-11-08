import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('all public pages use the Cubestow blue icon and Google-sized favicon', async () => {
  const pages = await Promise.all(
    ['../index.html', '../privacy.html', '../terms.html'].map(file => readFile(new URL(file, import.meta.url), 'utf8'))
  );
  for (const html of pages) {
    assert.match(html, /rel="icon" href="favicon-48\.png\?v=\d{8}-\d+" sizes="48x48"/);
    assert.match(html, /class="brand-mark" src="icon-512\.png" alt="" width="40" height="40"/);
  }
});
