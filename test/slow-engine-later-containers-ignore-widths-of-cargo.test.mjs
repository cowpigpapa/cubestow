import assert from 'node:assert/strict';
import test from 'node:test';
import { engine, CONTAINERS, base, assertValidShipment } from './support/engine-setup.mjs';

// engine.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('later containers ignore widths of cargo already loaded in earlier containers @slow', () => {
  const types = [
    [1200, 1000, 900, 300],
    [1000, 800, 700, 150],
    [800, 600, 500, 80],
    [600, 400, 400, 40]
  ];
  const items = Array.from({ length: 200 }, (_, i) => {
    const [l, w, h, weight] = types[i % 4];
    return { ...base, name: `T${i % 4}`, l, w, h, weight, rotate: true, pi: i % 4, unit: i + 1 };
  });
  const container = CONTAINERS[2],
    result = engine.packShipment({ container, units: items, safety: 'strict', timeBudgetMs: 60000 });
  assertValidShipment(result, items);
  assert.equal(result.remaining.length, 0);
  assert.equal(result.loads.length, result.stats.lowerBound);
  // 두 번째 컨테이너는 남은 화물만 따로 계산한 결과와 같아야 한다(앞 컨테이너 이력과 무관).
  const firstIds = new Set(result.loads[0].placed.map(p => `${p.pi}:${p.unit}`)),
    rest = items.filter(p => !firstIds.has(`${p.pi}:${p.unit}`));
  const alone = engine.packShipment({ container, units: rest, safety: 'strict', timeBudgetMs: 60000 });
  assert.equal(alone.loads[0].placed.length, result.loads[1].placed.length);
});
