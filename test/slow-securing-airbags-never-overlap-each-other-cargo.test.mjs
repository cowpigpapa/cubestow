import assert from 'node:assert/strict';
import test from 'node:test';
import { context, overlap } from './support/securing-setup.mjs';

// securing.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('airbags never overlap each other, cargo or dunnage, and never sit at a container end @slow', () => {
  let checked = 0;
  for (const [id, sample] of Object.entries(context.__samples)) {
    const items = sample.products.flatMap((p, pi) =>
      Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1 }))
    );
    const result = context.LoadwiseEngine.packShipment({
      container: context.__containers[sample.container],
      units: items,
      safety: 'strict',
      transportMode: sample.mode,
      timeBudgetMs: 60000
    });
    for (const load of result.loads) {
      const plan = context.__plan(load, sample.mode);
      plan.airbags.forEach((a, i) => {
        plan.airbags
          .slice(i + 1)
          .forEach(b => assert.ok(!overlap(a, b), `sample ${id}: airbags overlap at ${a.location} / ${b.location}`));
        load.placed.forEach(p => assert.ok(!overlap(a, p), `sample ${id}: airbag inside cargo ${p.name}`));
        plan.dunnage.forEach(d => assert.ok(!overlap(a, d), `sample ${id}: airbag overlaps dunnage`));
        // 컨테이너 끝(안쪽 벽·문)에는 에어백을 두지 않는다.
        assert.ok(
          a.x + a.l < load.container.l - 1 && a.x > 1,
          `sample ${id}: airbag at a container end (${a.location})`
        );
        assert.ok(!/안쪽 벽/.test(a.location), `sample ${id}: inner-wall airbag`);
        checked++;
      });
    }
  }
  assert.ok(checked > 50, `only ${checked} airbags checked`);
});
