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
test('highest safety blocks the inner, left and right faces of every item in every sample @slow', async () => {
  if (!context.__samples)
    vm.runInContext(
      (await readFile(new URL('../sample-scenarios.js', import.meta.url), 'utf8')) +
        ';globalThis.__samples=SAMPLE_SETS;',
      context
    );
  const containers = { '20ft': C20, '40ft': CONTAINERS[1], '40hc': CONTAINERS[2] };
  for (const id of ['1', '3', '9', '18']) {
    const sample = context.__samples[id],
      items = sample.products.flatMap((p, pi) => Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 })));
    const result = engine.packShipment({
      container: containers[sample.container],
      units: items,
      safety: 'secure',
      transportMode: sample.mode,
      timeBudgetMs: 60000
    });
    // 검증기가 최고 안전 기준(3면 막힘)으로 독립 검사한다. 문쪽 면만 각재·부목으로 막는 예외다.
    assert.equal(result.safety, 'secure');
    assertValidShipment(result, items);
    assert.equal(result.remaining.length, 0, `sample ${id}`);
  }
});
