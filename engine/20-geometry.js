// 기하 검사: 충돌·받침·상부하중·적층 안정·막힘·간극(적재 좌표: x=0 안쪽 벽).
  // ---------- 기하 검사 (적재 좌표: x=0 안쪽 벽, x=c.l 문) ----------

  function collides(x, y, z, l, w, h, placed) {
    for (const p of placed)
      if (x < p.x + p.l && x + l > p.x && y < p.y + p.w && y + w > p.y && z < p.z + p.h && z + h > p.z) return true;
    return false;
  }

  // 후보 위치를 아래 → 안쪽 → 좌측으로 밀어 다른 화물이나 벽에 닿게 한다.
  function compact(x, y, z, l, w, h, placed) {
    for (let pass = 0; pass < 6; pass++) {
      let moved = false,
        nz = 0,
        nx = 0,
        ny = 0;
      for (const p of placed) {
        const top = p.z + p.h;
        if (top <= z && top > nz && x < p.x + p.l && x + l > p.x && y < p.y + p.w && y + w > p.y) nz = top;
      }
      if (nz !== z) {
        z = nz;
        moved = true;
      }
      for (const p of placed) {
        const end = p.x + p.l;
        if (end <= x && end > nx && y < p.y + p.w && y + w > p.y && z < p.z + p.h && z + h > p.z) nx = end;
      }
      if (nx !== x) {
        x = nx;
        moved = true;
      }
      for (const p of placed) {
        const end = p.y + p.w;
        if (end <= y && end > ny && x < p.x + p.l && x + l > p.x && z < p.z + p.h && z + h > p.z) ny = end;
      }
      if (ny !== y) {
        y = ny;
        moved = true;
      }
      if (!moved) break;
    }
    return { x, y, z };
  }

  function supportInfo(item, x, y, z, l, w, placed) {
    if (z === 0) return { ratio: 1, count: 0, center: true, fragile: false, blocked: false };
    const cx = x + l / 2,
      cy = y + w / 2;
    let area = 0,
      count = 0,
      center = false,
      fragile = false,
      blocked = false,
      onBox = false;
    for (const p of placed) {
      if (Math.abs(p.z + p.h - z) >= TOL) continue;
      const x0 = Math.max(x, p.x),
        x1 = Math.min(x + l, p.x + p.l),
        y0 = Math.max(y, p.y),
        y1 = Math.min(y + w, p.y + p.w);
      if (x1 - x0 <= TOL || y1 - y0 <= TOL) continue;
      if (p.shape === 'cylinder') {
        // 원통 위에는 같은 규격의 원통만 중심을 맞춰 올린다.
        const offset = Math.hypot(p.x + p.l / 2 - cx, p.y + p.w / 2 - cy),
          diameterDiff = Math.abs(p.l - l) + Math.abs(p.w - w);
        if (item.shape !== 'cylinder' || offset > 15 || diameterDiff > 30) {
          blocked = true;
          continue;
        }
      }
      if (item.shape === 'cylinder' && p.shape !== 'cylinder') onBox = true;
      count++;
      area += (x1 - x0) * (y1 - y0);
      if (p.fragile) fragile = true;
      if (cx >= x0 - TOL && cx <= x1 + TOL && cy >= y0 - TOL && cy <= y1 + TOL) center = true;
    }
    return { ratio: Math.min(1, area / Math.max(1, l * w)), count, center, fragile, blocked, onBox };
  }

  // packing=true: 적재 좌표(안쪽 벽 x=0), false: 화면 좌표(문 x=0)
  // 맞닿은 화물들이 덮는 높이 구간의 합집합 길이.
  function coveredHeight(spans, z0, z1) {
    spans.sort((a, b) => a[0] - b[0]);
    let sum = 0,
      end = z0;
    for (const [a, b] of spans) {
      const from = Math.max(a, end),
        to = Math.min(b, z1);
      if (to > from) {
        sum += to - from;
        end = to;
      }
    }
    return sum;
  }
  // 바닥 격자 색인. 목록(배열)마다 한 번 만들고 뒤에 추가된 화물만 덧붙인다(적재 중 목록은 뒤에만 늘어난다).
  // 이웃 검사는 질의 사각형과 겹치는 칸의 화물만 본다. 화물이 적으면 목록을 그대로 쓴다.
  const GRID_CELL = 400,
    gridCache = new WeakMap();
  function gridOf(list) {
    let g = gridCache.get(list);
    if (!g || g.count > list.length) {
      g = { cells: new Map(), count: 0 };
      gridCache.set(list, g);
    }
    for (; g.count < list.length; g.count++) {
      const p = list[g.count];
      for (let ix = Math.floor(p.x / GRID_CELL), ex = Math.floor((p.x + p.l) / GRID_CELL); ix <= ex; ix++)
        for (let iy = Math.floor(p.y / GRID_CELL), ey = Math.floor((p.y + p.w) / GRID_CELL); iy <= ey; iy++) {
          const k = ix * 4096 + iy;
          let cell = g.cells.get(k);
          if (!cell) g.cells.set(k, (cell = []));
          cell.push(p);
        }
    }
    return g;
  }
  // 사각형 여러 개([x0,x1,y0,y1])와 겹칠 수 있는 화물(중복 없음).
  function nearby(list, rects) {
    if (list.length < 32) return list;
    const g = gridOf(list),
      seen = new Set(),
      out = [];
    for (const [x0, x1, y0, y1] of rects)
      for (let ix = Math.floor(x0 / GRID_CELL), ex = Math.floor(x1 / GRID_CELL); ix <= ex; ix++)
        for (let iy = Math.floor(y0 / GRID_CELL), ey = Math.floor(y1 / GRID_CELL); iy <= ey; iy++) {
          const cell = g.cells.get(ix * 4096 + iy);
          if (cell)
            for (const p of cell)
              if (!seen.has(p)) {
                seen.add(p);
                out.push(p);
              }
        }
    return out;
  }
  function lateralSupportDirections(s, d, placed, c, packing = false, self = null) {
    const [l, w, h] = d,
      x0 = s.x,
      x1 = s.x + l,
      y0 = s.y,
      y1 = s.y + w,
      z0 = s.z,
      z1 = s.z + h,
      need = h * 0.5;
    let low = false,
      high = false,
      left = y0 <= TOL,
      right = y1 >= c.w - TOL,
      lowSpans = null,
      highSpans = null,
      leftSpans = null,
      rightSpans = null;
    for (const p of nearby(placed, [[x0 - TOL - 1, x1 + TOL + 1, y0 - TOL - 1, y1 + TOL + 1]])) {
      if (p === self) continue;
      if (low && high && left && right) break;
      // 면 폭의 절반 이상 맞닿은 화물이 면 높이의 절반 이상을 덮으면 그 방향은 지지된다.
      // 한 화물로 덮지 못해도 같은 면에 맞닿은 화물들(예: 박스를 쌓은 기둥)의 높이 구간을 합쳐 판단한다.
      const from = Math.max(z0, p.z),
        to = Math.min(z1, p.z + p.h);
      if (to - from <= TOL) continue;
      const full = to - from >= need,
        px1 = p.x + p.l,
        py1 = p.y + p.w;
      if ((!low && Math.abs(px1 - x0) <= TOL) || (!high && Math.abs(x1 - p.x) <= TOL)) {
        if (Math.min(y1, py1) - Math.max(y0, p.y) >= w * 0.5) {
          if (Math.abs(px1 - x0) <= TOL) {
            if (full) low = true;
            else (lowSpans || (lowSpans = [])).push([from, to]);
          } else {
            if (full) high = true;
            else (highSpans || (highSpans = [])).push([from, to]);
          }
        }
      }
      if ((!left && Math.abs(py1 - y0) <= TOL) || (!right && Math.abs(y1 - p.y) <= TOL)) {
        if (Math.min(x1, px1) - Math.max(x0, p.x) >= l * 0.5) {
          if (Math.abs(py1 - y0) <= TOL) {
            if (full) left = true;
            else (leftSpans || (leftSpans = [])).push([from, to]);
          } else {
            if (full) right = true;
            else (rightSpans || (rightSpans = [])).push([from, to]);
          }
        }
      }
    }
    if (!low && lowSpans) low = coveredHeight(lowSpans, z0, z1) >= need;
    if (!high && highSpans) high = coveredHeight(highSpans, z0, z1) >= need;
    if (!left && leftSpans) left = coveredHeight(leftSpans, z0, z1) >= need;
    if (!right && rightSpans) right = coveredHeight(rightSpans, z0, z1) >= need;
    return packing
      ? { front: high, back: s.x <= TOL || low, left, right }
      : { front: low, back: s.x + l >= c.l - TOL || high, left, right };
  }
  // 직사각형들이 [a0,a1]×[b0,b1] 영역을 덮는 넓이(합집합).
  function coveredArea(rects, a0, a1, b0, b1) {
    const clipped = rects
      .map(([p0, p1, q0, q1]) => [Math.max(a0, p0), Math.min(a1, p1), Math.max(b0, q0), Math.min(b1, q1)])
      .filter(([p0, p1, q0, q1]) => p1 > p0 && q1 > q0);
    if (!clipped.length) return 0;
    const cuts = [...new Set(clipped.flatMap(r => [r[0], r[1]]))].sort((a, b) => a - b);
    let area = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const m = (cuts[i] + cuts[i + 1]) / 2,
        spans = clipped
          .filter(r => r[0] <= m && r[1] >= m)
          .map(r => [r[2], r[3]])
          .sort((a, b) => a[0] - b[0]);
      let len = 0,
        end = -Infinity;
      for (const [q0, q1] of spans) {
        const from = Math.max(q0, end);
        if (q1 > from) {
          len += q1 - from;
          end = q1;
        }
      }
      area += len * (cuts[i + 1] - cuts[i]);
    }
    return area;
  }
  // 이웃 화물까지 이 간극 이하면 채워서 막을 수 있다(에어백 제조사 최대 간극 500mm, CTU §2.3.8). 에어백·충전재를 모두 쓰지 않으면 직접 닿아야 한다.
  let BLOCK_GAP = 500,
    FLOOR_FILL = true;
  // packing=true: 적재 좌표(안쪽 벽 x=0), false: 화면 좌표(안쪽 벽 x=l). 안쪽·좌·우 면이 각각 막혔는지 돌려준다.
  // 벽까지 비어 있으면 바닥 화물은 충전재(세운 팔레트·골판지)와 에어백으로, 높은 곳 화물은 에어백 한계(600mm) 안에서만 막을 수 있다.
  // innerOpenOk: 무거운 화물을 가운데로 옮긴 적재(shifted)의 최종 검사에서, 뒤(안쪽 벽 쪽)에 아무 화물도 없는 바닥 화물은 문쪽처럼 못 박은 각재·쐐기로 막는다고 본다.
  function blockedSides(s, d, placed, c, packing, self = null, innerOpenOk = false) {
    const [l, w, h] = d,
      x0 = s.x,
      x1 = s.x + l,
      y0 = s.y,
      y1 = s.y + w,
      z0 = s.z,
      z1 = s.z + h;
    const back = [],
      front = [],
      left = [],
      right = [];
    let leftClear = true,
      rightClear = true,
      doorClear = true,
      innerClear = true;
    // 좌우는 벽까지의 통로, 앞뒤는 문까지의 통로와 안쪽 간극 범위만 보면 된다.
    const rects = [
      [x0 - 1, x1 + 1, 0, c.w],
      packing ? [x0 - BLOCK_GAP - TOL, c.l, y0 - 1, y1 + 1] : [0, x1 + BLOCK_GAP + TOL, y0 - 1, y1 + 1]
    ];
    for (const p of nearby(placed, rects)) {
      if (p === self) continue;
      const pz0 = p.z,
        pz1 = p.z + p.h;
      if (doorClear && p.y + p.w > y0 + TOL && p.y < y1 - TOL && (packing ? p.x >= x1 - TOL : p.x + p.l <= x0 + TOL))
        doorClear = false;
      if (innerClear && p.y + p.w > y0 + TOL && p.y < y1 - TOL && (packing ? p.x + p.l <= x0 + TOL : p.x >= x1 - TOL))
        innerClear = false;
      if (pz1 <= z0 + TOL || pz0 >= z1 - TOL) continue;
      const px0 = p.x,
        px1 = p.x + p.l,
        py0 = p.y,
        py1 = p.y + p.w;
      // 안쪽 방향 간극
      const gapBack = packing ? x0 - px1 : px0 - x1;
      if (gapBack >= -TOL && gapBack <= BLOCK_GAP && py1 > y0 && py0 < y1) back.push([py0, py1, pz0, pz1]);
      const gapFront = packing ? px0 - x1 : x0 - px1;
      if (gapFront >= -TOL && py1 > y0 && py0 < y1) {
        if (gapFront <= BLOCK_GAP) front.push([py0, py1, pz0, pz1]);
      }
      if (px1 > x0 + TOL && px0 < x1 - TOL) {
        const gapLeft = y0 - py1,
          gapRight = py0 - y1;
        if (gapLeft >= -TOL) {
          leftClear = false;
          if (gapLeft <= BLOCK_GAP) left.push([px0, px1, pz0, pz1]);
        }
        if (gapRight >= -TOL) {
          rightClear = false;
          if (gapRight <= BLOCK_GAP) right.push([px0, px1, pz0, pz1]);
        }
      }
    }
    const half = (rects, a0, a1) => coveredArea(rects, a0, a1, z0, z1) >= (a1 - a0) * (z1 - z0) * 0.5 - 1;
    const innerWall = packing ? x0 <= TOL : x1 >= c.l - TOL;
    const wallOk = gap => (z0 <= TOL && FLOOR_FILL) || gap <= BLOCK_GAP;
    return {
      front: doorClear || half(front, y0, y1),
      back: innerWall || (innerOpenOk && innerClear && z0 <= TOL) || half(back, y0, y1),
      left: y0 <= TOL || (leftClear && wallOk(y0)) || half(left, x0, x1),
      right: y1 >= c.w - TOL || (rightClear && wallOk(c.w - y1)) || half(right, x0, x1)
    };
  }
  // 최고 안전 기준에서만 켠다.
  let STRICT_BLOCK = false;
  // 얹힘: 받치는 화물 중에 바닥면 크기가 다른 화물이 있는 쌓인 화물. 같은 규격 기둥의 윗단은 얹힘이 아니다.
  let PERCH_PREFER = false;
  // CTU 기준의 고정재 보강안: 화물끼리 막힘은 요구하지 않지만 얹힘(문쪽이 열린 채 다른 규격 위에 올린 화물)은 금지한다.
  let PERCH_HARD = false;
  // 적재량 우선: 넘어질 수 있는 높은 탑(쌓인 화물 높이 ÷ 폭 > 3) 자리를 금지하지 않고 뒤로 미룬다(최대한 싣되 최대한 덜 위험하게, 사용자 결정 2026-09-27).
  let TOWER_PREFER = false;
  function perchOk(s, d, placed, c, packing, self = null) {
    if (s.z <= 0) return true;
    const [l, w] = d;
    let perched = false;
    for (const q of nearby(placed, [[s.x, s.x + l, s.y, s.y + w]])) {
      if (
        q === self ||
        Math.abs(q.z + q.h - s.z) > TOL ||
        Math.min(s.x + l, q.x + q.l) - Math.max(s.x, q.x) <= TOL ||
        Math.min(s.y + w, q.y + q.w) - Math.max(s.y, q.y) <= TOL
      )
        continue;
      if (Math.abs(q.l - l) > TOL || Math.abs(q.w - w) > TOL) {
        perched = true;
        break;
      }
    }
    return !perched || blockedSides(s, d, placed, c, packing, self).front;
  }
  // 전도 방지: 화물(바닥부터 높이 H, 그 방향 폭 B)의 H/B가 한계를 넘는 방향은 막혀 있어야 한다.
  // 엄격·CTU 안전(래싱 사용): 쌓인 화물에 한계 3(Cubestow 설정, 전도 위험 방향은 래싱으로 고정).
  // CTU 안전(래싱 끔): CTU 정보자료 5 가속도의 v/c를 운송모드별로(복합은 도로·해상 C 중 불리한 값) 모든 화물에 적용한다.
  const TIP_ACC = {
    road: { side: [0.5, 1], forward: [0.8, 1], backward: [0.5, 1] },
    seaC: { side: [0.8, 1], forward: [0.4, 0.2], backward: [0.4, 0.2] }
  };
  let TOWER_CHECK = false,
    TIP = { side: 3, forward: 3, backward: 3 },
    TIP_STACKED_ONLY = true;
  function tipLimits(mode) {
    const profiles = mode === 'road' ? ['road'] : mode === 'sea' ? ['seaC'] : ['road', 'seaC'],
      lim = k => Math.min(...profiles.map(p => TIP_ACC[p][k][1] / TIP_ACC[p][k][0]));
    return { side: lim('side'), forward: lim('forward'), backward: lim('backward') };
  }
  // 적재 좌표에서 back=안쪽 벽 쪽(전방 가속도), front=문쪽(후방 가속도).
  function towerOk(s, d, placed, c, packing, self = null) {
    const [l, w, h] = d;
    if (TIP_STACKED_ONLY && s.z <= 0) return true;
    const H = s.z + h,
      rx = H / Math.max(1, l),
      ry = H / Math.max(1, w),
      needBack = rx > TIP.forward,
      needFront = rx > TIP.backward,
      needSide = ry > TIP.side;
    if (!needBack && !needFront && !needSide) return true;
    const b = blockedSides(s, d, placed, c, packing, self);
    return (!needBack || b.back) && (!needFront || b.front) && (!needSide || (b.left && b.right));
  }
  const blockedOk = b => b.back && b.left && b.right;
  // 규칙 스위치(전역)를 잠시 바꿔 계산하고 반드시 되돌린다. BASIC_RULES = 기본 기준(화물끼리 막힘 없음, 얹힘은 뒤로 미룸, 쌓인 화물만 전도 한계 3).
  const BASIC_RULES = {
    STRICT_BLOCK: false,
    PERCH_PREFER: true,
    TIP: { side: 3, forward: 3, backward: 3 },
    TIP_STACKED_ONLY: true
  };
  function withRules(patch, fn) {
    const keep = { STRICT_BLOCK, PERCH_PREFER, PERCH_HARD, TIP, TIP_STACKED_ONLY };
    const apply = r => {
      if ('STRICT_BLOCK' in r) STRICT_BLOCK = r.STRICT_BLOCK;
      if ('PERCH_PREFER' in r) PERCH_PREFER = r.PERCH_PREFER;
      if ('PERCH_HARD' in r) PERCH_HARD = r.PERCH_HARD;
      if ('TIP' in r) TIP = r.TIP;
      if ('TIP_STACKED_ONLY' in r) TIP_STACKED_ONLY = r.TIP_STACKED_ONLY;
    };
    try {
      apply(patch);
      return fn();
    } finally {
      apply(keep);
    }
  }
  const volumeOf = list => list.reduce((sum, p) => sum + p.l * p.w * p.h, 0);
  const countSides = sides =>
    (sides.front ? 1 : 0) + (sides.back ? 1 : 0) + (sides.left ? 1 : 0) + (sides.right ? 1 : 0);

  function transportPlacementRisk(item, s, d, sides, c, mode) {
    const profile = TRANSPORT_PROFILES[mode] || TRANSPORT_PROFILES.combined,
      supported = countSides(sides);
    const base = Math.max(1, Math.min(d[0], d[1])),
      slender = d[2] / base,
      column = (s.z + d[2]) / base;
    let risk =
      Math.max(0, slender - profile.slender) * (4 - supported) + Math.max(0, column - profile.column) * (4 - supported);
    if (s.z > 0 && !sides.left && !sides.right) risk += 2;
    if (mode === 'sea' && s.z > 0 && s.x + d[0] >= c.l - 120 && !sides.front) risk += 1;
    if (item.shape === 'cylinder' && (!sides.left || !sides.right)) risk += 1;
    return risk;
  }

  const contactArea = (p, q) =>
    Math.max(0, Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x)) *
    Math.max(0, Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y));
  const withinTopLoad = (p, load) => !Number.isFinite(p.maxTopLoadKg) || load <= p.maxTopLoadKg + 1e-6;
  // p를 받치는 화물과 접촉면적. 받치는 화물은 항상 p보다 낮은 위치에 있다.
  function supportsOf(p, placed, self) {
    const supports = [];
    let total = 0;
    placed.forEach((q, j) => {
      if (j === self || Math.abs(q.z + q.h - p.z) >= TOL) return;
      const area = contactArea(p, q);
      if (area > 0) {
        supports.push({ j, area });
        total += area;
      }
    });
    return { supports, total };
  }
  function compressionLoads(placed) {
    const carried = placed.map(p => p.weight),
      top = placed.map(() => 0);
    [...placed.keys()]
      .sort((a, b) => placed[b].z - placed[a].z)
      .forEach(i => {
        const p = placed[i];
        if (p.z <= 0) return;
        const { supports, total } = supportsOf(p, placed, i);
        supports.forEach(({ j, area }) => {
          const load = (carried[i] * area) / total;
          top[j] += load;
          carried[j] += load;
        });
      });
    return top;
  }
  const supportsExisting = (box, placed) =>
    placed.some(p => Math.abs(box.z + box.h - p.z) < TOL && contactArea(p, box) > 0);
  // 새 화물(box)의 값이 받침 경로를 따라 나눠 내려간 몫(기존 화물 번호 → 값). box가 기존 화물을 받치지 않을 때만
  // 기존 분배가 그대로이므로 이 몫만 더하면 된다. 높은 화물부터 처리해야 한 화물로 모이는 몫을 모두 합친 뒤 넘길 수 있다.
  // visit(i,p,value)가 false를 돌려주면 중단하고 null을 돌려준다.
  function spreadDown(box, value, placed, add, visit, geo) {
    const self = placed.length,
      at = i => (i === self ? box : placed[i]),
      added = new Map([[self, value]]),
      queue = [self];
    while (queue.length) {
      queue.sort((a, b) => at(a).z - at(b).z);
      const i = queue.pop(),
        p = at(i);
      if (p.z <= 0) continue;
      const part = added.get(i);
      if (visit && !visit(i, p, part)) return null;
      const { supports, total } = i === self || !geo ? supportsOf(p, placed, i) : geo(i);
      for (const { j, area } of supports) {
        if (!added.has(j)) queue.push(j);
        added.set(j, add(added.get(j), part, area / total));
      }
    }
    added.delete(self);
    return added;
  }
  const addWeight = (sum = 0, part, share) => sum + part * share;
  // 커밋된 배치의 누적 상부하중. 직전 커밋이 기존 화물을 받치지 않았다면 그 화물의 몫만 더한다.
  function syncTopLoads(state) {
    const placed = state.placed,
      n = placed.length;
    if (state.topLoads?.length === n) return;
    const last = placed[n - 1],
      before = placed.slice(0, n - 1);
    if (state.topLoads?.length === n - 1 && !supportsExisting(last, before)) {
      const loads = [...state.topLoads, 0];
      for (const [j, load] of spreadDown(last, last.weight, before, addWeight, null, i => supportGeometry(state, i)))
        loads[j] += load;
      state.topLoads = loads;
    } else state.topLoads = compressionLoads(placed);
    state.topLoadsOk = placed.every((p, i) => withinTopLoad(p, state.topLoads[i]));
  }
  // 새 화물이 기존 화물을 받치지 않으면 기존 하중 분배는 바뀌지 않으므로 새 화물 중량이 내려가는 몫만 더해 본다.
  // 그 밖의 경우는 전체를 다시 계산한다.
  function compressionSafe(item, x, y, z, d, state) {
    const placed = state.placed,
      box = { ...item, x, y, z, l: d[0], w: d[1], h: d[2] };
    syncTopLoads(state);
    if (!state.topLoadsOk || supportsExisting(box, placed)) {
      const all = [...placed, box],
        loads = compressionLoads(all);
      return all.every((p, i) => withinTopLoad(p, loads[i]));
    }
    for (const [j, load] of spreadDown(box, item.weight, placed, addWeight, null, i => supportGeometry(state, i)))
      if (!withinTopLoad(placed[j], state.topLoads[j] + load)) return false;
    return true;
  }

  // 스택 합성 무게중심 검사(validator와 같은 기준). 화물 위에 얹힌 화물까지 합친 무게중심이 받침면들의 볼록 껍질 안에 있어야 한다.
  function hull(points) {
    const sorted = [...new Map(points.map(p => [`${p.x}:${p.y}`, p])).values()].sort((a, b) => a.x - b.x || a.y - b.y),
      cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    if (sorted.length < 3) return sorted;
    const lower = [],
      upper = [];
    for (const p of sorted) {
      while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
      lower.push(p);
    }
    for (const p of [...sorted].reverse()) {
      while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }
  function insidePolygon(point, polygon) {
    if (polygon.length < 3) return polygon.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 2);
    let sign = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
      if (Math.abs(cross) < 1e-6) continue;
      const next = Math.sign(cross);
      if (sign && next !== sign) return false;
      sign = next;
    }
    return true;
  }
  // 받침면 안에 합성 무게중심이 있는지 본다. 받침이 없으면 검사할 면이 없으므로 통과한다(validator와 같다).
  function balancedOnSupports(load, p, placed, self, cachedHull) {
    if (cachedHull !== undefined)
      return !cachedHull || insidePolygon({ x: load.mx / load.w, y: load.my / load.w }, cachedHull);
    const points = [];
    placed.forEach((q, j) => {
      if (j === self || Math.abs(q.z + q.h - p.z) >= TOL) return;
      const x0 = Math.max(p.x, q.x),
        x1 = Math.min(p.x + p.l, q.x + q.l),
        y0 = Math.max(p.y, q.y),
        y1 = Math.min(p.y + p.w, q.y + q.w);
      if (x1 > x0 && y1 > y0) points.push({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
    });
    return !points.length || insidePolygon({ x: load.mx / load.w, y: load.my / load.w }, hull(points));
  }
  // 확정된 화물의 받침 목록과 받침면 볼록 껍질. 새 화물이 기존 화물을 받치게 되면 commitPlacement에서 비운다.
  function supportGeometry(state, i) {
    const cache = state.geo || (state.geo = []);
    if (!cache[i]) {
      const placed = state.placed,
        p = placed[i],
        { supports, total } = supportsOf(p, placed, i),
        points = [];
      for (const { j } of supports) {
        const q = placed[j],
          x0 = Math.max(p.x, q.x),
          x1 = Math.min(p.x + p.l, q.x + q.l),
          y0 = Math.max(p.y, q.y),
          y1 = Math.min(p.y + p.w, q.y + q.w);
        points.push({ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 });
      }
      cache[i] = { supports, total, hull: points.length ? hull(points) : null };
    }
    return cache[i];
  }
  const ownMoment = p => ({ w: p.weight, mx: (p.x + p.l / 2) * p.weight, my: (p.y + p.w / 2) * p.weight });
  function stackMoments(placed) {
    const loads = placed.map(ownMoment);
    let ok = true;
    [...placed.keys()]
      .sort((a, b) => placed[b].z - placed[a].z)
      .forEach(i => {
        const p = placed[i];
        if (p.z <= 0) return;
        if (!balancedOnSupports(loads[i], p, placed, i)) ok = false;
        const { supports, total } = supportsOf(p, placed, i);
        supports.forEach(({ j, area }) => {
          const share = area / total;
          loads[j].w += loads[i].w * share;
          loads[j].mx += loads[i].mx * share;
          loads[j].my += loads[i].my * share;
        });
      });
    return { loads, ok };
  }
  const addMoment = (sum = { w: 0, mx: 0, my: 0 }, part, share) => ({
    w: sum.w + part.w * share,
    mx: sum.mx + part.mx * share,
    my: sum.my + part.my * share
  });
  // 커밋된 배치의 스택 모멘트. 직전 커밋이 기존 화물을 받치지 않았다면 그 화물의 몫만 더하고 바뀐 화물만 다시 검사한다.
  function syncStack(state) {
    const placed = state.placed,
      n = placed.length;
    if (state.stack?.loads.length === n) return;
    const last = placed[n - 1],
      before = placed.slice(0, n - 1);
    if (state.stack?.loads.length === n - 1 && state.stack.ok && !supportsExisting(last, before)) {
      const loads = [...state.stack.loads, ownMoment(last)],
        added = spreadDown(last, ownMoment(last), before, addMoment, null, i => supportGeometry(state, i));
      for (const [j, part] of added) loads[j] = addMoment(loads[j], part, 1);
      state.stack = {
        loads,
        ok: [n - 1, ...added.keys()].every(
          i => placed[i].z <= 0 || balancedOnSupports(loads[i], placed[i], placed, i, supportGeometry(state, i).hull)
        )
      };
    } else state.stack = stackMoments(placed);
  }
  // compressionSafe와 같은 방식: 새 화물이 기존 화물을 받치지 않으면 새 화물의 중량·모멘트가 아래로 전달되는 몫만 더해 본다.
  function stackSafe(item, x, y, z, d, state) {
    const placed = state.placed,
      box = { ...item, x, y, z, l: d[0], w: d[1], h: d[2] },
      self = placed.length;
    syncStack(state);
    if (!state.stack.ok || supportsExisting(box, placed)) return stackMoments([...placed, box]).ok;
    return (
      spreadDown(
        box,
        ownMoment(box),
        placed,
        addMoment,
        (i, p, part) =>
          i === self
            ? balancedOnSupports(part, p, placed, i)
            : balancedOnSupports(
                addMoment(state.stack.loads[i], part, 1),
                p,
                placed,
                i,
                supportGeometry(state, i).hull
              ),
        i => supportGeometry(state, i)
      ) !== null
    );
  }

  function transverseVoid(x, y, z, d, placed, c) {
    const [l, w, h] = d,
      mid = x + l / 2,
      intervals = [[y, y + w]];
    for (const p of placed)
      if (mid > p.x + 1 && mid < p.x + p.l - 1 && z < p.z + p.h && z + h > p.z) intervals.push([p.y, p.y + p.w]);
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const v of intervals) {
      const last = merged[merged.length - 1];
      if (last && v[0] <= last[1] + TOL) last[1] = Math.max(last[1], v[1]);
      else merged.push([v[0], v[1]]);
    }
    let covered = 0,
      internal = 0;
    merged.forEach((v, i) => {
      covered += v[1] - v[0];
      if (i) internal += Math.max(0, v[0] - merged[i - 1][1]);
    });
    return { internal, total: Math.max(0, c.w - covered) };
  }

