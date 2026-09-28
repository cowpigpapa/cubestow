// 자료실(#library): CTU Code 등 공식 원문 링크, Cubestow가 직접 쓴 한국어 해설, 참고 자료.
// 원문 파일은 다시 올리지 않는다(CTU Code 저작권: IMO, 사전 서면 허가 없이 복제 금지). 공식 무료 링크만 건다.
// 해설은 Cubestow가 작성한 요약이며 IMO·ILO·UNECE가 만들거나 검토한 것이 아니다. 주소 #library/<id>로 해설 하나를 연다.
(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const IMO='https://wwwcdn.imo.org/localresources/en/OurWork/Safety/Documents/';
  const OFFICIAL=[
    {title:'CTU Code 본문 (MSC.1/Circ.1497)',org:'IMO · ILO · UNECE',date:'2014-12-16',lang:'영어 PDF',url:IMO+'1497.pdf',note:'화물운송단위(컨테이너·트레일러 등) 적입 실무규칙. 13장과 부속서 10개. 강제 규정은 아닌 국제 실무 기준입니다.'},
    {title:'CTU Code 정보자료 (MSC.1/Circ.1498)',org:'IMO · ILO · UNECE',date:'2014-12-16',lang:'영어 PDF',url:IMO+'1498.pdf',note:'Code를 보충하는 참고자료 IM1~IM10. IM5 빠른 래싱 가이드(래싱 수량 표), IM6 복합운송 하중 분포가 들어 있습니다.'},
    {title:'CTU 서비스 제공자 실사 체크리스트 (MSC.1/Circ.1531)',org:'IMO',date:'',lang:'영어 PDF',url:IMO+'MSC.1-CIRC.1531%20(E).pdf',note:'적입·포장 업체를 고를 때 확인할 항목.'},
    {title:'IMO CTU Code 소개 페이지',org:'IMO',date:'',lang:'영어 웹',url:'https://www.imo.org/en/ourwork/safety/pages/ctu-code.aspx',note:'위 문서들의 공식 배포 위치.'},
    {title:'ISO 1496-1 일반 화물 컨테이너 사양·시험',org:'ISO',date:'2013',lang:'유료 표준',url:'https://www.iso.org/standard/59672.html',note:'컨테이너 바닥 고정점(최소 1,000daN)과 래싱 고리(최소 500daN) 등 구조 기준. 원문은 ISO에서 구매합니다.'}
  ];
  const REFERENCES=[
    {title:'CTU Code Quick Lashing Guide (MariTerm 배포본)',url:'https://www.mariterm.se/wp-content/uploads/2016/12/CTU-Code-Quick-Lashing-Guide-dec-2014.pdf',note:'IM5 빠른 래싱 가이드만 따로 묶은 PDF.'},
    {title:'Quick Lashing Guide (IMO Rules)',url:'https://www.imorules.com/GUID-BF41A810-6C00-463E-AFD0-FBB4C03B506E.html',note:'빠른 래싱 가이드 웹 버전.'},
    {title:'Understanding container securing points strength',url:'https://www.linkedin.com/pulse/understanding-container-securing-points-strength-astrid-groeneveld',note:'컨테이너 고정점 허용하중과 "가장 약한 곳이 한계" 원칙.'},
    {title:'컨테이너 운송 중량 제한 규정(과적 기준)',url:'https://amcokorea.com/%EC%BB%A8%ED%85%8C%EC%9D%B4%EB%84%88-%EC%9A%B4%EC%86%A1/',note:'국내 도로 총중량·축하중 기준 정리(포워딩 실무).'},
    {title:'국내 컨테이너 차량 허용 적재 중량 기준 총정리',url:'https://today-knowlog.com/95',note:'트랙터·샤시·컨테이너 자중과 적재 가능 중량 예시.'}
  ];
  const note='<p class="lib-disclaimer">이 해설은 Cubestow가 원문을 읽고 직접 쓴 요약입니다. IMO·ILO·UNECE가 만들거나 검토한 것이 아니며, 판단은 공식 원문을 기준으로 하세요.</p>';
  const DOCS=[
    {id:'ctu-overview',title:'CTU Code 한눈에 보기',tag:'개요',summary:'무엇을 다루는 문서인지, 장·부속서 구성과 Cubestow에 반영된 곳.',body:`
      <p>CTU Code(IMO/ILO/UNECE Code of Practice for Packing of Cargo Transport Units)는 컨테이너·트레일러·철도화차 같은 화물운송단위(CTU)에 화물을 싣고 고정하는 국제 실무규칙입니다. 2014년 IMO 해사안전위원회가 승인해 MSC.1/Circ.1497로 발행했고, 법적 강제 규정은 아니지만 선사·보험·검사 기관이 기준으로 씁니다. 짐을 싣는 사람이 컨테이너 안을 마지막으로 보는 사람이므로, 운송 사슬 전체의 안전이 적입 품질에 달려 있다는 것이 출발점입니다.</p>
      <h3>본문 13장</h3>
      <table class="lib-table"><thead><tr><th>장</th><th>내용</th><th>Cubestow</th></tr></thead><tbody>
      <tr><td>1 소개</td><td>적용 범위, 안전·보안, 사용법, 관련 표준</td><td>—</td></tr>
      <tr><td>2 정의</td><td>CTU, 적입자(packer), 화주 등 용어</td><td>—</td></tr>
      <tr><td>3 핵심 요구사항</td><td>계획·적입·위험물·고정·완료·하역의 핵심 원칙</td><td>전체 설계 기준</td></tr>
      <tr><td>4 책임과 정보 흐름</td><td>화주·적입자·운송인 사이 책임과 전달할 정보</td><td>—</td></tr>
      <tr><td>5 일반 운송 조건</td><td>운송 중 힘과 모드별 가속도 계수, 기후</td><td>가속도 표(도로·복합·해상)</td></tr>
      <tr><td>6 CTU 특성</td><td>컨테이너·스왑바디·트레일러·화차의 구조와 강도</td><td>컨테이너 치수·최대중량</td></tr>
      <tr><td>7 CTU 적합성</td><td>화물과 운송 모드에 맞는 CTU 고르기</td><td>—</td></tr>
      <tr><td>8 도착·점검·위치</td><td>받은 CTU 점검과 적입 위치 잡기</td><td>—</td></tr>
      <tr><td>9 화물 적입</td><td>적입 계획과 CTU 안 고정</td><td>배치·고정재 계획</td></tr>
      <tr><td>10 위험물 적입</td><td>위험물 추가 주의사항</td><td>계산하지 않음</td></tr>
      <tr><td>11 적입 완료 후</td><td>문 닫기, 표시·표찰, 서류</td><td>—</td></tr>
      <tr><td>12 수령·하역</td><td>받는 쪽의 개문·하역 주의</td><td>—</td></tr>
      <tr><td>13 교육</td><td>적입 작업자 교육</td><td>—</td></tr>
      </tbody></table>
      <h3>부속서 10개</h3>
      <table class="lib-table"><thead><tr><th>부속서</th><th>내용</th><th>Cubestow</th></tr></thead><tbody>
      <tr><td>1</td><td>정보 흐름</td><td>—</td></tr>
      <tr><td>2</td><td>CTU 안전 취급(인양·이송·고박)</td><td>—</td></tr>
      <tr><td>3</td><td>결로 손상 방지</td><td>—</td></tr>
      <tr><td>4</td><td>승인 명판(CSC 명판, 총중량·자중·적재 하중)</td><td>—</td></tr>
      <tr><td>5</td><td>CTU 받기(가스 측정, 안전한 개문)</td><td>—</td></tr>
      <tr><td>6</td><td>해충 재오염 최소화</td><td>—</td></tr>
      <tr><td><b>7</b></td><td><b>화물 적입과 고정</b>: 적입 계획, 더니지·마찰, 하중 분포, 블로킹·래싱, 고정 평가. 부록 1 포장 표시, 2 마찰계수 표, 3 마찰계수 측정, 4 고정 계산(가로 받침목, 무게중심 위치), 5 경사 시험</td><td>핵심 기준(빈 공간 15cm, 못, 마찰, 래싱)</td></tr>
      <tr><td>8</td><td>탱크·벌크 상부 접근, 고소 작업</td><td>—</td></tr>
      <tr><td>9</td><td>훈증</td><td>—</td></tr>
      <tr><td>10</td><td>교육 프로그램 주제</td><td>—</td></tr>
      </tbody></table>
      <h3>정보자료 IM1~IM10 (MSC.1/Circ.1498, Code의 일부는 아님)</h3>
      <p>IM1 부적절한 적입의 결과 · IM2 운송 서류 · IM3 CTU 종류 · IM4 재오염 우려 생물 · <b>IM5 빠른 래싱 가이드</b>(Cubestow 래싱 수량 기준) · <b>IM6 복합운송 하중 분포</b>(축하중·무게중심 위치 검토에 쓰임) · IM7 수작업 취급 · IM8 신선 화물 · IM9 CTU 봉인 · IM10 유해가스 시험.</p>
      ${note}`},
    {id:'qlg-c',title:'빠른 래싱 가이드 C — Cubestow가 쓰는 표',tag:'IM5',summary:'도로·복합철도·해상 C 가속도, 마찰계수, 래싱 1줄이 막는 질량과 환산 방법.',body:`
      <p>빠른 래싱 가이드(IM5)는 래싱 몇 줄이 필요한지 표로 바로 찾게 만든 자료입니다. 운송 조건에 따라 A·B·C 세 가이드가 있고, Cubestow는 <b>도로·복합철도·해상 C</b>를 함께 다루는 가이드 C(§12)를 씁니다. 해상 C는 가장 거친 해역입니다.</p>
      <h3>가속도 계수 (중력 가속도 g의 배수)</h3>
      <table class="lib-table"><thead><tr><th>운송</th><th>옆(S) / 수직</th><th>앞(F) / 수직</th><th>뒤(B) / 수직</th></tr></thead><tbody>
      <tr><td>도로</td><td>0.5 / 1.0</td><td>0.8 / 1.0</td><td>0.5 / 1.0</td></tr>
      <tr><td>복합 철도</td><td>0.5 / 1.0</td><td>0.5 / 1.0</td><td>0.5 / 1.0</td></tr>
      <tr><td>해상 C</td><td>0.8 / 1.0</td><td>0.4 / 0.2</td><td>0.4 / 0.2</td></tr>
      </tbody></table>
      <h3>마찰계수 μ (§3.1, 바닥이 합판인 경우 중심)</h3>
      <table class="lib-table"><thead><tr><th>화물 밑면 → 바닥</th><th>μ</th></tr></thead><tbody>
      <tr><td>목재 팔레트·각재 → 합판</td><td>0.45</td></tr><tr><td>대패질 목재 → 합판</td><td>0.3</td></tr><tr><td>플라스틱 팔레트 → 합판</td><td>0.2</td></tr>
      <tr><td>철제 크레이트 → 합판</td><td>0.45</td></tr><tr><td>골판지 → 골판지</td><td>0.5</td></tr><tr><td>고무 미끄럼 방지재(깨끗한 면)</td><td>0.6</td></tr>
      <tr><td>조합이 표에 없거나 확인 못 함 · 깨끗하지 않은 바닥</td><td>최대 0.3</td></tr><tr><td>서리·얼음</td><td>0.2</td></tr><tr><td>기름기·슬립시트</td><td>0.1</td></tr>
      </tbody></table>
      <h3>래싱 1줄이 미끄럼을 막는 화물 질량 (웨빙 MSL 2,000daN, 사전장력 400daN)</h3>
      <table class="lib-table"><thead><tr><th>μ</th><th>스프링 래싱 1줄 · 앞</th><th>하프루프 한 쌍 · 옆</th></tr></thead><tbody>
      <tr><td>0.1</td><td>4.3t</td><td>3.0t</td></tr><tr><td>0.2</td><td>5.1t</td><td>3.6t</td></tr><tr><td><b>0.3</b></td><td><b>6.1t</b></td><td><b>4.3t</b></td></tr>
      <tr><td>0.45</td><td>8.3t</td><td>5.9t</td></tr><tr><td>0.6</td><td>12t</td><td>8.4t</td></tr>
      </tbody></table>
      <p>표 값은 래싱의 MSL에 비례합니다(§6). 예: MSL 4,000daN 웨빙이면 표 값 × 2. 단, <b>래싱 고정점(아이)은 래싱과 같은 MSL 이상</b>이어야 합니다(§5.3). 한 고정점에 하프루프 양 끝을 모두 걸면 고정점은 래싱 MSL의 1.4배 이상이어야 합니다.</p>
      <h3>Cubestow 적용</h3>
      <p>고정 조건에서 고른 마찰로 표를 보간하고, 래싱 줄 수 = 막을 질량 ÷ (표 값 × min(래싱 MSL, 고정점 허용하중) ÷ 2,000)으로 계산합니다. 못 수와 방향별 억제력은 가속도 c와 마찰 μ로 m·g·(c − μ·v)를 씁니다.</p>
      ${note}`},
    {id:'anchor-points',title:'컨테이너 래싱 고정점 허용하중',tag:'ISO 1496-1',summary:'바닥 고정점 1,000daN, 위쪽 래싱 고리 500daN — 래싱은 가장 약한 곳까지만 믿는다.',body:`
      <p>ISO 1496-1(일반 화물 컨테이너)은 컨테이너 안 고정점의 <b>최소</b> 허용하중을 정합니다. 바닥·하부 레일의 고정점(anchor point)은 어느 방향이든 1,000daN(약 1톤) 이상, 위쪽 측벽·상부 레일의 래싱 고리(lashing point)는 500daN 이상입니다. 실제 컨테이너는 이보다 강한 경우가 많지만, 표시(명판·고리 각인)로 확인하지 않으면 최소값만 믿어야 합니다.</p>
      <p>빠른 래싱 가이드 §5.3은 래싱 고정점이 래싱과 같은 MSL 이상이어야 한다고 합니다. 2,000daN 웨빙을 500daN 고리에 걸면 실제로 쓸 수 있는 힘은 500daN이므로, 같은 화물을 막으려면 줄 수가 4배 필요합니다.</p>
      <h3>Cubestow 설정 (1.1.79~)</h3>
      <ul><li>고정 조건 → 컨테이너 래싱 고정점 "확인 안 함"(기본): 바닥 1,000daN, 컨테이너 높이 절반 위의 고리 500daN까지만 래싱에 맡깁니다.</li><li>"표시 확인": 고정점이 래싱 MSL 이상이라고 보고 래싱 MSL로 계산합니다.</li><li>고정점 때문에 줄 수를 늘리면 고정재 권고에 "계산 기준 · 래싱 고정점" 안내가 붙습니다.</li></ul>
      ${note}`},
    {id:'kr-road',title:'한국 도로 운송 중량 한도',tag:'도로법',summary:'총중량 40t·축하중 10t과 20ft 21t·40ft 25t 적재 한도의 관계, 축하중을 계산하지 않는 이유.',body:`
      <p>국내 도로법 기준 차량 총중량은 40t, 축하중은 10t입니다. 컨테이너 트레일러의 총중량에는 트랙터(약 9t)·샤시(약 5t)·컨테이너 자중(20ft 약 2t, 40ft 약 4t)이 포함되므로, 실제 실을 수 있는 화물은 이보다 훨씬 적습니다. 한국무역협회 안내 등 실무에서는 20ft 21t 미만, 40ft 25t 미만을 도로 운송 한도로 봅니다.</p>
      <h3>Cubestow 설정</h3>
      <ul><li>컨테이너 목록의 "한국 도로 한도" 항목은 최대 적재중량을 20ft 21t, 40ft·40HC·45HC 25t로 낮춘 것입니다. 이 값으로 대수를 나눕니다.</li><li>축하중은 계산하지 않습니다. 축하중은 화물 무게중심 위치와 트랙터·샤시의 축 위치(킹핀에서 뒤 축까지 거리 등), 자중 분포에 따라 달라지기 때문입니다. CTU Code 부속서 7 부록 4 §3(화물 무게중심의 길이 방향 위치)과 정보자료 IM6(복합운송 하중 분포)이 이 계산을 다룹니다.</li><li>사용하는 트랙터·샤시 제원을 알면 축하중 추정을 추가할 수 있습니다.</li></ul>
      ${note}`}
  ];
  // 한국어 해설 진행표(장기 작업). done이면 위 DOCS에 있다.
  const PLAN=[
    ['CTU Code 개요(장·부속서 구성)','done','ctu-overview'],['빠른 래싱 가이드 C 핵심 표(IM5 §12)','done','qlg-c'],['컨테이너 래싱 고정점(ISO 1496-1)','done','anchor-points'],['한국 도로 중량 한도','done','kr-road'],
    ['3장 핵심 요구사항','planned'],['5장 일반 운송 조건(가속도)','planned'],['9장 화물 적입','planned'],['부속서 7 §1~2 적입 계획·더니지·마찰','planned'],['부속서 7 §3 하중 분포','planned'],['부속서 7 §4 화물 고정·고정 평가','planned'],['부속서 7 부록 4 고정 계산','planned'],['IM6 복합운송 하중 분포','planned'],['부속서 4 승인 명판(CSC)','planned'],['부속서 5 CTU 받기·안전한 개문','planned'],['11장 적입 완료 후','planned']
  ];
  const card=o=>`<a class="lib-card" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(o.title)}</b><span class="lib-meta">${[o.org,o.date,o.lang].filter(Boolean).map(esc).join(' · ')}</span><span>${esc(o.note)}</span><span class="lib-open">원문 열기 ↗</span></a>`;
  function renderList(view){
    view.innerHTML=`<div class="lib-head"><h2>자료실</h2><p>컨테이너 적입·고정 기준 자료입니다. 공식 원문은 배포처 링크로 열고, Cubestow가 쓴 한국어 해설은 이 안에서 읽을 수 있습니다.</p></div>
      <section class="lib-section"><h3>한국어 해설 <small>Cubestow 작성</small></h3><div class="lib-docs">${DOCS.map(d=>`<a class="lib-doc" href="#library/${d.id}"><span class="lib-tag">${esc(d.tag)}</span><b>${esc(d.title)}</b><span>${esc(d.summary)}</span></a>`).join('')}</div></section>
      <section class="lib-section"><h3>공식 원문 <small>무료 공개, 배포처 링크</small></h3><div class="lib-cards">${OFFICIAL.map(card).join('')}</div>
        <p class="lib-disclaimer">CTU Code와 정보자료의 저작권은 IMO에 있으며 사전 서면 허가 없이 복제할 수 없습니다. 그래서 파일을 이곳에 다시 올리지 않고 IMO 공식 배포 링크를 겁니다. 전체 한국어 번역본 게시는 IMO 허가를 받은 뒤에 진행합니다.</p></section>
      <section class="lib-section"><h3>한국어 해설 진행</h3><ol class="lib-plan">${PLAN.map(([t,s,id])=>`<li data-state="${s}">${s==='done'?`<a href="#library/${id}">${esc(t)}</a>`:esc(t)}<span>${s==='done'?'완료':'예정'}</span></li>`).join('')}</ol></section>
      <section class="lib-section"><h3>참고 자료</h3><div class="lib-cards">${REFERENCES.map(card).join('')}</div></section>`;
  }
  function renderDoc(view,doc){
    view.innerHTML=`<nav class="lib-crumb"><a href="#library">← 자료실</a></nav><article class="lib-article"><span class="lib-tag">${esc(doc.tag)}</span><h2>${esc(doc.title)}</h2>${doc.body}</article>`;
  }
  function show(){
    const view=document.getElementById('libraryView');if(!view)return;
    const id=location.hash.split('/')[1],doc=DOCS.find(d=>d.id===id);
    if(doc)renderDoc(view,doc);else renderList(view);
  }
  document.addEventListener('cubestow:view',e=>{if(e.detail==='#library')show()});
  window.CUBESTOW_LIBRARY={docs:DOCS.map(d=>d.id),official:OFFICIAL.length,plan:PLAN.length};
})();
