// 컨테이너 1대 구성: 후보 생성·정렬·기둥 적재·층 채우기·벽 채우기.
  // ---------- 컨테이너 1대 구성 ----------

  function createState(c, seed) {
    const state = {
      placed: [],
      points: [{ x: 0, y: 0, z: 0 }],
      pointKeys: new Set(['0,0,0']),
      weight: 0,
      depth: 0,
      mx: 0,
      my: 0
    };
    for (const p of seed) commitPlacement(state, c, { ...p });
    return state;
  }

  function addPoint(state, c, x, y, z) {
    if (x >= c.l || y >= c.w || z >= c.h) return;
    const key = `${x},${y},${z}`;
    if (state.pointKeys.has(key)) return;
    state.pointKeys.add(key);
    state.points.push({ x, y, z });
  }

  function projectDown(placed, x, y, z, axis) {
    let best = 0;
    for (const p of placed) {
      if (axis === 'x') {
        const e = p.x + p.l;
        if (e <= x && e > best && y >= p.y && y < p.y + p.w && z >= p.z && z < p.z + p.h) best = e;
      } else if (axis === 'y') {
        const e = p.y + p.w;
        if (e <= y && e > best && x >= p.x && x < p.x + p.l && z >= p.z && z < p.z + p.h) best = e;
      } else {
        const e = p.z + p.h;
        if (e <= z && e > best && x >= p.x && x < p.x + p.l && y >= p.y && y < p.y + p.w) best = e;
      }
    }
    return best;
  }

  function commitPlacement(state, c, box) {
    if (state.geo?.length && supportsExisting(box, state.placed)) state.geo = [];
    state.placed.push(box);
    state.weight += box.weight;
    state.depth = Math.max(state.depth, box.x + box.l);
    state.mx += (box.x + box.l / 2) * box.weight;
    state.my += (box.y + box.w / 2) * box.weight;
    // 새 화물 안에 들어간 후보점 제거
    state.points = state.points.filter(p => {
      const inside =
        p.x >= box.x &&
        p.x < box.x + box.l &&
        p.y >= box.y &&
        p.y < box.y + box.w &&
        p.z >= box.z &&
        p.z < box.z + box.h;
      if (inside) state.pointKeys.delete(`${p.x},${p.y},${p.z}`);
      return !inside;
    });
    const placed = state.placed,
      { x, y, z, l, w, h } = box;
    const a = [x + l, y, z],
      b = [x, y + w, z],
      t = [x, y, z + h];
    addPoint(state, c, ...a);
    addPoint(state, c, a[0], projectDown(placed, a[0], a[1], a[2], 'y'), a[2]);
    addPoint(state, c, a[0], a[1], projectDown(placed, a[0], a[1], a[2], 'z'));
    addPoint(state, c, ...b);
    addPoint(state, c, projectDown(placed, b[0], b[1], b[2], 'x'), b[1], b[2]);
    addPoint(state, c, b[0], b[1], projectDown(placed, b[0], b[1], b[2], 'z'));
    addPoint(state, c, ...t);
    addPoint(state, c, projectDown(placed, t[0], t[1], t[2], 'x'), t[1], t[2]);
    addPoint(state, c, t[0], projectDown(placed, t[0], t[1], t[2], 'y'), t[2]);
  }

  // 휴리스틱별로 빠르게 계산할 수 있는 앞쪽 키. 후보 정렬과 가지치기에 쓴다.
  function cheapKey(ctx, state, pos, d) {
    switch (ctx.heuristic) {
      case 'dblf':
        return [pos.z, pos.x, pos.y];
      case 'width': {
        const gap = transverseVoid(pos.x, pos.y, pos.z, d, state.placed, ctx.c);
        return [ctx.widthGap(gap.total), gap.internal, gap.total];
      }
      case 'balance': {
        const gap = transverseVoid(pos.x, pos.y, pos.z, d, state.placed, ctx.c);
        return [Math.max(state.depth, pos.x + d[0]), gap.internal, pos.z];
      }
      default: {
        const gap = transverseVoid(pos.x, pos.y, pos.z, d, state.placed, ctx.c);
        return [Math.max(state.depth, pos.x + d[0]), gap.internal, pos.z, ctx.widthGap(gap.total)];
      }
    }
  }

  // 하드 조건 검사. 통과하면 [위험 여부, ...앞쪽 키, ...나머지 키]를 돌려준다.
  function evaluate(ctx, state, item, pos, d, cheap) {
    const { c, safety, mode } = ctx,
      { x, y, z } = pos,
      [l, w, h] = d,
      placed = state.placed;
    if (collides(x, y, z, l, w, h, placed)) return null;
    const base = Math.max(1, Math.min(l, w)),
      profile = TRANSPORT_PROFILES[mode] || TRANSPORT_PROFILES.combined;
    let ratio = 1;
    if (z > 0) {
      if (h / base > topSlender(item, safety)) return null;
      const support = supportInfo(item, x, y, z, l, w, placed);
      if (support.blocked || !support.count || support.fragile || !support.center) return null;
      if (support.ratio < safety.minSupport - 1e-6) return null;
      // 엄격 기준: 원통은 바닥이나 같은 규격 원통 위에만 세운다(상자 위에 올린 원통은 높은 곳에서 기울거나 구를 위험이 크다).
      if (safety.cylinderOnFloor && support.onBox) return null;
      ratio = support.ratio;
    }
    // 측면 지지는 결과에 영향을 줄 때만 계산한다.
    const needSides =
      ctx.heuristic === 'width' ||
      z > 0 ||
      item.shape === 'cylinder' ||
      h / base > profile.slender ||
      (z + h) / base > Math.min(1.5, profile.column);
    const sides = needSides ? lateralSupportDirections(pos, d, placed, c, true) : null,
      supported = sides ? countSides(sides) : 4;
    if ((z + h) / base > 1.5 && supported < (ctx.deferSides ? 1 : 2)) return null;
    if (
      STRICT_BLOCK &&
      !ctx.deferSides &&
      (!blockedOk(blockedSides(pos, d, placed, c, true)) || !perchOk(pos, d, placed, c, true))
    )
      return null;
    if (PERCH_HARD && !ctx.deferSides && !perchOk(pos, d, placed, c, true)) return null;
    if (TOWER_CHECK && !ctx.deferSides && !towerOk(pos, d, placed, c, true)) return null;
    if (ctx.hasTopLoadLimits && !compressionSafe(item, x, y, z, d, state)) return null;
    if (!stackSafe(item, x, y, z, d, state)) return null;
    const risk = sides ? transportPlacementRisk(item, pos, d, sides, c, mode) : 0,
      open = STRICT_BLOCK
        ? (b => (b.back ? 0 : 1) + (b.left ? 0 : 1) + (b.right ? 0 : 1))(blockedSides(pos, d, placed, c, true))
        : (PERCH_PREFER && z > 0 && !perchOk(pos, d, placed, c, true) ? 1 : 0) +
          (TOWER_PREFER && !towerOk(pos, d, placed, c, true) ? 1 : 0),
      flag = (risk > 0 ? 1 : 0) + open,
      area = -(l * w);
    switch (ctx.heuristic) {
      case 'dblf': {
        const gap = transverseVoid(x, y, z, d, placed, c);
        return [flag, ...cheap, risk, gap.internal, ctx.widthGap(gap.total), 1 - ratio, area];
      }
      case 'width':
        return [flag, ...cheap, 4 - supported, z, Math.max(state.depth, x + l), risk, 1 - ratio];
      case 'balance': {
        const total = state.weight + item.weight;
        const cx = (state.mx + (x + l / 2) * item.weight) / total,
          cy = (state.my + (y + w / 2) * item.weight) / total;
        return [flag, ...cheap, Math.abs(cx / c.l - 0.5) + Math.abs(cy / c.w - 0.5), risk, 1 - ratio];
      }
      default:
        return [flag, ...cheap, risk, 1 - ratio, area];
    }
  }

  function findPlacement(ctx, state, item, floorOnly) {
    const { c } = ctx,
      candidates = [],
      seen = new Set();
    for (const pt of state.points) {
      if (floorOnly && pt.z > 0) continue;
      for (const d of item.rotations) {
        if (pt.x + d[0] > c.l || pt.y + d[1] > c.w || pt.z + d[2] > c.h) continue;
        const pos = compact(pt.x, pt.y, pt.z, d[0], d[1], d[2], state.placed);
        if (floorOnly && pos.z > 0) continue;
        const key = `${pos.x},${pos.y},${pos.z},${d[0]},${d[1]},${d[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ pos, d, cheap: cheapKey(ctx, state, pos, d) });
      }
    }
    candidates.sort((a, b) => compareKeys(a.cheap, b.cheap));
    let best = null;
    for (const cand of candidates) {
      // 위험 없는 최선안보다 앞쪽 키가 나쁘면 이후 후보는 모두 이길 수 없다.
      if (best && best.key[0] === 0 && compareKeys(cand.cheap, best.cheap) > 0) break;
      const key = evaluate(ctx, state, item, cand.pos, cand.d, cand.cheap);
      if (key && (!best || compareKeys(key, best.key) < 0)) best = { ...cand, key };
    }
    return best;
  }

  const ORDER_COMPARATORS = [
    (a, b) => b.volume - a.volume || b.l * b.w - a.l * a.w || b.weight - a.weight,
    (a, b) => Math.max(b.l, b.w, b.h) - Math.max(a.l, a.w, a.h) || b.l * b.w - a.l * a.w || b.volume - a.volume,
    (a, b) => b.l * b.w - a.l * a.w || b.h - a.h || b.volume - a.volume,
    (a, b) => b.weight - a.weight || b.volume - a.volume
  ];
  function stabilityRisk(item) {
    const slender = item.h / Math.max(1, Math.min(item.l, item.w));
    return (item.shape === 'cylinder' ? 2 : 0) + (slender > 1.15 ? 1 : 0) + (item.h >= 1200 ? 1 : 0);
  }
  // 추가 투입 순서(4번 이후): 제품 규격 묶음의 순서를 고정 시드로 섞는다(묶음 안은 부피순). 같은 입력이면 늘 같은 순서다.
  const EXTRA_ORDERS = 24;
  function seeded(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sortUnits(units, order) {
    if (order >= ORDER_COUNT) {
      const base = sortUnits(units, 0),
        groups = new Map();
      for (const u of base) {
        if (!groups.has(u.typeKey)) groups.set(u.typeKey, []);
        groups.get(u.typeKey).push(u);
      }
      const keys = [...groups.keys()],
        rand = seeded(order * 7919 + keys.length);
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      return keys.flatMap(k => groups.get(k));
    }
    const compare = ORDER_COMPARATORS[order % ORDER_COMPARATORS.length];
    return [...units].sort(
      (a, b) =>
        compare(a, b) ||
        stabilityRisk(b) - stabilityRisk(a) ||
        String(a.name).localeCompare(String(b.name)) ||
        (a.pi || 0) - (b.pi || 0) ||
        (a.unit || 0) - (b.unit || 0)
    );
  }

  // 같은 규격 화물을 같은 방향으로 수직 기둥처럼 쌓아 안쪽 벽부터 바닥에 세운다. 기둥의 각 층은 아래 층을 100% 덮으므로
  // 윗면이 평평하고 지지율이 좋다. 모든 화물은 evaluate의 하드 조건을 한 개씩 통과해야 놓이며, 남은 화물을 돌려준다.
  // 위에 올리는 화물의 세장비 한계. 원통은 기본·CTU에서 바닥이나 같은 규격 원통 위에만 서므로(층 사이 합판을 대는 현장 관행) 1.6까지 올린다.
  // 예: 200L 드럼(지름 590 · 높이 880, 1.49) 2단. 다른 화물은 그대로 1.15(사용자 결정 2026-09-27, Cubestow 설정).
  const CYLINDER_STACK_SLENDER = 1.6;
  const topSlender = (item, safety) =>
    item.shape === 'cylinder' && safety.cylinderOnFloor
      ? Math.max(safety.maxTopSlender, CYLINDER_STACK_SLENDER)
      : safety.maxTopSlender;
  function columnHeight(ctx, item, d) {
    if (item.fragile) return 1;
    let k = Math.floor(ctx.c.h / d[2]);
    if (d[2] / Math.max(1, Math.min(d[0], d[1])) > topSlender(item, ctx.safety)) k = 1;
    if (Number.isFinite(item.maxTopLoadKg))
      k = Math.min(k, 1 + Math.floor(item.maxTopLoadKg / Math.max(1e-9, item.weight)));
    return Math.max(1, k);
  }
  // 그룹마다 차지할 길이 ≈ 바닥 면적 합 ÷ 컨테이너 폭(기둥 높이만큼 나눈 수)으로 보고, 안쪽 벽부터 차례로 놓을 때
  // 합성 무게중심이 컨테이너 길이 가운데에 가장 가까운 순서를 고른다. 그룹이 6개 이하면 모든 순서를, 넘으면 앞 6개만 바꿔 본다.
  function balancedGroupOrder(c, lists) {
    const info = lists.map(list => {
      const u = list[0],
        d = u.rotations.reduce((a, b) => (a[2] <= b[2] ? a : b)),
        k = Math.max(1, Math.min(list.length, Math.floor(c.h / d[2])));
      return {
        list,
        length: (Math.ceil(list.length / k) * d[0] * d[1]) / c.w,
        weight: list.reduce((s, p) => s + p.weight, 0)
      };
    });
    const head = info.slice(0, 6),
      tail = info.slice(6),
      target = c.l / 2;
    let best = null,
      bestScore = Infinity;
    const permute = (done, left) => {
      if (!left.length) {
        const order = [...done, ...tail];
        let x = 0,
          moment = 0,
          total = 0;
        for (const g of order) {
          moment += g.weight * (x + g.length / 2);
          total += g.weight;
          x += g.length;
        }
        const score = Math.abs(moment / Math.max(1e-9, total) - target);
        if (score < bestScore - 1e-6) {
          bestScore = score;
          best = order;
        }
        return;
      }
      left.forEach((g, i) => permute([...done, g], [...left.slice(0, i), ...left.slice(i + 1)]));
    };
    permute([], head);
    return best.map(g => g.list);
  }
  function placeColumns(run, state, units, balanced) {
    const c = run.c,
      groups = new Map(),
      rest = [];
    for (const u of units) {
      if (!groups.has(u.typeKey)) groups.set(u.typeKey, []);
      groups.get(u.typeKey).push(u);
    }
    // 기둥을 많이 세울 수 있는 규격(총 부피가 큰 규격)부터 안쪽에 세운다.
    let lists = [...groups.values()].sort((a, b) => b.length * b[0].volume - a.length * a[0].volume);
    if (balanced && lists.length > 1) lists = balancedGroupOrder(c, lists);
    // 균형 변형: 모든 기둥을 최대 높이로 세웠을 때 바닥이 남으면, 남는 비율만큼 기둥을 낮춰 종방향으로 고르게 펼친다.
    let spread = 1;
    if (balanced) {
      let area = 0;
      for (const list of lists) {
        const u = list[0],
          d = u.rotations.reduce((a, b) => (a[2] <= b[2] ? a : b)),
          k = Math.max(1, Math.min(list.length, columnHeight(run, u, d)));
        area += Math.ceil(list.length / k) * d[0] * d[1];
      }
      spread = Math.min(1, area / (c.l * c.w * 0.9));
    }
    for (const list of lists) {
      const u = list[0];
      // 방향: 기둥이 높이를 가장 잘 채우고, 비슷하면 눕힌(높이가 바닥 최소 치수 이하) 방향, 횡방향 잔여가 작은 방향 순.
      const scored = u.rotations
        .map(d => {
          const k = Math.min(columnHeight(run, u, d), list.length);
          return {
            d,
            k,
            fill: Math.round(((k * d[2]) / c.h) * 20),
            slender: d[2] / Math.max(1, Math.min(d[0], d[1])),
            gap: c.w % d[1]
          };
        })
        .sort(
          (a, b) =>
            b.fill - a.fill || (a.slender > 1) - (b.slender > 1) || a.gap - b.gap || a.d[0] * a.d[1] - b.d[0] * b.d[1]
        );
      const d = scored[0].d,
        k = balanced ? Math.max(1, Math.ceil(scored[0].k * spread)) : scored[0].k;
      if (k < 2) {
        // 균형 변형은 기둥으로 못 세우는 규격도 정한 그룹 순서대로 바닥에 먼저 놓아, 무거운 기둥이 안쪽 벽에 몰리지 않게 한다.
        if (!balanced) {
          rest.push(...list);
          continue;
        }
        for (const item of list) {
          const spot = state.weight + item.weight <= c.maxWeight && findPlacement(run, state, item, true);
          if (spot)
            commitPlacement(state, c, {
              ...item,
              x: spot.pos.x,
              y: spot.pos.y,
              z: spot.pos.z,
              l: spot.d[0],
              w: spot.d[1],
              h: spot.d[2]
            });
          else rest.push(item);
        }
        continue;
      }
      const queue = list.map(item => ({ ...item, rotations: [d] }));
      while (queue.length) {
        if (state.weight + queue[0].weight > c.maxWeight) break;
        const base = findPlacement(run, state, queue[0], true);
        if (!base) break;
        let z = 0,
          stacked = 0;
        while (queue.length && stacked < k) {
          const item = queue[0],
            pos = { x: base.pos.x, y: base.pos.y, z };
          if (z + d[2] > c.h || state.weight + item.weight > c.maxWeight) break;
          if (stacked > 0 && !evaluate(run, state, item, pos, d, cheapKey(run, state, pos, d))) break;
          commitPlacement(state, c, { ...item, x: pos.x, y: pos.y, z, l: d[0], w: d[1], h: d[2] });
          queue.shift();
          stacked++;
          z += d[2];
        }
        if (stacked < 2 && queue.length && stacked === 0) break;
      }
      // 기둥으로 못 세운 화물은 원래 회전 후보를 되살려 나머지 배치로 넘긴다.
      rest.push(...queue.map(item => ({ ...item, rotations: u.rotations })));
    }
    return rest;
  }
  // 최종 상태에서 높은 화물(누적 높이/바닥 최소 치수 > 1.5)이 2면 이상 지지되는지 확인하고, 못 미치는 화물과 그 위에 얹힌 화물을 뺀다.
  // 화물을 빼면 이웃의 지지가 줄 수 있으므로 더 뺄 것이 없을 때까지 반복한다. 받침·상부하중·적층 무게중심은 위 화물이 빠질 뿐이라 나빠지지 않는다.
  function settleSides(c, placed, fixed) {
    let kept = placed,
      removed = [];
    for (let round = 0; round < placed.length; round++) {
      const failing = kept.filter(p => {
        if (fixed.has(p)) return false;
        const d = [p.l, p.w, p.h];
        return (
          ((p.z + p.h) / Math.max(1, Math.min(p.l, p.w)) > 1.5 &&
            countSides(lateralSupportDirections(p, d, kept, c, true, p)) < 2) ||
          (STRICT_BLOCK && (!blockedOk(blockedSides(p, d, kept, c, true, p)) || !perchOk(p, d, kept, c, true, p))) ||
          (PERCH_HARD && !perchOk(p, d, kept, c, true, p)) ||
          (TOWER_CHECK && !towerOk(p, d, kept, c, true, p))
        );
      });
      if (!failing.length) break;
      const drop = new Set();
      for (const p of failing) {
        // 문쪽 면만 모자라서 걸렸으면(다른 조건은 통과) 앞에 닿은 화물들을 뺀다. 그러면 이 화물이 문쪽 첫 줄이 되거나, 다시 놓인 화물이 제대로 막는다.
        const others = kept,
          d = [p.l, p.w, p.h];
        let onlyFront = false;
        if (
          TOWER_CHECK &&
          !(
            (p.z + p.h) / Math.max(1, Math.min(p.l, p.w)) > 1.5 &&
            countSides(lateralSupportDirections(p, d, others, c, true, p)) < 2
          ) &&
          !(STRICT_BLOCK && !blockedOk(blockedSides(p, d, others, c, true, p)))
        ) {
          const b = blockedSides(p, d, others, c, true, p),
            H = p.z + p.h,
            rx = H / Math.max(1, p.l),
            ry = H / Math.max(1, p.w);
          onlyFront = !b.front && (rx <= TIP.forward || b.back) && (ry <= TIP.side || (b.left && b.right));
        }
        const ahead = onlyFront
          ? others.filter(
              q =>
                !fixed.has(q) &&
                q.x >= p.x + p.l - TOL &&
                q.x - (p.x + p.l) <= BLOCK_GAP &&
                q.y + q.w > p.y &&
                q.y < p.y + p.w &&
                q.z + q.h > p.z + TOL &&
                q.z < p.z + p.h - TOL
            )
          : [];
        if (ahead.length) ahead.forEach(q => drop.add(q));
        else drop.add(p);
      }
      let grew = true;
      while (grew) {
        grew = false;
        for (const p of kept)
          if (
            !drop.has(p) &&
            p.z > 0 &&
            [...drop].some(
              q =>
                Math.abs(q.z + q.h - p.z) < TOL &&
                Math.min(p.x + p.l, q.x + q.l) - Math.max(p.x, q.x) > TOL &&
                Math.min(p.y + p.w, q.y + q.w) - Math.max(p.y, q.y) > TOL
            )
          ) {
            drop.add(p);
            grew = true;
          }
      }
      if ([...drop].some(p => fixed.has(p))) return null;
      removed = removed.concat(kept.filter(p => drop.has(p)));
      kept = kept.filter(p => !drop.has(p));
    }
    return { kept, removed };
  }
  const RESETTLE_ROUNDS = 6;
  // 층 후보 깊이: 남은 화물의 회전별 종방향 치수를 부피로 가중해 많이 쓰일 깊이부터 고른다. 투입 순서 첫 화물의 깊이는 항상 넣는다.
  function wallDepths(units, room, limit) {
    const weight = new Map();
    for (const u of units)
      for (const d of u.rotations) if (d[0] <= room) weight.set(d[0], (weight.get(d[0]) || 0) + u.volume);
    const ranked = [...weight.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([d]) => d);
    const first = units[0]?.rotations
      .map(d => d[0])
      .filter(d => d <= room)
      .sort((a, b) => b - a)[0];
    return [...new Set([...(first ? [first] : []), ...ranked])].slice(0, limit);
  }
  // 전폭 벽(스트립) 빌더. 벽 = 깊이 D 안에 같은 규격을 같은 방향으로 수직으로 쌓은 기둥들을 횡방향으로 빈틈없이 붙인 것.
  // 기둥 후보(규격·회전·단수)의 폭 조합을 동적계획법으로 골라 벽 부피를 최대로 하고(양 끝 잔여 폭은 500mm 이하를 우선),
  // 벽 채움률이 가장 높은 깊이를 골라 안쪽 벽부터 차례로 확정한다. 기둥은 벽의 안쪽 면에 맞추고, 짧은 기둥의 문쪽 틈은 500mm 이하다.
  const STRIP_STEP = 10;
  function stripColumns(run, units) {
    const groups = new Map();
    for (const u of units) {
      if (!groups.has(u.typeKey)) groups.set(u.typeKey, []);
      groups.get(u.typeKey).push(u);
    }
    const cols = [];
    for (const list of groups.values()) {
      const u = list[0];
      for (const d of u.rotations) {
        // 기둥 높이는 전도 한계 안에서만 쌓는다(바닥부터 높이 ÷ 깊이·폭). 한계를 넘는 기둥은 앞뒤 벽 높이가 맞지 않으면 최종 검사에서 무너진다.
        const cap = TOWER_CHECK ? Math.min(Math.min(TIP.forward, TIP.backward) * d[0], TIP.side * d[1]) : Infinity;
        let most = Math.min(list.length, columnHeight(run, u, d));
        while (most > 1 && most * d[2] > cap) most--;
        for (let k = 1; k <= most; k++)
          cols.push({
            key: u.typeKey,
            list,
            d,
            k,
            width: d[1],
            height: d[2] * k,
            volume: d[0] * d[1] * d[2] * k,
            weight: u.weight * k
          });
      }
    }
    return cols;
  }
  function bestStrip(run, pending, room, weightLeft) {
    const c = run.c,
      W = Math.floor(c.w / STRIP_STEP),
      cols = stripColumns(run, pending);
    let best = null;
    // 이웃 기둥이 서로 옆면을 절반 이상 덮으려면 높이가 비슷해야 한다: 목표 높이 H와의 차이가 그 기둥 한 단 높이의 절반 이하.
    const heights = [...new Set(cols.map(col => col.height))];
    for (const D of [...new Set(cols.map(col => col.d[0]))].filter(D => D <= room))
      for (const H of heights) {
        const usable = cols.filter(
          col =>
            col.d[0] <= D &&
            D - col.d[0] <= BLOCK_GAP &&
            Math.abs(col.height - H) <= col.d[2] * 0.5 &&
            col.height <= H + 1
        );
        if (!usable.length) continue;
        // dp[w]: 폭 w칸을 정확히 쓴 조합 중 부피가 가장 큰 것(사용 수량을 함께 들고 다닌다).
        const dp = new Array(W + 1).fill(null);
        dp[0] = { volume: 0, weight: 0, used: new Map(), picks: [] };
        for (let w = 0; w <= W; w++) {
          const state = dp[w];
          if (!state) continue;
          for (const col of usable) {
            const cw = Math.ceil(col.width / STRIP_STEP),
              to = w + cw;
            if (to > W) continue;
            const used = (state.used.get(col.key) || 0) + col.k;
            if (used > col.list.length || state.weight + col.weight > weightLeft) continue;
            const volume = state.volume + col.volume,
              cur = dp[to];
            if (!cur || volume > cur.volume + 1e-6) {
              const next = new Map(state.used);
              next.set(col.key, used);
              dp[to] = { volume, weight: state.weight + col.weight, used: next, picks: [...state.picks, col] };
            }
          }
        }
        // 잔여 폭 500mm 이하인 조합을 우선하고, 없으면 가장 큰 조합(마지막 벽 등).
        const tight = Math.floor((c.w - BLOCK_GAP) / STRIP_STEP);
        let pick = null;
        for (let w = W; w >= 0; w--) {
          const st = dp[w];
          if (!st || !st.picks.length) continue;
          const ok = w >= tight;
          if (!pick || (ok && !pick.ok) || (ok === pick.ok && st.volume > pick.st.volume)) pick = { st, w, ok };
        }
        if (!pick) continue;
        const fill = pick.st.volume / (D * c.w * c.h),
          score = [pick.ok ? 0 : 1, -fill, -pick.st.volume];
        if (!best || compareKeys(score, best.score) < 0) best = { D, H, picks: pick.st.picks, score };
      }
    return best;
  }
  function packStrips(ctx, units, order) {
    const c = ctx.c,
      run = { ...ctx, heuristic: 'dblf' },
      placed = [];
    let pending = sortUnits(units, order),
      x = 0,
      weight = 0;
    while (pending.length && x < c.l) {
      const strip = bestStrip(run, pending, c.l - x, c.maxWeight - weight);
      if (!strip) break;
      // 기둥을 횡방향으로 붙여 놓는다. 무거운 기둥을 가운데에 두어 좌우 무게를 맞춘다.
      const picks = [...strip.picks].sort((a, b) => b.weight - a.weight),
        line = [];
      picks.forEach((col, i) => (i % 2 ? line.push(col) : line.unshift(col)));
      const taken = new Set();
      let y = 0;
      for (const col of line) {
        const items = col.list.filter(u => !taken.has(u.uid) && pending.includes(u)).slice(0, col.k);
        items.forEach((u, j) => {
          taken.add(u.uid);
          placed.push({ ...u, x, y, z: j * col.d[2], l: col.d[0], w: col.d[1], h: col.d[2] });
          weight += u.weight;
        });
        y += col.d[1];
      }
      // 남는 폭은 양쪽으로 나눈다(가운데 정렬).
      const slack = c.w - y;
      if (slack > TOL) {
        const shift = Math.floor(slack / 2),
          start = placed.length - [...taken].length;
        for (let i = start; i < placed.length; i++) placed[i].y += shift;
      }
      pending = pending.filter(u => !taken.has(u.uid));
      x += strip.D;
    }
    return {
      placed,
      rejected: pending.map(item => ({
        ...item,
        reason: weight + item.weight > c.maxWeight ? '중량 초과' : '공간 또는 지지 조건 부족'
      })),
      totalWeight: weight,
      heuristic: 'strip',
      order
    };
  }
  function packWalls(ctx, units, order) {
    const c = ctx.c,
      placed = [],
      rejected = [];
    let pending = sortUnits(units, order),
      x = 0,
      weight = 0;
    while (pending.length && x < c.l) {
      let best = null;
      for (const depth of wallDepths(pending, c.l - x, 5)) {
        // 앞 층을 고정 화물로 두고 길이를 x+깊이로 제한한 컨테이너를 채운다. 측면 지지·받침은 실제 앞 층 화물로 판단하고, 앞 층의 빈틈도 채울 수 있다.
        // 앞 층을 고정하고 이 층만 임시로 놓은 뒤 최종 규칙으로 검사해, 통과한 화물만 층으로 쓴다.
        const sub = { ...ctx, c: { ...c, l: x + depth } },
          once = packContainerOnce({ ...sub, deferSides: Boolean(ctx.deferSides) }, pending, 'dblf', order, placed);
        const fixed = new Set(once.placed.slice(0, placed.length)),
          settled = ctx.deferSides ? settleSides(sub.c, once.placed, fixed) : { kept: once.placed, removed: [] };
        if (!settled) continue;
        const layer = settled.kept.filter(p => !fixed.has(p)),
          raw = { placed: settled.kept, rejected: [...once.rejected, ...settled.removed] };
        if (!layer.length) continue;
        const volume = layer.reduce((sum, p) => sum + p.l * p.w * p.h, 0),
          used = Math.max(x, ...layer.map(p => p.x + p.l)) - x,
          fill = used > 0 ? volume / (used * c.w * c.h) : Infinity;
        if (!best || fill > best.fill + 1e-9 || (Math.abs(fill - best.fill) <= 1e-9 && volume > best.volume))
          best = { layer, used, fill, volume, left: raw.rejected };
      }
      if (!best) break;
      placed.push(...best.layer.map(p => ({ ...p })));
      weight += best.layer.reduce((sum, p) => sum + p.weight, 0);
      x += best.used;
      const ids = new Set(best.left.map(u => u.uid));
      pending = pending.filter(u => ids.has(u.uid));
    }
    for (const item of pending)
      rejected.push({ ...item, reason: weight + item.weight > c.maxWeight ? '중량 초과' : '공간 또는 지지 조건 부족' });
    return { placed, rejected, totalWeight: weight, heuristic: 'wall', order };
  }
  function packContainer(ctx, units, heuristic, order, seed = [], initial = null) {
    if (heuristic === 'wall' && !seed.length && !initial) return packWalls(ctx, units, order);
    if (!initial && (!ctx.deferSides || seed.length))
      return packContainerOnce({ ...ctx, deferSides: false }, units, heuristic, order, seed);
    let raw =
        initial ||
        (heuristic === 'strip' && !seed.length
          ? packStrips(ctx, units, order)
          : packContainerOnce(ctx, units, heuristic, order, seed)),
      best = null;
    const volume = list => list.reduce((sum, p) => sum + p.l * p.w * p.h, 0);
    // 최종 상태 검사 → 미달 화물(과 그 위 화물) 제거 → 뺀 화물을 다시 놓기를 반복하고, 검사를 통과한 안 중 부피가 가장 큰 안을 쓴다.
    // 다시 놓을 때도 처음처럼 임시로 놓는다(옆 칸이 나중에 채워지면 막힌다). 마지막 두 번은 놓는 순간 규칙을 지키게 놓는다.
    const rounds = initial ? 3 : STRICT_BLOCK ? RESETTLE_ROUNDS : 3;
    for (let round = 0; round <= rounds; round++) {
      const settled = settleSides(ctx.c, raw.placed, new Set());
      const ids = new Set([...settled.removed, ...raw.rejected].map(u => u.uid)),
        retry = units.filter(u => ids.has(u.uid));
      // 원래 못 실은 화물은 그 사유(예: 중량 초과)를 유지하고, 최종 검사에서 뺀 화물만 공간·지지 사유로 둔다.
      const reasons = new Map(raw.rejected.map(r => [r.uid, r.reason]));
      const candidate = {
        placed: settled.kept,
        rejected: retry.map(item => ({ ...item, reason: reasons.get(item.uid) || '공간 또는 지지 조건 부족' })),
        totalWeight: settled.kept.reduce((sum, p) => sum + p.weight, 0),
        heuristic,
        order
      };
      if (!best || volume(candidate.placed) > volume(best.placed) + 1e-6) best = candidate;
      if (!settled.removed.length || !retry.length || round === rounds) break;
      raw = packContainerOnce(
        { ...ctx, deferSides: STRICT_BLOCK && round < rounds - 2 },
        retry,
        'dblf',
        order,
        settled.kept
      );
    }
    if (!best.rejected.length) return { ...best, rejected: [] };
    return best;
  }
  function packContainerOnce(ctx, units, heuristic, order, seed = []) {
    const run = { ...ctx, heuristic: HEURISTICS[heuristic].key || heuristic },
      state = createState(ctx.c, seed),
      rejected = [];
    // 같은 조건의 화물이 실패하면 새 배치가 생기기 전까지 다시 계산하지 않는다.
    let failed = new Set();
    const place = (item, floorOnly) => {
      if (state.weight + item.weight > ctx.c.maxWeight) return 'weight';
      const failKey = (floorOnly ? 'f:' : 'a:') + item.typeKey;
      if (failed.has(failKey)) return 'space';
      const best = findPlacement(run, state, item, floorOnly);
      if (!best) {
        failed.add(failKey);
        return 'space';
      }
      commitPlacement(state, ctx.c, {
        ...item,
        x: best.pos.x,
        y: best.pos.y,
        z: best.pos.z,
        l: best.d[0],
        w: best.d[1],
        h: best.d[2]
      });
      failed = new Set();
      return 'ok';
    };
    let pending = sortUnits(units, order);
    if (heuristic === 'column' || heuristic === 'columnBalance')
      pending = placeColumns(run, state, pending, heuristic === 'columnBalance');
    if (HEURISTICS[heuristic].floorFirst) {
      let added = true;
      while (added && pending.length) {
        added = false;
        const deferred = [];
        for (const item of pending) {
          if (place(item, true) === 'ok') added = true;
          else deferred.push(item);
        }
        pending = deferred;
      }
    }
    for (const item of pending) {
      const outcome = place(item, false);
      if (outcome !== 'ok')
        rejected.push({ ...item, reason: outcome === 'weight' ? '중량 초과' : '공간 또는 지지 조건 부족' });
    }
    return { placed: state.placed, rejected, totalWeight: state.weight, heuristic, order };
  }

