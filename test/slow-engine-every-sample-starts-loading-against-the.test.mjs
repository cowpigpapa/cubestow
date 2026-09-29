import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  context,
  engine,
  validator,
  C20,
  CONTAINERS,
  base,
  units,
  pack,
  overlapArea,
  supportRatio,
  widthMix,
  fragileMix,
  mixed,
  assertValidShipment
} from './support/engine-setup.mjs';

// engine.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('every sample starts loading against the inner end wall in every container @slow', async () => {
  vm.runInContext(
    (await readFile(new URL('../sample-scenarios.js', import.meta.url), 'utf8')) + ';globalThis.__samples=SAMPLE_SETS;',
    context
  );
  const containers = { '20ft': C20, '40ft': CONTAINERS[1], '40hc': CONTAINERS[2] };
  for (const [id, sample] of Object.entries(context.__samples))
    for (const safety of ['strict', 'standard']) {
      const items = sample.products.flatMap((p, pi) =>
        Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 }))
      );
      const result = engine.packShipment({
        container: containers[sample.container],
        units: items,
        safety,
        transportMode: sample.mode,
        timeBudgetMs: 60000
      });
      for (const load of result.loads) {
        if (!load.placed.length) continue;
        const first = load.placed.find(p => p.order === 1);
        // 예외(사용자 결정 2026-09-27): 무거운 화물(개당 1t 이상, 원통 500kg 이상)은 무게중심을 맞추려고 가운데로 옮길 수 있다.
        if (load.shifted) {
          assert.ok(
            load.placed.some(p => p.weight >= 1000 || (p.shape === 'cylinder' && p.weight >= 500)),
            `sample ${id}/${safety}: only heavy loads leave the inner wall`
          );
          continue;
        }
        assert.equal(first.x + first.l, load.container.l, `sample ${id}/${safety}: first item is off the wall`);
        assert.equal(Math.max(...load.placed.map(p => p.x + p.l)), load.container.l, `sample ${id}/${safety}`);
        // 최종 적재 상태에서 높은 화물은 모두 2면 이상 측면 지지된다(좌우 무게중심 맞춤·슬라이스 재배열 뒤에도).
        for (const p of load.placed)
          if ((p.z + p.h) / Math.min(p.l, p.w) > 1.5)
            assert.ok(
              Object.values(
                engine.lateralSupportDirections(
                  p,
                  [p.l, p.w, p.h],
                  load.placed.filter(q => q !== p),
                  load.container
                )
              ).filter(Boolean).length >= 2,
              `sample ${id}/${safety}: ${p.name} side support`
            );
      }
    }
});
