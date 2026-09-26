const CONTAINERS = {
  '20ft': { name:'20ft Dry', l:5898, w:2352, h:2393, maxWeight:28200 },
  '40ft': { name:'40ft Dry', l:12032, w:2352, h:2393, maxWeight:26700 },
  '40hc': { name:'40ft High Cube', l:12032, w:2352, h:2698, maxWeight:26500 },
  '45hc': { name:'45ft High Cube', l:13556, w:2352, h:2698, maxWeight:27600 }
};
const COLORS = ['#16734f','#ff8a4c','#5a87ff','#c28b38','#8c6ad8','#e15d71','#43a6a1'];
const TRANSPORT_PROFILES=LoadwiseEngine.TRANSPORT_PROFILES;
const shipmentMinSupport=()=>LoadwiseEngine.SAFETY_LEVELS[shipment?.safety]?.minSupport??1;
const strategyLabel=(safety,preference)=>`${LoadwiseEngine.SAFETY_LEVELS[safety]?.label||'엄격'} 기준 · ${LoadwiseEngine.PREFERENCES[preference]?.label||'자동 추천'}`;
const currentTransportMode=()=>typeof document==='undefined'?'combined':$('transportMode')?.value||'combined';
let products = [];
let result = null;
let shipment = null;
let fieldResult = null;
let activeContainer = 0;
let camera = { yaw:-2.51, pitch:0.42, zoom:1 };
let viewMode = 'iso';
let visibleStep = 0;
let playTimer = null;
let threeView = null;
let showDunnage = true;
// 사용할 고정재. 끈 고정재는 권고에서 다른 방법으로 대신한다.
let securingOptions={airbag:true,filler:true,nails:true,lashing:true};
const SECURING_OPTION_LABELS={airbag:'에어백',filler:'충전재',nails:'바닥 못',lashing:'래싱'};
let showAirbags = true;
let showCog = false;
let showAxes = true;
let simulationRunning = false,engineWorker=null,engineJob=0;
// 입력이 바뀔 때마다 올라가는 번호. 계산이 끝났을 때 번호가 다르면 그 결과는 이미 낡은 것이라 버린다.
let inputVersion=0,pendingRun=false,resultStale=false;
const $ = id => document.getElementById(id);
let messageResolver=null;
function showAppMessage(message,{title='안내',tone='info',confirmAction=false,actionLabel='확인',cancelLabel='취소',altLabel=''}={}){
  const dialog=$('messageDialog');
  if(dialog.open){dialog.close();messageResolver?.(false)}
  $('messageTitle').textContent=title;$('messageText').textContent=message;dialog.dataset.tone=tone;$('messageCancel').hidden=!confirmAction;$('messageCancel').textContent=cancelLabel;$('messageConfirm').textContent=actionLabel;$('messageAlt').hidden=!altLabel;$('messageAlt').textContent=altLabel;
  return new Promise(resolve=>{const finish=value=>{messageResolver=null;dialog.close();resolve(value)};messageResolver=resolve;$('messageConfirm').onclick=()=>finish(true);$('messageCancel').onclick=()=>finish(false);$('messageAlt').onclick=()=>finish('alt');dialog.oncancel=e=>{e.preventDefault();finish(false)};dialog.showModal()});
}
if(typeof window!=='undefined')window.showAppMessage=showAppMessage;

function init(){
  // 선택지에 내부 치수와 최대 중량을 바로 보여 준다(따로 치수 칸을 두지 않는다).
  $('containerType').innerHTML = Object.entries(CONTAINERS).map(([k,c])=>`<option value="${k}">${c.name} (${(c.l/1000).toFixed(2)} × ${(c.w/1000).toFixed(2)} × ${(c.h/1000).toFixed(2)} m · 최대 ${(c.maxWeight/1000).toFixed(1)} t)</option>`).join('');
  ['productShape','containerType'].forEach(id=>enhanceSelect($(id)));
  enhanceSafetySlider();enhanceSegmented($('preference'),PREFERENCE_HINTS);enhanceSegmented($('transportMode'),TRANSPORT_HINTS);
  suggestFromHistory($('productName'),'names');suggestFromHistory($('productGroup'),'groups');
  bindEvents(); updateContainerSpec(); renderProducts(); resizeCanvas();
}
// 제품명·제품군 입력 이력. 이 브라우저에만 최근 12개를 저장하고, 입력칸 아래에 추천 목록으로 보여 준다.
const HISTORY_KEY='cubestow.productHistory',HISTORY_LIMIT=12;
function readHistory(){try{const data=JSON.parse(localStorage.getItem(HISTORY_KEY)||'{}');return{names:Array.isArray(data.names)?data.names:[],groups:Array.isArray(data.groups)?data.groups:[]}}catch{return{names:[],groups:[]}}}
function rememberProduct(name,group){const data=readHistory(),push=(list,value)=>value?[value,...list.filter(v=>v!==value)].slice(0,HISTORY_LIMIT):list;try{localStorage.setItem(HISTORY_KEY,JSON.stringify({names:push(data.names,name),groups:push(data.groups,group)}))}catch{}}
function suggestFromHistory(input,kind){
  const box=document.createElement('div'),list=document.createElement('ul');let items=[],active=-1;
  box.className='suggest-box';list.className='select-list';list.setAttribute('role','listbox');
  input.before(box);box.append(input,list);input.setAttribute('aria-autocomplete','list');
  const setOpen=open=>box.classList.toggle('open',open&&items.length>0);
  const render=()=>{const query=input.value.trim().toLowerCase();items=readHistory()[kind].filter(v=>v.toLowerCase().includes(query)&&v!==input.value.trim());active=-1;list.innerHTML=items.map((v,i)=>`<li role="option" data-index="${i}" aria-selected="false">${esc(v)}</li>`).join('');setOpen(document.activeElement===input)};
  const pick=i=>{input.value=items[i];setOpen(false)};
  input.addEventListener('focus',render);input.addEventListener('input',render);input.addEventListener('blur',()=>setTimeout(()=>setOpen(false),120));
  input.addEventListener('keydown',e=>{if(!box.classList.contains('open'))return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=(active+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;[...list.children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===active)))}else if(e.key==='Enter'&&active>=0){e.preventDefault();pick(active)}else if(e.key==='Escape')setOpen(false)});
  list.addEventListener('mousedown',e=>{e.preventDefault();const item=e.target.closest('li');if(item)pick(+item.dataset.index)});
}
// 조건 선택상자: 운영체제 기본 목록은 열릴 때 깜박이므로 같은 값을 가진 부드러운 목록으로 보여 준다.
// 값과 change 이벤트는 원래 select가 그대로 가지며, 코드가 값을 바꾸면 syncSelects()로 표시를 맞춘다.
const selectRenderers=[];
function syncSelects(){selectRenderers.forEach(render=>render())}
// 안전 수준 슬라이더: 적재량 우선 ↔ 기본 ↔ CTU 완전 준수. 단계마다 무엇을 지키는지 한 줄로 보여 준다.
const SAFETY_STEPS=['standard','strict','secure'];
// 세 단계 모두 3줄. 설명칸 높이를 고정해 슬라이더를 움직여도 화면이 흔들리지 않게 한다.
const SAFETY_HINTS={standard:['윗 화물 바닥면 70% 이상만 받치면 됩니다','충돌·중량·상부하중 같은 기본 조건만 지킵니다','컨테이너 대수를 가장 적게 씁니다'],strict:['윗 화물 바닥면을 100% 받칩니다','높은 적층·원통 규칙을 지킵니다','남는 틈과 윗단은 고정재(에어백·래싱)로 막습니다'],secure:['모든 화물의 안쪽·좌·우가 서로 막히게 쌓습니다','다른 크기 화물 위에 따로 얹지 않습니다','래싱을 끄면 CTU 전도 기준을 모든 화물에 적용합니다']};
const PREFERENCE_HINTS={auto:'무게배분 등급 → 좌우·앞뒤 편차 → 운송 안정성 순으로 고릅니다',density:'안쪽으로 바짝 붙여 사용 길이가 가장 짧고 빈틈이 적은 배치를 고릅니다',balance:'앞뒤·좌우 무게 편차가 가장 작은 배치를 고릅니다(화물 사이를 벌릴 수 있음)'};
const TRANSPORT_HINTS={road:'도로 기준으로 계산합니다 · 좌우 0.5g, 급정거 0.8g',combined:'도로와 해상 중 불리한 값을 씁니다(권장)',sea:'거친 해역 기준으로 계산합니다 · 좌우 0.8g, 앞뒤 0.4g'};
function enhanceSafetySlider(){
  const select=$('safetyLevel'),slider=$('safetySlider');
  const render=()=>{const i=Math.max(0,SAFETY_STEPS.indexOf(select.value));slider.value=String(i);slider.style.setProperty('--fill',`${i*50}%`);$('safetyLabel').textContent=select.selectedOptions[0]?.textContent||'';$('safetyHint').innerHTML=`<ul>${(SAFETY_HINTS[select.value]||[]).map(line=>`<li>${esc(line)}</li>`).join('')}</ul>`;slider.closest('.safety-field').dataset.level=select.value};
  slider.oninput=()=>{const value=SAFETY_STEPS[+slider.value];if(value!==select.value){select.value=value;select.dispatchEvent(new Event('change'))}render()};
  selectRenderers.push(render);render();
}
// 3칸 버튼: 숨긴 select의 값을 그대로 쓰고, 누르면 change를 보낸다.
function enhanceSegmented(select,hints={}){
  // 설명은 조작부(field-control) 뒤, 칸(option-field)의 둘째 요소로 둔다(넓은 화면에서 설명끼리 한 줄에 맞춘다).
  const group=select.parentElement.querySelector('.segmented'),hint=document.createElement('p');hint.className='segment-hint';hint.setAttribute('aria-live','polite');(select.closest('.option-field')||group.parentElement).append(hint);
  const render=()=>{group.innerHTML=[...select.options].map(o=>`<button type="button" role="radio" aria-checked="${o.selected}" data-value="${o.value}">${esc(o.textContent)}</button>`).join('');hint.textContent=hints[select.value]||''};
  group.onclick=event=>{const button=event.target.closest('button[data-value]');if(!button||button.dataset.value===select.value)return;select.value=button.dataset.value;select.dispatchEvent(new Event('change'));render()};
  selectRenderers.push(render);render();
}
function enhanceSelect(select){
  const box=document.createElement('div'),button=document.createElement('button'),list=document.createElement('ul');
  box.className='select-box';button.type='button';button.className='select-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  list.className='select-list';list.setAttribute('role','listbox');
  select.before(box);box.append(button,select,list);select.classList.add('native-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  const render=()=>{button.textContent=select.selectedOptions[0]?.textContent||'';list.innerHTML=[...select.options].map((o,i)=>`<li role="option" data-index="${i}" aria-selected="${o.selected}">${esc(o.textContent)}</li>`).join('')};
  const setOpen=open=>{box.classList.toggle('open',open);button.setAttribute('aria-expanded',String(open))};
  const choose=index=>{if(index<0||index>=select.options.length||index===select.selectedIndex)return;select.selectedIndex=index;select.dispatchEvent(new Event('change'));render()};
  button.onclick=()=>{const open=!box.classList.contains('open');document.querySelectorAll('.select-box.open').forEach(other=>other!==box&&other.classList.remove('open'));if(open)render();setOpen(open)};
  button.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();choose(select.selectedIndex+(e.key==='ArrowDown'?1:-1))}else if(e.key==='Escape')setOpen(false)};
  list.onclick=e=>{e.preventDefault();const item=e.target.closest('li');if(!item)return;choose(+item.dataset.index);setOpen(false);button.focus()};
  document.addEventListener('click',e=>{if(!box.contains(e.target))setOpen(false)});
  selectRenderers.push(render);render();
}
function bindEvents(){
  $('guideButton').onclick=()=>$('guideDialog').showModal();
  $('policyButton').onclick=()=>$('policyDialog').showModal();
  $('ctuButton').onclick=()=>$('ctuDialog').showModal();
  $('openImport').onclick=()=>$('importDialog').showModal();
  // 입력칸을 누르면 값 전체를 선택해 바로 덮어쓸 수 있게 한다. 포커스 즉시 선택하고, 클릭을 뗄 때 선택이 풀리는 기본 동작만 한 번 막는다.
  document.addEventListener('focusin',e=>{const input=e.target;if(!input.matches?.('.form-grid input,[data-qty-input]'))return;input.select();const keep=ev=>ev.preventDefault();input.addEventListener('mouseup',keep,{once:true});setTimeout(()=>input.removeEventListener('mouseup',keep),500)});
  $('dropzone').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click()}};
  $('addProduct').onclick=addProduct;
  $('loadDemo').onclick=()=>$('sampleDialog').showModal();
  renderSampleList();
  // 드롭다운 메뉴는 항목을 누르거나 바깥을 누르면 닫는다.
  document.addEventListener('click',event=>document.querySelectorAll('details.menu[open]').forEach(menu=>{if(!menu.contains(event.target)||event.target.closest('.menu-list button'))menu.open=false}));
  $('containerType').onchange=()=>{updateContainerSpec();markSimulationChanged()};
  $('safetyLevel').onchange=markSimulationChanged;$('preference').onchange=markSimulationChanged;
  $('transportMode').onchange=markSimulationChanged;
  $('recalculateOptions').onclick=simulate;
  $('fileInput').onchange=async e=>{await readFile(e.target.files[0]);e.target.value=''};
  $('downloadTemplate').onclick=downloadTemplate;
  $('exportPlan').onclick=exportPlan;
  $('exportPdf').onclick=exportPdf;
  $('toggleSequence').onclick=toggleSequence;document.querySelector('.plan-head').onclick=e=>{if(!e.target.closest('button'))toggleSequence()};
  $('toggleProducts').onclick=toggleProductList;
  $('viewIso').onclick=()=>setView('iso');$('viewTop').onclick=()=>setView('top');$('viewDoor').onclick=()=>setView('door');$('viewLeft').onclick=()=>setView('left');$('viewRight').onclick=()=>setView('right');
  $('viewCog').onclick=toggleCenterOfGravity;$('viewAxes').onclick=()=>{showAxes=!showAxes;const button=$('viewAxes');button.classList.toggle('active',showAxes);button.setAttribute('aria-pressed',String(showAxes));button.querySelector('b').textContent=showAxes?'ON':'OFF';draw()};
  document.querySelectorAll('i.securing-icon[data-icon]').forEach(i=>i.innerHTML=SECURING_ICONS[i.dataset.icon]||'');
  $('securingChips').onclick=event=>{const chip=event.target.closest('button[data-key]');if(!chip)return;securingOptions={...securingOptions,[chip.dataset.key]:!securingOptions[chip.dataset.key]};renderSecuringOptions();markSimulationChanged()};
  renderSecuringOptions();
  $('saveField').onclick=saveFieldResult;
  $('toggleDunnage').onclick=()=>toggleSecuringVisibility('dunnage');
  $('toggleAirbags').onclick=()=>toggleSecuringVisibility('airbags');
  $('resetView').onclick=()=>{camera={yaw:-2.51,pitch:0.42,zoom:1};setView('iso')};
  $('prevStep').onclick=()=>setStep(visibleStep-1);
  $('nextStep').onclick=()=>setStep(visibleStep+1);
  $('playSteps').onclick=togglePlayback;
  $('stepRange').oninput=e=>setStep(+e.target.value);
  const dz=$('dropzone'); ['dragenter','dragover'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.add('drag')}));
  ['dragleave','drop'].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.classList.remove('drag')}));
  dz.addEventListener('drop',e=>readFile(e.dataTransfer.files[0]));
  let dragging=false,last={x:0,y:0}; const canvas=$('loadingCanvas');
  canvas.addEventListener('pointerdown',e=>{if(viewMode!=='iso')return;dragging=true;last={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!dragging)return;camera.yaw+=(e.clientX-last.x)*.008;camera.pitch=Math.max(.1,Math.min(1.1,camera.pitch+(e.clientY-last.y)*.006));last={x:e.clientX,y:e.clientY};draw()});
  canvas.addEventListener('pointerup',()=>dragging=false);
  canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.55,Math.min(2,camera.zoom*(e.deltaY>0?.9:1.1)));draw()},{passive:false});
  window.addEventListener('resize',()=>{resizeCanvas();syncSequenceHeight()});
}
// 목록에서 고른 제품을 입력칸으로 불러와 모든 값을 고칠 수 있게 한다. 추가·저장 후에는 입력칸을 비운다.
let editingIndex=-1;
function clearProductForm(){for(const id of ['productName','productGroup','productWeight','productMaxTopLoad','productLength','productWidth','productHeight'])$(id).value='';$('productQty').value='1';$('productShape').value='box';$('allowRotation').checked=false;$('fragile').checked=false;syncSelects()}
function editProduct(index){const p=products[index];if(!p)return;editingIndex=index;$('productName').value=p.name;$('productGroup').value=p.group==='기타'?'':p.group;$('productShape').value=p.shape;$('productQty').value=p.qty;$('productWeight').value=p.weight;$('productMaxTopLoad').value=Number.isFinite(p.maxTopLoadKg)?p.maxTopLoadKg:'';$('productLength').value=p.l;$('productWidth').value=p.w;$('productHeight').value=p.h;$('allowRotation').checked=p.rotate;$('fragile').checked=p.fragile;syncSelects();document.querySelector('.input-card').classList.add('editing');$('inputHint').textContent=`${p.name} 수정 중`;$('addProduct').innerHTML='변경 내용 저장 <b aria-hidden="true">✓</b>';renderProducts();document.querySelector('.input-card').scrollIntoView({behavior:'smooth',block:'nearest'});$('productName').focus({preventScroll:true})}
function stopEditing(){editingIndex=-1;document.querySelector('.input-card').classList.remove('editing');$('inputHint').textContent='직접 입력하거나 불러옵니다.';$('addProduct').innerHTML='제품 목록에 추가 <b aria-hidden="true">↓</b>';}
function cancelEditing(){stopEditing();clearProductForm();renderProducts()}
function addProduct(){
  const topLoad=$('productMaxTopLoad').value,p={name:$('productName').value.trim(),group:$('productGroup').value.trim()||'기타',shape:$('productShape').value,qty:+$('productQty').value,l:+$('productLength').value,w:+$('productWidth').value,h:+$('productHeight').value,weight:+$('productWeight').value,maxTopLoadKg:topLoad===''?null:+topLoad,rotate:$('allowRotation').checked,fragile:$('fragile').checked};
  if(!p.name||[p.qty,p.l,p.w,p.h,p.weight].some(v=>!v||v<=0)||(p.maxTopLoadKg!=null&&(!Number.isFinite(p.maxTopLoadKg)||p.maxTopLoadKg<0))){showAppMessage('제품명과 수량, 규격, 중량, 상부 허용하중을 올바르게 입력해 주세요.',{title:'제품 정보를 확인해 주세요',tone:'warning'});return}
  rememberProduct(p.name,$('productGroup').value.trim());if(editingIndex>=0){products[editingIndex]={...products[editingIndex],...p};stopEditing()}else{p.id=Date.now()+Math.random();p.color=COLORS[products.length%COLORS.length];products.push(p)}clearProductForm();markSimulationChanged();renderProducts();window.loadwiseStorage?.suggestName(`${p.name} 적재`);
}
function renderSampleList(filter='전체'){const modes={sea:'해상',combined:'복합',road:'육상'},units=s=>s.products.reduce((sum,p)=>sum+p.qty,0);$('sampleFilters').innerHTML=['전체',...SAMPLE_CATEGORIES].map(c=>`<button type="button" data-sample-filter="${c}" aria-pressed="${c===filter}">${c}</button>`).join('');$('sampleList').innerHTML=Object.entries(SAMPLE_SETS).filter(([,s])=>filter==='전체'||s.category===filter).map(([id,s])=>`<li><button type="button" data-sample="${id}"><b>${String(id).padStart(2,'0')}</b><span><strong>${esc(s.name)}</strong><small>${esc(s.description)}</small></span><em>${esc(s.category)} · ${CONTAINERS[s.container]?.name||''} · ${modes[s.mode]||''} · ${units(s)}개</em></button></li>`).join('');document.querySelectorAll('[data-sample-filter]').forEach(button=>button.onclick=()=>renderSampleList(button.dataset.sampleFilter));document.querySelectorAll('[data-sample]').forEach(button=>button.onclick=()=>loadDemo(+button.dataset.sample))}
function loadDemo(number=1){if(editingIndex>=0){stopEditing();clearProductForm()}const sample=SAMPLE_SETS[number]||SAMPLE_SETS[1];if(CONTAINERS[sample.container]){$('containerType').value=sample.container;updateContainerSpec()}if(sample.mode)$('transportMode').value=sample.mode;products=sample.products.map((p,i)=>({...p,id:Date.now()+i,color:COLORS[i%COLORS.length]}));$('sampleDialog').close();renderProducts();window.loadwiseStorage?.detach(`샘플 ${number} · ${sample.name}`);markSimulationChanged();simulate();document.querySelector('#planner').scrollIntoView({behavior:'smooth'})}
function renderProducts(){
  const total=products.reduce((s,p)=>s+p.qty,0);$('productCount').textContent=`(${products.length}개 품목 · ${total}박스)`;$('recalculateOptions').disabled=!products.length||editingIndex>=0;$('recalculateOptions').title=editingIndex>=0?'수정 중인 제품을 저장하거나 취소하세요':'';
  $('productList').innerHTML=products.length?products.map((p,i)=>`<div class="product-item${i===editingIndex?' editing':''}"><span class="product-color" style="background:${p.color};border-radius:${p.shape==='cylinder'?'50%':'5px'}"></span><div><div class="product-title-row"><strong>${esc(p.name)}</strong><div class="qty-stepper" aria-label="${esc(p.name)} 수량"><span>수량</span><input type="number" min="1" step="1" value="${p.qty}" data-qty-input="${i}" ${i===editingIndex?'disabled':''} aria-label="${esc(p.name)} 수량 직접 입력"><span class="qty-arrows"><button type="button" data-qty-up="${i}" aria-label="수량 증가" ${i===editingIndex?'disabled':''}>▲</button><button type="button" data-qty-down="${i}" aria-label="수량 감소" ${p.qty<=1||i===editingIndex?'disabled':''}>▼</button></span></div></div><small>${esc(p.group)} · ${p.shape==='cylinder'?'원통형':'박스형'} · ${p.l}×${p.w}×${p.h} mm · ${p.weight} kg${Number.isFinite(p.maxTopLoadKg)?` · 상부 허용 ${p.maxTopLoadKg} kg`:''}</small><div class="product-options"><label><input type="checkbox" data-lay="${i}" ${p.rotate?'checked':''} ${i===editingIndex?'disabled':''}> 눕힘 허용</label><label><input type="checkbox" data-fragile="${i}" ${p.fragile?'checked':''} ${i===editingIndex?'disabled':''}> 상부 적재 금지</label></div></div><div class="product-actions"><button class="edit-product${i===editingIndex?' cancel':''}" type="button" data-edit-button="${i}" aria-label="${esc(p.name)} ${i===editingIndex?'수정 취소':'수정'}">${i===editingIndex?'취소':'수정'}</button>${i===editingIndex?`<button class="delete-product" type="button" data-delete="${i}" aria-label="${esc(p.name)} 삭제">삭제</button>`:''}</div></div>`).join(''):'<div class="list-empty">아직 등록된 제품이 없습니다.</div>';
  document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{const index=+b.dataset.delete;products.splice(index,1);if(index===editingIndex)cancelEditing();else{if(index<editingIndex)editingIndex--;renderProducts()}markSimulationChanged()});
  // 수정 버튼으로 입력칸에 불러오고, 편집 중인 제품에서는 같은 버튼이 취소가 된다.
  document.querySelectorAll('[data-edit-button]').forEach(button=>button.onclick=()=>{const index=+button.dataset.editButton;if(index===editingIndex)cancelEditing();else editProduct(index)});
  document.querySelectorAll('[data-qty-up]').forEach(button=>button.onclick=()=>changeProductQty(+button.dataset.qtyUp,1));
  document.querySelectorAll('[data-qty-down]').forEach(button=>button.onclick=()=>changeProductQty(+button.dataset.qtyDown,-1));
  document.querySelectorAll('[data-qty-input]').forEach(input=>{input.onchange=()=>setProductQty(+input.dataset.qtyInput,input.value);input.onkeydown=e=>{if(e.key==='Enter'){input.blur();e.preventDefault()}}});
  document.querySelectorAll('[data-lay]').forEach(input=>input.onchange=()=>{products[+input.dataset.lay].rotate=input.checked;markSimulationChanged()});
  document.querySelectorAll('[data-fragile]').forEach(input=>input.onchange=()=>{products[+input.dataset.fragile].fragile=input.checked;markSimulationChanged()});
}

function projectSnapshot(){let resultSummary=null;if(shipment){const outcome=shipmentOutcome(shipment);resultSummary={state:outcome.state,loaded:outcome.loaded,total:outcome.total,containerCount:shipment.containers.length,totalWeight:shipment.containers.reduce((sum,load)=>sum+load.totalWeight,0),calculatedAt:new Date().toISOString()}}return LoadwiseProjectModel.createSnapshot(products,$('containerType').value,{safety:$('safetyLevel').value,preference:$('preference').value},{algorithmVersion:LoadwiseProjectModel.CURRENT_ALGORITHM_VERSION,transportMode:$('transportMode').value,securing:securingOptions,resultSummary,fieldResult})}
function applyProjectSnapshot(snapshot){if(editingIndex>=0){stopEditing();clearProductForm()}const data=LoadwiseProjectModel.normalizeSnapshot(snapshot);products=data.products.map((p,i)=>({...p,id:Date.now()+i,color:COLORS[i%COLORS.length]}));fieldResult=data.fieldResult;$('containerType').value=data.containerType;$('safetyLevel').value=data.safety;$('preference').value=data.preference==='width'?'auto':data.preference;$('transportMode').value=data.transportMode;securingOptions={...data.securing};renderSecuringOptions();result=null;shipment=null;activeContainer=0;visibleStep=0;$('balanceCard').hidden=true;$('exportPdf').disabled=true;updateContainerSpec();renderProducts();markSimulationChanged();resizeCanvas();draw()}
function resetProject(){applyProjectSnapshot({products:[],containerType:'20ft',safety:'strict',preference:'auto',transportMode:'combined'})}
if(typeof window!=='undefined')window.loadwiseProject={algorithmVersion:LoadwiseProjectModel.CURRENT_ALGORITHM_VERSION,snapshot:projectSnapshot,apply:applyProjectSnapshot,reset:resetProject};
function changeProductQty(index,delta){if(!products[index])return;products[index].qty=Math.max(1,products[index].qty+delta);renderProducts();markSimulationChanged()}
function setProductQty(index,value){if(!products[index])return;const qty=Math.max(1,Math.floor(Number(value)||1));if(products[index].qty===qty){renderProducts();return}products[index].qty=qty;renderProducts();markSimulationChanged()}
function markSimulationChanged(){syncSelects();inputVersion++;resultStale=true;window.loadwiseStorage?.markDirty();for(const id of ['exportPdf','exportPlan']){$(id).disabled=true;$(id).title='입력이 바뀌어 다시 계산한 뒤 내보낼 수 있습니다.'}$('recalculateOptions').classList.add('needs-update');$('recalculateOptions').innerHTML='다시 계산 <b>→</b>'}
// 컨테이너 치수와 최대 중량은 선택지 이름에 들어 있다. 선택 표시만 갱신한다.
function updateContainerSpec(){syncSelects()}

function runPackingEngine(input,onProgress=()=>{}){
  const local=()=>new Promise((resolve,reject)=>setTimeout(()=>{try{resolve(LoadwiseEngine.packShipment({...input,onProgress}))}catch(error){reject(error)}},0));
  if(!engineWorker&&typeof Worker!=='undefined'&&location.protocol!=='file:')try{engineWorker=new Worker('engine-worker.js?v=20260926-7')}catch{engineWorker=null}
  if(!engineWorker)return local();
  const id=++engineJob,worker=engineWorker;
  return new Promise((resolve,reject)=>{
    worker.onmessage=e=>{const m=e.data;if(m.id!==id)return;if(m.type==='progress')onProgress(m.value);else if(m.type==='done')resolve(m.result);else reject(new Error(m.message))};
    worker.onerror=e=>{e.preventDefault?.();worker.terminate();engineWorker=null;local().then(resolve,reject)};
    worker.postMessage({id,input});
  });
}
function updateSimulationProgress(status,progress,label='배치 후보 계산 중'){const percent=Math.max(0,Math.min(100,Math.round(progress)));status.innerHTML=`<i></i><span>${label}</span><b>${percent}%</b><em><u style="width:${percent}%"></u></em>`}
function shipmentOutcome(s){const loaded=s.containers.reduce((sum,load)=>sum+load.placed.length,0),left=s.unallocated.length,total=s.totalUnits,rate=total?Math.round(loaded/total*100):0;return{loaded,left,total,rate,state:left===0?'complete':loaded===0?'failed':'partial'}}
function unallocatedNotice(s){const outcome=shipmentOutcome(s),groups=new Map;s.unallocated.forEach(item=>{const key=`${item.name}\0${item.reason||''}`,group=groups.get(key)||{name:item.name,reason:item.reason||'치수·회전·지지 조건 불충족',count:0};group.count++;groups.set(key,group)});const details=[...groups.values()].slice(0,8).map(group=>`${group.name} × ${group.count} — ${group.reason}`).join('\n'),extra=groups.size>8?`\n외 ${groups.size-8}개 제품군`:'';return`전체 ${outcome.total}개 중 ${outcome.loaded}개만 적재되었습니다.\n\n미배치 화물 ${outcome.left}개\n${details}${extra}\n\n컨테이너 규격이나 제품의 치수·중량·회전 조건을 확인해 주세요. 미배치 화물이 있으면 Excel 내보내기가 제한됩니다.`}

async function simulate(){syncSelects();if(editingIndex>=0){showAppMessage('수정 중인 제품을 저장하거나 취소한 뒤 시뮬레이션을 실행해 주세요.',{title:'제품 수정 중',tone:'warning'});return}
  if(!products.length){showAppMessage('직접 입력하거나 파일을 불러와 제품을 하나 이상 등록한 뒤 실행해 주세요.',{title:'등록된 제품이 없습니다',tone:'warning'});return}
  if(simulationRunning){pendingRun=true;return}simulationRunning=true;const version=inputVersion,previous=shipment,started=performance.now(),status=$('simulationStatus'),buttons=[$('recalculateOptions')];buttons.forEach(b=>b.disabled=true);status.hidden=false;status.className='simulation-status busy';updateSimulationProgress(status,1,'계산 준비 중');await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,30)));
  try{const containerKey=$('containerType').value,c=CONTAINERS[containerKey],safety=$('safetyLevel').value,preference=$('preference').value,transportMode=currentTransportMode(),label=strategyLabel(safety,preference),units=products.flatMap((p,pi)=>Array.from({length:p.qty},(_,n)=>({...p,pi,unit:n+1,volume:p.l*p.w*p.h})));const plan=await runPackingEngine({container:c,units,safety,preference,transportMode,securing:securingOptions,previous:previous?{containers:previous.containers.map(load=>({container:load.container,placed:load.placed})),unallocated:previous.unallocated,totalUnits:previous.totalUnits,safety:previous.safety,preference:previous.preference,transportMode:previous.transportMode}:null},p=>updateSimulationProgress(status,5+p*90,`${label} 계산 중`)),loads=plan.loads,remaining=plan.remaining;if(version!==inputVersion){status.hidden=true;return}updateSimulationProgress(status,97,'고정재 위치 계산 중');await new Promise(resolve=>setTimeout(resolve,0));if(version!==inputVersion){status.hidden=true;return}loads.forEach((load,i)=>{load.containerNumber=i+1;load.securing=buildSecuringPlan(load,transportMode)});shipment={containers:loads,unallocated:remaining,totalUnits:units.length,containerKey,safety:plan.safety,preference:plan.preference,transportMode:plan.transportMode,engine:plan.engine,stats:plan.stats,strategy:{label,reason:plan.reason}};shipment.validation=LoadwiseValidator.validateShipment(shipment);if(!shipment.validation.valid)throw new Error(`독립 안전 검증 실패: ${shipment.validation.errors.slice(0,3).join(' / ')}`);resultStale=false;result=loads[0];activeContainer=0;visibleStep=result.placed.length;stopPlayback();$('recalculateOptions').classList.remove('needs-update');$('recalculateOptions').innerHTML='시뮬레이션 실행 <b>→</b>';updateResults();resizeCanvas();draw();const outcome=shipmentOutcome(shipment),elapsed=((performance.now()-started)/1000).toFixed(2);status.className=`simulation-status ${outcome.state==='complete'?'done':outcome.state==='partial'?'warning':'error'}`;status.innerHTML=`<i></i><span>${outcome.state==='complete'?'적재 완료':outcome.state==='partial'?'부분 적재':'적재 불가'} · ${label} · ${elapsed}초</span><b>적재 ${outcome.rate}%</b>`;status.hidden=true;$('calcTime').hidden=false;$('calcTime').textContent=`계산 ${elapsed}초`;if(outcome.left)showAppMessage(unallocatedNotice(shipment),{title:outcome.state==='failed'?'현재 조건으로 적재할 수 없습니다':'일부 화물을 적재할 수 없습니다',tone:outcome.state==='failed'?'error':'warning'});window.dispatchEvent(new CustomEvent('loadwise:simulation-complete'))}catch(error){console.error(error);status.className='simulation-status error';status.innerHTML='<i></i><span>계산 중 오류가 발생했습니다</span>';showAppMessage(error.message?.startsWith('독립 안전 검증 실패')?'계산 결과가 독립 안전 검증을 통과하지 못해 표시하지 않았습니다. 안전 기준이나 우선 기준을 바꿔 다시 실행해 주세요.':'계산을 완료하지 못했습니다. 입력 조건을 확인한 뒤 다시 실행해 주세요.',{title:'시뮬레이션 오류',tone:'error'})}finally{simulationRunning=false;buttons.forEach(b=>b.disabled=!products.length||editingIndex>=0);if(pendingRun){pendingRun=false;setTimeout(simulate,0)}}
}
// 고정재 기준은 CTU Code(IMO/ILO/UNECE) 부속서 7을 기본으로 한다. CTU가 수치를 정하지 않은 곳은 CTU가 따르라고 한 제조사 기준, 그래도 없으면 Cubestow 설정값(표시)을 쓴다.
// [CTU §2.3.6] 어느 수평 방향이든 빈 공간의 합은 15cm 이하. 넘으면 채운다.
// [CTU §2.3.8 → 제조사] 에어백은 제조사 최대 간극을 지킨다: Stopak 최대 500mm(1500×2400), 규격별 백 폭의 약 1/3. 넘는 간극은 충전재로 줄인다. 백은 바닥에 닿지 않게.
// [CTU 부속서 7] 못 1개 1~4kN → 하한 1kN으로 못 수 계산. 마찰계수 기본 0.3, 가속도는 IMO 빠른 래싱 가이드 표.
// [Cubestow 설정] 에어백 최소 간극 50mm, 바닥에서 100mm 띄움, 스페이서/에어백 경계 120mm, 10mm 미만 틈은 채울 수 없음.
const VOID_SUM_LIMIT=150,AIRBAG_MIN_GAP=50,AIRBAG_MAX_GAP=500,AIRBAG_FLOOR_CLEARANCE=100,AIRBAG_LIMIT=40,NAIL_KN=1,CTU_FRICTION=.3;
const DOOR_FREE_GAP=VOID_SUM_LIMIT,FENCE_DEPTH=50,SPACER_MIN_GAP=10,SPACER_MAX_GAP=120;
// 문쪽(후방) 방향 필요 억제 가속도(g): 운송모드별 CTU 가속도 c에서 마찰 μ·v를 뺀 값의 최댓값.
function doorPull(mode){const acc=LoadwiseInsights.CTU_ACCELERATIONS,profiles=mode==='road'?['road']:mode==='sea'?['seaC']:['road','seaC'];return Math.max(0,...profiles.map(k=>acc[k].backward.c-CTU_FRICTION*acc[k].backward.v))}
const airbagSize=gap=>gap<=200?'600×1200':gap<=300?'900×1800':gap<=400?'1200×1800':'1500×2400';
// 고정재 아이콘(SVG). 3D 토글과 권고 목록에서 같이 쓴다.
const SECURING_ICONS={
  airbag:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="6" fill="#8fcdf0" stroke="#2f7fae" stroke-width="1.6"/><rect x="10.5" y="2" width="3" height="4" rx="1" fill="#276e96"/><path d="M8 12.5h8" stroke="#e8f6fd" stroke-width="1.4" stroke-linecap="round"/></svg>',
  timber:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="8" width="19" height="8" rx="1.4" fill="#c98b4e" stroke="#7b4d22" stroke-width="1.4"/><path d="M5 11c3-1.4 6 1.4 9 0s4-.6 5 .2M5 13.8c3-1 6 1 9-.2" stroke="#8a5a2b" stroke-width="1" fill="none"/></svg>',
  strap:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9h20v6H2z" fill="#f29b38" stroke="#b7651a" stroke-width="1.3"/><rect x="9" y="7" width="6" height="10" rx="1.2" fill="#5c6166" stroke="#34383c" stroke-width="1.2"/><path d="M11 10v4M13 10v4" stroke="#c9ced3" stroke-width="1"/></svg>',
  filler:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5" fill="#e8d3a8" stroke="#9c7a3c" stroke-width="1.4"/><path d="M7 8l2-1.2 2 1.2v2.4l-2 1.2-2-1.2zM13 8l2-1.2 2 1.2v2.4l-2 1.2-2-1.2zM10 13l2-1.2 2 1.2v2.4l-2 1.2-2-1.2z" fill="none" stroke="#9c7a3c" stroke-width="1"/></svg>'
};
const securingIcon=kind=>SECURING_ICONS[kind==='beam'||kind==='chock'?'timber':kind]||'';
// 화물마다 네 옆면을 보고, 가장 가까운 화물·벽·고정재와의 틈을 크기별로 채운다.
// 30mm 미만은 무시, 120mm 미만은 스페이서(골판지·목재), 120~600mm는 에어백(높은 곳이면 그 높이에), 안쪽 벽 쪽은 에어백 대신 충전재.
// 높은 곳 화물의 틈이 600mm를 넘거나 문쪽이 비면 에어백·충전재를 세울 수 없으므로 화물 위로 넘기는 상단 래싱(측벽 고정점)을 권고한다.
function fillRemainingVoids(load,airbags,dunnage){
  const c=load.container,placed=load.placed,solid=[...placed,...airbags,...dunnage];
  const hit=(a,b)=>Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y)>1&&Math.min(a.z+a.h,b.z+b.h)-Math.max(a.z,b.z)>1;
  const ov=(a0,a1,b0,b1)=>Math.min(a1,b1)-Math.max(a0,b0);
  const dirs=[{key:'back',axis:'x',sign:1},{key:'front',axis:'x',sign:-1},{key:'left',axis:'y',sign:-1},{key:'right',axis:'y',sign:1}];
  let bags=airbags.length;const lash=[],todo=[];
  // 선(점 하나를 지나는 축 방향 직선) 위 빈 공간의 합. 길이 방향은 그 선에서 가장 문쪽 화물부터 안쪽 벽까지(문쪽 공간은 문쪽 고정이 맡는다).
  const lineVoid=(axis,p)=>{const zc=p.z+p.h/2,spans=[];let from;
    if(axis==='y'){const xc=p.x+p.l/2;for(const q of solid)if(xc>q.x&&xc<q.x+q.l&&zc>q.z&&zc<q.z+q.h)spans.push([q.y,q.y+q.w]);from=0}
    else{const yc=p.y+p.w/2;for(const q of solid)if(yc>q.y&&yc<q.y+q.w&&zc>q.z&&zc<q.z+q.h)spans.push([q.x,q.x+q.l]);from=Math.min(...spans.map(s=>s[0]))}
    const to=axis==='y'?c.w:c.l;spans.sort((m,n)=>m[0]-n[0]);let covered=0,end=from;for(const [s0,s1] of spans){const f=Math.max(s0,end),t=Math.min(s1,to);if(t>f){covered+=t-f;end=t}}return to-from-covered};
  for(const p of placed)for(const d of dirs){
    const along=d.axis==='x'?['y','w']:['x','l'],[a,len]=along,edge=d.axis==='x'?(d.sign<0?p.x:p.x+p.l):(d.sign<0?p.y:p.y+p.w);
    // 이 면 쪽의 가장 가까운 물체(화물·고정재)와 틈. 없으면 벽(문)까지.
    let gap=d.axis==='x'?(d.sign<0?edge:c.l-edge):(d.sign<0?edge:c.w-edge),facing=null;
    for(const q of solid){
      if(q===p||ov(p.z,p.z+p.h,q.z,q.z+q.h)<=Math.min(p.h,q.h)*.3||ov(p[a],p[a]+p[len],q[a],q[a]+q[len])<=p[len]*.3)continue;
      const g=d.axis==='x'?(d.sign<0?edge-(q.x+q.l):q.x-edge):(d.sign<0?edge-(q.y+q.w):q.y-edge);
      if(g>=-2&&g<gap){gap=g;facing=q}
    }
    if(gap<SPACER_MIN_GAP)continue;
    // 문쪽이 비면(바닥 화물은 문쪽 고정이 맡는다) 또는 높은 곳에서 에어백 한계를 넘으면 상단 래싱 대상.
    if(d.key==='front'&&!facing||gap>AIRBAG_MAX_GAP){if(p.z>0)lash.push({p,dir:d.key});continue}
    const wall=!facing,toInner=d.key==='back'&&wall,overlapA=facing?[Math.max(p[a],facing[a]),Math.min(p[a]+p[len],facing[a]+facing[len])]:[p[a],p[a]+p[len]];
    const z0=facing?Math.max(p.z,facing.z):p.z,z1=facing?Math.min(p.z+p.h,facing.z+facing.h):p.z+p.h;
    if(overlapA[1]-overlapA[0]<150||z1-z0<150)continue;
    const spacer=gap<SPACER_MAX_GAP||toInner,box={x:0,y:0,z:0,l:0,w:0,h:0};
    box[a]=overlapA[0]+(spacer?0:(overlapA[1]-overlapA[0])*.15);box[len]=(overlapA[1]-overlapA[0])*(spacer?1:.7);
    if(d.axis==='x'){box.x=edge;box.l=gap}else{box.y=d.sign<0?edge-gap:edge;box.w=gap}
    box.z=spacer?z0:Math.max(z0+(z1-z0)*.12,z0===0?AIRBAG_FLOOR_CLEARANCE:z0+20);box.h=spacer?Math.min(z1-z0,1400):Math.min(1200,z1-box.z-(z1-z0)*.1);
    todo.push({p,d,gap,box,spacer,toInner,wall});
  }
  todo.sort((m,n)=>n.gap-m.gap);
  for(const {p,d,gap,box,spacer,toInner} of todo){
    if(lineVoid(d.axis,p)<=VOID_SUM_LIMIT)continue;
    if(box.h<120||solid.some(q=>hit(q,box)))continue;
    const side={back:'안쪽',front:'문쪽',left:'좌측',right:'우측'}[d.key],level=box.z>200?` · ${(box.z/1000).toFixed(1)}m 높이`:'';
    if(spacer){const item={type:'dunnage',kind:'spacer',axis:d.axis,side:d.sign<0?'min':'max',...box,product:p.name,location:`${esc(p.name)} ${side} 틈 ${Math.round(gap)}mm ${toInner?'충전재(안쪽 벽, 에어백 금지)':'스페이서(골판지·목재)'}${level}`};dunnage.push(item);solid.push(item)}
    else if(bags<AIRBAG_LIMIT&&box.x>1&&box.x+box.l<c.l-1){const item={type:'airbag',zone:'gap',bag:airbagSize(gap),...box,product:p.name,location:`${esc(p.name)} ${side} 틈 ${Math.round(gap)}mm${level}`};airbags.push(item);solid.push(item);bags++}
  }
  // 윗단 되잡기 래싱(CTU 부속서 7 §3.2.7 "strapping top layers back"): 윗단의 열린 앞(문쪽)·뒤 면을 가로지르는 웨빙을 그 단 높이의 2/3에 두고
  // 좌우 측벽 고정점에 건다. 화물 위로 넘기는 래싱(top-over)은 마찰로만 눌러 미끄럼에 약하므로 쓰지 않는다(§4.3.5).
  // 같은 면(앞면 위치 60mm, 높이 250mm 이내)에 있는 윗단은 한 줄로 묶는다. 옆이 빈 윗단은 하프루프 래싱 한 쌍을 권고한다(QLG §1.3).
  const faces=[],sides=[];
  for(const {p,dir} of lash){
    if(dir==='left'||dir==='right'){if(!sides.includes(p))sides.push(p);continue}
    const faceX=dir==='back'?p.x+p.l:p.x,z=p.z+p.h*2/3;
    let g=faces.find(f=>f.dir===dir&&Math.abs(f.faceX-faceX)<=60&&Math.abs(f.z-z)<=250);
    if(!g)faces.push(g={dir,faceX,z,items:[]});
    if(!g.items.includes(p))g.items.push(p);
  }
  for(const g of faces){
    const x=g.dir==='back'?g.faceX+4:Math.max(0,g.faceX-22),y0=Math.min(...g.items.map(p=>p.y)),y1=Math.max(...g.items.map(p=>p.y+p.w)),mass=g.items.reduce((sum,p)=>sum+p.weight,0);
    let band={x,y:0,z:Math.round(g.z-25),l:18,w:c.w,h:50};
    // 측벽까지 걸 수 없으면(다른 화물이 가로막으면) 윗단 폭만큼만 두고 가까운 고정점에 건다.
    if(solid.some(q=>hit(q,band)))band={...band,y:y0,w:y1-y0};
    if(band.z+band.h>c.h||solid.some(q=>hit(q,band)))continue;
    const straps=lashingCount(mass,'long'),names=[...new Set(g.items.map(p=>p.name))].map(esc).join('·');
    const item={type:'dunnage',kind:'lashing',axis:'y',side:'min',...band,straps,product:names,location:`${names} 윗단 ${g.dir==='back'?'안쪽':'문쪽'} 면 되잡기 래싱 · 높이 ${(g.z/1000).toFixed(1)}m · 웨빙(MSL 2t) ${straps}줄 · 측벽 고정점`};
    dunnage.push(item);solid.push(item);
  }
  if(sides.length){const mass=sides.reduce((sum,p)=>sum+p.weight,0),pairs=lashingCount(mass,'side');dunnage.push({type:'dunnage',kind:'note',x:0,y:0,z:0,l:0,w:0,h:0,straps:pairs,product:[...new Set(sides.map(p=>p.name))].map(esc).join('·'),location:`옆이 빈 윗단 ${sides.length}개 · 하프루프 래싱 ${pairs}쌍(바닥 고정점, 좌우 전도·미끄럼 방지)`})}
}
// 빠른 래싱 가이드(해상 C, 웨빙 MSL 2,000daN, 마찰 0.3) 표: 스프링 래싱 1줄당 앞뒤 6.1t, 하프루프 한 쌍당 좌우 4.3t. 최소 1.
function lashingCount(massKg,kind){return Math.max(1,Math.ceil(massKg/(kind==='side'?4300:6100)))}
function renderSecuringOptions(){document.querySelectorAll('#securingChips button[data-key]').forEach(chip=>chip.setAttribute('aria-pressed',String(Boolean(securingOptions[chip.dataset.key]))))}
function buildSecuringPlan(load,transportMode=currentTransportMode(),options=securingOptions){
  const dunnage=[],airbags=[],reviews=[],floorItems=load.placed.filter(p=>p.z===0),c=load.container;
  // 문쪽: 앞에 화물이 없는 문쪽 화물이 문에서 150mm 넘게 떨어져 있으면 뒤 기둥 사이에 가로 각재 펜스를 세우고, 펜스와 화물 사이를 충전재로 채운다.
  // 150mm 이하의 틈은 문을 경계로 본다(CTU Code 부속서 7 §2.3.6 간극 합 15cm, §4.2.5). 컨테이너 바닥에는 보통 못을 박을 수 없어 바닥 부목은 쓰지 않는다.
  const doorExposed=load.placed.filter(p=>!load.placed.some(q=>q!==p&&q.x+q.l<=p.x+2&&Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y)>40));
  const recessed=doorExposed.filter(p=>p.x>DOOR_FREE_GAP);
  if(recessed.length){
    // 바닥 화물: 문쪽 면 바로 앞 바닥에 가로 각재를 대고 못으로 고정한다. 틈이 크면 각재 앞에 쐐기 부목을 더 박는다.
    // 못 수 = 필요 억제력(화물 + 그 위 적층 질량 × g × 문쪽 가속도) ÷ 1kN(CTU 못 1개 하한). 못은 바닥 두께의 2/3 이상 박는다.
    const pull=doorPull(transportMode),inCargo=f=>load.placed.some(q=>f.x<q.x+q.l&&f.x+f.l>q.x&&f.y<q.y+q.w&&f.y+f.w>q.y&&f.z<q.z+q.h&&f.z+f.h>q.z);
    recessed.filter(p=>p.z===0&&options.nails).forEach(p=>{
      const mass=load.placed.filter(q=>q===p||q.z>=p.z+p.h-2&&Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x)>q.l*.5&&Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y)>q.w*.5).reduce((sum,q)=>sum+q.weight,0);
      const force=mass*9.81*pull/1000,nails=Math.max(2,Math.ceil(force/NAIL_KN)),beamL=Math.min(100,p.x-2);
      const beam={type:'dunnage',kind:'beam',axis:'x',side:'min',x:p.x-beamL,y:p.y,z:0,l:beamL,w:p.w,h:100,product:p.name,nails,force,location:`${esc(p.name)} 앞 바닥 각재 · 못 ${nails}개 · 필요 억제력 ${force.toFixed(1)}kN`};
      if(inCargo(beam))return;dunnage.push(beam);
      if(p.x-beamL<160)return;
      const count=Math.max(2,Math.min(4,Math.round(p.w/450))),chockL=Math.min(180,p.x-beamL-10);
      for(let i=0;i<count;i++){const w=Math.min(150,p.w/count*.55),center=p.y+p.w*(i+.5)/count,chock={type:'dunnage',kind:'chock',axis:'x',side:'min',x:p.x-beamL-chockL-2,y:Math.max(0,Math.min(c.w-w,center-w/2)),z:0,l:chockL,w,h:125,product:p.name,location:`${esc(p.name)} 각재 지지 쐐기 ${i+1}/${count} · 바닥 못 고정`};if(!inCargo(chock))dunnage.push(chock)}
    });
    // 윗단(바닥에서 뜬) 노출 화물: 뒤 기둥 사이 각재 펜스와 충전재.
    // 바닥 못을 쓰지 않으면 바닥 화물도 펜스와 충전재로 막는다.
    const upper=recessed.filter(p=>p.z>0||!options.nails);
    if(upper.length){
      const nearDoor=Math.min(...doorExposed.map(p=>p.x)),depth=Math.min(FENCE_DEPTH,nearDoor-5);
      const spans=depth>=20?[[0,c.w]]:upper.map(p=>[p.y,p.y+p.w]).sort((m,n)=>m[0]-n[0]).reduce((out,[y0,y1])=>{const last=out[out.length-1];if(last&&y0<=last[1]+5)last[1]=Math.max(last[1],y1);else out.push([y0,y1]);return out},[]);
      const fenceDepth=depth>=20?depth:FENCE_DEPTH,bottom=Math.min(...upper.map(p=>p.z))+(options.nails?50:150),top=Math.min(c.h-80,Math.max(...upper.map(p=>p.z+p.h))),levels=Math.max(2,Math.ceil((top-bottom)/550)+1);
      spans.forEach(([y0,y1],k)=>{for(let i=0;i<levels;i++){const z=Math.round(bottom+(top-bottom-100)*i/Math.max(1,levels-1)),f={type:'dunnage',kind:'fence',axis:'y',side:'min',x:0,y:y0,z,l:fenceDepth,w:y1-y0,h:100,product:'문쪽 윗단 화물',location:`문쪽 각재 펜스${spans.length>1?` ${k+1}구간`:''} · ${i+1}/${levels}단 · 높이 ${(z/1000).toFixed(1)}m · 뒤 기둥 고정`};if(!inCargo(f))dunnage.push(f)}});
      upper.forEach(p=>{const gap=Math.round(p.x-fenceDepth);if(gap<30)return;const f={type:'dunnage',kind:'filler',axis:'x',side:'min',x:fenceDepth,y:p.y,z:p.z,l:gap-2,w:p.w,h:Math.min(p.h,1400),product:p.name,location:`문쪽 충전재 ${gap}mm · ${esc(p.name)} 앞(세운 팔레트·골판지)`};if(!inCargo(f))dunnage.push(f)});
    }
  }
  {
    const candidates=[];
    load.placed.forEach(p=>{const left=p.y,right=c.w-(p.y+p.w),length=Math.min(700,p.l*.6),width=Math.min(700,p.w*.6),x=p.x+(p.l-length)/2,y=p.y+(p.w-width)/2,height=Math.min(1200,p.h*.72),z=p.z+Math.max(20,p.h*.14),level=p.z>0?`${Math.round(p.z/1000*10)/10}m 높이`:'',addWall=(zone,gap,make)=>{if(gap<AIRBAG_MIN_GAP)return;const bag=Math.min(gap,AIRBAG_MAX_GAP),filler=Math.round(gap-bag);candidates.push({...make(bag),type:'airbag',zone,z,h:height,bag:airbagSize(bag),filler,location:`${zone==='left'?'좌측':'우측'} 벽 간극 ${Math.round(gap)}mm${filler>0?` · 충전재 ${filler}mm + 에어백`:''} ${level}`.trim(),product:p.name})};addWall('left',left,bag=>({x,y:p.y-bag,l:length,w:bag}));addWall('right',right,bag=>({x,y:p.y+p.w,l:length,w:bag}));/* 실무상 컨테이너 끝(안쪽 벽·문)에는 에어백을 두지 않는다. 화물은 안쪽 벽에 밀착하고 문 쪽은 각재·부목으로 막는다. */});
    const sorted=[...load.placed].sort((a,b)=>a.x-b.x);sorted.forEach((p,i)=>{let nearest=null;for(let j=i+1;j<sorted.length;j++){const q=sorted[j],gap=q.x-(p.x+p.l),overlap=Math.min(p.y+p.w,q.y+q.w)-Math.max(p.y,q.y),vertical=Math.min(p.z+p.h,q.z+q.h)-Math.max(p.z,q.z);if(gap>0&&overlap>150&&vertical>150&&(!nearest||gap<nearest.gap))nearest={q,gap,overlap,vertical}}if(nearest&&nearest.gap>=120&&nearest.gap<=AIRBAG_MAX_GAP){const baseZ=Math.max(p.z,nearest.q.z),z=baseZ+Math.max(20,nearest.vertical*.14);candidates.push({type:'airbag',zone:'cargo',bag:airbagSize(nearest.gap),x:p.x+p.l,y:Math.max(p.y,nearest.q.y),z,l:nearest.gap,w:nearest.overlap,h:Math.min(1200,nearest.vertical*.72),location:`화물 사이 간극${baseZ>0?` · ${(baseZ/1000).toFixed(1)}m 높이`:''}`,product:`${p.name} / ${nearest.q.name}`})}});
    const byY=[...load.placed].sort((a,b)=>a.y-b.y);byY.forEach((p,i)=>{let nearest=null;for(let j=i+1;j<byY.length;j++){const q=byY[j],gap=q.y-(p.y+p.w),overlap=Math.min(p.x+p.l,q.x+q.l)-Math.max(p.x,q.x),vertical=Math.min(p.z+p.h,q.z+q.h)-Math.max(p.z,q.z);if(gap>0&&overlap>180&&vertical>150&&(!nearest||gap<nearest.gap))nearest={q,gap,overlap,vertical}}if(nearest&&nearest.gap>=120&&nearest.gap<=AIRBAG_MAX_GAP){const baseZ=Math.max(p.z,nearest.q.z),z=baseZ+Math.max(20,nearest.vertical*.12);candidates.push({type:'airbag',zone:'center',bag:airbagSize(nearest.gap),x:Math.max(p.x,nearest.q.x),y:p.y+p.w,z,l:nearest.overlap,w:nearest.gap,h:Math.min(1400,nearest.vertical*.76),location:`화물 열 사이 중앙 간극${baseZ>0?` · ${(baseZ/1000).toFixed(1)}m 높이`:''}`,product:`${p.name} / ${nearest.q.name}`})}});
    const free=q=>!load.placed.some(p=>q.x<p.x+p.l&&q.x+q.l>p.x&&q.y<p.y+p.w&&q.y+q.w>p.y&&q.z<p.z+p.h&&q.z+q.h>p.z);
    const overlapRatio=(a0,a1,b0,b1)=>Math.max(0,Math.min(a1,b1)-Math.max(a0,b0))/Math.max(1,Math.min(a1-a0,b1-b0));
    const grounded=candidates.filter(q=>q.z+q.h>AIRBAG_FLOOR_CLEARANCE*3).map(q=>({...q,h:q.z+q.h-AIRBAG_FLOOR_CLEARANCE,z:AIRBAG_FLOOR_CLEARANCE,location:`${q.location.replace(/\s*·?\s*\d+(?:\.\d+)?m 높이/g,'')} · 바닥에서 ${AIRBAG_FLOOR_CLEARANCE}mm 띄워 설치`}));
    // 에어백은 다른 에어백·부목·화물과 조금도 겹치지 않아야 한다(1mm 초과 겹침이면 큰 쪽을 남긴다).
    const intersects=(a,b)=>Math.min(a.x+a.l,b.x+b.l)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.w,b.y+b.w)-Math.max(a.y,b.y)>1&&Math.min(a.z+a.h,b.z+b.h)-Math.max(a.z,b.z)>1;
    grounded.filter(free).sort((a,b)=>(b.l*b.w*b.h-a.l*a.w*a.h)).forEach(q=>{if(!airbags.some(a=>intersects(a,q))&&!dunnage.some(d=>intersects(d,q)))airbags.push(q)});
    const zoneName={left:'좌측 벽 간극',right:'우측 벽 간극',back:'안쪽 벽 간극',door:'문쪽 간극',center:'화물 열 사이 중앙 간극'};
    let combined=true;
    while(combined){combined=false;outer:for(let i=0;i<airbags.length;i++)for(let j=i+1;j<airbags.length;j++){const a=airbags[i],b=airbags[j];if(!a.zone||a.zone==='cargo'||a.zone!==b.zone)continue;const horizontal=overlapRatio(a.x,a.x+a.l,b.x,b.x+b.l)>.55&&overlapRatio(a.y,a.y+a.w,b.y,b.y+b.w)>.55,verticalGap=Math.max(0,Math.max(a.z,b.z)-Math.min(a.z+a.h,b.z+b.h));if(!horizontal||verticalGap>350)continue;const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),z=Math.min(a.z,b.z),l=Math.min(a.x+a.l,b.x+b.l)-x,w=Math.min(a.y+a.w,b.y+b.w)-y,h=Math.max(a.z+a.h,b.z+b.h)-z,merged={type:'airbag',zone:a.zone,x,y,z,l,w,h,location:`${zoneName[a.zone]} · 대형 수직 통합`,product:`${a.product} / ${b.product}`,combined:(a.combined||1)+(b.combined||1)};if(l>100&&w>100&&h<=c.h-z&&free(merged)&&!airbags.some((o,k)=>k!==i&&k!==j&&intersects(o,merged))&&!dunnage.some(d=>intersects(d,merged))){airbags.splice(j,1);airbags.splice(i,1,merged);combined=true;break outer}}}
    airbags.sort((a,b)=>(b.combined||1)-(a.combined||1)||b.z-a.z);if(airbags.length>AIRBAG_LIMIT)airbags.splice(AIRBAG_LIMIT);
    // 벽 간극이 에어백 한계를 넘으면 백과 벽 사이를 충전재로 채운다(화물·에어백·다른 고정재와 겹치지 않을 때만 표시).
    airbags.filter(a=>a.filler>0&&(a.zone==='left'||a.zone==='right')).forEach(a=>{const f={type:'dunnage',kind:'filler',axis:'y',side:a.zone==='left'?'min':'max',x:a.x,y:a.zone==='left'?a.y-a.filler:a.y+a.w,z:a.z,l:a.l,w:a.filler,h:a.h,product:a.product,location:`${a.zone==='left'?'좌측':'우측'} 벽 충전재 ${a.filler}mm(세운 빈 팔레트·골판지)`};if(f.y>=0&&f.y+f.w<=c.w+1&&free(f)&&!airbags.some(o=>intersects(o,f))&&!dunnage.some(d=>intersects(d,f)))dunnage.push(f)});
  }
  fillRemainingVoids(load,airbags,dunnage);
  reviews.push(...LoadwiseEngine.transportReviews(load,transportMode));
  // 문쪽 줄에 윗단 화물이 있으면 문을 열 때 떨어지지 않게 상단을 도어 스트랩(웹 래싱)으로 측면·바닥 고정점에 묶는다.
  // 에어백은 문쪽에 쓰지 않는다(CTU Code 부속서 7 §2.3.8). 문은 충격하중이 없을 때만 경계로 본다(§4.2.5).
  if(floorItems.length){const front=Math.min(...load.placed.map(p=>p.x)),upper=load.placed.filter(p=>p.z>0&&p.x<=front+300);if(upper.length){const top=Math.max(...upper.map(p=>p.z+p.h)),z=Math.max(...upper.map(p=>p.z))+Math.min(...upper.map(p=>p.h))*2/3,straps=lashingCount(upper.reduce((sum,p)=>sum+p.weight,0),'long'),strap={type:'dunnage',kind:'strap',axis:'y',side:'min',x:Math.max(0,front-22),y:0,z:Math.min(top-60,z),l:18,w:c.w,h:50,straps,product:'문쪽 윗단 화물',location:`문쪽 윗단 되잡기 래싱(도어 스트랩) · 높이 ${(z/1000).toFixed(1)}m · 웨빙(MSL 2t) ${straps}줄 · 측벽 고정점`};if(!airbags.some(a=>Math.min(a.x+a.l,strap.x+strap.l)-Math.max(a.x,strap.x)>1&&Math.min(a.z+a.h,strap.z+strap.h)-Math.max(a.z,strap.z)>1))dunnage.push(strap)}}
  // 에어백을 쓰지 않으면 같은 자리를 충전재로, 충전재를 쓰지 않으면 충전재·스페이서를 빼고, 래싱을 쓰지 않으면 스트랩·래싱을 뺀다. 못 채운 곳은 검토 항목으로 남긴다.
  if(!options.airbag){if(options.filler)dunnage.push(...airbags.map(a=>({...a,type:'dunnage',kind:'filler',location:`${a.location} · 충전재(에어백 대신)`})));else if(airbags.length)reviews.push({product:'고정재 선택',severity:'review',location:`에어백·충전재 미사용 · 채우지 못한 간극 ${airbags.length}곳`,axes:'',count:airbags.length});airbags.length=0}
  if(!options.filler){const skipped=dunnage.filter(d=>d.kind==='filler'||d.kind==='spacer');if(skipped.length)reviews.push({product:'고정재 선택',severity:'review',location:`충전재·스페이서 미사용 · 채우지 못한 틈 ${skipped.length}곳`,axes:'',count:skipped.length});for(let i=dunnage.length-1;i>=0;i--)if(dunnage[i].kind==='filler'||dunnage[i].kind==='spacer')dunnage.splice(i,1)}
  if(!options.lashing){const skipped=dunnage.filter(d=>d.kind==='lashing'||d.kind==='strap');if(skipped.length)reviews.push({product:'고정재 선택',severity:'rearrange',location:`래싱 미사용 · 상단·문쪽 고정이 필요한 곳 ${skipped.length}곳(재배치 검토)`,axes:'',count:skipped.length});for(let i=dunnage.length-1;i>=0;i--)if(dunnage[i].kind==='lashing'||dunnage[i].kind==='strap')dunnage.splice(i,1)}
  return{dunnage,airbags,reviews,transportMode,options:{...options},ctu:LoadwiseInsights.securing(load,{mode:transportMode})};
}
function updateResults(){
  const r=result,total=shipment?shipment.totalUnits:products.reduce((s,p)=>s+p.qty,0);$('emptyState').style.display='none';renderContainerTabs();renderResultSummary();renderFieldResult();
  $('volumeRate').textContent=`${r.volumeRate.toFixed(1)}%`;$('weightRate').textContent=`${r.weightRate.toFixed(1)}%`;$('volumeBar').style.width=`${Math.min(100,r.volumeRate)}%`;$('weightBar').style.width=`${Math.min(100,r.weightRate)}%`;
  $('loadedCount').textContent=`${r.placed.length}개`;$('loadedDetail').textContent=`전체 ${total}개`;$('totalWeight').textContent=`${r.totalWeight.toLocaleString()} kg`;$('containerCount').textContent=`${shipment?shipment.containers.length:1}대`;$('containerDetail').textContent=r.container.name;$('weightDetail').textContent=`허용 ${(r.container.maxWeight/1000).toFixed(1)} t`;
  const groups=[];r.placed.forEach(p=>{let g=groups.find(x=>x.name===p.name&&x.z===p.z&&x.x===p.x);if(g)g.count++;else groups.push({...p,count:1})});
  $('sequenceEmpty').style.display=r.placed.length?'none':'block';$('sequenceEmpty').textContent=r.placed.length?'':'적재 가능한 화물이 없습니다.';$('sequenceList').innerHTML=groups.map((p,i)=>`<li><span class="num">${String(i+1).padStart(2,'0')}</span><span class="dot" style="background:${p.color};border-radius:${p.shape==='cylinder'?'50%':'2px'}"></span><div><strong>${esc(p.name)} × ${p.count} · ${p.shape==='cylinder'?'원통형':'박스형'}</strong><br><small>문에서 ${(p.x/1000).toFixed(2)}m 안쪽 · 바닥에서 ${(p.z/1000).toFixed(2)}m 높이</small></div><small>${p.l}×${p.w}×${p.h}</small></li>`).join('');const blocked=shipment?.unallocated.length>0;$('exportPlan').disabled=blocked||resultStale;$('exportPlan').title=blocked?`미배치 화물 ${shipment.unallocated.length}개를 해결한 후 내보낼 수 있습니다.`:'';
  $('playback').style.display='flex';$('stepRange').max=r.placed.length;$('totalSteps').textContent=r.placed.length;$('exportPdf').disabled=blocked||resultStale;$('exportPdf').title=blocked?`미배치 화물 ${shipment.unallocated.length}개를 해결한 후 만들 수 있습니다.`:'';setStep(r.placed.length);renderBalance();renderRecommendation();renderSecuringRecommendation();requestAnimationFrame(syncSequenceHeight);
}
// 현장 결과 기록과 계획 비교. 기록은 프로젝트 저장에 포함된다.
function renderFieldResult(){
  const panel=$('fieldPanel');if(!panel)return;
  if(!shipment){panel.hidden=true;return}
  panel.hidden=false;
  const planned={loaded:shipmentOutcome(shipment).loaded,containers:shipment.containers.length};
  if(document.activeElement?.closest?.('#fieldPanel')==null){$('fieldLoaded').value=fieldResult?.loaded||'';$('fieldContainers').value=fieldResult?.containers||'';$('fieldNotes').value=fieldResult?.notes||''}
  if(!fieldResult||(!fieldResult.loaded&&!fieldResult.containers)){$('fieldSummary').textContent='실제 적재 결과를 남기면 계획과 비교합니다';$('fieldCompare').textContent=`계획: ${planned.loaded}개 · ${planned.containers}대`;return}
  const diff=(actual,plan,unit)=>actual?`${actual}${unit}(계획 ${plan}${unit}, ${actual===plan?'일치':actual>plan?`+${actual-plan}`:`−${plan-actual}`})`:'—';
  $('fieldSummary').textContent=`기록됨 · ${fieldResult.recordedAt?new Date(fieldResult.recordedAt).toLocaleDateString('ko-KR'):''}`;
  $('fieldCompare').textContent=`실제 ${diff(fieldResult.loaded,planned.loaded,'개')} · ${diff(fieldResult.containers,planned.containers,'대')}${fieldResult.notes?` · 메모: ${fieldResult.notes}`:''}`;
}
function saveFieldResult(){
  fieldResult={loaded:Math.max(0,Math.floor(Number($('fieldLoaded').value)||0)),containers:Math.max(0,Math.floor(Number($('fieldContainers').value)||0)),notes:String($('fieldNotes').value||'').slice(0,240),recordedAt:new Date().toISOString()};
  window.loadwiseStorage?.markDirty();renderFieldResult();
}
// 결과 요약: 이 컨테이너의 안전 판정, 꼭 필요한 고정재 3가지, 현장에서 확인할 항목. 자세한 내용은 아래 카드에 있다.
function renderResultSummary(){
  const el=$('resultSummary');if(!el)return;
  if(!result||!result.placed.length){el.hidden=true;el.innerHTML='';return}
  const ctu=LoadwiseInsights.ctu(result),plan=result.securing||{dunnage:[],airbags:[],reviews:[]},safety=LoadwiseEngine.SAFETY_LEVELS[shipment?.safety||$('safetyLevel').value]?.label||'엄격';
  const level=ctu?.level||'safe',levelText={safe:'양호',caution:'주의',danger:'위험'}[level];
  const count=kind=>plan.dunnage.filter(d=>d.kind===kind).length,nails=plan.dunnage.filter(d=>d.kind==='beam').reduce((sum,d)=>sum+(d.nails||0),0);
  const needs=[
    count('beam')?{icon:'beam',text:`문쪽 바닥 각재 ${count('beam')}곳 · 못 ${nails}개`}:null,
    count('fence')?{icon:'beam',text:`문쪽 각재 펜스 ${count('fence')}단`}:null,
    plan.airbags.length?{icon:'airbag',text:`에어백 ${plan.airbags.length}개`}:null,
    count('lashing')+count('strap')?{icon:'strap',text:`래싱·스트랩 ${count('lashing')+count('strap')}개`}:null,
    count('filler')+count('spacer')?{icon:'filler',text:`충전재·스페이서 ${count('filler')+count('spacer')}곳`}:null
  ].filter(Boolean).slice(0,3);
  const rearrange=plan.reviews.filter(r=>r.severity==='rearrange').length,review=plan.reviews.length-rearrange,restraint=ctuSecuringDirections(plan.ctu).length;
  const checks=[rearrange?`배치 재검토 ${rearrange}건`:'',review?`현장 고정 검토 ${review}건`:'',restraint?`CTU 고정 필요 ${restraint}방향`:''].filter(Boolean);
  el.hidden=false;el.dataset.level=level;
  el.innerHTML=`<div class="summary-verdict"><span>안전 판정</span><strong>안전 수준 ${esc(safety)} · 사전검사 ${levelText}</strong></div>`+
    `<div class="summary-needs"><span>꼭 필요한 고정재</span><strong>${needs.length?needs.map(n=>`<em><i class="securing-icon">${securingIcon(n.icon)}</i>${n.text}</em>`).join(''):'추가 고정재 없음'}</strong></div>`+
    `<div class="summary-checks"><span>확인할 항목</span><strong>${checks.length?checks.join(' · '):'없음'}</strong></div>`;
}
function renderBalance(){const value=LoadwiseInsights.ctu(result),card=$('balanceCard');if(!value){card.hidden=true;return}const validation=LoadwiseValidator.validateLoad(result,{minSupport:shipmentMinSupport()}),m=validation.metrics;card.hidden=false;card.dataset.level=value.level;$('balanceStatus').textContent=value.level==='safe'?'사전검사 양호':value.level==='caution'?'사전검사 주의':'사전검사 위험';$('frontRearBalance').textContent=`${value.door.toFixed(1)}% / ${value.rear.toFixed(1)}%`;$('leftRightBalance').textContent=`${value.left.toFixed(1)}% / ${value.right.toFixed(1)}%`;$('cogPosition').textContent=`X ${(value.cog.x/1000).toFixed(2)} · Y ${(value.cog.y/1000).toFixed(2)} · Z ${(value.cog.z/1000).toFixed(2)} m`;$('cogOffset').textContent=`전후 ${Math.abs(value.grossXOffset).toFixed(1)}% · 좌우 ${Math.abs(value.grossYOffset).toFixed(1)}%`;$('cogOffset').title=`총중량(화물 + 컨테이너 자체중량 ${value.tare.toLocaleString()} kg) 기준. 화물만: 전후 ${Math.abs(value.xOffset).toFixed(1)}% · 좌우 ${Math.abs(value.yOffset).toFixed(1)}%`;$('ctuConcentration').textContent=`${value.concentration.toFixed(1)}% · ${value.checks.concentration?'권고 이내':'60% 초과'}`;$('ctuVertical').textContent=`높이의 ${value.vertical.toFixed(1)}% · ${value.checks.vertical?'권고 이내':'50% 초과'}`;$('compressionStatus').textContent=m.compressionUnverified?`${m.compressionVerified}개 검증 · ${m.compressionUnverified}개 미입력`:`${m.compressionVerified}개 검증 완료`;// 칸마다 권고 범위 안(good)·주의(caution)·위험(danger)을 색으로 보여 준다. 미입력 압축하중은 나쁜 값이 아니라 판정하지 않는다.
const offset=v=>Math.abs(v)<=5?'good':Math.abs(v)<=10?'caution':'danger',mark=(id,level)=>{const cell=$(id).parentElement;if(level)cell.dataset.level=level;else delete cell.dataset.level};mark('frontRearBalance',offset(value.grossXOffset));mark('leftRightBalance',offset(value.grossYOffset));mark('cogOffset',offset(value.maxOffset));mark('cogPosition','');mark('ctuConcentration',value.checks.concentration?'good':'caution');mark('ctuVertical',value.vertical<=50?'good':value.vertical<=60?'caution':'danger');mark('compressionStatus',m.compressionUnverified?'':'good')}
function toggleProductList(){const card=document.querySelector('.product-list-card'),expanded=card.classList.toggle('expanded'),button=$('toggleProducts');button.textContent=expanded?'접기 ▴':'펼치기 ▾';button.setAttribute('aria-expanded',expanded)}
function toggleSequence(){const plan=document.querySelector('.loading-plan'),expanded=plan.classList.toggle('expanded'),button=$('toggleSequence');button.textContent=expanded?'접기 ▴':'펼치기 ▾';button.setAttribute('aria-expanded',expanded);if(!expanded)requestAnimationFrame(syncSequenceHeight)}
function syncSequenceHeight(){const plan=document.querySelector('.loading-plan'),list=$('sequenceList'),panel=document.querySelector('.control-panel');if(!plan||!list||!panel||plan.classList.contains('expanded'))return;const available=Math.max(220,Math.round(panel.getBoundingClientRect().bottom-list.getBoundingClientRect().top-24));list.style.setProperty('--sequence-max-height',`${available}px`)}
function renderContainerTabs(){const el=$('containerTabs');if(!shipment){el.style.display='none';return}const total=shipment.containers.length;el.style.display='flex';el.innerHTML=`<button class="nav-arrow" id="prevContainer" ${activeContainer===0?'disabled':''} aria-label="이전 컨테이너">‹</button><span class="page-label">${activeContainer+1} / ${total}</span><button class="nav-arrow" id="nextContainerArrow" ${activeContainer===total-1?'disabled':''} aria-label="다음 컨테이너">›</button>`;$('prevContainer').onclick=()=>selectContainer(activeContainer-1);$('nextContainerArrow').onclick=()=>selectContainer(activeContainer+1)}
function selectContainer(index){if(!shipment||!shipment.containers[index])return;activeContainer=index;result=shipment.containers[index];visibleStep=result.placed.length;stopPlayback();updateResults();resizeCanvas();draw()}
function containerPlanMessage(container,count){return count===1?`${container.name} 1대에 한 번에 적재합니다.`:`${container.name} ${count}대로 분할 적재합니다.`}
// 모두 적재되면 지표 칸으로 충분하다. 미배치가 있을 때만 이유와 조치를 알린다.
function renderRecommendation(){
  const el=$('recommendation'),outcome=shipment&&shipmentOutcome(shipment);if(!outcome||outcome.state==='complete'){el.hidden=true;el.innerHTML='';return}el.hidden=false;const c=result.container,count=shipment.containers.length,left=shipment.unallocated.length;
  el.innerHTML=outcome.state==='failed'?`<div><strong>현재 규격으로 적재할 수 없습니다.</strong><p>미배치 화물 ${left}개의 치수·중량·회전 조건을 확인하세요. 분할 대수는 제안하지 않습니다.</p></div>`:`<div><strong>${c.name} ${count}대에 ${outcome.loaded}개 적재 · ${left}개 미배치</strong><p>미배치 화물은 별도 검토가 필요합니다.</p></div>`;
}
function renderSecuringRecommendation(){const el=$('securingRecommendation'),panel=$('securingPanel'),plan=result.securing;if(!plan||(!plan.dunnage.length&&!plan.airbags.length&&!plan.reviews.length&&!plan.ctu?.needsRestraint)){panel.hidden=true;el.innerHTML='';return}panel.hidden=false;panel.open=false;const beams=plan.dunnage.filter(d=>d.kind==='beam'),chocks=plan.dunnage.filter(d=>d.kind==='chock'),fillers=plan.dunnage.filter(d=>d.kind==='filler'),straps=plan.dunnage.filter(d=>d.kind==='strap'),fences=plan.dunnage.filter(d=>d.kind==='fence'),spacers=plan.dunnage.filter(d=>d.kind==='spacer'),lashings=plan.dunnage.filter(d=>d.kind==='lashing'),icon=kind=>`<span class="securing-icon">${securingIcon(kind)}</span>`,profile=TRANSPORT_PROFILES[plan.transportMode]||TRANSPORT_PROFILES.combined,reviewUnits=plan.reviews.reduce((sum,w)=>sum+(w.count||1),0),items=[...(fences.length?[`<div class="has-icon">${icon('beam')}<strong>문쪽 각재 펜스 ${fences.length}단 · 뒤 기둥 사이</strong>50×100mm 각재를 뒤 기둥(코너 포스트)에 고정 · 문에서 떨어진 화물 앞은 충전재로 채움</div>`]:[]),...lashings.map(d=>`<div class="has-icon">${icon('strap')}<strong>${d.location}</strong>윗단이 쏟아지지 않게 열린 면 앞을 가로질러 되잡음(CTU Code 부속서 7 §3.2.7) · 모서리 보호대 · 사전장력은 MSL의 50% 이하</div>`),...plan.dunnage.filter(d=>d.kind==='note').map(d=>`<div class="has-icon">${icon('strap')}<strong>${d.location}</strong>${d.product}</div>`),...(spacers.length?[`<div class="has-icon">${icon('filler')}<strong>틈 스페이서 ${spacers.length}곳</strong>${spacers.slice(0,4).map(d=>d.location).join(' · ')}${spacers.length>4?` 외 ${spacers.length-4}곳`:''}</div>`]:[]),...beams.map(d=>`<div class="has-icon">${icon('beam')}<strong>${d.location}</strong>CTU Code 부속서 7: 못 1개 1~4kN 중 하한 1kN으로 계산 · 못은 바닥 두께의 2/3 이상 · 운송모드 문쪽 가속도 기준</div>`),...(chocks.length?[`<div class="has-icon">${icon('chock')}<strong>각재 지지 쐐기 ${chocks.length}개 · 바닥 못 고정</strong>문과 화물 사이 틈이 큰 줄의 바닥 각재 앞</div>`]:[]),...straps.map(d=>`<div class="has-icon">${icon('strap')}<strong>${d.location}</strong>문을 열 때 윗단이 떨어지지 않게 고정 · 스트랩 사전장력은 MSL의 50% 이하</div>`),...plan.airbags.slice(0,8).map((a,i)=>`<div class="has-icon">${icon('airbag')}<strong>에어백 ${i+1}${a.bag?` · ${a.bag}`:''} · ${a.location}</strong>X ${(a.x/1000).toFixed(2)}m · Y ${(a.y/1000).toFixed(2)}m · Z ${(a.z/1000).toFixed(2)}m</div>`),...fillers.map(d=>`<div class="has-icon">${icon('filler')}<strong>${d.location}</strong>에어백과 벽 사이 · 에어백 한계(${AIRBAG_MAX_GAP}mm) 초과분</div>`),...plan.reviews.map(w=>`<div><strong>${w.severity==='rearrange'?'배치 재검토':'현장 고정 검토'} · ${esc(w.product)}${w.count>1?` × ${w.count}`:''}</strong>${w.location}${w.axes?` · 미지지 ${w.axes}`:''}</div>`)];$('securingCount').textContent=`${profile.label}${beams.length?` · 바닥 각재 ${beams.length}`:''}${chocks.length?` · 쐐기 ${chocks.length}`:''} · 에어백 ${plan.airbags.length}${fillers.length?` · 충전재 ${fillers.length}`:''}${fences.length?` · 각재 펜스 ${fences.length}단`:''}${spacers.length?` · 스페이서 ${spacers.length}`:''}${lashings.length?` · 상단 래싱 ${lashings.length}`:''}${straps.length?` · 도어 스트랩 ${straps.length}`:''}${plan.reviews.length?` · 안정성 검토 ${plan.reviews.length}유형/${reviewUnits}개`:''}${ctuSecuringDirections(plan.ctu).length?` · CTU 고정 필요 ${ctuSecuringDirections(plan.ctu).length}방향`:''}`;el.innerHTML=`<h3>컨테이너 ${result.containerNumber} · ${profile.label} 운송 안정성</h3><p>기준: CTU Code 부속서 7(빈 공간 합 15cm 이하, 못 1kN/개, 문 경계 조건)과 에어백 제조사 최대 간극 ${AIRBAG_MAX_GAP}mm. 자동 밴드 수량과 경로는 제시하지 않습니다. ${profile.label} 운송에서 피칭·롤링·히빙 또는 가감속에 불리한 높은 적층, 측면 간극, 문측 노출과 원통 구름 위험을 선별합니다.</p><div class="securing-items">${items.join('')}</div>${ctuSecuringHtml(plan.ctu)}`}
function ctuSecuringDirections(ctu){return ctu?.needsRestraint?ctu.directions.filter(d=>d.forceKN>0||d.tipping):[]}
function ctuSecuringDetail(d){const w=d.worst;return`막히지 않은 화물 ${d.unblocked}개${w?` · 가장 불리한 화물 ${esc(w.product)}: 높이 비율 ${w.ratio.toFixed(2)} &gt; 한계 ${w.limit.toFixed(2)}${w.rows>1?` (${w.rows}열이 함께 기울 때)`:''} · ${w.profile}`:''}`}
function ctuSecuringSummary(ctu){const list=ctuSecuringDirections(ctu);if(!list.length)return'';return`<p><strong>CTU Code 참고 계산(${ctu.profiles.join('·')}, 마찰계수 ${ctu.friction}):</strong> ${list.map(d=>`${d.label} ${d.forceKN>0?`억제력 ${d.forceKN.toFixed(1)} kN`:''}${d.forceKN>0&&d.tipping?' · ':''}${d.tipping?`전도 위험 ${d.tipping}개`:''}`).join(', ')}. 래싱 수량과 벽·앵커 강도는 계산하지 않았습니다.</p>`}
function ctuSecuringHtml(ctu){const list=ctuSecuringDirections(ctu);if(!list.length)return'';return`<h3>CTU Code 참고 계산 · ${ctu.profiles.join('·')}</h3><p>벽이나 벽까지 이어진 화물로 막히지 않은 방향의 미끄럼 억제력과 전도를 계산합니다. 마찰계수 ${ctu.friction}(재질 미확인 시 최대값), 무게중심은 화물 중앙으로 가정하고 문은 막힌 경계로 보지 않습니다. 필요 억제력은 블로킹·래싱으로 확보해야 하며 래싱 수량과 벽·앵커 강도는 계산하지 않습니다.</p><div class="securing-items">${list.map(d=>`<div><strong>${d.label}${d.forceKN>0?` · 필요 억제력 ${d.forceKN.toFixed(1)} kN`:''}${d.tipping?` · 전도 위험 ${d.tipping}개`:''}</strong>${ctuSecuringDetail(d)}</div>`).join('')}</div>`}
function setStep(step){if(!result)return;visibleStep=Math.max(0,Math.min(result.placed.length,step));$('currentStep').textContent=visibleStep;$('stepRange').value=visibleStep;$('prevStep').disabled=visibleStep===0;$('nextStep').disabled=visibleStep===result.placed.length;draw()}
function togglePlayback(){if(playTimer){stopPlayback();return}if(visibleStep>=result.placed.length)setStep(0);$('playSteps').textContent='Ⅱ';playTimer=setInterval(()=>{if(visibleStep>=result.placed.length){stopPlayback();return}setStep(visibleStep+1)},650)}
function stopPlayback(){if(playTimer)clearInterval(playTimer);playTimer=null;if($('playSteps'))$('playSteps').textContent='▶'}

function resizeCanvas(){const c=$('loadingCanvas'),rect=$('canvasWrap').getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);c.width=Math.max(1,rect.width*dpr);c.height=Math.max(1,rect.height*dpr);if(threeView&&rect.width&&rect.height){threeView.renderer.setSize(rect.width,rect.height,false);threeView.camera.aspect=rect.width/rect.height;threeView.camera.updateProjectionMatrix()}draw()}
function draw(){if(!result){clearDrawing();return}if(typeof THREE!=='undefined'){drawThree();return}const canvas=$('loadingCanvas'),ctx=canvas.getContext('2d'),dpr=Math.min(2,window.devicePixelRatio||1),W=canvas.width/dpr,H=canvas.height/dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);if(viewMode==='top')drawTop(ctx,W,H);else drawIso(ctx,W,H)}
// 컨테이너 밖 좌표 원점(문 쪽에서 봤을 때 왼쪽 아래 모서리)에서 뻗는 좌표축. 엔진 x(길이)·y(폭)·z(높이)는 3D의 X·Z·Y 축이다.
const axisLabels={};
function axisLabel(text,color,size){
  if(!axisLabels[text]){const canvas=document.createElement('canvas');canvas.width=256;canvas.height=96;const ctx=canvas.getContext('2d');ctx.font='600 44px Inter, "Noto Sans KR", sans-serif';ctx.fillStyle=color;ctx.textBaseline='middle';ctx.fillText(text,8,48);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;axisLabels[text]=texture}
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:axisLabels[text],depthTest:false,transparent:true}));sprite.scale.set(size,size*.375,1);sprite.renderOrder=12;return sprite;
}
function addAxes(group,c){
  // 화면에서 비슷한 크기로 보이도록 카메라 거리(컨테이너 크기)에 비례한다.
  const scale=Math.max(c.l,c.w*2.5,c.h*2.5)*1.25,gap=scale*.03,length=scale*.1,origin=new THREE.Vector3(-gap,0,-gap);
  for(const [text,color,dir] of [['X 안쪽','#d4402b',new THREE.Vector3(1,0,0)],['Y 우측','#1f9d55',new THREE.Vector3(0,0,1)],['Z 위','#2a6fdb',new THREE.Vector3(0,1,0)]]){
    const arrow=new THREE.ArrowHelper(dir,origin,length,new THREE.Color(color),length*.18,length*.11);arrow.line.material.depthTest=false;arrow.cone.material.depthTest=false;arrow.renderOrder=11;group.add(arrow);
    const label=axisLabel(text,color,scale*.07);label.position.copy(origin).addScaledVector(dir,length+scale*.04);group.add(label);
  }
}
function initThree(){
  if(threeView||typeof THREE==='undefined')return;const mount=$('threeMount');mount.style.display='block';const rect=$('canvasWrap').getBoundingClientRect(),renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));renderer.setSize(rect.width,rect.height,false);renderer.outputColorSpace=THREE.SRGBColorSpace;mount.appendChild(renderer.domElement);$('loadingCanvas').style.display='none';
  const scene=new THREE.Scene(),camera3=new THREE.PerspectiveCamera(34,rect.width/rect.height,1,100000),group=new THREE.Group();scene.add(group);scene.add(new THREE.HemisphereLight(0xffffff,0x789085,2.1));const light=new THREE.DirectionalLight(0xffffff,2.6);light.position.set(-6000,8000,5000);scene.add(light);threeView={renderer,scene,camera:camera3,group};
  let dragging=false,lastX=0,lastY=0;const el=renderer.domElement;el.addEventListener('pointerdown',e=>{if(viewMode!=='iso')return;dragging=true;lastX=e.clientX;lastY=e.clientY;el.setPointerCapture(e.pointerId)});el.addEventListener('pointermove',e=>{if(!dragging)return;camera.yaw+=(e.clientX-lastX)*.008;camera.pitch=Math.max(.12,Math.min(1.35,camera.pitch-(e.clientY-lastY)*.006));lastX=e.clientX;lastY=e.clientY;drawThree()});el.addEventListener('pointerup',()=>dragging=false);el.addEventListener('wheel',e=>{e.preventDefault();camera.zoom=Math.max(.55,Math.min(2,camera.zoom*(e.deltaY>0?.9:1.1)));drawThree()},{passive:false});
}
function disposeThreeGroup(){if(!threeView)return;while(threeView.group.children.length){const o=threeView.group.children.pop();o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();o.children?.forEach(c=>{c.geometry?.dispose();c.material?.dispose()})}}
function clearDrawing(){if(threeView){disposeThreeGroup();threeView.renderer.dispose();threeView.renderer.domElement.remove();threeView=null}$('threeMount').style.display='none';const canvas=$('loadingCanvas'),ctx=canvas.getContext('2d');canvas.style.display='block';ctx.clearRect(0,0,canvas.width,canvas.height)}
function drawThree(){
  initThree();if(!threeView)return;const {renderer,scene,camera:cam,group}=threeView,c=result.container;disposeThreeGroup();
  const visible=result.placed.slice(0,visibleStep),toColor=hex=>new THREE.Color(hex),edgeMat=new THREE.LineBasicMaterial({color:0x315e4c,transparent:true,opacity:.65});
  visible.forEach(p=>{let geometry;if(p.shape==='cylinder'){geometry=new THREE.CylinderGeometry(.5,.5,1,28);geometry.scale(p.l,p.h,p.w)}else geometry=new THREE.BoxGeometry(p.l,p.h,p.w);const material=new THREE.MeshStandardMaterial({color:toColor(p.color),roughness:.72,metalness:.03,transparent:true,opacity:showCog?.2:.94,depthWrite:!showCog,side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.position.set(p.x+p.l/2,p.z+p.h/2,p.y+p.w/2);group.add(mesh);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0x263b32,transparent:true,opacity:showCog?.12:.42}));edges.position.copy(mesh.position);group.add(edges)});
  if(visibleStep===result.placed.length&&result.securing){
    const woodMaterial=new THREE.MeshStandardMaterial({color:0xa56a32,roughness:.88}),nailMaterial=new THREE.MeshStandardMaterial({color:0x383d42,metalness:.65,roughness:.38});
    if(showDunnage)result.securing.dunnage.forEach(d=>{
      if(d.kind==='note')return;
      if(d.kind==='fence'||d.kind==='spacer'){const geometry=new THREE.BoxGeometry(d.l,d.h,d.w),mesh=new THREE.Mesh(geometry,d.kind==='fence'?woodMaterial:new THREE.MeshStandardMaterial({color:0xd9c08a,roughness:.95}));mesh.position.set(d.x+d.l/2,d.z+d.h/2,d.y+d.w/2);group.add(mesh);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:d.kind==='fence'?0x62401f:0x9c7a3c,transparent:true,opacity:.75}));edges.position.copy(mesh.position);group.add(edges);return}
      if(d.kind==='filler'||d.kind==='strap'||d.kind==='lashing'){const geometry=new THREE.BoxGeometry(d.l,d.h,d.w),mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:d.kind==='filler'?0xe8d3a8:0xf29b38,roughness:.9,transparent:d.kind==='filler',opacity:d.kind==='filler'?.85:1}));mesh.position.set(d.x+d.l/2,d.z+d.h/2,d.y+d.w/2);group.add(mesh);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:d.kind==='filler'?0x9c7a3c:0xb7651a,transparent:true,opacity:.8}));edges.position.copy(mesh.position);group.add(edges);return}
      if(d.kind==='beam'){const geometry=new THREE.BoxGeometry(d.l,d.h,d.w),mesh=new THREE.Mesh(geometry,woodMaterial);mesh.position.set(d.x+d.l/2,d.h/2,d.y+d.w/2);group.add(mesh);const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:0x62401f,transparent:true,opacity:.7}));edges.position.copy(mesh.position);group.add(edges);return}
      const dx=d.l,dz=d.w,h=d.h,isX=d.axis==='x',highAtMax=d.side==='min',positions=isX
        ?[0,0,0, dx,0,0, dx,0,dz, 0,0,dz, highAtMax?dx:0,h,0, highAtMax?dx:0,h,dz]
        :[0,0,0, dx,0,0, dx,0,dz, 0,0,dz, 0,h,highAtMax?dz:0, dx,h,highAtMax?dz:0],
        indices=highAtMax
          ?(isX?[0,2,1,0,3,2,1,2,5,1,5,4,0,4,5,0,5,3,0,1,4,3,5,2]:[0,2,1,0,3,2,3,5,2,3,4,5,0,1,5,0,5,4,0,4,3,1,2,5])
          :(isX?[0,2,1,0,3,2,0,4,5,0,5,3,1,2,5,1,5,4,0,1,4,3,5,2]:[0,2,1,0,3,2,0,1,5,0,5,4,3,4,5,3,5,2,0,4,3,1,2,5]);
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
      const mesh=new THREE.Mesh(geometry,woodMaterial);mesh.position.set(d.x,4,d.y);group.add(mesh);
      const nailGeometry=new THREE.CylinderGeometry(12,12,8,14);
      [0.3,0.7].forEach(t=>{const nail=new THREE.Mesh(nailGeometry,nailMaterial);nail.position.set(d.x+(isX?(highAtMax?.2:.8)*dx:t*dx),10,d.y+(isX?t*dz:(highAtMax?.2:.8)*dz));group.add(nail)});
    });
    if(showAirbags)result.securing.airbags.forEach(a=>{
      const material=new THREE.MeshStandardMaterial({color:0x70bde9,transparent:true,opacity:.74,roughness:.58}),geometry=new THREE.SphereGeometry(.5,28,18),mesh=new THREE.Mesh(geometry,material);
      mesh.scale.set(a.l*.94,a.h,a.w*.94);mesh.position.set(a.x+a.l/2,a.z+a.h/2,a.y+a.w/2);group.add(mesh);
      const seam=new THREE.Mesh(new THREE.TorusGeometry(.5,0.018,8,36),new THREE.MeshStandardMaterial({color:0xd7effb,transparent:true,opacity:.8,roughness:.65}));seam.scale.set(a.l*.96,a.w*.96,1);seam.rotation.x=Math.PI/2;seam.position.set(a.x+a.l/2,a.z+a.h/2,a.y+a.w/2);group.add(seam);
      const valve=new THREE.Mesh(new THREE.CylinderGeometry(17,21,28,12),new THREE.MeshStandardMaterial({color:0x276e96,roughness:.48}));valve.position.set(a.x+a.l/2,a.z+a.h+8,a.y+a.w/2);group.add(valve);
    });
  }
  if(showAxes)addAxes(group,c);
  const frameGeo=new THREE.BoxGeometry(c.l,c.h,c.w),frame=new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo),edgeMat);frame.position.set(c.l/2,c.h/2,c.w/2);group.add(frame);
  const doorGeo=new THREE.BoxGeometry(10,c.h,c.w),doorFrame=new THREE.LineSegments(new THREE.EdgesGeometry(doorGeo),new THREE.LineBasicMaterial({color:0x0066cc,transparent:true,opacity:.95}));doorFrame.position.set(0,c.h/2,c.w/2);group.add(doorFrame);
  const floorGeo=new THREE.PlaneGeometry(c.l,c.w),floor=new THREE.Mesh(floorGeo,new THREE.MeshStandardMaterial({color:0xdfe9e2,transparent:true,opacity:.22,side:THREE.DoubleSide}));floor.rotation.x=-Math.PI/2;floor.position.set(c.l/2,0,c.w/2);group.add(floor);
  const balance=LoadwiseInsights.ctu(result);if(showCog&&balance){const color=balance.level==='safe'?0x16803c:balance.level==='caution'?0xd38b00:0xb42318,marker=new THREE.Mesh(new THREE.SphereGeometry(140,24,18),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.3,depthTest:false}));marker.position.set(balance.cog.x,balance.cog.z,balance.cog.y);marker.renderOrder=10;group.add(marker);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(balance.cog.x,0,balance.cog.y),marker.position]),new THREE.LineDashedMaterial({color,dashSize:70,gapSize:35,depthTest:false}));line.computeLineDistances();line.renderOrder=9;group.add(line);const ring=new THREE.Mesh(new THREE.RingGeometry(150,195,32),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.95,depthTest:false}));ring.rotation.x=-Math.PI/2;ring.position.set(balance.cog.x,6,balance.cog.y);ring.renderOrder=9;group.add(ring)}
  const target=new THREE.Vector3(c.l/2,viewMode==='iso'?c.h*.3:c.h*.42,c.w/2),distance=Math.max(c.l,c.w*2.5,c.h*2.5)*(viewMode==='iso'?1.65:1.25)/camera.zoom;
  if(viewMode==='top'){cam.position.set(c.l/2,distance*1.1,c.w/2+.01);cam.up.set(0,0,-1)}else if(viewMode==='door'){cam.position.set(-distance*.72,c.h*.45,c.w/2);cam.up.set(0,1,0)}else if(viewMode==='left'){cam.position.set(c.l/2,c.h*.45,-distance*.72);cam.up.set(0,1,0)}else if(viewMode==='right'){cam.position.set(c.l/2,c.h*.45,c.w+distance*.72);cam.up.set(0,1,0)}else{const horizontal=distance*Math.cos(camera.pitch);cam.position.set(target.x+Math.cos(camera.yaw)*horizontal,target.y+Math.sin(camera.pitch)*distance,target.z+Math.sin(camera.yaw)*horizontal);cam.up.set(0,1,0)}cam.lookAt(target);cam.near=Math.max(1,distance/1000);cam.far=distance*10;cam.updateProjectionMatrix();renderer.render(scene,cam);
}
function drawIso(ctx,W,H){
  const c=result.container,cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw),cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch);
  const raw=(x,y,z)=>{x-=c.l/2;y-=c.w/2;z-=c.h/2;const rx=x*cy-y*sy,ry=x*sy+y*cy;return[rx,ry*sp-z*cp,ry*cp+z*sp]};
  const corners=[[0,0,0],[c.l,0,0],[0,c.w,0],[c.l,c.w,0],[0,0,c.h],[c.l,0,c.h],[0,c.w,c.h],[c.l,c.w,c.h]],rawCorners=corners.map(v=>raw(...v));
  const xs=rawCorners.map(p=>p[0]),ys=rawCorners.map(p=>p[1]),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),pad=58;
  const scale=Math.min((W-pad*2)/(maxX-minX),(H-pad*2)/(maxY-minY))*camera.zoom,centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const P=(x,y,z)=>{const p=raw(x,y,z);return[W/2+(p[0]-centerX)*scale,H/2+(p[1]-centerY)*scale,p[2]]};
  const visible=result.placed.slice(0,visibleStep),polygons=[];
  const addBox=o=>{const pts=[[o.x,o.y,o.z],[o.x+o.l,o.y,o.z],[o.x,o.y+o.w,o.z],[o.x+o.l,o.y+o.w,o.z],[o.x,o.y,o.z+o.h],[o.x+o.l,o.y,o.z+o.h],[o.x,o.y+o.w,o.z+o.h],[o.x+o.l,o.y+o.w,o.z+o.h]].map(v=>P(...v));const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]],tones=[-18,20,-7,5,-12,1];faces.forEach((f,i)=>polygons.push({pts:f.map(n=>pts[n]),depth:f.reduce((s,n)=>s+pts[n][2],0)/4,fill:shade(o.color,tones[i]),stroke:'rgba(19,37,29,.34)'}))};
  const addCylinder=o=>{const n=20,cx=o.x+o.l/2,midY=o.y+o.w/2,rx=o.l/2,ry=o.w/2,b=[],t=[];for(let i=0;i<n;i++){const a=Math.PI*2*i/n;b.push(P(cx+Math.cos(a)*rx,midY+Math.sin(a)*ry,o.z));t.push(P(cx+Math.cos(a)*rx,midY+Math.sin(a)*ry,o.z+o.h))}for(let i=0;i<n;i++){const j=(i+1)%n,pts=[b[i],b[j],t[j],t[i]];polygons.push({pts,depth:pts.reduce((s,p)=>s+p[2],0)/4,fill:shade(o.color,i%2?-3:3),stroke:'rgba(19,37,29,.24)'})}polygons.push({pts:b,depth:b.reduce((s,p)=>s+p[2],0)/n,fill:shade(o.color,-14),stroke:'rgba(19,37,29,.3)'});polygons.push({pts:t,depth:t.reduce((s,p)=>s+p[2],0)/n,fill:shade(o.color,20),stroke:'rgba(19,37,29,.35)'})};
  visible.forEach(p=>p.shape==='cylinder'?addCylinder(p):addBox(p));
  polygons.sort((a,b)=>a.depth-b.depth).forEach(poly=>{ctx.beginPath();poly.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.closePath();ctx.fillStyle=poly.fill;ctx.globalAlpha=.94;ctx.fill();ctx.strokeStyle=poly.stroke;ctx.lineWidth=.7;ctx.stroke()});ctx.globalAlpha=1;
  const framePts=corners.map(v=>P(...v)),edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];ctx.strokeStyle='rgba(15,107,72,.72)';ctx.lineWidth=1.4;ctx.setLineDash([5,4]);edges.forEach(([a,b])=>{ctx.beginPath();ctx.moveTo(framePts[a][0],framePts[a][1]);ctx.lineTo(framePts[b][0],framePts[b][1]);ctx.stroke()});ctx.setLineDash([]);
  if(visible.length){const p=visible[visible.length-1],[x,y]=P(p.x+p.l/2,p.y+p.w/2,p.z+p.h);ctx.fillStyle='#13251d';ctx.beginPath();ctx.arc(x,y-15,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#c9ff5a';ctx.font='700 10px DM Sans';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(p.order),x,y-15);ctx.textAlign='start';ctx.textBaseline='alphabetic'}
}
function drawTop(ctx,W,H){const c=result.container,pad=52,scale=Math.min((W-pad*2)/c.l,(H-pad*2)/c.w)*camera.zoom,ox=(W-c.l*scale)/2,oy=(H-c.w*scale)/2;ctx.fillStyle='#f7faf6';ctx.strokeStyle='rgba(15,107,72,.7)';ctx.lineWidth=2;ctx.fillRect(ox,oy,c.l*scale,c.w*scale);ctx.strokeRect(ox,oy,c.l*scale,c.w*scale);result.placed.slice(0,visibleStep).sort((a,b)=>a.z-b.z).forEach(p=>{ctx.fillStyle=p.color+'d9';ctx.strokeStyle='rgba(19,37,29,.35)';ctx.beginPath();if(p.shape==='cylinder')ctx.ellipse(ox+(p.x+p.l/2)*scale,oy+(p.y+p.w/2)*scale,p.l*scale/2,p.w*scale/2,0,0,Math.PI*2);else ctx.rect(ox+p.x*scale,oy+p.y*scale,p.l*scale,p.w*scale);ctx.fill();ctx.stroke();if(p.l*scale>28&&p.w*scale>18){ctx.fillStyle='white';ctx.font='700 10px DM Sans';ctx.fillText(p.order,ox+p.x*scale+5,oy+p.y*scale+13)}})}
function shade(hex,amt){const n=parseInt(hex.slice(1),16),r=Math.max(0,Math.min(255,(n>>16)+amt)),g=Math.max(0,Math.min(255,((n>>8)&255)+amt)),b=Math.max(0,Math.min(255,(n&255)+amt));return`rgb(${r},${g},${b})`}
function setView(mode){viewMode=mode;for(const name of ['Iso','Top','Door','Left','Right'])$(`view${name}`).classList.toggle('active',mode===name.toLowerCase());draw()}
function toggleCenterOfGravity(){showCog=!showCog;const button=$('viewCog');button.classList.toggle('active',showCog);button.setAttribute('aria-pressed',String(showCog));button.querySelector('b').textContent=showCog?'ON':'OFF';draw()}
function toggleSecuringVisibility(type){const active=type==='dunnage'?(showDunnage=!showDunnage):(showAirbags=!showAirbags),button=$(type==='dunnage'?'toggleDunnage':'toggleAirbags');button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.querySelector('b').textContent=active?'ON':'OFF';draw()}

// Excel 파서(약 860KB)는 가져오기·내보내기를 처음 할 때만 불러온다.
let xlsxLoading=null;
function loadXLSX(){if(typeof XLSX!=='undefined')return Promise.resolve();return xlsxLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='vendor/xlsx.full.min.js?v=0.18.5';script.onload=resolve;script.onerror=reject;document.head.append(script)}).catch(()=>{xlsxLoading=null})}
async function readFile(file){if(!file)return;if($('importDialog').open)$('importDialog').close();try{let rows;if(file.name.toLowerCase().endsWith('.csv'))rows=parseCSV(await file.text());else{await loadXLSX();if(typeof XLSX==='undefined')throw new Error('Excel 파서를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV를 사용해 주세요.');const wb=XLSX.read(await file.arrayBuffer()),sheet=wb.Sheets[wb.SheetNames[0]];rows=XLSX.utils.sheet_to_json(sheet,{defval:''})}const mapped=rows.map((r,i)=>mapRow(r,i)).filter(Boolean);if(!mapped.length)throw new Error('인식 가능한 제품 데이터가 없습니다. 열 이름을 확인해 주세요.');if(editingIndex>=0){stopEditing();clearProductForm()}products=mapped;renderProducts();markSimulationChanged();window.loadwiseStorage?.detach(file.name.replace(/\.[^.]+$/,''));if(await showAppMessage(`${mapped.length}개 품목을 불러왔습니다.\n바로 시뮬레이션을 진행할까요?`,{title:'파일 불러오기 완료',tone:'success',confirmAction:true,actionLabel:'시뮬레이션 실행',cancelLabel:'불러오기만'}))await simulate()}catch(e){showAppMessage(e.message,{title:'파일을 불러오지 못했습니다',tone:'error'})}}
function parseFlag(value,label,row){const v=String(value).trim().toLowerCase();if(['yes','true','1','예','허용'].includes(v))return true;if(['no','false','0','아니오','금지'].includes(v))return false;throw new Error(`${row}행 ${label}은 yes/no, 예/아니오, true/false, 1/0 중 하나여야 합니다.`)}
function mapRow(r,i){const row=i+2,get=(...keys)=>{const key=Object.keys(r).find(k=>keys.some(x=>k.toLowerCase().replace(/\s/g,'')===x));return key?r[key]:''},shape=String(get('형상','제품형상','shape')).trim().toLowerCase(),qty=Number(get('수량','qty','quantity')),topRaw=get('상부허용하중','상부허용하중(kg)','maxtopload','maxtopload(kg)'),maxTopLoadKg=topRaw===''?null:Number(topRaw),values={l:Number(get('길이','길이(mm)','length','length(mm)')),w:Number(get('너비','폭','너비(mm)','width','width(mm)')),h:Number(get('높이','높이(mm)','height','height(mm)')),weight:Number(get('중량','중량(kg)','weight','weight(kg)'))},name=String(get('제품명','name','product')).trim();if(!name)throw new Error(`${row}행 제품명이 비어 있습니다.`);if(!['박스형','box','원통형','cylinder'].includes(shape))throw new Error(`${row}행 형상은 박스형 또는 원통형이어야 합니다.`);if(Object.values(values).some(v=>!Number.isFinite(v)||v<=0))throw new Error(`${row}행 치수와 중량은 0보다 큰 숫자여야 합니다.`);if(!Number.isInteger(qty)||qty<=0)throw new Error(`${row}행 수량은 1 이상의 정수여야 합니다.`);if(maxTopLoadKg!=null&&(!Number.isFinite(maxTopLoadKg)||maxTopLoadKg<0))throw new Error(`${row}행 상부 허용하중은 0 이상의 숫자이거나 빈 값이어야 합니다.`);return{name,group:get('제품군','group','category')||'기타',shape:shape==='원통형'||shape==='cylinder'?'cylinder':'box',...values,maxTopLoadKg,qty,rotate:parseFlag(get('눕힘허용','눕혀서적재가능','회전허용','rotation'),'눕힘허용',row),fragile:parseFlag(get('상부적재금지','fragile'),'상부적재금지',row),id:Date.now()+i,color:COLORS[i%COLORS.length]}}
function parseCSV(text){const rows=[],cells=splitCSV(text.replace(/^\uFEFF/,''));let row=[];for(const cell of cells){if(cell===null){if(row.some(v=>v!==''))rows.push(row);row=[]}else row.push(cell.trim())}if(row.some(v=>v!==''))rows.push(row);const heads=rows.shift()||[];return rows.map(values=>Object.fromEntries(heads.map((h,i)=>[h,values[i]||''])))}
function splitCSV(text){let out=[],cur='',q=false;for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'&&text[i+1]==='"'){cur+='"';i++}else if(ch==='"')q=!q;else if(ch===','&&!q){out.push(cur);cur=''}else if((ch==='\n'||ch==='\r')&&!q){out.push(cur);out.push(null);cur='';if(ch==='\r'&&text[i+1]==='\n')i++}else cur+=ch}if(q)throw new Error('CSV 따옴표가 닫히지 않았습니다.');out.push(cur);return out}
function downloadTemplate(){download('cubestow-template.csv','\uFEFF제품명,제품군,형상,길이(mm),너비(mm),높이(mm),중량(kg),상부허용하중(kg),수량,눕힘허용,상부적재금지\n산업용 펌프,기계류,박스형,1200,800,900,420,1500,4,yes,no\n케이블 드럼,부품,원통형,900,900,700,310,,6,no,no')}
async function captureView(mode){const previous=viewMode;setView(mode);await new Promise(resolve=>requestAnimationFrame(resolve));const source=threeView?.renderer?.domElement||$('loadingCanvas'),image=source.toDataURL('image/png');setView(previous);return image}
async function exportPdf(){if(resultStale)return showAppMessage('입력이 바뀌었습니다. 다시 계산한 뒤 내보내 주세요.',{title:'결과가 최신이 아닙니다',tone:'warning'});
  if(!shipment)return;if(shipment.unallocated.length){showAppMessage(`미배치 화물 ${shipment.unallocated.length}개를 해결한 후 작업지시서를 만들 수 있습니다.`,{title:'PDF 작업지시서가 제한됩니다',tone:'warning'});return}const printWindow=window.open('','loadwise-work-instruction');if(!printWindow){showAppMessage('작업지시서 새 창을 열 수 없습니다. 브라우저의 팝업 차단을 해제해 주세요.',{title:'새 창이 차단되었습니다',tone:'warning'});return}printWindow.document.write('<!doctype html><title>작업지시서 준비 중</title><p style="font-family:sans-serif;padding:24px">작업지시서를 준비하고 있습니다…</p>');
  const outcome=shipmentOutcome(shipment),balance=LoadwiseInsights.ctu(result),validation=LoadwiseValidator.validateLoad(result,{minSupport:shipmentMinSupport()}),compression=validation.metrics,iso=await captureView('iso'),top=await captureView('top'),door=await captureView('door'),plan=result.placed.map(p=>`<tr><td>${p.order}</td><td>${esc(p.name)}</td><td>${p.unit}</td><td>${p.l}×${p.w}×${p.h}</td><td>${p.weight.toLocaleString()} kg</td></tr>`).join(''),transport=TRANSPORT_PROFILES[result.securing?.transportMode]||TRANSPORT_PROFILES.combined,fixedSummary=`${transport.label} 운송 · 부목 ${result.securing?.dunnage.length||0}개 · 에어백 ${result.securing?.airbags.length||0}개 · 안정성 검토 ${result.securing?.reviews.length||0}건`;
  const report=`<header><div><small>CUBESTOW WORK INSTRUCTION</small><h1>${esc($('projectName').value||'적재 계획')}</h1></div><b>${new Date().toLocaleDateString('ko-KR')}</b></header><section class="report-summary"><div><span>컨테이너</span><b>${esc(result.container.name)} · ${activeContainer+1}/${shipment.containers.length}</b></div><div><span>적재 결과</span><b>${outcome.loaded}/${outcome.total}개</b></div><div><span>공간 / 중량</span><b>${result.volumeRate.toFixed(1)}% / ${result.weightRate.toFixed(1)}%</b></div><div><span>총중량</span><b>${result.totalWeight.toLocaleString()} kg</b></div></section><section><h2>적재 시점</h2><div class="report-images"><figure><img src="${iso}"><figcaption>3D 전체</figcaption></figure><figure><img src="${top}"><figcaption>상면</figcaption></figure><figure><img src="${door}"><figcaption>문 입구</figcaption></figure></div></section><section><h2>CTU 중량배분 사전검사와 고정재</h2><div class="report-metrics"><span>문쪽 / 안쪽<b>${balance.door.toFixed(1)} / ${balance.rear.toFixed(1)}%</b></span><span>좌측 / 우측<b>${balance.left.toFixed(1)} / ${balance.right.toFixed(1)}%</b></span><span>중심 편차(총중량)<b>${Math.abs(balance.grossXOffset).toFixed(1)} / ${Math.abs(balance.grossYOffset).toFixed(1)}%</b></span><span>50% 길이 최대 질량<b>${balance.concentration.toFixed(1)}%</b></span><span>수직 무게중심<b>높이의 ${balance.vertical.toFixed(1)}%</b></span><span>압축하중<b>${compression.compressionVerified}개 검증 · ${compression.compressionUnverified}개 미입력</b></span></div><p><strong>고정재 목록:</strong> ${fixedSummary}. 상세 위치는 3D 화면과 Excel 계획의 고정재 시트를 확인하세요.</p>${ctuSecuringSummary(result.securing?.ctu)}</section><section><h2>적재 순서</h2><table><thead><tr><th>순서</th><th>제품</th><th>번호</th><th>배치 크기(mm)</th><th>중량</th></tr></thead><tbody>${plan}</tbody></table></section><section class="field-record"><h2>현장 작업 기록</h2><div><span>실제 적재 수량<strong></strong></span><span>실제 컨테이너 수<strong></strong></span><span>추가 고정재<strong></strong></span></div><p>변경·파손·특이사항</p><i></i><i></i></section><footer><p><strong>안전 고지</strong> 본 문서는 작업 검토용입니다. 상부 허용하중 미입력 화물, 축하중, 바닥 집중하중, 마찰·동하중과 래싱 용량은 별도 확인해야 합니다.</p><div>현장 확인자 ____________________ &nbsp; 날짜 ____________________</div></footer>`;
  const css=`@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#f5f5f7;color:#1d1d1f;font:12px/1.45 Arial,"Noto Sans KR",sans-serif}.toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:12px calc((100% - 190mm)/2);background:#111;z-index:2}.toolbar button{border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer}.toolbar .primary{background:#0878d1;color:#fff}main{width:210mm;min-height:297mm;margin:20px auto;padding:10mm;background:#fff;box-shadow:0 8px 30px #0002}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1d1d1f;padding-bottom:8px}h1{margin:3px 0 0;font-size:24px}h2{margin:16px 0 7px;font-size:15px}.report-summary,.report-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:9px}.report-metrics{grid-template-columns:repeat(3,1fr)}.report-summary div,.report-metrics span{padding:8px;border:1px solid #ddd;border-radius:6px}.report-summary span,.report-metrics span{color:#666}.report-summary b,.report-metrics b{display:block;margin-top:3px;color:#111}.report-images{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.report-images figure{margin:0;border:1px solid #ddd}.report-images img{display:block;width:100%;height:120px;object-fit:contain}.report-images figcaption{padding:4px;text-align:center}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:4px 6px;border:1px solid #ddd;text-align:left}thead{display:table-header-group}.field-record{break-inside:avoid}.field-record>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.field-record span{padding:8px;border:1px solid #bbb}.field-record strong{display:block;height:22px}.field-record p{margin:12px 0 3px}.field-record i{display:block;height:26px;border-bottom:1px solid #aaa}footer{display:block;margin-top:16px;border-top:1px solid #333;padding-top:9px}footer div{margin-top:16px;text-align:right}section{break-inside:avoid}@media print{body{background:#fff}.toolbar{display:none}main{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}`;
  printWindow.document.open();printWindow.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc($('projectName').value||'적재 계획')} · 작업지시서</title><style>${css}</style></head><body><nav class="toolbar"><button id="closePrint">창 닫기</button><button class="primary" id="startPrint">인쇄 / PDF 저장</button></nav><main>${report}</main></body></html>`);printWindow.document.close();printWindow.document.getElementById('startPrint').onclick=()=>printWindow.print();printWindow.document.getElementById('closePrint').onclick=()=>printWindow.close();printWindow.focus()
}
async function exportPlan(){if(resultStale)return showAppMessage('입력이 바뀌었습니다. 다시 계산한 뒤 내보내 주세요.',{title:'결과가 최신이 아닙니다',tone:'warning'});await loadXLSX();
  if(!result)return;
  if(shipment?.unallocated.length){showAppMessage(`미배치 화물 ${shipment.unallocated.length}개가 남아 있습니다. 입력 조건을 수정하고 다시 계산한 뒤 내보내 주세요.`,{title:'Excel 내보내기가 제한됩니다',tone:'warning'});return}
  if(typeof XLSX==='undefined'){showAppMessage('Excel 내보내기 모듈을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.',{title:'Excel 내보내기 오류',tone:'error'});return}
  const loads=shipment?shipment.containers:[result],plan=[],summary=[],securing=[];
  loads.forEach((load,i)=>{
    const balance=LoadwiseInsights.ctu(load),validation=LoadwiseValidator.validateLoad(load,{minSupport:shipmentMinSupport()}),compression=validation.metrics,transport=TRANSPORT_PROFILES[load.securing?.transportMode]||TRANSPORT_PROFILES.combined;summary.push({'컨테이너 번호':i+1,'컨테이너 규격':load.container.name,'운송모드':transport.label,'적재 전략':shipment?.strategy?.label||'사용자 선택','선택 근거':shipment?.strategy?.reason||'','적재 수량':load.placed.length,'총 중량(kg)':load.totalWeight,'공간 활용률(%)':Number(load.volumeRate.toFixed(1)),'중량 활용률(%)':Number(load.weightRate.toFixed(1)),'문쪽 중량배분(%)':Number(balance.door.toFixed(1)),'안쪽 중량배분(%)':Number(balance.rear.toFixed(1)),'좌측 중량배분(%)':Number(balance.left.toFixed(1)),'우측 중량배분(%)':Number(balance.right.toFixed(1)),'무게중심 X(mm)':Math.round(balance.cog.x),'무게중심 Y(mm)':Math.round(balance.cog.y),'무게중심 Z(mm)':Math.round(balance.cog.z),'컨테이너 자체중량(kg)':balance.tare,'전후 편차 총중량 기준(%)':Number(Math.abs(balance.grossXOffset).toFixed(1)),'좌우 편차 총중량 기준(%)':Number(Math.abs(balance.grossYOffset).toFixed(1)),'50% 길이 최대 질량(%)':Number(balance.concentration.toFixed(1)),'수직 무게중심(높이%)':Number(balance.vertical.toFixed(1)),'압축하중 검증 화물':compression.compressionVerified,'압축하중 미입력 화물':compression.compressionUnverified,'CTU 사전검사':balance.level==='safe'?'양호':balance.level==='caution'?'주의':'위험'});
    load.placed.forEach(p=>plan.push({'컨테이너 번호':i+1,'컨테이너 규격':load.container.name,'적재 순서':p.order,'제품명':p.name,'제품군':p.group,'제품 번호':p.unit,'제품 형상':p.shape==='cylinder'?'원통형':'박스형','문에서 안쪽 X(mm)':p.x,'좌측에서 우측 Y(mm)':p.y,'바닥에서 위 Z(mm)':p.z,'배치 길이(mm)':p.l,'배치 너비(mm)':p.w,'배치 높이(mm)':p.h,'개당 중량(kg)':p.weight}));
    const fixed=[...(load.securing?.dunnage||[]),...(load.securing?.airbags||[])];fixed.forEach((f,n)=>securing.push({'컨테이너 번호':i+1,'번호':n+1,'구분':f.type==='dunnage'?(f.kind==='beam'?'가로 각재':'부목'):'에어백','추천 위치':f.location||'화물 간극','관련 제품':f.product||'','X(mm)':Math.round(f.x),'Y(mm)':Math.round(f.y),'Z(mm)':Math.round(f.z),'길이(mm)':Math.round(f.l),'너비(mm)':Math.round(f.w),'높이(mm)':Math.round(f.h)}));(load.securing?.reviews||[]).forEach((review,n)=>securing.push({'컨테이너 번호':i+1,'번호':fixed.length+n+1,'구분':review.severity==='rearrange'?'배치 재검토':'현장 고정 검토','추천 위치':review.location,'관련 제품':review.product,'미지지 방향':review.axes||''}));const ctuReview=load.securing?.ctu,base=fixed.length+(load.securing?.reviews||[]).length;ctuSecuringDirections(ctuReview).map(d=>({'구분':'CTU 참고 계산','추천 위치':d.label,'관련 제품':d.worst?.product||'','필요 억제력(kN)':Number(d.forceKN.toFixed(1)),'전도 위험 화물':d.tipping,'막히지 않은 화물':d.unblocked,'가장 불리한 높이 비율':d.worst?Number(d.worst.ratio.toFixed(2)):'','전도 한계':d.worst?Number(d.worst.limit.toFixed(2)):''})).forEach((row,n)=>securing.push({'컨테이너 번호':i+1,'번호':base+n+1,...row}));
  });
  const productRows=products.map(p=>({'제품명':p.name,'제품군':p.group,'제품 형상':p.shape==='cylinder'?'원통형':'박스형','수량':p.qty,'길이(mm)':p.l,'너비(mm)':p.w,'높이(mm)':p.h,'개당 중량(kg)':p.weight,'상부 허용하중(kg)':Number.isFinite(p.maxTopLoadKg)?p.maxTopLoadKg:'미입력','눕힘 허용':p.rotate?'예':'아니오','상부 적재 금지':p.fragile?'예':'아니오'}));
  const wb=XLSX.utils.book_new();
  const notice=[{'구분':'사용 한계','내용':'본 결과는 작업 검토용 베타입니다. 전역 최적해, 압축강도, 축하중, 위험물 규정을 보장하지 않습니다.'},{'구분':'현장 검증','내용':'실제 적재 전 전문가가 화물 강도, 중량중심, 고정재, 운송 규정을 확인해야 합니다.'}];[['요약',summary],['적재계획',plan],['제품목록',productRows],['고정재',securing],['안전고지',notice]].forEach(([name,rows])=>{const ws=XLSX.utils.json_to_sheet(rows.length?rows:[{'내용':'해당 항목 없음'}]);ws['!cols']=Object.keys(rows[0]||{'내용':''}).map(k=>({wch:Math.max(12,Math.min(48,k.length*2+4))}));XLSX.utils.book_append_sheet(wb,ws,name)});
  XLSX.writeFile(wb,'cubestow-loading-plan.xlsx');
}
function csvCell(v){v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}function download(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
if(typeof document!=='undefined')init();
