// Cubestow 적재 엔진: 화면(DOM)에 의존하지 않는 순수 계산 모듈.
// 브라우저 메인 스레드, Web Worker, Node 시험 환경에서 같은 코드로 동작한다.
(function(root){
  'use strict';

  const ENGINE_VERSION='ep-lex-portfolio-2026.10.1';
  const TOL=2;
  const MAX_CONTAINERS=50;
  const ORDER_COUNT=4;

  // 하드 조건(안전 기준). 모든 후보는 선택된 안전 기준을 통과해야만 배치된다.
  const SAFETY_LEVELS={
    strict:{label:'엄격',description:'상부 지지 100%',minSupport:1,maxTopSlender:1.15},
    standard:{label:'표준',description:'상부 지지 70% 이상',minSupport:.7,maxTopSlender:Infinity}
  };
  // 소프트 목표(우선 기준). 미배치 수량과 컨테이너 대수가 같을 때만 순위를 가른다.
  const PREFERENCES={
    auto:{label:'자동 추천'},
    density:{label:'공간 활용'},
    width:{label:'폭 균형'},
    balance:{label:'무게중심'}
  };
  const TRANSPORT_PROFILES={
    sea:{label:'해상',slender:1.35,column:1.7,minSides:3},
    combined:{label:'복합',slender:1.5,column:2,minSides:2},
    road:{label:'육상',slender:1.75,column:2.4,minSides:2}
  };
  // 배치 생성기. 우선 기준과 무관하게 모두 실행하고, 결과를 우선 기준으로 고른다.
  const HEURISTICS={
    dblf:{floorFirst:true},
    density:{floorFirst:false},
    width:{floorFirst:true},
    balance:{floorFirst:false}
  };
  const PREFERRED_HEURISTIC={auto:'dblf',density:'density',width:'width',balance:'balance'};

  const now=()=>typeof performance!=='undefined'?performance.now():Date.now();

  function compareKeys(a,b){
    const n=Math.min(a.length,b.length);
    for(let i=0;i<n;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;
    return a.length-b.length;
  }

  function uniqueRotations(p){
    const all=[[p.l,p.w,p.h],[p.w,p.l,p.h],[p.l,p.h,p.w],[p.h,p.l,p.w],[p.w,p.h,p.l],[p.h,p.w,p.l]];
    return all.filter((d,i)=>all.findIndex(e=>e[0]===d[0]&&e[1]===d[1]&&e[2]===d[2])===i);
  }
  function allowedRotations(p){
    return p.rotate?uniqueRotations(p):uniqueRotations(p).filter(d=>d[2]===p.h);
  }

  // 입력 화물의 폭 조합으로 채울 수 없는 짧은 방향 잔여 폭을 계산한다.
  function createWidthOracle(units,maxWidth){
    const types=new Set(units.map(p=>`${p.l}x${p.w}x${p.h}:${p.rotate?1:0}`)).size;
    const widths=[...new Set(units.flatMap(p=>allowedRotations(p).map(d=>Math.round(d[1]))).filter(w=>w>0&&w<=maxWidth))].sort((a,b)=>a-b);
    const cache=new Map();
    return function projectedWidthGap(remaining){
      if(remaining<=0)return 0;
      if(types<=1)return remaining;
      const usable=widths.filter(w=>w<=remaining);
      if(!usable.length)return remaining;
      const key=`${Math.round(remaining)}:${usable.length}`;
      if(cache.has(key))return cache.get(key);
      const limit=Math.floor(remaining),reachable=new Uint8Array(limit+1);
      reachable[0]=1;
      for(let used=0;used<=limit;used++){
        if(!reachable[used])continue;
        for(const w of usable)if(used+w<=limit)reachable[used+w]=1;
      }
      let gap=remaining;
      for(let used=limit;used>=0;used--)if(reachable[used]){gap=remaining-used;break}
      cache.set(key,gap);
      return gap;
    };
  }

  // ---------- 기하 검사 (적재 좌표: x=0 안쪽 벽, x=c.l 문) ----------

  function collides(x,y,z,l,w,h,placed){
    for(const p of placed)if(x<p.x+p.l&&x+l>p.x&&y<p.y+p.w&&y+w>p.y&&z<p.z+p.h&&z+h>p.z)return true;
    return false;
  }

  // 후보 위치를 아래 → 안쪽 → 좌측으로 밀어 다른 화물이나 벽에 닿게 한다.
  function compact(x,y,z,l,w,h,placed){
    for(let pass=0;pass<6;pass++){
      let moved=false,nz=0,nx=0,ny=0;
      for(const p of placed){const top=p.z+p.h;if(top<=z&&top>nz&&x<p.x+p.l&&x+l>p.x&&y<p.y+p.w&&y+w>p.y)nz=top}
      if(nz!==z){z=nz;moved=true}
      for(const p of placed){const end=p.x+p.l;if(end<=x&&end>nx&&y<p.y+p.w&&y+w>p.y&&z<p.z+p.h&&z+h>p.z)nx=end}
      if(nx!==x){x=nx;moved=true}
      for(const p of placed){const end=p.y+p.w;if(end<=y&&end>ny&&x<p.x+p.l&&x+l>p.x&&z<p.z+p.h&&z+h>p.z)ny=end}
      if(ny!==y){y=ny;moved=true}
      if(!moved)break;
    }
    return{x,y,z};
  }

  function supportInfo(item,x,y,z,l,w,placed){
    if(z===0)return{ratio:1,count:0,center:true,fragile:false,blocked:false};
    const cx=x+l/2,cy=y+w/2;
    let area=0,count=0,center=false,fragile=false,blocked=false;
    for(const p of placed){
      if(Math.abs(p.z+p.h-z)>=TOL)continue;
      const x0=Math.max(x,p.x),x1=Math.min(x+l,p.x+p.l),y0=Math.max(y,p.y),y1=Math.min(y+w,p.y+p.w);
      if(x1-x0<=TOL||y1-y0<=TOL)continue;
      if(p.shape==='cylinder'){
        // 원통 위에는 같은 규격의 원통만 중심을 맞춰 올린다.
        const offset=Math.hypot(p.x+p.l/2-cx,p.y+p.w/2-cy),diameterDiff=Math.abs(p.l-l)+Math.abs(p.w-w);
        if(item.shape!=='cylinder'||offset>15||diameterDiff>30){blocked=true;continue}
      }
      count++;
      area+=(x1-x0)*(y1-y0);
      if(p.fragile)fragile=true;
      if(cx>=x0-TOL&&cx<=x1+TOL&&cy>=y0-TOL&&cy<=y1+TOL)center=true;
    }
    return{ratio:Math.min(1,area/Math.max(1,l*w)),count,center,fragile,blocked};
  }

  // packing=true: 적재 좌표(안쪽 벽 x=0), false: 화면 좌표(문 x=0)
  function lateralSupportDirections(s,d,placed,c,packing=false){
    const [l,w,h]=d,x0=s.x,x1=s.x+l,y0=s.y,y1=s.y+w,z0=s.z,z1=s.z+h;
    let low=false,high=false,left=y0<=TOL,right=y1>=c.w-TOL;
    for(const p of placed){
      if(low&&high&&left&&right)break;
      // 높이 방향으로 절반 이상 겹치는 화물만 측면 지지가 될 수 있다.
      const oz=Math.min(z1,p.z+p.h)-Math.max(z0,p.z);
      if(oz<h*.5)continue;
      const px1=p.x+p.l,py1=p.y+p.w;
      if((!low&&Math.abs(px1-x0)<=TOL)||(!high&&Math.abs(x1-p.x)<=TOL)){
        if(Math.min(y1,py1)-Math.max(y0,p.y)>=w*.5){if(Math.abs(px1-x0)<=TOL)low=true;else high=true}
      }
      if((!left&&Math.abs(py1-y0)<=TOL)||(!right&&Math.abs(y1-p.y)<=TOL)){
        if(Math.min(x1,px1)-Math.max(x0,p.x)>=l*.5){if(Math.abs(py1-y0)<=TOL)left=true;else right=true}
      }
    }
    return packing
      ?{front:high,back:s.x<=TOL||low,left,right}
      :{front:low,back:s.x+l>=c.l-TOL||high,left,right};
  }
  const countSides=sides=>(sides.front?1:0)+(sides.back?1:0)+(sides.left?1:0)+(sides.right?1:0);

  function transportPlacementRisk(item,s,d,sides,c,mode){
    const profile=TRANSPORT_PROFILES[mode]||TRANSPORT_PROFILES.combined,supported=countSides(sides);
    const base=Math.max(1,Math.min(d[0],d[1])),slender=d[2]/base,column=(s.z+d[2])/base;
    let risk=Math.max(0,slender-profile.slender)*(4-supported)+Math.max(0,column-profile.column)*(4-supported);
    if(s.z>0&&!sides.left&&!sides.right)risk+=2;
    if(mode==='sea'&&s.z>0&&s.x+d[0]>=c.l-120&&!sides.front)risk+=1;
    if(item.shape==='cylinder'&&(!sides.left||!sides.right))risk+=1;
    return risk;
  }

  const contactArea=(p,q)=>Math.max(0,Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x))*Math.max(0,Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y));
  const withinTopLoad=(p,load)=>!Number.isFinite(p.maxTopLoadKg)||load<=p.maxTopLoadKg+1e-6;
  // p를 받치는 화물과 접촉면적. 받치는 화물은 항상 p보다 낮은 위치에 있다.
  function supportsOf(p,placed,self){
    const supports=[];let total=0;
    placed.forEach((q,j)=>{
      if(j===self||Math.abs(q.z+q.h-p.z)>=TOL)return;
      const area=contactArea(p,q);
      if(area>0){supports.push({j,area});total+=area}
    });
    return{supports,total};
  }
  function compressionLoads(placed){
    const carried=placed.map(p=>p.weight),top=placed.map(()=>0);
    [...placed.keys()].sort((a,b)=>placed[b].z-placed[a].z).forEach(i=>{
      const p=placed[i];if(p.z<=0)return;
      const {supports,total}=supportsOf(p,placed,i);
      supports.forEach(({j,area})=>{const load=carried[i]*area/total;top[j]+=load;carried[j]+=load});
    });
    return top;
  }
  const supportsExisting=(box,placed)=>placed.some(p=>Math.abs(box.z+box.h-p.z)<TOL&&contactArea(p,box)>0);
  // 새 화물(box)의 값이 받침 경로를 따라 나눠 내려간 몫(기존 화물 번호 → 값). box가 기존 화물을 받치지 않을 때만
  // 기존 분배가 그대로이므로 이 몫만 더하면 된다. 높은 화물부터 처리해야 한 화물로 모이는 몫을 모두 합친 뒤 넘길 수 있다.
  // visit(i,p,value)가 false를 돌려주면 중단하고 null을 돌려준다.
  function spreadDown(box,value,placed,add,visit){
    const self=placed.length,at=i=>i===self?box:placed[i],added=new Map([[self,value]]),queue=[self];
    while(queue.length){
      queue.sort((a,b)=>at(a).z-at(b).z);
      const i=queue.pop(),p=at(i);
      if(p.z<=0)continue;
      const part=added.get(i);
      if(visit&&!visit(i,p,part))return null;
      const {supports,total}=supportsOf(p,placed,i);
      for(const {j,area} of supports){
        if(!added.has(j))queue.push(j);
        added.set(j,add(added.get(j),part,area/total));
      }
    }
    added.delete(self);
    return added;
  }
  const addWeight=(sum=0,part,share)=>sum+part*share;
  // 커밋된 배치의 누적 상부하중. 직전 커밋이 기존 화물을 받치지 않았다면 그 화물의 몫만 더한다.
  function syncTopLoads(state){
    const placed=state.placed,n=placed.length;
    if(state.topLoads?.length===n)return;
    const last=placed[n-1],before=placed.slice(0,n-1);
    if(state.topLoads?.length===n-1&&!supportsExisting(last,before)){
      const loads=[...state.topLoads,0];
      for(const [j,load] of spreadDown(last,last.weight,before,addWeight))loads[j]+=load;
      state.topLoads=loads;
    }else state.topLoads=compressionLoads(placed);
    state.topLoadsOk=placed.every((p,i)=>withinTopLoad(p,state.topLoads[i]));
  }
  // 새 화물이 기존 화물을 받치지 않으면 기존 하중 분배는 바뀌지 않으므로 새 화물 중량이 내려가는 몫만 더해 본다.
  // 그 밖의 경우는 전체를 다시 계산한다.
  function compressionSafe(item,x,y,z,d,state){
    const placed=state.placed,box={...item,x,y,z,l:d[0],w:d[1],h:d[2]};
    syncTopLoads(state);
    if(!state.topLoadsOk||supportsExisting(box,placed)){
      const all=[...placed,box],loads=compressionLoads(all);
      return all.every((p,i)=>withinTopLoad(p,loads[i]));
    }
    for(const [j,load] of spreadDown(box,item.weight,placed,addWeight))if(!withinTopLoad(placed[j],state.topLoads[j]+load))return false;
    return true;
  }

  // 스택 합성 무게중심 검사(validator와 같은 기준). 화물 위에 얹힌 화물까지 합친 무게중심이 받침면들의 볼록 껍질 안에 있어야 한다.
  function hull(points){
    const sorted=[...new Map(points.map(p=>[`${p.x}:${p.y}`,p])).values()].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
    if(sorted.length<3)return sorted;
    const lower=[],upper=[];
    for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}
    for(const p of [...sorted].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}
    return lower.slice(0,-1).concat(upper.slice(0,-1));
  }
  function insidePolygon(point,polygon){
    if(polygon.length<3)return polygon.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<2);
    let sign=0;
    for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);if(Math.abs(cross)<1e-6)continue;const next=Math.sign(cross);if(sign&&next!==sign)return false;sign=next}
    return true;
  }
  // 받침면 안에 합성 무게중심이 있는지 본다. 받침이 없으면 검사할 면이 없으므로 통과한다(validator와 같다).
  function balancedOnSupports(load,p,placed,self){
    const points=[];
    placed.forEach((q,j)=>{
      if(j===self||Math.abs(q.z+q.h-p.z)>=TOL)return;
      const x0=Math.max(p.x,q.x),x1=Math.min(p.x+p.l,q.x+q.l),y0=Math.max(p.y,q.y),y1=Math.min(p.y+p.w,q.y+q.w);
      if(x1>x0&&y1>y0)points.push({x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1});
    });
    return!points.length||insidePolygon({x:load.mx/load.w,y:load.my/load.w},hull(points));
  }
  const ownMoment=p=>({w:p.weight,mx:(p.x+p.l/2)*p.weight,my:(p.y+p.w/2)*p.weight});
  function stackMoments(placed){
    const loads=placed.map(ownMoment);let ok=true;
    [...placed.keys()].sort((a,b)=>placed[b].z-placed[a].z).forEach(i=>{
      const p=placed[i];if(p.z<=0)return;
      if(!balancedOnSupports(loads[i],p,placed,i))ok=false;
      const {supports,total}=supportsOf(p,placed,i);
      supports.forEach(({j,area})=>{const share=area/total;loads[j].w+=loads[i].w*share;loads[j].mx+=loads[i].mx*share;loads[j].my+=loads[i].my*share});
    });
    return{loads,ok};
  }
  const addMoment=(sum={w:0,mx:0,my:0},part,share)=>({w:sum.w+part.w*share,mx:sum.mx+part.mx*share,my:sum.my+part.my*share});
  // 커밋된 배치의 스택 모멘트. 직전 커밋이 기존 화물을 받치지 않았다면 그 화물의 몫만 더하고 바뀐 화물만 다시 검사한다.
  function syncStack(state){
    const placed=state.placed,n=placed.length;
    if(state.stack?.loads.length===n)return;
    const last=placed[n-1],before=placed.slice(0,n-1);
    if(state.stack?.loads.length===n-1&&state.stack.ok&&!supportsExisting(last,before)){
      const loads=[...state.stack.loads,ownMoment(last)],added=spreadDown(last,ownMoment(last),before,addMoment);
      for(const [j,part] of added)loads[j]=addMoment(loads[j],part,1);
      state.stack={loads,ok:[n-1,...added.keys()].every(i=>placed[i].z<=0||balancedOnSupports(loads[i],placed[i],placed,i))};
    }else state.stack=stackMoments(placed);
  }
  // compressionSafe와 같은 방식: 새 화물이 기존 화물을 받치지 않으면 새 화물의 중량·모멘트가 아래로 전달되는 몫만 더해 본다.
  function stackSafe(item,x,y,z,d,state){
    const placed=state.placed,box={...item,x,y,z,l:d[0],w:d[1],h:d[2]},self=placed.length;
    syncStack(state);
    if(!state.stack.ok||supportsExisting(box,placed))return stackMoments([...placed,box]).ok;
    return spreadDown(box,ownMoment(box),placed,addMoment,(i,p,part)=>balancedOnSupports(i===self?part:addMoment(state.stack.loads[i],part,1),p,placed,i))!==null;
  }

  function transverseVoid(x,y,z,d,placed,c){
    const [l,w,h]=d,mid=x+l/2,intervals=[[y,y+w]];
    for(const p of placed)if(mid>p.x+1&&mid<p.x+p.l-1&&z<p.z+p.h&&z+h>p.z)intervals.push([p.y,p.y+p.w]);
    intervals.sort((a,b)=>a[0]-b[0]);
    const merged=[];
    for(const v of intervals){const last=merged[merged.length-1];if(last&&v[0]<=last[1]+TOL)last[1]=Math.max(last[1],v[1]);else merged.push([v[0],v[1]])}
    let covered=0,internal=0;
    merged.forEach((v,i)=>{covered+=v[1]-v[0];if(i)internal+=Math.max(0,v[0]-merged[i-1][1])});
    return{internal,total:Math.max(0,c.w-covered)};
  }

  // ---------- 컨테이너 1대 구성 ----------

  function createState(c,seed){
    const state={placed:[],points:[{x:0,y:0,z:0}],pointKeys:new Set(['0,0,0']),weight:0,depth:0,mx:0,my:0};
    for(const p of seed)commitPlacement(state,c,{...p});
    return state;
  }

  function addPoint(state,c,x,y,z){
    if(x>=c.l||y>=c.w||z>=c.h)return;
    const key=`${x},${y},${z}`;
    if(state.pointKeys.has(key))return;
    state.pointKeys.add(key);
    state.points.push({x,y,z});
  }

  function projectDown(placed,x,y,z,axis){
    let best=0;
    for(const p of placed){
      if(axis==='x'){const e=p.x+p.l;if(e<=x&&e>best&&y>=p.y&&y<p.y+p.w&&z>=p.z&&z<p.z+p.h)best=e}
      else if(axis==='y'){const e=p.y+p.w;if(e<=y&&e>best&&x>=p.x&&x<p.x+p.l&&z>=p.z&&z<p.z+p.h)best=e}
      else{const e=p.z+p.h;if(e<=z&&e>best&&x>=p.x&&x<p.x+p.l&&y>=p.y&&y<p.y+p.w)best=e}
    }
    return best;
  }

  function commitPlacement(state,c,box){
    state.placed.push(box);
    state.weight+=box.weight;
    state.depth=Math.max(state.depth,box.x+box.l);
    state.mx+=(box.x+box.l/2)*box.weight;
    state.my+=(box.y+box.w/2)*box.weight;
    // 새 화물 안에 들어간 후보점 제거
    state.points=state.points.filter(p=>{
      const inside=p.x>=box.x&&p.x<box.x+box.l&&p.y>=box.y&&p.y<box.y+box.w&&p.z>=box.z&&p.z<box.z+box.h;
      if(inside)state.pointKeys.delete(`${p.x},${p.y},${p.z}`);
      return!inside;
    });
    const placed=state.placed,{x,y,z,l,w,h}=box;
    const a=[x+l,y,z],b=[x,y+w,z],t=[x,y,z+h];
    addPoint(state,c,...a);
    addPoint(state,c,a[0],projectDown(placed,a[0],a[1],a[2],'y'),a[2]);
    addPoint(state,c,a[0],a[1],projectDown(placed,a[0],a[1],a[2],'z'));
    addPoint(state,c,...b);
    addPoint(state,c,projectDown(placed,b[0],b[1],b[2],'x'),b[1],b[2]);
    addPoint(state,c,b[0],b[1],projectDown(placed,b[0],b[1],b[2],'z'));
    addPoint(state,c,...t);
    addPoint(state,c,projectDown(placed,t[0],t[1],t[2],'x'),t[1],t[2]);
    addPoint(state,c,t[0],projectDown(placed,t[0],t[1],t[2],'y'),t[2]);
  }

  // 휴리스틱별로 빠르게 계산할 수 있는 앞쪽 키. 후보 정렬과 가지치기에 쓴다.
  function cheapKey(ctx,state,pos,d){
    switch(ctx.heuristic){
      case 'dblf':return[pos.z,pos.x,pos.y];
      case 'width':{const gap=transverseVoid(pos.x,pos.y,pos.z,d,state.placed,ctx.c);return[ctx.widthGap(gap.total),gap.internal,gap.total]}
      case 'balance':{const gap=transverseVoid(pos.x,pos.y,pos.z,d,state.placed,ctx.c);return[Math.max(state.depth,pos.x+d[0]),gap.internal,pos.z]}
      default:{const gap=transverseVoid(pos.x,pos.y,pos.z,d,state.placed,ctx.c);return[Math.max(state.depth,pos.x+d[0]),gap.internal,pos.z,ctx.widthGap(gap.total)]}
    }
  }

  // 하드 조건 검사. 통과하면 [위험 여부, ...앞쪽 키, ...나머지 키]를 돌려준다.
  function evaluate(ctx,state,item,pos,d,cheap){
    const {c,safety,mode}=ctx,{x,y,z}=pos,[l,w,h]=d,placed=state.placed;
    if(collides(x,y,z,l,w,h,placed))return null;
    const base=Math.max(1,Math.min(l,w)),profile=TRANSPORT_PROFILES[mode]||TRANSPORT_PROFILES.combined;
    let ratio=1;
    if(z>0){
      if(h/base>safety.maxTopSlender)return null;
      const support=supportInfo(item,x,y,z,l,w,placed);
      if(support.blocked||!support.count||support.fragile||!support.center)return null;
      if(support.ratio<safety.minSupport-1e-6)return null;
      ratio=support.ratio;
    }
    // 측면 지지는 결과에 영향을 줄 때만 계산한다.
    const needSides=ctx.heuristic==='width'||z>0||item.shape==='cylinder'||h/base>profile.slender||(z+h)/base>Math.min(1.5,profile.column);
    const sides=needSides?lateralSupportDirections(pos,d,placed,c,true):null,supported=sides?countSides(sides):4;
    if((z+h)/base>1.5&&supported<2)return null;
    if(ctx.hasTopLoadLimits&&!compressionSafe(item,x,y,z,d,state))return null;
    if(!stackSafe(item,x,y,z,d,state))return null;
    const risk=sides?transportPlacementRisk(item,pos,d,sides,c,mode):0,flag=risk>0?1:0,area=-(l*w);
    switch(ctx.heuristic){
      case 'dblf':{
        const gap=transverseVoid(x,y,z,d,placed,c);
        return[flag,...cheap,risk,gap.internal,ctx.widthGap(gap.total),1-ratio,area];
      }
      case 'width':
        return[flag,...cheap,4-supported,z,Math.max(state.depth,x+l),risk,1-ratio];
      case 'balance':{
        const total=state.weight+item.weight;
        const cx=(state.mx+(x+l/2)*item.weight)/total,cy=(state.my+(y+w/2)*item.weight)/total;
        return[flag,...cheap,Math.abs(cx/c.l-.5)+Math.abs(cy/c.w-.5),risk,1-ratio];
      }
      default:
        return[flag,...cheap,risk,1-ratio,area];
    }
  }

  function findPlacement(ctx,state,item,floorOnly){
    const {c}=ctx,candidates=[],seen=new Set();
    for(const pt of state.points){
      if(floorOnly&&pt.z>0)continue;
      for(const d of item.rotations){
        if(pt.x+d[0]>c.l||pt.y+d[1]>c.w||pt.z+d[2]>c.h)continue;
        const pos=compact(pt.x,pt.y,pt.z,d[0],d[1],d[2],state.placed);
        if(floorOnly&&pos.z>0)continue;
        const key=`${pos.x},${pos.y},${pos.z},${d[0]},${d[1]},${d[2]}`;
        if(seen.has(key))continue;
        seen.add(key);
        candidates.push({pos,d,cheap:cheapKey(ctx,state,pos,d)});
      }
    }
    candidates.sort((a,b)=>compareKeys(a.cheap,b.cheap));
    let best=null;
    for(const cand of candidates){
      // 위험 없는 최선안보다 앞쪽 키가 나쁘면 이후 후보는 모두 이길 수 없다.
      if(best&&best.key[0]===0&&compareKeys(cand.cheap,best.cheap)>0)break;
      const key=evaluate(ctx,state,item,cand.pos,cand.d,cand.cheap);
      if(key&&(!best||compareKeys(key,best.key)<0))best={...cand,key};
    }
    return best;
  }

  const ORDER_COMPARATORS=[
    (a,b)=>b.volume-a.volume||(b.l*b.w-a.l*a.w)||b.weight-a.weight,
    (a,b)=>Math.max(b.l,b.w,b.h)-Math.max(a.l,a.w,a.h)||(b.l*b.w-a.l*a.w)||b.volume-a.volume,
    (a,b)=>(b.l*b.w-a.l*a.w)||b.h-a.h||b.volume-a.volume,
    (a,b)=>b.weight-a.weight||b.volume-a.volume
  ];
  function stabilityRisk(item){
    const slender=item.h/Math.max(1,Math.min(item.l,item.w));
    return(item.shape==='cylinder'?2:0)+(slender>1.15?1:0)+(item.h>=1200?1:0);
  }
  function sortUnits(units,order){
    const compare=ORDER_COMPARATORS[order%ORDER_COMPARATORS.length];
    return[...units].sort((a,b)=>compare(a,b)||stabilityRisk(b)-stabilityRisk(a)||String(a.name).localeCompare(String(b.name))||(a.pi||0)-(b.pi||0)||(a.unit||0)-(b.unit||0));
  }

  function packContainer(ctx,units,heuristic,order,seed=[]){
    const run={...ctx,heuristic},state=createState(ctx.c,seed),rejected=[];
    // 같은 조건의 화물이 실패하면 새 배치가 생기기 전까지 다시 계산하지 않는다.
    let failed=new Set();
    const place=(item,floorOnly)=>{
      if(state.weight+item.weight>ctx.c.maxWeight)return'weight';
      const failKey=(floorOnly?'f:':'a:')+item.typeKey;
      if(failed.has(failKey))return'space';
      const best=findPlacement(run,state,item,floorOnly);
      if(!best){failed.add(failKey);return'space'}
      commitPlacement(state,ctx.c,{...item,x:best.pos.x,y:best.pos.y,z:best.pos.z,l:best.d[0],w:best.d[1],h:best.d[2]});
      failed=new Set();
      return'ok';
    };
    let pending=sortUnits(units,order);
    if(HEURISTICS[heuristic].floorFirst){
      let added=true;
      while(added&&pending.length){
        added=false;
        const deferred=[];
        for(const item of pending){if(place(item,true)==='ok')added=true;else deferred.push(item)}
        pending=deferred;
      }
    }
    for(const item of pending){
      const outcome=place(item,false);
      if(outcome!=='ok')rejected.push({...item,reason:outcome==='weight'?'중량 초과':'공간 또는 지지 조건 부족'});
    }
    return{placed:state.placed,rejected,totalWeight:state.weight,heuristic,order};
  }

  // ---------- 후처리와 평가 (화면 좌표: 문 x=0) ----------

  function orderPlacementsForLoading(placed){
    const remaining=[...placed],ordered=[],done=new Set(),overlap=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0)>TOL;
    const supporters=new Map(placed.map(p=>[p,p.z===0?[]:placed.filter(q=>q!==p&&Math.abs(q.z+q.h-p.z)<TOL&&overlap(p.x,p.x+p.l,q.x,q.x+q.l)&&overlap(p.y,p.y+p.w,q.y,q.y+q.w))]));
    while(remaining.length){
      let eligible=remaining.filter(p=>supporters.get(p).every(q=>done.has(q)));
      if(!eligible.length)eligible=remaining;
      eligible.sort((a,b)=>b.x-a.x||a.z-b.z||a.y-b.y);
      const next=eligible[0];
      ordered.push(next);done.add(next);remaining.splice(remaining.indexOf(next),1);
    }
    placed.splice(0,placed.length,...ordered);
    placed.forEach((p,i)=>p.order=i+1);
  }

  function centerCargoByWeight(placed,c){
    if(!placed.length)return;
    const total=placed.reduce((sum,p)=>sum+p.weight,0);
    const shift=(axis,size,length)=>{
      const cog=placed.reduce((sum,p)=>sum+(p[axis]+p[size]/2)*p.weight,0)/total;
      const min=Math.min(...placed.map(p=>p[axis])),max=Math.max(...placed.map(p=>p[axis]+p[size]));
      const delta=Math.max(-min,Math.min(Math.round(length/2-cog),length-max));
      placed.forEach(p=>p[axis]+=delta);
    };
    // 길이 방향으로는 옮기지 않는다. 화물은 안쪽 벽에 붙여 싣고, 안쪽 벽 간극을 에어백으로 채우지 않는다.
    shift('y','w',c.w);
  }

  function finalizeLoad(c,raw,centered){
    const placed=raw.placed.map(p=>({...p,x:c.l-(p.x+p.l)}));
    if(centered)centerCargoByWeight(placed,c);
    orderPlacementsForLoading(placed);
    const volume=placed.reduce((sum,p)=>sum+p.l*p.w*p.h,0);
    return{container:c,placed,rejected:raw.rejected,totalWeight:raw.totalWeight,volume,volumeRate:volume/(c.l*c.w*c.h)*100,weightRate:raw.totalWeight/c.maxWeight*100,heuristic:raw.heuristic,order:raw.order,centered:Boolean(centered)};
  }

  function transportStabilityAssessment(p,placed,c,mode){
    const profile=TRANSPORT_PROFILES[mode]||TRANSPORT_PROFILES.combined,base=Math.max(1,Math.min(p.l,p.w));
    const itemSlender=p.h/base,columnSlender=(p.z+p.h)/base;
    const lateral=lateralSupportDirections(p,[p.l,p.w,p.h],placed.filter(q=>q!==p),c),supported=countSides(lateral);
    const missing=Object.entries(lateral).filter(([,ok])=>!ok).map(([dir])=>({front:'전',back:'후',left:'좌',right:'우'}[dir]));
    const reasons=[];
    if(itemSlender>profile.slender&&supported<profile.minSides)reasons.push(`높이 비율 ${itemSlender.toFixed(1)} · 측면 지지 ${supported}/4`);
    if(p.z>0&&columnSlender>profile.column&&supported<profile.minSides)reasons.push(`상단 ${((p.z+p.h)/1000).toFixed(1)}m 고단 적재`);
    if(p.z>0&&!lateral.left&&!lateral.right)reasons.push('상단 좌우 지지 없음');
    if(mode==='sea'&&p.z>0&&p.x<120&&!lateral.front)reasons.push('문측 상단 노출');
    if(p.shape==='cylinder'&&(!lateral.left||!lateral.right))reasons.push('원통 구름 방향 차단 확인');
    return reasons.length?{product:p.name,axes:missing.join('·'),severity:reasons.length>1||missing.length>=3?'rearrange':'review',location:reasons.join(' · ')}:null;
  }

  function transportReviews(load,mode){
    const reviews=[];
    for(const p of load.placed){
      const review=transportStabilityAssessment(p,load.placed,load.container,mode);
      if(!review)continue;
      const same=reviews.find(r=>r.product===review.product&&r.location===review.location&&r.axes===review.axes&&r.severity===review.severity);
      if(same)same.count++;else reviews.push({...review,count:1});
    }
    return reviews;
  }

  function loadMetrics(load,mode){
    const insights=root.LoadwiseInsights,ctu=insights?.ctu?.(load)||insights?.balance?.(load)||null;
    const span=load.placed.length?Math.max(...load.placed.map(p=>p.x+p.l))-Math.min(...load.placed.map(p=>p.x)):0;
    return{
      ctuLevel:ctu?.level==='danger'?2:ctu?.level==='caution'?1:0,
      ctuExcess:ctu?Math.max(0,(ctu.concentration||0)-60,(ctu.vertical||0)-50):0,
      maxOffset:ctu?Math.max(Math.abs(ctu.xOffset),Math.abs(ctu.yOffset)):0,
      reviews:transportReviews(load,mode).length,
      span
    };
  }

  function preferenceKey(metrics,preference){
    const m=metrics;
    switch(preference){
      case 'density':return[m.span,m.ctuLevel,m.reviews,m.maxOffset];
      case 'width':return[m.reviews,m.ctuLevel,m.span,m.maxOffset];
      case 'balance':return[m.ctuLevel,m.maxOffset,m.reviews,m.span];
      default:return[m.ctuLevel,m.reviews,m.ctuExcess,m.maxOffset,m.span];
    }
  }

  // 컨테이너 1대: 적재 부피 → 적재 수량 → 우선 기준 순으로 비교한다.
  function containerKey(load,ctx){
    load.metrics=load.metrics||loadMetrics(load,ctx.mode);
    return[-load.volume,-load.placed.length,...preferenceKey(load.metrics,ctx.preference)];
  }

  function portfolioRuns(preference){
    const first=PREFERRED_HEURISTIC[preference]||'dblf',names=[first,...Object.keys(HEURISTICS).filter(h=>h!==first)],runs=[];
    for(let order=0;order<ORDER_COUNT;order++)for(const heuristic of names)runs.push({heuristic,order});
    return runs;
  }

  function packOneContainer(ctx,units,deadline,stats){
    let best=null,bestKey=null;
    const variants=[false,true];
    const runs=portfolioRuns(ctx.preference);
    // 투입 순서가 같은 실행은 결과도 같으므로 한 번만 계산한다.
    const index=new Map(units.map((u,i)=>[u,i])),sequences=[],seen=new Set();
    for(let i=0;i<runs.length;i++){
      if(i>0&&now()>deadline){stats.truncated=true;break}
      const {heuristic,order}=runs[i];
      sequences[order]=sequences[order]||sortUnits(units,order).map(u=>index.get(u)).join(',');
      const runKey=`${heuristic}|${sequences[order]}`;
      if(seen.has(runKey)){stats.skipped++;continue}
      seen.add(runKey);
      const raw=packContainer(ctx,units,heuristic,order);
      stats.runs++;
      for(const centered of variants){
        const load=balanceAgainstWall(finalizeLoad(ctx.c,raw,centered)),key=containerKey(load,ctx);
        if(!best||compareKeys(key,bestKey)<0){best=load;bestKey=key}
      }
    }
    return best;
  }

  // 화물은 안쪽 벽에 붙여 싣는다. 붙였을 때 전후 무게중심 편차가 CTU 사전검사의 위험 수준(10% 초과)이면
  // 권고 범위(5%)에 들어오는 만큼만 문 쪽으로 옮기고, 띄운 거리를 결과에 남긴다.
  const WALL_DANGER_OFFSET=.1,WALL_TARGET_OFFSET=.05;
  function balanceAgainstWall(load){
    const {placed,container:c}=load,total=placed.reduce((sum,p)=>sum+p.weight,0);
    if(!total)return load;
    const cog=placed.reduce((sum,p)=>sum+(p.x+p.l/2)*p.weight,0)/total;
    if(cog/c.l-.5<=WALL_DANGER_OFFSET)return load;
    const shift=Math.min(Math.min(...placed.map(p=>p.x)),Math.ceil(cog-c.l*(.5+WALL_TARGET_OFFSET)));
    if(shift<=0)return load;
    return{...load,placed:placed.map(p=>({...p,x:p.x-shift})),wallGap:shift,metrics:undefined};
  }

  function prepareUnits(units){
    return units.map(u=>{
      const unit={...u,volume:u.volume||u.l*u.w*u.h};
      unit.rotations=allowedRotations(unit);
      unit.typeKey=`${unit.shape}|${unit.l}x${unit.w}x${unit.h}|${unit.weight}|${unit.rotate?1:0}|${unit.fragile?1:0}|${unit.maxTopLoadKg??''}`;
      return unit;
    });
  }
  const stripUnit=({rotations,typeKey,...rest})=>rest;
  function cleanLoad(load){
    return{...load,placed:load.placed.map(stripUnit),rejected:load.rejected.map(stripUnit)};
  }

  function lowerBound(c,units){
    const volume=units.reduce((sum,u)=>sum+u.l*u.w*u.h,0),weight=units.reduce((sum,u)=>sum+u.weight,0);
    return Math.max(units.length?1:0,Math.ceil(volume/(c.l*c.w*c.h)-1e-9),Math.ceil(weight/c.maxWeight-1e-9));
  }

  // 이전 결과가 한 대로 완료됐다면 유효한 배치를 유지하고 바뀐 화물만 다시 배치한다.
  function repairFromPrevious(ctx,units,previous){
    const c=ctx.c,old=previous?.containers?.[0];
    if(!old||previous.containers.length!==1||previous.unallocated?.length||previous.totalUnits!==units.length)return null;
    if(previous.safety!==ctx.safetyKey||previous.preference!==ctx.preference||previous.transportMode!==ctx.mode)return null;
    if(old.container.l!==c.l||old.container.w!==c.w||old.container.h!==c.h||old.container.maxWeight!==c.maxWeight)return null;
    const current=new Map(units.map(u=>[`${u.pi}:${u.unit}`,u])),retained=[],kept=new Set();
    for(const p of old.placed){
      const key=`${p.pi}:${p.unit}`,item=current.get(key);
      if(!item||item.name!==p.name||item.shape!==p.shape||item.weight!==p.weight||item.fragile!==p.fragile||item.maxTopLoadKg!==p.maxTopLoadKg)continue;
      if(!item.rotations.some(d=>d[0]===p.l&&d[1]===p.w&&d[2]===p.h))continue;
      retained.push({...item,x:c.l-(p.x+p.l),y:p.y,z:p.z,l:p.l,w:p.w,h:p.h});
      kept.add(key);
    }
    if(!retained.length)return null;
    const pending=units.filter(u=>!kept.has(`${u.pi}:${u.unit}`));
    const raw=packContainer(ctx,pending,PREFERRED_HEURISTIC[ctx.preference]||'dblf',0,retained);
    if(raw.rejected.length)return null;
    const load=balanceAgainstWall(finalizeLoad(c,raw,false));
    const validator=root.LoadwiseValidator;
    if(validator&&!validator.validateLoad(load,{minSupport:ctx.safety.minSupport}).valid)return null;
    return load;
  }

  function packShipment(input){
    const started=now();
    const c=input.container,safetyKey=SAFETY_LEVELS[input.safety]?input.safety:'strict',preference=PREFERENCES[input.preference]?input.preference:'auto';
    const mode=TRANSPORT_PROFILES[input.transportMode]?input.transportMode:'combined',budget=Number.isFinite(input.timeBudgetMs)?input.timeBudgetMs:8000;
    const onProgress=typeof input.onProgress==='function'?input.onProgress:()=>{};
    const units=prepareUnits(input.units||[]);
    const ctx={c,safetyKey,safety:SAFETY_LEVELS[safetyKey],preference,mode,widthGap:createWidthOracle(units,c.w),hasTopLoadLimits:units.some(u=>Number.isFinite(u.maxTopLoadKg))};
    const bound=lowerBound(c,units),stats={runs:0,skipped:0,truncated:false,repaired:false,lowerBound:bound};
    const deadline=started+budget,loads=[];
    let remaining=units;
    const repaired=input.previous?repairFromPrevious(ctx,units,input.previous):null;
    if(repaired){
      loads.push(repaired);remaining=[];stats.repaired=true;
    }else{
      while(remaining.length&&loads.length<MAX_CONTAINERS){
        const left=Math.max(1,lowerBound(c,remaining)),share=Math.max(0,deadline-now())/left;
        // 폭 조합은 이 컨테이너에 남은 화물로만 계산한다. 앞 컨테이너에 모두 실린 규격의 폭은 쓸 수 없다.
        const widthGap=remaining===units?ctx.widthGap:createWidthOracle(remaining,c.w);
        const load=packOneContainer({...ctx,widthGap},remaining,now()+share,stats);
        if(!load.placed.length){if(!loads.length)loads.push(load);remaining=load.rejected;break}
        loads.push(load);
        remaining=load.rejected;
        onProgress(Math.min(.98,1-remaining.length/Math.max(1,units.length)));
      }
    }
    stats.wallGaps=loads.filter(load=>load.wallGap).length;
    onProgress(1);
    const result={
      engine:ENGINE_VERSION,safety:safetyKey,preference,transportMode:mode,
      loads:loads.map(cleanLoad),remaining:remaining.map(stripUnit),
      stats:{...stats,elapsedMs:Math.round(now()-started)}
    };
    result.reason=describeResult(result);
    return result;
  }

  function describeResult(result){
    const count=result.loads.length,left=result.remaining.length,bound=result.stats.lowerBound;
    const parts=[`${SAFETY_LEVELS[result.safety].label} 기준(${SAFETY_LEVELS[result.safety].description})`,`${PREFERENCES[result.preference].label}`,`컨테이너 ${count}대`];
    if(!left&&count===bound)parts.push('부피·중량 하한과 같은 최소 대수');
    else if(!left)parts.push(`부피·중량 하한 ${bound}대`);
    if(left)parts.push(`미배치 ${left}개`);
    if(result.stats.wallGaps)parts.push(`무게 쏠림 때문에 ${result.stats.wallGaps}대는 안쪽 벽에서 띄워 적재`);
    if(result.stats.repaired)parts.push('기존 배치 유지');
    if(result.stats.truncated)parts.push('시간 제한으로 일부 후보 생략');
    return parts.join(' · ');
  }

  root.LoadwiseEngine={
    ENGINE_VERSION,SAFETY_LEVELS,PREFERENCES,TRANSPORT_PROFILES,
    packShipment,allowedRotations,uniqueRotations,lateralSupportDirections,
    transportStabilityAssessment,transportReviews,lowerBound,
    _internal:{stackSafe,compareKeys,compact,supportInfo,evaluate,findPlacement,packContainer,createState,createWidthOracle,transportPlacementRisk,compressionSafe,finalizeLoad,preferenceKey,repairFromPrevious,prepareUnits}
  };
})(typeof self!=='undefined'?self:globalThis);
