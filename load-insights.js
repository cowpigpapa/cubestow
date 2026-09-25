(function(root){
  function balance(load){
    const total=load?.placed?.reduce((sum,p)=>sum+Number(p.weight||0),0)||0,c=load?.container;
    if(!total||!c)return null;
    const cog=load.placed.reduce((a,p)=>({x:a.x+(p.x+p.l/2)*p.weight,y:a.y+(p.y+p.w/2)*p.weight,z:a.z+(p.z+p.h/2)*p.weight}),{x:0,y:0,z:0});
    cog.x/=total;cog.y/=total;cog.z/=total;
    const xOffset=(cog.x/c.l-.5)*100,yOffset=(cog.y/c.w-.5)*100,max=Math.max(Math.abs(xOffset),Math.abs(yOffset)),level=max<=5?'safe':max<=10?'caution':'danger';
    return{total,cog,xOffset,yOffset,level,door:(1-cog.x/c.l)*100,rear:cog.x/c.l*100,left:(1-cog.y/c.w)*100,right:cog.y/c.w*100};
  }
  // 컨테이너 자체중량(kg). 명시값이 없으면 ISO 건화물 컨테이너의 대표값으로 추정한다(20ft 2,230 · 40ft 3,750 · 40ft HC 3,940 · 45ft HC 4,800).
  // 최대 적재중량이 없는 가상 공간(테스트용 등)은 자체중량 0으로 보고 화물만으로 판정한다.
  function tareOf(c){
    if(Number.isFinite(c?.tare))return c.tare;
    if(!Number.isFinite(c?.maxWeight))return 0;
    return c.l<=6100?2230:c.l<=12200?(c.h>2500?3940:3750):4800;
  }
  // 편심 판정은 스프레더·차량이 실제로 드는 총중량(화물 + 컨테이너 자체중량) 기준이다. 자체중량은 컨테이너 가운데에 있다.
  // 무거운 적재는 화물 기준과 거의 같고, 가벼운 부분 적재는 자체중량이 무게중심을 가운데로 끌어 준다. 화물만의 값도 함께 돌려준다.
  function ctu(load){
    const b=balance(load),placed=load?.placed||[],c=load?.container;if(!b||!c)return null;
    const tare=tareOf(c),gross=b.total+tare,factor=b.total/gross,grossXOffset=b.xOffset*factor,grossYOffset=b.yOffset*factor;
    const half=c.l/2,starts=new Set([0,half]);placed.forEach(p=>{starts.add(Math.max(0,Math.min(half,p.x)));starts.add(Math.max(0,Math.min(half,p.x+p.l-half)))});
    const halfMass=Math.max(...[...starts].map(start=>placed.reduce((sum,p)=>sum+p.weight*Math.max(0,Math.min(start+half,p.x+p.l)-Math.max(start,p.x))/p.l,0))),cargoConcentration=halfMass/b.total*100,concentration=(halfMass+tare/2)/gross*100,vertical=b.cog.z/c.h*100,maxOffset=Math.max(Math.abs(grossXOffset),Math.abs(grossYOffset)),cargoMaxOffset=Math.max(Math.abs(b.xOffset),Math.abs(b.yOffset));
    const level=maxOffset>10||vertical>60?'danger':maxOffset>5||vertical>50||concentration>60?'caution':'safe';
    return{...b,tare,grossXOffset,grossYOffset,cargoConcentration,cargoMaxOffset,concentration,vertical,maxOffset,level,checks:{center:maxOffset<=5,centerLimit:maxOffset<=10,vertical:vertical<=50,concentration:concentration<=60}};
  }
  // CTU Code 참고 계산. 가속도 계수는 IMO MSC.1/Circ.1498 Informative Material 5, Quick Lashing Guide A·B·C 10.1.1/11.1.1/12.1.1.
  // c: 수평 가속도, v: 함께 쓰는 수직 가속도(1g 단위). 전후는 컨테이너 길이 방향, 차량 진행 방향은 안쪽 벽 쪽이다.
  const CTU_ACCELERATIONS={
    road:{label:'도로',side:{c:.5,v:1},forward:{c:.8,v:1},backward:{c:.5,v:1}},
    seaA:{label:'해상 A',side:{c:.5,v:1},forward:{c:.3,v:.5},backward:{c:.3,v:.5}},
    seaB:{label:'해상 B',side:{c:.7,v:1},forward:{c:.3,v:.3},backward:{c:.3,v:.3}},
    seaC:{label:'해상 C',side:{c:.8,v:1},forward:{c:.4,v:.2},backward:{c:.4,v:.2}}
  };
  // 재질 조합을 확인하지 못했을 때 쓰는 최대 허용 마찰계수(같은 문서 3.2).
  const CTU_DEFAULT_FRICTION=.3,TOL=2,G=9.81;
  const CTU_DIRECTIONS=[
    {key:'forward',label:'전방(안쪽 벽 쪽)',axis:'x',sign:1,acc:'forward'},
    {key:'backward',label:'후방(문 쪽)',axis:'x',sign:-1,acc:'backward'},
    {key:'left',label:'좌측',axis:'y',sign:-1,acc:'side'},
    {key:'right',label:'우측',axis:'y',sign:1,acc:'side'}
  ];
  // 화면 좌표(문 x=0) 기준. 벽이나, 벽까지 이어지는 화물에 면의 50% 이상 닿은 방향만 막힌 것으로 본다.
  // 문은 충격하중 방지 조건을 확인할 수 없으므로 doorBlocking을 명시하지 않으면 경계로 보지 않는다.
  function blockedDirections(placed,c,doorBlocking){
    const overlap=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0);
    const touches=(p,q,d)=>{
      if(overlap(p.z,p.z+p.h,q.z,q.z+q.h)<p.h*.5)return false;
      if(d.axis==='x')return Math.abs(d.sign>0?q.x-(p.x+p.l):p.x-(q.x+q.l))<=TOL&&overlap(p.y,p.y+p.w,q.y,q.y+q.w)>=p.w*.5;
      return Math.abs(d.sign>0?q.y-(p.y+p.w):p.y-(q.y+q.w))<=TOL&&overlap(p.x,p.x+p.l,q.x,q.x+q.l)>=p.l*.5;
    };
    const boundary=(p,d)=>d.axis==='x'?(d.sign>0?p.x+p.l>=c.l-TOL:doorBlocking&&p.x<=TOL):(d.sign>0?p.y+p.w>=c.w-TOL:p.y<=TOL);
    const blocked={},neighbours={};
    for(const d of CTU_DIRECTIONS){
      const list=neighbours[d.key]=placed.map(p=>placed.flatMap((q,j)=>q!==p&&touches(p,q,d)?[j]:[]));
      const done=blocked[d.key]=placed.map(p=>boundary(p,d));
      for(let changed=true;changed;){changed=false;list.forEach((near,i)=>{if(!done[i]&&near.some(j=>done[j])){done[i]=true;changed=true}})}
    }
    // 같은 줄에서 서로 기대는 화물 수. 여러 열이 함께 기울면 한 열보다 쉽게 넘어진다.
    const rows=axis=>{
      const [a,b]=axis==='x'?['forward','backward']:['left','right'],size=placed.map(()=>0);
      placed.forEach((p,start)=>{if(size[start])return;const group=[start],seen=new Set(group);for(let k=0;k<group.length;k++)for(const j of [...neighbours[a][group[k]],...neighbours[b][group[k]]])if(!seen.has(j)){seen.add(j);group.push(j)}group.forEach(i=>size[i]=group.length)});
      return size;
    };
    return{blocked,rows:{x:rows('x'),y:rows('y')}};
  }
  // 위에 얹힌 화물까지 포함한 적층 높이. 적층 전체가 한 덩어리로 넘어질 수 있으므로 전도는 이 높이로 본다.
  function stackHeights(placed){
    const top=placed.map(p=>p.z+p.h);
    [...placed.keys()].sort((a,b)=>placed[b].z-placed[a].z).forEach(i=>{const p=placed[i];placed.forEach((q,j)=>{
      if(Math.abs(q.z-(p.z+p.h))<TOL&&Math.min(p.x+p.l,q.x+q.l)>Math.max(p.x,q.x)&&Math.min(p.y+p.w,q.y+q.w)>Math.max(p.y,q.y))top[i]=Math.max(top[i],top[j]);
    })});
    return top.map((t,i)=>t-placed[i].z);
  }
  // 막히지 않은 방향의 미끄럼 억제력 m·g·(c − μ·v)와 전도를 계산한다. 무게중심은 화물 중앙으로 가정한다.
  // 전도 한계 H/B ≤ v/(c·n)은 같은 문서 전도 표의 열 수(1~5열)별 경계와 일치한다. 전후 방향 표는 구획 단위라
  // 같은 규칙을 보수적으로 적용한다. 래싱 수량·앵커 용량·벽 강도는 계산하지 않는다.
  function securing(load,options={}){
    const placed=load?.placed||[],c=load?.container;if(!c||!placed.length)return null;
    const sea=CTU_ACCELERATIONS[options.seaArea]?options.seaArea:'seaC',friction=Number.isFinite(options.friction)?options.friction:CTU_DEFAULT_FRICTION;
    const profiles=(options.mode==='road'?['road']:options.mode==='sea'?[sea]:['road',sea]).map(key=>CTU_ACCELERATIONS[key]);
    const {blocked,rows}=blockedDirections(placed,c,Boolean(options.doorBlocking)),heights=stackHeights(placed);
    const directions=CTU_DIRECTIONS.map(d=>({key:d.key,label:d.label,unblocked:0,forceKN:0,maxKN:0,tipping:0,worst:null}));
    placed.forEach((p,i)=>CTU_DIRECTIONS.forEach((d,k)=>{
      if(blocked[d.key][i])return;
      const summary=directions[k],base=d.axis==='x'?p.l:p.w,ratio=heights[i]/Math.max(1,base),n=rows[d.axis][i];
      let force=0,tip=null;
      for(const profile of profiles){
        const a=profile[d.acc];force=Math.max(force,p.weight*G*Math.max(0,a.c-friction*a.v)/1000);
        const limit=a.v/(a.c*n);if(ratio>limit+1e-9&&(!tip||ratio/limit>tip.ratio/tip.limit))tip={product:p.name,ratio,limit,rows:n,profile:profile.label};
      }
      summary.unblocked++;summary.forceKN+=force;summary.maxKN=Math.max(summary.maxKN,force);
      if(tip){summary.tipping++;if(!summary.worst||tip.ratio/tip.limit>summary.worst.ratio/summary.worst.limit)summary.worst=tip}
    }));
    return{friction,profiles:profiles.map(p=>p.label),doorBlocking:Boolean(options.doorBlocking),directions,needsRestraint:directions.some(d=>d.forceKN>0||d.tipping>0)};
  }
  root.LoadwiseInsights={balance,ctu,tareOf,securing,CTU_ACCELERATIONS};
})(globalThis);
