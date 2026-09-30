// 맨 위로 단추(사이트 전체): 한 화면쯤 내려가면 오른쪽 아래에 나타나고, 누르면 맨 위로 올라간다.
// 플래너·샘플 결과·자료실 어느 화면이든 문서 전체가 구르므로 창의 스크롤 하나만 본다.
(function () {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'to-top';
  button.title = '맨 위로';
  button.setAttribute('aria-label', '맨 위로');
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>';
  button.hidden = true;
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }));
  // 지금 보이는 화면의 본문: 자료실에서 해설을 열었으면 그 글 카드, 아니면 화면 영역 자체.
  const content = () => {
    const view = ['#libraryView', '#samplesView', '#planner']
      .map(s => document.querySelector(s))
      .find(el => el && !el.hidden && el.offsetParent !== null);
    return view?.querySelector('.lib-article') || view;
  };
  const GAP = 16;
  // 보이는 높이의 60%(최소 400px) 넘게 내려갔을 때만 보인다. 짧은 쪽에서는 나타나지 않는다.
  // 본문 오른쪽에 자리가 있으면 본문 옆(간격 16px)에 서고, 맨 아래에서는 본문의 아래 끝선에 맞춘다.
  // 자리가 없으면(좁은 화면) 화면 오른쪽 아래에 두고, 바닥글이 보이면 그 위로 올린다.
  const update = () => {
    button.hidden = window.scrollY < Math.max(400, window.innerHeight * 0.6);
    if (button.hidden) return;
    const size = button.offsetWidth || 46,
      box = content()?.getBoundingClientRect(),
      beside = box && box.right + GAP + size + 8 <= window.innerWidth;
    button.classList.toggle('is-beside', !!beside);
    if (beside) {
      button.style.left = `${Math.round(box.right + GAP)}px`;
      button.style.top = `${Math.round(Math.max(12, Math.min(window.innerHeight - size - 20, box.bottom - size)))}px`;
      return;
    }
    button.style.left = button.style.top = '';
    const footer = document.querySelector('.site-footer'),
      overlap = footer ? window.innerHeight - footer.getBoundingClientRect().top : 0;
    // 바닥글이 보이면 바닥글 바로 위(8px)에 붙여, 본문 카드와 바닥글 사이 좁은 틈에서도 카드에 닿지 않게 한다.
    button.style.setProperty('--to-top-lift', `${overlap > 0 ? Math.round(overlap) - 6 : 0}px`);
  };
  const mount = () => {
    document.body.append(button);
    update();
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  // 플래너·샘플 결과·자료실을 오가면 본문이 바뀌므로 다시 잰다.
  document.addEventListener('cubestow:view', () => requestAnimationFrame(update));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
