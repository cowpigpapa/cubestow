import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 고정재 계획은 app.js에 있으므로 벤치마크처럼 화면 코드와 함께 불러와 검사한다.
const context=vm.createContext({console,performance,setTimeout,clearTimeout});
for(const file of ['load-insights.js','solution-validator.js','packing-engine.js','sample-scenarios.js','app.js'])vm.runInContext(await readFile(new URL(`../${file}`,import.meta.url),'utf8'),context);
vm.runInContext('globalThis.__samples=SAMPLE_SETS;globalThis.__containers=CONTAINERS;globalThis.__plan=buildSecuringPlan;',context);
const overlap=(a,b)=>Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y)>1&&Math.min(a.z+a.h,b.z+b.h)-Math.max(a.z,b.z)>1;

test('airbags never overlap each other, cargo or dunnage, and never sit at a container end',()=>{
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
        // 컨테이너 끝(안쪽 벽·문)에는 에어백을 두지 않는다.
        assert.ok(a.x+a.l<load.container.l-1&&a.x>1,`sample ${id}: airbag at a container end (${a.location})`);assert.ok(!/안쪽 벽/.test(a.location),`sample ${id}: inner-wall airbag`);
        checked++;
      });
    }
  }
  assert.ok(checked>50,`only ${checked} airbags checked`);
});

test('airbags fill at most a 600 mm gap off the floor, and other securing items never overlap cargo or airbags',()=>{
  let fillers=0;
  for(const [id,sample] of Object.entries(context.__samples)){
    const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
    const result=context.LoadwiseEngine.packShipment({container:context.__containers[sample.container],units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:60000});
    for(const load of result.loads){
      const plan=context.__plan(load,sample.mode);
      // 제조사 권장: 백은 컨테이너 바닥에 닿지 않고, 간극은 백 한계(600mm) 이하. 넘는 벽 간극은 충전재로 줄인다.
      for(const a of plan.airbags){
        assert.ok(a.z>=100,`sample ${id}: airbag touches the floor (${a.location})`);
        if(a.zone==='left'||a.zone==='right')assert.ok(a.w<=600+1,`sample ${id}: wall airbag spans ${a.w} mm`);
        if(a.zone==='cargo')assert.ok(a.l<=600+1,`sample ${id}: cargo airbag spans ${a.l} mm`);
        assert.match(a.bag||'',/^\d+×\d+$/,`sample ${id}: airbag size missing`);
      }
      // 충전재·도어 스트랩·문쪽 각재 펜스·틈 스페이서·상단 래싱은 화물·에어백과 겹치지 않고 컨테이너 안에 있다.
      for(const d of plan.dunnage.filter(d=>['filler','strap','fence','spacer','lashing'].includes(d.kind))){
        assert.ok(d.x>=-1&&d.y>=-1&&d.z>=-1&&d.x+d.l<=load.container.l+1&&d.y+d.w<=load.container.w+1&&d.z+d.h<=load.container.h+1,`sample ${id}: ${d.kind} outside the container`);
        fillers++;
        load.placed.forEach(p=>assert.ok(!overlap(d,p),`sample ${id}: ${d.kind} inside cargo ${p.name}`));
        plan.airbags.forEach(a=>assert.ok(!overlap(d,a),`sample ${id}: ${d.kind} overlaps an airbag`));
      }
    }
  }
  assert.ok(fillers>0,'no filler or strap was recommended in any sample');
});

test('securing options replace or drop airbags, fillers, floor nails and lashing as chosen',()=>{
  const sample=context.__samples[3],items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  const load=context.LoadwiseEngine.packShipment({container:context.__containers[sample.container],units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:60000}).loads[0];
  const all=context.__plan(load,sample.mode,{airbag:true,filler:true,nails:true,lashing:true});
  assert.ok(all.airbags.length>0&&all.dunnage.some(d=>d.kind==='beam')&&all.dunnage.some(d=>d.kind==='lashing'));
  // 에어백을 끄면 같은 자리를 충전재로 채운다.
  const noBag=context.__plan(load,sample.mode,{airbag:false,filler:true,nails:true,lashing:true});
  assert.equal(noBag.airbags.length,0);assert.ok(noBag.dunnage.filter(d=>d.kind==='filler').length>=all.dunnage.filter(d=>d.kind==='filler').length+all.airbags.length);
  // 바닥 못을 끄면 바닥 각재·쐐기 대신 문쪽 펜스를 쓴다.
  const noNail=context.__plan(load,sample.mode,{airbag:true,filler:true,nails:false,lashing:true});
  assert.ok(!noNail.dunnage.some(d=>d.kind==='beam'||d.kind==='chock'));assert.ok(noNail.dunnage.some(d=>d.kind==='fence'));
  // 래싱을 끄면 스트랩·래싱을 빼고 재배치 검토로 남긴다.
  const noLash=context.__plan(load,sample.mode,{airbag:true,filler:true,nails:true,lashing:false});
  assert.ok(!noLash.dunnage.some(d=>d.kind==='lashing'||d.kind==='strap'));assert.ok(noLash.reviews.some(r=>/래싱 미사용/.test(r.location)));
});

test('gaps collect at the door side: sample 6 has no airbag in a gap near the inner wall',()=>{
  // 사용자 지적(1.1.46): 75형 TV 줄과 안쪽 55형 묶음 사이 470mm 틈에 에어백이 들어갔다. 화물을 안쪽으로 밀면 이 틈은 문쪽으로 간다.
  const sample=context.__samples[6],container=context.__containers[sample.container];
  const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  const result=context.LoadwiseEngine.packShipment({container,units:items,safety:'standard',transportMode:'road',timeBudgetMs:60000});
  for(const load of result.loads){
    const plan=context.__plan(load,'road');
    for(const a of plan.airbags){
      if(a.x+a.l<container.l-2500)continue;
      const inner=load.placed.some(p=>p.x>=a.x+a.l-1&&Math.min(a.y+a.w,p.y+p.w)-Math.max(a.y,p.y)>0&&Math.min(a.z+a.h,p.z+p.h)-Math.max(a.z,p.z)>0);
      assert.ok(!inner,`airbag at x ${Math.round(a.x)} sits between cargo within 2.5 m of the inner wall`);
    }
  }
});

test('CTU mode uses no more containers than the basic mode and names each face that securing must close',()=>{
  // 사용자 결정(2026-09-26): 화물끼리 막는 배치가 대수를 늘리면 기본 배치를 쓰고, 화물로 막히지 않은 옆면은 고정재 권고에 화물별로 적는다.
  for(const id of ['1','10']){
    const sample=context.__samples[id],container=context.__containers[sample.container];
    const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
    const result=context.LoadwiseEngine.packShipment({container,units:items,safety:'secure',transportMode:sample.mode,timeBudgetMs:8000});
    assert.equal(result.loads.length,1,`sample ${id}: containers ${result.loads.length}`);
    assert.equal(result.remaining.length,0);
    const validation=context.LoadwiseValidator.validateShipment({safety:'secure',transportMode:sample.mode,containers:result.loads,unallocated:result.remaining,totalUnits:items.length});
    assert.equal(validation.valid,true,validation.errors.slice(0,3).join('; '));
    const open=validation.securingRequired.flat().length,plan=context.__plan(result.loads[0],sample.mode,undefined,'secure');
    assert.ok(open>0,`sample ${id}: expected open faces for securing`);
    assert.equal(plan.reviews.filter(r=>r.ctuFace).length,open,`sample ${id}: every open face appears in the securing plan`);
    assert.ok(plan.reviews.filter(r=>r.ctuFace).every(r=>/래싱으로 묶기/.test(r.location)));
  }
});
