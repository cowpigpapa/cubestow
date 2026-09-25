(function(root){
  const overlap=(a,b)=>a.x<b.x+b.l&&a.x+a.l>b.x&&a.y<b.y+b.w&&a.y+a.w>b.y&&a.z<b.z+b.h&&a.z+a.h>b.z;
  const footprintOverlap=(a,b)=>Math.max(0,Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y));
  const hull=points=>{const sorted=[...new Map(points.map(p=>[`${p.x}:${p.y}`,p])).values()].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);if(sorted.length<3)return sorted;const lower=[],upper=[];for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}for(const p of [...sorted].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}return lower.slice(0,-1).concat(upper.slice(0,-1))};
  const inside=(point,polygon)=>{if(polygon.length<3)return polygon.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<2);let sign=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);if(Math.abs(cross)<1e-6)continue;const next=Math.sign(cross);if(sign&&next!==sign)return false;sign=next}return true};
  // 직사각형들이 [a0,a1]×[b0,b1] 영역을 덮는 넓이(합집합).
  const coveredArea=(rects,a0,a1,b0,b1)=>{
    const clipped=rects.map(([p0,p1,q0,q1])=>[Math.max(a0,p0),Math.min(a1,p1),Math.max(b0,q0),Math.min(b1,q1)]).filter(([p0,p1,q0,q1])=>p1>p0&&q1>q0),cuts=[...new Set(clipped.flatMap(r=>[r[0],r[1]]))].sort((a,b)=>a-b);let area=0;
    for(let i=0;i+1<cuts.length;i++){const m=(cuts[i]+cuts[i+1])/2,spans=clipped.filter(r=>r[0]<=m&&r[1]>=m).map(r=>[r[2],r[3]]).sort((a,b)=>a[0]-b[0]);let len=0,end=-Infinity;for(const [q0,q1] of spans){const from=Math.max(q0,end);if(q1>from){len+=q1-from;end=q1}}area+=len*(cuts[i+1]-cuts[i])}
    return area;
  };
  // 최고 안전 기준: 문쪽을 뺀 안쪽·좌·우 면이 막혔는지(화면 좌표: 문 x=0, 안쪽 벽 x=l).
  // 막힘 = 벽 접촉, 또는 600mm 이내 이웃 화물 면이 그 면 면적의 50% 이상을 덮음(에어백 간극 포함). 좌·우는 벽까지 사이에 화물이 없으면 벽 간극을 막는다.
  const BLOCK_GAP=600;
  function openSides(p,placed,c){
    const back=[],left=[],right=[];let leftClear=true,rightClear=true;
    for(const q of placed){
      if(q===p||q.z+q.h<=p.z+2||q.z>=p.z+p.h-2)continue;
      const gapBack=q.x-(p.x+p.l);
      if(gapBack>=-2&&gapBack<=BLOCK_GAP&&q.y+q.w>p.y&&q.y<p.y+p.w)back.push([q.y,q.y+q.w,q.z,q.z+q.h]);
      if(q.x+q.l>p.x+2&&q.x<p.x+p.l-2){
        const gapLeft=p.y-(q.y+q.w),gapRight=q.y-(p.y+p.w);
        if(gapLeft>=-2){leftClear=false;if(gapLeft<=BLOCK_GAP)left.push([q.x,q.x+q.l,q.z,q.z+q.h])}
        if(gapRight>=-2){rightClear=false;if(gapRight<=BLOCK_GAP)right.push([q.x,q.x+q.l,q.z,q.z+q.h])}
      }
    }
    const half=(rects,a0,a1)=>coveredArea(rects,a0,a1,p.z,p.z+p.h)>=(a1-a0)*p.h*.5-1,open=[];
    if(!(p.x+p.l>=c.l-2||half(back,p.y,p.y+p.w)))open.push('안쪽');
    // 벽까지 비어 있으면 바닥 화물은 충전재(세운 팔레트·골판지)와 에어백으로, 높은 곳 화물은 에어백 한계(600mm) 안에서만 막을 수 있다.
    const wallOk=gap=>p.z<=2||gap<=BLOCK_GAP;
    if(!(p.y<=2||leftClear&&wallOk(p.y)||half(left,p.x,p.x+p.l)))open.push('좌');
    if(!(p.y+p.w>=c.w-2||rightClear&&wallOk(c.w-p.y-p.w)||half(right,p.x,p.x+p.l)))open.push('우');
    return open;
  }
  function validateLoad(load,options={}){
    const errors=[],c=load?.container,placed=load?.placed||[];
    if(!c)return{valid:false,errors:['컨테이너 정보 없음']};
    placed.forEach((p,i)=>{
      if([p.x,p.y,p.z,p.l,p.w,p.h,p.weight].some(v=>!Number.isFinite(v))||p.l<=0||p.w<=0||p.h<=0||p.weight<0)errors.push(`${i+1}번 화물의 좌표·크기·중량 오류`);
      if(p.x<0||p.y<0||p.z<0||p.x+p.l>c.l||p.y+p.w>c.w||p.z+p.h>c.h)errors.push(`${i+1}번 화물 경계 이탈`);
      if(p.z>0){
        const supports=placed.filter((q,j)=>j!==i&&Math.abs(q.z+q.h-p.z)<2),area=supports.reduce((sum,q)=>sum+footprintOverlap(p,q),0);
        if(area+1e-6<p.l*p.w*(options.minSupport??1))errors.push(`${i+1}번 화물 지지면 부족`);
        const cx=p.x+p.l/2,cy=p.y+p.w/2;
        if(!supports.some(q=>cx>=q.x-2&&cx<=q.x+q.l+2&&cy>=q.y-2&&cy<=q.y+q.w+2))errors.push(`${i+1}번 화물 중심이 지지면 밖에 있음`);
        // 같은 높이의 화물 중 실제로 바닥면이 겹치는 화물만 받침이다(멀리 떨어진 같은 높이의 상부적재금지 화물은 무관).
        if(supports.some(q=>q.fragile&&footprintOverlap(p,q)>0))errors.push(`${i+1}번 화물이 상부적재금지 화물 위에 배치됨`);
        // 엄격 기준: 원통은 바닥이나 원통 위에만 둔다.
        if(options.cylinderOnFloor&&p.shape==='cylinder'&&supports.some(q=>q.shape!=='cylinder'&&footprintOverlap(p,q)>0))errors.push(`${i+1}번 원통 화물이 상자 위에 배치됨`);
      }
    });
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)if(overlap(placed[i],placed[j]))errors.push(`${i+1}번과 ${j+1}번 화물 충돌`);
    // 누적 높이가 바닥 최소 치수의 1.5배를 넘는 화물은 최종 적재 상태에서 2면 이상 측면 지지가 필요하다(화면 좌표: 문 x=0, 안쪽 벽 x=l).
    // 한 면은 벽(안쪽·좌·우, 문은 제외)이거나, 면 폭의 50% 이상 맞닿은 화물들의 높이 구간 합집합이 면 높이의 50% 이상일 때 지지된다.
    placed.forEach((p,i)=>{
      if((p.z+p.h)/Math.max(1,Math.min(p.l,p.w))<=1.5)return;
      const walls={back:p.x+p.l>=c.l-2,front:false,left:p.y<=2,right:p.y+p.w>=c.w-2},spans={back:[],front:[],left:[],right:[]};
      placed.forEach((q,j)=>{
        if(j===i)return;
        const from=Math.max(p.z,q.z),to=Math.min(p.z+p.h,q.z+q.h);if(to-from<=2)return;
        if(Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y)>=p.w*.5){if(Math.abs(q.x-(p.x+p.l))<=2)spans.back.push([from,to]);else if(Math.abs(q.x+q.l-p.x)<=2)spans.front.push([from,to])}
        if(Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x)>=p.l*.5){if(Math.abs(q.y+q.w-p.y)<=2)spans.left.push([from,to]);else if(Math.abs(q.y-(p.y+p.w))<=2)spans.right.push([from,to])}
      });
      const cover=list=>{list.sort((a,b)=>a[0]-b[0]);let sum=0,end=p.z;for(const [a,b] of list){const f=Math.max(a,end),t=Math.min(b,p.z+p.h);if(t>f){sum+=t-f;end=t}}return sum};
      const count=Object.keys(walls).filter(k=>walls[k]||cover(spans[k])>=p.h*.5).length;
      if(count<2)errors.push(`${i+1}번 화물 측면 지지 부족(${count}/2면)`);
    });
    if(options.blockSides)placed.forEach((p,i)=>{const open=openSides(p,placed,c);if(open.length)errors.push(`${i+1}번 화물 ${open.join('·')} 면이 막히지 않음(최고 안전)`)});
    const loads=placed.map(p=>({weight:p.weight,mx:(p.x+p.l/2)*p.weight,my:(p.y+p.w/2)*p.weight}));
    [...placed.keys()].sort((a,b)=>placed[b].z-placed[a].z).forEach(i=>{const p=placed[i];if(p.z<=0)return;const supports=placed.map((q,j)=>({q,j,area:Math.abs(q.z+q.h-p.z)<2?footprintOverlap(p,q):0})).filter(v=>v.j!==i&&v.area>0),total=supports.reduce((sum,v)=>sum+v.area,0),points=supports.flatMap(({q})=>{const x0=Math.max(p.x,q.x),x1=Math.min(p.x+p.l,q.x+q.l),y0=Math.max(p.y,q.y),y1=Math.min(p.y+p.w,q.y+q.w);return[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]});
      if(points.length&&!inside({x:loads[i].mx/loads[i].weight,y:loads[i].my/loads[i].weight},hull(points)))errors.push(`${i+1}번 화물 스택의 합성 무게중심이 지지영역 밖에 있음`);
      supports.forEach(({j,area})=>{const share=area/Math.max(1,total);loads[j].weight+=loads[i].weight*share;loads[j].mx+=loads[i].mx*share;loads[j].my+=loads[i].my*share})
    });
    const compression=placed.map((p,i)=>({topLoad:Math.max(0,loads[i].weight-p.weight),limit:Number.isFinite(p.maxTopLoadKg)?p.maxTopLoadKg:null}));compression.forEach((v,i)=>{if(v.limit!=null&&v.topLoad>v.limit+1e-6)errors.push(`${i+1}번 화물 상부 허용하중 초과: ${Math.round(v.topLoad)}kg / ${v.limit}kg`)});
    const weight=placed.reduce((sum,p)=>sum+p.weight,0);
    if(weight>c.maxWeight+1e-6)errors.push(`허용중량 초과: ${weight}kg / ${c.maxWeight}kg`);
    return{valid:!errors.length,errors:[...new Set(errors)],metrics:{placed:placed.length,weight,compressionVerified:compression.filter(v=>v.limit!=null).length,compressionUnverified:compression.filter(v=>v.limit==null).length,maxTopLoad:compression.reduce((m,v)=>Math.max(m,v.topLoad),0)}};
  }
  function validateShipment(shipment){
    const loads=shipment?.containers||[],strict=!(shipment?.safety==='standard'||shipment?.priority==='volume'),options={minSupport:strict?1:.7,cylinderOnFloor:strict,blockSides:shipment?.safety==='secure'},results=loads.map(load=>validateLoad(load,options)),loaded=loads.reduce((sum,l)=>sum+(l.placed?.length||0),0),unallocated=shipment?.unallocated?.length||0,errors=results.flatMap((r,i)=>r.errors.map(e=>`${i+1}번 컨테이너: ${e}`));
    if(Number.isFinite(shipment?.totalUnits)&&loaded+unallocated!==shipment.totalUnits)errors.push(`수량 불일치: 적재 ${loaded} + 미배치 ${unallocated} ≠ 입력 ${shipment.totalUnits}`);
    return{valid:!errors.length,errors,metrics:{loaded,unallocated,containers:loads.length}};
  }
  root.LoadwiseValidator={validateLoad,validateShipment};
})(typeof window!=='undefined'?window:globalThis);
