import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

// packing-engine.js는 engine/*.js 조각을 이어 붙여 만든다(tools/build-engine.mjs).
// 조각만 고치고 조립을 잊으면 화면·작업자·테스트가 옛 엔진을 쓰므로 여기서 잡는다.
const root = new URL('../', import.meta.url);

test('packing-engine.js is exactly the engine/*.js parts joined in name order', async () => {
  const names = (await readdir(new URL('engine/', root))).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
  assert.ok(names.length >= 5, `engine parts: ${names.join(', ')}`);
  let joined = '';
  for (const name of names) {
    const text = await readFile(new URL(`engine/${name}`, root), 'utf8');
    assert.ok(text.startsWith('// '), `${name} starts with a one-line description`);
    joined += text.slice(text.indexOf('\n') + 1);
  }
  const built = await readFile(new URL('packing-engine.js', root), 'utf8');
  assert.equal(
    built,
    joined,
    '엔진 조각이 바뀌었습니다. node tools/build-engine.mjs 로 packing-engine.js를 다시 만드세요.'
  );
});
