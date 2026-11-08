import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('footer shows the package version and the slogan once', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8'),
    footer = html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(footer, new RegExp(`id="appVersion">v${pkg.version.replaceAll('.', '\\.')}<`));
  assert.equal(footer.split('Load wisely. Ship safely.').length - 1, 1);
  assert.match(html, /<title>Cubestow — 3D 컨테이너 적재 시뮬레이션<\/title>/);
});

test('public SEO files expose canonical crawl targets', async () => {
  const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  const [robots, sitemap, index, samples, build] = await Promise.all([
    read('robots.txt'),
    read('sitemap.xml'),
    read('index.html'),
    read('sample-results.html'),
    read('build.mjs')
  ]);
  assert.match(robots, /Sitemap: https:\/\/cubestow\.onharu\.app\/sitemap\.xml/);
  assert.match(sitemap, /https:\/\/cubestow\.onharu\.app\/samples/);
  assert.match(index, /application\/ld\+json/);
  assert.match(samples, /rel="canonical" href="https:\/\/cubestow\.onharu\.app\/samples"/);
  assert.match(build, /'robots\.txt'/);
  assert.match(build, /'sitemap\.xml'/);
});

test('simulation explanations use compact accessible info tooltips', async () => {
  const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  const [html, app, css] = await Promise.all([read('index.html'), read('app.js'), read('v3-projects.css')]);
  assert.equal((html.match(/class="context-help-trigger"/g) || []).length, 3);
  for (const id of ['safetyHint', 'preferenceHint', 'transportHint']) {
    assert.match(html, new RegExp(`aria-describedby="${id}"`));
    assert.match(html, new RegExp(`id="${id}"[^>]*role="tooltip"`));
  }
  assert.match(css, /\.context-help:hover \.context-tooltip/);
  assert.match(css, /\.context-help:focus-within \.context-tooltip/);
  assert.match(css, /\.context-help\.is-auto-visible \.context-tooltip/);
  assert.match(css, /transition-delay: 300ms/);
  assert.match(css, /outline: 2px solid rgba\(23, 102, 214, 0\.32\)/);
  assert.match(css, /\.context-tooltip[\s\S]*?left: 0;/);
  assert.doesNotMatch(css, /grid-template-areas: 'sc pc rc' 'sh ph rh'/);
  assert.match(app, /querySelector\('\.context-tooltip'\)/);
  assert.match(app, /function flashContextTooltip\(hint, duration = 1500\)/);
  for (const id of ['safetyHint', 'preferenceHint', 'transportHint']) {
    assert.match(app, new RegExp(`flashContextTooltip\\(\\$\\('${id}'\\)\\)`));
  }
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

test('the pages declare a favicon that the build copies next to them', async () => {
  const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
  const index = await read('index.html');
  assert.match(index, /<link rel="icon" href="favicon-48\.png\?v=[^"]+" sizes="48x48" type="image\/png">/);
  assert.match(index, /<link rel="icon" href="favicon-32\.png\?v=[^"]+" sizes="32x32" type="image\/png">/);
  assert.match(index, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);

  const samples = await read('sample-results.html');
  assert.match(samples, /<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
  assert.match(samples, /<link rel="icon" href="favicon-32\.png" sizes="32x32" type="image\/png">/);
  assert.match(samples, /<link rel="apple-touch-icon" href="apple-touch-icon\.png">/);
  const build = await read('build.mjs');
  for (const icon of ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) {
    assert.match(build, new RegExp(icon.replace('.', '\\.')), `build copies ${icon}`);
    await readFile(new URL(`../public/${icon}`, import.meta.url));
  }
});
