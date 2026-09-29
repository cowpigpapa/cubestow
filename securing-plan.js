// 고정재 계획: 적재 결과(컨테이너 1대)에 에어백·스페이서·충전재·각재·쐐기·래싱·검토 항목을 만든다.
// app.js에서 분리했다(1.1.77). 화면 없이도 쓸 수 있게 DOM을 건드리지 않는다.
// app.js보다 먼저 불러온다. esc·currentTransportMode·securingOptions는 app.js에 있고 호출할 때만 쓴다.

// 고정재 기준은 CTU Code(IMO/ILO/UNECE) 부속서 7을 기본으로 한다. CTU가 수치를 정하지 않은 곳은 CTU가 따르라고 한 제조사 기준, 그래도 없으면 Cubestow 설정값(표시)을 쓴다.
// [CTU §2.3.6] 어느 수평 방향이든 빈 공간의 합은 15cm 이하. 넘으면 채운다.
// [CTU §2.3.8 → 제조사] 에어백은 제조사 최대 간극을 지킨다: Stopak 최대 500mm(1500×2400), 규격별 백 폭의 약 1/3. 넘는 간극은 충전재로 줄인다. 백은 바닥에 닿지 않게.
// [CTU 부속서 7] 못 1개 1~4kN → 하한 1kN으로 못 수 계산. 마찰계수 기본 0.3, 가속도는 IMO 빠른 래싱 가이드 표.
// [Cubestow 설정] 에어백 최소 간극 50mm, 바닥에서 100mm 띄움, 스페이서/에어백 경계 120mm, 10mm 미만 틈은 채울 수 없음.
const VOID_SUM_LIMIT = 150,
  AIRBAG_MIN_GAP = 50,
  AIRBAG_MAX_GAP = 500,
  AIRBAG_FLOOR_CLEARANCE = 100,
  AIRBAG_LIMIT = 40,
  NAIL_KN = 1,
  CTU_FRICTION = 0.3;
// [CTU 정보자료 5(빠른 래싱 가이드) §3.1 표] 합판 바닥 위 화물 밑면별 마찰계수. 확인할 수 없으면 0.3(§3.2), 기름기·슬립시트는 0.1.
const FRICTION_CHOICES = {
  unknown: { mu: 0.3, label: '확인 안 됨' },
  'wood-pallet': { mu: 0.45, label: '목재 팔레트·각재' },
  'planed-wood': { mu: 0.3, label: '대패질 목재' },
  'plastic-pallet': { mu: 0.2, label: '플라스틱 팔레트' },
  'steel-crate': { mu: 0.45, label: '철제 크레이트' },
  rubber: { mu: 0.6, label: '고무 미끄럼 방지 매트' },
  slip: { mu: 0.1, label: '기름기·슬립시트' }
};
// [CTU 정보자료 5 §12.2 빠른 래싱 가이드 C(도로·복합철도·해상 C), 웨빙 MSL 2,000daN·사전장력 400daN]
// 마찰계수별로 스프링 래싱 1줄(앞쪽)과 하프루프 래싱 한 쌍(옆쪽)이 미끄럼을 막는 화물 질량(t). 값은 래싱 MSL에 비례한다(§6).
const QLG_C_MU = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
const QLG_C_SPRING_FORWARD = [3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.1, 6.8, 7.5, 8.3, 9.3, 11, 12, 14, 15];
const QLG_C_HALFLOOP_SIDE = [2.5, 2.8, 3, 3.3, 3.6, 4, 4.3, 4.8, 5.3, 5.9, 6.6, 7.4, 8.4, 9.7, 11];
// [ISO 1496-1, CTU 정보자료 5 §5.3] 래싱 고정점은 래싱과 같은 MSL 이상이어야 한다. 고정점 표시를 확인하지 않으면
// ISO 최소값(바닥·하부 고정점 1,000daN, 위쪽 래싱 고리 500daN)을 넘는 힘을 래싱에 맡기지 않는다.
const ANCHOR_MSL_FLOOR = 1000,
  ANCHOR_MSL_UPPER = 500,
  LASHING_MSL_CHOICES = [2000, 2500, 4000, 5000];
const frictionOf = options => (FRICTION_CHOICES[options?.friction] || FRICTION_CHOICES.unknown).mu;
const lashingMslOf = options =>
  LASHING_MSL_CHOICES.includes(Number(options?.lashingMsl)) ? Number(options.lashingMsl) : 2000;
// 래싱 1줄(한 쌍)이 실제로 쓸 수 있는 MSL: 래싱 MSL과 고정점 허용하중 중 작은 값.
const anchorMslOf = (options, upper) =>
  options?.anchors === 'rated' ? lashingMslOf(options) : upper ? ANCHOR_MSL_UPPER : ANCHOR_MSL_FLOOR;
const DOOR_FREE_GAP = VOID_SUM_LIMIT,
  FENCE_DEPTH = 50,
  SPACER_MIN_GAP = 10,
  SPACER_MAX_GAP = 120;
// 문쪽(후방) 방향 필요 억제 가속도(g): 운송모드별 CTU 가속도 c에서 마찰 μ·v를 뺀 값의 최댓값.
// 안쪽(전방·급정거) 방향으로 막아야 할 가속도: CTU 가속도 c − 마찰 × v, 운송모드 중 불리한 값.
function innerPull(mode, mu = CTU_FRICTION) {
  const acc = LoadwiseInsights.CTU_ACCELERATIONS,
    profiles = mode === 'road' ? ['road'] : mode === 'sea' ? ['seaC'] : ['road', 'seaC'];
  return Math.max(0, ...profiles.map(k => acc[k].forward.c - mu * acc[k].forward.v));
}
function doorPull(mode, mu = CTU_FRICTION) {
  const acc = LoadwiseInsights.CTU_ACCELERATIONS,
    profiles = mode === 'road' ? ['road'] : mode === 'sea' ? ['seaC'] : ['road', 'seaC'];
  return Math.max(0, ...profiles.map(k => acc[k].backward.c - mu * acc[k].backward.v));
}
const airbagSize = gap => (gap <= 200 ? '600×1200' : gap <= 300 ? '900×1800' : gap <= 400 ? '1200×1800' : '1500×2400');
// 화물마다 네 옆면을 보고, 가장 가까운 화물·벽·고정재와의 틈을 크기별로 채운다.
// 30mm 미만은 무시, 120mm 미만은 스페이서(골판지·목재), 120~600mm는 에어백(높은 곳이면 그 높이에), 안쪽 벽 쪽은 에어백 대신 충전재.
// 높은 곳 화물의 틈이 600mm를 넘거나 문쪽이 비면 에어백·충전재를 세울 수 없으므로 화물 위로 넘기는 상단 래싱(측벽 고정점)을 권고한다.
function fillRemainingVoids(load, airbags, dunnage, options = securingOptions) {
  const c = load.container,
    placed = load.placed,
    solid = [...placed, ...airbags, ...dunnage];
  const hit = (a, b) =>
    Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x) > 1 &&
    Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y) > 1 &&
    Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > 1;
  const ov = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);
  const dirs = [
    { key: 'back', axis: 'x', sign: 1 },
    { key: 'front', axis: 'x', sign: -1 },
    { key: 'left', axis: 'y', sign: -1 },
    { key: 'right', axis: 'y', sign: 1 }
  ];
  let bags = airbags.length;
  const lash = [],
    todo = [];
  // 선(점 하나를 지나는 축 방향 직선) 위 빈 공간의 합. 길이 방향은 그 선에서 가장 문쪽 화물부터 안쪽 벽까지(문쪽 공간은 문쪽 고정이 맡는다).
  const lineVoid = (axis, p) => {
    const zc = p.z + p.h / 2,
      spans = [];
    let from;
    if (axis === 'y') {
      const xc = p.x + p.l / 2;
      for (const q of solid) if (xc > q.x && xc < q.x + q.l && zc > q.z && zc < q.z + q.h) spans.push([q.y, q.y + q.w]);
      from = 0;
    } else {
      const yc = p.y + p.w / 2;
      for (const q of solid) if (yc > q.y && yc < q.y + q.w && zc > q.z && zc < q.z + q.h) spans.push([q.x, q.x + q.l]);
      from = Math.min(...spans.map(s => s[0]));
    }
    const to = axis === 'y' ? c.w : c.l;
    spans.sort((m, n) => m[0] - n[0]);
    let covered = 0,
      end = from;
    for (const [s0, s1] of spans) {
      const f = Math.max(s0, end),
        t = Math.min(s1, to);
      if (t > f) {
        covered += t - f;
        end = t;
      }
    }
    return to - from - covered;
  };
  for (const p of placed)
    for (const d of dirs) {
      const along = d.axis === 'x' ? ['y', 'w'] : ['x', 'l'],
        [a, len] = along,
        edge = d.axis === 'x' ? (d.sign < 0 ? p.x : p.x + p.l) : d.sign < 0 ? p.y : p.y + p.w;
      // 이 면 쪽의 가장 가까운 물체(화물·고정재)와 틈. 없으면 벽(문)까지.
      let gap = d.axis === 'x' ? (d.sign < 0 ? edge : c.l - edge) : d.sign < 0 ? edge : c.w - edge,
        facing = null;
      for (const q of solid) {
        if (
          q === p ||
          ov(p.z, p.z + p.h, q.z, q.z + q.h) <= Math.min(p.h, q.h) * 0.3 ||
          ov(p[a], p[a] + p[len], q[a], q[a] + q[len]) <= p[len] * 0.3
        )
          continue;
        const g =
          d.axis === 'x'
            ? d.sign < 0
              ? edge - (q.x + q.l)
              : q.x - edge
            : d.sign < 0
              ? edge - (q.y + q.w)
              : q.y - edge;
        if (g >= -2 && g < gap) {
          gap = g;
          facing = q;
        }
      }
      if (gap < SPACER_MIN_GAP) continue;
      // 문쪽이 비면(바닥 화물은 문쪽 고정이 맡는다) 또는 높은 곳에서 에어백 한계를 넘으면 상단 래싱 대상.
      if ((d.key === 'front' && !facing) || gap > AIRBAG_MAX_GAP) {
        if (p.z > 0) lash.push({ p, dir: d.key });
        continue;
      }
      // 안쪽 벽 쪽 틈은 채우지 않는다(현장은 안쪽부터 화물로 꽉 채운다, 사용자 결정 2026-09-27). 엔진이 화물을 안쪽 벽으로 밀어 두므로 거의 생기지 않는다.
      if (d.key === 'back' && !facing) continue;
      const wall = !facing,
        toInner = false,
        overlapA = facing
          ? [Math.max(p[a], facing[a]), Math.min(p[a] + p[len], facing[a] + facing[len])]
          : [p[a], p[a] + p[len]];
      const z0 = facing ? Math.max(p.z, facing.z) : p.z,
        z1 = facing ? Math.min(p.z + p.h, facing.z + facing.h) : p.z + p.h;
      if (overlapA[1] - overlapA[0] < 150 || z1 - z0 < 150) continue;
      const spacer = gap < SPACER_MAX_GAP || toInner,
        box = { x: 0, y: 0, z: 0, l: 0, w: 0, h: 0 };
      box[a] = overlapA[0] + (spacer ? 0 : (overlapA[1] - overlapA[0]) * 0.15);
      box[len] = (overlapA[1] - overlapA[0]) * (spacer ? 1 : 0.7);
      if (d.axis === 'x') {
        box.x = edge;
        box.l = gap;
      } else {
        box.y = d.sign < 0 ? edge - gap : edge;
        box.w = gap;
      }
      box.z = spacer ? z0 : Math.max(z0 + (z1 - z0) * 0.12, z0 === 0 ? AIRBAG_FLOOR_CLEARANCE : z0 + 20);
      box.h = spacer ? Math.min(z1 - z0, 1400) : Math.min(1200, z1 - box.z - (z1 - z0) * 0.1);
      todo.push({ p, d, gap, box, spacer, toInner, wall });
    }
  todo.sort((m, n) => n.gap - m.gap);
  for (const { p, d, gap, box, spacer, toInner } of todo) {
    if (lineVoid(d.axis, p) <= VOID_SUM_LIMIT) continue;
    if (box.h < 120 || solid.some(q => hit(q, box))) continue;
    const side = { back: '안쪽', front: '문쪽', left: '좌측', right: '우측' }[d.key],
      level = box.z > 200 ? ` · ${(box.z / 1000).toFixed(1)}m 높이` : '';
    if (spacer) {
      const item = {
        type: 'dunnage',
        kind: 'spacer',
        axis: d.axis,
        side: d.sign < 0 ? 'min' : 'max',
        ...box,
        product: p.name,
        location: `${esc(p.name)} ${side} 틈 ${Math.round(gap)}mm ${toInner ? '충전재(안쪽 벽, 에어백 금지)' : '스페이서(골판지·목재)'}${level}`
      };
      dunnage.push(item);
      solid.push(item);
    } else if (bags < AIRBAG_LIMIT && box.x > 1 && box.x + box.l < c.l - 1) {
      const item = {
        type: 'airbag',
        zone: 'gap',
        bag: airbagSize(gap),
        ...box,
        product: p.name,
        location: `${esc(p.name)} ${side} 틈 ${Math.round(gap)}mm${level}`
      };
      airbags.push(item);
      solid.push(item);
      bags++;
    }
  }
  // 윗단 되잡기 래싱(CTU 부속서 7 §3.2.7 "strapping top layers back"): 윗단의 열린 앞(문쪽)·뒤 면을 가로지르는 웨빙을 그 단 높이의 2/3에 두고
  // 좌우 측벽 고정점에 건다. 화물 위로 넘기는 래싱(top-over)은 마찰로만 눌러 미끄럼에 약하므로 쓰지 않는다(§4.3.5).
  // 같은 면(앞면 위치 60mm, 높이 250mm 이내)에 있는 윗단은 한 줄로 묶는다. 옆이 빈 윗단은 하프루프 래싱 한 쌍을 권고한다(QLG §1.3).
  const faces = [],
    sides = [];
  for (const { p, dir } of lash) {
    if (dir === 'left' || dir === 'right') {
      if (!sides.includes(p)) sides.push(p);
      continue;
    }
    const faceX = dir === 'back' ? p.x + p.l : p.x,
      z = p.z + (p.h * 2) / 3;
    let g = faces.find(f => f.dir === dir && Math.abs(f.faceX - faceX) <= 60 && Math.abs(f.z - z) <= 250);
    if (!g) faces.push((g = { dir, faceX, z, items: [] }));
    if (!g.items.includes(p)) g.items.push(p);
  }
  for (const g of faces) {
    const x = g.dir === 'back' ? g.faceX + 4 : Math.max(0, g.faceX - 22),
      y0 = Math.min(...g.items.map(p => p.y)),
      y1 = Math.max(...g.items.map(p => p.y + p.w)),
      mass = g.items.reduce((sum, p) => sum + p.weight, 0);
    let band = { x, y: 0, z: Math.round(g.z - 25), l: 18, w: c.w, h: 50 };
    // 측벽까지 걸 수 없으면(다른 화물이 가로막으면) 윗단 폭만큼만 두고 가까운 고정점에 건다.
    if (solid.some(q => hit(q, band))) band = { ...band, y: y0, w: y1 - y0 };
    if (band.z + band.h > c.h || solid.some(q => hit(q, band))) continue;
    // 측벽 고정점: 컨테이너 높이의 절반보다 위면 위쪽 래싱 고리, 아니면 하부 고정점에 건다.
    const upperPoint = band.z >= c.h / 2,
      straps = lashingCount(mass, 'long', options, upperPoint),
      names = [...new Set(g.items.map(p => p.name))].map(esc).join('·');
    const item = {
      type: 'dunnage',
      kind: 'lashing',
      axis: 'y',
      side: 'min',
      ...band,
      straps,
      mass,
      upperPoint,
      product: names,
      location: `${names} 윗단 ${g.dir === 'back' ? '안쪽' : '문쪽'} 면 되잡기 래싱 · 높이 ${(g.z / 1000).toFixed(1)}m · 웨빙(MSL ${lashingMslOf(options) / 1000}t) ${straps}줄 · 측벽 ${upperPoint ? '위쪽 고리' : '하부 고정점'} ${anchorMslOf(options, upperPoint).toLocaleString()}daN 기준`
    };
    dunnage.push(item);
    solid.push(item);
  }
  if (sides.length) {
    const mass = sides.reduce((sum, p) => sum + p.weight, 0),
      pairs = lashingCount(mass, 'side', options, false);
    dunnage.push({
      type: 'dunnage',
      kind: 'note',
      x: 0,
      y: 0,
      z: 0,
      l: 0,
      w: 0,
      h: 0,
      straps: pairs,
      product: [...new Set(sides.map(p => p.name))].map(esc).join('·'),
      location: `옆이 빈 윗단 ${sides.length}개 · 하프루프 래싱 ${pairs}쌍(바닥 고정점 ${anchorMslOf(options, false).toLocaleString()}daN 기준, 좌우 전도·미끄럼 방지)`
    });
  }
}
// 빠른 래싱 가이드 C 표를 마찰계수로 보간한다(표 사이는 직선, 0.7 넘으면 0.7 값).
function qlgMass(table, mu) {
  const m = Math.max(0, Math.min(0.7, mu));
  let i = 0;
  while (i < QLG_C_MU.length - 2 && m > QLG_C_MU[i + 1] + 1e-9) i++;
  const t = (m - QLG_C_MU[i]) / (QLG_C_MU[i + 1] - QLG_C_MU[i]);
  return table[i] + (table[i + 1] - table[i]) * t;
}
// 래싱 1줄(옆쪽은 한 쌍)이 막는 화물 질량(kg): 표 값 × 쓸 수 있는 MSL/2,000. 기본(마찰 0.3, MSL 2t, 고정점 확인): 앞뒤 6.1t, 옆 4.3t.
function lashingCapacityKg(kind, options, upper) {
  return (
    (qlgMass(kind === 'side' ? QLG_C_HALFLOOP_SIDE : QLG_C_SPRING_FORWARD, frictionOf(options)) *
      1000 *
      Math.min(lashingMslOf(options), anchorMslOf(options, upper))) /
    2000
  );
}
function lashingCount(massKg, kind, options = { anchors: 'rated' }, upper = false) {
  return Math.max(1, Math.ceil(massKg / lashingCapacityKg(kind, options, upper)));
}
function buildSecuringPlan(load, transportMode = currentTransportMode(), options = securingOptions, safety) {
  const dunnage = [],
    airbags = [],
    reviews = [],
    floorItems = load.placed.filter(p => p.z === 0),
    c = load.container;
  // 문쪽: 앞에 화물이 없는 문쪽 화물이 문에서 150mm 넘게 떨어져 있으면 뒤 기둥 사이에 가로 각재 펜스를 세우고, 펜스와 화물 사이를 충전재로 채운다.
  // 150mm 이하의 틈은 문을 경계로 본다(CTU Code 부속서 7 §2.3.6 간극 합 15cm, §4.2.5). 컨테이너 바닥에는 보통 못을 박을 수 없어 바닥 부목은 쓰지 않는다.
  const doorExposed = load.placed.filter(
    p =>
      !load.placed.some(
        q => q !== p && q.x + q.l <= p.x + 2 && Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y) > 40
      )
  );
  const recessed = doorExposed.filter(p => p.x > DOOR_FREE_GAP);
  if (recessed.length) {
    // 바닥 화물: 문쪽 면 바로 앞 바닥에 가로 각재를 대고 못으로 고정한다. 틈이 크면 각재 앞에 쐐기 부목을 더 박는다.
    // 못 수 = 필요 억제력(화물 + 그 위 적층 질량 × g × 문쪽 가속도) ÷ 1kN(CTU 못 1개 하한). 못은 바닥 두께의 2/3 이상 박는다.
    const pull = doorPull(transportMode, frictionOf(options)),
      inCargo = f =>
        load.placed.some(
          q =>
            f.x < q.x + q.l &&
            f.x + f.l > q.x &&
            f.y < q.y + q.w &&
            f.y + f.w > q.y &&
            f.z < q.z + q.h &&
            f.z + f.h > q.z
        );
    recessed
      .filter(p => p.z === 0 && options.nails)
      .forEach(p => {
        const mass = load.placed
          .filter(
            q =>
              q === p ||
              (q.z >= p.z + p.h - 2 &&
                Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x) > q.l * 0.5 &&
                Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y) > q.w * 0.5)
          )
          .reduce((sum, q) => sum + q.weight, 0);
        const force = (mass * 9.81 * pull) / 1000,
          nails = Math.max(2, Math.ceil(force / NAIL_KN)),
          beamL = Math.min(100, p.x - 2);
        const beam = {
          type: 'dunnage',
          kind: 'beam',
          axis: 'x',
          side: 'min',
          x: p.x - beamL,
          y: p.y,
          z: 0,
          l: beamL,
          w: p.w,
          h: 100,
          product: p.name,
          nails,
          force,
          location: `${esc(p.name)} 앞 바닥 각재 · 못 ${nails}개 · 필요 억제력 ${force.toFixed(1)}kN`
        };
        if (inCargo(beam)) return;
        dunnage.push(beam);
        if (p.x - beamL < 160) return;
        const count = Math.max(2, Math.min(4, Math.round(p.w / 450))),
          chockL = Math.min(180, p.x - beamL - 10);
        for (let i = 0; i < count; i++) {
          const w = Math.min(150, (p.w / count) * 0.55),
            center = p.y + (p.w * (i + 0.5)) / count,
            chock = {
              type: 'dunnage',
              kind: 'chock',
              axis: 'x',
              side: 'min',
              x: p.x - beamL - chockL - 2,
              y: Math.max(0, Math.min(c.w - w, center - w / 2)),
              z: 0,
              l: chockL,
              w,
              h: 125,
              product: p.name,
              location: `${esc(p.name)} 각재 지지 쐐기 ${i + 1}/${count} · 바닥 못 고정`
            };
          if (!inCargo(chock)) dunnage.push(chock);
        }
      });
    // 윗단(바닥에서 뜬) 노출 화물: 뒤 기둥 사이 각재 펜스와 충전재.
    // 바닥 못을 쓰지 않으면 바닥 화물도 펜스와 충전재로 막는다.
    // 못과 래싱을 모두 쓰면 바닥 화물은 각재, 윗단은 되잡기 래싱(fillRemainingVoids)이 막으므로 문쪽 펜스·충전재 덩어리를 두지 않는다(사용자 결정 2026-09-27).
    // 못이나 래싱을 끈 경우에만 대신 펜스와 충전재로 막는다.
    const upper = options.nails && options.lashing ? [] : recessed.filter(p => p.z > 0 || !options.nails);
    if (upper.length) {
      const nearDoor = Math.min(...doorExposed.map(p => p.x)),
        depth = Math.min(FENCE_DEPTH, nearDoor - 5);
      const spans =
        depth >= 20
          ? [[0, c.w]]
          : upper
              .map(p => [p.y, p.y + p.w])
              .sort((m, n) => m[0] - n[0])
              .reduce((out, [y0, y1]) => {
                const last = out[out.length - 1];
                if (last && y0 <= last[1] + 5) last[1] = Math.max(last[1], y1);
                else out.push([y0, y1]);
                return out;
              }, []);
      const fenceDepth = depth >= 20 ? depth : FENCE_DEPTH,
        bottom = Math.min(...upper.map(p => p.z)) + (options.nails ? 50 : 150),
        top = Math.min(c.h - 80, Math.max(...upper.map(p => p.z + p.h))),
        levels = Math.max(2, Math.ceil((top - bottom) / 550) + 1);
      spans.forEach(([y0, y1], k) => {
        for (let i = 0; i < levels; i++) {
          const z = Math.round(bottom + ((top - bottom - 100) * i) / Math.max(1, levels - 1)),
            f = {
              type: 'dunnage',
              kind: 'fence',
              axis: 'y',
              side: 'min',
              x: 0,
              y: y0,
              z,
              l: fenceDepth,
              w: y1 - y0,
              h: 100,
              product: '문쪽 윗단 화물',
              location: `문쪽 각재 펜스${spans.length > 1 ? ` ${k + 1}구간` : ''} · ${i + 1}/${levels}단 · 높이 ${(z / 1000).toFixed(1)}m · 뒤 기둥 고정`
            };
          if (!inCargo(f)) dunnage.push(f);
        }
      });
      upper.forEach(p => {
        const gap = Math.round(p.x - fenceDepth);
        if (gap < 30) return;
        const f = {
          type: 'dunnage',
          kind: 'filler',
          axis: 'x',
          side: 'min',
          x: fenceDepth,
          y: p.y,
          z: p.z,
          l: gap - 2,
          w: p.w,
          h: Math.min(p.h, 1400),
          product: p.name,
          location: `문쪽 충전재 ${gap}mm · ${esc(p.name)} 앞(세운 팔레트·골판지)`
        };
        if (!inCargo(f)) dunnage.push(f);
      });
    }
  }
  // 안쪽 끝: 무거운 화물을 가운데로 옮겨 안쪽 벽과 떨어진 바닥 화물은 문쪽과 같이 뒤쪽 바닥에 각재를 대고 못으로 고정한다(쐐기 추가).
  // 못 수는 안쪽 방향(급정거) 가속도로 계산한다. 못을 쓰지 않으면 각재 버팀을 검토 항목으로 남긴다.
  {
    const innerExposed = load.placed.filter(
      p =>
        p.z === 0 &&
        c.l - (p.x + p.l) > DOOR_FREE_GAP &&
        !load.placed.some(
          q => q !== p && q.x >= p.x + p.l - 2 && Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y) > 40
        )
    );
    const pull = innerPull(transportMode, frictionOf(options));
    if (innerExposed.length && options.nails)
      innerExposed.forEach(p => {
        const mass = load.placed
          .filter(
            q =>
              q === p ||
              (q.z >= p.z + p.h - 2 &&
                Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x) > q.l * 0.5 &&
                Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y) > q.w * 0.5)
          )
          .reduce((sum, q) => sum + q.weight, 0);
        const force = (mass * 9.81 * pull) / 1000,
          nails = Math.max(2, Math.ceil(force / NAIL_KN)),
          beamL = Math.min(100, c.l - (p.x + p.l) - 2);
        dunnage.push({
          type: 'dunnage',
          kind: 'beam',
          axis: 'x',
          side: 'max',
          x: p.x + p.l,
          y: p.y,
          z: 0,
          l: beamL,
          w: p.w,
          h: 100,
          product: p.name,
          nails,
          force,
          location: `${esc(p.name)} 뒤(안쪽) 바닥 각재 · 못 ${nails}개 · 필요 억제력 ${force.toFixed(1)}kN(무거운 화물 가운데 적재)`
        });
        if (c.l - (p.x + p.l) - beamL < 160) return;
        const count = Math.max(2, Math.min(4, Math.round(p.w / 450))),
          chockL = Math.min(180, c.l - (p.x + p.l) - beamL - 10);
        for (let i = 0; i < count; i++) {
          const w = Math.min(150, (p.w / count) * 0.55),
            center = p.y + (p.w * (i + 0.5)) / count;
          dunnage.push({
            type: 'dunnage',
            kind: 'chock',
            axis: 'x',
            side: 'max',
            x: p.x + p.l + beamL + 2,
            y: Math.max(0, Math.min(c.w - w, center - w / 2)),
            z: 0,
            l: chockL,
            w,
            h: 125,
            product: p.name,
            location: `${esc(p.name)} 안쪽 각재 지지 쐐기 ${i + 1}/${count} · 바닥 못 고정`
          });
        }
      });
    else if (innerExposed.length)
      reviews.push({
        product: '안쪽 끝 고정',
        severity: 'review',
        location: `무거운 화물을 가운데 적재 · 안쪽 벽과 떨어진 화물 ${innerExposed.length}개 · 바닥 못을 쓰지 않으면 각재 버팀(쇼어링)으로 막기`,
        axes: '',
        count: innerExposed.length
      });
  }
  {
    const candidates = [],
      opposed = [];
    load.placed.forEach(p => {
      const left = p.y,
        right = c.w - (p.y + p.w),
        length = Math.min(700, p.l * 0.6),
        x = p.x + (p.l - length) / 2,
        height = Math.min(1200, p.h * 0.72),
        z = p.z + Math.max(20, p.h * 0.14),
        level = p.z > 0 ? `${Math.round((p.z / 1000) * 10) / 10}m 높이` : '',
        addWall = (zone, gap, make) => {
          if (gap < AIRBAG_MIN_GAP) return;
          const bag = Math.min(gap, AIRBAG_MAX_GAP),
            filler = Math.round(gap - bag);
          candidates.push({
            ...make(bag),
            type: 'airbag',
            zone,
            z,
            h: height,
            bag: airbagSize(bag),
            filler,
            p,
            gap,
            location:
              `${zone === 'left' ? '좌측' : '우측'} 벽 간극 ${Math.round(gap)}mm${filler > 0 ? ` · 충전재 ${filler}mm + 에어백` : ''} ${level}`.trim(),
            product: p.name
          });
        };
      const clear = side =>
        !load.placed.some(
          q =>
            q !== p &&
            Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x) > 1 &&
            Math.min(p.z + p.h, q.z + q.h) - Math.max(p.z, q.z) > 1 &&
            (side === 'left' ? q.y + q.w <= p.y + 1 : q.y >= p.y + p.w - 1)
        );
      const inRange = g => g >= AIRBAG_MIN_GAP && g <= AIRBAG_MAX_GAP;
      if (clear('left') && clear('right') && inRange(left) && inRange(right)) {
        const sl = Math.min(p.l, Math.max(length, p.l * 0.8)),
          spacer = {
            type: 'dunnage',
            kind: 'spacer',
            axis: 'y',
            side: 'min',
            x: p.x + (p.l - sl) / 2,
            y: 0,
            z,
            l: sl,
            w: Math.round(left),
            h: height,
            product: p.name,
            location:
              `${esc(p.name)} 좌측 벽 목재 스페이서 ${Math.round(left)}mm · 반대쪽 에어백과 맞버팀 ${level}`.trim()
          };
        opposed.push(spacer);
        addWall('right', right, bag => ({ x, y: p.y + p.w, l: length, w: bag }));
        return;
      }
      addWall('left', left, bag => ({ x, y: p.y - bag, l: length, w: bag }));
      addWall('right', right, bag => ({
        x,
        y: p.y + p.w,
        l: length,
        w: bag
      })); /* 실무상 컨테이너 끝(안쪽 벽·문)에는 에어백을 두지 않는다. 화물은 안쪽 벽에 밀착하고 문 쪽은 각재·부목으로 막는다. */
    });
    // 같은 벽 쪽에서 틈이 비슷하고(±30mm) 길이 방향으로 붙어 있는(50mm 이내) 화물 줄은 이음매마다 에어백 하나를 걸쳐 두 화물을 함께 누른다.
    // 화물마다 하나씩 넣던 것보다 개수가 약 절반이고, 모든 화물이 에어백에 닿는다(사용자 결정 2026-09-27: 개수보다 고정과 벽 밀착이 중요).
    for (const zone of ['left', 'right']) {
      const wallBags = candidates
          .filter(q => q.type === 'airbag' && q.zone === zone && q.p)
          .sort((a, b) => a.p.z - b.p.z || a.x - b.x),
        keep = new Set(),
        runs = [];
      for (const q of wallBags) {
        const last = runs[runs.length - 1],
          prev = last && last[last.length - 1];
        if (
          prev &&
          prev.p.z === q.p.z &&
          Math.abs(prev.gap - q.gap) <= 30 &&
          q.p.x - (prev.p.x + prev.p.l) <= 50 &&
          q.p.x >= prev.p.x
        )
          last.push(q);
        else runs.push([q]);
      }
      for (const run of runs) {
        for (let i = 0; i < run.length; i += 2) {
          const a = run[i],
            b = run[i + 1];
          if (!b) {
            keep.add(a);
            continue;
          }
          const joint = a.p.x + a.p.l,
            length = Math.min(1200, Math.min(a.p.l, b.p.l) * 1.2),
            y = zone === 'left' ? Math.max(a.y, b.y) : Math.min(a.y, b.y),
            w = Math.min(a.w, b.w);
          keep.add({
            ...a,
            x: Math.max(a.p.x, joint - length / 2),
            l: Math.min(length, b.p.x + b.p.l - Math.max(a.p.x, joint - length / 2)),
            y,
            w,
            filler: Math.max(a.filler, b.filler),
            product: a.product === b.product ? a.product : `${a.product} / ${b.product}`,
            location: `${a.location} · 두 화물 이음매`
          });
        }
      }
      for (let i = candidates.length - 1; i >= 0; i--)
        if (candidates[i].zone === zone && candidates[i].p) candidates.splice(i, 1);
      candidates.push(...keep);
    }
    for (const q of candidates) {
      delete q.p;
      delete q.gap;
    }
    const sorted = [...load.placed].sort((a, b) => a.x - b.x);
    sorted.forEach((p, i) => {
      let nearest = null;
      for (let j = i + 1; j < sorted.length; j++) {
        const q = sorted[j],
          gap = q.x - (p.x + p.l),
          overlap = Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y),
          vertical = Math.min(p.z + p.h, q.z + q.h) - Math.max(p.z, q.z);
        if (gap > 0 && overlap > 150 && vertical > 150 && (!nearest || gap < nearest.gap))
          nearest = { q, gap, overlap, vertical };
      }
      if (nearest && nearest.gap >= 120 && nearest.gap <= AIRBAG_MAX_GAP) {
        const baseZ = Math.max(p.z, nearest.q.z),
          z = baseZ + Math.max(20, nearest.vertical * 0.14);
        candidates.push({
          type: 'airbag',
          zone: 'cargo',
          bag: airbagSize(nearest.gap),
          x: p.x + p.l,
          y: Math.max(p.y, nearest.q.y),
          z,
          l: nearest.gap,
          w: nearest.overlap,
          h: Math.min(1200, nearest.vertical * 0.72),
          location: `화물 사이 간극${baseZ > 0 ? ` · ${(baseZ / 1000).toFixed(1)}m 높이` : ''}`,
          product: `${p.name} / ${nearest.q.name}`
        });
      }
    });
    const byY = [...load.placed].sort((a, b) => a.y - b.y);
    byY.forEach((p, i) => {
      let nearest = null;
      for (let j = i + 1; j < byY.length; j++) {
        const q = byY[j],
          gap = q.y - (p.y + p.w),
          overlap = Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x),
          vertical = Math.min(p.z + p.h, q.z + q.h) - Math.max(p.z, q.z);
        if (gap > 0 && overlap > 180 && vertical > 150 && (!nearest || gap < nearest.gap))
          nearest = { q, gap, overlap, vertical };
      }
      if (nearest && nearest.gap >= 120 && nearest.gap <= AIRBAG_MAX_GAP) {
        const baseZ = Math.max(p.z, nearest.q.z),
          z = baseZ + Math.max(20, nearest.vertical * 0.12);
        candidates.push({
          type: 'airbag',
          zone: 'center',
          bag: airbagSize(nearest.gap),
          x: Math.max(p.x, nearest.q.x),
          y: p.y + p.w,
          z,
          l: nearest.overlap,
          w: nearest.gap,
          h: Math.min(1400, nearest.vertical * 0.76),
          location: `화물 열 사이 중앙 간극${baseZ > 0 ? ` · ${(baseZ / 1000).toFixed(1)}m 높이` : ''}`,
          product: `${p.name} / ${nearest.q.name}`
        });
      }
    });
    const intersectsAny = (a, b) =>
      Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y) > 1 &&
      Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > 1;
    for (const sp of opposed) if (!dunnage.some(d => intersectsAny(d, sp))) dunnage.push(sp);
    const free = q =>
      !load.placed.some(
        p =>
          q.x < p.x + p.l && q.x + q.l > p.x && q.y < p.y + p.w && q.y + q.w > p.y && q.z < p.z + p.h && q.z + q.h > p.z
      );
    const overlapRatio = (a0, a1, b0, b1) =>
      Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(1, Math.min(a1 - a0, b1 - b0));
    const grounded = candidates
      .filter(q => q.z + q.h > AIRBAG_FLOOR_CLEARANCE * 3)
      .map(q => ({
        ...q,
        h: q.z + q.h - AIRBAG_FLOOR_CLEARANCE,
        z: AIRBAG_FLOOR_CLEARANCE,
        location: `${q.location.replace(/\s*·?\s*\d+(?:\.\d+)?m 높이/g, '')} · 바닥에서 ${AIRBAG_FLOOR_CLEARANCE}mm 띄워 설치`
      }));
    // 에어백은 다른 에어백·부목·화물과 조금도 겹치지 않아야 한다(1mm 초과 겹침이면 큰 쪽을 남긴다).
    const intersects = (a, b) =>
      Math.min(a.x + a.l, b.x + b.l) - Math.max(a.x, b.x) > 1 &&
      Math.min(a.y + a.w, b.y + b.w) - Math.max(a.y, b.y) > 1 &&
      Math.min(a.z + a.h, b.z + b.h) - Math.max(a.z, b.z) > 1;
    grounded
      .filter(free)
      .sort((a, b) => b.l * b.w * b.h - a.l * a.w * a.h)
      .forEach(q => {
        if (!airbags.some(a => intersects(a, q)) && !dunnage.some(d => intersects(d, q))) airbags.push(q);
      });
    const zoneName = {
      left: '좌측 벽 간극',
      right: '우측 벽 간극',
      back: '안쪽 벽 간극',
      door: '문쪽 간극',
      center: '화물 열 사이 중앙 간극'
    };
    let combined = true;
    while (combined) {
      combined = false;
      outer: for (let i = 0; i < airbags.length; i++)
        for (let j = i + 1; j < airbags.length; j++) {
          const a = airbags[i],
            b = airbags[j];
          if (!a.zone || a.zone === 'cargo' || a.zone !== b.zone) continue;
          const horizontal =
              overlapRatio(a.x, a.x + a.l, b.x, b.x + b.l) > 0.55 &&
              overlapRatio(a.y, a.y + a.w, b.y, b.y + b.w) > 0.55,
            verticalGap = Math.max(0, Math.max(a.z, b.z) - Math.min(a.z + a.h, b.z + b.h));
          if (!horizontal || verticalGap > 350) continue;
          const x = Math.max(a.x, b.x),
            y = Math.max(a.y, b.y),
            z = Math.min(a.z, b.z),
            l = Math.min(a.x + a.l, b.x + b.l) - x,
            w = Math.min(a.y + a.w, b.y + b.w) - y,
            h = Math.max(a.z + a.h, b.z + b.h) - z,
            merged = {
              type: 'airbag',
              zone: a.zone,
              x,
              y,
              z,
              l,
              w,
              h,
              location: `${zoneName[a.zone]} · 대형 수직 통합`,
              product: `${a.product} / ${b.product}`,
              combined: (a.combined || 1) + (b.combined || 1)
            };
          if (
            l > 100 &&
            w > 100 &&
            h <= c.h - z &&
            free(merged) &&
            !airbags.some((o, k) => k !== i && k !== j && intersects(o, merged)) &&
            !dunnage.some(d => intersects(d, merged))
          ) {
            airbags.splice(j, 1);
            airbags.splice(i, 1, merged);
            combined = true;
            break outer;
          }
        }
    }
    airbags.sort((a, b) => (b.combined || 1) - (a.combined || 1) || b.z - a.z);
    if (airbags.length > AIRBAG_LIMIT) airbags.splice(AIRBAG_LIMIT);
    // 벽 간극이 에어백 한계를 넘으면 백과 벽 사이를 충전재로 채운다(화물·에어백·다른 고정재와 겹치지 않을 때만 표시).
    airbags
      .filter(a => a.filler > 0 && (a.zone === 'left' || a.zone === 'right'))
      .forEach(a => {
        const f = {
          type: 'dunnage',
          kind: 'filler',
          axis: 'y',
          side: a.zone === 'left' ? 'min' : 'max',
          x: a.x,
          y: a.zone === 'left' ? a.y - a.filler : a.y + a.w,
          z: a.z,
          l: a.l,
          w: a.filler,
          h: a.h,
          product: a.product,
          location: `${a.zone === 'left' ? '좌측' : '우측'} 벽 충전재 ${a.filler}mm(세운 빈 팔레트·골판지)`
        };
        if (
          f.y >= 0 &&
          f.y + f.w <= c.w + 1 &&
          free(f) &&
          !airbags.some(o => intersects(o, f)) &&
          !dunnage.some(d => intersects(d, f))
        )
          dunnage.push(f);
      });
  }
  fillRemainingVoids(load, airbags, dunnage, options);
  // 바닥 선하중(길이 1m당 화물 중량): 20ft 4.5t/m, 40ft·45ft 3.0t/m(TIS-GDV 컨테이너 적재 지침, CTU Code는 운영사 협의로 둠).
  // 넘으면 화물 밑에 길이 방향 받침목(20ft 폭 0.10m·40ft 0.15m 이상)을 깔아 하중을 나누도록 검토 항목으로 알린다.
  {
    const limit = c.l <= 7000 ? 4500 : 3000;
    let worst = 0,
      at = 0;
    for (let x0 = 0; x0 + 1000 <= c.l; x0 += 100) {
      const kg = load.placed.reduce(
        (sum, p) => sum + (p.weight * Math.max(0, Math.min(x0 + 1000, p.x + p.l) - Math.max(x0, p.x))) / p.l,
        0
      );
      if (kg > worst) {
        worst = kg;
        at = x0;
      }
    }
    if (worst > limit)
      reviews.push({
        product: '바닥 선하중',
        severity: 'review',
        location: `문에서 ${(at / 1000).toFixed(1)}~${((at + 1000) / 1000).toFixed(1)}m 구간 ${(worst / 1000).toFixed(1)}t/m · 한계 ${(limit / 1000).toFixed(1)}t/m 초과 → 화물 밑 길이 방향 받침목(폭 ${c.l <= 7000 ? '0.10' : '0.15'}m 이상)으로 하중 분산`,
        axes: '',
        count: 1
      });
  }
  reviews.push(...LoadwiseEngine.transportReviews(load, transportMode));
  // 문쪽 줄에 윗단 화물이 있으면 문을 열 때 떨어지지 않게 상단을 도어 스트랩(웹 래싱)으로 측면·바닥 고정점에 묶는다.
  // 에어백은 문쪽에 쓰지 않는다(CTU Code 부속서 7 §2.3.8). 문은 충격하중이 없을 때만 경계로 본다(§4.2.5).
  if (floorItems.length) {
    const front = Math.min(...load.placed.map(p => p.x)),
      upper = load.placed.filter(p => p.z > 0 && p.x <= front + 300);
    if (upper.length) {
      const top = Math.max(...upper.map(p => p.z + p.h)),
        z = Math.max(...upper.map(p => p.z)) + (Math.min(...upper.map(p => p.h)) * 2) / 3,
        straps = lashingCount(
          upper.reduce((sum, p) => sum + p.weight, 0),
          'long'
        ),
        strap = {
          type: 'dunnage',
          kind: 'strap',
          axis: 'y',
          side: 'min',
          x: Math.max(0, front - 22),
          y: 0,
          z: Math.min(top - 60, z),
          l: 18,
          w: c.w,
          h: 50,
          straps,
          product: '문쪽 윗단 화물',
          location: `문쪽 윗단 되잡기 래싱(도어 스트랩) · 높이 ${(z / 1000).toFixed(1)}m · 웨빙(MSL 2t) ${straps}줄 · 측벽 고정점`
        };
      if (
        !airbags.some(
          a =>
            Math.min(a.x + a.l, strap.x + strap.l) - Math.max(a.x, strap.x) > 1 &&
            Math.min(a.z + a.h, strap.z + strap.h) - Math.max(a.z, strap.z) > 1
        )
      )
        dunnage.push(strap);
    }
  }
  // 에어백을 쓰지 않으면 같은 자리를 충전재로, 충전재를 쓰지 않으면 충전재·스페이서를 빼고, 래싱을 쓰지 않으면 스트랩·래싱을 뺀다. 못 채운 곳은 검토 항목으로 남긴다.
  if (!options.airbag) {
    if (options.filler)
      dunnage.push(
        ...airbags.map(a => ({
          ...a,
          type: 'dunnage',
          kind: 'filler',
          location: `${a.location} · 충전재(에어백 대신)`
        }))
      );
    else if (airbags.length)
      reviews.push({
        product: '고정재 선택',
        severity: 'review',
        location: `에어백·충전재 미사용 · 채우지 못한 간극 ${airbags.length}곳`,
        axes: '',
        count: airbags.length
      });
    airbags.length = 0;
  }
  if (!options.filler) {
    const skipped = dunnage.filter(d => d.kind === 'filler' || d.kind === 'spacer');
    if (skipped.length)
      reviews.push({
        product: '고정재 선택',
        severity: 'review',
        location: `충전재·스페이서 미사용 · 채우지 못한 틈 ${skipped.length}곳`,
        axes: '',
        count: skipped.length
      });
    for (let i = dunnage.length - 1; i >= 0; i--)
      if (dunnage[i].kind === 'filler' || dunnage[i].kind === 'spacer') dunnage.splice(i, 1);
  }
  if (!options.lashing) {
    const skipped = dunnage.filter(d => d.kind === 'lashing' || d.kind === 'strap');
    if (skipped.length)
      reviews.push({
        product: '고정재 선택',
        severity: 'rearrange',
        location: `래싱 미사용 · 상단·문쪽 고정이 필요한 곳 ${skipped.length}곳(재배치 검토)`,
        axes: '',
        count: skipped.length
      });
    for (let i = dunnage.length - 1; i >= 0; i--)
      if (dunnage[i].kind === 'lashing' || dunnage[i].kind === 'strap') dunnage.splice(i, 1);
  }
  // CTU 기준: 화물로 막히지 않은 옆면을 화물별로 적고, 켜 둔 고정재 중 맞는 것으로 막게 한다(래싱 → 에어백·충전재 순).
  if (safety === 'secure') {
    const method = options.lashing
      ? '래싱으로 묶기'
      : options.airbag
        ? '에어백·충전재로 막기'
        : options.filler
          ? '충전재로 막기'
          : '';
    const innerBeamed = p =>
      options.nails &&
      p.z === 0 &&
      load.container.l - (p.x + p.l) > DOOR_FREE_GAP &&
      !load.placed.some(
        q => q !== p && q.x >= p.x + p.l - 2 && Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y) > 40
      );
    if (method)
      for (const v of LoadwiseValidator.openFaces(load, options)
        .map(v => ({ ...v, faces: v.faces.filter(f => f !== '안쪽' || !innerBeamed(v.item)) }))
        .filter(v => v.faces.length))
        reviews.push({
          product: v.item.name,
          severity: 'review',
          location: `${v.item.order || v.index + 1}번 · ${v.faces.join('·')} 면이 화물로 막히지 않음 → ${method}`,
          axes: '',
          count: 1,
          ctuFace: true
        });
  }
  // 고정점 표시를 확인하지 않았고 래싱이 고정점보다 강하면, 줄 수를 고정점 기준으로 늘렸다고 알린다(운송 안정성 검토가 아닌 계산 기준 안내).
  const notes = [];
  if (
    options.lashing &&
    options.anchors !== 'rated' &&
    dunnage.some(d => d.kind === 'lashing' || (d.kind === 'note' && d.straps)) &&
    lashingMslOf(options) > ANCHOR_MSL_UPPER
  )
    notes.push({
      product: '래싱 고정점',
      text: `고정점 표시를 확인하지 않아 ISO 1496-1 최소값(바닥 ${ANCHOR_MSL_FLOOR.toLocaleString()}daN·위쪽 고리 ${ANCHOR_MSL_UPPER}daN)으로 래싱 줄 수를 계산했습니다. 고정점 MSL이 래싱(${lashingMslOf(options).toLocaleString()}daN) 이상이면 고정 조건에서 '표시 확인'을 고르세요`
    });
  return {
    dunnage,
    airbags,
    reviews,
    notes,
    transportMode,
    options: { ...options },
    conditions: {
      friction: frictionOf(options),
      frictionLabel: (FRICTION_CHOICES[options.friction] || FRICTION_CHOICES.unknown).label,
      lashingMsl: lashingMslOf(options),
      anchors: options.anchors === 'rated' ? 'rated' : 'iso'
    },
    ctu: LoadwiseInsights.securing(load, { mode: transportMode, friction: frictionOf(options) })
  };
}
