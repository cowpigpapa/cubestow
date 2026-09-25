import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const context={globalThis:{}};vm.runInNewContext(await readFile(new URL('../load-insights.js',import.meta.url),'utf8'),context);
const {balance,ctu,securing,CTU_ACCELERATIONS}=context.globalThis.LoadwiseInsights;

test('balanced cargo reports centered safe distribution',()=>{
  const value=balance({container:{l:100,w:100,h:100},placed:[{x:25,y:25,z:0,l:50,w:50,h:20,weight:100}]});
  assert.equal(value.level,'safe');assert.equal(value.door,50);assert.equal(value.left,50);
});

test('off-center cargo reports danger',()=>{
  const value=balance({container:{l:100,w:100,h:100},placed:[{x:80,y:80,z:0,l:10,w:10,h:10,weight:100}]});
  assert.equal(value.level,'danger');assert.equal(Math.round(value.xOffset),35);assert.equal(Math.round(value.yOffset),35);
});

test('CTU pre-check reports centered, low and distributed cargo as safe',()=>{
  const load={container:{l:10000,w:2400,h:2400},placed:[{x:0,y:0,z:0,l:5000,w:2400,h:1000,weight:500},{x:5000,y:0,z:0,l:5000,w:2400,h:1000,weight:500}]};
  const value=ctu(load);assert.equal(value.level,'safe');assert.equal(value.checks.center,true);assert.equal(value.checks.vertical,true);assert.equal(value.checks.concentration,true);
});

test('CTU pre-check warns when over 60 percent of mass is concentrated in half length',()=>{
  const load={container:{l:10000,w:2400,h:2400},placed:[{x:0,y:0,z:0,l:4000,w:1200,h:1000,weight:800},{x:6000,y:1200,z:0,l:4000,w:1200,h:1000,weight:200}]};
  const value=ctu(load);assert.ok(value.concentration>60);assert.equal(value.checks.concentration,false);assert.notEqual(value.level,'safe');
});

// IMO MSC.1/Circ.1498 Quick Lashing Guide A·B·C의 가속도 표(10.1.1, 11.1.1, 12.1.1)와 한 칸씩 대조한다.
test('CTU accelerations match the IMO quick lashing guide tables',()=>{
  const rows=Object.fromEntries(Object.entries(CTU_ACCELERATIONS).map(([k,v])=>[k,[v.side.c,v.side.v,v.forward.c,v.forward.v,v.backward.c,v.backward.v]]));
  assert.deepEqual(JSON.parse(JSON.stringify(rows)),{road:[.5,1,.8,1,.5,1],seaA:[.5,1,.3,.5,.3,.5],seaB:[.7,1,.3,.3,.3,.3],seaC:[.8,1,.4,.2,.4,.2]});
});

const C={l:6000,w:2400,h:2600};
const box=(x,y,z,l,w,h,weight=1000,name='box')=>({name,x,y,z,l,w,h,weight});
const free=(l,w,h,weight)=>box(2000,800,0,l,w,h,weight);
const tips=(result,direction)=>result.directions.find(d=>d.label.startsWith(direction)).tipping>0;

test('CTU tipping limits reproduce the no-tip boundaries of the IMO tables',()=>{
  // 도로: 좌우 H/B 2.0까지, 전방 H/L 1.2까지 전도 없음(표의 다음 칸 2.2, 1.4부터 고정 필요)
  assert.equal(tips(securing({container:C,placed:[free(500,500,1000)]},{mode:'road'}),'좌측'),false);
  assert.equal(tips(securing({container:C,placed:[free(500,500,1100)]},{mode:'road'}),'좌측'),true);
  assert.equal(tips(securing({container:C,placed:[free(500,500,600)]},{mode:'road'}),'전방'),false);
  assert.equal(tips(securing({container:C,placed:[free(500,500,700)]},{mode:'road'}),'전방'),true);
  // 해상 C: 좌우 H/B 1.2까지, 전후 H/L 0.5까지
  assert.equal(tips(securing({container:C,placed:[free(1000,1000,1200)]},{mode:'sea'}),'좌측'),false);
  assert.equal(tips(securing({container:C,placed:[free(1000,1000,1400)]},{mode:'sea'}),'좌측'),true);
  assert.equal(tips(securing({container:C,placed:[free(1000,1000,500)]},{mode:'sea'}),'후방'),false);
  assert.equal(tips(securing({container:C,placed:[free(1000,1000,600)]},{mode:'sea'}),'후방'),true);
});

test('CTU sliding restraint follows m·g·(c − μ·v) for unblocked directions',()=>{
  const force=(result,key)=>result.directions.find(d=>d.key===key).forceKN;
  const road=securing({container:C,placed:[free(1000,1000,500,1000)]},{mode:'road'});
  assert.ok(Math.abs(force(road,'forward')-9.81*.5)<1e-9);assert.ok(Math.abs(force(road,'left')-9.81*.2)<1e-9);
  const grippy=securing({container:C,placed:[free(1000,1000,500,1000)]},{mode:'road',friction:.5});
  assert.equal(force(grippy,'left'),0);assert.ok(Math.abs(force(grippy,'forward')-9.81*.3)<1e-9);
  // 복합운송은 도로와 해상 중 더 큰 값을 쓴다: 전방 도로 0.8−0.3 > 해상 C 0.4−0.3×0.2
  assert.ok(Math.abs(force(securing({container:C,placed:[free(1000,1000,500,1000)]},{mode:'combined'}),'forward')-9.81*.5)<1e-9);
  assert.ok(Math.abs(force(securing({container:C,placed:[free(1000,1000,500,1000)]},{mode:'sea'}),'forward')-9.81*.34)<1e-9);
});

test('CTU blocking counts only chains that reach a wall and treats the door as open by default',()=>{
  // 안쪽 벽(x=6000)부터 문(x=0)까지 폭 전체를 채운 3열
  const row=[0,2000,4000].map(x=>box(x,0,0,2000,2400,1000));
  const open=securing({container:C,placed:row},{mode:'road'}),count=(r,k)=>r.directions.find(d=>d.key===k).unblocked;
  assert.equal(count(open,'forward'),0);assert.equal(count(open,'left'),0);assert.equal(count(open,'right'),0);
  assert.equal(count(open,'backward'),3);
  assert.equal(count(securing({container:C,placed:row},{mode:'road',doorBlocking:true}),'backward'),0);
  // 벽에서 떨어진 두 화물은 서로 닿아 있어도 막힌 것이 아니다
  const pair=[box(2000,0,0,1000,1000,500),box(3000,0,0,1000,1000,500)];
  assert.equal(count(securing({container:C,placed:pair},{mode:'road'}),'forward'),2);
});

test('CTU tipping uses the full stack height above each item',()=>{
  // 정육면체 하나(H/B 1)는 해상 C 좌우 한계 1.25 이내지만 두 단 적층(H/B 2)은 넘어간다
  const single=securing({container:C,placed:[free(1000,1000,1000)]},{mode:'sea'});
  const stacked=securing({container:C,placed:[free(1000,1000,1000),box(2000,800,1000,1000,1000,1000)]},{mode:'sea'});
  assert.equal(tips(single,'좌측'),false);assert.equal(tips(stacked,'좌측'),true);
});

test('CTU tipping tightens with the number of rows leaning on each other',()=>{
  // 표의 2열 경계: 도로 좌우 H/B 1.0까지 전도 없음, 1.2부터 고정 필요. 벽에서 떨어져 나란히 붙은 두 열.
  const pair=h=>[box(2000,500,0,500,500,h),box(2000,1000,0,500,500,h)];
  assert.equal(tips(securing({container:C,placed:pair(500)},{mode:'road'}),'우측'),false);
  assert.equal(tips(securing({container:C,placed:pair(600)},{mode:'road'}),'우측'),true);
  const worst=securing({container:C,placed:pair(600)},{mode:'road'}).directions.find(d=>d.key==='right').worst;
  assert.equal(worst.rows,2);assert.equal(worst.limit,1);
});

test('CTU offset is judged on gross mass so light partial loads are not flagged like heavy ones',()=>{
  const c={name:'20ft Dry',l:5898,w:2352,h:2393,maxWeight:28200},box=(weight)=>({x:0,y:0,z:0,l:1000,w:2352,h:1000,weight});
  const light=ctu({container:c,placed:[box(300)]}),heavy=ctu({container:c,placed:[box(20000)]});
  // 같은 위치(안쪽 끝)라도 화물 기준 편차는 같고, 총중량 기준 편차는 자체중량 2,230 kg만큼 줄어든다.
  assert.equal(Math.round(light.xOffset),Math.round(heavy.xOffset));assert.equal(light.tare,2230);
  assert.ok(Math.abs(light.grossXOffset)<5&&light.level!=='danger',`light ${light.grossXOffset}`);
  assert.ok(Math.abs(heavy.grossXOffset)>35&&heavy.level==='danger',`heavy ${heavy.grossXOffset}`);
  // 최대 적재중량이 없는 가상 공간은 자체중량 없이 화물만으로 판정한다.
  assert.equal(ctu({container:{l:5898,w:2352,h:2393},placed:[box(300)]}).level,'danger');
});
