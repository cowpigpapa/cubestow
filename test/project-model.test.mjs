import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const context = {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(await readFile(new URL('../project-model.js', import.meta.url), 'utf8'), context);
const model = context.LoadwiseProjectModel;

test('manual and file products share one normalized model', () => {
  const snapshot = model.createSnapshot(
    [
      {
        name: '펌프',
        group: '기계',
        shape: 'box',
        qty: '2',
        l: '1000',
        w: '800',
        h: '700',
        weight: '120',
        source: 'excel'
      }
    ],
    '40hc',
    { safety: 'strict', preference: 'auto' }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    schemaVersion: 5,
    algorithmVersion: 'legacy',
    products: [
      {
        name: '펌프',
        group: '기계',
        shape: 'box',
        qty: 2,
        l: 1000,
        w: 800,
        h: 700,
        weight: 120,
        maxTopLoadKg: null,
        rotate: false,
        fragile: false,
        source: 'excel'
      }
    ],
    containerType: '40hc',
    safety: 'strict',
    preference: 'auto',
    transportMode: 'combined',
    securing: {
      airbag: true,
      filler: true,
      nails: true,
      lashing: true,
      friction: 'unknown',
      lashingMsl: 2000,
      anchors: 'iso'
    },
    resultSummary: null,
    fieldResult: null
  });
});

test('legacy snapshots migrate and current metadata is preserved', () => {
  const legacy = model.normalizeSnapshot({
    schemaVersion: 1,
    products: [],
    containerType: '40ft',
    optimization: 'sequence'
  });
  assert.equal(legacy.schemaVersion, 5);
  assert.equal(legacy.safety, 'strict');
  assert.equal(legacy.preference, 'auto');
  assert.equal(legacy.algorithmVersion, 'legacy');
  assert.equal(legacy.transportMode, 'combined');
  assert.equal(legacy.resultSummary, null);
  assert.equal(legacy.fieldResult, null);
  const current = model.createSnapshot(
    [],
    '20ft',
    {},
    {
      algorithmVersion: model.CURRENT_ALGORITHM_VERSION,
      resultSummary: {
        state: 'complete',
        loaded: 36,
        total: 36,
        containerCount: 1,
        totalWeight: 6692,
        calculatedAt: '2026-08-11T00:00:00.000Z'
      }
    }
  );
  assert.equal(current.algorithmVersion, 'ep-lex-portfolio-2026.10.28');
  assert.equal(current.resultSummary.loaded, 36);
  assert.equal(current.resultSummary.totalWeight, 6692);
});

test('legacy strategies migrate to safety level and preference', () => {
  for (const [optimization, safety, preference] of [
    ['intelligent', 'strict', 'auto'],
    ['sequence', 'strict', 'auto'],
    ['hybrid', 'strict', 'width'],
    ['volume', 'standard', 'density'],
    ['balance', 'strict', 'balance']
  ]) {
    const snapshot = model.normalizeSnapshot({ optimization });
    assert.equal(snapshot.safety, safety, optimization);
    assert.equal(snapshot.preference, preference, optimization);
    assert.equal('optimization' in snapshot, false);
  }
  assert.equal(model.createSnapshot([], '20ft', 'volume').safety, 'standard');
});

test('safety level and preference are preserved', () => {
  const snapshot = model.createSnapshot([], '20ft', { safety: 'standard', preference: 'balance' });
  assert.equal(snapshot.safety, 'standard');
  assert.equal(snapshot.preference, 'balance');
});

test('field comparison survives project normalization', () => {
  const snapshot = model.createSnapshot(
    [],
    '20ft',
    {},
    { fieldResult: { loaded: 35, containers: 2, notes: '현장 변경', recordedAt: '2026-08-11T00:00:00.000Z' } }
  );
  assert.equal(snapshot.fieldResult.loaded, 35);
  assert.equal(snapshot.fieldResult.containers, 2);
  assert.equal(snapshot.fieldResult.notes, '현장 변경');
});

test('optional top-load capacity is preserved without inventing a default', () => {
  assert.equal(
    model.createSnapshot([{ name: '상자', qty: 1, l: 1, w: 1, h: 1, weight: 1, maxTopLoadKg: 250 }], '20ft').products[0]
      .maxTopLoadKg,
    250
  );
  assert.equal(
    model.createSnapshot([{ name: '상자', qty: 1, l: 1, w: 1, h: 1, weight: 1 }], '20ft').products[0].maxTopLoadKg,
    null
  );
});

test('transport mode is preserved and invalid values fall back to combined', () => {
  assert.equal(model.createSnapshot([], '20ft', {}, { transportMode: 'sea' }).transportMode, 'sea');
  assert.equal(model.normalizeSnapshot({ transportMode: 'invalid' }).transportMode, 'combined');
});

test('invalid project values fall back safely', () => {
  const snapshot = model.normalizeSnapshot({
    products: [{ name: '', qty: 0 }],
    containerType: 'x',
    optimization: 'x',
    safety: 'x',
    preference: 'x'
  });
  assert.equal(snapshot.products.length, 0);
  assert.equal(snapshot.containerType, '20ft');
  assert.equal(snapshot.safety, 'strict');
  assert.equal(snapshot.preference, 'auto');
});

test('highest safety level survives snapshot normalization', () => {
  assert.equal(model.createSnapshot([], '20ft', { safety: 'secure', preference: 'auto' }).safety, 'secure');
});

// 관리자 "이 조건으로 다시 계산": 점검 기록 한 건을 입력 화면용 스냅숏으로 바꾼다.
const FLAG_ROW = {
  id: 42,
  app_version: '1.1.90',
  engine: 'ep-lex-portfolio-2026.09.01',
  settings: {
    container: '40hc',
    safety: 'secure',
    preference: 'density',
    transportMode: 'sea',
    securing: {
      airbag: false,
      filler: true,
      nails: false,
      lashing: true,
      friction: 'rubber',
      lashingMsl: 4000,
      anchors: 'rated'
    }
  },
  flags: [{ code: 'inner-void' }],
  input: {
    products: [
      { shape: 'box', l: 1200, w: 1000, h: 900, weight: 350, qty: 12, rotate: true, fragile: false, maxTopLoadKg: 800 },
      {
        shape: 'cylinder',
        l: 900,
        w: 900,
        h: 1100,
        weight: 500,
        qty: 4,
        rotate: false,
        fragile: true,
        maxTopLoadKg: null
      }
    ]
  }
};
const plain = value => JSON.parse(JSON.stringify(value));

test('an algorithm flag becomes a snapshot with every product and condition restored', () => {
  const plan = model.fromAlgorithmFlag(FLAG_ROW, { appVersion: '1.1.90', engine: 'ep-lex-portfolio-2026.09.01' });
  assert.deepEqual(plain(plan.notes), []);
  assert.equal(plan.versionNote, '');
  const s = plan.snapshot;
  assert.equal(s.containerType, '40hc');
  assert.equal(s.safety, 'secure');
  assert.equal(s.preference, 'density');
  assert.equal(s.transportMode, 'sea');
  assert.deepEqual(plain(s.securing), FLAG_ROW.settings.securing);
  assert.deepEqual(
    plain(s.products.map(p => [p.name, p.shape, p.l, p.w, p.h, p.weight, p.qty, p.rotate, p.fragile, p.maxTopLoadKg])),
    [
      ['점검 제품 1', 'box', 1200, 1000, 900, 350, 12, true, false, 800],
      ['점검 제품 2', 'cylinder', 900, 900, 1100, 500, 4, false, true, null]
    ]
  );
  // 원본 기록은 건드리지 않는다
  assert.equal(FLAG_ROW.input.products[0].name, undefined);
});

test('a flag made by another version says so before it is replayed', () => {
  const plan = model.fromAlgorithmFlag(FLAG_ROW, { appVersion: '1.1.107', engine: 'ep-lex-portfolio-2026.10.28' });
  assert.equal(
    plan.versionNote,
    '이 기록은 v1.1.90 / 엔진 ep-lex-portfolio-2026.09.01에서 생성되었습니다. 현재 버전(v1.1.107 / 엔진 ep-lex-portfolio-2026.10.28) 결과와 다를 수 있습니다.'
  );
  // 브라우저 대기열 형식(appVersion)도 읽는다
  const queued = model.fromAlgorithmFlag(
    { ...FLAG_ROW, app_version: undefined, appVersion: '1.1.106' },
    { appVersion: '1.1.106', engine: 'ep-lex-portfolio-2026.09.01' }
  );
  assert.equal(queued.versionNote, '');
});

test('an old or partial flag loads what it can and lists only what it could not apply', () => {
  const plan = model.fromAlgorithmFlag(
    {
      id: 7,
      engine: 'old',
      settings: { container: '53ft', optimization: 'volume', transportMode: 'sea', securing: { airbag: false } },
      input: {
        products: [
          { shape: 'box', l: 1000, w: 800, h: 600, weight: 100, qty: 3 },
          { shape: 'box', l: 1000, w: 0, h: 600, weight: 100, qty: 2 },
          { shape: 'box', l: 500, w: 400, h: 300, weight: 20 },
          null
        ]
      }
    },
    { appVersion: '1.1.107', engine: 'new' }
  );
  const s = plan.snapshot;
  // 예전 단일 전략(optimization)은 안전 기준 × 배치 방식으로 옮긴다
  assert.equal(s.safety, 'standard');
  assert.equal(s.preference, 'density');
  assert.equal(s.transportMode, 'sea');
  assert.equal(s.containerType, '20ft');
  assert.equal(s.securing.airbag, false);
  assert.equal(s.securing.friction, 'unknown');
  assert.deepEqual(plain(s.products.map(p => [p.name, p.qty])), [
    ['점검 제품 1', 3],
    ['점검 제품 3', 1]
  ]);
  assert.deepEqual(plain(plan.notes), [
    '점검 제품 2: 치수나 무게가 없어 넣지 못했습니다.',
    '점검 제품 3: 수량이 없어 1개로 넣었습니다.',
    '점검 제품 4: 치수나 무게가 없어 넣지 못했습니다.',
    '컨테이너: 알 수 없는 값(53ft)이라 기본값(20ft)으로 계산합니다.',
    '고정 조건 중 충전재 · 바닥 못 · 래싱 · 바닥 마찰 · 래싱 MSL · 고정점: 기록에 없어 기본값으로 계산합니다.'
  ]);
  assert.equal(
    plan.versionNote,
    '이 기록은 버전 정보 없음 / 엔진 old에서 생성되었습니다. 현재 버전(v1.1.107 / 엔진 new) 결과와 다를 수 있습니다.'
  );
});

test('a flag without any usable product gives no snapshot instead of an error', () => {
  for (const row of [{}, { input: null, settings: null }, { input: { products: [{ l: 'x' }] } }, null]) {
    const plan = model.fromAlgorithmFlag(row, { appVersion: '1.1.107', engine: 'new' });
    assert.equal(plan.snapshot, null);
    assert.ok(plan.notes.length >= 1);
  }
});

test('a flag with the retired width preference or a very long unknown value is still readable', () => {
  const plan = model.fromAlgorithmFlag(
    {
      ...FLAG_ROW,
      settings: { ...FLAG_ROW.settings, preference: 'width', container: 'x'.repeat(500) }
    },
    { appVersion: '1.1.90', engine: 'ep-lex-portfolio-2026.09.01' }
  );
  assert.equal(plan.snapshot.preference, 'auto');
  assert.ok(plan.notes.includes('배치 방식: 예전 방식(width)은 지금 없어 추천으로 계산합니다.'));
  const container = plan.notes.find(n => n.startsWith('컨테이너:'));
  assert.equal(container, `컨테이너: 알 수 없는 값(${'x'.repeat(30)})이라 기본값(20ft)으로 계산합니다.`);
});
