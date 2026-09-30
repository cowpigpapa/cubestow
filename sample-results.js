// 샘플 결과 미리보기: 상단 메뉴 "샘플 결과"(#samples)를 누르면 헤더와 푸터 사이에서 적재 플래너 대신 보인다.
// sample-results/manifest.json(tools/capture-sample-results.mjs, `npm run samples:capture`로 생성)을 읽어
// 샘플마다 적재량 우선·기본·CTU 기준 적용을 세 칸으로 나란히 보여 주고, 컨테이너가 여러 대면 줄을 늘린다.
(function () {
  const esc = v =>
    String(v ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const levelName = { safe: '양호', caution: '주의', danger: '위험' },
    gradeKey = { 양호: 'ok', 주의: 'warn', '재검토 필요': 'bad' };
  let rendered = false;

  const diffLine = (data, s) => {
    const r = data.modes.map(m => s.results?.[m.key]);
    if (r.some(x => !x)) return '';
    const cont = r.map(x => x.containers.length),
      bags = r.map(x => x.containers.reduce((a, c) => a + c.airbags, 0)),
      left = r.map(x => x.unallocated);
    const parts = [`컨테이너 <b>${cont.join(' / ')}대</b>`, `에어백 ${bags.join(' / ')}개`];
    if (left.some(Boolean)) parts.push(`미적재 ${left.join(' / ')}개`);
    const note =
      cont[2] > cont[1]
        ? ' · CTU 기준이 기본보다 대수가 많습니다(3면 막힘·얹힘 금지).'
        : cont[0] < cont[1]
          ? ' · 적재량 우선이 대수를 줄였습니다.'
          : new Set(cont).size === 1
            ? ' · 세 기준 모두 같은 대수입니다.'
            : '';
    return `<p class="sv-diff">적재량 우선 / 기본 / CTU: ${parts.join(' · ')}${note}</p>`;
  };
  const head = (m, r) => {
    const loaded = r.total - r.unallocated;
    return `<div class="sv-col-head ${m.key}"><b>${esc(m.label)}</b>${r.containers.length}대 · ${loaded}/${r.total}개 적재${r.unallocated ? ` · 미적재 ${r.unallocated}` : ''}<br><span class="sv-grade ${gradeKey[r.grade] || ''}">자동 평가 ${esc(r.grade || '-')}</span>${r.findings?.length ? `<ul class="sv-findings">${r.findings.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}</div>`;
  };
  const cell = (m, r, k) => {
    const c = r.containers[k];
    if (!c) return `<div class="sv-empty">컨테이너 ${k + 1} 없음</div>`;
    const back = r.backImages?.[k];
    return `<figure class="sv-shot${back ? ' can-flip' : ''}"${back ? ` data-front="sample-results/${esc(r.images[k])}" data-back="sample-results/${esc(back)}" title="누르면 반대쪽에서 본 모습"` : ''}><div class="sv-img"><img loading="lazy" src="sample-results/${esc(r.images[k])}" alt="${esc(m.label)} 컨테이너 ${k + 1}">${back ? '<span class="sv-flip">↻ 반대쪽</span>' : ''}</div><figcaption><b>${k + 1}번</b>${back ? ' <span class="sv-dir">정면</span>' : ''} · ${c.placed}개 · ${(c.weightKg / 1000).toFixed(1)}t · 공간 ${c.volumeRate}% · 무게배분 <span class="sv-lvl ${c.ctuLevel}">${levelName[c.ctuLevel] || '-'}</span><br>에어백 ${c.airbags} · 충전재 ${c.fillers} · 바닥 각재 ${c.beams} · 래싱 ${c.lashing}</figcaption></figure>`;
  };

  async function render(view) {
    if (rendered) return;
    rendered = true;
    view.innerHTML = `<div class="sv-head"><div><h2 class="sv-title">샘플 결과 미리보기</h2></div><div class="sv-meta" id="svMeta"></div></div>
      <p class="sv-lead">샘플 20가지를 세 가지 안전 수준으로 계산했습니다. 그림을 누르면 반대쪽에서 본 배치로 바뀝니다. 직접 계산해 보려면 플래너에서 <b>불러오기 → 샘플</b>을 고르세요.<br>결과는 작업 검토용입니다. 실제 적재 전에는 현장 조건을 확인해야 합니다.</p>
      <div class="sv-modes"><div class="sv-mode standard"><b>적재량 우선</b>최대한 많이 싣습니다. 윗 화물 바닥면 70% 이상만 받치고 충돌·중량·상부하중 같은 기본 조건만 지킵니다.</div><div class="sv-mode strict"><b>기본 (권장)</b>윗 화물을 100% 받치고 높은 적층·원통 규칙을 지킵니다. 남는 틈과 윗단은 고정재(에어백·래싱)로 막습니다.</div><div class="sv-mode secure"><b>CTU 기준 적용</b>모든 화물의 안쪽·좌·우를 화물이나 고정재로 막고, 다른 크기 화물 위에 얹지 않습니다. CTU Code 준수를 보증하지는 않습니다.</div></div>
      <div class="sv-toolbar" id="svToolbar"></div><div id="svList"><p class="sv-loading">결과를 불러오는 중입니다…</p></div>`;
    const list = view.querySelector('#svList');
    let data;
    try {
      const res = await fetch('sample-results/manifest.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch {
      list.innerHTML = '<p class="sv-loading">결과 파일을 불러오지 못했습니다.</p>';
      rendered = false;
      return;
    }
    view.querySelector('#svMeta').innerHTML =
      `v${esc(data.appVersion)} · 엔진 ${esc(data.engine)}<br>캡처 ${esc(new Date(data.generatedAt).toLocaleString('ko-KR'))}`;
    const toolbar = view.querySelector('#svToolbar'),
      categories = [...new Set(data.samples.map(s => s.category))];
    const hasBack = data.samples.some(s => Object.values(s.results || {}).some(r => r.backImages?.length));
    toolbar.innerHTML =
      ['전체', ...categories]
        .map((c, i) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${i === 0}">${esc(c)}</button>`)
        .join('') +
      (hasBack
        ? '<button type="button" class="sv-flip-all" id="svFlipAll" aria-pressed="false">↻ 전체 반대쪽 보기</button>'
        : '') +
      `<div class="sv-jump">${data.samples.map(s => `<a href="#samples-${s.id}" data-jump="${s.id}">${s.id}</a>`).join('')}</div>`;
    list.innerHTML = data.samples
      .map(s => {
        const rs = data.modes.map(m => s.results?.[m.key]),
          rows = Math.max(...rs.map(r => r?.containers.length || 0));
        return `<section class="sv-sample" id="samples-${s.id}" data-cat="${esc(s.category)}"><div class="sv-s-head"><h3><span class="sv-no">${s.id}</span>${esc(s.name)}</h3><span class="sv-tag">${esc(s.category)}</span><span class="sv-tag">${esc(s.container)}</span><span class="sv-tag">${esc(s.transport)}</span></div>
        <p class="sv-desc">${esc(s.description)}</p><p class="sv-products">${s.products.map(p => `${esc(p.name)} ${p.qty}개(${esc(p.size)}mm, ${p.weight}kg${p.shape === 'cylinder' ? ', 원통' : ''})`).join(' · ')}</p>${diffLine(data, s)}
        <div class="sv-compare">${data.modes.map((m, i) => (rs[i] ? head(m, rs[i]) : `<div class="sv-col-head ${m.key}"><b>${esc(m.label)}</b>결과 없음</div>`)).join('')}${Array.from({ length: rows }, (_, k) => data.modes.map((m, i) => (rs[i] ? cell(m, rs[i], k) : '<div></div>')).join('')).join('')}</div></section>`;
      })
      .join('');
    // 그림 하나 또는 전체를 정면/반대쪽으로 바꾼다.
    const flip = (fig, back) => {
      const img = fig.querySelector('img');
      fig.classList.toggle('is-back', back);
      img.src = back ? fig.dataset.back : fig.dataset.front;
      const dir = fig.querySelector('.sv-dir');
      if (dir) dir.textContent = back ? '반대쪽' : '정면';
      fig.querySelector('.sv-flip').textContent = back ? '↻ 정면' : '↻ 반대쪽';
    };
    toolbar.addEventListener('click', e => {
      const all = e.target.closest('#svFlipAll');
      if (all) {
        const back = all.getAttribute('aria-pressed') !== 'true';
        all.setAttribute('aria-pressed', String(back));
        all.textContent = back ? '↻ 전체 정면 보기' : '↻ 전체 반대쪽 보기';
        list.querySelectorAll('.sv-shot.can-flip').forEach(fig => flip(fig, back));
        return;
      }
      const b = e.target.closest('button[data-cat]');
      if (b) {
        toolbar.querySelectorAll('button[data-cat]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        list.querySelectorAll('section.sv-sample').forEach(sec => {
          sec.hidden = b.dataset.cat !== '전체' && sec.dataset.cat !== b.dataset.cat;
          // 고른 분류에 없는 번호는 흐리게 하고 누를 수 없게 한다.
          const link = toolbar.querySelector(`a[data-jump="${sec.id.replace('samples-', '')}"]`);
          if (link) {
            link.classList.toggle('is-off', sec.hidden);
            link.setAttribute('aria-disabled', String(sec.hidden));
            link.tabIndex = sec.hidden ? -1 : 0;
          }
        });
        return;
      }
      // 번호 바로가기는 주소(#samples)를 바꾸지 않고 스크롤만 한다.
      const a = e.target.closest('a[data-jump]');
      if (a) {
        e.preventDefault();
        if (a.classList.contains('is-off')) return;
        view.querySelector(`#samples-${a.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    list.addEventListener('click', e => {
      const fig = e.target.closest('.sv-shot.can-flip');
      if (fig) flip(fig, !fig.classList.contains('is-back'));
    });
  }

  // 헤더와 푸터 사이 화면 전환(경로 주소). data-route가 주소와 같거나 그 아래(/library/ctu-code/<해설>)인 화면만 보이고,
  // 맞는 화면이 없으면 적재 플래너(/, /simulator)를 보인다. 보인 화면에는 cubestow:view 이벤트(detail=data-route)를 보낸다.
  const PLANNER_PATHS = new Set(['/', '/simulator']),
    ALIASES = { '/library': '/library/ctu-code' },
    PLANNER_TITLE = document.title;
  // 예전 # 주소(#samples, #library, #library/<해설>)는 새 주소로 옮긴다. 공유된 링크와 즐겨찾기가 계속 열리게.
  function legacyPath(hash) {
    if (hash === '#samples') return '/samples';
    const m = /^#library(?:\/([\w-]+))?$/.exec(hash);
    return m ? '/library/ctu-code' + (m[1] ? '/' + m[1] : '') : null;
  }
  const views = () => [...document.querySelectorAll('[data-route]')],
    viewFor = path => views().find(v => path === v.dataset.route || path.startsWith(v.dataset.route + '/')) || null;
  // 주소를 정리한다: 옛 # 주소 → 새 주소, 별칭 → 본 주소, 끝의 / 제거, 모르는 주소 → /.
  function normalize() {
    const legacy = legacyPath(location.hash);
    if (legacy) return history.replaceState(null, '', legacy);
    let path = location.pathname.replace(/\/+$/, '') || '/';
    path = ALIASES[path] || path;
    if (!PLANNER_PATHS.has(path) && !viewFor(path)) path = '/';
    if (path !== location.pathname) history.replaceState(null, '', path + location.search + location.hash);
  }
  function setCanonical(path) {
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = new URL(PLANNER_PATHS.has(path) ? '/' : path, link.href).href;
  }
  function route() {
    const view = document.getElementById('samplesView'),
      planner = document.getElementById('planner');
    if (!view || !planner) return;
    normalize();
    const path = location.pathname,
      active = viewFor(path);
    views().forEach(v => (v.hidden = v !== active));
    planner.hidden = Boolean(active);
    setCanonical(path);
    document.title = active?.dataset.title || PLANNER_TITLE;
    // 적재 플래너는 메뉴가 아니라 로고(Cubestow)로 돌아간다.
    document
      .querySelectorAll('.topbar nav a')
      .forEach(a => a.classList.toggle('active', Boolean(active) && a.getAttribute('href') === active.dataset.route));
    if (!active) {
      window.dispatchEvent(new Event('resize'));
      return;
    }
    if (active === view) {
      fitTop();
      render(view);
    }
    document.dispatchEvent(new CustomEvent('cubestow:view', { detail: active.dataset.route }));
    window.scrollTo(0, 0);
  }
  // 사이트 안 주소로 가는 링크는 새로 불러오지 않고 주소만 바꿔 화면을 바꾼다(새 탭·다운로드·수정키 클릭은 그대로).
  function isAppPath(path) {
    const p = path.replace(/\/+$/, '') || '/';
    return PLANNER_PATHS.has(p) || Boolean(ALIASES[p]) || Boolean(viewFor(p));
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !isAppPath(url.pathname)) return;
    e.preventDefault();
    if (url.pathname + url.search !== location.pathname + location.search)
      history.pushState(null, '', url.pathname + url.search);
    route();
  });
  window.addEventListener('popstate', route);
  // 페이지 안에서 옛 # 주소로 바뀌었을 때만 다시 고른다(샘플 번호 바로가기 같은 # 는 그대로 둔다).
  window.addEventListener('hashchange', () => {
    if (legacyPath(location.hash)) route();
  });
  // 고정 툴바는 헤더 바로 아래에 붙인다. 모바일에서는 헤더가 두 줄이라 높이를 재서 맞춘다.
  function fitTop() {
    const view = document.getElementById('samplesView'),
      bar = document.querySelector('.topbar');
    if (view && bar) view.style.setProperty('--sv-top', bar.offsetHeight + 'px');
  }
  window.addEventListener('resize', fitTop);
  // 샘플 창 안의 미리보기 링크를 누르면 창을 닫고 샘플 결과로 간다.
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-close-dialog]');
    if (a) a.closest('dialog')?.close();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', route);
  else route();
})();
