import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('footer shows the package version and the slogan once', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8'),
    footer = html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(footer, new RegExp(`id="appVersion">v${pkg.version.replaceAll('.', '\\.')}<`));
  assert.equal(footer.split('Load wisely. Ship safely.').length - 1, 1);
  assert.match(html, /<title>Cubestow — Load wisely\. Ship safely\.<\/title>/);
});

test('the engine worker loads its scripts with the same cache version as the page', async () => {
  // 엔진을 고쳐 index.html의 ?v=를 올렸는데 작업자(Worker) 쪽만 옛 값이면 브라우저 캐시에 남은 옛 엔진으로 계산할 수 있다.
  const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  const [html, app, worker] = await Promise.all([read('index.html'), read('app.js'), read('engine-worker.js')]);
  const version = html.match(/packing-engine\.js\?v=([\w-]+)/)[1];
  assert.match(app, new RegExp(`new Worker\\('engine-worker\\.js\\?v=${version}'\\)`));
  const imported = [...worker.matchAll(/'([\w-]+\.js)\?v=([\w-]+)'/g)];
  assert.deepEqual(
    imported.map(m => m[1]),
    ['load-insights.js', 'solution-validator.js', 'packing-engine.js']
  );
  for (const [, file, v] of imported) assert.equal(v, version, `${file} in engine-worker.js`);
});
