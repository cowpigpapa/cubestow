import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('sample results, simulator and LL share the same desktop maximum width', async () => {
  const [samples, simulator, overrides] = await Promise.all([
    readFile(new URL('../sample-results.css', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../v3-projects.css', import.meta.url), 'utf8')
  ]);
  assert.match(samples, /\.samples-view\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(simulator, /\.workspace\s*\{[\s\S]*?max-width:\s*1320px/);
  assert.match(overrides, /\.library-view\s*\{[\s\S]*?max-width:\s*1320px/);
});
