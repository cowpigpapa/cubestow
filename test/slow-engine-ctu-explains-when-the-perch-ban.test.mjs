import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { context, engine, C20 } from './support/engine-setup.mjs';

// engine.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('CTU explains when the perch ban alone makes it use more containers than the basic mode @slow', async () => {
  if (!context.__samples)
    vm.runInContext(
      (await readFile(new URL('../sample-scenarios.js', import.meta.url), 'utf8')) +
        ';globalThis.__samples=SAMPLE_SETS;',
      context
    );
  const sample = context.__samples[18],
    items = sample.products.flatMap((p, pi) => Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 })));
  // 가정 이사 화물: 기본 기준은 1대지만 작은 이삿짐 박스가 큰 박스 위에 문쪽이 열린 채 얹혀 있어, 얹힘을 금지하는 CTU 기준은 2대가 된다.
  const run = timeBudgetMs =>
    engine.packShipment({ container: C20, units: items, safety: 'secure', transportMode: sample.mode, timeBudgetMs });
  // 기본 기준 비교 계산은 시간 예산의 절반을 쓰므로, 다른 작업과 겹쳐 CPU가 모자라면 잘릴 수 있다. 그때만 예산을 네 배로 한 번 더 돈다.
  let result = run(8000);
  if (!result.stats.perchLimited) result = run(32000);
  assert.equal(result.loads.length, 2);
  assert.equal(result.stats.perchLimited, 1);
  assert.match(result.reason, /얹힘 금지 때문에 기본 기준\(1대\)보다 많음/);
});
