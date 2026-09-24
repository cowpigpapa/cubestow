// test-projects의 현장 CSV 10종 회귀 게이트. 결과 파일은 --write일 때만 갱신한다.
import {readdir,readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';

const context=vm.createContext({console,setTimeout,clearTimeout,performance});
for(const file of ['load-insights.js','solution-validator.js','packing-engine.js','app.js'])vm.runInContext(await readFile(file,'utf8'),context);
const files=(await readdir('test-projects')).filter(name=>name.endsWith('.csv')).sort(),expected={
  '01-single-small.csv':[1,0],'02-single-medium.csv':[1,0],'03-single-large.csv':[2,0],'04-mixed-heavy.csv':[1,0],'05-mixed-sizes.csv':[1,0],
  '06-cylinders.csv':[1,0],'07-tall-stability.csv':[1,0],'08-fragile-topload.csv':[1,0],'09-width-combination.csv':[1,0],'10-partial-unloadable.csv':[1,2]
},rows=[];
const {LoadwiseEngine:engine,LoadwiseValidator:validator}=context,container=vm.runInContext(`CONTAINERS['20ft']`,context);
for(const file of files){
  context.csv=await readFile(`test-projects/${file}`,'utf8');
  const products=vm.runInContext('parseCSV(csv).map(mapRow)',context),units=products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1})));
  for(const safety of ['strict','standard']){
    const result=engine.packShipment({container,units,safety,preference:'auto'}),validation=validator.validateShipment({safety,containers:result.loads,unallocated:result.remaining,totalUnits:units.length});
    rows.push({file,safety,units:units.length,containers:result.loads.length,lowerBound:result.stats.lowerBound,unallocated:result.remaining.length,valid:validation.valid,elapsedMs:result.stats.elapsedMs,errors:validation.errors});
  }
}
console.table(rows.map(({errors,...row})=>row));
if(process.argv.includes('--write'))await writeFile('benchmarks/scenarios.json',JSON.stringify({generatedAt:new Date().toISOString(),engine:engine.ENGINE_VERSION,rows:rows.map(({elapsedMs,...row})=>row)},null,2)+'\n');
const regressions=rows.filter(row=>!row.valid||!expected[row.file]||row.containers>expected[row.file][0]||row.unallocated>expected[row.file][1]);
if(regressions.length){console.error('Scenario benchmark failed',regressions.map(row=>`${row.file}/${row.safety}`));process.exitCode=1}
