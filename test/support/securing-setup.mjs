// securing.test.mjs에서 옮긴 공통 준비 코드(엔진·검증기 불러오기와 도우미). 테스트 파일들이 함께 쓴다.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// 고정재 계획(securing-plan.js)은 app.js의 esc 등을 쓰므로 벤치마크처럼 화면 코드와 함께 불러와 검사한다.
export const context = vm.createContext({ console, performance, setTimeout, clearTimeout });
for (const file of [
  'load-insights.js',
  'solution-validator.js',
  'packing-engine.js',
  'sample-scenarios.js',
  'securing-plan.js',
  'app.js'
])
  vm.runInContext(await readFile(new URL(`../../${file}`, import.meta.url), 'utf8'), context);
vm.runInContext(
  'globalThis.__samples=SAMPLE_SETS;globalThis.__containers=CONTAINERS;globalThis.__plan=buildSecuringPlan;',
  context
);
export const overlap = (a, b) =>
  Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y) > 1 &&
  Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > 1;
