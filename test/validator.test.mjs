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
