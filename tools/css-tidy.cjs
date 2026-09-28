// CSS 정리 도구: node tools/css-tidy.cjs          (분석만)
//                node tools/css-tidy.cjs --apply  (파일에 적용)
// 적용 전후로 node tools/visual-snapshots.mjs를 돌려 화면이 한 픽셀도 바뀌지 않았는지 확인한다.
// 1) 쓰이지 않는 선택자 제거: 선택자의 class/id 이름이 HTML·JS 어디에도 문자열로 없으면 그 선택자를 뺀다.
// 2) 덮어써진 선언 제거: 같은 @media 안 같은 선택자에서 같은 속성을 뒤에서 다시 선언하면(중요도 같거나 높으면) 앞의 선언을 뺀다.
// 주석은 지우지 않는다(규칙이 사라지면 다음 항목 앞으로 옮긴다).
const fs=require('fs'),path=require('path');
const repo=path.join(__dirname,'..'),apply=process.argv.includes('--apply');
const FILES=['styles.css','sample-results.css','v3-projects.css'];
const corpusFiles=fs.readdirSync(repo).filter(f=>/\.(html|js)$/.test(f)&&!/\.min\./.test(f));
const corpus=corpusFiles.map(f=>fs.readFileSync(path.join(repo,f),'utf8')).join('\n');
const WS=/\s/;

function parse(src){
  let i=0,pending=[];const n=src.length;
  const take=it=>{if(pending.length){it.comments=pending;pending=[]}return it};
  function skipWs(){while(i<n){if(WS.test(src[i]))i++;else if(src.startsWith('/*',i)){const e=src.indexOf('*/',i+2),end=e<0?n:e+2;pending.push(src.slice(i,end));i=end}else break}}
  function readUntil(chars){let s='',depth=0,q=null;while(i<n){const c=src[i];if(q){s+=c;if(c==='\\'){s+=src[i+1]||'';i+=2;continue}if(c===q)q=null;i++;continue}if(c==='"'||c==="'"){q=c;s+=c;i++;continue}if(src.startsWith('/*',i)){const e=src.indexOf('*/',i+2),end=e<0?n:e+2;s+=src.slice(i,end);i=end;continue}if(c==='(')depth++;if(c===')')depth--;if(depth===0&&chars.includes(c))break;s+=c;i++}return s}
  function block(){const items=[];while(true){skipWs();if(i>=n)return items;if(src[i]==='}'){i++;if(pending.length)items.push({type:'comment',comments:pending}),pending=[];return items}
    const prelude=readUntil('{;}');
    if(src[i]===';'){items.push(take({type:'at',text:prelude.trim()+';'}));i++;continue}
    if(src[i]==='}'){i++;return items}
    i++;const p=prelude.trim();
    if(/^@(media|supports|layer|container)/.test(p)){const g=take({type:'group',prelude:p});g.items=block();items.push(g)}
    else if(p.startsWith('@')){const start=i;let d=1,q=null;while(i<n&&d>0){const c=src[i];if(q){if(c==='\\'){i+=2;continue}if(c===q)q=null}else if(c==='"'||c==="'")q=c;else if(c==='{')d++;else if(c==='}')d--;i++}items.push(take({type:'raw',prelude:p,body:src.slice(start,i-1)}))}
    else{const body=readUntil('}');i++;items.push(take({type:'rule',selector:p,decls:splitDecls(body)}))}}}
  const top=block();if(pending.length)top.push({type:'comment',comments:pending});return top;
}
function splitDecls(body){const out=[];let s='',q=null,d=0;for(let k=0;k<body.length;k++){const c=body[k];if(q){s+=c;if(c==='\\'){s+=body[k+1]||'';k++;continue}if(c===q)q=null;continue}if(c==='"'||c==="'"){q=c;s+=c;continue}if(body.startsWith('/*',k)){const e=body.indexOf('*/',k+2);k=(e<0?body.length:e+2)-1;continue}if(c==='(')d++;if(c===')')d--;if(c===';'&&d===0){if(s.trim())out.push(s.trim());s='';continue}s+=c}if(s.trim())out.push(s.trim());
  return out.map(t=>{const m=t.indexOf(':');return{prop:t.slice(0,m).trim().toLowerCase(),important:/!\s*important\s*$/i.test(t),text:t}})}
function splitSelectors(sel){const out=[];let s='',d=0,b=0,q=null;for(const c of sel){if(q){s+=c;if(c===q)q=null;continue}if(c==='"'||c==="'"){q=c;s+=c;continue}if(c==='(')d++;if(c===')')d--;if(c==='[')b++;if(c===']')b--;if(c===','&&d===0&&b===0){out.push(s.trim());s='';continue}s+=c}if(s.trim())out.push(s.trim());return out}
// 선택자 안 class/id(속성 선택자 [..]와 :not(..) 안은 제외: :not(.x)은 .x가 없어도 맞는다)
function names(sel){const cleaned=sel.replace(/\[[^\]]*\]/g,'').replace(/:not\([^)]*\)/g,'');const out=[];const re=/([.#])(-?[_a-zA-Z][\w-]*)/g;let m;while((m=re.exec(cleaned)))out.push(m[2]);return out}
const selectorDead=sel=>names(sel).some(nm=>!corpus.includes(nm));

const stats={deadSelectors:0,deadRules:0,overridden:0,before:0,after:0,commentsBefore:0,commentsAfter:0,samples:[]};
// 지워지는 항목의 주석을 다음 항목(없으면 주석 전용 항목)으로 넘긴다.
function keepFilter(items,keepFn){let carry=[];const res=[];for(const it of items){if(carry.length){it.comments=[...carry,...(it.comments||[])];carry=[]}if(keepFn(it))res.push(it);else if(it.comments)carry=it.comments}if(carry.length)res.push({type:'comment',comments:carry});return res}
function prune(items){return keepFilter(items,it=>{if(it.type==='group'){it.items=prune(it.items);return it.items.some(x=>x.type!=='comment')}if(it.type!=='rule')return true;const sels=splitSelectors(it.selector),keep=sels.filter(s=>!selectorDead(s));if(keep.length<sels.length){stats.deadSelectors+=sels.length-keep.length;for(const s of sels)if(selectorDead(s)&&stats.samples.length<60)stats.samples.push(s)}if(!keep.length){stats.deadRules++;return false}it.selector=keep.join(',');return true})}
function dedupe(files){const all=[];const walk=(items,ctx)=>{for(const it of items){if(it.type==='group')walk(it.items,ctx+'|'+it.prelude.replace(/\s+/g,''));else if(it.type==='rule')all.push({ctx,it})}};files.forEach(f=>walk(f.items,''));
  const later=new Map();
  for(let r=all.length-1;r>=0;r--){const {ctx,it}=all[r];const key0=ctx+'||'+splitSelectors(it.selector).map(s=>s.replace(/\s+/g,' ')).join(',');const kept=[];
    // 같은 규칙 안의 반복(height:100vh;height:100dvh 같은 대체값)은 일부러 둔 것이라 건드리지 않는다: 이 규칙의 선언은 다 본 뒤에 기록한다.
    const seen=[];
    for(let k=it.decls.length-1;k>=0;k--){const d=it.decls[k];if(d.prop.startsWith('--')||!d.prop){kept.unshift(d);continue}const key=key0+'||'+d.prop,l=later.get(key);if(l&&(l.important||!d.important)){stats.overridden++;continue}seen.push([key,d.important]);kept.unshift(d)}
    for(const[key,imp]of seen){const l=later.get(key);later.set(key,{important:imp||Boolean(l&&l.important)})}
    it.decls=kept}
  const drop=items=>keepFilter(items,it=>{if(it.type==='group'){it.items=drop(it.items);return it.items.some(x=>x.type!=='comment')}return it.type!=='rule'||it.decls.length>0});files.forEach(f=>f.items=drop(f.items))}
function emitOne(it,indent){if(it.type==='at')return indent+it.text;if(it.type==='raw')return `${indent}${it.prelude}{${it.body}}`;if(it.type==='group')return `${indent}${it.prelude}{\n${emit(it.items,indent+'  ')}\n${indent}}`;return `${indent}${it.selector}{${it.decls.map(d=>d.text).join(';')}}`}
function emit(items,indent=''){return items.map(it=>{const c=it.comments?it.comments.map(x=>indent+x).join('\n'):'';if(it.type==='comment')return c;return (c?c+'\n':'')+emitOne(it,indent)}).join('\n')}

const files=FILES.map(f=>{const src=fs.readFileSync(path.join(repo,f),'utf8');stats.before+=src.length;stats.commentsBefore+=(src.match(/\/\*/g)||[]).length;return{f,items:parse(src)}});
files.forEach(x=>x.items=prune(x.items));
dedupe(files);
for(const x of files){const out=emit(x.items)+'\n';stats.after+=out.length;stats.commentsAfter+=(out.match(/\/\*/g)||[]).length;if(apply)fs.writeFileSync(path.join(repo,x.f),out)}
console.log(JSON.stringify(stats,null,1));
