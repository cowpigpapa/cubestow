// 적재 엔진 조립: engine/*.js 조각을 이름 순서로 이어 붙여 packing-engine.js를 만든다.
//   node tools/build-engine.mjs           조립해서 쓴다
//   node tools/build-engine.mjs --check   조립 결과가 지금 packing-engine.js와 같은지만 본다(테스트·CI)
// 조각은 한 함수 범위(IIFE)를 나눈 것이라 따로 실행되지 않는다. 엔진을 고칠 때는 조각을 고치고 이 스크립트를 돌린다.
// 각 조각의 첫 줄(// 설명)은 조립할 때 뺀다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..'),
  dir = join(root, 'engine'),
  target = join(root, 'packing-engine.js');
const parts = readdirSync(dir)
  .filter(f => /^\d\d-.*\.js$/.test(f))
  .sort();
const joined = parts
  .map(f => {
    const text = readFileSync(join(dir, f), 'utf8');
    return text.startsWith('//') ? text.slice(text.indexOf('\n') + 1) : text;
  })
  .join('');
if (process.argv.includes('--check')) {
  const same = readFileSync(target, 'utf8') === joined;
  console.log(
    same
      ? 'packing-engine.js is up to date'
      : 'packing-engine.js differs from engine/*.js — run: node tools/build-engine.mjs'
  );
  process.exit(same ? 0 : 1);
}
writeFileSync(target, joined);
console.log(`packing-engine.js built from ${parts.length} parts (${joined.length} chars)`);
