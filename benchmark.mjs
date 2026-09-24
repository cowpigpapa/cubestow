// 합성 시나리오 × 안전 기준 × 우선 기준 회귀 게이트.
// 결과 파일은 `npm run benchmark -- --write`일 때만 갱신한다.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';

const context=vm.createContext({console,performance});
for(const file of ['load-insights.js','solution-validator.js','packing-engine.js'])vm.runInContext(await readFile(file,'utf8'),context);
const {LoadwiseEngine:engine,LoadwiseValidator:validator,LoadwiseInsights:insights}=context;
const C20={name:'20ft Dry',l:5898,w:2352,h:2393,maxWeight:28200},C40HC={name:'40ft High Cube',l:12032,w:2352,h:2698,maxWeight:26500};
const base={name:'box',group:'benchmark',shape:'box',l:1000,w:800,h:700,weight:100,rotate:true,fragile:false};
const units=(count,change={},offset=0)=>Array.from({length:count},(_,i)=>({...base,...change,pi:0,unit:offset+i+1}));
const types=[[1200,1000,900,300],[1000,800,700,150],[800,600,500,80],[600,400,400,40]];
// maxContainers: 이 대수를 넘으면 회귀로 본다.
const cases=[
  {name:'uniform-36',container:C20,maxContainers:1,items:units(36)},
  {name:'mixed',container:C20,maxContainers:1,items:Array.from({length:24},(_,i)=>({...base,l:600+(i%4)*180,w:500+(i%3)*140,h:450+(i%2)*250,weight:80+i*7,pi:0,unit:i+1}))},
  {name:'tall',container:C20,maxContainers:1,items:units(12,{l:800,w:800,h:1800,rotate:false})},
  {name:'cylinders',container:C20,maxContainers:1,items:units(18,{name:'drum',shape:'cylinder',l:900,w:900,h:700,weight:310,rotate:false})},
  {name:'width-mix',container:C20,maxContainers:1,items:[...units(12,{name:'wide',w:820}),...units(12,{name:'medium',w:700},12),...units(16,{name:'narrow',w:530},24)]},
  {name:'fragile-mix',container:C20,maxContainers:1,items:[...units(6,{name:'fragile',l:900,w:700,h:500,weight:60,fragile:true}),...units(18,{name:'strong',l:800,w:600,h:650,weight:180},6)]},
  {name:'mix-200',container:C40HC,maxContainers:{strict:2,standard:2},maxMs:8000,items:Array.from({length:200},(_,i)=>{const [l,w,h,weight]=types[i%4];return{...base,name:`T${i%4}`,l,w,h,weight,pi:i%4,unit:i+1}})}
];
const rows=[],failures=[];
for(const sample of cases)for(const safety of ['strict','standard']){
  const counts=new Set();
  for(const preference of ['auto','density','width','balance']){
    const started=performance.now(),result=engine.packShipment({container:sample.container,units:sample.items,safety,preference,timeBudgetMs:8000}),elapsed=performance.now()-started;
    const validation=validator.validateShipment({safety,containers:result.loads,unallocated:result.remaining,totalUnits:sample.items.length});
    const cog=Math.max(...result.loads.map(load=>{const b=insights.balance(load);return b?Math.max(Math.abs(b.xOffset),Math.abs(b.yOffset)):0}));
    const row={case:sample.name,safety,preference,valid:validation.valid,containers:result.loads.length,lowerBound:result.stats.lowerBound,unallocated:result.remaining.length,volumeRate:Number((result.loads.reduce((s,l)=>s+l.volumeRate,0)/result.loads.length).toFixed(1)),cogRisk:Number(cog.toFixed(1)),runs:result.stats.runs,truncated:result.stats.truncated,elapsedMs:Math.round(elapsed)};
    rows.push(row);counts.add(`${row.containers}/${row.unallocated}`);
    const limit=typeof sample.maxContainers==='object'?sample.maxContainers[safety]:sample.maxContainers;
    if(!row.valid)failures.push(`${sample.name}/${safety}/${preference}: 검증 실패 ${validation.errors.slice(0,2).join('; ')}`);
    if(row.unallocated||row.containers>limit)failures.push(`${sample.name}/${safety}/${preference}: ${row.containers}대·미배치 ${row.unallocated} (기준 ${limit}대)`);
    if(sample.maxMs&&elapsed>sample.maxMs)failures.push(`${sample.name}/${safety}/${preference}: ${Math.round(elapsed)}ms (기준 ${sample.maxMs}ms)`);
  }
  if(counts.size>1)failures.push(`${sample.name}/${safety}: 우선 기준에 따라 대수가 달라짐 ${[...counts].join(', ')}`);
}
console.table(rows);
if(process.argv.includes('--write')){
  await mkdir('benchmarks',{recursive:true});
  await writeFile('benchmarks/latest.json',JSON.stringify({generatedAt:new Date().toISOString(),engine:engine.ENGINE_VERSION,rows:rows.map(({elapsedMs,...row})=>row)},null,2)+'\n');
}
if(failures.length){console.error('Benchmark gate failed\n'+failures.join('\n'));process.exitCode=1}
