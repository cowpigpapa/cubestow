// Cubestow 적재 엔진: 화면(DOM)에 의존하지 않는 순수 계산 모듈.
// 브라우저 메인 스레드, Web Worker, Node 시험 환경에서 같은 코드로 동작한다.
(function(root){
  'use strict';

  const ENGINE_VERSION='ep-lex-portfolio-2026.10.23';
  const TOL=2;
  const MAX_CONTAINERS=50;
  const ORDER_COUNT=4;

  // 하드 조건(안전 기준). 모든 후보는 선택된 안전 기준을 통과해야만 배치된다.
  const SAFETY_LEVELS={
    strict:{label:'기본',description:'상부 지지 100%',minSupport:1,maxTopSlender:1.15,cylinderOnFloor:true},
    // 최고 안전: 엄격 조건에 더해, 모든 화물의 안쪽·좌·우 3면이 벽·화물·에어백 간극으로 막혀야 한다(문쪽은 각재·부목으로 막는다).
    secure:{label:'CTU 기준 적용',description:'상부 지지 100% · 3면 막힘(화물·고정재)',minSupport:1,maxTopSlender:1.15,cylinderOnFloor:true,blockSides:true},
    standard:{label:'적재량 우선',description:'상부 지지 70% 이상',minSupport:.7,maxTopSlender:Infinity}
  };
  // 소프트 목표(우선 기준). 미배치 수량과 컨테이너 대수가 같을 때만 순위를 가른다.
  const PREFERENCES={
    auto:{label:'추천'},
    density:{label:'붙여 싣기'},
    width:{label:'폭 균형(추천에 통합)'},
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
    columnBalance:{floorFirst:true,key:'dblf'},
    wall:{floorFirst:true,key:'dblf'},
    strip:{floorFirst:true,key:'dblf'}
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
  // 바닥 격자 색인. 목록(배열)마다 한 번 만들고 뒤에 추가된 화물만 덧붙인다(적재 중 목록은 뒤에만 늘어난다).
  // 이웃 검사는 질의 사각형과 겹치는 칸의 화물만 본다. 화물이 적으면 목록을 그대로 쓴다.
  const GRID_CELL=400,gridCache=new WeakMap();
  function gridOf(list){
    let g=gridCache.get(list);
    if(!g||g.count>list.length){g={cells:new Map(),count:0};gridCache.set(list,g)}
    for(;g.count<list.length;g.count++){const p=list[g.count];for(let ix=Math.floor(p.x/GRID_CELL),ex=Math.floor((p.x+p.l)/GRID_CELL);ix<=ex;ix++)for(let iy=Math.floor(p.y/GRID_CELL),ey=Math.floor((p.y+p.w)/GRID_CELL);iy<=ey;iy++){const k=ix*4096+iy;let cell=g.cells.get(k);if(!cell)g.cells.set(k,cell=[]);cell.push(p)}}
    return g;
  }
  // 사각형 여러 개([x0,x1,y0,y1])와 겹칠 수 있는 화물(중복 없음).
  function nearby(list,rects){
    if(list.length<32)return list;
    const g=gridOf(list),seen=new Set(),out=[];
    for(const [x0,x1,y0,y1] of rects)for(let ix=Math.floor(x0/GRID_CELL),ex=Math.floor(x1/GRID_CELL);ix<=ex;ix++)for(let iy=Math.floor(y0/GRID_CELL),ey=Math.floor(y1/GRID_CELL);iy<=ey;iy++){const cell=g.cells.get(ix*4096+iy);if(cell)for(const p of cell)if(!seen.has(p)){seen.add(p);out.push(p)}}
    return out;
  }
  function lateralSupportDirections(s,d,placed,c,packing=false,self=null){
    const [l,w,h]=d,x0=s.x,x1=s.x+l,y0=s.y,y1=s.y+w,z0=s.z,z1=s.z+h,need=h*.5;
    let low=false,high=false,left=y0<=TOL,right=y1>=c.w-TOL,lowSpans=null,highSpans=null,leftSpans=null,rightSpans=null;
    for(const p of nearby(placed,[[x0-TOL-1,x1+TOL+1,y0-TOL-1,y1+TOL+1]])){
      if(p===self)continue;
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
  // 이웃 화물까지 이 간극 이하면 채워서 막을 수 있다(에어백 제조사 최대 간극 500mm, CTU §2.3.8). 에어백·충전재를 모두 쓰지 않으면 직접 닿아야 한다.
  let BLOCK_GAP=500,FLOOR_FILL=true;
  // packing=true: 적재 좌표(안쪽 벽 x=0), false: 화면 좌표(안쪽 벽 x=l). 안쪽·좌·우 면이 각각 막혔는지 돌려준다.
  // 벽까지 비어 있으면 바닥 화물은 충전재(세운 팔레트·골판지)와 에어백으로, 높은 곳 화물은 에어백 한계(600mm) 안에서만 막을 수 있다.
  function blockedSides(s,d,placed,c,packing,self=null){
    const [l,w,h]=d,x0=s.x,x1=s.x+l,y0=s.y,y1=s.y+w,z0=s.z,z1=s.z+h;
    const back=[],front=[],left=[],right=[];let leftClear=true,rightClear=true,doorClear=true;
    // 좌우는 벽까지의 통로, 앞뒤는 문까지의 통로와 안쪽 간극 범위만 보면 된다.
    const rects=[[x0-1,x1+1,0,c.w],packing?[x0-BLOCK_GAP-TOL,c.l,y0-1,y1+1]:[0,x1+BLOCK_GAP+TOL,y0-1,y1+1]];
    for(const p of nearby(placed,rects)){
      if(p===self)continue;
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
    const wallOk=gap=>z0<=TOL&&FLOOR_FILL||gap<=BLOCK_GAP;
    return{front:doorClear||half(front,y0,y1),back:innerWall||half(back,y0,y1),left:y0<=TOL||leftClear&&wallOk(y0)||half(left,x0,x1),right:y1>=c.w-TOL||rightClear&&wallOk(c.w-y1)||half(right,x0,x1)};
  }
  // 최고 안전 기준에서만 켠다.
  let STRICT_BLOCK=false;
  // 얹힘: 받치는 화물 중에 바닥면 크기가 다른 화물이 있는 쌓인 화물. 같은 규격 기둥의 윗단은 얹힘이 아니다.
  let PERCH_PREFER=false;
  // CTU 기준의 고정재 보강안: 화물끼리 막힘은 요구하지 않지만 얹힘(문쪽이 열린 채 다른 규격 위에 올린 화물)은 금지한다.
  let PERCH_HARD=false;
  function perchOk(s,d,placed,c,packing,self=null){
    if(s.z<=0)return true;
    const [l,w]=d;let perched=false;
    for(const q of nearby(placed,[[s.x,s.x+l,s.y,s.y+w]])){if(q===self||Math.abs(q.z+q.h-s.z)>TOL||Math.min(s.x+l,q.x+q.l)-Math.max(s.x,q.x)<=TOL||Math.min(s.y+w,q.y+q.w)-Math.max(s.y,q.y)<=TOL)continue;if(Math.abs(q.l-l)>TOL||Math.abs(q.w-w)>TOL){perched=true;break}}
    return!perched||blockedSides(s,d,placed,c,packing,self).front;
  }
  // 전도 방지: 화물(바닥부터 높이 H, 그 방향 폭 B)의 H/B가 한계를 넘는 방향은 막혀 있어야 한다.
  // 엄격·CTU 안전(래싱 사용): 쌓인 화물에 한계 3(Cubestow 설정, 전도 위험 방향은 래싱으로 고정).
  // CTU 안전(래싱 끔): CTU 정보자료 5 가속도의 v/c를 운송모드별로(복합은 도로·해상 C 중 불리한 값) 모든 화물에 적용한다.
  const TIP_ACC={road:{side:[.5,1],forward:[.8,1],backward:[.5,1]},seaC:{side:[.8,1],forward:[.4,.2],backward:[.4,.2]}};
  let TOWER_CHECK=false,TIP={side:3,forward:3,backward:3},TIP_STACKED_ONLY=true;
  function tipLimits(mode){const profiles=mode==='road'?['road']:mode==='sea'?['seaC']:['road','seaC'],lim=k=>Math.min(...profiles.map(p=>TIP_ACC[p][k][1]/TIP_ACC[p][k][0]));return{side:lim('side'),forward:lim('forward'),backward:lim('backward')}}
  // 적재 좌표에서 back=안쪽 벽 쪽(전방 가속도), front=문쪽(후방 가속도).
  function towerOk(s,d,placed,c,packing,self=null){
    const [l,w,h]=d;if(TIP_STACKED_ONLY&&s.z<=0)return true;
    const H=s.z+h,rx=H/Math.max(1,l),ry=H/Math.max(1,w),needBack=rx>TIP.forward,needFront=rx>TIP.backward,needSide=ry>TIP.side;
    if(!needBack&&!needFront&&!needSide)return true;
    const b=blockedSides(s,d,placed,c,packing,self);
    return(!needBack||b.back)&&(!needFront||b.front)&&(!needSide||b.left&&b.right);
  }
  const blockedOk=b=>b.back&&b.left&&b.right;
  // 규칙 스위치(전역)를 잠시 바꿔 계산하고 반드시 되돌린다. BASIC_RULES = 기본 기준(화물끼리 막힘 없음, 얹힘은 뒤로 미룸, 쌓인 화물만 전도 한계 3).
  const BASIC_RULES={STRICT_BLOCK:false,PERCH_PREFER:true,TIP:{side:3,forward:3,backward:3},TIP_STACKED_ONLY:true};
  function withRules(patch,fn){
    const keep={STRICT_BLOCK,PERCH_PREFER,PERCH_HARD,TIP,TIP_STACKED_ONLY};
    const apply=r=>{if('STRICT_BLOCK' in r)STRICT_BLOCK=r.STRICT_BLOCK;if('PERCH_PREFER' in r)PERCH_PREFER=r.PERCH_PREFER;if('PERCH_HARD' in r)PERCH_HARD=r.PERCH_HARD;if('TIP' in r)TIP=r.TIP;if('TIP_STACKED_ONLY' in r)TIP_STACKED_ONLY=r.TIP_STACKED_ONLY};
    try{apply(patch);return fn()}finally{apply(keep)}
  }
  const volumeOf=list=>list.reduce((sum,p)=>sum+p.l*p.w*p.h,0);
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
    if(STRICT_BLOCK&&!ctx.deferSides&&(!blockedOk(blockedSides(pos,d,placed,c,true))||!perchOk(pos,d,placed,c,true)))return null;
    if(PERCH_HARD&&!ctx.deferSides&&!perchOk(pos,d,placed,c,true))return null;
    if(TOWER_CHECK&&!ctx.deferSides&&!towerOk(pos,d,placed,c,true))return null;
    if(ctx.hasTopLoadLimits&&!compressionSafe(item,x,y,z,d,state))return null;
    if(!stackSafe(item,x,y,z,d,state))return null;
    const risk=sides?transportPlacementRisk(item,pos,d,sides,c,mode):0,open=STRICT_BLOCK?(b=>(b.back?0:1)+(b.left?0:1)+(b.right?0:1))(blockedSides(pos,d,placed,c,true)):PERCH_PREFER&&z>0&&!perchOk(pos,d,placed,c,true)?1:0,flag=(risk>0?1:0)+open,area=-(l*w);
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
  // 추가 투입 순서(4번 이후): 제품 규격 묶음의 순서를 고정 시드로 섞는다(묶음 안은 부피순). 같은 입력이면 늘 같은 순서다.
  const EXTRA_ORDERS=24;
  function seeded(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  function sortUnits(units,order){
    if(order>=ORDER_COUNT){
      const base=sortUnits(units,0),groups=new Map();for(const u of base){if(!groups.has(u.typeKey))groups.set(u.typeKey,[]);groups.get(u.typeKey).push(u)}
      const keys=[...groups.keys()],rand=seeded(order*7919+keys.length);for(let i=keys.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[keys[i],keys[j]]=[keys[j],keys[i]]}
      return keys.flatMap(k=>groups.get(k));
    }
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
      const failing=kept.filter(p=>{if(fixed.has(p))return false;const d=[p.l,p.w,p.h];return(p.z+p.h)/Math.max(1,Math.min(p.l,p.w))>1.5&&countSides(lateralSupportDirections(p,d,kept,c,true,p))<2||STRICT_BLOCK&&(!blockedOk(blockedSides(p,d,kept,c,true,p))||!perchOk(p,d,kept,c,true,p))||PERCH_HARD&&!perchOk(p,d,kept,c,true,p)||TOWER_CHECK&&!towerOk(p,d,kept,c,true,p)});
      if(!failing.length)break;
      const drop=new Set();
      for(const p of failing){
        // 문쪽 면만 모자라서 걸렸으면(다른 조건은 통과) 앞에 닿은 화물들을 뺀다. 그러면 이 화물이 문쪽 첫 줄이 되거나, 다시 놓인 화물이 제대로 막는다.
        const others=kept,d=[p.l,p.w,p.h];
        let onlyFront=false;
        if(TOWER_CHECK&&!((p.z+p.h)/Math.max(1,Math.min(p.l,p.w))>1.5&&countSides(lateralSupportDirections(p,d,others,c,true,p))<2)&&!(STRICT_BLOCK&&!blockedOk(blockedSides(p,d,others,c,true,p)))){
          const b=blockedSides(p,d,others,c,true,p),H=p.z+p.h,rx=H/Math.max(1,p.l),ry=H/Math.max(1,p.w);
          onlyFront=!b.front&&(rx<=TIP.forward||b.back)&&(ry<=TIP.side||b.left&&b.right);
        }
        const ahead=onlyFront?others.filter(q=>!fixed.has(q)&&q.x>=p.x+p.l-TOL&&q.x-(p.x+p.l)<=BLOCK_GAP&&q.y+q.w>p.y&&q.y<p.y+p.w&&q.z+q.h>p.z+TOL&&q.z<p.z+p.h-TOL):[];
        if(ahead.length)ahead.forEach(q=>drop.add(q));else drop.add(p);
      }
      let grew=true;
      while(grew){grew=false;for(const p of kept)if(!drop.has(p)&&p.z>0&&[...drop].some(q=>Math.abs(q.z+q.h-p.z)<TOL&&Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x)>TOL&&Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y)>TOL)){drop.add(p);grew=true}}
      if([...drop].some(p=>fixed.has(p)))return null;
      removed=removed.concat(kept.filter(p=>drop.has(p)));kept=kept.filter(p=>!drop.has(p));
    }
    return{kept,removed};
  }
  const RESETTLE_ROUNDS=6;
  // 층 후보 깊이: 남은 화물의 회전별 길이 방향 치수를 부피로 가중해 많이 쓰일 깊이부터 고른다. 투입 순서 첫 화물의 깊이는 항상 넣는다.
  function wallDepths(units,room,limit){
    const weight=new Map();
    for(const u of units)for(const d of u.rotations)if(d[0]<=room)weight.set(d[0],(weight.get(d[0])||0)+u.volume);
    const ranked=[...weight.entries()].sort((a,b)=>b[1]-a[1]||b[0]-a[0]).map(([d])=>d);
    const first=units[0]?.rotations.map(d=>d[0]).filter(d=>d<=room).sort((a,b)=>b-a)[0];
    return[...new Set([...(first?[first]:[]),...ranked])].slice(0,limit);
  }
  // 전폭 벽(스트립) 빌더. 벽 = 깊이 D 안에 같은 규격을 같은 방향으로 수직으로 쌓은 기둥들을 폭 방향으로 빈틈없이 붙인 것.
  // 기둥 후보(규격·회전·단수)의 폭 조합을 동적계획법으로 골라 벽 부피를 최대로 하고(양 끝 잔여 폭은 500mm 이하를 우선),
  // 벽 채움률이 가장 높은 깊이를 골라 안쪽 벽부터 차례로 확정한다. 기둥은 벽의 안쪽 면에 맞추고, 짧은 기둥의 문쪽 틈은 500mm 이하다.
  const STRIP_STEP=10;
  function stripColumns(run,units){
    const groups=new Map();
    for(const u of units){if(!groups.has(u.typeKey))groups.set(u.typeKey,[]);groups.get(u.typeKey).push(u)}
    const cols=[];
    for(const list of groups.values()){
      const u=list[0];
      for(const d of u.rotations){
        // 기둥 높이는 전도 한계 안에서만 쌓는다(바닥부터 높이 ÷ 깊이·폭). 한계를 넘는 기둥은 앞뒤 벽 높이가 맞지 않으면 최종 검사에서 무너진다.
        const cap=TOWER_CHECK?Math.min(Math.min(TIP.forward,TIP.backward)*d[0],TIP.side*d[1]):Infinity;
        let most=Math.min(list.length,columnHeight(run,u,d));while(most>1&&most*d[2]>cap)most--;
        for(let k=1;k<=most;k++)cols.push({key:u.typeKey,list,d,k,width:d[1],height:d[2]*k,volume:d[0]*d[1]*d[2]*k,weight:u.weight*k});
      }
    }
    return cols;
  }
  function bestStrip(run,pending,room,weightLeft){
    const c=run.c,W=Math.floor(c.w/STRIP_STEP),cols=stripColumns(run,pending);
    let best=null;
    // 이웃 기둥이 서로 옆면을 절반 이상 덮으려면 높이가 비슷해야 한다: 목표 높이 H와의 차이가 그 기둥 한 단 높이의 절반 이하.
    const heights=[...new Set(cols.map(col=>col.height))];
    for(const D of [...new Set(cols.map(col=>col.d[0]))].filter(D=>D<=room))for(const H of heights){
      const usable=cols.filter(col=>col.d[0]<=D&&D-col.d[0]<=BLOCK_GAP&&Math.abs(col.height-H)<=col.d[2]*.5&&col.height<=H+1);
      if(!usable.length)continue;
      // dp[w]: 폭 w칸을 정확히 쓴 조합 중 부피가 가장 큰 것(사용 수량을 함께 들고 다닌다).
      const dp=new Array(W+1).fill(null);dp[0]={volume:0,weight:0,used:new Map(),picks:[]};
      for(let w=0;w<=W;w++){
        const state=dp[w];if(!state)continue;
        for(const col of usable){
          const cw=Math.ceil(col.width/STRIP_STEP),to=w+cw;if(to>W)continue;
          const used=(state.used.get(col.key)||0)+col.k;if(used>col.list.length||state.weight+col.weight>weightLeft)continue;
          const volume=state.volume+col.volume,cur=dp[to];
          if(!cur||volume>cur.volume+1e-6){const next=new Map(state.used);next.set(col.key,used);dp[to]={volume,weight:state.weight+col.weight,used:next,picks:[...state.picks,col]}}
        }
      }
      // 잔여 폭 500mm 이하인 조합을 우선하고, 없으면 가장 큰 조합(마지막 벽 등).
      const tight=Math.floor((c.w-BLOCK_GAP)/STRIP_STEP);
      let pick=null;for(let w=W;w>=0;w--){const st=dp[w];if(!st||!st.picks.length)continue;const ok=w>=tight;if(!pick||ok&&!pick.ok||ok===pick.ok&&st.volume>pick.st.volume)pick={st,w,ok}}
      if(!pick)continue;
      const fill=pick.st.volume/(D*c.w*c.h),score=[pick.ok?0:1,-fill,-pick.st.volume];
      if(!best||compareKeys(score,best.score)<0)best={D,H,picks:pick.st.picks,score};
    }
    return best;
  }
  function packStrips(ctx,units,order){
    const c=ctx.c,run={...ctx,heuristic:'dblf'},placed=[];let pending=sortUnits(units,order),x=0,weight=0;
    while(pending.length&&x<c.l){
      const strip=bestStrip(run,pending,c.l-x,c.maxWeight-weight);if(!strip)break;
      // 기둥을 폭 방향으로 붙여 놓는다. 무거운 기둥을 가운데에 두어 좌우 무게를 맞춘다.
      const picks=[...strip.picks].sort((a,b)=>b.weight-a.weight),line=[];picks.forEach((col,i)=>i%2?line.push(col):line.unshift(col));
      const taken=new Set();let y=0;
      for(const col of line){
        const items=col.list.filter(u=>!taken.has(u.uid)&&pending.includes(u)).slice(0,col.k);
        items.forEach((u,j)=>{taken.add(u.uid);placed.push({...u,x,y,z:j*col.d[2],l:col.d[0],w:col.d[1],h:col.d[2]});weight+=u.weight});
        y+=col.d[1];
      }
      // 남는 폭은 양쪽으로 나눈다(가운데 정렬).
      const slack=c.w-y;if(slack>TOL){const shift=Math.floor(slack/2),start=placed.length-[...taken].length;for(let i=start;i<placed.length;i++)placed[i].y+=shift}
      pending=pending.filter(u=>!taken.has(u.uid));
      x+=strip.D;
    }
    return{placed,rejected:pending.map(item=>({...item,reason:weight+item.weight>c.maxWeight?'중량 초과':'공간 또는 지지 조건 부족'})),totalWeight:weight,heuristic:'strip',order};
  }
  function packWalls(ctx,units,order){
    const c=ctx.c,placed=[],rejected=[];
    let pending=sortUnits(units,order),x=0,weight=0;
    while(pending.length&&x<c.l){
      let best=null;
      for(const depth of wallDepths(pending,c.l-x,5)){
        // 앞 층을 고정 화물로 두고 길이를 x+깊이로 제한한 컨테이너를 채운다. 측면 지지·받침은 실제 앞 층 화물로 판단하고, 앞 층의 빈틈도 채울 수 있다.
        // 앞 층을 고정하고 이 층만 임시로 놓은 뒤 최종 규칙으로 검사해, 통과한 화물만 층으로 쓴다.
        const sub={...ctx,c:{...c,l:x+depth}},once=packContainerOnce({...sub,deferSides:Boolean(ctx.deferSides)},pending,'dblf',order,placed);
        const fixed=new Set(once.placed.slice(0,placed.length)),settled=ctx.deferSides?settleSides(sub.c,once.placed,fixed):{kept:once.placed,removed:[]};
        if(!settled)continue;
        const layer=settled.kept.filter(p=>!fixed.has(p)),raw={placed:settled.kept,rejected:[...once.rejected,...settled.removed]};
        if(!layer.length)continue;
        const volume=layer.reduce((sum,p)=>sum+p.l*p.w*p.h,0),used=Math.max(x,...layer.map(p=>p.x+p.l))-x,fill=used>0?volume/(used*c.w*c.h):Infinity;
        if(!best||fill>best.fill+1e-9||Math.abs(fill-best.fill)<=1e-9&&volume>best.volume)best={layer,used,fill,volume,left:raw.rejected};
      }
      if(!best)break;
      placed.push(...best.layer.map(p=>({...p})));weight+=best.layer.reduce((sum,p)=>sum+p.weight,0);x+=best.used;
      const ids=new Set(best.left.map(u=>u.uid));pending=pending.filter(u=>ids.has(u.uid));
    }
    for(const item of pending)rejected.push({...item,reason:weight+item.weight>c.maxWeight?'중량 초과':'공간 또는 지지 조건 부족'});
    return{placed,rejected,totalWeight:weight,heuristic:'wall',order};
  }
  function packContainer(ctx,units,heuristic,order,seed=[],initial=null){
    if(heuristic==='wall'&&!seed.length&&!initial)return packWalls(ctx,units,order);
    if(!initial&&(!ctx.deferSides||seed.length))return packContainerOnce({...ctx,deferSides:false},units,heuristic,order,seed);
    let raw=initial||(heuristic==='strip'&&!seed.length?packStrips(ctx,units,order):packContainerOnce(ctx,units,heuristic,order,seed)),best=null;
    const volume=list=>list.reduce((sum,p)=>sum+p.l*p.w*p.h,0);
    // 최종 상태 검사 → 미달 화물(과 그 위 화물) 제거 → 뺀 화물을 다시 놓기를 반복하고, 검사를 통과한 안 중 부피가 가장 큰 안을 쓴다.
    // 다시 놓을 때도 처음처럼 임시로 놓는다(옆 칸이 나중에 채워지면 막힌다). 마지막 두 번은 놓는 순간 규칙을 지키게 놓는다.
    const rounds=initial?3:STRICT_BLOCK?RESETTLE_ROUNDS:3;
    for(let round=0;round<=rounds;round++){
      const settled=settleSides(ctx.c,raw.placed,new Set());
      const ids=new Set([...settled.removed,...raw.rejected].map(u=>u.uid)),retry=units.filter(u=>ids.has(u.uid));
      // 원래 못 실은 화물은 그 사유(예: 중량 초과)를 유지하고, 최종 검사에서 뺀 화물만 공간·지지 사유로 둔다.
      const reasons=new Map(raw.rejected.map(r=>[r.uid,r.reason]));
      const candidate={placed:settled.kept,rejected:retry.map(item=>({...item,reason:reasons.get(item.uid)||'공간 또는 지지 조건 부족'})),totalWeight:settled.kept.reduce((sum,p)=>sum+p.weight,0),heuristic,order};
      if(!best||volume(candidate.placed)>volume(best.placed)+1e-6)best=candidate;
      if(!settled.removed.length||!retry.length||round===rounds)break;
      raw=packContainerOnce({...ctx,deferSides:STRICT_BLOCK&&round<rounds-2},retry,'dblf',order,settled.kept);
    }
    if(!best.rejected.length)return{...best,rejected:[]};
    return best;
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
    const lateral=lateralSupportDirections(p,[p.l,p.w,p.h],placed,c,false,p),supported=countSides(lateral);
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
    for(let order=0;order<ORDER_COUNT;order++)for(const heuristic of names)if(heuristic!=='wall'&&heuristic!=='strip'||STRICT_BLOCK)runs.push({heuristic,order});
    // 예산이 남으면 규격 순서를 섞은 투입 순서로 주요 규칙을 더 계산한다(runCap이 예산 안에서 자른다).
    const PREFERRED=first,extra=[...new Set([PREFERRED,'column','columnBalance','dblf','width'])];
    for(let order=ORDER_COUNT;order<ORDER_COUNT+EXTRA_ORDERS;order++)for(const heuristic of extra)runs.push({heuristic,order});
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
        if((p.z+p.h)/base>1.5&&countSides(lateralSupportDirections(p,[p.l,p.w,p.h],next,c,true,p))<2)return null;
      }
      return{...raw,placed:next,rebalanced:true};
    };
    // 앞뒤 반전안이 측면 지지 검사에 걸리면 반전 없이 순서만 바꾼 안을 쓴다.
    return build(order,mirror)||(mirror.size?build(ordered,new Set()):null);
  }
  // 완성된 배치안에서 높은 화물(누적 높이/바닥 최소 치수 > 1.5)이 모두 2면 이상 측면 지지되는지 확인한다(화면 좌표).
  // 좌우 무게중심 맞춤으로 적재 전체를 옮기면 옆벽에 기대던 화물이 벽에서 떨어질 수 있다.
  // 빈틈은 문쪽으로: 받침으로 이어진 화물 묶음을 안쪽 벽 쪽으로 끝까지 민다(화면 좌표, 안쪽 = 큰 x).
  // 한 묶음씩 옮기고 측면 지지·막힘·전도 검사가 그대로면 남긴다. 안쪽에 남던 틈이 문쪽으로 모여 에어백·문막이가 현실적인 위치에 온다.
  function pushInward(c,placed){
    const n=placed.length;if(n<2)return placed;
    const ov=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0)>TOL;
    const parent=placed.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
    for(let i=0;i<n;i++){const p=placed[i];if(p.z<=TOL)continue;for(let j=0;j<n;j++){const q=placed[j];if(i!==j&&Math.abs(q.z+q.h-p.z)<TOL&&ov(p.x,p.x+p.l,q.x,q.x+q.l)&&ov(p.y,p.y+p.w,q.y,q.y+q.w))parent[find(i)]=find(j)}}
    const groups=new Map();placed.forEach((p,i)=>{const r=find(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i)});
    let list=placed.map(p=>({...p}));
    for(let pass=0;pass<3;pass++){
      let moved=false;
      const order=[...groups.values()].sort((a,b)=>Math.max(...b.map(i=>list[i].x+list[i].l))-Math.max(...a.map(i=>list[i].x+list[i].l)));
      for(const members of order){
        const inGroup=new Set(members);let dx=Infinity;
        for(const i of members){const p=list[i];let room=c.l-(p.x+p.l);for(let j=0;j<n;j++){if(inGroup.has(j))continue;const q=list[j];if(q.x>=p.x+p.l-TOL&&ov(p.y,p.y+p.w,q.y,q.y+q.w)&&ov(p.z,p.z+p.h,q.z,q.z+q.h))room=Math.min(room,q.x-(p.x+p.l))}dx=Math.min(dx,room)}
        if(!(dx>TOL))continue;
        const trial=list.map((p,i)=>inGroup.has(i)?{...p,x:p.x+dx}:p);
        if(!sidesHold({container:c,placed:trial}))continue;
        list=trial;moved=true;
      }
      if(!moved)break;
    }
    return list;
  }
  function sidesHold(load){
    const all=load.placed;
    return all.every(p=>{const d=[p.l,p.w,p.h];return((p.z+p.h)/Math.max(1,Math.min(p.l,p.w))<=1.5||countSides(lateralSupportDirections(p,d,all,load.container,false,p))>=2)&&(!STRICT_BLOCK||blockedOk(blockedSides(p,d,all,load.container,false,p))&&perchOk(p,d,all,load.container,false,p))&&(!PERCH_HARD||perchOk(p,d,all,load.container,false,p))&&(!TOWER_CHECK||towerOk(p,d,all,load.container,false,p))});
  }
  // 적재 전체를 사용 길이 안에서 앞뒤로 뒤집는다. 받침·상부하중·적층 무게중심은 그대로이고, 안쪽 벽 접촉이 바뀌므로 첫 화물 밀착과 측면 지지를 다시 확인한다.
  function mirrorLoad(ctx,raw){
    const c=ctx.c,placed=raw.placed;if(placed.length<2)return null;
    const span=Math.max(...placed.map(p=>p.x+p.l)),next=placed.map(p=>({...p,x:span-(p.x+p.l)}));
    let first=null;for(const p of next)if(p.z===0&&(!first||p.x+p.l<first.x+first.l||p.x+p.l===first.x+first.l&&p.y<first.y))first=p;
    if(!first||first.x>0)return null;
    for(const p of next){const base=Math.max(1,Math.min(p.l,p.w));if((p.z+p.h)/base>1.5&&countSides(lateralSupportDirections(p,[p.l,p.w,p.h],next,c,true,p))<2)return null}
    return{...raw,placed:next,mirrored:true};
  }
  // 배치안 1회 계산 비용(초)을 화물 수의 제곱으로 어림한다(기준 PC 측정값). 컨테이너 예산 안에 들어가는 배치안 수만큼 계산한다.
  const RUN_COST={base:1.6e-5,secure:9e-5};
  function runCap(ctx,count,budgetMs,total){
    const perRun=(STRICT_BLOCK?RUN_COST.secure:RUN_COST.base)*count*count+.01;
    // 최소 시도 횟수: 보통 4회, CTU 안전에서 1회가 예산의 절반을 넘게 무거우면 2회.
    const floor=STRICT_BLOCK&&perRun>budgetMs/2000?2:4;
    return Math.max(floor,Math.min(total,Math.floor(budgetMs/1000/perRun)));
  }
  function topUp(ctx,load,units){
    if(!load?.rejected.length||!load.placed.length)return load;
    const c=ctx.c,seed=load.placed.map(p=>({...p,x:c.l-(p.x+p.l)})),ids=new Set(load.rejected.map(u=>u.uid)),extra=units.filter(u=>ids.has(u.uid));
    let best=load;
    for(let order=0;order<ORDER_COUNT;order++){
      const once=packContainerOnce({...ctx,deferSides:true},extra,'dblf',order,seed),fixed=new Set(once.placed.slice(0,seed.length));
      const settled=settleSides(c,once.placed,fixed);
      if(!settled||settled.kept.length<=best.placed.length)continue;
      const kept=new Set(settled.kept.map(p=>p.uid)),raw={placed:settled.kept,rejected:extra.filter(u=>!kept.has(u.uid)).map(item=>({...item,reason:'공간 또는 지지 조건 부족'})),totalWeight:settled.kept.reduce((sum,p)=>sum+p.weight,0),heuristic:load.heuristic,order:load.order};
      const next=finalizeLoad(c,raw,false);
      if(!sidesHold(next))continue;
      next.metrics=loadMetrics(next,ctx.mode);best=next;
      if(!best.rejected.length)break;
    }
    return best;
  }
  // ---------- 컨테이너 한 대 채우기 ----------
  // 단계: 배치안 포트폴리오 → (CTU) 기본 기준 배치 고쳐 쓰기 → (CTU) 남은 화물 끼워 넣기 → 빈틈을 문쪽으로.
  // 후보 비교: 최종 검사를 통과한 안 중 비교 키가 가장 작은 안.
  function offerLoad(ctx,state,load){
    if(!sidesHold(load))return false;
    const key=containerKey(load,ctx);
    if(!state.best||compareKeys(key,state.bestKey)<0){state.best=load;state.bestKey=key;return true}
    return false;
  }
  const CENTER_VARIANTS=[false,true];
  function searchPortfolio(ctx,units,budgetMs,stats,hardDeadline,state){
    const runs=portfolioRuns(ctx.preference),cap=runCap(ctx,units.length,budgetMs,runs.length);
    // 투입 순서가 같은 실행은 결과도 같으므로 한 번만 계산한다.
    const index=new Map(units.map((u,i)=>[u,i])),sequences=[],seen=new Set();let done=0;
    for(let i=0;i<runs.length;i++){
      const best=state.best;
      // 시간이 지나도 아직 아무것도 싣지 못했으면 다음 배치안을 계속 시도한다(빈 컨테이너로 끝내면 남은 화물을 모두 포기하게 된다).
      const {heuristic,order}=runs[i];
      // 비상 시간 상한은 기본 순서에만 본다. 추가 투입 순서는 가벼운 기본 기준 계산이고 배치안 수(cap)로만 자르므로 기기 속도와 관계없이 같은 결과가 나온다.
      if(i>0&&(done>=cap||order<ORDER_COUNT&&now()>hardDeadline)&&best?.placed.length){stats.truncated=true;if(order<ORDER_COUNT&&now()>hardDeadline)stats.timedOut=true;break}
      // 추가 투입 순서는 화물이 남았거나(대수를 줄일 여지) 무게배분이 위험일 때만 계산한다. 화물끼리 막는 CTU 탐색은 비싸서 쓰지 않는다.
      if(order>=ORDER_COUNT&&(STRICT_BLOCK||best&&!best.rejected.length&&best.metrics.ctuLevel<2))continue;
      sequences[order]=sequences[order]||sortUnits(units,order).map(u=>index.get(u)).join(',');
      const runKey=`${heuristic}|${sequences[order]}`;
      if(seen.has(runKey)){stats.skipped++;continue}
      seen.add(runKey);
      const raw=packContainer(ctx,units,heuristic,order);
      stats.runs++;done++;
      // 부피가 현재 최선보다 작으면 비교 키 첫 항목에서 지므로 마무리 계산을 건너뛴다.
      if(best&&volumeOf(raw.placed)<best.volume-1e-6)continue;
      const shifted=rebalanceSlices(ctx,raw),sources=[raw,shifted,mirrorLoad(ctx,raw),shifted&&mirrorLoad(ctx,shifted)].filter(Boolean);
      for(const source of sources)for(const centered of CENTER_VARIANTS)offerLoad(ctx,state,finalizeLoad(ctx.c,source,centered));
      // 남은 화물을 모두 실었고 CTU 사전검사가 양호하면 다른 배치안이 더 나을 수 없으므로 멈춘다.
      if(state.best&&!state.best.rejected.length&&state.best.metrics.ctuLevel===0){stats.settled=(stats.settled||0)+1;break}
    }
  }
  // CTU 기준에서 화물이 남으면 기본 기준 배치를 출발점으로 삼는다: 기본 기준으로 가볍게 여러 안을 만들고,
  // 지금보다 많이 싣는 안 중 가장 많이 싣는 1개만 CTU 검사에 걸린 화물을 빼고 다시 놓는다(다시 놓기는 3회로 제한).
  // 래싱을 끈 CTU(전도 한계 적용)는 기본 기준 배치와 전도 규칙이 달라 출발점으로 쓰지 않는다(평가 세트에서 대수가 늘었다).
  const RELAXED_SEEDS=[{heuristic:'width',order:0},{heuristic:'dblf',order:0},{heuristic:'column',order:0},{heuristic:'columnBalance',order:0},{heuristic:'density',order:1},{heuristic:'dblf',order:2}];
  function repairFromBasicLayout(ctx,units,stats,state){
    const best=state.best,loose=withRules(BASIC_RULES,()=>RELAXED_SEEDS.map(({heuristic,order})=>({heuristic,order,raw:packContainerOnce({...ctx,safety:SAFETY_LEVELS.strict,deferSides:false},units,heuristic,order)})).filter(v=>v.raw.placed.length>best.placed.length).map(v=>({...v,volume:volumeOf(v.raw.placed)})));
    loose.sort((a,b)=>b.volume-a.volume||a.raw.rejected.length-b.raw.rejected.length);
    for(const seed of loose.slice(0,1)){
      const raw=packContainer(ctx,units,seed.heuristic,seed.order,[],seed.raw);stats.runs++;
      if(volumeOf(raw.placed)<state.best.volume-1e-6)continue;
      for(const centered of CENTER_VARIANTS)if(offerLoad(ctx,state,finalizeLoad(ctx.c,raw,centered)))stats.relaxed=(stats.relaxed||0)+1;
      if(!state.best.rejected.length)break;
    }
  }
  // 빈틈을 문쪽으로 모은다. CTU 사전검사 등급이 나빠지면 원래 배치를 쓴다.
  function pushGapsToDoor(ctx,best,stats){
    if(!(best?.placed.length>1))return best;
    const placed=pushInward(ctx.c,best.placed);
    if(!placed.some((p,i)=>p.x!==best.placed[i].x))return best;
    orderPlacementsForLoading(placed);const next={...best,placed};next.metrics=loadMetrics(next,ctx.mode);
    if(next.metrics.ctuLevel>best.metrics.ctuLevel)return best;
    stats.pushed=(stats.pushed||0)+1;return next;
  }
  function packOneContainer(ctx,units,budgetMs,stats,hardDeadline){
    const state={best:null,bestKey:null};
    searchPortfolio(ctx,units,budgetMs,stats,hardDeadline,state);
    if(STRICT_BLOCK&&TIP_STACKED_ONLY&&state.best?.rejected.length&&now()<=hardDeadline)repairFromBasicLayout(ctx,units,stats,state);
    let best=state.best;
    // 남은 화물이 있으면 기존 배치 사이에 한 번 더 넣어 본다.
    if(STRICT_BLOCK&&best?.rejected.length&&best.rejected.length<=units.length*.25){const filled=topUp(ctx,best,units);if(filled!==best){stats.toppedUp=(stats.toppedUp||0)+1;best=filled}}
    best=pushGapsToDoor(ctx,best,stats);
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
    STRICT_BLOCK=Boolean(SAFETY_LEVELS[safetyKey].blockSides);PERCH_HARD=false;
    TOWER_CHECK=safetyKey!=='standard';PERCH_PREFER=safetyKey==='strict';
    const securing={airbag:true,filler:true,nails:true,lashing:true,...(input.securing||{})},ctuTip=Boolean(SAFETY_LEVELS[safetyKey].blockSides)&&securing.lashing===false;
    TIP=ctuTip?tipLimits(mode):{side:3,forward:3,backward:3};TIP_STACKED_ONLY=!ctuTip;
    BLOCK_GAP=securing.airbag||securing.filler?500:TOL;FLOOR_FILL=securing.filler!==false;
    const ctx={c,safetyKey,safety:SAFETY_LEVELS[safetyKey],preference,mode,widthGap:createWidthOracle(units,c.w),deferSides:true,hasTopLoadLimits:units.some(u=>Number.isFinite(u.maxTopLoadKg))};
    const bound=lowerBound(c,units),stats={runs:0,skipped:0,truncated:false,repaired:false,lowerBound:bound};
    let loads=[],remaining=units;
    // 컨테이너를 차례로 채운다. progress(비율)로 진행률 구간을 나눠 쓴다.
    // 컨테이너별 예산(share)은 경과 시간이 아니라 필요 대수 하한으로 나눈다(결과 고정). CTU 보강안은 절반씩 쓴다.
    // limit: 이 대수를 채우고도 화물이 남으면 더 볼 필요가 없다(CTU 보강안은 대수가 줄 때만 쓰므로 화물끼리 막는 안보다 한 대 적게까지만 본다).
    const fillContainers=(progress,share=budget/Math.max(1,bound),limit=MAX_CONTAINERS)=>{
      const out=[];let left=units;
      while(left.length&&out.length<MAX_CONTAINERS){
        if(out.length>=limit){out.cut=true;break}
        // 폭 조합은 이 컨테이너에 남은 화물로만 계산한다. 앞 컨테이너에 모두 실린 규격의 폭은 쓸 수 없다.
        const widthGap=left===units?ctx.widthGap:createWidthOracle(left,c.w);
        const load=packOneContainer({...ctx,widthGap},left,share,stats,started+Math.max(budget*3,45000));
        if(!load.placed.length){if(!out.length)out.push(load);left=load.rejected;break}
        out.push(load);left=load.rejected;
        progress(1-left.length/Math.max(1,units.length));
      }
      return{loads:out,remaining:left,cut:Boolean(out.cut)};
    };
    const repaired=input.previous?repairFromPrevious(ctx,units,input.previous):null;
    if(repaired){
      loads.push(repaired);remaining=[];stats.repaired=true;
    }else{
      const blocked=fillContainers(f=>onProgress(Math.min(.98,(STRICT_BLOCK?.6:1)*f)));
      ({loads,remaining}=blocked);
      // CTU 기준: 화물끼리 서로 막는 배치가 하한보다 많은 대수를 쓰면, 기본 기준 규칙(얹힘은 금지)으로도 채워 본다.
      // 이 안의 열린 옆면은 에어백·충전재·각재·래싱으로 막는다(CTU Code는 화물 외 고정재로 막는 것도 인정). 대수·미적재가 줄 때만 쓴다.
      if(STRICT_BLOCK&&(remaining.length||loads.length>bound)&&(securing.airbag||securing.filler||securing.lashing)){
        // 먼저 기본 기준 그대로 채우고 최종 배치에 얹힘이 없으면 쓴다. 얹힘이 남으면 얹힘을 금지하고 다시 채운다.
        const perchClean=list=>list.every(L=>L.placed.every(p=>perchOk(p,[p.l,p.w,p.h],L.placed,L.container,false,p)));
        const limit=remaining.length?MAX_CONTAINERS:loads.length-1,half=budget/2/Math.max(1,bound);
        // 전도 한계(TIP)는 CTU 설정(래싱 여부)을 그대로 쓴다.
        let secured=withRules({STRICT_BLOCK:false,PERCH_PREFER:true,PERCH_HARD:false},()=>fillContainers(f=>onProgress(Math.min(.98,.6+.2*f)),half,limit));
        // 얹힘을 금지하면 더 빡빡해지므로, 기본 기준 그대로도 대수를 줄이지 못했으면 다시 채우지 않는다.
        if(!secured.cut&&!perchClean(secured.loads))secured=withRules({STRICT_BLOCK:false,PERCH_PREFER:true,PERCH_HARD:true},()=>fillContainers(f=>onProgress(Math.min(.98,.8+.18*f)),half,limit));
        if(!secured.cut&&secured.remaining.length<remaining.length||!secured.cut&&secured.remaining.length===remaining.length&&secured.loads.length<loads.length){({loads,remaining}=secured);stats.securedFaces=true}
      }
    }
    // 미적재 사유를 구체적으로: 최대 대수에 걸렸거나, CTU 기준에서 에어백·충전재를 모두 꺼 아무것도 실을 수 없는 경우.
    const SPACE='공간 또는 지지 조건 부족';
    if(remaining.length&&loads.length>=MAX_CONTAINERS)remaining=remaining.map(u=>u.reason===SPACE?{...u,reason:`최대 컨테이너 수(${MAX_CONTAINERS}대)를 넘음`}:u);
    else if(remaining.length&&safetyKey==='secure'&&!securing.airbag&&!securing.filler&&loads.every(L=>!L.placed.length))remaining=remaining.map(u=>u.reason===SPACE?{...u,reason:'CTU 기준에서 에어백·충전재를 모두 끄면 화물 옆 틈을 막을 수 없음(에어백이나 충전재를 켜세요)'}:u);
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
