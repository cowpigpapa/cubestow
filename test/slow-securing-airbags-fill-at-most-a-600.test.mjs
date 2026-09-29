import assert from 'node:assert/strict';
import test from 'node:test';
import { context, overlap } from './support/securing-setup.mjs';

// securing.test.mjs에서 떼어 낸 오래 걸리는 테스트(파일마다 따로 돌아 전체 시간이 줄어든다).
test('airbags fill at most a 600 mm gap off the floor, and other securing items never overlap cargo or airbags @slow', () => {
  let fillers = 0;
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
      // 제조사 권장: 백은 컨테이너 바닥에 닿지 않고, 간극은 백 한계(600mm) 이하. 넘는 벽 간극은 충전재로 줄인다.
      for (const a of plan.airbags) {
        assert.ok(a.z >= 100, `sample ${id}: airbag touches the floor (${a.location})`);
        if (a.zone === 'left' || a.zone === 'right')
          assert.ok(a.w <= 600 + 1, `sample ${id}: wall airbag spans ${a.w} mm`);
        if (a.zone === 'cargo') assert.ok(a.l <= 600 + 1, `sample ${id}: cargo airbag spans ${a.l} mm`);
        assert.match(a.bag || '', /^\d+×\d+$/, `sample ${id}: airbag size missing`);
      }
      // 충전재·도어 스트랩·문쪽 각재 펜스·틈 스페이서·상단 래싱은 화물·에어백과 겹치지 않고 컨테이너 안에 있다.
      for (const d of plan.dunnage.filter(d => ['filler', 'strap', 'fence', 'spacer', 'lashing'].includes(d.kind))) {
        assert.ok(
          d.x >= -1 &&
            d.y >= -1 &&
            d.z >= -1 &&
            d.x + d.l <= load.container.l + 1 &&
            d.y + d.w <= load.container.w + 1 &&
            d.z + d.h <= load.container.h + 1,
          `sample ${id}: ${d.kind} outside the container`
        );
        fillers++;
        load.placed.forEach(p => assert.ok(!overlap(d, p), `sample ${id}: ${d.kind} inside cargo ${p.name}`));
        plan.airbags.forEach(a => assert.ok(!overlap(d, a), `sample ${id}: ${d.kind} overlaps an airbag`));
      }
    }
  }
  assert.ok(fillers > 0, 'no filler or strap was recommended in any sample');
});
