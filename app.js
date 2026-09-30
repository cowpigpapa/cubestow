const CONTAINERS = {
  '20ft': { name: '20ft Dry', l: 5898, w: 2352, h: 2393, maxWeight: 28200 },
  '40ft': { name: '40ft Dry', l: 12032, w: 2352, h: 2393, maxWeight: 26700 },
  '40hc': { name: '40ft High Cube', l: 12032, w: 2352, h: 2698, maxWeight: 26500 },
  '45hc': { name: '45ft High Cube', l: 13556, w: 2352, h: 2698, maxWeight: 27600 },
  // 한국 도로 운송 실무 한도(도로법 총중량 40t·축하중 10t에서 트랙터·샤시·컨테이너 자중을 뺀 값, 한국무역협회 안내: 20ft 최대 21t 미만, 40ft 25t 미만).
  // 명판 최대 중량보다 작으므로 도로로 나가는 컨테이너는 이 항목을 고르면 대수를 중량 기준으로 나눈다(예: 2t 케이블 드럼 20ft에 10개).
  '20ft-kr': { name: '한국 도로 한도 · 20ft Dry', l: 5898, w: 2352, h: 2393, maxWeight: 21000 },
  '40ft-kr': { name: '한국 도로 한도 · 40ft Dry', l: 12032, w: 2352, h: 2393, maxWeight: 25000 },
  '40hc-kr': { name: '한국 도로 한도 · 40ft High Cube', l: 12032, w: 2352, h: 2698, maxWeight: 25000 },
  '45hc-kr': { name: '한국 도로 한도 · 45ft High Cube', l: 13556, w: 2352, h: 2698, maxWeight: 25000 }
};
const COLORS = ['#16734f', '#ff8a4c', '#5a87ff', '#c28b38', '#8c6ad8', '#e15d71', '#43a6a1'];
const TRANSPORT_PROFILES = LoadwiseEngine.TRANSPORT_PROFILES;
const shipmentMinSupport = () => LoadwiseEngine.SAFETY_LEVELS[shipment?.safety]?.minSupport ?? 1;
const strategyLabel = (safety, preference) =>
  `${LoadwiseEngine.SAFETY_LEVELS[safety]?.label || '기본'} 기준 · ${LoadwiseEngine.PREFERENCES[preference]?.label || '추천'}`;
const currentTransportMode = () =>
  typeof document === 'undefined' ? 'combined' : $('transportMode')?.value || 'combined';
let products = [];
let result = null;
let shipment = null;
let fieldResult = null;
let activeContainer = 0;
let camera = { yaw: -2.51, pitch: 0.42, zoom: 1 };
let viewMode = 'iso';
let visibleStep = 0;
let playTimer = null;
let threeView = null;
let showDunnage = true;
// 사용할 고정재. 끈 고정재는 권고에서 다른 방법으로 대신한다.
let securingOptions = {
  airbag: true,
  filler: true,
  nails: true,
  lashing: true,
  friction: 'unknown',
  lashingMsl: 2000,
  anchors: 'iso'
};
let showAirbags = true;
let showCog = false;
let showAxes = true;
let simulationRunning = false,
  engineWorker = null,
  engineJob = 0;
// 입력이 바뀔 때마다 올라가는 번호. 계산이 끝났을 때 번호가 다르면 그 결과는 이미 낡은 것이라 버린다.
let inputVersion = 0,
  pendingRun = false,
  resultStale = false;
const $ = id => document.getElementById(id);
let messageResolver = null;
function showAppMessage(
  message,
  {
    title = '안내',
    tone = 'info',
    confirmAction = false,
    actionLabel = '확인',
    cancelLabel = '취소',
    altLabel = ''
  } = {}
) {
  const dialog = $('messageDialog');
  if (dialog.open) {
    dialog.close();
    messageResolver?.(false);
  }
  $('messageTitle').textContent = title;
  $('messageText').textContent = message;
  dialog.dataset.tone = tone;
  $('messageCancel').hidden = !confirmAction;
  $('messageCancel').textContent = cancelLabel;
  $('messageConfirm').textContent = actionLabel;
  $('messageAlt').hidden = !altLabel;
  $('messageAlt').textContent = altLabel;
  return new Promise(resolve => {
    const finish = value => {
      messageResolver = null;
      dialog.close();
      resolve(value);
    };
    messageResolver = resolve;
    $('messageConfirm').onclick = () => finish(true);
    $('messageCancel').onclick = () => finish(false);
    $('messageAlt').onclick = () => finish('alt');
    dialog.oncancel = e => {
      e.preventDefault();
      finish(false);
    };
    dialog.showModal();
  });
}
if (typeof window !== 'undefined') window.showAppMessage = showAppMessage;

function init() {
  // 선택지에 내부 치수와 최대 중량을 바로 보여 준다(따로 치수 칸을 두지 않는다).
  $('containerType').innerHTML = Object.entries(CONTAINERS)
    .map(
      ([k, c]) =>
        `<option value="${k}">${c.name} (${(c.l / 1000).toFixed(2)} × ${(c.w / 1000).toFixed(2)} × ${(c.h / 1000).toFixed(2)} m · 최대 ${(c.maxWeight / 1000).toFixed(1)} t)</option>`
    )
    .join('');
  ['productShape', 'containerType'].forEach(id => enhanceSelect($(id)));
  enhanceSafetySlider();
  enhanceUnitFields();
  enhanceSegmented($('preference'), PREFERENCE_HINTS);
  enhanceSegmented($('transportMode'), TRANSPORT_HINTS);
  suggestFromHistory($('productName'), 'names');
  suggestFromHistory($('productGroup'), 'groups');
  bindEvents();
  updateContainerSpec();
  renderProducts();
  resizeCanvas();
}
// 제품명·제품군 입력 이력. 이 브라우저에만 최근 12개를 저장하고, 입력칸 아래에 추천 목록으로 보여 준다.
const HISTORY_KEY = 'cubestow.productHistory',
  HISTORY_LIMIT = 12;
function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return {
      names: Array.isArray(data.names) ? data.names : [],
      groups: Array.isArray(data.groups) ? data.groups : []
    };
  } catch {
    return { names: [], groups: [] };
  }
}
function rememberProduct(name, group) {
  const data = readHistory(),
    push = (list, value) => (value ? [value, ...list.filter(v => v !== value)].slice(0, HISTORY_LIMIT) : list);
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify({ names: push(data.names, name), groups: push(data.groups, group) })
    );
  } catch {}
}
function suggestFromHistory(input, kind) {
  const box = document.createElement('div'),
    list = document.createElement('ul');
  let items = [],
    active = -1;
  box.className = 'suggest-box';
  list.className = 'select-list';
  list.setAttribute('role', 'listbox');
  input.before(box);
  box.append(input, list);
  input.setAttribute('aria-autocomplete', 'list');
  const setOpen = open => box.classList.toggle('open', open && items.length > 0);
  const render = () => {
    const query = input.value.trim().toLowerCase();
    items = readHistory()[kind].filter(v => v.toLowerCase().includes(query) && v !== input.value.trim());
    active = -1;
    list.innerHTML = items
      .map((v, i) => `<li role="option" data-index="${i}" aria-selected="false">${esc(v)}</li>`)
      .join('');
    setOpen(document.activeElement === input);
  };
  const pick = i => {
    input.value = items[i];
    setOpen(false);
  };
  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('blur', () => setTimeout(() => setOpen(false), 120));
  input.addEventListener('keydown', e => {
    if (!box.classList.contains('open')) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') setOpen(false);
  });
  list.addEventListener('mousedown', e => {
    e.preventDefault();
    const item = e.target.closest('li');
    if (item) pick(+item.dataset.index);
  });
}
// 조건 선택상자: 운영체제 기본 목록은 열릴 때 깜박이므로 같은 값을 가진 부드러운 목록으로 보여 준다.
// 값과 change 이벤트는 원래 select가 그대로 가지며, 코드가 값을 바꾸면 syncSelects()로 표시를 맞춘다.
const selectRenderers = [];
function syncSelects() {
  selectRenderers.forEach(render => render());
}
// 안전 수준 슬라이더: 적재량 우선 ↔ 기본 ↔ CTU 기준 적용. 단계마다 무엇을 지키는지 한 줄로 보여 준다.
const SAFETY_STEPS = ['standard', 'strict', 'secure'];
// 세 단계 모두 3줄. 설명칸 높이를 고정해 슬라이더를 움직여도 화면이 흔들리지 않게 한다.
const SAFETY_HINTS = {
  standard: [
    '윗 화물 바닥면 70% 이상만 받치면 됩니다',
    '충돌·중량·상부하중 같은 기본 조건만 지킵니다',
    '컨테이너 대수를 가장 적게 씁니다'
  ],
  strict: [
    '윗 화물 바닥면을 100% 받칩니다',
    '높은 적층·원통 규칙을 지킵니다',
    '남는 틈과 윗단은 고정재(에어백·래싱)로 막습니다'
  ],
  secure: [
    '모든 화물의 안쪽·좌·우를 화물이나 고정재로 막습니다',
    '다른 크기 화물 위에 따로 얹지 않습니다',
    '래싱을 끄면 CTU 전도 기준을 모든 화물에 적용합니다'
  ]
};
const PREFERENCE_HINTS = {
  auto: '무게 배분이 좋은 배치를 먼저 고르고, 좌우·앞뒤 편차와 운송 안정성을 차례로 비교합니다',
  density: '안쪽으로 바짝 붙여 사용 길이가 가장 짧고 빈틈이 적은 배치를 고릅니다',
  balance: '앞뒤·좌우 무게 편차가 가장 작은 배치를 고릅니다(화물 사이를 벌릴 수 있음)'
};
const TRANSPORT_HINTS = {
  // 첫 줄은 한 문장, 둘째 줄은 가속도(설명 상자는 줄바꿈을 그대로 보여 준다).
  road: '도로 기준으로 계산합니다\n(좌우 0.5g, 급정거 0.8g)',
  combined: '도로와 해상 중 불리한 값을 씁니다 (권장)',
  sea: '거친 해역 기준으로 계산합니다\n(좌우 0.8g, 앞뒤 0.4g)'
};
let ctuNoticeShown = false;
const CTU_NOTICE =
  '화물끼리 서로 막히는 배치를 먼저 찾고, 그 때문에 컨테이너가 늘면 기본 배치를 쓰되 화물로 막히지 않은 면을 고정재 권고에 화물별로 적습니다. 계산이 20~40초 걸릴 수 있습니다. 이 모드는 CTU Code의 배치 규칙을 적용한 검토용 결과이며 준수를 보증하지 않습니다. 화물 강도·마찰·래싱 용량은 현장에서 따로 확인하세요.';
// 단위(kg·mm)를 입력칸 안, 입력한 숫자(비어 있으면 예시 숫자) 바로 뒤에 붙여 보여 준다(예: 100kg). 값은 숫자 그대로 둔다.
// 코드에서 value를 바꿀 때(편집·초기화·기록 제안)도 위치가 맞도록 value 설정을 감싼다.
function enhanceUnitFields() {
  const measure = document.createElement('canvas').getContext('2d'),
    native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const fields = [...document.querySelectorAll('.unit-field')].map(field => {
    const input = field.querySelector('input'),
      suffix = field.querySelector('.unit-suffix');
    const place = () => {
      const value = native.get.call(input),
        text = value || input.placeholder;
      field.classList.toggle('has-value', value !== '');
      field.classList.toggle('is-empty', value === '');
      if (text === '') return;
      const style = getComputedStyle(input);
      measure.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      // 단위는 숫자와 같은 글꼴·크기·굵기로 보여 준다.
      suffix.style.font = measure.font;
      const left = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth) - input.scrollLeft;
      suffix.style.left = `${left + measure.measureText(text).width + 1}px`;
    };
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => native.get.call(input),
      set: v => {
        native.set.call(input, v);
        place();
      }
    });
    input.addEventListener('input', place);
    input.addEventListener('change', place);
    place();
    return place;
  });
  document.fonts?.ready.then(() => fields.forEach(place => place()));
}
function enhanceSafetySlider() {
  const select = $('safetyLevel'),
    slider = $('safetySlider');
  const render = () => {
    const i = Math.max(0, SAFETY_STEPS.indexOf(select.value));
    slider.value = String(i);
    slider.style.setProperty('--fill', `${i * 50}%`);
    $('safetyLabel').textContent = select.selectedOptions[0]?.textContent || '';
    $('safetyHint').innerHTML =
      `<ul>${(SAFETY_HINTS[select.value] || []).map(line => `<li>${esc(line)}</li>`).join('')}</ul>`;
    slider.closest('.safety-field').dataset.level = select.value;
  };
  slider.oninput = () => {
    const value = SAFETY_STEPS[+slider.value];
    if (value !== select.value) {
      select.value = value;
      select.dispatchEvent(new Event('change'));
    }
    render();
  };
  // CTU 기준은 처음 고를 때 한 번 팝업으로 알린다(아래로 내려 읽지 않아도 되게).
  slider.onchange = () => {
    if (select.value === 'secure' && !ctuNoticeShown) {
      ctuNoticeShown = true;
      showAppMessage(CTU_NOTICE, { title: 'CTU 기준 적용', tone: 'info' });
    }
  };
  // 슬라이더 아래 글자(적재량 우선·기본·CTU 기준 적용)를 눌러도 그 단계로 옮긴다.
  slider
    .closest('.field-control')
    ?.querySelectorAll('.slider-stops span')
    .forEach((stop, i) => {
      stop.addEventListener('click', () => {
        if (slider.value === String(i)) return;
        slider.value = String(i);
        slider.oninput();
        slider.onchange();
      });
    });
  selectRenderers.push(render);
  render();
}
// 3칸 버튼: 숨긴 select의 값을 그대로 쓰고, 누르면 change를 보낸다.
function enhanceSegmented(select, hints = {}) {
  // 설명은 조작부(field-control) 뒤, 칸(option-field)의 둘째 요소로 둔다(넓은 화면에서 설명끼리 한 줄에 맞춘다).
  const group = select.parentElement.querySelector('.segmented'),
    hint = document.createElement('p');
  hint.className = 'segment-hint';
  hint.setAttribute('aria-live', 'polite');
  (select.closest('.option-field') || group.parentElement).append(hint);
  const render = () => {
    group.innerHTML = [...select.options]
      .map(
        o =>
          `<button type="button" role="radio" aria-checked="${o.selected}" data-value="${o.value}">${esc(o.textContent)}</button>`
      )
      .join('');
    hint.textContent = hints[select.value] || '';
  };
  group.onclick = event => {
    const button = event.target.closest('button[data-value]');
    if (!button || button.dataset.value === select.value) return;
    select.value = button.dataset.value;
    select.dispatchEvent(new Event('change'));
    render();
  };
  selectRenderers.push(render);
  render();
}
function enhanceSelect(select) {
  const box = document.createElement('div'),
    button = document.createElement('button'),
    list = document.createElement('ul');
  box.className = 'select-box';
  button.type = 'button';
  button.className = 'select-button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  list.className = 'select-list';
  list.setAttribute('role', 'listbox');
  select.before(box);
  box.append(button, select, list);
  select.classList.add('native-select');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');
  const render = () => {
    button.textContent = select.selectedOptions[0]?.textContent || '';
    list.innerHTML = [...select.options]
      .map((o, i) => `<li role="option" data-index="${i}" aria-selected="${o.selected}">${esc(o.textContent)}</li>`)
      .join('');
  };
  const setOpen = open => {
    box.classList.toggle('open', open);
    button.setAttribute('aria-expanded', String(open));
  };
  const choose = index => {
    if (index < 0 || index >= select.options.length || index === select.selectedIndex) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change'));
    render();
  };
  button.onclick = () => {
    const open = !box.classList.contains('open');
    document.querySelectorAll('.select-box.open').forEach(other => other !== box && other.classList.remove('open'));
    if (open) render();
    setOpen(open);
  };
  button.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      choose(select.selectedIndex + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Escape') setOpen(false);
  };
  list.onclick = e => {
    e.preventDefault();
    const item = e.target.closest('li');
    if (!item) return;
    choose(+item.dataset.index);
    setOpen(false);
    button.focus();
  };
  document.addEventListener('click', e => {
    if (!box.contains(e.target)) setOpen(false);
  });
  selectRenderers.push(render);
  render();
}
function bindEvents() {
  $('guideButton').onclick = () => $('guideDialog').showModal();
  $('policyButton').onclick = () => $('policyDialog').showModal();
  $('ctuButton').onclick = () => $('ctuDialog').showModal();
  $('openImport').onclick = () => $('importDialog').showModal();
  // 입력칸을 누르면 값 전체를 선택해 바로 덮어쓸 수 있게 한다. 포커스 즉시 선택하고, 클릭을 뗄 때 선택이 풀리는 기본 동작만 한 번 막는다.
  document.addEventListener('focusin', e => {
    const input = e.target;
    if (!input.matches?.('.form-grid input,[data-qty-input]')) return;
    input.select();
    const keep = ev => ev.preventDefault();
    input.addEventListener('mouseup', keep, { once: true });
    setTimeout(() => input.removeEventListener('mouseup', keep), 500);
  });
  $('dropzone').onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('fileInput').click();
    }
  };
  $('addProduct').onclick = addProduct;
  $('loadDemo').onclick = () => $('sampleDialog').showModal();
  // 첫 화면 두 갈래: 샘플 창 열기 / 제품명 입력란으로 이동
  if ($('emptySample')) $('emptySample').onclick = () => $('sampleDialog').showModal();
  if ($('emptyInput'))
    $('emptyInput').onclick = () => {
      if (typeof setInputCollapsed === 'function') setInputCollapsed(false);
      if (typeof setPanelHidden === 'function') setPanelHidden(false);
      const el = $('productName');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
    };
  renderSampleList();
  // 드롭다운 메뉴는 항목을 누르거나 바깥을 누르면 닫는다.
  document.addEventListener('click', event =>
    document.querySelectorAll('details.menu[open]').forEach(menu => {
      if (!menu.contains(event.target) || event.target.closest('.menu-list button')) menu.open = false;
    })
  );
  $('containerType').onchange = () => {
    updateContainerSpec();
    markSimulationChanged();
  };
  $('safetyLevel').onchange = markSimulationChanged;
  $('preference').onchange = markSimulationChanged;
  $('transportMode').onchange = markSimulationChanged;
  $('recalculateOptions').onclick = simulate;
  $('fileInput').onchange = async e => {
    await readFile(e.target.files[0]);
    e.target.value = '';
  };
  $('downloadTemplate').onclick = downloadTemplate;
  $('exportPlan').onclick = exportPlan;
  $('exportPdf').onclick = exportPdf;
  $('toggleSequence').onclick = toggleSequence;
  document.querySelector('.plan-head').onclick = e => {
    if (!e.target.closest('button')) toggleSequence();
  };
  $('toggleProducts').onclick = toggleProductList;
  $('toggleInput').onclick = () =>
    setInputCollapsed(!document.querySelector('.input-card').classList.contains('input-collapsed'));
  $('togglePanel').onclick = () => setPanelHidden(!$('planner').classList.contains('panel-hidden'));
  try {
    if (localStorage.getItem(UI_INPUT_KEY) === '1') setInputCollapsed(true);
    if (localStorage.getItem(UI_PANEL_KEY) === '1') setPanelHidden(true);
  } catch {}
  $('viewIso').onclick = () => setView('iso');
  $('viewTop').onclick = () => setView('top');
  $('viewDoor').onclick = () => setView('door');
  $('viewLeft').onclick = () => setView('left');
  $('viewRight').onclick = () => setView('right');
  $('viewCog').onclick = toggleCenterOfGravity;
  $('viewAxes').onclick = () => {
    showAxes = !showAxes;
    const button = $('viewAxes');
    button.classList.toggle('active', showAxes);
    button.setAttribute('aria-pressed', String(showAxes));
    button.querySelector('b').textContent = showAxes ? 'ON' : 'OFF';
    draw();
  };
  document
    .querySelectorAll('i.securing-icon[data-icon]')
    .forEach(i => (i.innerHTML = SECURING_ICONS[i.dataset.icon] || ''));
  // 고정 조건(마찰·래싱 MSL·고정점): 바꾸면 고정재 계획을 다시 계산해야 한다.
  for (const [id, key] of [
    ['securingFriction', 'friction'],
    ['lashingMsl', 'lashingMsl'],
    ['anchorRating', 'anchors']
  ]) {
    const el = $(id);
    if (el)
      el.onchange = () => {
        securingOptions = { ...securingOptions, [key]: key === 'lashingMsl' ? Number(el.value) : el.value };
        renderSecuringOptions();
        markSimulationChanged();
      };
  }
  $('securingChips').onclick = event => {
    const chip = event.target.closest('button[data-key]');
    if (!chip) return;
    securingOptions = { ...securingOptions, [chip.dataset.key]: !securingOptions[chip.dataset.key] };
    renderSecuringOptions();
    markSimulationChanged();
  };
  renderSecuringOptions();
  $('saveField').onclick = saveFieldResult;
  $('toggleDunnage').onclick = () => toggleSecuringVisibility('dunnage');
  $('toggleAirbags').onclick = () => toggleSecuringVisibility('airbags');
  $('resetView').onclick = () => {
    camera = { yaw: -2.51, pitch: 0.42, zoom: 1 };
    setView('iso');
  };
  $('prevStep').onclick = () => setStep(visibleStep - 1);
  $('nextStep').onclick = () => setStep(visibleStep + 1);
  $('playSteps').onclick = togglePlayback;
  $('stepRange').oninput = e => setStep(+e.target.value);
  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(x =>
    dz.addEventListener(x, e => {
      e.preventDefault();
      dz.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach(x =>
    dz.addEventListener(x, e => {
      e.preventDefault();
      dz.classList.remove('drag');
    })
  );
  dz.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
  let dragging = false,
    last = { x: 0, y: 0 };
  const canvas = $('loadingCanvas');
  canvas.addEventListener('pointerdown', e => {
    if (viewMode !== 'iso') return;
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    camera.yaw += (e.clientX - last.x) * 0.008;
    camera.pitch = Math.max(0.1, Math.min(1.1, camera.pitch + (e.clientY - last.y) * 0.006));
    last = { x: e.clientX, y: e.clientY };
    draw();
  });
  canvas.addEventListener('pointerup', () => (dragging = false));
  canvas.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      camera.zoom = Math.max(0.55, Math.min(2, camera.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
      draw();
    },
    { passive: false }
  );
  window.addEventListener('resize', () => {
    resizeCanvas();
    syncSequenceHeight();
  });
}
// 목록에서 고른 제품을 입력칸으로 불러와 모든 값을 고칠 수 있게 한다. 추가·저장 후에는 입력칸을 비운다.
let editingIndex = -1;
function clearProductForm() {
  for (const id of [
    'productName',
    'productGroup',
    'productWeight',
    'productMaxTopLoad',
    'productLength',
    'productWidth',
    'productHeight'
  ])
    $(id).value = '';
  $('productQty').value = '1';
  $('productShape').value = 'box';
  $('allowRotation').checked = false;
  $('fragile').checked = false;
  syncSelects();
}
function editProduct(index) {
  const p = products[index];
  if (!p) return;
  setInputCollapsed(false);
  if ($('planner').classList.contains('panel-hidden')) setPanelHidden(false);
  editingIndex = index;
  $('productName').value = p.name;
  $('productGroup').value = p.group === '기타' ? '' : p.group;
  $('productShape').value = p.shape;
  $('productQty').value = p.qty;
  $('productWeight').value = p.weight;
  $('productMaxTopLoad').value = Number.isFinite(p.maxTopLoadKg) ? p.maxTopLoadKg : '';
  $('productLength').value = p.l;
  $('productWidth').value = p.w;
  $('productHeight').value = p.h;
  $('allowRotation').checked = p.rotate;
  $('fragile').checked = p.fragile;
  syncSelects();
  document.querySelector('.input-card').classList.add('editing');
  $('inputHint').textContent = `${p.name} 수정 중`;
  $('addProduct').innerHTML = '변경 내용 저장 <b aria-hidden="true">✓</b>';
  renderProducts();
  document.querySelector('.input-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  $('productName').focus({ preventScroll: true });
}
function stopEditing() {
  editingIndex = -1;
  document.querySelector('.input-card').classList.remove('editing');
  $('inputHint').textContent = '';
  $('addProduct').innerHTML = '제품 목록에 추가 <b aria-hidden="true">↓</b>';
}
function cancelEditing() {
  stopEditing();
  clearProductForm();
  renderProducts();
}
function addProduct() {
  const topLoad = $('productMaxTopLoad').value,
    p = {
      name: $('productName').value.trim(),
      group: $('productGroup').value.trim() || '기타',
      shape: $('productShape').value,
      qty: +$('productQty').value,
      l: +$('productLength').value,
      w: +$('productWidth').value,
      h: +$('productHeight').value,
      weight: +$('productWeight').value,
      maxTopLoadKg: topLoad === '' ? null : +topLoad,
      rotate: $('allowRotation').checked,
      fragile: $('fragile').checked
    };
  // 틀린 칸을 하나씩 짚어 주고 첫 번째 칸에 커서를 둔다.
  const problems = [
    !p.name && ['productName', '제품명을 입력하세요'],
    !(Number.isInteger(p.qty) && p.qty >= 1) && ['productQty', '수량은 1 이상의 정수여야 합니다'],
    !(p.weight > 0) && ['productWeight', '개당 중량은 0보다 커야 합니다'],
    !(p.l > 0) && ['productLength', '길이는 0보다 커야 합니다'],
    !(p.w > 0) && ['productWidth', '너비는 0보다 커야 합니다'],
    !(p.h > 0) && ['productHeight', '높이는 0보다 커야 합니다'],
    p.maxTopLoadKg != null &&
      !(Number.isFinite(p.maxTopLoadKg) && p.maxTopLoadKg >= 0) && [
        'productMaxTopLoad',
        '상부 허용하중은 0 이상이어야 합니다'
      ]
  ].filter(Boolean);
  if (problems.length) {
    showAppMessage(problems.map(([, text]) => text).join('\n'), {
      title: '제품 정보를 확인해 주세요',
      tone: 'warning'
    }).then(() => $(problems[0][0]).focus());
    return;
  }
  const fit = productFitIssue(p, CONTAINERS[$('containerType').value]);
  if (fit) {
    showAppMessage(`${p.name}: ${fit}`, { title: '컨테이너에 들어갈 수 없는 제품입니다', tone: 'warning' });
    return;
  }
  rememberProduct(p.name, $('productGroup').value.trim());
  if (editingIndex >= 0) {
    products[editingIndex] = { ...products[editingIndex], ...p };
    stopEditing();
  } else {
    p.id = Date.now() + Math.random();
    p.color = COLORS[products.length % COLORS.length];
    products.push(p);
  }
  clearProductForm();
  markSimulationChanged();
  renderProducts();
  window.loadwiseStorage?.suggestName(`${p.name} 적재`);
}
// 입력 단계 검증: 고른 컨테이너에 들어갈 수 없는 치수·중량은 계산 전에 무엇이 얼마나 넘는지 구체적으로 알린다.
// 엔진과 같은 기준이다: 눕혀서 적재 가능이 꺼져 있으면 높이는 그대로 두고 바닥면만 90° 돌릴 수 있다.
function productFitIssue(p, c) {
  if (!c) return '';
  const mm = v => `${Math.round(v).toLocaleString()}mm`;
  if (p.weight > c.maxWeight)
    return `개당 중량 ${p.weight.toLocaleString()}kg이 ${c.name} 허용 중량 ${c.maxWeight.toLocaleString()}kg을 넘습니다`;
  if (p.rotate) {
    const dims = [p.l, p.w, p.h].sort((a, b) => a - b),
      box = [c.w, c.h, c.l].sort((a, b) => a - b),
      names = ['가장 짧은 변', '중간 변', '가장 긴 변'],
      i = dims.findIndex((d, k) => d > box[k]);
    return i < 0
      ? ''
      : `${names[i]} ${mm(dims[i])}가 ${c.name}에 어느 방향으로 눕혀도 들어가지 않습니다(내부 ${c.l}×${c.w}×${c.h}mm)`;
  }
  if (p.h > c.h) return `높이 ${mm(p.h)}가 ${c.name} 높이 ${mm(c.h)}를 넘습니다(눕혀서 적재 가능이 꺼져 있음)`;
  const short = Math.min(p.l, p.w),
    long = Math.max(p.l, p.w);
  if (short > c.w) return `짧은 변 ${mm(short)}가 ${c.name} 폭 ${mm(c.w)}를 넘습니다`;
  if (long > c.l) return `긴 변 ${mm(long)}가 ${c.name} 길이 ${mm(c.l)}를 넘습니다`;
  return '';
}
function renderSampleList(filter = '전체') {
  const modes = { sea: '해상', combined: '복합', road: '육상' },
    units = s => s.products.reduce((sum, p) => sum + p.qty, 0);
  $('sampleFilters').innerHTML = ['전체', ...SAMPLE_CATEGORIES]
    .map(c => `<button type="button" data-sample-filter="${c}" aria-pressed="${c === filter}">${c}</button>`)
    .join('');
  $('sampleList').innerHTML = Object.entries(SAMPLE_SETS)
    .filter(([, s]) => filter === '전체' || s.category === filter)
    .map(
      ([id, s]) =>
        `<li><button type="button" data-sample="${id}"><b>${String(id).padStart(2, '0')}</b><span><strong>${esc(s.name)}</strong><small>${esc(s.description)}</small></span><em>${esc(s.category)} · ${CONTAINERS[s.container]?.name || ''} · ${modes[s.mode] || ''} · ${units(s)}개</em></button></li>`
    )
    .join('');
  document
    .querySelectorAll('[data-sample-filter]')
    .forEach(button => (button.onclick = () => renderSampleList(button.dataset.sampleFilter)));
  document
    .querySelectorAll('[data-sample]')
    .forEach(button => (button.onclick = () => loadDemo(+button.dataset.sample)));
}
function loadDemo(number = 1) {
  if (editingIndex >= 0) {
    stopEditing();
    clearProductForm();
  }
  const sample = SAMPLE_SETS[number] || SAMPLE_SETS[1];
  if (CONTAINERS[sample.container]) {
    $('containerType').value = sample.container;
    updateContainerSpec();
  }
  if (sample.mode) $('transportMode').value = sample.mode;
  products = sample.products.map((p, i) => ({ ...p, id: Date.now() + i, color: COLORS[i % COLORS.length] }));
  $('sampleDialog').close();
  renderProducts();
  window.loadwiseStorage?.detach(`샘플 ${number} · ${sample.name}`);
  markSimulationChanged();
  simulate();
  document.querySelector('#planner').scrollIntoView({ behavior: 'smooth' });
}
function renderProducts() {
  const total = products.reduce((s, p) => s + p.qty, 0);
  $('productCount').textContent = `(${products.length}개 품목 · ${total}박스)`;
  $('recalculateOptions').disabled = !products.length || editingIndex >= 0;
  $('recalculateOptions').title = editingIndex >= 0 ? '수정 중인 제품을 저장하거나 취소하세요' : '';
  $('productList').innerHTML = products.length
    ? products
        .map(
          (p, i) =>
            `<div class="product-item${i === editingIndex ? ' editing' : ''}"><span class="product-color" style="background:${p.color};border-radius:${p.shape === 'cylinder' ? '50%' : '5px'}"></span><div><div class="product-title-row"><strong>${esc(p.name)}</strong><div class="qty-stepper" aria-label="${esc(p.name)} 수량"><span>수량</span><input type="number" min="1" step="1" value="${p.qty}" data-qty-input="${i}" ${i === editingIndex ? 'disabled' : ''} aria-label="${esc(p.name)} 수량 직접 입력"><span class="qty-arrows"><button type="button" data-qty-up="${i}" aria-label="수량 증가" ${i === editingIndex ? 'disabled' : ''}>▲</button><button type="button" data-qty-down="${i}" aria-label="수량 감소" ${p.qty <= 1 || i === editingIndex ? 'disabled' : ''}>▼</button></span></div></div><small>${esc(p.group)} · ${p.shape === 'cylinder' ? '원통형' : '박스형'} · ${p.l}×${p.w}×${p.h} mm · ${p.weight} kg${Number.isFinite(p.maxTopLoadKg) ? ` · 상부 허용 ${p.maxTopLoadKg} kg` : ''}</small><div class="product-options"><label><input type="checkbox" data-lay="${i}" ${p.rotate ? 'checked' : ''} ${i === editingIndex ? 'disabled' : ''}> 눕힘 허용</label><label><input type="checkbox" data-fragile="${i}" ${p.fragile ? 'checked' : ''} ${i === editingIndex ? 'disabled' : ''}> 상부 적재 금지</label></div></div><div class="product-actions"><button class="edit-product${i === editingIndex ? ' cancel' : ''}" type="button" data-edit-button="${i}" aria-label="${esc(p.name)} ${i === editingIndex ? '수정 취소' : '수정'}">${i === editingIndex ? '취소' : '수정'}</button>${i === editingIndex ? `<button class="delete-product" type="button" data-delete="${i}" aria-label="${esc(p.name)} 삭제">삭제</button>` : ''}</div></div>`
        )
        .join('')
    : '<div class="list-empty">아직 등록된 제품이 없습니다.</div>';
  document.querySelectorAll('[data-delete]').forEach(
    b =>
      (b.onclick = () => {
        const index = +b.dataset.delete;
        products.splice(index, 1);
        if (index === editingIndex) cancelEditing();
        else {
          if (index < editingIndex) editingIndex--;
          renderProducts();
        }
        markSimulationChanged();
      })
  );
  // 수정 버튼으로 입력칸에 불러오고, 편집 중인 제품에서는 같은 버튼이 취소가 된다.
  document.querySelectorAll('[data-edit-button]').forEach(
    button =>
      (button.onclick = () => {
        const index = +button.dataset.editButton;
        if (index === editingIndex) cancelEditing();
        else editProduct(index);
      })
  );
  document
    .querySelectorAll('[data-qty-up]')
    .forEach(button => (button.onclick = () => changeProductQty(+button.dataset.qtyUp, 1)));
  document
    .querySelectorAll('[data-qty-down]')
    .forEach(button => (button.onclick = () => changeProductQty(+button.dataset.qtyDown, -1)));
  document.querySelectorAll('[data-qty-input]').forEach(input => {
    input.onchange = () => setProductQty(+input.dataset.qtyInput, input.value);
    input.onkeydown = e => {
      if (e.key === 'Enter') {
        input.blur();
        e.preventDefault();
      }
    };
  });
  document.querySelectorAll('[data-lay]').forEach(
    input =>
      (input.onchange = () => {
        products[+input.dataset.lay].rotate = input.checked;
        markSimulationChanged();
      })
  );
  document.querySelectorAll('[data-fragile]').forEach(
    input =>
      (input.onchange = () => {
        products[+input.dataset.fragile].fragile = input.checked;
        markSimulationChanged();
      })
  );
}

function projectSnapshot() {
  let resultSummary = null;
  if (shipment) {
    const outcome = shipmentOutcome(shipment);
    resultSummary = {
      state: outcome.state,
      loaded: outcome.loaded,
      total: outcome.total,
      containerCount: shipment.containers.length,
      totalWeight: shipment.containers.reduce((sum, load) => sum + load.totalWeight, 0),
      calculatedAt: new Date().toISOString()
    };
  }
  return LoadwiseProjectModel.createSnapshot(
    products,
    $('containerType').value,
    { safety: $('safetyLevel').value, preference: $('preference').value },
    {
      algorithmVersion: LoadwiseProjectModel.CURRENT_ALGORITHM_VERSION,
      transportMode: $('transportMode').value,
      securing: securingOptions,
      resultSummary,
      fieldResult
    }
  );
}
function applyProjectSnapshot(snapshot) {
  if (editingIndex >= 0) {
    stopEditing();
    clearProductForm();
  }
  const data = LoadwiseProjectModel.normalizeSnapshot(snapshot);
  products = data.products.map((p, i) => ({ ...p, id: Date.now() + i, color: COLORS[i % COLORS.length] }));
  fieldResult = data.fieldResult;
  $('containerType').value = data.containerType;
  $('safetyLevel').value = data.safety;
  $('preference').value = data.preference === 'width' ? 'auto' : data.preference;
  $('transportMode').value = data.transportMode;
  securingOptions = { ...data.securing };
  renderSecuringOptions();
  result = null;
  shipment = null;
  activeContainer = 0;
  visibleStep = 0;
  $('balanceCard').hidden = true;
  $('exportPdf').disabled = true;
  updateContainerSpec();
  renderProducts();
  markSimulationChanged();
  resizeCanvas();
  draw();
}
function resetProject() {
  applyProjectSnapshot({
    products: [],
    containerType: '20ft',
    safety: 'strict',
    preference: 'auto',
    transportMode: 'combined'
  });
}
if (typeof window !== 'undefined')
  window.loadwiseProject = {
    algorithmVersion: LoadwiseProjectModel.CURRENT_ALGORITHM_VERSION,
    snapshot: projectSnapshot,
    apply: applyProjectSnapshot,
    reset: resetProject
  };
function changeProductQty(index, delta) {
  if (!products[index]) return;
  products[index].qty = Math.max(1, products[index].qty + delta);
  renderProducts();
  markSimulationChanged();
}
function setProductQty(index, value) {
  if (!products[index]) return;
  const qty = Math.max(1, Math.floor(Number(value) || 1));
  if (products[index].qty === qty) {
    renderProducts();
    return;
  }
  products[index].qty = qty;
  renderProducts();
  markSimulationChanged();
}
function markSimulationChanged() {
  syncSelects();
  inputVersion++;
  resultStale = true;
  window.loadwiseStorage?.markDirty();
  for (const id of ['exportPdf', 'exportPlan']) {
    $(id).disabled = true;
    $(id).title = '입력이 바뀌어 다시 계산한 뒤 내보낼 수 있습니다.';
  }
  $('recalculateOptions').classList.add('needs-update');
  $('recalculateOptions').innerHTML = '<span class="run-label">다시 계산</span> <b>→</b>';
}
// 컨테이너 치수와 최대 중량은 선택지 이름에 들어 있다. 선택 표시만 갱신한다.
function updateContainerSpec() {
  syncSelects();
}

function runPackingEngine(input, onProgress = () => {}) {
  const local = () =>
    new Promise((resolve, reject) =>
      setTimeout(() => {
        try {
          resolve(LoadwiseEngine.packShipment({ ...input, onProgress }));
        } catch (error) {
          reject(error);
        }
      }, 0)
    );
  if (!engineWorker && typeof Worker !== 'undefined' && location.protocol !== 'file:')
    try {
      engineWorker = new Worker('engine-worker.js?v=20260930-9');
    } catch {
      engineWorker = null;
    }
  if (!engineWorker) return local();
  const id = ++engineJob,
    worker = engineWorker;
  return new Promise((resolve, reject) => {
    worker.onmessage = e => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === 'progress') onProgress(m.value);
      else if (m.type === 'done') resolve(m.result);
      else reject(new Error(m.message));
    };
    worker.onerror = e => {
      e.preventDefault?.();
      worker.terminate();
      engineWorker = null;
      local().then(resolve, reject);
    };
    worker.postMessage({ id, input });
  });
}
function updateSimulationProgress(status, progress, label = '배치 후보 계산 중') {
  const percent = Math.max(0, Math.min(100, Math.round(progress)));
  status.innerHTML = `<i></i><span>${label}</span><b>${percent}%</b><em><u style="width:${percent}%"></u></em>`;
}
function shipmentOutcome(s) {
  const loaded = s.containers.reduce((sum, load) => sum + load.placed.length, 0),
    left = s.unallocated.length,
    total = s.totalUnits,
    rate = total ? Math.round((loaded / total) * 100) : 0;
  return { loaded, left, total, rate, state: left === 0 ? 'complete' : loaded === 0 ? 'failed' : 'partial' };
}
function unallocatedNotice(s) {
  const outcome = shipmentOutcome(s),
    groups = new Map();
  s.unallocated.forEach(item => {
    const key = `${item.name}\0${item.reason || ''}`,
      group = groups.get(key) || { name: item.name, reason: item.reason || '치수·회전·지지 조건 불충족', count: 0 };
    group.count++;
    groups.set(key, group);
  });
  const details = [...groups.values()]
      .slice(0, 8)
      .map(group => `${group.name} × ${group.count} — ${group.reason}`)
      .join('\n'),
    extra = groups.size > 8 ? `\n외 ${groups.size - 8}개 제품군` : '';
  return `전체 ${outcome.total}개 중 ${outcome.loaded}개만 적재되었습니다.\n\n미배치 화물 ${outcome.left}개\n${details}${extra}\n\n컨테이너 규격이나 제품의 치수·중량·회전 조건을 확인해 주세요. 미배치 화물이 있으면 Excel 내보내기가 제한됩니다.`;
}

async function simulate() {
  syncSelects();
  if (editingIndex >= 0) {
    showAppMessage('수정 중인 제품을 저장하거나 취소한 뒤 시뮬레이션을 실행해 주세요.', {
      title: '제품 수정 중',
      tone: 'warning'
    });
    return;
  }
  if (!products.length) {
    showAppMessage('직접 입력하거나 파일을 불러와 제품을 하나 이상 등록한 뒤 실행해 주세요.', {
      title: '등록된 제품이 없습니다',
      tone: 'warning'
    });
    return;
  }
  // 컨테이너를 바꾼 뒤에도 안 들어가는 제품이 있으면 계산 전에 알린다.
  const fitContainer = CONTAINERS[$('containerType').value],
    misfits = products.map(p => ({ p, why: productFitIssue(p, fitContainer) })).filter(x => x.why);
  if (misfits.length) {
    showAppMessage(
      misfits
        .slice(0, 3)
        .map(x => `${x.p.name}: ${x.why}`)
        .join('\n') + (misfits.length > 3 ? `\n외 ${misfits.length - 3}개` : ''),
      { title: '컨테이너에 들어갈 수 없는 제품이 있습니다', tone: 'warning' }
    );
    return;
  }
  if (simulationRunning) {
    pendingRun = true;
    return;
  }
  simulationRunning = true;
  const version = inputVersion,
    previous = shipment,
    started = performance.now(),
    status = $('simulationStatus'),
    buttons = [$('recalculateOptions')];
  buttons.forEach(b => {
    b.disabled = true;
    b.classList.add('is-running');
    b.setAttribute('aria-busy', 'true');
    const label = b.querySelector('.run-label');
    if (label) label.textContent = '계산 중…';
  });
  status.hidden = false;
  status.className = 'simulation-status busy';
  updateSimulationProgress(status, 1, '계산 준비 중');
  await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 30)));
  try {
    const containerKey = $('containerType').value,
      c = CONTAINERS[containerKey],
      safety = $('safetyLevel').value,
      preference = $('preference').value,
      transportMode = currentTransportMode(),
      label = strategyLabel(safety, preference),
      units = products.flatMap((p, pi) =>
        Array.from({ length: p.qty }, (_, n) => ({ ...p, pi, unit: n + 1, volume: p.l * p.w * p.h }))
      );
    const plan = await runPackingEngine(
        {
          container: c,
          units,
          safety,
          preference,
          transportMode,
          securing: securingOptions,
          previous: previous
            ? {
                containers: previous.containers.map(load => ({ container: load.container, placed: load.placed })),
                unallocated: previous.unallocated,
                totalUnits: previous.totalUnits,
                safety: previous.safety,
                preference: previous.preference,
                transportMode: previous.transportMode
              }
            : null
        },
        p =>
          updateSimulationProgress(
            status,
            5 + p * 90,
            safety === 'secure' ? `${label} 계산 중 · 최대 40초` : `${label} 계산 중`
          )
      ),
      loads = plan.loads,
      remaining = plan.remaining;
    if (version !== inputVersion) {
      status.hidden = true;
      return;
    }
    updateSimulationProgress(status, 97, '고정재 위치 계산 중');
    await new Promise(resolve => setTimeout(resolve, 0));
    if (version !== inputVersion) {
      status.hidden = true;
      return;
    }
    loads.forEach((load, i) => {
      load.containerNumber = i + 1;
      load.securing = buildSecuringPlan(load, transportMode, securingOptions, safety);
    });
    shipment = {
      containers: loads,
      unallocated: remaining,
      totalUnits: units.length,
      containerKey,
      safety: plan.safety,
      preference: plan.preference,
      transportMode: plan.transportMode,
      engine: plan.engine,
      stats: plan.stats,
      strategy: { label, reason: plan.reason }
    };
    shipment.validation = LoadwiseValidator.validateShipment(shipment);
    if (!shipment.validation.valid)
      throw new Error(`독립 안전 검증 실패: ${shipment.validation.errors.slice(0, 3).join(' / ')}`);
    resultStale = false;
    result = loads[0];
    activeContainer = 0;
    visibleStep = result.placed.length;
    stopPlayback();
    $('recalculateOptions').classList.remove('needs-update');
    $('recalculateOptions').innerHTML = '<span class="run-label">시뮬레이션 실행</span> <b>→</b>';
    updateResults();
    resizeCanvas();
    draw();
    const outcome = shipmentOutcome(shipment),
      elapsed = ((performance.now() - started) / 1000).toFixed(2);
    status.className = `simulation-status ${outcome.state === 'complete' ? 'done' : outcome.state === 'partial' ? 'warning' : 'error'}`;
    status.innerHTML = `<i></i><span>${outcome.state === 'complete' ? '적재 완료' : outcome.state === 'partial' ? '부분 적재' : '적재 불가'} · ${label} · ${elapsed}초</span><b>적재 ${outcome.rate}%</b>`;
    status.hidden = true;
    $('calcTime').hidden = false;
    $('calcTime').textContent = `계산 ${elapsed}초`;
    if (outcome.left)
      showAppMessage(unallocatedNotice(shipment), {
        title: outcome.state === 'failed' ? '현재 조건으로 적재할 수 없습니다' : '일부 화물을 적재할 수 없습니다',
        tone: outcome.state === 'failed' ? 'error' : 'warning'
      });
    window.dispatchEvent(new CustomEvent('loadwise:simulation-complete'));
  } catch (error) {
    console.error(error);
    status.className = 'simulation-status error';
    status.innerHTML = '<i></i><span>계산 중 오류가 발생했습니다</span>';
    showAppMessage(
      error.message?.startsWith('독립 안전 검증 실패')
        ? '계산 결과가 독립 안전 검증을 통과하지 못해 표시하지 않았습니다. 안전 기준이나 우선 기준을 바꿔 다시 실행해 주세요.'
        : '계산을 완료하지 못했습니다. 입력 조건을 확인한 뒤 다시 실행해 주세요.',
      { title: '시뮬레이션 오류', tone: 'error' }
    );
  } finally {
    simulationRunning = false;
    buttons.forEach(b => {
      b.disabled = !products.length || editingIndex >= 0;
      b.classList.remove('is-running');
      b.removeAttribute('aria-busy');
      const label = b.querySelector('.run-label');
      if (label) label.textContent = b.classList.contains('needs-update') ? '다시 계산' : '시뮬레이션 실행';
    });
    if (pendingRun) {
      pendingRun = false;
      setTimeout(simulate, 0);
    }
  }
}
// 고정재 아이콘(SVG). 3D 토글과 권고 목록에서 같이 쓴다.
const SECURING_ICONS = {
  airbag:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="6" fill="#8fcdf0" stroke="#2f7fae" stroke-width="1.6"/><rect x="10.5" y="2" width="3" height="4" rx="1" fill="#276e96"/><path d="M8 12.5h8" stroke="#e8f6fd" stroke-width="1.4" stroke-linecap="round"/></svg>',
  timber:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="8" width="19" height="8" rx="1.4" fill="#c98b4e" stroke="#7b4d22" stroke-width="1.4"/><path d="M5 11c3-1.4 6 1.4 9 0s4-.6 5 .2M5 13.8c3-1 6 1 9-.2" stroke="#8a5a2b" stroke-width="1" fill="none"/></svg>',
  strap:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 9h20v6H2z" fill="#f29b38" stroke="#b7651a" stroke-width="1.3"/><rect x="9" y="7" width="6" height="10" rx="1.2" fill="#5c6166" stroke="#34383c" stroke-width="1.2"/><path d="M11 10v4M13 10v4" stroke="#c9ced3" stroke-width="1"/></svg>',
  filler:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1.5" fill="#e8d3a8" stroke="#9c7a3c" stroke-width="1.4"/><path d="M7 8l2-1.2 2 1.2v2.4l-2 1.2-2-1.2zM13 8l2-1.2 2 1.2v2.4l-2 1.2-2-1.2zM10 13l2-1.2 2 1.2v2.4l-2 1.2-2-1.2z" fill="none" stroke="#9c7a3c" stroke-width="1"/></svg>'
};
const securingIcon = kind => SECURING_ICONS[kind === 'beam' || kind === 'chock' ? 'timber' : kind] || '';
function renderSecuringOptions() {
  document
    .querySelectorAll('#securingChips button[data-key]')
    .forEach(chip => chip.setAttribute('aria-pressed', String(Boolean(securingOptions[chip.dataset.key]))));
  const friction = FRICTION_CHOICES[securingOptions.friction] ? securingOptions.friction : 'unknown',
    msl = lashingMslOf(securingOptions),
    anchors = securingOptions.anchors === 'rated' ? 'rated' : 'iso';
  if ($('securingFriction')) $('securingFriction').value = friction;
  if ($('lashingMsl')) $('lashingMsl').value = String(msl);
  if ($('anchorRating')) $('anchorRating').value = anchors;
  if ($('securingConditionsSummary'))
    $('securingConditionsSummary').textContent =
      `마찰 ${FRICTION_CHOICES[friction].mu} · 래싱 ${msl / 1000}t · 고정점 ${anchors === 'rated' ? '표시 확인' : 'ISO 최소'}`;
}
function updateResults() {
  const r = result,
    total = shipment ? shipment.totalUnits : products.reduce((s, p) => s + p.qty, 0);
  $('emptyState').style.display = 'none';
  renderContainerTabs();
  renderResultSummary();
  renderFieldResult();
  $('volumeRate').textContent = `${r.volumeRate.toFixed(1)}%`;
  $('weightRate').textContent = `${r.weightRate.toFixed(1)}%`;
  $('volumeBar').style.width = `${Math.min(100, r.volumeRate)}%`;
  $('weightBar').style.width = `${Math.min(100, r.weightRate)}%`;
  // 수량·중량 칸은 지금 보는 컨테이너 값이고, 작은 글씨에 전체 합계를 함께 보여 준다(컨테이너가 여러 대일 때 헷갈리지 않게).
  const loads = shipment ? shipment.containers : [r],
    loadedAll = loads.reduce((s, l) => s + l.placed.length, 0),
    weightAll = loads.reduce((s, l) => s + (l.totalWeight || 0), 0),
    many = loads.length > 1;
  $('loadedCount').textContent = `${r.placed.length}개`;
  $('loadedDetail').textContent = many ? `${loads.length}대 합계 ${loadedAll}개 / 전체 ${total}개` : `전체 ${total}개`;
  $('totalWeight').textContent = `${r.totalWeight.toLocaleString()} kg`;
  $('containerCount').textContent = `${loads.length}대`;
  $('containerDetail').textContent = r.container.name;
  $('weightDetail').textContent = many
    ? `${loads.length}대 합계 ${(weightAll / 1000).toFixed(1)} t · 대당 허용 ${(r.container.maxWeight / 1000).toFixed(1)} t`
    : `허용 ${(r.container.maxWeight / 1000).toFixed(1)} t`;
  // 같은 제품이 같은 층에 같은 방향으로 잇달아 놓이면 한 줄로 묶는다("× 20"). 순서는 그대로다.
  const groups = [];
  r.placed.forEach(p => {
    const g = groups[groups.length - 1];
    if (g && g.name === p.name && g.z === p.z && g.l === p.l && g.w === p.w && g.h === p.h) {
      g.count++;
      g.xMin = Math.min(g.xMin, p.x);
      g.xMax = Math.max(g.xMax, p.x);
    } else groups.push({ ...p, count: 1, xMin: p.x, xMax: p.x });
  });
  const depth = p =>
    p.xMin === p.xMax ? `${(p.x / 1000).toFixed(2)}m` : `${(p.xMax / 1000).toFixed(2)}~${(p.xMin / 1000).toFixed(2)}m`;
  $('sequenceEmpty').style.display = r.placed.length ? 'none' : 'block';
  $('sequenceEmpty').textContent = r.placed.length ? '' : '적재 가능한 화물이 없습니다.';
  $('sequenceList').innerHTML = groups
    .map(
      (p, i) =>
        `<li><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="dot" style="background:${p.color};border-radius:${p.shape === 'cylinder' ? '50%' : '2px'}"></span><div><strong>${esc(p.name)} × ${p.count} · ${p.shape === 'cylinder' ? '원통형' : '박스형'}</strong><br><small>문에서 ${depth(p)} 안쪽 · 바닥에서 ${(p.z / 1000).toFixed(2)}m 높이</small></div><small>${p.l}×${p.w}×${p.h}</small></li>`
    )
    .join('');
  const blocked = shipment?.unallocated.length > 0;
  $('exportPlan').disabled = blocked || resultStale;
  $('exportPlan').title = blocked ? `미배치 화물 ${shipment.unallocated.length}개를 해결한 후 내보낼 수 있습니다.` : '';
  $('playback').style.display = 'flex';
  $('stepRange').max = r.placed.length;
  $('totalSteps').textContent = r.placed.length;
  $('exportPdf').disabled = blocked || resultStale;
  $('exportPdf').title = blocked ? `미배치 화물 ${shipment.unallocated.length}개를 해결한 후 만들 수 있습니다.` : '';
  setStep(r.placed.length);
  renderBalance();
  renderRecommendation();
  renderSecuringRecommendation();
  requestAnimationFrame(syncSequenceHeight);
}
// 현장 결과 기록과 계획 비교. 기록은 프로젝트 저장에 포함된다.
function renderFieldResult() {
  const panel = $('fieldPanel');
  if (!panel) return;
  if (!shipment) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const planned = { loaded: shipmentOutcome(shipment).loaded, containers: shipment.containers.length };
  if (document.activeElement?.closest?.('#fieldPanel') == null) {
    $('fieldLoaded').value = fieldResult?.loaded || '';
    $('fieldContainers').value = fieldResult?.containers || '';
    $('fieldNotes').value = fieldResult?.notes || '';
  }
  if (!fieldResult || (!fieldResult.loaded && !fieldResult.containers)) {
    $('fieldSummary').textContent = '실제 적재 결과를 남기면 계획과 비교합니다';
    $('fieldCompare').textContent = `계획: ${planned.loaded}개 · ${planned.containers}대`;
    return;
  }
  const diff = (actual, plan, unit) =>
    actual
      ? `${actual}${unit}(계획 ${plan}${unit}, ${actual === plan ? '일치' : actual > plan ? `+${actual - plan}` : `−${plan - actual}`})`
      : '—';
  $('fieldSummary').textContent =
    `기록됨 · ${fieldResult.recordedAt ? new Date(fieldResult.recordedAt).toLocaleDateString('ko-KR') : ''}`;
  $('fieldCompare').textContent =
    `실제 ${diff(fieldResult.loaded, planned.loaded, '개')} · ${diff(fieldResult.containers, planned.containers, '대')}${fieldResult.notes ? ` · 메모: ${fieldResult.notes}` : ''}`;
}
function saveFieldResult() {
  fieldResult = {
    loaded: Math.max(0, Math.floor(Number($('fieldLoaded').value) || 0)),
    containers: Math.max(0, Math.floor(Number($('fieldContainers').value) || 0)),
    notes: String($('fieldNotes').value || '').slice(0, 240),
    recordedAt: new Date().toISOString()
  };
  window.loadwiseStorage?.markDirty();
  renderFieldResult();
}
// 결과 요약: 이 컨테이너의 안전 판정, 꼭 필요한 고정재 3가지, 현장에서 확인할 항목. 자세한 내용은 아래 카드에 있다.
// 자동 평가 카드(규칙 기반, AI 아님). 출하 전체를 점검해 등급과 항목별 지적·고칠 방법을 보여 준다.
function renderAutoReview() {
  const el = $('autoReview');
  if (!el) return;
  if (!shipment || !window.LoadwiseReview) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const r = LoadwiseReview.review(shipment),
    icon = { ok: '✓', info: 'i', warn: '!', bad: '✕' };
  el.hidden = false;
  el.dataset.grade = r.grade.key;
  el.innerHTML =
    `<div class="auto-review-head"><span>자동 평가</span><strong>${r.grade.label}</strong><small>규칙 기반 점검 · 같은 결과면 같은 평가</small></div>` +
    `<ul>${r.items.map(it => `<li data-level="${it.level}"><i aria-hidden="true">${icon[it.level]}</i><div><b>${esc(it.title)}</b>${it.detail ? `<span>${esc(it.detail)}</span>` : ''}${it.fix ? `<em>${esc(it.fix)}</em>` : ''}</div></li>`).join('')}</ul>` +
    `<p class="auto-review-scope">사전 검토용 평가입니다. CTU Code나 도로 법규 적합 판정이 아니며, 실제 적입 전 현장 책임자가 확인해야 합니다.${/-kr$/.test(shipment.containerKey || '') ? ' 한국 도로 한도는 적재중량 기준 값이며, 축하중은 일반 20ft·40ft 샤시 제원으로 추정한 값입니다(결과 요약 참조).' : ''}</p>` +
    flagNoteHtml(r.anomalies.length);
}
// 점검 기록 안내: 남겼는지, 오늘 한도(브라우저마다 하루 10건, 서버에서도 같은 한도)에 걸렸는지.
function flagNoteHtml(count) {
  if (!count) return '';
  const q = window.loadwiseStorage?.flagQuota?.();
  if (q?.global)
    return `<p class="auto-review-flag">오늘 점검 기록이 전체 한도에 도달해 이 결과는 남기지 않았습니다(${count}건). 내일 다시 기록됩니다.</p>`;
  if (q?.reached)
    return `<p class="auto-review-flag">오늘 이 브라우저의 점검 기록 한도(하루 ${q.limit}건)에 도달해 이 결과는 남기지 않았습니다(${count}건). 내일 다시 기록됩니다.</p>`;
  return `<p class="auto-review-flag">알고리즘 개선을 위해 이 결과를 점검 기록으로 남겼습니다(${count}건, 제품명 없이 치수·무게·조건만${q ? ` · 브라우저마다 하루 ${q.limit}건까지` : ''}).</p>`;
}
// 계산이 끝날 때 한 번: 알고리즘이 의심되는 결과면 입력·조건·지적을 점검 기록으로 보낸다(관리자만 열람).
function recordReviewFlags() {
  if (!shipment || !window.LoadwiseReview || !window.loadwiseStorage?.recordAlgorithmFlag) return;
  const r = LoadwiseReview.review(shipment);
  if (!r.anomalies.length) return;
  const settings = {
    container: shipment.containerKey,
    safety: shipment.safety,
    preference: shipment.preference,
    transportMode: shipment.transportMode,
    securing: { ...securingOptions }
  };
  // 제품명·제품군은 영업 정보일 수 있어 보내지 않는다. 재현에는 치수·무게·수량·형상·조건이면 충분하다.
  const input = {
    products: products.map(p => ({
      shape: p.shape,
      l: p.l,
      w: p.w,
      h: p.h,
      weight: p.weight,
      qty: p.qty,
      rotate: p.rotate,
      fragile: p.fragile,
      maxTopLoadKg: p.maxTopLoadKg
    }))
  };
  const engine = shipment.engine || LoadwiseEngine.ENGINE_VERSION,
    appVersion = ($('appVersion')?.textContent || '').replace(/^v/, '');
  window.loadwiseStorage.recordAlgorithmFlag({
    appVersion,
    engine,
    settings,
    flags: r.anomalies,
    input,
    fingerprint: LoadwiseReview.fingerprint({ engine, settings, input, codes: r.anomalies.map(a => a.code) })
  });
}
if (typeof window !== 'undefined') window.addEventListener('loadwise:simulation-complete', recordReviewFlags);
function renderResultSummary() {
  const el = $('resultSummary');
  if (!el) return;
  renderAutoReview();
  if (!result || !result.placed.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const ctu = LoadwiseInsights.ctu(result),
    plan = result.securing || { dunnage: [], airbags: [], reviews: [] },
    safety = LoadwiseEngine.SAFETY_LEVELS[shipment?.safety || $('safetyLevel').value]?.label || '기본';
  const level = ctu?.level || 'safe',
    levelText = { safe: '양호', caution: '주의', danger: '위험' }[level];
  // 미적재와 자동 평가 결과를 안전 판정 한 줄에 함께 적는다(맨 위 한 줄만 보고 판단하지 않도록). 카드 색은 둘 중 나쁜 쪽을 따른다.
  const left = shipment?.unallocated?.length || 0,
    grade = shipment && window.LoadwiseReview ? LoadwiseReview.review(shipment).grade : null,
    gradeLevel = grade?.key === 'bad' ? 'danger' : grade?.key === 'warn' ? 'caution' : 'safe',
    rank = { safe: 0, caution: 1, danger: 2 },
    cardLevel = rank[gradeLevel] > rank[level] ? gradeLevel : level;
  const count = kind => plan.dunnage.filter(d => d.kind === kind).length,
    nails = plan.dunnage.filter(d => d.kind === 'beam').reduce((sum, d) => sum + (d.nails || 0), 0);
  const needs = [
    count('beam') ? { icon: 'beam', text: `문쪽 바닥 각재 ${count('beam')}곳 · 못 ${nails}개` } : null,
    count('fence') ? { icon: 'beam', text: `문쪽 각재 펜스 ${count('fence')}단` } : null,
    plan.airbags.length ? { icon: 'airbag', text: `에어백 ${plan.airbags.length}개` } : null,
    count('lashing') + count('strap')
      ? { icon: 'strap', text: `래싱·스트랩 ${count('lashing') + count('strap')}개` }
      : null,
    count('filler') + count('spacer')
      ? { icon: 'filler', text: `충전재·스페이서 ${count('filler') + count('spacer')}곳` }
      : null
  ]
    .filter(Boolean)
    .slice(0, 3);
  const rearrange = plan.reviews.filter(r => r.severity === 'rearrange').length,
    faces = plan.reviews.filter(r => r.ctuFace).length,
    review = plan.reviews.length - rearrange - faces,
    restraint = ctuSecuringDirections(plan.ctu).length;
  const checks = [
    rearrange ? `배치 재검토 ${rearrange}건` : '',
    faces ? `CTU 열린 면 보강 ${faces}곳` : '',
    review ? `현장 고정 검토 ${review}건` : '',
    restraint ? `CTU 고정 필요 ${restraint}방향` : ''
  ].filter(Boolean);
  el.hidden = false;
  el.dataset.level = cardLevel;
  el.innerHTML =
    `<div class="summary-verdict"><span>안전 판정</span><strong>안전 수준 ${esc(safety)} · 사전검사 ${levelText}${grade ? ` · 자동 평가 ${esc(grade.label)}` : ''}${left ? ` · 미적재 ${left}개` : ''}</strong></div>` +
    `<div class="summary-needs"><span>꼭 필요한 고정재</span><strong>${needs.length ? needs.map(n => `<em><i class="securing-icon">${securingIcon(n.icon)}</i>${n.text}</em>`).join('') : '추가 고정재 없음'}</strong></div>` +
    `<div class="summary-checks"><span>확인할 항목</span><strong>${checks.length ? checks.join(' · ') : '없음'}</strong></div>` +
    axleSummaryHtml();
}
// 도로 축하중 추정(도로·복합 운송일 때). 일반 제원 가정이므로 가정값을 함께 적는다. 한도 축 10t·총 40t(단속 11t·44t).
function axleSummaryHtml() {
  const mode = shipment?.transportMode || currentTransportMode();
  if (mode === 'sea' || !result) return '';
  const a = LoadwiseInsights.axleLoads(result);
  if (!a) return '';
  const t = v => (v / 1000).toFixed(1),
    mark = { safe: '', caution: ' caution', danger: ' danger' };
  const note = {
    safe: '도로법 한도(축 10t·총 40t) 안',
    caution: '도로법 한도 초과 · 단속 오차 범위(축 11t·총 44t) 안',
    danger: '단속 기준(축 11t·총 44t) 초과'
  }[a.level];
  return (
    `<div class="summary-axle" data-level="${a.level}"><span>도로 축하중 추정 <small>${esc(note)}</small></span><strong>` +
    a.axles
      .map(
        x => `<em class="axle${mark[x.level]}">${esc(x.label)} ${t(x.perAxle)}t${x.key === 'front' ? '' : '/축'}</em>`
      )
      .join('') +
    `<em class="axle${mark[a.totalLevel]}">차량 총중량 ${t(a.total)}t</em></strong>` +
    `<small class="axle-note">일반 제원 가정: ${esc(a.vehicle.tractor)} 자체중량 ${t(a.vehicle.tractorTare)}t, ${esc(a.vehicle.chassis)} ${t(a.vehicle.chassisTare)}t, 컨테이너 자체중량 ${t(a.tare)}t. 실제 차량 제원·적재 위치에 따라 달라지며, 계량 확인이 필요합니다(CTU 정보자료 IM6 방법).</small></div>`
  );
}
function renderBalance() {
  const value = LoadwiseInsights.ctu(result),
    card = $('balanceCard');
  if (!value) {
    card.hidden = true;
    return;
  }
  const validation = LoadwiseValidator.validateLoad(result, { minSupport: shipmentMinSupport() }),
    m = validation.metrics;
  card.hidden = false;
  card.dataset.level = value.level;
  $('balanceStatus').textContent =
    value.level === 'safe' ? '사전검사 양호' : value.level === 'caution' ? '사전검사 주의' : '사전검사 위험';
  $('frontRearBalance').textContent = `${value.door.toFixed(1)}% / ${value.rear.toFixed(1)}%`;
  $('leftRightBalance').textContent = `${value.left.toFixed(1)}% / ${value.right.toFixed(1)}%`;
  $('cogPosition').textContent =
    `X ${(value.cog.x / 1000).toFixed(2)} · Y ${(value.cog.y / 1000).toFixed(2)} · Z ${(value.cog.z / 1000).toFixed(2)} m`;
  $('cogOffset').textContent =
    `전후 ${Math.abs(value.grossXOffset).toFixed(1)}% · 좌우 ${Math.abs(value.grossYOffset).toFixed(1)}%`;
  $('cogOffset').title =
    `총중량(화물 + 컨테이너 자체중량 ${value.tare.toLocaleString()} kg) 기준. 화물만: 전후 ${Math.abs(value.xOffset).toFixed(1)}% · 좌우 ${Math.abs(value.yOffset).toFixed(1)}%`;
  $('ctuConcentration').textContent =
    `${value.concentration.toFixed(1)}% · ${value.checks.concentration ? '권고 이내' : '60% 초과'}`;
  $('ctuVertical').textContent =
    `높이의 ${value.vertical.toFixed(1)}% · ${value.checks.vertical ? '권고 이내' : '50% 초과'}`;
  $('compressionStatus').textContent = m.compressionUnverified
    ? `${m.compressionVerified}개 검증 · ${m.compressionUnverified}개 미입력`
    : `${m.compressionVerified}개 검증 완료`; // 칸마다 권고 범위 안(good)·주의(caution)·위험(danger)을 색으로 보여 준다. 미입력 압축하중은 나쁜 값이 아니라 판정하지 않는다.
  const offset = v => (Math.abs(v) <= 5 ? 'good' : Math.abs(v) <= 10 ? 'caution' : 'danger'),
    mark = (id, level) => {
      const cell = $(id).parentElement;
      if (level) cell.dataset.level = level;
      else delete cell.dataset.level;
    };
  mark('frontRearBalance', offset(value.grossXOffset));
  mark('leftRightBalance', offset(value.grossYOffset));
  mark('cogOffset', offset(value.maxOffset));
  mark('cogPosition', '');
  mark('ctuConcentration', value.checks.concentration ? 'good' : 'caution');
  mark('ctuVertical', value.vertical <= 50 ? 'good' : value.vertical <= 60 ? 'caution' : 'danger');
  mark('compressionStatus', m.compressionUnverified ? '' : 'good');
}
// 화면 접기: 제품 데이터 입력칸 접기와 왼쪽 칸(제품 입력·목록) 전체 숨기기. 상태는 이 브라우저에 기억한다.
const UI_INPUT_KEY = 'loadwise.v3.ui.inputCollapsed',
  UI_PANEL_KEY = 'loadwise.v3.ui.panelHidden';
function setInputCollapsed(collapsed) {
  const card = document.querySelector('.input-card'),
    button = $('toggleInput');
  if (!card || !button) return;
  card.classList.toggle('input-collapsed', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.title = collapsed ? '입력칸 펼치기' : '입력칸 접기';
  button.textContent = collapsed ? '펼치기' : '접기';
  try {
    localStorage.setItem(UI_INPUT_KEY, collapsed ? '1' : '0');
  } catch {}
}
function setPanelHidden(hidden) {
  const button = $('togglePanel');
  $('planner').classList.toggle('panel-hidden', hidden);
  button.setAttribute('aria-expanded', String(!hidden));
  button.title = hidden ? '제품 입력 칸 보기' : '제품 입력 칸 숨기기';
  button.setAttribute('aria-label', button.title);
  try {
    localStorage.setItem(UI_PANEL_KEY, hidden ? '1' : '0');
  } catch {}
  requestAnimationFrame(() => {
    resizeCanvas();
    syncSequenceHeight();
  });
}
function toggleProductList() {
  const card = document.querySelector('.product-list-card'),
    expanded = card.classList.toggle('expanded'),
    button = $('toggleProducts');
  button.textContent = expanded ? '접기' : '펼치기';
  button.setAttribute('aria-expanded', expanded);
}
function toggleSequence() {
  const plan = document.querySelector('.loading-plan'),
    expanded = plan.classList.toggle('expanded'),
    button = $('toggleSequence');
  button.textContent = expanded ? '접기' : '펼치기';
  button.setAttribute('aria-expanded', expanded);
  if (!expanded) requestAnimationFrame(syncSequenceHeight);
}
function syncSequenceHeight() {
  const plan = document.querySelector('.loading-plan'),
    list = $('sequenceList'),
    panel = document.querySelector('.control-panel');
  if (!plan || !list || !panel || plan.classList.contains('expanded')) return;
  const available = Math.max(
    220,
    Math.round(panel.getBoundingClientRect().bottom - list.getBoundingClientRect().top - 24)
  );
  list.style.setProperty('--sequence-max-height', `${available}px`);
}
function renderContainerTabs() {
  const el = $('containerTabs');
  if (!shipment) {
    el.style.display = 'none';
    return;
  }
  const total = shipment.containers.length;
  el.style.display = 'flex';
  el.innerHTML = `<button class="nav-arrow" id="prevContainer" ${activeContainer === 0 ? 'disabled' : ''} aria-label="이전 컨테이너">‹</button><span class="page-label">${activeContainer + 1} / ${total}</span><button class="nav-arrow" id="nextContainerArrow" ${activeContainer === total - 1 ? 'disabled' : ''} aria-label="다음 컨테이너">›</button>`;
  $('prevContainer').onclick = () => selectContainer(activeContainer - 1);
  $('nextContainerArrow').onclick = () => selectContainer(activeContainer + 1);
}
function selectContainer(index) {
  if (!shipment || !shipment.containers[index]) return;
  activeContainer = index;
  result = shipment.containers[index];
  visibleStep = result.placed.length;
  stopPlayback();
  updateResults();
  resizeCanvas();
  draw();
}
function containerPlanMessage(container, count) {
  return count === 1
    ? `${container.name} 1대에 한 번에 적재합니다.`
    : `${container.name} ${count}대로 분할 적재합니다.`;
}
// 모두 적재되면 지표 칸으로 충분하다. 미배치가 있을 때만 이유와 조치를 알린다.
function renderRecommendation() {
  const el = $('recommendation'),
    outcome = shipment && shipmentOutcome(shipment);
  if (!outcome || outcome.state === 'complete') {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  const c = result.container,
    count = shipment.containers.length,
    left = shipment.unallocated.length;
  el.innerHTML =
    outcome.state === 'failed'
      ? `<div><strong>현재 규격으로 적재할 수 없습니다.</strong><p>미배치 화물 ${left}개의 치수·중량·회전 조건을 확인하세요. 분할 대수는 제안하지 않습니다.</p></div>`
      : `<div><strong>${c.name} ${count}대에 ${outcome.loaded}개 적재 · ${left}개 미배치</strong><p>미배치 화물은 별도 검토가 필요합니다.</p></div>`;
}
// 검토 항목 제목: CTU 기준에서 화물로 막히지 않은 면은 따로 묶어 보여 준다.
function reviewLabel(w) {
  return w.ctuFace ? 'CTU 열린 면 보강' : w.severity === 'rearrange' ? '배치 재검토' : '현장 고정 검토';
}
function renderSecuringRecommendation() {
  const el = $('securingRecommendation'),
    panel = $('securingPanel'),
    plan = result.securing;
  if (!plan || (!plan.dunnage.length && !plan.airbags.length && !plan.reviews.length && !plan.ctu?.needsRestraint)) {
    panel.hidden = true;
    el.innerHTML = '';
    return;
  }
  panel.hidden = false;
  panel.open = false;
  const beams = plan.dunnage.filter(d => d.kind === 'beam'),
    chocks = plan.dunnage.filter(d => d.kind === 'chock'),
    fillers = plan.dunnage.filter(d => d.kind === 'filler'),
    straps = plan.dunnage.filter(d => d.kind === 'strap'),
    fences = plan.dunnage.filter(d => d.kind === 'fence'),
    spacers = plan.dunnage.filter(d => d.kind === 'spacer'),
    lashings = plan.dunnage.filter(d => d.kind === 'lashing'),
    icon = kind => `<span class="securing-icon">${securingIcon(kind)}</span>`,
    profile = TRANSPORT_PROFILES[plan.transportMode] || TRANSPORT_PROFILES.combined,
    reviewUnits = plan.reviews.reduce((sum, w) => sum + (w.count || 1), 0),
    items = [
      ...(fences.length
        ? [
            `<div class="has-icon">${icon('beam')}<strong>문쪽 각재 펜스 ${fences.length}단 · 뒤 기둥 사이</strong>50×100mm 각재를 뒤 기둥(코너 포스트)에 고정 · 문에서 떨어진 화물 앞은 충전재로 채움</div>`
          ]
        : []),
      ...lashings.map(
        d =>
          `<div class="has-icon">${icon('strap')}<strong>${d.location}</strong>윗단이 쏟아지지 않게 열린 면 앞을 가로질러 되잡음(CTU Code 부속서 7 §3.2.7) · 모서리 보호대 · 사전장력은 MSL의 50% 이하</div>`
      ),
      ...plan.dunnage
        .filter(d => d.kind === 'note')
        .map(d => `<div class="has-icon">${icon('strap')}<strong>${d.location}</strong>${d.product}</div>`),
      ...(spacers.length
        ? [
            `<div class="has-icon">${icon('filler')}<strong>틈 스페이서 ${spacers.length}곳</strong>${spacers
              .slice(0, 4)
              .map(d => d.location)
              .join(' · ')}${spacers.length > 4 ? ` 외 ${spacers.length - 4}곳` : ''}</div>`
          ]
        : []),
      ...beams.map(
        d =>
          `<div class="has-icon">${icon('beam')}<strong>${d.location}</strong>CTU Code 부속서 7: 못 1개 1~4kN 중 하한 1kN으로 계산 · 못은 바닥 두께의 2/3 이상 · 운송모드 문쪽 가속도 기준</div>`
      ),
      ...(chocks.length
        ? [
            `<div class="has-icon">${icon('chock')}<strong>각재 지지 쐐기 ${chocks.length}개 · 바닥 못 고정</strong>문과 화물 사이 틈이 큰 줄의 바닥 각재 앞</div>`
          ]
        : []),
      ...straps.map(
        d =>
          `<div class="has-icon">${icon('strap')}<strong>${d.location}</strong>문을 열 때 윗단이 떨어지지 않게 고정 · 스트랩 사전장력은 MSL의 50% 이하</div>`
      ),
      ...plan.airbags
        .slice(0, 8)
        .map(
          (a, i) =>
            `<div class="has-icon">${icon('airbag')}<strong>에어백 ${i + 1}${a.bag ? ` · ${a.bag}` : ''} · ${a.location}</strong>X ${(a.x / 1000).toFixed(2)}m · Y ${(a.y / 1000).toFixed(2)}m · Z ${(a.z / 1000).toFixed(2)}m</div>`
        ),
      ...fillers.map(
        d =>
          `<div class="has-icon">${icon('filler')}<strong>${d.location}</strong>에어백과 벽 사이 · 에어백 한계(${AIRBAG_MAX_GAP}mm) 초과분</div>`
      ),
      ...plan.reviews.map(
        w =>
          `<div><strong>${reviewLabel(w)} · ${esc(w.product)}${w.count > 1 ? ` × ${w.count}` : ''}</strong>${w.location}${w.axes ? ` · 미지지 ${w.axes}` : ''}</div>`
      ),
      ...(plan.notes || []).map(
        n => `<div class="securing-note-item"><strong>계산 기준 · ${esc(n.product)}</strong>${esc(n.text)}</div>`
      )
    ];
  $('securingCount').textContent =
    `${profile.label}${beams.length ? ` · 바닥 각재 ${beams.length}` : ''}${chocks.length ? ` · 쐐기 ${chocks.length}` : ''} · 에어백 ${plan.airbags.length}${fillers.length ? ` · 충전재 ${fillers.length}` : ''}${fences.length ? ` · 각재 펜스 ${fences.length}단` : ''}${spacers.length ? ` · 스페이서 ${spacers.length}` : ''}${lashings.length ? ` · 상단 래싱 ${lashings.length}` : ''}${straps.length ? ` · 도어 스트랩 ${straps.length}` : ''}${plan.reviews.length ? ` · 안정성 검토 ${plan.reviews.length}유형/${reviewUnits}개` : ''}${ctuSecuringDirections(plan.ctu).length ? ` · CTU 고정 필요 ${ctuSecuringDirections(plan.ctu).length}방향` : ''}`;
  el.innerHTML = `<h3>컨테이너 ${result.containerNumber} · ${profile.label} 운송 안정성</h3><p>기준: CTU Code 부속서 7(빈 공간 합 15cm 이하, 못 1kN/개, 문 경계 조건), 에어백 제조사 최대 간극 ${AIRBAG_MAX_GAP}mm, 래싱은 CTU 빠른 래싱 가이드 C 표${plan.conditions ? `(마찰 ${plan.conditions.friction} ${esc(plan.conditions.frictionLabel)} · 래싱 MSL ${plan.conditions.lashingMsl.toLocaleString()}daN · 고정점 ${plan.conditions.anchors === 'rated' ? '표시 확인' : 'ISO 최소'})` : ''}. ${profile.label} 운송에서 피칭·롤링·히빙 또는 가감속에 불리한 높은 적층, 측면 간극, 문측 노출과 원통 구름 위험을 선별합니다.</p><div class="securing-items">${items.join('')}</div>${ctuSecuringHtml(plan.ctu)}`;
}
function ctuSecuringDirections(ctu) {
  return ctu?.needsRestraint ? ctu.directions.filter(d => d.forceKN > 0 || d.tipping) : [];
}
function ctuSecuringDetail(d) {
  const w = d.worst;
  return `막히지 않은 화물 ${d.unblocked}개${w ? ` · 가장 불리한 화물 ${esc(w.product)}: 높이 비율 ${w.ratio.toFixed(2)} &gt; 한계 ${w.limit.toFixed(2)}${w.rows > 1 ? ` (${w.rows}열이 함께 기울 때)` : ''} · ${w.profile}` : ''}`;
}
function ctuSecuringSummary(ctu) {
  const list = ctuSecuringDirections(ctu);
  if (!list.length) return '';
  return `<p><strong>CTU Code 참고 계산(${ctu.profiles.join('·')}, 마찰계수 ${ctu.friction}):</strong> ${list.map(d => `${d.label} ${d.forceKN > 0 ? `억제력 ${d.forceKN.toFixed(1)} kN` : ''}${d.forceKN > 0 && d.tipping ? ' · ' : ''}${d.tipping ? `전도 위험 ${d.tipping}개` : ''}`).join(', ')}. 래싱 수량과 벽·앵커 강도는 계산하지 않았습니다.</p>`;
}
function ctuSecuringHtml(ctu) {
  const list = ctuSecuringDirections(ctu);
  if (!list.length) return '';
  return `<h3>CTU Code 참고 계산 · ${ctu.profiles.join('·')}</h3><p>벽이나 벽까지 이어진 화물로 막히지 않은 방향의 미끄럼 억제력과 전도를 계산합니다. 마찰계수 ${ctu.friction}(재질 미확인 시 최대값), 무게중심은 화물 중앙으로 가정하고 문은 막힌 경계로 보지 않습니다. 필요 억제력은 블로킹·래싱으로 확보해야 하며 래싱 수량과 벽·앵커 강도는 계산하지 않습니다.</p><div class="securing-items">${list.map(d => `<div><strong>${d.label}${d.forceKN > 0 ? ` · 필요 억제력 ${d.forceKN.toFixed(1)} kN` : ''}${d.tipping ? ` · 전도 위험 ${d.tipping}개` : ''}</strong>${ctuSecuringDetail(d)}</div>`).join('')}</div>`;
}
function setStep(step) {
  if (!result) return;
  visibleStep = Math.max(0, Math.min(result.placed.length, step));
  $('currentStep').textContent = visibleStep;
  $('stepRange').value = visibleStep;
  $('prevStep').disabled = visibleStep === 0;
  $('nextStep').disabled = visibleStep === result.placed.length;
  draw();
}
function togglePlayback() {
  if (playTimer) {
    stopPlayback();
    return;
  }
  if (visibleStep >= result.placed.length) setStep(0);
  $('playSteps').textContent = 'Ⅱ';
  playTimer = setInterval(() => {
    if (visibleStep >= result.placed.length) {
      stopPlayback();
      return;
    }
    setStep(visibleStep + 1);
  }, 650);
}
function stopPlayback() {
  if (playTimer) clearInterval(playTimer);
  playTimer = null;
  if ($('playSteps')) $('playSteps').textContent = '▶';
}

function esc(s) {
  return String(s).replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
if (typeof document !== 'undefined') init();
