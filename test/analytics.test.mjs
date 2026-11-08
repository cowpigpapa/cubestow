import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('the Cubestow app loads Vercel Web Analytics once', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8')
  ]);
  assert.match(html, /app\.js/);
  const analyticsLoader = app.slice(0, app.indexOf('})();') + 5);
  const scripts = [];
  const context = {
    window: {},
    document: {
      querySelector: () => scripts[0] ?? null,
      createElement: () => ({}),
      head: { appendChild: script => scripts.push(script) }
    }
  };
  vm.runInNewContext(analyticsLoader, context);
  vm.runInNewContext(analyticsLoader, context);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, '/_vercel/insights/script.js');
  assert.equal(scripts[0].defer, true);
});
