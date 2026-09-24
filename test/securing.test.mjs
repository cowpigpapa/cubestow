import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 고정재 계획은 app.js에 있으므로 벤치마크처럼 화면 코드와 함께 불러와 검사한다.
const context=vm.createContext({console,performance,setTimeout,clearTimeout});
for(const file of ['load-insights.js','solution-validator.js','packing-engine.js','sample-scenarios.js','app.js'])vm.runInContext(await readFile(new URL(`../${file}`,import.meta.url),'utf8'),context);
vm.runInContext('globalThis.__samples=SAMPLE_SETS;globalThis.__containers=CONTAINERS;globalThis.__plan=buildSecuringPlan;',context);
const overlap=(a,b)=>Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y)>1&&Math.min(a.z+a.h,b.z+b.h)-Math.max(a.z,b.z)>1;

test('airbags never overlap each other, cargo or dunnage',()=>{
  let checked=0;
  for(const [id,sample] of Object.entries(context.__samples)){
    const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
    const result=context.LoadwiseEngine.packShipment({container:context.__containers[sample.container],units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:60000});
    for(const load of result.loads){
      const plan=context.__plan(load,sample.mode);
      plan.airbags.forEach((a,i)=>{
        plan.airbags.slice(i+1).forEach(b=>assert.ok(!overlap(a,b),`sample ${id}: airbags overlap at ${a.location} / ${b.location}`));
        load.placed.forEach(p=>assert.ok(!overlap(a,p),`sample ${id}: airbag inside cargo ${p.name}`));
        plan.dunnage.forEach(d=>assert.ok(!overlap(a,d),`sample ${id}: airbag overlaps dunnage`));
        checked++;
      });
    }
  }
  assert.ok(checked>50,`only ${checked} airbags checked`);
});
