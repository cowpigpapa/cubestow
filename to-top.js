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
  // 보이는 높이의 60%(최소 400px) 넘게 내려갔을 때만 보인다. 짧은 쪽에서는 나타나지 않는다.
  // 바닥글이 화면에 들어오면 단추를 그 위로 올려 방문자 수·저작권 줄과 겹치지 않게 한다.
  const update = () => {
    button.hidden = window.scrollY < Math.max(400, window.innerHeight * 0.6);
    if (button.hidden) return;
    const footer = document.querySelector('.site-footer'),
      overlap = footer ? window.innerHeight - footer.getBoundingClientRect().top : 0;
    button.style.setProperty('--to-top-lift', `${Math.max(0, Math.round(overlap))}px`);
  };
  const mount = () => {
    document.body.append(button);
    update();
  };
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
