import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const context={};context.globalThis=context;vm.createContext(context);vm.runInContext(await readFile(new URL('../project-model.js',import.meta.url),'utf8'),context);
const model=context.LoadwiseProjectModel;

test('manual and file products share one normalized model',()=>{
  const snapshot=model.createSnapshot([{name:'펌프',group:'기계',shape:'box',qty:'2',l:'1000',w:'800',h:'700',weight:'120',source:'excel'}],'40hc',{safety:'strict',preference:'auto'});
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)),{schemaVersion:5,algorithmVersion:'legacy',products:[{name:'펌프',group:'기계',shape:'box',qty:2,l:1000,w:800,h:700,weight:120,maxTopLoadKg:null,rotate:false,fragile:false,source:'excel'}],containerType:'40hc',safety:'strict',preference:'auto',transportMode:'combined',securing:{airbag:true,filler:true,nails:true,lashing:true},resultSummary:null,fieldResult:null});
});

test('legacy snapshots migrate and current metadata is preserved',()=>{
  const legacy=model.normalizeSnapshot({schemaVersion:1,products:[],containerType:'40ft',optimization:'sequence'});
  assert.equal(legacy.schemaVersion,5);assert.equal(legacy.safety,'strict');assert.equal(legacy.preference,'auto');assert.equal(legacy.algorithmVersion,'legacy');assert.equal(legacy.transportMode,'combined');assert.equal(legacy.resultSummary,null);assert.equal(legacy.fieldResult,null);
  const current=model.createSnapshot([],'20ft',{},{algorithmVersion:model.CURRENT_ALGORITHM_VERSION,resultSummary:{state:'complete',loaded:36,total:36,containerCount:1,totalWeight:6692,calculatedAt:'2026-08-11T00:00:00.000Z'}});
  assert.equal(current.algorithmVersion,'ep-lex-portfolio-2026.10.14');assert.equal(current.resultSummary.loaded,36);assert.equal(current.resultSummary.totalWeight,6692);
});

test('legacy strategies migrate to safety level and preference',()=>{
  for(const [optimization,safety,preference] of [['intelligent','strict','auto'],['sequence','strict','auto'],['hybrid','strict','width'],['volume','standard','density'],['balance','strict','balance']]){
    const snapshot=model.normalizeSnapshot({optimization});
    assert.equal(snapshot.safety,safety,optimization);assert.equal(snapshot.preference,preference,optimization);assert.equal('optimization' in snapshot,false);
  }
  assert.equal(model.createSnapshot([],'20ft','volume').safety,'standard');
});

test('safety level and preference are preserved',()=>{
  const snapshot=model.createSnapshot([],'20ft',{safety:'standard',preference:'balance'});
  assert.equal(snapshot.safety,'standard');assert.equal(snapshot.preference,'balance');
});

test('field comparison survives project normalization',()=>{
  const snapshot=model.createSnapshot([],'20ft',{},{fieldResult:{loaded:35,containers:2,notes:'현장 변경',recordedAt:'2026-08-11T00:00:00.000Z'}});
  assert.equal(snapshot.fieldResult.loaded,35);assert.equal(snapshot.fieldResult.containers,2);assert.equal(snapshot.fieldResult.notes,'현장 변경');
});

test('optional top-load capacity is preserved without inventing a default',()=>{
  assert.equal(model.createSnapshot([{name:'상자',qty:1,l:1,w:1,h:1,weight:1,maxTopLoadKg:250}],'20ft').products[0].maxTopLoadKg,250);
  assert.equal(model.createSnapshot([{name:'상자',qty:1,l:1,w:1,h:1,weight:1}],'20ft').products[0].maxTopLoadKg,null);
});

test('transport mode is preserved and invalid values fall back to combined',()=>{
  assert.equal(model.createSnapshot([],'20ft',{},{transportMode:'sea'}).transportMode,'sea');
  assert.equal(model.normalizeSnapshot({transportMode:'invalid'}).transportMode,'combined');
});

test('invalid project values fall back safely',()=>{
  const snapshot=model.normalizeSnapshot({products:[{name:'',qty:0}],containerType:'x',optimization:'x',safety:'x',preference:'x'});
  assert.equal(snapshot.products.length,0);assert.equal(snapshot.containerType,'20ft');assert.equal(snapshot.safety,'strict');assert.equal(snapshot.preference,'auto');
});

test('highest safety level survives snapshot normalization',()=>{
  assert.equal(model.createSnapshot([],'20ft',{safety:'secure',preference:'auto'}).safety,'secure');
});
