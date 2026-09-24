(function(root){
  const overlap=(a,b)=>a.x<b.x+b.l&&a.x+a.l>b.x&&a.y<b.y+b.w&&a.y+a.w>b.y&&a.z<b.z+b.h&&a.z+a.h>b.z;
  const footprintOverlap=(a,b)=>Math.max(0,Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y));
  const hull=points=>{const sorted=[...new Map(points.map(p=>[`${p.x}:${p.y}`,p])).values()].sort((a,b)=>a.x-b.x||a.y-b.y),cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);if(sorted.length<3)return sorted;const lower=[],upper=[];for(const p of sorted){while(lower.length>1&&cross(lower.at(-2),lower.at(-1),p)<=0)lower.pop();lower.push(p)}for(const p of [...sorted].reverse()){while(upper.length>1&&cross(upper.at(-2),upper.at(-1),p)<=0)upper.pop();upper.push(p)}return lower.slice(0,-1).concat(upper.slice(0,-1))};
  const inside=(point,polygon)=>{if(polygon.length<3)return polygon.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<2);let sign=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);if(Math.abs(cross)<1e-6)continue;const next=Math.sign(cross);if(sign&&next!==sign)return false;sign=next}return true};
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
        if(supports.some(q=>q.fragile))errors.push(`${i+1}번 화물이 상부적재금지 화물 위에 배치됨`);
      }
    });
    for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)if(overlap(placed[i],placed[j]))errors.push(`${i+1}번과 ${j+1}번 화물 충돌`);
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
    const loads=shipment?.containers||[],options={minSupport:shipment?.safety==='standard'||shipment?.priority==='volume'?.7:1},results=loads.map(load=>validateLoad(load,options)),loaded=loads.reduce((sum,l)=>sum+(l.placed?.length||0),0),unallocated=shipment?.unallocated?.length||0,errors=results.flatMap((r,i)=>r.errors.map(e=>`${i+1}번 컨테이너: ${e}`));
    if(Number.isFinite(shipment?.totalUnits)&&loaded+unallocated!==shipment.totalUnits)errors.push(`수량 불일치: 적재 ${loaded} + 미배치 ${unallocated} ≠ 입력 ${shipment.totalUnits}`);
    return{valid:!errors.length,errors,metrics:{loaded,unallocated,containers:loads.length}};
  }
  root.LoadwiseValidator={validateLoad,validateShipment};
})(typeof window!=='undefined'?window:globalThis);
