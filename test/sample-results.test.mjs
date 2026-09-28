import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 샘플 결과 미리보기(#samples)의 캡처가 지금 엔진으로 만든 것인지 확인한다.
// 엔진(계산 결과)이 바뀌었는데 `npm run samples:capture`를 다시 하지 않았으면 여기서 실패한다.
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('sample-results/manifest.json',root),'utf8'));
const context=vm.createContext({console,performance,setTimeout,clearTimeout});
vm.runInContext(await readFile(new URL('packing-engine.js',root),'utf8'),context);
vm.runInContext(await readFile(new URL('sample-scenarios.js',root),'utf8'),context);
vm.runInContext('globalThis.__samples=SAMPLE_SETS;',context);

test('the sample results preview was captured with the current packing engine',()=>{
  assert.equal(manifest.engine,context.LoadwiseEngine.ENGINE_VERSION,'엔진이 바뀌었습니다. npm run samples:capture로 샘플 결과를 다시 만드세요.');
});

test('the sample results preview covers every sample in three safety levels with front and back pictures',async()=>{
  const ids=Object.keys(context.__samples).map(Number).sort((a,b)=>a-b);
  assert.deepEqual(manifest.samples.map(s=>s.id),ids);
  assert.deepEqual(manifest.modes.map(m=>m.key),['standard','strict','secure']);
  for(const sample of manifest.samples){
    for(const mode of manifest.modes){
      const r=sample.results[mode.key];
      assert.ok(r,`sample ${sample.id} ${mode.key} missing`);
      assert.equal(r.images.length,r.containers.length);assert.equal(r.backImages.length,r.containers.length);
      for(const file of [...r.images,...r.backImages])await access(new URL(`sample-results/${file}`,root));
    }
  }
});
