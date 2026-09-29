// engine.test.mjs에서 옮긴 공통 준비 코드(엔진·검증기 불러오기와 도우미). 테스트 파일들이 함께 쓴다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export const context = vm.createContext({ console, performance });
for (const file of ['../load-insights.js', '../solution-validator.js', '../packing-engine.js'])
  vm.runInContext(await readFile(new URL(file.replace(/^\.\.\//, '../../'), import.meta.url), 'utf8'), context);
export const { LoadwiseEngine: engine, LoadwiseValidator: validator } = context;
export const C20 = { name: '20ft Dry', l: 5898, w: 2352, h: 2393, maxWeight: 28200 };
export const CONTAINERS = [
  C20,
  { name: '40ft Dry', l: 12032, w: 2352, h: 2393, maxWeight: 26700 },
  { name: '40ft High Cube', l: 12032, w: 2352, h: 2698, maxWeight: 26500 },
  { name: '45ft High Cube', l: 13556, w: 2352, h: 2698, maxWeight: 27600 }
];
export const base = {
  name: 'box',
  group: '기타',
  shape: 'box',
  l: 1000,
  w: 800,
  h: 700,
  weight: 100,
  rotate: false,
  fragile: false
};
export const units = (count, change = {}, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({ ...base, ...change, pi: 0, unit: offset + i + 1 }));
export const pack = (items, options = {}) =>
  engine.packShipment({ container: C20, units: items, timeBudgetMs: 60000, ...options });
export const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y));
export const supportRatio = (p, placed) =>
  p.z === 0
    ? 1
    : placed.filter(q => q !== p && Math.abs(q.z + q.h - p.z) < 2).reduce((sum, q) => sum + overlapArea(p, q), 0) /
      (p.l * p.w);

export const widthMix = () => [
  ...units(12, { name: 'wide', w: 820, rotate: true }),
  ...units(12, { name: 'medium', w: 700, rotate: true }, 12),
  ...units(16, { name: 'narrow', w: 530, rotate: true }, 24)
];
export const fragileMix = () => [
  ...units(6, { name: 'fragile', l: 900, w: 700, h: 500, weight: 60, fragile: true, rotate: true }),
  ...units(18, { name: 'strong', l: 800, w: 600, h: 650, weight: 180, rotate: true }, 6)
];
export const mixed = () =>
  Array.from({ length: 24 }, (_, i) => ({
    ...base,
    rotate: true,
    l: 600 + (i % 4) * 180,
    w: 500 + (i % 3) * 140,
    h: 450 + (i % 2) * 250,
    weight: 80 + i * 7,
    pi: 0,
    unit: i + 1
  }));

export function assertValidShipment(result, items) {
  const shipment = {
    safety: result.safety,
    containers: result.loads,
    unallocated: result.remaining,
    totalUnits: items.length
  };
  const validation = validator.validateShipment(shipment);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  for (const load of result.loads) {
    const minSupport = engine.SAFETY_LEVELS[result.safety].minSupport;
    for (const p of load.placed) {
      assert.ok(supportRatio(p, load.placed) >= minSupport - 1e-6, `${p.name} 지지율`);
      if (p.z > 0)
        assert.ok(
          !load.placed.some(q => q.fragile && Math.abs(q.z + q.h - p.z) < 2 && overlapArea(p, q) > 0),
          '상부적재금지 위 배치'
        );
    }
  }
}
