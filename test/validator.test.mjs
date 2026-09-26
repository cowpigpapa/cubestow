import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context=vm.createContext({});
vm.runInContext(await readFile(new URL('../solution-validator.js',import.meta.url),'utf8'),context);
const validate=(load,options)=>context.LoadwiseValidator.validateLoad(load,options);
const container={l:100,w:100,h:100,maxWeight:1000};

// 누적 높이 100/바닥 50 = 2 > 1.5이므로 측면 지지 2면이 필요하다. 안쪽 벽(x=l)과 좌측 벽이 맞닿은 모서리에 둔다.
test('validator accepts a supported collision-free load',()=>assert.equal(validate({container,placed:[{x:50,y:0,z:0,l:50,w:50,h:50,weight:100},{x:50,y:0,z:50,l:50,w:50,h:50,weight:100}]}).valid,true));
test('validator rejects boundary, collision and unsupported placements',()=>{
  assert.equal(validate({container,placed:[{x:90,y:0,z:0,l:20,w:20,h:20,weight:1}]}).valid,false);
  assert.equal(validate({container,placed:[{x:0,y:0,z:0,l:50,w:50,h:50,weight:1},{x:20,y:20,z:0,l:50,w:50,h:50,weight:1}]}).valid,false);
  assert.equal(validate({container,placed:[{x:0,y:0,z:50,l:50,w:50,h:50,weight:1}]}).valid,false);
});
test('validator rejects partial support that misses the cargo center',()=>assert.equal(validate({container,placed:[{x:0,y:0,z:0,l:20,w:50,h:50,weight:1},{x:0,y:0,z:50,l:50,w:50,h:50,weight:1}]},{minSupport:.3}).valid,false));
test('validator rejects a stack whose combined center leaves its support polygon',()=>{const result=validate({container:{l:200,w:100,h:150,maxWeight:1000},placed:[{x:0,y:0,z:0,l:40,w:100,h:40,weight:10},{x:0,y:0,z:40,l:80,w:100,h:40,weight:10},{x:60,y:0,z:80,l:20,w:100,h:40,weight:500}]},{minSupport:.5});assert.equal(result.valid,false);assert.match(result.errors.join('\n'),/합성 무게중심/)});
test('validator rejects cumulative top load above the declared capacity',()=>{const result=validate({container,placed:[{x:0,y:0,z:0,l:50,w:50,h:30,weight:20,maxTopLoadKg:150},{x:0,y:0,z:30,l:50,w:50,h:30,weight:100},{x:0,y:0,z:60,l:50,w:50,h:30,weight:100}]});assert.equal(result.valid,false);assert.match(result.errors.join('\n'),/상부 허용하중 초과/);assert.equal(Math.round(result.metrics.maxTopLoad),200)});
test('validator reports unverified compression capacity without inventing a limit',()=>{const result=validate({container,placed:[{x:0,y:0,z:0,l:50,w:50,h:30,weight:20},{x:0,y:0,z:30,l:50,w:50,h:30,weight:100}]});assert.equal(result.valid,true);assert.equal(result.metrics.compressionUnverified,2)});
test('validator rejects cargo on a no-stack item but ignores a no-stack item elsewhere at the same height',()=>{
  // 2단 적재(60/30 = 2)는 측면 지지 2면이 필요하므로 안쪽 벽과 좌측 벽 모서리(x=70)에 둔다.
  const box=(x,z,fragile=false)=>({x,y:0,z,l:30,w:30,h:30,weight:5,fragile});
  const onTop=validate({container,placed:[box(0,0,true),box(0,30)]}),apart=validate({container,placed:[box(70,0),box(70,30),box(0,0,true)]});
  assert.equal(onTop.valid,false);assert.match(onTop.errors.join('\n'),/상부적재금지/);
  assert.equal(apart.valid,true,apart.errors.join(' / '));
});
test('validator requires two side supports for tall cargo in the final layout, counting stacked neighbors together',()=>{
  const c={l:1000,w:1000,h:1000,maxWeight:1000},tall={x:400,y:0,z:0,l:200,w:200,h:600,weight:10};
  // 좌측 벽 1면만 닿으면 부족하다. 안쪽에 200mm 박스 3단 기둥(600mm)이 닿으면 좌측 벽과 함께 2면이다.
  const alone=validate({container:c,placed:[tall]});
  assert.equal(alone.valid,false);assert.match(alone.errors.join('\n'),/측면 지지 부족/);
  // 안쪽에 박스 한 개(200mm)만 닿으면 높이 600mm의 절반을 덮지 못한다.
  assert.equal(validate({container:c,placed:[{...tall,x:600},{x:800,y:0,z:0,l:200,w:200,h:200,weight:5}]}).valid,false);
  const backed=[0,200,400].map(z=>({x:800,y:0,z,l:200,w:200,h:200,weight:5}));
  const result=validate({container:c,placed:[{...tall,x:600},...backed]});
  assert.equal(result.valid,true,result.errors.join(' / '));
});
test('strict validation keeps cylinders on the floor or on cylinders',()=>{
  const drum={x:50,y:0,z:50,l:50,w:50,h:30,weight:5,shape:'cylinder'},crate={x:50,y:0,z:0,l:50,w:50,h:50,weight:5,shape:'box'};
  const load={container:{l:100,w:100,h:200,maxWeight:1000},placed:[crate,drum]};
  assert.match(validate(load,{cylinderOnFloor:true}).errors.join('\n'),/원통 화물이 상자 위/);
  assert.doesNotMatch(validate(load,{}).errors.join('\n'),/원통 화물이 상자 위/);
  assert.doesNotMatch(validate({...load,placed:[{...crate,shape:'cylinder'},drum]},{cylinderOnFloor:true}).errors.join('\n'),/원통 화물이 상자 위/);
});
test('highest safety requires inner, left and right faces blocked; the door face is exempt',()=>{
  const c={l:1000,w:1000,h:1000,maxWeight:1000},check=placed=>validate({container:c,placed},{blockSides:true});
  const slab={x:800,y:0,z:0,l:200,w:1000,h:200,weight:20},top=y=>({x:800,y,z:200,l:200,w:200,h:100,weight:5});
  // 바닥 화물은 벽까지 비어도 충전재·에어백으로 막을 수 있고, 문쪽(x=0 방향)은 비어도 된다.
  assert.equal(check([{x:800,y:400,z:0,l:200,w:200,h:200,weight:5}]).valid,true);
  // 높은 곳 화물은 양옆 간극이 에어백 한계(600mm) 안이면 막힌다.
  const centered=check([slab,top(400)]);assert.equal(centered.valid,true,centered.errors.join(' / '));
  // 높은 곳 화물이 옆벽까지 600mm를 넘게 비면 그 면은 막히지 않는다.
  assert.match(check([slab,top(0)]).errors.join(' / '),/우 면이 막히지 않음/);
  // 안쪽 벽에서 떨어져 있고 600mm 안에 받쳐 줄 화물도 없으면 안쪽 면이 막히지 않는다.
  assert.match(check([{x:100,y:0,z:0,l:200,w:200,h:200,weight:5}]).errors.join(' / '),/안쪽 면이 막히지 않음/);
});
test('CTU shipments hand faces not blocked by cargo to securing materials unless every securing material is off',()=>{
  const c={l:1000,w:1000,h:1000,maxWeight:1000},slab={x:800,y:0,z:0,l:200,w:1000,h:200,weight:20},top={x:800,y:0,z:200,l:200,w:200,h:100,weight:5};
  const ship=securing=>context.LoadwiseValidator.validateShipment({safety:'secure',transportMode:'combined',securing,containers:[{container:c,placed:[slab,top]}],unallocated:[],totalUnits:2});
  // 사용자 결정(2026-09-26): CTU Code는 화물 외 고정재(에어백·충전재·각재·래싱)로 막는 것도 인정한다. 열린 면은 고정재로 막을 곳 목록으로 넘긴다.
  const secured=ship({});assert.equal(secured.valid,true,secured.errors.join(' / '));
  assert.equal(JSON.stringify(secured.securingRequired[0].map(v=>[v.index,v.faces.join('')])),JSON.stringify([[1,'우']]));
  assert.equal(context.LoadwiseValidator.openFaces({container:c,placed:[slab,top]}).map(v=>v.faces.join('')).join(),'우');
  // 래싱만 켜도 막을 수 있다. 모두 끄면 화물로 막혀야 하므로 오류다.
  assert.equal(ship({airbag:false,filler:false}).valid,true);
  assert.match(ship({airbag:false,filler:false,lashing:false}).errors.join(' / '),/우 면이 막히지 않음/);
});
test('strict validation rejects a tall narrow stack whose open face would let it tip',()=>{
  const c={l:1000,w:900,h:2000,maxWeight:1000},box=z=>({x:800,y:0,z,l:200,w:200,h:200,weight:5});
  // 안쪽 벽·좌측 벽 모서리에 200mm 박스 4단(800mm, 높이/폭 4). 문쪽 앞은 1단 박스뿐이라 윗단 앞면이 비어 있다. 우측 벽 간극은 에어백 한계(500mm) 안이다.
  const tower=[0,200,400,600].map(box),front={x:600,y:0,z:0,l:200,w:200,h:200,weight:5},right=[0,200,400,600].map(z=>({x:800,y:200,z,l:200,w:200,h:200,weight:5}));
  const open=validate({container:c,placed:[...tower,front,...right]},{towerLimit:3});
  assert.match(open.errors.join(' / '),/높은 적층의 문쪽 면이 막히지 않음/);
  // 앞에 같은 높이의 화물 기둥이 있으면 막힌다.
  const frontColumn=[0,200,400,600].map(z=>({x:600,y:0,z,l:200,w:200,h:200,weight:5})),frontRight=[0,200,400,600].map(z=>({x:600,y:200,z,l:200,w:200,h:200,weight:5}));
  assert.doesNotMatch(validate({container:c,placed:[...tower,...right,...frontColumn,...frontRight]},{towerLimit:3}).errors.join(' / '),/전도 위험/);
});
test('CTU safety without lashing checks every item against the transport-mode tipping limits',()=>{
  const c={l:2000,w:1000,h:2000,maxWeight:5000},crate={x:1000,y:0,z:0,l:600,w:1000,h:600,weight:100};
  // 복합운송 앞뒤 한계 0.5: 높이 600 / 길이 600 = 1이라 문쪽 앞(1000mm 비어 있음)이 막혀야 한다. 문쪽 첫 줄이 아니면 걸린다.
  const front={x:0,y:0,z:0,l:300,w:1000,h:300,weight:50};
  const ship=placed=>context.LoadwiseValidator.validateShipment({safety:'secure',transportMode:'combined',securing:{lashing:false},containers:[{container:c,placed}],unallocated:[],totalUnits:placed.length});
  assert.match(ship([{...crate,x:1400},front]).errors.join(' / '),/전도 위험/);
  // 같은 배치라도 래싱을 쓰면(기본) 쌓이지 않은 화물에는 전도 한계를 적용하지 않는다.
  assert.doesNotMatch(context.LoadwiseValidator.validateShipment({safety:'secure',transportMode:'combined',containers:[{container:c,placed:[{...crate,x:1400},front]}],unallocated:[],totalUnits:2}).errors.join(' / '),/전도 위험/);
});
test('highest safety rejects a small box perched on a larger item with an open door-side face',()=>{
  const c={l:2000,w:1000,h:2000,maxWeight:5000},crate={x:1000,y:0,z:0,l:1000,w:1000,h:600,weight:100},front={x:0,y:0,z:0,l:1000,w:1000,h:300,weight:50};
  // 큰 화물 위에 작은 박스를 안쪽 벽·좌우 벽에 붙여 올렸지만 앞(문쪽)은 낮은 화물뿐이라 열려 있다.
  const box={x:1600,y:0,z:600,l:400,w:1000,h:300,weight:10};
  assert.match(validate({container:c,placed:[crate,front,box]},{blockSides:true}).errors.join(' / '),/얹혀 문쪽 면이 막히지 않음/);
  // 문쪽 첫 줄이면(앞에 아무것도 없으면) 도어 펜스가 막으므로 괜찮다.
  assert.doesNotMatch(validate({container:c,placed:[crate,box]},{blockSides:true}).errors.join(' / '),/얹혀/);
});
