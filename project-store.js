(function(){
  const LOCAL_KEY='loadwise.v3.projects',cfg=window.LOADWISE_SUPABASE||{},configured=Boolean(cfg.url&&cfg.publishableKey&&window.supabase),client=configured?window.supabase.createClient(cfg.url,cfg.publishableKey):null;
  let user=null,currentId=null,suggestedName='',suppressDirty=false,dirty=false,saving=false,saveAsNew=false,isAdmin=false,recordedUserId=null,emailCooldown=null;
  const $=id=>document.getElementById(id);
  const message=(text,options)=>window.showAppMessage(text,options);
  function readLocal(){
    const raw=localStorage.getItem(LOCAL_KEY);
    if(!raw)return[];
    const rows=JSON.parse(raw);
    if(!Array.isArray(rows)||rows.some(row=>!row||typeof row.id!=='string'||typeof row.name!=='string'||!row.payload||typeof row.payload!=='object'))throw new Error('브라우저 저장 데이터 형식이 올바르지 않습니다. 기존 데이터는 그대로 보존했습니다.');
    return rows;
  }
  const writeLocal=rows=>localStorage.setItem(LOCAL_KEY,JSON.stringify(rows));
  function state(text,tone=''){const el=$('saveState');el.textContent=text;el.dataset.tone=tone}
  const savedLabel=()=>user?'클라우드 저장됨':'브라우저 저장됨';
  function showCurrent(name='새 프로젝트'){suggestedName=name==='새 프로젝트'?suggestedName:name;$('currentProjectName').textContent=name;$('projectName').value=name==='새 프로젝트'?'':name}
  function markDirty(){if(!suppressDirty){dirty=true;state('저장되지 않음','dirty')}}
  // 샘플·파일처럼 내용을 통째로 바꾸면 저장된 프로젝트와의 연결을 끊는다. 그대로 두면 저장 시 원래 프로젝트를 덮어쓴다.
  // 저장 연결이 바뀔 때마다 올라가는 번호. 저장 도중 다른 것을 불러오면 늦게 끝난 저장이 연결을 되돌리지 않게 한다.
  let linkGeneration=0;
  function detach(name){linkGeneration++;currentId=null;dirty=true;state('저장되지 않음','dirty');showCurrent();suggestName(name,true)}
  function suggestName(name,show=false){if(currentId||!name)return;suggestedName=name.trim();if(show)$('currentProjectName').textContent=suggestedName}
  function snapshot(){return window.loadwiseProject.snapshot()}
  function record(name,id=currentId){return{id:id||crypto.randomUUID(),name,payload:snapshot(),updated_at:new Date().toISOString()}}
  async function list(){if(user){const{data,error}=await client.from('projects').select('id,name,payload,updated_at').order('updated_at',{ascending:false});if(error)throw error;return data}return readLocal().sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||'')))}
  function showSaveDialog(name){$('saveNameInput').value=name;$('saveDialog').showModal();setTimeout(()=>$('saveNameInput').select(),0)}
  async function requestSave(){if(saving)return;saveAsNew=false;if(currentId){const choice=await message('현재 입력과 설정으로 기존 저장 내용을 업데이트하거나 새 이름으로 따로 저장합니다.',{title:'현재 프로젝트에 저장할까요?',tone:'confirm',confirmAction:true,actionLabel:'저장',altLabel:'다른 이름으로 저장'});if(choice==='alt')requestSaveAs();else if(choice)save($('projectName').value);return}saveAsNew=true;showSaveDialog(suggestedName||`적재 계획 ${new Date().toLocaleDateString('ko-KR')}`)}
  function requestSaveAs(){if(saving)return;saveAsNew=true;showSaveDialog(currentId?`${$('projectName').value} 복사본`:suggestedName||`적재 계획 ${new Date().toLocaleDateString('ko-KR')}`)}
  async function save(name){
    name=name.trim();if(!name)return message('프로젝트를 구분할 수 있는 저장 이름을 입력해 주세요.',{title:'저장 이름이 필요합니다',tone:'warning'});if(name.length>80)return message('저장 이름은 80자 이내로 입력해 주세요.',{title:'저장 이름이 너무 깁니다',tone:'warning'});
    saving=true;$('saveProject').disabled=true;$('confirmSave').disabled=true;state('저장 중…');
    const generation=linkGeneration;let savedId;
    try{
      if(user){const row={...(!saveAsNew&&currentId?{id:currentId}:{}),user_id:user.id,name,payload:snapshot(),updated_at:new Date().toISOString()},{data,error}=await client.from('projects').upsert(row).select('id').single();if(error)throw error;savedId=data.id}
      else{const rows=readLocal(),next=record(name,saveAsNew?null:currentId),index=rows.findIndex(x=>x.id===next.id);if(index>=0)rows[index]=next;else rows.push(next);writeLocal(rows);savedId=next.id}
      $('saveDialog').close();if(generation===linkGeneration){currentId=savedId;showCurrent(name);dirty=false;state(savedLabel(),'saved')}
    }catch(error){console.error(error);state('저장 실패','error');message(error.message,{title:'프로젝트를 저장하지 못했습니다',tone:'error'})}
    finally{saving=false;saveAsNew=false;$('saveProject').disabled=false;$('confirmSave').disabled=false}
  }
  async function openList(){
    try{
      const rows=await list(),el=$('projectList');
      $('projectsDescription').textContent=user?'내 계정에 저장된 적재 프로젝트입니다.':'이 브라우저에 저장된 적재 프로젝트입니다.';
      el.innerHTML=rows.length?rows.map(row=>`<article><button class="project-open" data-open="${escapeHtml(row.id)}"><strong>${escapeHtml(row.name)}</strong><small>${formatDate(row.updated_at)}</small></button><button class="project-delete" data-delete-project="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.name)} 삭제">삭제</button></article>`).join(''):'<p class="empty-projects">아직 저장된 프로젝트가 없습니다.</p>';
      el.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>open(b.dataset.open));el.querySelectorAll('[data-delete-project]').forEach(b=>b.onclick=()=>remove(b.dataset.deleteProject));
      if(!$('projectsDialog').open)$('projectsDialog').showModal();
    }catch(error){message(error.message,{title:'저장 목록을 불러오지 못했습니다',tone:'error'})}
  }
  async function open(id){
    if(dirty&&!await message('현재 변경사항은 저장되지 않습니다. 선택한 프로젝트를 불러오시겠습니까?',{title:'저장하지 않은 변경사항이 있습니다',tone:'warning',confirmAction:true,actionLabel:'불러오기'}))return;
    try{const row=(await list()).find(x=>x.id===id);if(!row)return;suppressDirty=true;window.loadwiseProject.apply(row.payload);suppressDirty=false;linkGeneration++;currentId=row.id;showCurrent(row.name);$('projectsDialog').close();dirty=false;state(savedLabel(),'saved');$('recalculateOptions').click()}
    catch(error){suppressDirty=false;message(error.message,{title:'프로젝트를 불러오지 못했습니다',tone:'error'})}
  }
  async function remove(id){
    if(!await message('삭제한 프로젝트는 복구할 수 없습니다.',{title:'이 저장을 삭제할까요?',tone:'danger',confirmAction:true,actionLabel:'삭제'}))return;
    try{if(user){const{error}=await client.from('projects').delete().eq('id',id);if(error)throw error}else writeLocal(readLocal().filter(x=>x.id!==id));if(currentId===id){currentId=null;showCurrent();dirty=true;state('저장되지 않음','dirty')}await openList()}
    catch(error){message(error.message,{title:'프로젝트를 삭제하지 못했습니다',tone:'error'})}
  }
  async function fresh(force=false){if(!force&&dirty&&!await message('현재 입력과 시뮬레이션 결과가 초기화됩니다.',{title:'새 프로젝트를 시작할까요?',tone:'warning',confirmAction:true,actionLabel:'새로 시작'}))return;location.reload()}
  async function socialLogin(provider){if(!client)return;const label=provider==='google'?'Google':'Microsoft',button=$(provider==='google'?'googleLogin':'microsoftLogin');button.disabled=true;$('authMessage').textContent=`${label} 로그인 화면으로 이동합니다.`;const{error}=await client.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+location.pathname,...(provider==='azure'?{scopes:'email'}:{})}});if(error){button.disabled=false;$('authMessage').textContent=`${label} 로그인을 시작하지 못했습니다.`;message(error.message,{title:`${label} 로그인 설정을 확인해 주세요`,tone:'error'})}}
  function startEmailCooldown(){let left=60,button=$('emailLogin');clearInterval(emailCooldown);button.disabled=true;button.textContent=`다시 받기 ${left}초`;emailCooldown=setInterval(()=>{left--;button.textContent=left?`다시 받기 ${left}초`:'인증번호 다시 받기';if(!left){clearInterval(emailCooldown);button.disabled=false}},1000)}
  async function emailLogin(){if(!configured)return;const email=$('loginEmail').value.trim();if(!email||!$('loginEmail').checkValidity())return message('인증번호를 받을 올바른 이메일 주소를 입력해 주세요.',{title:'이메일을 확인해 주세요',tone:'warning'});const{error}=await client.auth.signInWithOtp({email,options:{shouldCreateUser:true}});if(error){$('authMessage').textContent=error.message;return}$('emailOtp').hidden=false;$('emailOtpCode').focus();$('authMessage').textContent='이메일로 보낸 8자리 인증번호를 현재 화면에 입력하세요.';startEmailCooldown()}
  async function verifyEmailOtp(){const email=$('loginEmail').value.trim(),token=$('emailOtpCode').value.trim();if(!/^\d{8}$/.test(token))return message('이메일로 받은 8자리 숫자를 입력해 주세요.',{title:'인증번호를 확인해 주세요',tone:'warning'});const button=$('verifyEmailOtp');button.disabled=true;const{error}=await client.auth.verifyOtp({email,token,type:'email'});button.disabled=false;if(error){$('authMessage').textContent='인증번호가 만료되었거나 올바르지 않습니다.';return}$('authMessage').textContent='로그인되었습니다.'}
  async function trackVisitors(){const todayEl=$('todayVisitors'),totalEl=$('totalVisitors');if(!client){todayEl.textContent='—';totalEl.textContent='—';return}const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value])),date=`${parts.year}-${parts.month}-${parts.day}`,dailyKey=`loadwise-v3-daily-${date}`,should_increment=!localStorage.getItem(dailyKey);try{const{data,error}=await client.rpc('get_visit_counts',{p_daily_key:`visitors-${date}`,should_increment});if(error)throw error;if(should_increment)localStorage.setItem(dailyKey,'1');todayEl.textContent=Number(data.today).toLocaleString();totalEl.textContent=Number(data.total).toLocaleString()}catch(error){console.error(error);todayEl.textContent='—';totalEl.textContent='—'}}
  async function logout(){if(dirty&&!await message('저장하지 않은 변경사항은 사라질 수 있습니다.',{title:'로그아웃할까요?',tone:'warning',confirmAction:true,actionLabel:'로그아웃'}))return;await client?.auth.signOut()}
  async function syncAdminAccess(){
    if(!user){isAdmin=false;recordedUserId=null;renderAccount();return}
    if(recordedUserId!==user.id){recordedUserId=user.id;const{error}=await client.rpc('record_user_access');if(error)console.error(error)}
    const{data,error}=await client.rpc('is_admin');isAdmin=!error&&data===true;renderAccount();
  }
  async function openAdmin(){
    if(!isAdmin)return;
    const[{data:access,error:accessError},{data:admins,error:adminError}]=await Promise.all([client.rpc('admin_user_stats'),client.from('admin_users').select('email,created_at').order('created_at')]);
    if(accessError||adminError){message((accessError||adminError).message,{title:'관리자 통계를 불러오지 못했습니다',tone:'error'});return}
    const recent=Date.now()-86400000;$('adminUserCount').textContent=access.length.toLocaleString();$('adminProjectCount').textContent=access.reduce((sum,row)=>sum+Number(row.project_count||0),0).toLocaleString();$('adminVisitCount').textContent=access.reduce((sum,row)=>sum+Number(row.visit_count||0),0).toLocaleString();$('adminRecentCount').textContent=access.filter(row=>new Date(row.last_seen_at).getTime()>=recent).length.toLocaleString();
    $('adminList').innerHTML=admins.map(row=>`<span>${escapeHtml(row.email)}${row.email===user.email.toLowerCase()?' · 나':`<button type="button" data-revoke-admin="${escapeHtml(row.email)}">해제</button>`}</span>`).join('');
    $('accessList').innerHTML=access.length?access.map(row=>`<tr><td>${escapeHtml(row.email)}</td><td>${Number(row.project_count||0).toLocaleString()}</td><td>${Number(row.simulation_count||0).toLocaleString()}</td><td>${formatDate(row.first_seen_at)}</td><td>${formatDate(row.last_seen_at)}</td><td>${Number(row.visit_count).toLocaleString()}</td></tr>`).join(''):'<tr><td class="admin-empty" colspan="6">아직 로그인 사용자 접속 기록이 없습니다.</td></tr>';
    $('adminList').querySelectorAll('[data-revoke-admin]').forEach(button=>button.onclick=()=>revokeAdmin(button.dataset.revokeAdmin));if(!$('adminDialog').open)$('adminDialog').showModal();
    loadAlgorithmFlags();
  }
  async function grantAdmin(){const email=$('adminEmail').value.trim().toLowerCase();if(!email||!$('adminEmail').checkValidity())return message('관리자로 등록할 올바른 이메일 주소를 입력해 주세요.',{title:'이메일을 확인해 주세요',tone:'warning'});const{error}=await client.rpc('grant_admin',{p_email:email});if(error)return message(error.message,{title:'관리자 권한을 추가하지 못했습니다',tone:'error'});$('adminEmail').value='';await openAdmin();message(`${email}에 관리자 권한을 부여했습니다.`,{title:'관리자 권한 추가 완료',tone:'success'})}
  async function revokeAdmin(email){if(!await message(`${email}의 관리자 권한을 해제합니다.`,{title:'관리자 권한을 해제할까요?',tone:'danger',confirmAction:true,actionLabel:'권한 해제'}))return;const{error}=await client.rpc('revoke_admin',{p_email:email});if(error)return message(error.message,{title:'관리자 권한을 해제하지 못했습니다',tone:'error'});await openAdmin()}
  // 알고리즘 점검 기록: 자동 평가가 알고리즘을 의심한 결과를 브라우저 대기열에 넣고 Supabase(record_algorithm_flag)로 보낸다.
  // 보내지 못한 기록(표가 아직 없거나 오프라인)은 대기열에 남겨 다음 계산 때 다시 보낸다. 읽기·삭제는 관리자만 할 수 있다.
  const FLAG_QUEUE='loadwise.v3.algorithmFlags';
  function readFlags(){try{const list=JSON.parse(localStorage.getItem(FLAG_QUEUE)||'[]');return Array.isArray(list)?list:[]}catch{return[]}}
  function writeFlags(list){try{localStorage.setItem(FLAG_QUEUE,JSON.stringify(list.slice(-20)))}catch{}}
  // 한 브라우저가 하루에 보내는 기록은 FLAG_DAILY_LIMIT건까지(서버의 전체 하루 한도를 한 사람이 다 쓰지 않게).
  const FLAG_SENT='loadwise.v3.algorithmFlagsSent',FLAG_DAILY_LIMIT=10;
  function sentToday(){const day=new Date().toISOString().slice(0,10);try{const v=JSON.parse(localStorage.getItem(FLAG_SENT)||'{}');return v.day===day?{day,count:Number(v.count)||0}:{day,count:0}}catch{return{day,count:0}}}
  // 예전 대기열에 남은 제품명·제품군도 보내기 전에 지운다.
  const stripNames=input=>({...input,products:(input?.products||[]).map(({name,group,...rest})=>rest)});
  // 한 번에 하나만 보낸다. 보내는 중에 새 기록이 들어오면 끝난 뒤 한 번 더 돈다.
  let flushing=false,flushAgain=false;
  async function flushFlags(){if(!client)return;if(flushing){flushAgain=true;return}flushing=true;try{do{flushAgain=false;await flushOnce()}while(flushAgain)}finally{flushing=false}}
  async function flushOnce(){const sentOk=new Set(),sent=sentToday();for(const entry of readFlags()){if(sent.count>=FLAG_DAILY_LIMIT)break;const{error}=await client.rpc('record_algorithm_flag',{p_app_version:entry.appVersion,p_engine:entry.engine,p_settings:entry.settings,p_flags:entry.flags,p_input:stripNames(entry.input),p_fingerprint:entry.fingerprint});if(error)console.warn('algorithm flag not sent',error.message);else{sent.count++;sentOk.add(entry.fingerprint)}}
    try{localStorage.setItem(FLAG_SENT,JSON.stringify(sent))}catch{}
    // 보내는 동안 새로 들어온 기록은 지우지 않고, 보낸 기록만 대기열에서 뺀다.
    writeFlags(readFlags().filter(e=>!sentOk.has(e.fingerprint)))}
  function recordAlgorithmFlag(entry){if(!entry?.fingerprint||!entry.flags?.length)return;const queue=readFlags().filter(e=>e.fingerprint!==entry.fingerprint);queue.push(entry);writeFlags(queue);flushFlags()}
  const FLAG_NAMES={'validation':'검증 실패','empty-container':'빈 컨테이너','cog-danger':'무게배분 위험','not-flush':'첫 화물 미밀착','perch-in-ctu':'CTU 얹힘','tower-open':'높은 적층 열림','inner-void':'안쪽 빈 곳','filler-inside':'중간 충전재','many-airbags':'에어백 과다','thin-last':'마지막 컨테이너 소량'};
  async function loadAlgorithmFlags(){
    const box=$('algorithmFlagList');if(!box)return;
    const{data,error}=await client.from('algorithm_flags').select('id,created_at,app_version,engine,settings,flags,input').order('created_at',{ascending:false}).limit(50);
    if(error){box.innerHTML=`<tr><td class="admin-empty" colspan="5">점검 기록을 불러오지 못했습니다(${escapeHtml(error.message)}). Supabase에 algorithm_flags SQL을 적용했는지 확인하세요.</td></tr>`;return}
    box.innerHTML=data.length?data.map(row=>`<tr><td>${formatDate(row.created_at)}</td><td>v${escapeHtml(row.app_version)}<br><small>${escapeHtml(row.engine)}</small></td><td>${escapeHtml([row.settings?.container,row.settings?.safety,row.settings?.preference,row.settings?.transportMode].filter(Boolean).join(' · '))}</td><td>${(row.flags||[]).map(item=>escapeHtml(FLAG_NAMES[item.code]||item.code)).join(', ')}</td><td><button type="button" data-flag-download="${row.id}">입력 받기</button> <button type="button" data-flag-delete="${row.id}">삭제</button></td></tr>`).join(''):'<tr><td class="admin-empty" colspan="5">아직 점검 기록이 없습니다.</td></tr>';
    box.querySelectorAll('[data-flag-download]').forEach(button=>button.onclick=()=>{const row=data.find(r=>String(r.id)===button.dataset.flagDownload),blob=new Blob([JSON.stringify(row,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`cubestow-algorithm-flag-${row.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
    box.querySelectorAll('[data-flag-delete]').forEach(button=>button.onclick=async()=>{if(!await message('이 점검 기록을 삭제합니다.',{title:'점검 기록을 삭제할까요?',tone:'danger',confirmAction:true,actionLabel:'삭제'}))return;const{error}=await client.from('algorithm_flags').delete().eq('id',button.dataset.flagDelete);if(error)return message(error.message,{title:'삭제하지 못했습니다',tone:'error'});loadAlgorithmFlags()});
  }
  async function recordSimulation(){if(!user)return;const{error}=await client.rpc('record_simulation');if(error)console.error(error)}
  function renderAccount(){const signed=Boolean(user),button=$('accountButton'),menu=$('accountMenu');button.hidden=!configured||signed;button.textContent='로그인';menu.hidden=!signed;if(!signed)menu.open=false;$('adminButton').hidden=!isAdmin;$('accountIdentity').textContent=signed?user.email:'';$('accountIdentity').title=signed?(isAdmin?'관리자 계정':'클라우드 저장 계정'):'';$('localNotice').hidden=signed;$('localNotice').textContent=configured?'로그인 전에는 이 브라우저에만 저장됩니다.':'이 브라우저에만 저장됩니다.';if(signed&&$('accountDialog').open)$('accountDialog').close()}
  function formatDate(value){const date=new Date(value);return Number.isNaN(date.getTime())?'저장 날짜 없음':date.toLocaleString('ko-KR')}
  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]))}
  async function init(){
    $('saveProject').onclick=requestSave;$('logoutButton').onclick=()=>{$('accountMenu').open=false;logout()};$('confirmSave').onclick=()=>save($('saveNameInput').value);$('saveNameInput').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();save(e.currentTarget.value)}};$('openProjects').onclick=openList;$('newProjectTop').onclick=()=>fresh();$('accountButton').onclick=()=>user?logout():$('accountDialog').showModal();$('adminButton').onclick=openAdmin;$('grantAdmin').onclick=grantAdmin;$('adminEmail').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();grantAdmin()}};$('googleLogin').onclick=()=>socialLogin('google');$('microsoftLogin')?.addEventListener('click',()=>socialLogin('azure'));$('emailLogin').onclick=emailLogin;$('verifyEmailOtp').onclick=verifyEmailOtp;$('emailOtpCode').onkeydown=e=>{if(e.key==='Enter')verifyEmailOtp()};$('containerType').addEventListener('change',markDirty);$('safetyLevel').addEventListener('change',markDirty);$('preference').addEventListener('change',markDirty);$('transportMode').addEventListener('change',markDirty);
    if(client){const{data}=await client.auth.getSession();user=data.session?.user||null;await syncAdminAccess();client.auth.onAuthStateChange((_event,session)=>{const next=session?.user||null;if(user?.id&&user.id!==next?.id){fresh(true);return}user=next;syncAdminAccess()})}
    renderAccount();showCurrent();state('저장되지 않음');trackVisitors();
  }
  window.loadwiseStorage={markDirty,suggestName,detach,recordAlgorithmFlag};window.addEventListener('loadwise:simulation-complete',recordSimulation);window.addEventListener('DOMContentLoaded',init);
})();
