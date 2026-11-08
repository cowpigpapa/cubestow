// ONHARU 방문 기록(방문자 DB). ?owner=1로 한 번 들른 브라우저는 빠지고(?owner=0으로 해제),
// IP는 서버에서 읽어 30일 뒤 지운다. 화면에 방문자 수는 표시하지 않는다.
(() => {
  const SITE = 'cubestow';
  const HOST = 'cubestow.onharu.app';
  if (location.hostname !== HOST) return;
  try {
    const flag = new URLSearchParams(location.search).get('owner');
    if (flag === '1') localStorage.setItem('onharu-owner', '1');
    if (flag === '0') localStorage.removeItem('onharu-owner');
    if (localStorage.getItem('onharu-owner') === '1') return;
  } catch (_) {}
  let referrer = null;
  try {
    if (document.referrer) {
      const ref = new URL(document.referrer);
      if (ref.host !== location.host) referrer = ref.origin + ref.pathname;
    }
  } catch (_) {}
  fetch('https://yihsukyedtlsdbexthlu.supabase.co/rest/v1/rpc/log_visit', {
    method: 'POST',
    headers: { apikey: 'sb_publishable_vgcDAWoOJRD8Xvp2p4Ew9A_exTmzuXM', 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_site: SITE, p_path: location.pathname, p_referrer: referrer }),
    keepalive: true
  }).catch(() => {});
})();
