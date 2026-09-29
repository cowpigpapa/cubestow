import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 규칙 기반 자동 평가(result-review.js)를 엔진·검증기·고정재 계획과 함께 불러와 검사한다.
const context = vm.createContext({ console, performance, setTimeout, clearTimeout });
for (const file of [
  'load-insights.js',
  'solution-validator.js',
  'packing-engine.js',
  'sample-scenarios.js',
  'securing-plan.js',
  'view-3d.js',
  'import-export.js',
  'app.js',
  'result-review.js'
])
  vm.runInContext(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), context);
vm.runInContext(
  'globalThis.__samples=SAMPLE_SETS;globalThis.__containers=CONTAINERS;globalThis.__plan=buildSecuringPlan;',
  context
);
const run = (id, safety) => {
  const sample = context.__samples[id],
    container = context.__containers[sample.container],
    items = sample.products.flatMap((p, pi) => Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 })));
  const r = context.LoadwiseEngine.packShipment({
    container,
    units: items,
    safety,
    transportMode: sample.mode,
    timeBudgetMs: 8000
  });
  r.loads.forEach(l => {
    l.securing = context.__plan(l, sample.mode, undefined, safety);
  });
  const shipment = { containers: r.loads, unallocated: r.remaining, totalUnits: items.length, safety, stats: r.stats };
  shipment.validation = context.LoadwiseValidator.validateShipment(shipment);
  return context.LoadwiseReview.review(shipment);
};

test('the automatic review grades a clean single-product load as good with no algorithm flags', () => {
  const r = run('2', 'strict');
  assert.notEqual(r.grade.key, 'bad');
  assert.equal(r.anomalies.length, 0, JSON.stringify(r.anomalies));
});

test('the automatic review reports unloaded cargo and tall open stacks in load-max mode', () => {
  const r = run('20', 'standard');
  assert.equal(r.grade.key, 'bad');
  assert.ok(r.items.some(it => it.code === 'unallocated'));
});

test('the review flags suspicious layouts for the admin log with a stable fingerprint', () => {
  const c = { name: '20ft Dry', l: 5898, w: 2352, h: 2393, maxWeight: 28200 };
  // 일부러 안쪽 벽에서 떨어뜨리고 안쪽에 빈 곳을 둔 적재: 알고리즘 의심 항목이 나와야 한다.
  const placed = [
    { name: 'a', shape: 'box', x: 0, y: 0, z: 0, l: 1000, w: 1000, h: 1000, weight: 100, order: 1 },
    { name: 'a', shape: 'box', x: 2500, y: 0, z: 0, l: 1000, w: 1000, h: 1000, weight: 100, order: 2 }
  ];
  const shipment = {
    containers: [{ container: c, placed, totalWeight: 200, securing: { dunnage: [], airbags: [], reviews: [] } }],
    unallocated: [],
    totalUnits: 2,
    safety: 'strict'
  };
  const r = context.LoadwiseReview.review(shipment),
    codes = r.anomalies.map(a => a.code);
  assert.ok(codes.includes('not-flush'), codes.join());
  assert.ok(codes.includes('inner-void'), codes.join());
  const fp = context.LoadwiseReview.fingerprint({ codes });
  assert.match(fp, /^[0-9a-f]{16}$/);
  assert.equal(fp, context.LoadwiseReview.fingerprint({ codes }));
});

test('the review warns when cargo is stacked on items whose top-load limit was not entered', () => {
  const c = { name: '20ft Dry', l: 5898, w: 2352, h: 2393, maxWeight: 28200 };
  const box = (x, z, weight, maxTopLoadKg, order) => ({
    name: 'a',
    shape: 'box',
    x,
    y: 0,
    z,
    l: 1000,
    w: 1000,
    h: 1000,
    weight,
    maxTopLoadKg,
    order
  });
  const review = placed =>
    context.LoadwiseReview.review({
      containers: [
        {
          container: c,
          placed,
          totalWeight: placed.reduce((s, p) => s + p.weight, 0),
          securing: { dunnage: [], airbags: [], reviews: [] }
        }
      ],
      unallocated: [],
      totalUnits: placed.length,
      safety: 'strict'
    });
  // 미입력 화물 위에 자기 무게 이상이 실림 → 주의
  const heavy = review([box(4898, 0, 2000, null, 1), box(4898, 1000, 2000, null, 2)]);
  const item = heavy.items.find(it => it.code === 'top-load-unknown');
  assert.ok(item, 'top-load-unknown item present');
  assert.equal(item.level, 'warn');
  assert.match(item.title, /미입력 화물 1개 위에 적층/);
  assert.notEqual(heavy.grade.key, 'ok');
  // 한도를 입력했으면 지적하지 않는다
  const known = review([box(4898, 0, 2000, 3000, 1), box(4898, 1000, 2000, null, 2)]);
  assert.ok(!known.items.some(it => it.code === 'top-load-unknown'));
  // 가벼운 것이 얹히면 안내만
  const light = review([box(4898, 0, 2000, null, 1), box(4898, 1000, 300, null, 2)]);
  assert.equal(light.items.find(it => it.code === 'top-load-unknown').level, 'info');
});

test('the same finding in several containers is merged into one line', () => {
  const c = { name: '20ft Dry', l: 5898, w: 2352, h: 2393, maxWeight: 28200 };
  const load = () => ({
    container: c,
    placed: [{ name: 'a', shape: 'box', x: 0, y: 0, z: 0, l: 1000, w: 1000, h: 1000, weight: 100, order: 1 }],
    totalWeight: 100,
    securing: { dunnage: [], airbags: [], reviews: [{ product: '바닥 선하중', location: '안쪽 1m 구간' }] }
  });
  const r = context.LoadwiseReview.review({
    containers: [load(), load()],
    unallocated: [],
    totalUnits: 2,
    safety: 'strict'
  });
  const lines = r.items.filter(it => it.code === 'line-load');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].title, '1·2번 바닥 선하중 초과');
  const flush = r.items.filter(it => it.code === 'flush');
  assert.equal(flush.length, 1);
  assert.match(flush[0].title, /^1·2번 첫 화물이 안쪽 벽에서 떨어짐/);
});
