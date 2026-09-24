import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const context = vm.createContext({ console, setTimeout, clearTimeout, performance });
for (const file of ["../load-insights.js", "../solution-validator.js", "../packing-engine.js"]) vm.runInContext(await readFile(new URL(file, import.meta.url), "utf8"), context);
vm.runInContext(source, context);
const run = code => vm.runInContext(code, context);
const base = { name:"box", group:"기타", shape:"box", l:1000, w:800, h:700, weight:100, qty:1, rotate:false, fragile:false, color:"#000", volume:560000000 };

test("quoted newline CSV", () => assert.equal(run(`parseCSV('name,note\\nA,"line1\\nline2"')[0].note`), "line1\nline2"));
test("escaped quote CSV", () => assert.equal(run(`parseCSV('name,note\\nA,"a""b"')[0].note`), 'a"b'));
test("unclosed quote rejected", () => assert.throws(() => run(`parseCSV('name\\n"A')`), /따옴표/));
for(const [number,name] of ['single-small','single-medium','single-large','mixed-heavy','mixed-sizes','cylinders','tall-stability','fragile-topload','width-combination','partial-unloadable'].entries()){
  const id=String(number+1).padStart(2,'0'),file=new URL(`../test-projects/${id}-${name}.csv`,import.meta.url);
  test(`simulation file ${id} parses into valid products`,async()=>{context.csvText=await readFile(file,'utf8');assert.ok(run(`parseCSV(csvText).map(mapRow).length`)>0)});
}
test("uploaded labels are HTML escaped", () => assert.equal(run(`esc('<img src=x onerror=alert(1)>')`), "&lt;img src=x onerror=alert(1)&gt;"));
for (const [value,expected] of [["yes",true],["예",true],["true",true],["1",true],["no",false],["아니오",false],["false",false],["0",false]]) test(`flag ${value}`, () => assert.equal(run(`parseFlag('${value}','flag',2)`), expected));
test("blank flag rejected", () => assert.throws(() => run(`parseFlag('','flag',2)`), /2행/));
test("zero quantity rejected", () => assert.throws(() => run(`mapRow({'제품명':'A','형상':'박스형','길이':1,'너비':1,'높이':1,'중량':1,'수량':0,'눕힘허용':'no','상부적재금지':'no'},0)`), /수량/));
test("fractional quantity rejected", () => assert.throws(() => run(`mapRow({'제품명':'A','형상':'박스형','길이':1,'너비':1,'높이':1,'중량':1,'수량':1.5,'눕힘허용':'no','상부적재금지':'no'},0)`), /수량/));
test("unknown shape rejected", () => assert.throws(() => run(`mapRow({'제품명':'A','형상':'bag','길이':1,'너비':1,'높이':1,'중량':1,'수량':1,'눕힘허용':'no','상부적재금지':'no'},0)`), /형상/));
test("uploaded top-load capacity is optional", () => assert.equal(run(`mapRow({name:'A',shape:'box',length:1,width:1,height:1,weight:1,quantity:1,rotation:'no',fragile:'no'},0).maxTopLoadKg`), null));
test("uploaded top-load capacity is preserved", () => assert.equal(run(`mapRow({name:'A',shape:'box',length:1,width:1,height:1,weight:1,quantity:1,rotation:'no',fragile:'no',maxtopload:500},0).maxTopLoadKg`), 500));
test("negative uploaded top-load capacity is rejected", () => assert.throws(() => run(`mapRow({name:'A',shape:'box',length:1,width:1,height:1,weight:1,quantity:1,rotation:'no',fragile:'no',maxtopload:-1},0)`), /상부 허용하중/));


test("partial is not complete", () => { context.ship = {containers:[{placed:[1,2]}],unallocated:[3],totalUnits:3};assert.equal(run(`shipmentOutcome(ship).state`),"partial") });
test("partial result notice names rejected cargo and quantity", () => { context.ship = {containers:[{placed:[1]}],unallocated:[{name:"초대형 펌프",reason:"공간 또는 지지 조건 부족"},{name:"초대형 펌프",reason:"공간 또는 지지 조건 부족"}],totalUnits:3};const notice=run(`unallocatedNotice(ship)`);assert.match(notice,/초대형 펌프 × 2/);assert.match(notice,/미배치 화물 2개/) });
test("complete requires zero unallocated", () => { context.ship = {containers:[{placed:[1,2]}],unallocated:[],totalUnits:2};assert.equal(run(`shipmentOutcome(ship).state`),"complete") });
test("one container is described as a single load, not split", () => { context.caseContainer={name:'20ft Dry'};assert.equal(run(`containerPlanMessage(caseContainer,1)`),'20ft Dry 1대에 한 번에 적재합니다.');assert.equal(run(`containerPlanMessage(caseContainer,2)`),'20ft Dry 2대로 분할 적재합니다.') });
test("automatic securing never invents a lashing band", () => { const c=run(`CONTAINERS['20ft']`);context.caseLoad={container:{...c},placed:[{...base,x:c.l-800,y:0,z:0,l:800,w:800,h:2200,name:'tall'}]};const plan=run(`buildSecuringPlan(caseLoad,'sea')`);assert.equal('bands' in plan,false);assert.ok(plan.reviews.length>0) });
test("identical transport reviews are grouped and keep affected quantity", () => { const c=run(`CONTAINERS['20ft']`),cargo={...base,x:400,y:200,z:0,l:900,w:900,h:1800,name:'drum',shape:'cylinder'};context.caseLoad={container:{...c},placed:[{...cargo},{...cargo}]};const plan=run(`buildSecuringPlan(caseLoad,'sea')`);assert.ok(plan.reviews.some(item=>item.count===2)) });
test("low stable second-tier box needs no combined-transport review", () => { const c=run(`CONTAINERS['20ft']`);context.caseLoad={container:{...c},placed:[{...base,x:1000,y:0,z:0,l:600,w:500,h:450,name:'base'},{...base,x:1000,y:0,z:450,l:600,w:500,h:450,name:'upper'}]};const plan=run(`buildSecuringPlan(caseLoad,'combined')`);assert.equal(plan.reviews.length,0) });
test("sea transport is stricter than road transport for high cargo", () => { const c=run(`CONTAINERS['20ft']`);context.caseLoad={container:{...c},placed:[{...base,x:c.l-800,y:0,z:0,l:800,w:800,h:2200,name:'tall'}]};assert.ok(run(`buildSecuringPlan(caseLoad,'sea').reviews.length`)>run(`buildSecuringPlan(caseLoad,'road').reviews.length`)) });
test("unsupported high stack is marked for rearrangement instead of a band", () => { const c=run(`CONTAINERS['20ft']`);context.caseLoad={container:{...c},placed:[{...base,x:1000,y:0,z:0,l:800,w:800,h:900,name:'base'},{...base,x:1000,y:0,z:900,l:800,w:800,h:900,name:'upper'}]};const plan=run(`buildSecuringPlan(caseLoad,'sea')`);assert.equal(plan.reviews.some(r=>r.product==='upper'&&r.severity==='rearrange'),true) });
