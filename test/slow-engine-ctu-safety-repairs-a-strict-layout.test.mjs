import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { context, engine, validator, C20 } from './support/engine-setup.mjs';

// engine.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('CTU safety repairs a strict layout when its own search leaves cargo over: small appliances fit two containers @slow', async () => {
  if (!context.__samples)
    vm.runInContext(
      (await readFile(new URL('../sample-scenarios.js', import.meta.url), 'utf8')) +
        ';globalThis.__samples=SAMPLE_SETS;',
      context
    );
  const sample = context.__samples[7],
    items = sample.products.flatMap((p, pi) => Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 })));
  // 화면과 같은 예산(8초)으로 계산한다. 배치안 수는 예산과 화물 수로 정해지므로 결과는 기기와 관계없이 같다.
  const result = engine.packShipment({
    container: C20,
    units: items,
    safety: 'secure',
    transportMode: sample.mode,
    timeBudgetMs: 8000
  });
  // CTU 기준 자체 탐색만으로는 3대가 필요했다. 기본 기준 배치에서 CTU 검사에 걸린 화물만 빼고 다시 놓으면 기본 기준과 같은 2대가 된다.
  assert.equal(result.loads.length, 2, `containers ${result.loads.length}`);
  assert.equal(result.remaining.length, 0);
  const validation = validator.validateShipment({
    safety: 'secure',
    transportMode: sample.mode,
    containers: result.loads,
    unallocated: result.remaining,
    totalUnits: items.length
  });
  assert.equal(validation.valid, true, validation.errors.slice(0, 3).join('; '));
});
