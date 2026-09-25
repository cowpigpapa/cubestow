import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context=vm.createContext({console,performance});
for(const file of ['../load-insights.js','../solution-validator.js','../packing-engine.js'])vm.runInContext(await readFile(new URL(file,import.meta.url),'utf8'),context);
const {LoadwiseEngine:engine,LoadwiseValidator:validator}=context;
const C20={name:'20ft Dry',l:5898,w:2352,h:2393,maxWeight:28200};
const CONTAINERS=[C20,{name:'40ft Dry',l:12032,w:2352,h:2393,maxWeight:26700},{name:'40ft High Cube',l:12032,w:2352,h:2698,maxWeight:26500},{name:'45ft High Cube',l:13556,w:2352,h:2698,maxWeight:27600}];
const base={name:'box',group:'기타',shape:'box',l:1000,w:800,h:700,weight:100,rotate:false,fragile:false};
const units=(count,change={},offset=0)=>Array.from({length:count},(_,i)=>({...base,...change,pi:0,unit:offset+i+1}));
const pack=(items,options={})=>engine.packShipment({container:C20,units:items,timeBudgetMs:60000,...options});
const overlapArea=(a,b)=>Math.max(0,Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y));
const supportRatio=(p,placed)=>p.z===0?1:placed.filter(q=>q!==p&&Math.abs(q.z+q.h-p.z)<2).reduce((sum,q)=>sum+overlapArea(p,q),0)/(p.l*p.w);

const widthMix=()=>[...units(12,{name:'wide',w:820,rotate:true}),...units(12,{name:'medium',w:700,rotate:true},12),...units(16,{name:'narrow',w:530,rotate:true},24)];
const fragileMix=()=>[...units(6,{name:'fragile',l:900,w:700,h:500,weight:60,fragile:true,rotate:true}),...units(18,{name:'strong',l:800,w:600,h:650,weight:180,rotate:true},6)];
const mixed=()=>Array.from({length:24},(_,i)=>({...base,rotate:true,l:600+(i%4)*180,w:500+(i%3)*140,h:450+(i%2)*250,weight:80+i*7,pi:0,unit:i+1}));

function assertValidShipment(result,items){
  const shipment={safety:result.safety,containers:result.loads,unallocated:result.remaining,totalUnits:items.length};
  const validation=validator.validateShipment(shipment);
  assert.equal(validation.valid,true,validation.errors.join('; '));
  for(const load of result.loads){
    const minSupport=engine.SAFETY_LEVELS[result.safety].minSupport;
    for(const p of load.placed){
      assert.ok(supportRatio(p,load.placed)>=minSupport-1e-6,`${p.name} 지지율`);
      if(p.z>0)assert.ok(!load.placed.some(q=>q.fragile&&Math.abs(q.z+q.h-p.z)<2&&overlapArea(p,q)>0),'상부적재금지 위 배치');
    }
  }
}

for(const safety of ['strict','standard'])for(const [name,change] of [
  ['small',{}],['rotated',{rotate:true,l:1800,w:600,h:500}],['cylinder',{shape:'cylinder',l:900,w:900,h:700}],
  ['fragile',{fragile:true}],['tall',{l:800,w:800,h:1800}],['wide',{l:1200,w:1100,h:600}],['heavy',{weight:5000}],['many',{qty:12}]
])test(`packing invariants: ${safety} ${name}`,()=>{
  const items=units(change.qty||4,change);
  const result=pack(items,{safety});
  assertValidShipment(result,items);
});

test('all supported container sizes preserve packing invariants',()=>{
  for(const container of CONTAINERS){const items=mixed(),result=engine.packShipment({container,units:items,safety:'strict'});assertValidShipment(result,items);assert.equal(result.loads.length,1,container.name)}
});

test('strict safety keeps 100 percent upper support and never stacks slender cargo on top',()=>{
  for(const items of [widthMix(),fragileMix(),mixed()]){
    const result=pack(items,{safety:'strict'});
    assertValidShipment(result,items);
    result.loads.forEach(load=>load.placed.filter(p=>p.z>0).forEach(p=>{assert.ok(supportRatio(p,load.placed)>=.999999);assert.ok(p.h/Math.min(p.l,p.w)<=1.15)}));
  }
});

test('regression: strict safety loads width and fragile mixes in one container',()=>{
  for(const items of [widthMix(),fragileMix()])for(const preference of ['auto','density','width','balance']){
    const result=pack(items,{safety:'strict',preference});
    assert.equal(result.loads.length,1,preference);assert.equal(result.remaining.length,0,preference);
  }
});

test('preference never changes the container count under the same safety level',()=>{
  for(const items of [widthMix(),fragileMix(),mixed()])for(const safety of ['strict','standard']){
    const counts=['auto','density','width','balance'].map(preference=>{const r=pack(items,{safety,preference});return`${r.loads.length}/${r.remaining.length}`});
    assert.equal(new Set(counts).size,1,`${safety}: ${counts}`);
  }
});

// 화물은 안쪽 벽에 붙인다. 전후 편차는 CTU 위험 수준(10%)만 넘지 않으면 밀착을 유지하고 좌우는 가운데로 맞춘다.
test('balance preference keeps a uniform load against the inner wall without a dangerous offset',()=>{
  const items=units(36,{rotate:true}),result=pack(items,{preference:'balance'}),b=context.LoadwiseInsights.balance(result.loads[0]);
  assert.equal(result.loads.length,1);assert.equal(result.remaining.length,0);
  assert.ok(Math.abs(b.xOffset)<=10&&Math.abs(b.yOffset)<=5);
  assert.equal(Math.max(...result.loads[0].placed.map(p=>p.x+p.l)),C20.l);
});

test('reordering independent slices centers heavy cargo without losing the inner wall',()=>{
  const items=[...units(6,{name:'heavy',l:1200,w:1000,h:1000,weight:1200}),...units(12,{name:'light',l:1000,w:1000,h:1100,weight:40},6)].map((u,i)=>({...u,pi:i<6?0:1}));
  const result=pack(items,{safety:'standard'}),load=result.loads[0],ctu=context.LoadwiseInsights.ctu(load);
  assert.equal(result.loads.length,1);assert.equal(result.remaining.length,0);
  // 무거운 화물을 안쪽 벽에 몰아 두면 앞뒤 편차가 15%를 넘는다. 슬라이스 순서를 바꾸면 5% 안으로 들어온다.
  assert.ok(Math.abs(ctu.xOffset)<=5&&Math.abs(ctu.yOffset)<=5,`x ${ctu.xOffset} y ${ctu.yOffset}`);
  assert.equal(Math.max(...load.placed.map(p=>p.x+p.l)),C20.l);
  assertValidShipment(result,items);
});

test('oversize and overweight cargo is reported as unallocated',()=>{
  const oversize=pack(units(4,{l:14000}));assert.equal(oversize.loads.length,1);assert.equal(oversize.loads[0].placed.length,0);assert.equal(oversize.remaining.length,4);
  const overweight=pack(units(1,{weight:30000}));assert.equal(overweight.loads[0].placed.length,0);assert.equal(overweight.remaining[0].reason,'중량 초과');
});

test('boxes never rest on cylinders and cylinders stack only when centered',()=>{
  const items=[...units(20,{shape:'cylinder',l:900,w:900,h:700}),...units(6,{name:'crate',l:900,w:900,h:500},20)];
  for(const safety of ['strict','standard']){
    const result=pack(items,{safety});assertValidShipment(result,items);
    for(const load of result.loads)for(const p of load.placed.filter(q=>q.z>0)){
      const below=load.placed.filter(q=>Math.abs(q.z+q.h-p.z)<2&&overlapArea(p,q)>0);
      if(below.some(q=>q.shape==='cylinder'))assert.equal(p.shape,'cylinder');
    }
    assert.ok(result.loads.some(load=>load.placed.some(p=>p.z>0&&p.shape==='cylinder')),'원통 적층 허용');
  }
});

test('declared top-load capacity is never exceeded',()=>{
  const items=[...units(6,{name:'base',maxTopLoadKg:50,rotate:false}),...units(12,{name:'upper',weight:100},6)];
  const result=pack(items);assertValidShipment(result,items);
});

test('tall cargo above 1.5 column slenderness keeps at least two side supports',()=>{
  const items=units(6,{l:800,w:800,h:2200}),result=pack(items);assertValidShipment(result,items);
  for(const load of result.loads)for(const p of load.placed){
    const sides=engine.lateralSupportDirections(p,[p.l,p.w,p.h],load.placed.filter(q=>q!==p),load.container);
    assert.ok(Object.values(sides).filter(Boolean).length>=2);
  }
});

test('50 percent rear contact counts as lateral support',()=>{
  assert.equal(engine.lateralSupportDirections({x:1000,y:1000,z:0},[800,800,2200],[{x:1800,y:1000,z:0,l:1000,w:400,h:1100}],C20).back,true);
});

test('a column of stacked boxes supports a tall neighbor only when together they cover half its height',()=>{
  const box=z=>({x:1800,y:1000,z,l:600,w:800,h:300});
  // 300mm 박스 한 개로는 2200mm 화물의 절반을 덮지 못하지만, 4단 기둥(1200mm)은 벽처럼 지지한다.
  assert.equal(engine.lateralSupportDirections({x:1000,y:1000,z:0},[800,800,2200],[box(0)],C20).back,false);
  assert.equal(engine.lateralSupportDirections({x:1000,y:1000,z:0},[800,800,2200],[box(0),box(300),box(600)],C20).back,false);
  assert.equal(engine.lateralSupportDirections({x:1000,y:1000,z:0},[800,800,2200],[box(0),box(300),box(600),box(900)],C20).back,true);
});

test('sea transport adds a larger placement risk than road transport',()=>{
  const sides={front:false,back:false,left:false,right:false},risk=mode=>engine._internal.transportPlacementRisk({...base,h:1600},{x:1000,y:500,z:700},[800,800,1600],sides,C20,mode);
  assert.ok(risk('sea')>risk('road'));
});

test('lexicographic keys compare every position instead of summing weights',()=>{
  const compare=engine._internal.compareKeys;
  assert.equal(compare([1,0,0],[0,1e30,1e30]),1);
  assert.equal(compare([0,5,1],[0,5,2]),-1);
  assert.equal(compare([0,1e20+1,1],[0,1e20+1,1]),0);
});

test('lower bound reflects volume and weight',()=>{
  assert.equal(engine.lowerBound(C20,units(1)),1);
  assert.equal(engine.lowerBound(C20,units(3,{weight:10000})),2);
});

test('unchanged inputs keep previous placements when recalculated',()=>{
  const items=mixed(),first=pack(items,{preference:'width'});
  const previous={containers:first.loads,unallocated:first.remaining,totalUnits:items.length,safety:first.safety,preference:first.preference,transportMode:first.transportMode};
  const changed=items.map((p,i)=>i===0?{...p,rotate:false}:p),second=pack(changed,{preference:'width',previous});
  assert.equal(second.stats.repaired,true);assert.equal(second.loads.length,1);
  const before=new Map(first.loads[0].placed.map(p=>[p.unit,[p.x,p.y,p.z,p.l,p.w,p.h]]));
  second.loads[0].placed.filter(p=>p.unit!==1).forEach(p=>assert.deepEqual([p.x,p.y,p.z,p.l,p.w,p.h],before.get(p.unit)));
});

test('previous layout is ignored when the safety level changes',()=>{
  const items=mixed(),first=pack(items);
  const previous={containers:first.loads,unallocated:first.remaining,totalUnits:items.length,safety:'standard',preference:first.preference,transportMode:first.transportMode};
  assert.equal(pack(items,{previous}).stats.repaired,false);
});

test('200 mixed units finish within the time budget and stay valid',()=>{
  const types=[[1200,1000,900,300],[1000,800,700,150],[800,600,500,80],[600,400,400,40]];
  const items=Array.from({length:200},(_,i)=>{const [l,w,h,weight]=types[i%4];return{...base,name:`T${i%4}`,l,w,h,weight,rotate:true,pi:i%4,unit:i+1}});
  const container=CONTAINERS[2],started=performance.now(),result=engine.packShipment({container,units:items,timeBudgetMs:5000});
  assert.ok(performance.now()-started<10000);
  assertValidShipment(result,items);
  assert.equal(result.remaining.length,0);
  assert.ok(result.loads.length>=result.stats.lowerBound);
});

test('portfolio skips runs whose input order repeats an earlier run',()=>{
  const items=units(60,{rotate:true}),result=pack(items);
  // 첫 컨테이너에서 배치 규칙 6종이 각각 중복 순서 3개를 건너뛴다(두 번째 컨테이너는 조기 종료할 수 있다).
  assert.ok(result.stats.skipped>=18,`runs ${result.stats.runs} skipped ${result.stats.skipped}`);
  assertValidShipment(result,items);
});

test('run de-duplication does not rely on unit ids',()=>{
  const items=mixed(),anonymous=items.map(({pi,unit,...p})=>p);
  const withIds=pack(items),withoutIds=pack(anonymous);
  assert.equal(withoutIds.stats.runs,withIds.stats.runs);assert.equal(withoutIds.stats.skipped,withIds.stats.skipped);
});

test('later containers ignore widths of cargo already loaded in earlier containers',()=>{
  const types=[[1200,1000,900,300],[1000,800,700,150],[800,600,500,80],[600,400,400,40]];
  const items=Array.from({length:200},(_,i)=>{const [l,w,h,weight]=types[i%4];return{...base,name:`T${i%4}`,l,w,h,weight,rotate:true,pi:i%4,unit:i+1}});
  const container=CONTAINERS[2],result=engine.packShipment({container,units:items,safety:'strict',timeBudgetMs:60000});
  assertValidShipment(result,items);
  assert.equal(result.remaining.length,0);
  assert.equal(result.loads.length,result.stats.lowerBound);
  // 두 번째 컨테이너는 남은 화물만 따로 계산한 결과와 같아야 한다(앞 컨테이너 이력과 무관).
  const firstIds=new Set(result.loads[0].placed.map(p=>`${p.pi}:${p.unit}`)),rest=items.filter(p=>!firstIds.has(`${p.pi}:${p.unit}`));
  const alone=engine.packShipment({container,units:rest,safety:'strict',timeBudgetMs:60000});
  assert.equal(alone.loads[0].placed.length,result.loads[1].placed.length);
});

test('incremental top-load check matches a full recomputation by the validator',()=>{
  let seed=20260924;
  const rand=()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
  const pick=(min,max,step)=>min+step*Math.floor(rand()*((max-min)/step+1));
  const container={l:4000,w:2400,h:4000,maxWeight:1e9},drop=(box,placed)=>Math.max(0,...placed.filter(q=>overlapArea(box,q)>0).map(q=>q.z+q.h));
  const limit=()=>rand()<.6?pick(50,600,50):undefined,overloaded=placed=>validator.validateLoad({container,placed}).errors.some(e=>e.includes('상부 허용하중'));
  let checked=0,rejected=0,fallback=0,incrementalRejected=0;
  for(let scenario=0;scenario<200;scenario++){
    const placed=[];
    for(let k=0;k<20;k++){
      const box={name:'b',shape:'box',l:pick(400,1200,100),w:pick(400,1200,100),h:pick(300,900,100),weight:pick(10,200,10),maxTopLoadKg:limit()};
      box.x=pick(0,container.l-box.l,100);box.y=pick(0,container.w-box.w,100);box.z=drop(box,placed);
      // 기존 배치는 엔진이 실제로 만드는 상태처럼 상부 허용하중을 지킨다.
      if(!overloaded([...placed,box]))placed.push(box);
    }
    const state={placed:[...placed]};
    for(let k=0;k<30;k++){
      const item={name:'c',shape:'box',weight:pick(10,300,10),maxTopLoadKg:limit()},d=[pick(300,1000,100),pick(300,1000,100),pick(200,600,100)];
      let pos={x:pick(0,container.l-d[0],100),y:pick(0,container.w-d[1],100),z:0};
      const under=placed.filter(p=>p.z>d[2]);
      if(k%5===0&&under.length){const p=under[Math.floor(rand()*under.length)];pos={x:p.x,y:p.y,z:p.z-d[2]};fallback++}
      else pos.z=drop({...pos,l:d[0],w:d[1]},placed);
      const all=[...placed,{...item,...pos,l:d[0],w:d[1],h:d[2]}];
      const expected=!overloaded(all);
      assert.equal(engine._internal.compressionSafe(item,pos.x,pos.y,pos.z,d,state),expected,`scenario ${scenario} candidate ${k}`);
      checked++;if(!expected){rejected++;if(k%5)incrementalRejected++}
    }
  }
  assert.ok(checked===6000&&fallback>=1000&&incrementalRejected>=300,`checked ${checked}, fallback ${fallback}, rejected on the incremental path ${incrementalRejected}`);
});

test('incremental top-load check carries converging loads down through stacked supports',()=>{
  // 후보 → 두 화물(M1·M2) → 한 화물(B1)로 모인 하중이 바닥 화물(B0)까지 모두 전달돼야 한다.
  const box=(x,y,z,l,w,h,weight,maxTopLoadKg)=>({name:'b',shape:'box',x,y,z,l,w,h,weight,maxTopLoadKg});
  const stack=limit=>[box(0,0,0,1000,1000,300,50,limit),box(0,0,300,1000,1000,300,40),box(0,0,600,500,1000,300,30),box(500,0,600,500,1000,300,20)];
  const item={name:'c',shape:'box',weight:100},d=[1000,1000,300],total=40+30+20+100;
  assert.equal(engine._internal.compressionSafe(item,0,0,900,d,{placed:stack(total)}),true);
  assert.equal(engine._internal.compressionSafe(item,0,0,900,d,{placed:stack(total-1)}),false);
});

test('cargo is loaded flush against the inner end wall',()=>{
  for(const items of [mixed(),widthMix(),fragileMix(),units(10,{rotate:true})])for(const safety of ['strict','standard'])for(const preference of ['auto','density','width','balance']){
    const result=pack(items,{safety,preference});
    for(const load of result.loads)assert.equal(Math.max(...load.placed.map(p=>p.x+p.l)),load.container.l,`${safety}/${preference}`);
  }
});

test('incremental stack balance check matches the validator',()=>{
  let seed=7;
  const rand=()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
  const pick=(min,max,step)=>min+step*Math.floor(rand()*((max-min)/step+1));
  const container={l:3000,w:2400,h:4000,maxWeight:1e9},drop=(box,placed)=>Math.max(0,...placed.filter(q=>overlapArea(box,q)>0).map(q=>q.z+q.h));
  const unbalanced=placed=>validator.validateLoad({container,placed}).errors.some(e=>e.includes('합성 무게중심'));
  let checked=0,rejected=0,fallback=0;
  for(let scenario=0;scenario<200;scenario++){
    const placed=[];
    for(let k=0;k<18;k++){
      const box={name:'b',shape:'box',l:pick(300,1500,100),w:pick(300,1500,100),h:pick(200,600,100),weight:pick(10,300,10)};
      box.x=pick(0,container.l-box.l,100);box.y=pick(0,container.w-box.w,100);box.z=drop(box,placed);
      if(!unbalanced([...placed,box]))placed.push(box);
    }
    const state={placed:[...placed]};
    for(let k=0;k<30;k++){
      const item={name:'c',shape:'box',weight:pick(10,600,10)},d=[pick(300,1600,100),pick(300,1600,100),pick(200,500,100)];
      let pos={x:pick(0,container.l-d[0],100),y:pick(0,container.w-d[1],100),z:0};
      const under=placed.filter(p=>p.z>d[2]);
      if(k%5===0&&under.length){const p=under[Math.floor(rand()*under.length)];pos={x:p.x,y:p.y,z:p.z-d[2]};fallback++}
      else pos.z=drop({...pos,l:d[0],w:d[1]},placed);
      const expected=!unbalanced([...placed,{...item,...pos,l:d[0],w:d[1],h:d[2]}]);
      assert.equal(engine._internal.stackSafe(item,pos.x,pos.y,pos.z,d,state),expected,`scenario ${scenario} candidate ${k}`);
      checked++;if(!expected&&k%5)rejected++;
    }
  }
  assert.ok(checked===6000&&fallback>=1000&&rejected>=300,`checked ${checked}, fallback ${fallback}, rejected on the incremental path ${rejected}`);
});

test('generated stacks keep their combined center of gravity over the supports',()=>{
  // 길고 얇은 플랫팩을 엇갈려 쌓는 경우 엔진이 합성 무게중심 조건을 스스로 지켜야 한다
  const items=[...units(30,{name:'panel',l:2050,w:620,h:160,weight:58,rotate:true}),...units(40,{name:'shelf',l:1850,w:420,h:120,weight:32,rotate:true},30),...units(20,{name:'top',l:1650,w:950,h:110,weight:38,rotate:true},70)];
  for(const safety of ['strict','standard'])assertValidShipment(pack(items,{safety}),items);
});

test('incremental stack balance check sums converging loads before passing them down',()=>{
  // 후보 → M1·M2 → B1로 모인 하중 전체로 B1의 합성 무게중심을 봐야 한다. B1은 x 0~1000에서만 받쳐진다.
  const box=(x,z,l,weight)=>({name:'b',shape:'box',x,y:0,z,l,w:1000,h:300,weight});
  const placed=[box(0,0,1000,100),box(0,300,1600,100),box(0,600,1000,400),box(1000,600,600,10)];
  const safe=weight=>engine._internal.stackSafe({name:'c',shape:'box',weight},700,0,900,[900,1000,300],{placed:[...placed]});
  assert.equal(safe(1400),true);assert.equal(safe(1800),false);
});

// 첫 적재는 예외 없이 안쪽 벽에 붙인다. 앞쪽이 무거워도 문 쪽으로 옮기지 않고 사전검사 경고로만 알린다.
test('every sample starts loading against the inner end wall in every container',async()=>{
  vm.runInContext((await readFile(new URL('../sample-scenarios.js',import.meta.url),'utf8'))+';globalThis.__samples=SAMPLE_SETS;',context);
  const containers={'20ft':C20,'40ft':CONTAINERS[1],'40hc':CONTAINERS[2]};
  for(const [id,sample] of Object.entries(context.__samples))for(const safety of ['strict','standard']){
    const items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
    const result=engine.packShipment({container:containers[sample.container],units:items,safety,transportMode:sample.mode,timeBudgetMs:60000});
    for(const load of result.loads){
      if(!load.placed.length)continue;
      const first=load.placed.find(p=>p.order===1);
      assert.equal(first.x+first.l,load.container.l,`sample ${id}/${safety}: first item is off the wall`);
      assert.equal(Math.max(...load.placed.map(p=>p.x+p.l)),load.container.l,`sample ${id}/${safety}`);
      // 최종 적재 상태에서 높은 화물은 모두 2면 이상 측면 지지된다(좌우 무게중심 맞춤·슬라이스 재배열 뒤에도).
      for(const p of load.placed)if((p.z+p.h)/Math.min(p.l,p.w)>1.5)assert.ok(Object.values(engine.lateralSupportDirections(p,[p.l,p.w,p.h],load.placed.filter(q=>q!==p),load.container)).filter(Boolean).length>=2,`sample ${id}/${safety}: ${p.name} side support`);
    }
  }
});

test('household move sample fits one container under strict safety without a dangerous offset',async()=>{
  if(!context.__samples)vm.runInContext((await readFile(new URL('../sample-scenarios.js',import.meta.url),'utf8'))+';globalThis.__samples=SAMPLE_SETS;',context);
  const sample=context.__samples[18],items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  const result=engine.packShipment({container:C20,units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:60000}),load=result.loads[0];
  // 쌓인 박스 기둥이 장롱·액자의 측면 지지가 되고, 한 덩어리 적재는 앞뒤 반전으로 무거운 기둥을 가운데 쪽으로 옮긴다.
  assert.equal(result.loads.length,1);assert.equal(result.remaining.length,0);
  assert.notEqual(context.LoadwiseInsights.ctu(load).level,'danger');
  assert.equal(Math.max(...load.placed.map(p=>p.x+p.l)),C20.l);
  assertValidShipment(result,items);
});

test('standing TVs fit one container when side support is judged on the finished load',async()=>{
  if(!context.__samples)vm.runInContext((await readFile(new URL('../sample-scenarios.js',import.meta.url),'utf8'))+';globalThis.__samples=SAMPLE_SETS;',context);
  const sample=context.__samples[6],items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  // 2단으로 세운 55형 TV의 윗단은 놓는 순간에는 옆 칸이 비어 있어도, 줄을 다 채우면 양옆이 지지된다.
  const result=engine.packShipment({container:CONTAINERS[1],units:items,safety:'standard',transportMode:sample.mode,timeBudgetMs:60000});
  assert.equal(result.loads.length,1);assert.equal(result.remaining.length,0);
  assertValidShipment(result,items);
});

test('strict safety never stands a cylinder on top of a box',async()=>{
  if(!context.__samples)vm.runInContext((await readFile(new URL('../sample-scenarios.js',import.meta.url),'utf8'))+';globalThis.__samples=SAMPLE_SETS;',context);
  const sample=context.__samples[1],items=sample.products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  const result=engine.packShipment({container:C20,units:items,safety:'strict',transportMode:sample.mode,timeBudgetMs:60000});
  // 케이블 드럼(원통)을 펌프 상자 위에 2단으로 올리면 높은 모서리에서 두 면만 기대게 된다.
  for(const load of result.loads)for(const p of load.placed.filter(p=>p.shape==='cylinder'&&p.z>0))
    assert.ok(load.placed.filter(q=>Math.abs(q.z+q.h-p.z)<2&&overlapArea(p,q)>0).every(q=>q.shape==='cylinder'),`drum ${p.unit} rests on a box`);
  assert.equal(result.remaining.length,0);
  assertValidShipment(result,items);
});
