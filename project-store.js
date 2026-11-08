(function () {
  const LEGAL_CONSENT_VERSION = '2026-10-03',
    LEGAL_CONSENT_PENDING_KEY = 'cubestow.legalConsentPending',
    LOCAL_KEY = 'loadwise.v3.projects',
    cfg = window.LOADWISE_SUPABASE || {},
    configured = Boolean(cfg.url && cfg.publishableKey && window.supabase),
    client = configured ? window.supabase.createClient(cfg.url, cfg.publishableKey) : null;
  let user = null,
    currentId = null,
    suggestedName = '',
    suppressDirty = false,
    dirty = false,
    saving = false,
    saveAsNew = false,
    isAdmin = false,
    recordedUserId = null;
  const $ = id => document.getElementById(id);
  const message = (text, options) => window.showAppMessage(text, options);
  function readLocal() {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (
      !Array.isArray(rows) ||
      rows.some(
        row =>
          !row ||
          typeof row.id !== 'string' ||
          typeof row.name !== 'string' ||
          !row.payload ||
          typeof row.payload !== 'object'
      )
    )
      throw new Error('브라우저 저장 데이터 형식이 올바르지 않습니다. 기존 데이터는 그대로 보존했습니다.');
    return rows;
  }
  const writeLocal = rows => localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
  function state(text, tone = '') {
    const el = $('saveState');
    el.textContent = text;
    el.dataset.tone = tone;
  }
  const savedLabel = () => (user ? '클라우드 저장됨' : '브라우저 저장됨');
  function showCurrent(name = '새 프로젝트') {
    suggestedName = name === '새 프로젝트' ? suggestedName : name;
    $('currentProjectName').textContent = name;
    $('projectName').value = name === '새 프로젝트' ? '' : name;
  }
  function markDirty() {
    if (!suppressDirty) {
      dirty = true;
      state('저장되지 않음', 'dirty');
    }
  }
  // 샘플·파일처럼 내용을 통째로 바꾸면 저장된 프로젝트와의 연결을 끊는다. 그대로 두면 저장 시 원래 프로젝트를 덮어쓴다.
  // 저장 연결이 바뀔 때마다 올라가는 번호. 저장 도중 다른 것을 불러오면 늦게 끝난 저장이 연결을 되돌리지 않게 한다.
  let linkGeneration = 0;
  function detach(name) {
    linkGeneration++;
    currentId = null;
    dirty = true;
    state('저장되지 않음', 'dirty');
    showCurrent();
    suggestName(name, true);
  }
  function suggestName(name, show = false) {
    if (currentId || !name) return;
    suggestedName = name.trim();
    if (show) $('currentProjectName').textContent = suggestedName;
  }
  function snapshot() {
    return window.loadwiseProject.snapshot();
  }
  function record(name, id = currentId) {
    return { id: id || crypto.randomUUID(), name, payload: snapshot(), updated_at: new Date().toISOString() };
  }
  async function list() {
    if (user) {
      const { data, error } = await client
        .from('projects')
        .select('id,name,payload,updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data;
    }
    return readLocal().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }
  function showSaveDialog(name) {
    $('saveNameInput').value = name;
    $('saveDialog').showModal();
    setTimeout(() => $('saveNameInput').select(), 0);
  }
  async function requestSave() {
    if (saving) return;
    saveAsNew = false;
    if (currentId) {
      const choice = await message(
        '현재 입력과 설정으로 기존 저장 내용을 업데이트하거나 새 이름으로 따로 저장합니다.',
        {
          title: '현재 프로젝트에 저장할까요?',
          tone: 'confirm',
          confirmAction: true,
          actionLabel: '저장',
          altLabel: '다른 이름으로 저장'
        }
      );
      if (choice === 'alt') requestSaveAs();
      else if (choice) save($('projectName').value);
      return;
    }
    saveAsNew = true;
    showSaveDialog(suggestedName || `적재 계획 ${new Date().toLocaleDateString('ko-KR')}`);
  }
  function requestSaveAs() {
    if (saving) return;
    saveAsNew = true;
    showSaveDialog(
      currentId
        ? `${$('projectName').value} 복사본`
        : suggestedName || `적재 계획 ${new Date().toLocaleDateString('ko-KR')}`
    );
  }
  async function save(name) {
    name = name.trim();
    if (!name)
      return message('프로젝트를 구분할 수 있는 저장 이름을 입력해 주세요.', {
        title: '저장 이름이 필요합니다',
        tone: 'warning'
      });
    if (name.length > 80)
      return message('저장 이름은 80자 이내로 입력해 주세요.', { title: '저장 이름이 너무 깁니다', tone: 'warning' });
    saving = true;
    $('saveProject').disabled = true;
    $('confirmSave').disabled = true;
    state('저장 중…');
    const generation = linkGeneration;
    let savedId;
    try {
      if (user) {
        const row = {
            ...(!saveAsNew && currentId ? { id: currentId } : {}),
            user_id: user.id,
            name,
            payload: snapshot(),
            updated_at: new Date().toISOString()
          },
          { data, error } = await client.from('projects').upsert(row).select('id').single();
        if (error) throw error;
        savedId = data.id;
      } else {
        const rows = readLocal(),
          next = record(name, saveAsNew ? null : currentId),
          index = rows.findIndex(x => x.id === next.id);
        if (index >= 0) rows[index] = next;
        else rows.push(next);
        writeLocal(rows);
        savedId = next.id;
      }
      $('saveDialog').close();
      if (generation === linkGeneration) {
        currentId = savedId;
        showCurrent(name);
        dirty = false;
        state(savedLabel(), 'saved');
      }
    } catch (error) {
      console.error(error);
      state('저장 실패', 'error');
      message(error.message, { title: '프로젝트를 저장하지 못했습니다', tone: 'error' });
    } finally {
      saving = false;
      saveAsNew = false;
      $('saveProject').disabled = false;
      $('confirmSave').disabled = false;
    }
  }
  async function openList() {
    try {
      const rows = await list(),
        el = $('projectList');
      $('projectsDescription').textContent = user
        ? '내 계정에 저장된 적재 프로젝트입니다.'
        : '이 브라우저에 저장된 적재 프로젝트입니다.';
      el.innerHTML = rows.length
        ? rows
            .map(
              row =>
                `<article><button class="project-open" data-open="${escapeHtml(row.id)}"><strong>${escapeHtml(row.name)}</strong><small>${formatDate(row.updated_at)}</small></button><button class="project-delete" data-delete-project="${escapeHtml(row.id)}" aria-label="${escapeHtml(row.name)} 삭제">삭제</button></article>`
            )
            .join('')
        : '<p class="empty-projects">아직 저장된 프로젝트가 없습니다.</p>';
      el.querySelectorAll('[data-open]').forEach(b => (b.onclick = () => open(b.dataset.open)));
      el.querySelectorAll('[data-delete-project]').forEach(b => (b.onclick = () => remove(b.dataset.deleteProject)));
      if (!$('projectsDialog').open) $('projectsDialog').showModal();
    } catch (error) {
      message(error.message, { title: '저장 목록을 불러오지 못했습니다', tone: 'error' });
    }
  }
  async function open(id) {
    if (
      dirty &&
      !(await message('현재 변경사항은 저장되지 않습니다. 선택한 프로젝트를 불러오시겠습니까?', {
        title: '저장하지 않은 변경사항이 있습니다',
        tone: 'warning',
        confirmAction: true,
        actionLabel: '불러오기'
      }))
    )
      return;
    try {
      const row = (await list()).find(x => x.id === id);
      if (!row) return;
      suppressDirty = true;
      window.loadwiseProject.apply(row.payload);
      suppressDirty = false;
      linkGeneration++;
      currentId = row.id;
      showCurrent(row.name);
      $('projectsDialog').close();
      dirty = false;
      state(savedLabel(), 'saved');
      $('recalculateOptions').click();
    } catch (error) {
      suppressDirty = false;
      message(error.message, { title: '프로젝트를 불러오지 못했습니다', tone: 'error' });
    }
  }
  async function remove(id) {
    if (
      !(await message('삭제한 프로젝트는 복구할 수 없습니다.', {
        title: '이 저장을 삭제할까요?',
        tone: 'danger',
        confirmAction: true,
        actionLabel: '삭제'
      }))
    )
      return;
    try {
      if (user) {
        const { error } = await client.from('projects').delete().eq('id', id);
        if (error) throw error;
      } else writeLocal(readLocal().filter(x => x.id !== id));
      if (currentId === id) {
        currentId = null;
        showCurrent();
        dirty = true;
        state('저장되지 않음', 'dirty');
      }
      await openList();
    } catch (error) {
      message(error.message, { title: '프로젝트를 삭제하지 못했습니다', tone: 'error' });
    }
  }
  async function fresh(force = false) {
    if (
      !force &&
      dirty &&
      !(await message('현재 입력과 시뮬레이션 결과가 초기화됩니다.', {
        title: '새 프로젝트를 시작할까요?',
        tone: 'warning',
        confirmAction: true,
        actionLabel: '새로 시작'
      }))
    )
      return;
    location.reload();
  }
  async function googleLogin() {
    if (!client) return;
    if (!$('authConsent').checked) {
      $('authMessage').textContent = '이용약관과 개인정보처리방침 동의를 확인해 주세요.';
      return;
    }
    const button = $('googleLogin');
    button.disabled = true;
    $('authMessage').textContent = '동의 내용을 기록하고 Google 로그인 화면으로 이동합니다.';
    try {
      localStorage.setItem(LEGAL_CONSENT_PENDING_KEY, LEGAL_CONSENT_VERSION);
    } catch {}
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: location.origin + location.pathname,
        queryParams: { prompt: 'select_account' }
      }
    });
    if (error) {
      try {
        localStorage.removeItem(LEGAL_CONSENT_PENDING_KEY);
      } catch {}
      button.disabled = false;
      $('authMessage').textContent = 'Google 로그인을 시작하지 못했습니다.';
      message(error.message, { title: 'Google 로그인 설정을 확인해 주세요', tone: 'error' });
    }
  }
  async function logout() {
    if (
      dirty &&
      !(await message('저장하지 않은 변경사항은 사라질 수 있습니다.', {
        title: '로그아웃할까요?',
        tone: 'warning',
        confirmAction: true,
        actionLabel: '로그아웃'
      }))
    )
      return;
    await client?.auth.signOut();
  }
  async function syncAdminAccess() {
    if (!user) {
      isAdmin = false;
      recordedUserId = null;
      renderAccount();
      return;
    }
    if (recordedUserId !== user.id) {
      recordedUserId = user.id;
      const { error } = await client.rpc('record_user_access');
      if (error) console.error(error);
    }
    const { data, error } = await client.rpc('is_admin');
    isAdmin = !error && data === true;
    renderAccount();
  }
  async function openAdmin() {
    if (!isAdmin) return;
    const [{ data: access, error: accessError }, { data: admins, error: adminError }] = await Promise.all([
      client.rpc('admin_user_stats'),
      client.from('admin_users').select('email,created_at').order('created_at')
    ]);
    if (accessError || adminError) {
      message((accessError || adminError).message, { title: '관리자 통계를 불러오지 못했습니다', tone: 'error' });
      return;
    }
    const recent = Date.now() - 86400000;
    $('adminUserCount').textContent = access.length.toLocaleString();
    $('adminProjectCount').textContent = access
      .reduce((sum, row) => sum + Number(row.project_count || 0), 0)
      .toLocaleString();
    $('adminVisitCount').textContent = access
      .reduce((sum, row) => sum + Number(row.visit_count || 0), 0)
      .toLocaleString();
    $('adminRecentCount').textContent = access
      .filter(row => new Date(row.last_seen_at).getTime() >= recent)
      .length.toLocaleString();
    $('adminList').innerHTML = admins
      .map(
        row =>
          `<span>${escapeHtml(row.email)}${row.email === user.email.toLowerCase() ? ' · 나' : `<button type="button" data-revoke-admin="${escapeHtml(row.email)}">해제</button>`}</span>`
      )
      .join('');
    $('accessList').innerHTML = access.length
      ? access
          .map(
            row =>
              `<tr><td>${escapeHtml(row.email)}</td><td>${Number(row.project_count || 0).toLocaleString()}</td><td>${Number(row.simulation_count || 0).toLocaleString()}</td><td>${formatDate(row.first_seen_at)}</td><td>${formatDate(row.last_seen_at)}</td><td>${Number(row.visit_count).toLocaleString()}</td></tr>`
          )
          .join('')
      : '<tr><td class="admin-empty" colspan="6">아직 로그인 사용자 접속 기록이 없습니다.</td></tr>';
    $('adminList')
      .querySelectorAll('[data-revoke-admin]')
      .forEach(button => (button.onclick = () => revokeAdmin(button.dataset.revokeAdmin)));
    if (!$('adminDialog').open) $('adminDialog').showModal();
  }
  async function grantAdmin() {
    const email = $('adminEmail').value.trim().toLowerCase();
    if (!email || !$('adminEmail').checkValidity())
      return message('관리자로 등록할 올바른 이메일 주소를 입력해 주세요.', {
        title: '이메일을 확인해 주세요',
        tone: 'warning'
      });
    const { error } = await client.rpc('grant_admin', { p_email: email });
    if (error) return message(error.message, { title: '관리자 권한을 추가하지 못했습니다', tone: 'error' });
    $('adminEmail').value = '';
    await openAdmin();
    message(`${email}에 관리자 권한을 부여했습니다.`, { title: '관리자 권한 추가 완료', tone: 'success' });
  }
  async function revokeAdmin(email) {
    if (
      !(await message(`${email}의 관리자 권한을 해제합니다.`, {
        title: '관리자 권한을 해제할까요?',
        tone: 'danger',
        confirmAction: true,
        actionLabel: '권한 해제'
      }))
    )
      return;
    const { error } = await client.rpc('revoke_admin', { p_email: email });
    if (error) return message(error.message, { title: '관리자 권한을 해제하지 못했습니다', tone: 'error' });
    await openAdmin();
  }
  async function recordSimulation() {
    if (!user) return;
    const { error } = await client.rpc('record_simulation');
    if (error) console.error(error);
  }
  function renderAccount() {
    const signed = Boolean(user),
      button = $('accountButton'),
      menu = $('accountMenu');
    button.hidden = !configured || signed;
    button.textContent = '로그인';
    menu.hidden = !signed;
    if (!signed) menu.open = false;
    $('adminButton').hidden = !isAdmin;
    $('accountIdentity').querySelector('.account-email').textContent = signed ? user.email : '';
    $('accountIdentity').title = signed ? `${isAdmin ? '관리자 계정' : '클라우드 저장 계정'}: ${user.email}` : '';
    $('localNotice').hidden = signed;
    $('localNotice').textContent = configured
      ? '로그인 전에는 이 브라우저에만 저장됩니다.'
      : '이 브라우저에만 저장됩니다.';
    if (signed && $('accountDialog').open) $('accountDialog').close();
  }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '저장 날짜 없음' : date.toLocaleString('ko-KR');
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(
      /[&<>'"]/g,
      ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]
    );
  }
  async function init() {
    $('saveProject').onclick = requestSave;
    $('logoutButton').onclick = () => {
      $('accountMenu').open = false;
      logout();
    };
    $('confirmSave').onclick = () => save($('saveNameInput').value);
    $('saveNameInput').onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save(e.currentTarget.value);
      }
    };
    $('openProjects').onclick = openList;
    $('newProjectTop').onclick = () => fresh();
    $('accountButton').onclick = () => (user ? logout() : $('accountDialog').showModal());
    $('adminButton').onclick = openAdmin;
    $('grantAdmin').onclick = grantAdmin;
    $('adminEmail').onkeydown = e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        grantAdmin();
      }
    };
    $('googleLogin').onclick = googleLogin;
    $('authConsent').onchange = e => {
      $('googleLogin').disabled = !e.currentTarget.checked;
      $('authMessage').textContent = e.currentTarget.checked
        ? 'Google 계정 선택 화면으로 이동할 준비가 되었습니다.'
        : '동의 항목을 확인하면 Google 로그인을 진행할 수 있습니다.';
    };
    $('containerType').addEventListener('change', markDirty);
    $('safetyLevel').addEventListener('change', markDirty);
    $('preference').addEventListener('change', markDirty);
    $('transportMode').addEventListener('change', markDirty);
    if (client) {
      const { data } = await client.auth.getSession();
      user = data.session?.user || null;
      if (user?.user_metadata?.legal_consent_version !== LEGAL_CONSENT_VERSION) {
        let pendingConsent = false;
        try {
          pendingConsent = localStorage.getItem(LEGAL_CONSENT_PENDING_KEY) === LEGAL_CONSENT_VERSION;
        } catch {}
        if (pendingConsent) {
          const { data: updated, error } = await client.auth.updateUser({
            data: {
              legal_consent_version: LEGAL_CONSENT_VERSION,
              legal_consent_at: new Date().toISOString()
            }
          });
          if (error) {
            await client.auth.signOut();
            user = null;
            $('authMessage').textContent = '동의 기록을 저장하지 못했습니다. 다시 로그인해 주세요.';
          } else user = updated.user;
          try {
            localStorage.removeItem(LEGAL_CONSENT_PENDING_KEY);
          } catch {}
        } else {
          await client.auth.signOut();
          user = null;
          $('authMessage').textContent = '개정된 이용약관과 개인정보처리방침에 동의한 뒤 다시 로그인해 주세요.';
        }
      }
      await syncAdminAccess();
      client.auth.onAuthStateChange((_event, session) => {
        const next = session?.user || null;
        if (user?.id && user.id !== next?.id) {
          fresh(true);
          return;
        }
        user = next;
        syncAdminAccess();
      });
    }
    renderAccount();
    showCurrent();
    state('저장되지 않음');
  }
  window.loadwiseStorage = { markDirty, suggestName, detach };
  window.addEventListener('loadwise:simulation-complete', recordSimulation);
  window.addEventListener('DOMContentLoaded', init);
})();
