// 상수·안전 기준·운송 프로필·휴리스틱 목록과 폭 오라클.

  const ENGINE_VERSION = 'ep-lex-portfolio-2026.10.28';
  const TOL = 2;
  const MAX_CONTAINERS = 50;
  const ORDER_COUNT = 4;

  // 하드 조건(안전 기준). 모든 후보는 선택된 안전 기준을 통과해야만 배치된다.
  const SAFETY_LEVELS = {
    strict: { label: '기본', description: '상부 지지 100%', minSupport: 1, maxTopSlender: 1.15, cylinderOnFloor: true },
    // 최고 안전: 엄격 조건에 더해, 모든 화물의 안쪽·좌·우 3면이 벽·화물·에어백 간극으로 막혀야 한다(문쪽은 각재·부목으로 막는다).
    secure: {
      label: 'CTU 기준 적용',
      description: '상부 지지 100% · 3면 막힘(화물·고정재)',
      minSupport: 1,
      maxTopSlender: 1.15,
      cylinderOnFloor: true,
      blockSides: true
    },
    standard: { label: '적재량 우선', description: '상부 지지 70% 이상', minSupport: 0.7, maxTopSlender: Infinity }
  };
  // 소프트 목표(우선 기준). 미배치 수량과 컨테이너 대수가 같을 때만 순위를 가른다.
  const PREFERENCES = {
    auto: { label: '추천' },
    density: { label: '붙여 싣기' },
    width: { label: '폭 균형(추천에 통합)' },
    balance: { label: '무게중심' }
  };
  const TRANSPORT_PROFILES = {
    sea: { label: '해상', slender: 1.35, column: 1.7, minSides: 3 },
    combined: { label: '복합', slender: 1.5, column: 2, minSides: 2 },
    road: { label: '육상', slender: 1.75, column: 2.4, minSides: 2 }
  };
  // 배치 생성기. 우선 기준과 무관하게 모두 실행하고, 결과를 우선 기준으로 고른다.
  const HEURISTICS = {
    dblf: { floorFirst: true },
    density: { floorFirst: false },
    width: { floorFirst: true },
    balance: { floorFirst: false },
    column: { floorFirst: true, key: 'dblf' },
    columnBalance: { floorFirst: true, key: 'dblf' },
    wall: { floorFirst: true, key: 'dblf' },
    strip: { floorFirst: true, key: 'dblf' }
  };
  const PREFERRED_HEURISTIC = { auto: 'column', density: 'density', width: 'width', balance: 'balance' };

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function compareKeys(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length - b.length;
  }

  function uniqueRotations(p) {
    const all = [
      [p.l, p.w, p.h],
      [p.w, p.l, p.h],
      [p.l, p.h, p.w],
      [p.h, p.l, p.w],
      [p.w, p.h, p.l],
      [p.h, p.w, p.l]
    ];
    return all.filter((d, i) => all.findIndex(e => e[0] === d[0] && e[1] === d[1] && e[2] === d[2]) === i);
  }
  function allowedRotations(p) {
    return p.rotate ? uniqueRotations(p) : uniqueRotations(p).filter(d => d[2] === p.h);
  }

  // 입력 화물의 폭 조합으로 채울 수 없는 짧은 방향 잔여 폭을 계산한다.
  function createWidthOracle(units, maxWidth) {
    const widths = [
      ...new Set(units.flatMap(p => allowedRotations(p).map(d => Math.round(d[1]))).filter(w => w > 0 && w <= maxWidth))
    ].sort((a, b) => a - b);
    const cache = new Map();
    return function projectedWidthGap(remaining) {
      if (remaining <= 0) return 0;
      const usable = widths.filter(w => w <= remaining);
      if (!usable.length) return remaining;
      const key = `${Math.round(remaining)}:${usable.length}`;
      if (cache.has(key)) return cache.get(key);
      const limit = Math.floor(remaining),
        reachable = new Uint8Array(limit + 1);
      reachable[0] = 1;
      for (let used = 0; used <= limit; used++) {
        if (!reachable[used]) continue;
        for (const w of usable) if (used + w <= limit) reachable[used + w] = 1;
      }
      let gap = remaining;
      for (let used = limit; used >= 0; used--)
        if (reachable[used]) {
          gap = remaining - used;
          break;
        }
      cache.set(key, gap);
      return gap;
    };
  }

