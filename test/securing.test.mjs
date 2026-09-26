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
    // 열린 면은 모두 고정재 권고에 나온다. 단 안쪽 면이 안쪽 바닥 각재로 막힌 화물은 목록에서 빠진다.
    const load=result.loads[0],beamed=validation.securingRequired.flat().filter(v=>{const p=load.placed[v.index];return v.faces.length===1&&v.faces[0]==='안쪽'&&plan.dunnage.some(d=>d.kind==='beam'&&d.side==='max'&&Math.abs(d.x-(p.x+p.l))<2&&Math.min(d.y+d.w,p.y+p.w)-Math.max(d.y,p.y)>0)}).length;
    assert.equal(plan.reviews.filter(r=>r.ctuFace).length,open-beamed,`sample ${id}: every open face appears in the securing plan or is closed by an inner beam`);
    assert.ok(plan.reviews.filter(r=>r.ctuFace).every(r=>/래싱으로 묶기/.test(r.location)));
  }
});

test('identical boxes fill every lane up to the inner wall and leave the short lane at the door',()=>{
  // 사용자 지적(1.1.57): 수출박스 42개(3단 기둥 14개)에서 빈 기둥 자리가 안쪽 끝에 생겨 충전재·에어백이 들어갔다. 같은 화물은 안쪽까지 꽉 채운다.
  const sample=context.__samples[2],container=context.__containers[sample.container];
  const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  const load=context.LoadwiseEngine.packShipment({container,units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:8000}).loads[0];
  // 바닥 화물마다 같은 줄(폭이 절반 이상 겹침)에 안쪽 벽에 닿은 화물이 있어야 한다.
  const floor=load.placed.filter(p=>p.z===0),inner=floor.filter(p=>p.x+p.l===container.l);
  for(const p of floor)assert.ok(inner.some(q=>Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y)>=p.w/2),`lane at y ${p.y} does not reach the inner wall`);
  const plan=context.__plan(load,sample.mode);
  assert.equal(plan.airbags.filter(a=>a.x+a.l>container.l-1500).length,0,'no airbag near the inner wall');
});

test('with nails and lashing on there is no filler at the inner wall and no door fence or filler block',()=>{
  // 사용자 결정(2026-09-27): 안쪽과 화물 사이에는 충전재를 쓰지 않고, 문쪽 빈 공간은 충전재 덩어리 대신 못 박은 각재와 윗단 되잡기 래싱으로 막는다.
  for(const id of ['2','11','18']){
    const sample=context.__samples[id],container=context.__containers[sample.container];
    const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
    const result=context.LoadwiseEngine.packShipment({container,units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:8000});
    for(const load of result.loads){
      const plan=context.__plan(load,sample.mode);
      assert.equal(plan.dunnage.filter(d=>d.kind==='fence').length,0,`sample ${id}: door fence`);
      assert.equal(plan.dunnage.filter(d=>d.kind==='filler'&&/문쪽 충전재/.test(d.location)).length,0,`sample ${id}: door filler`);
      assert.equal(plan.dunnage.filter(d=>(d.kind==='filler'||d.kind==='spacer')&&/안쪽 벽/.test(d.location)).length,0,`sample ${id}: inner-wall filler`);
    }
  }
});

test('heavy cable drums sit in the middle with nailed beams at both ends, and the Korean road limit caps the payload',()=>{
  // 사용자 결정(2026-09-27): 무거운 케이블 드럼은 안쪽 벽과 관계없이 가운데에 싣는다(CTU 부속서 7 §3.1 무게중심 ±5%).
  const c=context.__containers['20ft'],drum=(n,d,h,kg,top)=>Array.from({length:n},(_,i)=>({name:'중량 케이블 드럼',group:'전선',shape:'cylinder',l:d,w:d,h,weight:kg,maxTopLoadKg:top,rotate:false,fragile:false,pi:0,unit:i+1}));
  for(const safety of ['strict','secure']){
    const load=context.LoadwiseEngine.packShipment({container:c,units:drum(6,1100,900,2000,0),safety,transportMode:'road',timeBudgetMs:8000}).loads[0];
    assert.equal(load.shifted,true,safety);
    assert.notEqual(context.LoadwiseInsights.ctu(load).level,'danger',safety);
    const plan=context.__plan(load,'road',undefined,safety);
    assert.ok(plan.dunnage.some(d=>d.kind==='beam'&&/안쪽/.test(d.location)),`${safety}: inner-end beam`);
    assert.ok(plan.dunnage.some(d=>d.kind==='beam'&&/앞 바닥 각재/.test(d.location)),`${safety}: door-end beam`);
    assert.equal(plan.reviews.filter(r=>r.ctuFace&&/안쪽/.test(r.location)).length,0,`${safety}: inner faces are closed by the beams`);
  }
  // 한국 도로 한도(20ft 21t): 1.5t 드럼 16개(24t)는 명판 한도(28.2t)면 1대, 도로 한도면 2대.
  const units=drum(16,700,900,1500,0);
  assert.equal(context.LoadwiseEngine.packShipment({container:c,units,safety:'strict',transportMode:'road',timeBudgetMs:8000}).loads.length,1);
  const road=context.LoadwiseEngine.packShipment({container:context.__containers['20ft-kr'],units,safety:'strict',transportMode:'road',timeBudgetMs:8000});
  assert.equal(road.loads.length,2);
  assert.ok(road.loads.every(l=>l.totalWeight<=21000));
});
