// Cubestow 적재 엔진: 화면(DOM)에 의존하지 않는 순수 계산 모듈.
// 브라우저 메인 스레드, Web Worker, Node 시험 환경에서 같은 코드로 동작한다.
(function(root){
  'use strict';

  const ENGINE_VERSION='ep-lex-portfolio-2026.10.12';
  const TOL=2;
  const MAX_CONTAINERS=50;
  const ORDER_COUNT=4;

  // 하드 조건(안전 기준). 모든 후보는 선택된 안전 기준을 통과해야만 배치된다.
  const SAFETY_LEVELS={
    strict:{label:'엄격',description:'상부 지지 100%',minSupport:1,maxTopSlender:1.15,cylinderOnFloor:true},
    // 최고 안전: 엄격 조건에 더해, 모든 화물의 안쪽·좌·우 3면이 벽·화물·에어백 간극으로 막혀야 한다(문쪽은 각재·부목으로 막는다).
    secure:{label:'최고 안전',description:'상부 지지 100% · 3면 막힘',minSupport:1,maxTopSlender:1.15,cylinderOnFloor:true,blockSides:true},
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
    balance:{floorFirst:false},
    column:{floorFirst:true,key:'dblf'},
    columnBalance:{floorFirst:true,key:'dblf'}
  };
  const PREFERRED_HEURISTIC={auto:'column',density:'density',width:'width',balance:'balance'};

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
    let area=0,count=0,center=false,fragile=false,blocked=false,onBox=false;
    for(const p of placed){
      if(Math.abs(p.z+p.h-z)>=TOL)continue;
      const x0=Math.max(x,p.x),x1=Math.min(x+l,p.x+p.l),y0=Math.max(y,p.y),y1=Math.min(y+w,p.y+p.w);
      if(x1-x0<=TOL||y1-y0<=TOL)continue;
      if(p.shape==='cylinder'){
        // 원통 위에는 같은 규격의 원통만 중심을 맞춰 올린다.
        const offset=Math.hypot(p.x+p.l/2-cx,p.y+p.w/2-cy),diameterDiff=Math.abs(p.l-l)+Math.abs(p.w-w);
        if(item.shape!=='cylinder'||offset>15||diameterDiff>30){blocked=true;continue}
      }
      if(item.shape==='cylinder'&&p.shape!=='cylinder')onBox=true;
      count++;
      area+=(x1-x0)*(y1-y0);
      if(p.fragile)fragile=true;
      if(cx>=x0-TOL&&cx<=x1+TOL&&cy>=y0-TOL&&cy<=y1+TOL)center=true;
    }
    return{ratio:Math.min(1,area/Math.max(1,l*w)),count,center,fragile,blocked,onBox};
  }

  // packing=true: 적재 좌표(안쪽 벽 x=0), false: 화면 좌표(문 x=0)
  // 맞닿은 화물들이 덮는 높이 구간의 합집합 길이.
  function coveredHeight(spans,z0,z1){
    spans.sort((a,b)=>a[0]-b[0]);
    let sum=0,end=z0;
    for(const [a,b] of spans){const from=Math.max(a,end),to=Math.min(b,z1);if(to>from){sum+=to-from;end=to}}
    return sum;
  }
  function lateralSupportDirections(s,d,placed,c,packing=false){
    const [l,w,h]=d,x0=s.x,x1=s.x+l,y0=s.y,y1=s.y+w,z0=s.z,z1=s.z+h,need=h*.5;
    let low=false,high=false,left=y0<=TOL,right=y1>=c.w-TOL,lowSpans=null,highSpans=null,leftSpans=null,rightSpans=null;
    for(const p of placed){
      if(low&&high&&left&&right)break;
      // 면 폭의 절반 이상 맞닿은 화물이 면 높이의 절반 이상을 덮으면 그 방향은 지지된다.
      // 한 화물로 덮지 못해도 같은 면에 맞닿은 화물들(예: 박스를 쌓은 기둥)의 높이 구간을 합쳐 판단한다.
      const from=Math.max(z0,p.z),to=Math.min(z1,p.z+p.h);
      if(to-from<=TOL)continue;
      const full=to-from>=need,px1=p.x+p.l,py1=p.y+p.w;
      if((!low&&Math.abs(px1-x0)<=TOL)||(!high&&Math.abs(x1-p.x)<=TOL)){
        if(Math.min(y1,py1)-Math.max(y0,p.y)>=w*.5){
          if(Math.abs(px1-x0)<=TOL){if(full)low=true;else(lowSpans||(lowSpans=[])).push([from,to])}
          else{if(full)high=true;else(highSpans||(highSpans=[])).push([from,to])}
        }
      }
      if((!left&&Math.abs(py1-y0)<=TOL)||(!right&&Math.abs(y1-p.y)<=TOL)){
        if(Math.min(x1,px1)-Math.max(x0,p.x)>=l*.5){
          if(Math.abs(py1-y0)<=TOL){if(full)left=true;else(leftSpans||(leftSpans=[])).push([from,to])}
          else{if(full)right=true;else(rightSpans||(rightSpans=[])).push([from,to])}
        }
      }
    }
    if(!low&&lowSpans)low=coveredHeight(lowSpans,z0,z1)>=need;
    if(!high&&highSpans)high=coveredHeight(highSpans,z0,z1)>=need;
    if(!left&&leftSpans)left=coveredHeight(leftSpans,z0,z1)>=need;
    if(!right&&rightSpans)right=coveredHeight(rightSpans,z0,z1)>=need;
    return packing
      ?{front:high,back:s.x<=TOL||low,left,right}
      :{front:low,back:s.x+l>=c.l-TOL||high,left,right};
  }
  // 직사각형들이 [a0,a1]×[b0,b1] 영역을 덮는 넓이(합집합).
  function coveredArea(rects,a0,a1,b0,b1){
    const clipped=rects.map(([p0,p1,q0,q1])=>[Math.max(a0,p0),Math.min(a1,p1),Math.max(b0,q0),Math.min(b1,q1)]).filter(([p0,p1,q0,q1])=>p1>p0&&q1>q0);
    if(!clipped.length)return 0;
    const cuts=[...new Set(clipped.flatMap(r=>[r[0],r[1]]))].sort((a,b)=>a-b);let area=0;
    for(let i=0;i+1<cuts.length;i++){const m=(cuts[i]+cuts[i+1])/2,spans=clipped.filter(r=>r[0]<=m&&r[1]>=m).map(r=>[r[2],r[3]]).sort((a,b)=>a[0]-b[0]);let len=0,end=-Infinity;for(const [q0,q1] of spans){const from=Math.max(q0,end);if(q1>from){len+=q1-from;end=q1}}area+=len*(cuts[i+1]-cuts[i])}
    return area;
  }
  const BLOCK_GAP=600;
  // packing=true: 적재 좌표(안쪽 벽 x=0), false: 화면 좌표(안쪽 벽 x=l). 안쪽·좌·우 면이 각각 막혔는지 돌려준다.
  // 벽까지 비어 있으면 바닥 화물은 충전재(세운 팔레트·골판지)와 에어백으로, 높은 곳 화물은 에어백 한계(600mm) 안에서만 막을 수 있다.
  function blockedSides(s,d,placed,c,packing){
    const [l,w,h]=d,x0=s.x,x1=s.x+l,y0=s.y,y1=s.y+w,z0=s.z,z1=s.z+h;
    const back=[],front=[],left=[],right=[];let leftClear=true,rightClear=true,doorClear=true;
    for(const p of placed){
      const pz0=p.z,pz1=p.z+p.h;
      if(doorClear&&p.y+p.w>y0+TOL&&p.y<y1-TOL&&(packing?p.x>=x1-TOL:p.x+p.l<=x0+TOL))doorClear=false;
      if(pz1<=z0+TOL||pz0>=z1-TOL)continue;
      const px0=p.x,px1=p.x+p.l,py0=p.y,py1=p.y+p.w;
      // 안쪽 방향 간극
      const gapBack=packing?x0-px1:px0-x1;
      if(gapBack>=-TOL&&gapBack<=BLOCK_GAP&&py1>y0&&py0<y1)back.push([py0,py1,pz0,pz1]);
      const gapFront=packing?px0-x1:x0-px1;
      if(gapFront>=-TOL&&py1>y0&&py0<y1){if(gapFront<=BLOCK_GAP)front.push([py0,py1,pz0,pz1])}
      if(px1>x0+TOL&&px0<x1-TOL){
        const gapLeft=y0-py1,gapRight=py0-y1;
        if(gapLeft>=-TOL){leftClear=false;if(gapLeft<=BLOCK_GAP)left.push([px0,px1,pz0,pz1])}
        if(gapRight>=-TOL){rightClear=false;if(gapRight<=BLOCK_GAP)right.push([px0,px1,pz0,pz1])}
      }
    }
    const half=(rects,a0,a1)=>coveredArea(rects,a0,a1,z0,z1)>=(a1-a0)*(z1-z0)*.5-1;
    const innerWall=packing?x0<=TOL:x1>=c.l-TOL;
    const wallOk=gap=>z0<=TOL||gap<=BLOCK_GAP;
    return{front:doorClear||half(front,y0,y1),back:innerWall||half(back,y0,y1),left:y0<=TOL||leftClear&&wallOk(y0)||half(left,x0,x1),right:y1>=c.w-TOL||rightClear&&wallOk(c.w-y1)||half(right,x0,x1)};
  }
  // 최고 안전 기준에서만 켠다.
  let STRICT_BLOCK=false;
  // 엄격 이상에서 켠다. 높은 적층의 전도 방향 면 막힘 검사.
  let TOWER_CHECK=false;const TOWER_LIMIT=3;
  function towerOk(s,d,placed,c,packing){
    const [l,w,h]=d;if(s.z<=0)return true;
    const H=s.z+h,deep=H/Math.max(1,l)>TOWER_LIMIT,wide=H/Math.max(1,w)>TOWER_LIMIT;
    if(!deep&&!wide)return true;
    const b=blockedSides(s,d,placed,c,packing);
    return(!deep||b.front&&b.back)&&(!wide||b.left&&b.right);
  }
  const blockedOk=b=>b.back&&b.left&&b.right;
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
  function spreadDown(box,value,placed,add,visit,geo){
    const self=placed.length,at=i=>i===self?box:placed[i],added=new Map([[self,value]]),queue=[self];
    while(queue.length){
      queue.sort((a,b)=>at(a).z-at(b).z);
      const i=queue.pop(),p=at(i);
      if(p.z<=0)continue;
      const part=added.get(i);
      if(visit&&!visit(i,p,part))return null;
      const {supports,total}=i===self||!geo?supportsOf(p,placed,i):geo(i);
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
      for(const [j,load] of spreadDown(last,last.weight,before,addWeight,null,i=>supportGeometry(state,i)))loads[j]+=load;
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
    for(const [j,load] of spreadDown(box,item.weight,placed,addWeight,null,i=>supportGeometry(state,i)))if(!withinTopLoad(placed[j],state.topLoads[j]+load))return false;
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
  function balancedOnSupports(load,p,placed,self,cachedHull){
    if(cachedHull!==undefined)return!cachedHull||insidePolygon({x:load.mx/load.w,y:load.my/load.w},cachedHull);
    const points=[];
    placed.forEach((q,j)=>{
      if(j===self||Math.abs(q.z+q.h-p.z)>=TOL)return;
      const x0=Math.max(p.x,q.x),x1=Math.min(p.x+p.l,q.x+q.l),y0=Math.max(p.y,q.y),y1=Math.min(p.y+p.w,q.y+q.w);
      if(x1>x0&&y1>y0)points.push({x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1});
    });
    return!points.length||insidePolygon({x:load.mx/load.w,y:load.my/load.w},hull(points));
  }
  // 확정된 화물의 받침 목록과 받침면 볼록 껍질. 새 화물이 기존 화물을 받치게 되면 commitPlacement에서 비운다.
  function supportGeometry(state,i){
    const cache=state.geo||(state.geo=[]);
    if(!cache[i]){
      const placed=state.placed,p=placed[i],{supports,total}=supportsOf(p,placed,i),points=[];
      for(const {j} of supports){const q=placed[j],x0=Math.max(p.x,q.x),x1=Math.min(p.x+p.l,q.x+q.l),y0=Math.max(p.y,q.y),y1=Math.min(p.y+p.w,q.y+q.w);points.push({x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1})}
      cache[i]={supports,total,hull:points.length?hull(points):null};
    }
    return cache[i];
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
      const loads=[...state.stack.loads,ownMoment(last)],added=spreadDown(last,ownMoment(last),before,addMoment,null,i=>supportGeometry(state,i));
      for(const [j,part] of added)loads[j]=addMoment(loads[j],part,1);
      state.stack={loads,ok:[n-1,...added.keys()].every(i=>placed[i].z<=0||balancedOnSupports(loads[i],placed[i],placed,i,supportGeometry(state,i).hull))};
    }else state.stack=stackMoments(placed);
  }
  // compressionSafe와 같은 방식: 새 화물이 기존 화물을 받치지 않으면 새 화물의 중량·모멘트가 아래로 전달되는 몫만 더해 본다.
  function stackSafe(item,x,y,z,d,state){
    const placed=state.placed,box={...item,x,y,z,l:d[0],w:d[1],h:d[2]},self=placed.length;
    syncStack(state);
    if(!state.stack.ok||supportsExisting(box,placed))return stackMoments([...placed,box]).ok;
    return spreadDown(box,ownMoment(box),placed,addMoment,(i,p,part)=>i===self?balancedOnSupports(part,p,placed,i):balancedOnSupports(addMoment(state.stack.loads[i],part,1),p,placed,i,supportGeometry(state,i).hull),i=>supportGeometry(state,i))!==null;
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
    if(state.geo?.length&&supportsExisting(box,state.placed))state.geo=[];
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
      // 엄격 기준: 원통은 바닥이나 같은 규격 원통 위에만 세운다(상자 위에 올린 원통은 높은 곳에서 기울거나 구를 위험이 크다).
      if(safety.cylinderOnFloor&&support.onBox)return null;
      ratio=support.ratio;
    }
    // 측면 지지는 결과에 영향을 줄 때만 계산한다.
    const needSides=ctx.heuristic==='width'||z>0||item.shape==='cylinder'||h/base>profile.slender||(z+h)/base>Math.min(1.5,profile.column);
    const sides=needSides?lateralSupportDirections(pos,d,placed,c,true):null,supported=sides?countSides(sides):4;
    if((z+h)/base>1.5&&supported<(ctx.deferSides?1:2))return null;
    if(STRICT_BLOCK&&!ctx.deferSides&&!blockedOk(blockedSides(pos,d,placed,c,true)))return null;
    if(TOWER_CHECK&&!ctx.deferSides&&!towerOk(pos,d,placed,c,true))return null;
    if(ctx.hasTopLoadLimits&&!compressionSafe(item,x,y,z,d,state))return null;
    if(!stackSafe(item,x,y,z,d,state))return null;
    const risk=sides?transportPlacementRisk(item,pos,d,sides,c,mode):0,open=STRICT_BLOCK?(b=>(b.back?0:1)+(b.left?0:1)+(b.right?0:1))(blockedSides(pos,d,placed,c,true)):0,flag=(risk>0?1:0)+open,area=-(l*w);
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

  // 같은 규격 화물을 같은 방향으로 수직 기둥처럼 쌓아 안쪽 벽부터 바닥에 세운다. 기둥의 각 층은 아래 층을 100% 덮으므로
  // 윗면이 평평하고 지지율이 좋다. 모든 화물은 evaluate의 하드 조건을 한 개씩 통과해야 놓이며, 남은 화물을 돌려준다.
  function columnHeight(ctx,item,d){
    if(item.fragile)return 1;
    let k=Math.floor(ctx.c.h/d[2]);
    if(d[2]/Math.max(1,Math.min(d[0],d[1]))>ctx.safety.maxTopSlender)k=1;
    if(Number.isFinite(item.maxTopLoadKg))k=Math.min(k,1+Math.floor(item.maxTopLoadKg/Math.max(1e-9,item.weight)));
    return Math.max(1,k);
  }
  // 그룹마다 차지할 길이 ≈ 바닥 면적 합 ÷ 컨테이너 폭(기둥 높이만큼 나눈 수)으로 보고, 안쪽 벽부터 차례로 놓을 때
  // 합성 무게중심이 컨테이너 길이 가운데에 가장 가까운 순서를 고른다. 그룹이 6개 이하면 모든 순서를, 넘으면 앞 6개만 바꿔 본다.
  function balancedGroupOrder(c,lists){
    const info=lists.map(list=>{const u=list[0],d=u.rotations.reduce((a,b)=>a[2]<=b[2]?a:b),k=Math.max(1,Math.min(list.length,Math.floor(c.h/d[2])));return{list,length:Math.ceil(list.length/k)*d[0]*d[1]/c.w,weight:list.reduce((s,p)=>s+p.weight,0)}});
    const head=info.slice(0,6),tail=info.slice(6),target=c.l/2;
    let best=null,bestScore=Infinity;
    const permute=(done,left)=>{
      if(!left.length){const order=[...done,...tail];let x=0,moment=0,total=0;for(const g of order){moment+=g.weight*(x+g.length/2);total+=g.weight;x+=g.length}
        const score=Math.abs(moment/Math.max(1e-9,total)-target);if(score<bestScore-1e-6){bestScore=score;best=order}return}
      left.forEach((g,i)=>permute([...done,g],[...left.slice(0,i),...left.slice(i+1)]));
    };
    permute([],head);
    return best.map(g=>g.list);
  }
  function placeColumns(run,state,units,balanced){
    const c=run.c,groups=new Map(),rest=[];
    for(const u of units){if(!groups.has(u.typeKey))groups.set(u.typeKey,[]);groups.get(u.typeKey).push(u)}
    // 기둥을 많이 세울 수 있는 규격(총 부피가 큰 규격)부터 안쪽에 세운다.
    let lists=[...groups.values()].sort((a,b)=>b.length*b[0].volume-a.length*a[0].volume);
    if(balanced&&lists.length>1)lists=balancedGroupOrder(c,lists);
    // 균형 변형: 모든 기둥을 최대 높이로 세웠을 때 바닥이 남으면, 남는 비율만큼 기둥을 낮춰 길이 방향으로 고르게 펼친다.
    let spread=1;
    if(balanced){let area=0;for(const list of lists){const u=list[0],d=u.rotations.reduce((a,b)=>a[2]<=b[2]?a:b),k=Math.max(1,Math.min(list.length,columnHeight(run,u,d)));area+=Math.ceil(list.length/k)*d[0]*d[1]}spread=Math.min(1,area/(c.l*c.w*.9))}
    for(const list of lists){
      const u=list[0];
      // 방향: 기둥이 높이를 가장 잘 채우고, 비슷하면 눕힌(높이가 바닥 최소 치수 이하) 방향, 폭 방향 잔여가 작은 방향 순.
      const scored=u.rotations.map(d=>{const k=Math.min(columnHeight(run,u,d),list.length);return{d,k,fill:Math.round(k*d[2]/c.h*20),slender:d[2]/Math.max(1,Math.min(d[0],d[1])),gap:c.w%d[1]}}).sort((a,b)=>b.fill-a.fill||(a.slender>1)-(b.slender>1)||a.gap-b.gap||a.d[0]*a.d[1]-b.d[0]*b.d[1]);
      const d=scored[0].d,k=balanced?Math.max(1,Math.ceil(scored[0].k*spread)):scored[0].k;
      if(k<2){
        // 균형 변형은 기둥으로 못 세우는 규격도 정한 그룹 순서대로 바닥에 먼저 놓아, 무거운 기둥이 안쪽 벽에 몰리지 않게 한다.
        if(!balanced){rest.push(...list);continue}
        for(const item of list){
          const spot=state.weight+item.weight<=c.maxWeight&&findPlacement(run,state,item,true);
          if(spot)commitPlacement(state,c,{...item,x:spot.pos.x,y:spot.pos.y,z:spot.pos.z,l:spot.d[0],w:spot.d[1],h:spot.d[2]});else rest.push(item);
        }
        continue;
      }
      const queue=list.map(item=>({...item,rotations:[d]}));
      while(queue.length){
        if(state.weight+queue[0].weight>c.maxWeight)break;
        const base=findPlacement(run,state,queue[0],true);
        if(!base)break;
        let z=0,stacked=0;
        while(queue.length&&stacked<k){
          const item=queue[0],pos={x:base.pos.x,y:base.pos.y,z};
          if(z+d[2]>c.h||state.weight+item.weight>c.maxWeight)break;
          if(stacked>0&&!evaluate(run,state,item,pos,d,cheapKey(run,state,pos,d)))break;
          commitPlacement(state,c,{...item,x:pos.x,y:pos.y,z,l:d[0],w:d[1],h:d[2]});
          queue.shift();stacked++;z+=d[2];
        }
        if(stacked<2&&queue.length&&stacked===0)break;
      }
      // 기둥으로 못 세운 화물은 원래 회전 후보를 되살려 나머지 배치로 넘긴다.
      rest.push(...queue.map(item=>({...item,rotations:u.rotations})));
    }
    return rest;
  }
  // 최종 상태에서 높은 화물(누적 높이/바닥 최소 치수 > 1.5)이 2면 이상 지지되는지 확인하고, 못 미치는 화물과 그 위에 얹힌 화물을 뺀다.
  // 화물을 빼면 이웃의 지지가 줄 수 있으므로 더 뺄 것이 없을 때까지 반복한다. 받침·상부하중·적층 무게중심은 위 화물이 빠질 뿐이라 나빠지지 않는다.
  function settleSides(c,placed,fixed){
    let kept=placed,removed=[];
    for(let round=0;round<placed.length;round++){
      const failing=kept.filter(p=>{if(fixed.has(p))return false;const others=kept.filter(q=>q!==p);return(p.z+p.h)/Math.max(1,Math.min(p.l,p.w))>1.5&&countSides(lateralSupportDirections(p,[p.l,p.w,p.h],others,c,true))<2||STRICT_BLOCK&&!blockedOk(blockedSides(p,[p.l,p.w,p.h],others,c,true))||TOWER_CHECK&&!towerOk(p,[p.l,p.w,p.h],others,c,true)});
      if(!failing.length)break;
      const drop=new Set(failing);
      let grew=true;
      while(grew){grew=false;for(const p of kept)if(!drop.has(p)&&p.z>0&&[...drop].some(q=>Math.abs(q.z+q.h-p.z)<TOL&&Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x)>TOL&&Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y)>TOL)){drop.add(p);grew=true}}
      if([...drop].some(p=>fixed.has(p)))return null;
      removed=removed.concat(kept.filter(p=>drop.has(p)));kept=kept.filter(p=>!drop.has(p));
    }
    return{kept,removed};
  }
  function packContainer(ctx,units,heuristic,order,seed=[]){
    if(!ctx.deferSides||seed.length)return packContainerOnce({...ctx,deferSides:false},units,heuristic,order,seed);
    let raw=packContainerOnce(ctx,units,heuristic,order,seed);
    // 최종 상태 검사 → 미달 화물(과 그 위 화물) 제거 → 남은 배치를 고정하고 배치 시점 규칙으로 다시 놓기를 반복한다.
    // 다시 놓은 화물이 이웃의 벽 쪽 간극을 막을 수도 있으므로 매번 다시 검사하고, 마지막까지 미달인 화물은 싣지 않는다.
    for(let round=0;;round++){
      const settled=settleSides(ctx.c,raw.placed,new Set());
      if(!settled.removed.length)return{...raw,heuristic,order};
      const ids=new Set([...settled.removed,...raw.rejected].map(u=>u.uid)),retry=units.filter(u=>ids.has(u.uid));
      if(round>=3)return{placed:settled.kept,rejected:retry.map(item=>({...item,reason:'공간 또는 지지 조건 부족'})),totalWeight:settled.kept.reduce((sum,p)=>sum+p.weight,0),heuristic,order};
      raw=packContainerOnce({...ctx,deferSides:false},retry,'dblf',order,settled.kept);
    }
  }
  function packContainerOnce(ctx,units,heuristic,order,seed=[]){
    const run={...ctx,heuristic:HEURISTICS[heuristic].key||heuristic},state=createState(ctx.c,seed),rejected=[];
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
    if(heuristic==='column'||heuristic==='columnBalance')pending=placeColumns(run,state,pending,heuristic==='columnBalance');
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
    // 길이 방향으로는 절대 옮기지 않는다. 첫 적재는 항상 안쪽 벽에 붙이고, 무게 쏠림은 사전검사 경고로만 알린다.
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
      // 좌우 편차 등급은 따로 본다. 앞뒤 쏠림으로 전체 등급이 이미 위험이어도 좌우는 가운데로 맞출 수 있다.
      lateralLevel:ctu?(Math.abs(ctu.yOffset)<=5?0:Math.abs(ctu.yOffset)<=10?1:2):0,
      // 앞뒤 편차는 2.5% 단위로 비교한다(같은 등급 안에서도 쏠림이 작은 배치를 고른다).
      longitudinal:ctu?Math.round(Math.abs(ctu.xOffset)/2.5):0,
      reviews:transportReviews(load,mode).length,
      // 큰 화물이 문쪽에 있는 정도(0 = 모두 안쪽 벽, 1 = 모두 문). 부피의 제곱으로 가중해 큰 화물을 우선하고 0.02 단위로 비교한다.
      bigDoor:(()=>{let num=0,den=0;for(const p of load.placed){const v=(p.l*p.w*p.h)**2;num+=v*(1-(p.x+p.l/2)/load.container.l);den+=v}return den?Math.round(num/den*50)/50:0})(),
      span
    };
  }

  function preferenceKey(metrics,preference){
    const m=metrics;
    switch(preference){
      case 'density':return[m.span,m.ctuLevel,m.lateralLevel,m.reviews,m.maxOffset];
      case 'width':return[m.reviews,m.ctuLevel,m.lateralLevel,m.span,m.maxOffset];
      case 'balance':return[m.ctuLevel,m.lateralLevel,m.longitudinal,m.maxOffset,m.reviews,m.span];
      default:return[m.ctuLevel,m.lateralLevel,m.longitudinal,m.reviews,m.ctuExcess,m.bigDoor,m.maxOffset,m.span];
    }
  }

  // 컨테이너 1대: 적재 부피 → 적재 수량 → 우선 기준 순으로 비교한다.
  function containerKey(load,ctx){
    load.metrics=load.metrics||loadMetrics(load,ctx.mode);
    return[-load.volume,-load.placed.length,...preferenceKey(load.metrics,ctx.preference)];
  }

  function portfolioRuns(preference){
    // 기둥 쌓기는 시간 예산 안에 반드시 실행되도록 우선 기준 규칙 바로 다음에 둔다.
    const first=PREFERRED_HEURISTIC[preference]||'dblf',names=[first,...(first==='column'?[]:['column']),'columnBalance',...Object.keys(HEURISTICS).filter(h=>h!==first&&h!=='column'&&h!=='columnBalance')],runs=[];
    for(let order=0;order<ORDER_COUNT;order++)for(const heuristic of names)runs.push({heuristic,order});
    return runs;
  }

  // 적재를 길이 방향 슬라이스로 나눈다. 절단면을 걸치는 화물이 없으므로 받침·상부하중·적층 무게중심은 모두 슬라이스 안에서만 생긴다.
  // 슬라이스 순서를 바꾸고 좌우로 뒤집어도 부피와 수직 안전 조건은 그대로다. 첫 슬라이스는 항상 안쪽 벽(x=0)부터 놓는다.
  function rebalanceSlices(ctx,raw){
    const c=ctx.c,placed=raw.placed;if(placed.length<2)return null;
    const sorted=[...placed].sort((a,b)=>a.x-b.x),slices=[];let cur=null;
    for(const p of sorted){
      if(!cur||p.x>=cur.end-TOL){cur={items:[],start:p.x,end:p.x+p.l};slices.push(cur)}
      cur.items.push(p);cur.end=Math.max(cur.end,p.x+p.l);
    }
    let total=0;
    for(const sl of slices){sl.len=sl.end-sl.start;sl.w=0;sl.mx=0;sl.my=0;for(const p of sl.items){sl.w+=p.weight;sl.mx+=p.weight*(p.x+p.l/2-sl.start);sl.my+=p.weight*(p.y+p.w/2-c.w/2)}total+=sl.w}
    if(total<=0)return null;
    // 앞뒤 반전한 슬라이스는 구간 안 모멘트가 (길이 × 무게 − 원래 모멘트)가 된다.
    const mirror=new Set(),moment=sl=>mirror.has(sl)?sl.len*sl.w-sl.mx:sl.mx;
    const offset=order=>{let x=0,m=0;for(const sl of order){m+=moment(sl)+sl.w*x;x+=sl.len}return Math.abs(m/total-c.l/2)};
    let order=slices,score=offset(order);
    const arrange=()=>{
      if(slices.length>1&&slices.length<=7){
        const permute=(done,left)=>{if(!left.length){const v=offset(done);if(v<score-1e-6){score=v;order=done}return}left.forEach((sl,i)=>permute([...done,sl],[...left.slice(0,i),...left.slice(i+1)]))};
        permute([],slices);
      }else if(slices.length>7){
        let improved=true,guard=0;
        while(improved&&guard++<50){improved=false;
          for(let i=0;i<order.length;i++)for(let j=i+1;j<order.length;j++){const next=[...order];[next[i],next[j]]=[next[j],next[i]];const v=offset(next);if(v<score-1e-6){score=v;order=next;improved=true}}
        }
      }
    };
    arrange();
    const ordered=order;
    // 순서를 정한 뒤 슬라이스마다 앞뒤 반전이 편차를 줄이면 뒤집고, 뒤집은 것이 있으면 순서를 한 번 더 고른다.
    let toggled=false;
    for(let round=0;round<3;round++){let changed=false;for(const sl of slices){if(sl.items.length<2)continue;mirror.has(sl)?mirror.delete(sl):mirror.add(sl);const v=offset(order);if(v<score-1e-6){score=v;changed=toggled=true}else mirror.has(sl)?mirror.delete(sl):mirror.add(sl)}if(!changed)break}
    if(toggled)arrange();
    // 좌우 반전: 좌우 모멘트가 큰 슬라이스부터 누적 모멘트를 줄이는 쪽으로 뒤집는다.
    let sum=0;const flip=new Set();
    for(const sl of [...slices].sort((a,b)=>Math.abs(b.my)-Math.abs(a.my))){if(Math.abs(sum-sl.my)<Math.abs(sum+sl.my)-1e-6){flip.add(sl);sum-=sl.my}else sum+=sl.my}
    const build=(order,mirrored)=>{
      if(order===slices&&!flip.size&&!mirrored.size&&slices.every((sl,i)=>i===0?sl.start===0:sl.start===slices[i-1].end))return null;
      const next=[];let x=0;
      for(const sl of order){for(const p of sl.items)next.push({...p,x:mirrored.has(sl)?x+sl.end-(p.x+p.l):x+p.x-sl.start,y:flip.has(sl)?c.w-p.y-p.w:p.y});x+=sl.len}
      // 첫 적재 화물(바닥 화물 중 문쪽 면이 가장 안쪽인 것, 적재 순서 규칙과 같다)은 예외 없이 안쪽 벽에 붙어야 한다.
      // 반전하면 위층 화물만 벽에 닿고 바닥 화물은 떨어질 수 있으므로 확인한다.
      let first=null;for(const p of next)if(p.z===0&&(!first||p.x+p.l<first.x+first.l||p.x+p.l===first.x+first.l&&p.y<first.y))first=p;
      if(!first||first.x>0)return null;
      // 앞뒤 이웃과 안쪽 벽 접촉이 바뀌므로 높이 비율이 큰 화물의 측면 지지 규칙(2면 이상)을 다시 확인한다.
      for(const p of next){
        const base=Math.max(1,Math.min(p.l,p.w));
        if((p.z+p.h)/base>1.5&&countSides(lateralSupportDirections(p,[p.l,p.w,p.h],next.filter(q=>q!==p),c,true))<2)return null;
      }
      return{...raw,placed:next,rebalanced:true};
    };
    // 앞뒤 반전안이 측면 지지 검사에 걸리면 반전 없이 순서만 바꾼 안을 쓴다.
    return build(order,mirror)||(mirror.size?build(ordered,new Set()):null);
  }
  // 완성된 배치안에서 높은 화물(누적 높이/바닥 최소 치수 > 1.5)이 모두 2면 이상 측면 지지되는지 확인한다(화면 좌표).
  // 좌우 무게중심 맞춤으로 적재 전체를 옮기면 옆벽에 기대던 화물이 벽에서 떨어질 수 있다.
  function sidesHold(load){
    return load.placed.every(p=>{const others=load.placed.filter(q=>q!==p);return((p.z+p.h)/Math.max(1,Math.min(p.l,p.w))<=1.5||countSides(lateralSupportDirections(p,[p.l,p.w,p.h],others,load.container))>=2)&&(!STRICT_BLOCK||blockedOk(blockedSides(p,[p.l,p.w,p.h],others,load.container,false)))&&(!TOWER_CHECK||towerOk(p,[p.l,p.w,p.h],others,load.container,false))});
  }
  // 적재 전체를 사용 길이 안에서 앞뒤로 뒤집는다. 받침·상부하중·적층 무게중심은 그대로이고, 안쪽 벽 접촉이 바뀌므로 첫 화물 밀착과 측면 지지를 다시 확인한다.
  function mirrorLoad(ctx,raw){
    const c=ctx.c,placed=raw.placed;if(placed.length<2)return null;
    const span=Math.max(...placed.map(p=>p.x+p.l)),next=placed.map(p=>({...p,x:span-(p.x+p.l)}));
    let first=null;for(const p of next)if(p.z===0&&(!first||p.x+p.l<first.x+first.l||p.x+p.l===first.x+first.l&&p.y<first.y))first=p;
    if(!first||first.x>0)return null;
    for(const p of next){const base=Math.max(1,Math.min(p.l,p.w));if((p.z+p.h)/base>1.5&&countSides(lateralSupportDirections(p,[p.l,p.w,p.h],next.filter(q=>q!==p),c,true))<2)return null}
    return{...raw,placed:next,mirrored:true};
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
      // 부피가 현재 최선보다 작으면 비교 키 첫 항목에서 지므로 마무리 계산을 건너뛴다.
      if(best&&raw.placed.reduce((sum,p)=>sum+p.l*p.w*p.h,0)<best.volume-1e-6)continue;
      const shifted=rebalanceSlices(ctx,raw),sources=[raw,shifted,mirrorLoad(ctx,raw),shifted&&mirrorLoad(ctx,shifted)].filter(Boolean);
      for(const source of sources)for(const centered of variants){
        const load=finalizeLoad(ctx.c,source,centered);
        if(!sidesHold(load))continue;
        const key=containerKey(load,ctx);
        if(!best||compareKeys(key,bestKey)<0){best=load;bestKey=key}
      }
      // 남은 화물을 모두 실었고 CTU 사전검사가 양호하면 다른 배치안이 더 나을 수 없으므로 멈춘다.
      if(best&&!best.rejected.length&&best.metrics.ctuLevel===0){stats.settled=(stats.settled||0)+1;break}
    }
    // 완성안이 하나도 최종 검사를 통과하지 못하면 이 컨테이너에는 싣지 않는다(안전 우선).
    return best||finalizeLoad(ctx.c,{placed:[],rejected:units.map(item=>({...item,reason:'공간 또는 지지 조건 부족'})),totalWeight:0,heuristic:'none',order:0},false);
  }

  function prepareUnits(units){
    return units.map((u,uid)=>{
      const unit={...u,uid,volume:u.volume||u.l*u.w*u.h};
      unit.rotations=allowedRotations(unit);
      unit.typeKey=`${unit.shape}|${unit.l}x${unit.w}x${unit.h}|${unit.weight}|${unit.rotate?1:0}|${unit.fragile?1:0}|${unit.maxTopLoadKg??''}`;
      return unit;
    });
  }
  const stripUnit=({rotations,typeKey,uid,...rest})=>rest;
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
    const load=finalizeLoad(c,raw,false);
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
    STRICT_BLOCK=Boolean(SAFETY_LEVELS[safetyKey].blockSides);
    TOWER_CHECK=safetyKey!=='standard';
    const ctx={c,safetyKey,safety:SAFETY_LEVELS[safetyKey],preference,mode,widthGap:createWidthOracle(units,c.w),deferSides:true,hasTopLoadLimits:units.some(u=>Number.isFinite(u.maxTopLoadKg))};
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
