import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CTU 자료는 Logistics Library의 단일 원본을 사용한다', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /https:\/\/logistics\.onharu\.app\/ctu-library\.css\?v=/);
  assert.match(html, /https:\/\/logistics\.onharu\.app\/ctu-library\.js\?v=/);
  assert.doesNotMatch(html, /(?:src|href)="library\.(?:js|css)/);
  const ctuAssets = [...html.matchAll(/(?:src|href)="(https?:\/\/[^\"]*ctu-library\.(?:js|css)\?v=[^\"]+)"/g)].map(
    match => new URL(match[1])
  );
  assert.equal(ctuAssets.length, 2);
  assert.ok(ctuAssets.every(url => url.hostname === 'logistics.onharu.app'));
});
