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

test('balance preference centers a uniform full load',()=>{
  const items=units(36,{rotate:true}),result=pack(items,{preference:'balance'}),b=context.LoadwiseInsights.balance(result.loads[0]);
  assert.equal(result.loads.length,1);assert.equal(result.remaining.length,0);
  assert.ok(Math.abs(b.xOffset)<=5&&Math.abs(b.yOffset)<=5);
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
