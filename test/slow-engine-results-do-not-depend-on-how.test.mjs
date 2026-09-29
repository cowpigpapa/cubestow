import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { engine, C20, widthMix, mixed } from './support/engine-setup.mjs';

// engine.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('results do not depend on how fast the machine runs @slow', async () => {
  // 시간을 재는 함수가 부를 때마다 1초씩 흐르는(아주 느린 컴퓨터) 환경에서도 보통 실행과 같은 배치가 나와야 한다.
  const slow = vm.createContext({
    console,
    performance: {
      now: (() => {
        let t = 0;
        return () => (t += 1000);
      })()
    }
  });
  for (const file of ['../load-insights.js', '../solution-validator.js', '../packing-engine.js'])
    vm.runInContext(await readFile(new URL(file, import.meta.url), 'utf8'), slow);
  const items = [...mixed(), ...widthMix()].map((u, i) => ({ ...u, pi: 0, unit: i + 1 })),
    signature = r => JSON.stringify(r.loads.map(l => l.placed.map(p => [p.unit, p.x, p.y, p.z, p.l, p.w, p.h])));
  for (const safety of ['strict', 'secure']) {
    const fast = engine.packShipment({ container: C20, units: items, safety, timeBudgetMs: 8000 }),
      late = slow.LoadwiseEngine.packShipment({ container: C20, units: items, safety, timeBudgetMs: 8000 });
    assert.equal(signature(late), signature(fast), safety);
  }
});
