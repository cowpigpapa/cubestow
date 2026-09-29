import assert from 'node:assert/strict';
import test from 'node:test';
import { context, overlap } from './support/securing-setup.mjs';

// securing.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('CTU mode uses no more containers than the basic mode and names each face that securing must close @slow', () => {
  // 사용자 결정(2026-09-26): 화물끼리 막는 배치가 대수를 늘리면 기본 배치를 쓰고, 화물로 막히지 않은 옆면은 고정재 권고에 화물별로 적는다.
  for (const id of ['1', '10']) {
    const sample = context.__samples[id],
      container = context.__containers[sample.container];
    const items = sample.products.flatMap((p, pi) =>
      Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 }))
    );
    const result = context.LoadwiseEngine.packShipment({
      container,
      units: items,
      safety: 'secure',
      transportMode: sample.mode,
      timeBudgetMs: 8000
    });
    assert.equal(result.loads.length, 1, `sample ${id}: containers ${result.loads.length}`);
    assert.equal(result.remaining.length, 0);
    const validation = context.LoadwiseValidator.validateShipment({
      safety: 'secure',
      transportMode: sample.mode,
      containers: result.loads,
      unallocated: result.remaining,
      totalUnits: items.length
    });
    assert.equal(validation.valid, true, validation.errors.slice(0, 3).join('; '));
    const open = validation.securingRequired.flat().length,
      plan = context.__plan(result.loads[0], sample.mode, undefined, 'secure');
    assert.ok(open > 0, `sample ${id}: expected open faces for securing`);
    // 열린 면은 모두 고정재 권고에 나온다. 단 안쪽 면이 안쪽 바닥 각재로 막힌 화물은 목록에서 빠진다.
    const load = result.loads[0],
      beamed = validation.securingRequired.flat().filter(v => {
        const p = load.placed[v.index];
        return (
          v.faces.length === 1 &&
          v.faces[0] === '안쪽' &&
          plan.dunnage.some(
            d =>
              d.kind === 'beam' &&
              d.side === 'max' &&
              Math.abs(d.x - (p.x + p.l)) < 2 &&
              Math.min(d.y + d.w, p.y + p.w) - Math.max(d.y, p.y) > 0
          )
        );
      }).length;
    assert.equal(
      plan.reviews.filter(r => r.ctuFace).length,
      open - beamed,
      `sample ${id}: every open face appears in the securing plan or is closed by an inner beam`
    );
    assert.ok(plan.reviews.filter(r => r.ctuFace).every(r => /래싱으로 묶기/.test(r.location)));
  }
});
