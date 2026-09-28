import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// 도로 축하중 추정(load-insights.js axleLoads): 도로법 시행령 제79조 한도(축 10t·총 40t, 단속 11t·44t)와
// CTU 정보자료 IM6의 지렛대 방법을 일반 제원으로 계산한다.
const context=vm.createContext({});
vm.runInContext(await readFile(new URL('../load-insights.js',import.meta.url),'utf8'),context);
const I=context.LoadwiseInsights;
const load=(l,maxWeight,weight,xFrac)=>({container:{l,w:2352,h:2393,maxWeight},placed:[{x:l*xFrac-500,y:0,z:0,l:1000,w:1000,h:1000,weight}]});
const per=(r,key)=>r.axles.find(a=>a.key===key).perAxle;

test('the axle estimate splits a centred 40ft load across tractor and chassis within the road limits',()=>{
  const r=I.axleLoads(load(12032,26700,20000,.5));
  assert.equal(r.level,'safe');
  // 무게는 빠짐없이 나뉜다: 앞축 + 뒤축 + 샤시 축 = 차량 총중량
  const sum=per(r,'front')+per(r,'drive')*2+per(r,'chassis')*3;
  assert.ok(Math.abs(sum-r.total)<1,'axle loads add up to the gross combination mass');
  assert.equal(Math.round(r.total),20000+3750+5000+9000);
});

test('cargo pushed toward the front wall overloads the tractor drive axles (CTU IM6 3.2.2)',()=>{
  const centred=I.axleLoads(load(12032,26700,25000,.5)),front=I.axleLoads(load(12032,26700,25000,.75)),door=I.axleLoads(load(12032,26700,25000,.25));
  assert.ok(per(front,'drive')>per(centred,'drive')&&per(front,'drive')>11000,'front-heavy load exceeds 11t on the drive axles');
  assert.equal(front.level,'danger');
  assert.ok(per(door,'chassis')>per(centred,'chassis'),'door-heavy load moves weight to the chassis axles');
});

test('the gross combination mass is graded against 40t and the 44t enforcement tolerance',()=>{
  // 40ft 25t: 25 + 3.75 + 5 + 9 = 42.75t → 법 기준 초과, 단속 오차 안
  assert.equal(I.axleLoads(load(12032,26700,25000,.5)).totalLevel,'caution');
  assert.equal(I.axleLoads(load(12032,26700,20000,.5)).totalLevel,'safe');
  assert.equal(I.axleLoads(load(12032,26700,31000,.5)).totalLevel,'danger');
  // 20ft는 2축 샤시(3.8t)로 계산
  const r20=I.axleLoads(load(5898,28200,21000,.5));
  assert.equal(r20.vehicle.chassis,'20ft 컨테이너 샤시(2축)');assert.equal(r20.axles.find(a=>a.key==='chassis').label,'샤시 축(2축)');
});

test('the axle estimate needs a real container with a payload limit',()=>{
  assert.equal(I.axleLoads({container:{l:5000,w:2000,h:2000},placed:[]}),null);
});
