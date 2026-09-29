// 컨테이너 한 대 채우기와 여러 대 나누기, 이전 결과 고쳐 쓰기, 결과 설명.
  // ---------- 컨테이너 한 대 채우기 ----------
  // 단계: 배치안 포트폴리오 → (CTU) 기본 기준 배치 고쳐 쓰기 → (CTU) 남은 화물 끼워 넣기 → 빈틈을 문쪽으로.
  // 후보 비교: 최종 검사를 통과한 안 중 비교 키가 가장 작은 안.
  function offerLoad(ctx, state, load) {
    if (!sidesHold(load)) return false;
    const key = containerKey(load, ctx);
    if (!load.rejected.length && load.metrics.ctuLevel === 0) state.sawSafe = true;
    if (!state.best || compareKeys(key, state.bestKey) < 0) {
      state.best = load;
      state.bestKey = key;
      return true;
    }
    return false;
  }
  const CENTER_VARIANTS = [false, true];
  function searchPortfolio(ctx, units, budgetMs, stats, hardDeadline, state) {
    const runs = portfolioRuns(ctx.preference),
      cap = runCap(ctx, units.length, budgetMs, runs.length);
    // 투입 순서가 같은 실행은 결과도 같으므로 한 번만 계산한다.
    const index = new Map(units.map((u, i) => [u, i])),
      sequences = [],
      seen = new Set();
    let done = 0;
    for (let i = 0; i < runs.length; i++) {
      const best = state.best;
      // 시간이 지나도 아직 아무것도 싣지 못했으면 다음 배치안을 계속 시도한다(빈 컨테이너로 끝내면 남은 화물을 모두 포기하게 된다).
      const { heuristic, order } = runs[i];
      // 비상 시간 상한은 기본 순서에만 본다. 추가 투입 순서는 가벼운 기본 기준 계산이고 배치안 수(cap)로만 자르므로 기기 속도와 관계없이 같은 결과가 나온다.
      if (i > 0 && (done >= cap || (order < ORDER_COUNT && now() > hardDeadline)) && best?.placed.length) {
        stats.truncated = true;
        if (order < ORDER_COUNT && now() > hardDeadline) stats.timedOut = true;
        break;
      }
      // 추가 투입 순서는 화물이 남았거나(대수를 줄일 여지) 무게배분이 위험일 때만 계산한다. 화물끼리 막는 CTU 탐색은 비싸서 쓰지 않는다.
      if (order >= ORDER_COUNT && (STRICT_BLOCK || (best && !best.rejected.length && best.metrics.ctuLevel < 2)))
        continue;
      sequences[order] =
        sequences[order] ||
        sortUnits(units, order)
          .map(u => index.get(u))
          .join(',');
      const runKey = `${heuristic}|${sequences[order]}`;
      if (seen.has(runKey)) {
        stats.skipped++;
        continue;
      }
      seen.add(runKey);
      const raw = packContainer(ctx, units, heuristic, order);
      stats.runs++;
      done++;
      // 부피가 현재 최선보다 작으면 비교 키 첫 항목에서 지므로 마무리 계산을 건너뛴다.
      if (best && volumeOf(raw.placed) < best.volume - 1e-6) continue;
      const shifted = rebalanceSlices(ctx, raw),
        sources = [raw, shifted, mirrorLoad(ctx, raw), shifted && mirrorLoad(ctx, shifted)].filter(Boolean);
      for (const source of sources)
        for (const centered of CENTER_VARIANTS) offerLoad(ctx, state, finalizeLoad(ctx.c, source, centered));
      // 남은 화물을 모두 싣고 CTU 사전검사가 양호한 안이 한 번이라도 나오면 멈춘다(계산량은 예전과 같다). 그중 무엇을 쓸지는 비교 키로 고른다.
      if (state.sawSafe) {
        stats.settled = (stats.settled || 0) + 1;
        break;
      }
    }
  }
  // CTU 기준에서 화물이 남으면 기본 기준 배치를 출발점으로 삼는다: 기본 기준으로 가볍게 여러 안을 만들고,
  // 지금보다 많이 싣는 안 중 가장 많이 싣는 1개만 CTU 검사에 걸린 화물을 빼고 다시 놓는다(다시 놓기는 3회로 제한).
  // 래싱을 끈 CTU(전도 한계 적용)는 기본 기준 배치와 전도 규칙이 달라 출발점으로 쓰지 않는다(평가 세트에서 대수가 늘었다).
  const RELAXED_SEEDS = [
    { heuristic: 'width', order: 0 },
    { heuristic: 'dblf', order: 0 },
    { heuristic: 'column', order: 0 },
    { heuristic: 'columnBalance', order: 0 },
    { heuristic: 'density', order: 1 },
    { heuristic: 'dblf', order: 2 }
  ];
  function repairFromBasicLayout(ctx, units, stats, state) {
    const best = state.best,
      loose = withRules(BASIC_RULES, () =>
        RELAXED_SEEDS.map(({ heuristic, order }) => ({
          heuristic,
          order,
          raw: packContainerOnce({ ...ctx, safety: SAFETY_LEVELS.strict, deferSides: false }, units, heuristic, order)
        }))
          .filter(v => v.raw.placed.length > best.placed.length)
          .map(v => ({ ...v, volume: volumeOf(v.raw.placed) }))
      );
    loose.sort((a, b) => b.volume - a.volume || a.raw.rejected.length - b.raw.rejected.length);
    for (const seed of loose.slice(0, 1)) {
      const raw = packContainer(ctx, units, seed.heuristic, seed.order, [], seed.raw);
      stats.runs++;
      if (volumeOf(raw.placed) < state.best.volume - 1e-6) continue;
      for (const centered of CENTER_VARIANTS)
        if (offerLoad(ctx, state, finalizeLoad(ctx.c, raw, centered))) stats.relaxed = (stats.relaxed || 0) + 1;
      if (!state.best.rejected.length) break;
    }
  }
  // 빈틈을 문쪽으로 모은다(현장 관행: 안쪽부터 꽉 채운다). 밀어서 무게배분이 위험이 될 때만 원래 배치를 쓴다(주의까지는 민다).
  function pushGapsToDoor(ctx, best, stats) {
    // 무거운 화물을 가운데로 옮긴 안은 다시 안쪽 벽으로 밀지 않는다.
    if (!(best?.placed.length > 1) || best.shifted) return best;
    const placed = pushInward(ctx.c, best.placed);
    if (!placed.some((p, i) => p.x !== best.placed[i].x)) return best;
    orderPlacementsForLoading(placed);
    const next = { ...best, placed };
    next.metrics = loadMetrics(next, ctx.mode);
    if (next.metrics.ctuLevel === 2 && best.metrics.ctuLevel < 2) return best;
    stats.pushed = (stats.pushed || 0) + 1;
    return next;
  }
  function packOneContainer(ctx, units, budgetMs, stats, hardDeadline) {
    const state = { best: null, bestKey: null };
    searchPortfolio(ctx, units, budgetMs, stats, hardDeadline, state);
    if (STRICT_BLOCK && TIP_STACKED_ONLY && state.best?.rejected.length && now() <= hardDeadline)
      repairFromBasicLayout(ctx, units, stats, state);
    let best = state.best;
    // 남은 화물이 있으면 기존 배치 사이에 한 번 더 넣어 본다.
    if (STRICT_BLOCK && best?.rejected.length && best.rejected.length <= units.length * 0.25) {
      const filled = topUp(ctx, best, units);
      if (filled !== best) {
        stats.toppedUp = (stats.toppedUp || 0) + 1;
        best = filled;
      }
    }
    best = pushGapsToDoor(ctx, best, stats);
    // 완성안이 하나도 최종 검사를 통과하지 못하면 이 컨테이너에는 싣지 않는다(안전 우선).
    return (
      best ||
      finalizeLoad(
        ctx.c,
        {
          placed: [],
          rejected: units.map(item => ({ ...item, reason: '공간 또는 지지 조건 부족' })),
          totalWeight: 0,
          heuristic: 'none',
          order: 0
        },
        false
      )
    );
  }

  function prepareUnits(units) {
    return units.map((u, uid) => {
      const unit = { ...u, uid, volume: u.volume || u.l * u.w * u.h };
      unit.rotations = allowedRotations(unit);
      unit.typeKey = `${unit.shape}|${unit.l}x${unit.w}x${unit.h}|${unit.weight}|${unit.rotate ? 1 : 0}|${unit.fragile ? 1 : 0}|${unit.maxTopLoadKg ?? ''}`;
      return unit;
    });
  }
  const stripUnit = ({ rotations, typeKey, uid, ...rest }) => rest;
  function cleanLoad(load) {
    return { ...load, placed: load.placed.map(stripUnit), rejected: load.rejected.map(stripUnit) };
  }

  function lowerBound(c, units) {
    const volume = units.reduce((sum, u) => sum + u.l * u.w * u.h, 0),
      weight = units.reduce((sum, u) => sum + u.weight, 0);
    return Math.max(
      units.length ? 1 : 0,
      Math.ceil(volume / (c.l * c.w * c.h) - 1e-9),
      Math.ceil(weight / c.maxWeight - 1e-9)
    );
  }

  // 이전 결과가 한 대로 완료됐다면 유효한 배치를 유지하고 바뀐 화물만 다시 배치한다.
  function repairFromPrevious(ctx, units, previous) {
    const c = ctx.c,
      old = previous?.containers?.[0];
    if (
      !old ||
      previous.containers.length !== 1 ||
      previous.unallocated?.length ||
      previous.totalUnits !== units.length
    )
      return null;
    if (
      previous.safety !== ctx.safetyKey ||
      previous.preference !== ctx.preference ||
      previous.transportMode !== ctx.mode
    )
      return null;
    if (
      old.container.l !== c.l ||
      old.container.w !== c.w ||
      old.container.h !== c.h ||
      old.container.maxWeight !== c.maxWeight
    )
      return null;
    const current = new Map(units.map(u => [`${u.pi}:${u.unit}`, u])),
      retained = [],
      kept = new Set();
    for (const p of old.placed) {
      const key = `${p.pi}:${p.unit}`,
        item = current.get(key);
      if (
        !item ||
        item.name !== p.name ||
        item.shape !== p.shape ||
        item.weight !== p.weight ||
        item.fragile !== p.fragile ||
        item.maxTopLoadKg !== p.maxTopLoadKg
      )
        continue;
      if (!item.rotations.some(d => d[0] === p.l && d[1] === p.w && d[2] === p.h)) continue;
      retained.push({ ...item, x: c.l - (p.x + p.l), y: p.y, z: p.z, l: p.l, w: p.w, h: p.h });
      kept.add(key);
    }
    if (!retained.length) return null;
    const pending = units.filter(u => !kept.has(`${u.pi}:${u.unit}`));
    const raw = packContainer(ctx, pending, PREFERRED_HEURISTIC[ctx.preference] || 'dblf', 0, retained);
    if (raw.rejected.length) return null;
    const load = finalizeLoad(c, raw, false);
    const validator = root.LoadwiseValidator;
    if (validator && !validator.validateLoad(load, { minSupport: ctx.safety.minSupport }).valid) return null;
    return load;
  }

  function packShipment(input) {
    const started = now();
    const c = input.container,
      safetyKey = SAFETY_LEVELS[input.safety] ? input.safety : 'strict',
      preference = PREFERENCES[input.preference] ? input.preference : 'auto';
    const mode = TRANSPORT_PROFILES[input.transportMode] ? input.transportMode : 'combined',
      budget = Number.isFinite(input.timeBudgetMs) ? input.timeBudgetMs : 8000;
    const onProgress = typeof input.onProgress === 'function' ? input.onProgress : () => {};
    const units = prepareUnits(input.units || []);
    STRICT_BLOCK = Boolean(SAFETY_LEVELS[safetyKey].blockSides);
    PERCH_HARD = false;
    TOWER_CHECK = safetyKey !== 'standard';
    PERCH_PREFER = safetyKey === 'strict' || safetyKey === 'standard';
    TOWER_PREFER = safetyKey === 'standard';
    const securing = { airbag: true, filler: true, nails: true, lashing: true, ...(input.securing || {}) },
      ctuTip = Boolean(SAFETY_LEVELS[safetyKey].blockSides) && securing.lashing === false;
    TIP = ctuTip ? tipLimits(mode) : { side: 3, forward: 3, backward: 3 };
    TIP_STACKED_ONLY = !ctuTip;
    BLOCK_GAP = securing.airbag || securing.filler ? 500 : TOL;
    FLOOR_FILL = securing.filler !== false;
    const ctx = {
      c,
      safetyKey,
      safety: SAFETY_LEVELS[safetyKey],
      preference,
      mode,
      widthGap: createWidthOracle(units, c.w),
      deferSides: true,
      hasTopLoadLimits: units.some(u => Number.isFinite(u.maxTopLoadKg))
    };
    const bound = lowerBound(c, units),
      stats = { runs: 0, skipped: 0, truncated: false, repaired: false, lowerBound: bound };
    let loads = [],
      remaining = units;
    // 컨테이너를 차례로 채운다. progress(비율)로 진행률 구간을 나눠 쓴다.
    // 컨테이너별 예산(share)은 경과 시간이 아니라 필요 대수 하한으로 나눈다(결과 고정). CTU 보강안은 절반씩 쓴다.
    // limit: 이 대수를 채우고도 화물이 남으면 더 볼 필요가 없다(CTU 보강안은 대수가 줄 때만 쓰므로 화물끼리 막는 안보다 한 대 적게까지만 본다).
    const fillContainers = (progress, share = budget / Math.max(1, bound), limit = MAX_CONTAINERS) => {
      const out = [];
      let left = units;
      while (left.length && out.length < MAX_CONTAINERS) {
        if (out.length >= limit) {
          out.cut = true;
          break;
        }
        // 폭 조합은 이 컨테이너에 남은 화물로만 계산한다. 앞 컨테이너에 모두 실린 규격의 폭은 쓸 수 없다.
        const widthGap = left === units ? ctx.widthGap : createWidthOracle(left, c.w);
        const load = packOneContainer({ ...ctx, widthGap }, left, share, stats, started + Math.max(budget * 3, 45000));
        if (!load.placed.length) {
          if (!out.length) out.push(load);
          left = load.rejected;
          break;
        }
        out.push(load);
        left = load.rejected;
        progress(1 - left.length / Math.max(1, units.length));
      }
      return { loads: out, remaining: left, cut: Boolean(out.cut) };
    };
    const repaired = input.previous ? repairFromPrevious(ctx, units, input.previous) : null;
    if (repaired) {
      loads.push(repaired);
      remaining = [];
      stats.repaired = true;
    } else {
      const blocked = fillContainers(f => onProgress(Math.min(0.98, (STRICT_BLOCK ? 0.6 : 1) * f)));
      ({ loads, remaining } = blocked);
      // CTU 기준: 화물끼리 서로 막는 배치가 하한보다 많은 대수를 쓰면, 기본 기준 규칙(얹힘은 금지)으로도 채워 본다.
      // 이 안의 열린 옆면은 에어백·충전재·각재·래싱으로 막는다(CTU Code는 화물 외 고정재로 막는 것도 인정). 대수·미적재가 줄 때만 쓴다.
      if (
        STRICT_BLOCK &&
        (remaining.length || loads.length > bound) &&
        (securing.airbag || securing.filler || securing.lashing)
      ) {
        // 먼저 기본 기준 그대로 채우고 최종 배치에 얹힘이 없으면 쓴다. 얹힘이 남으면 얹힘을 금지하고 다시 채운다.
        const perchClean = list =>
          list.every(L => L.placed.every(p => perchOk(p, [p.l, p.w, p.h], L.placed, L.container, false, p)));
        const limit = remaining.length ? MAX_CONTAINERS : loads.length - 1,
          half = budget / 2 / Math.max(1, bound);
        // 전도 한계(TIP)는 CTU 설정(래싱 여부)을 그대로 쓴다.
        let secured = withRules({ STRICT_BLOCK: false, PERCH_PREFER: true, PERCH_HARD: false }, () =>
          fillContainers(f => onProgress(Math.min(0.98, 0.6 + 0.2 * f)), half, limit)
        );
        // 얹힘을 금지하면 더 빡빡해지므로, 기본 기준 그대로도 대수를 줄이지 못했으면 다시 채우지 않는다.
        // 기본 기준 그대로면 대수를 줄였는데 얹힘 때문에 못 쓴 경우를 기록한다(결과 설명에 쓴다).
        const basicLoads =
          !secured.cut && secured.loads.length < loads.length && !perchClean(secured.loads) ? secured.loads.length : 0;
        if (!secured.cut && !perchClean(secured.loads))
          secured = withRules({ STRICT_BLOCK: false, PERCH_PREFER: true, PERCH_HARD: true }, () =>
            fillContainers(f => onProgress(Math.min(0.98, 0.8 + 0.18 * f)), half, limit)
          );
        if (
          (!secured.cut && secured.remaining.length < remaining.length) ||
          (!secured.cut && secured.remaining.length === remaining.length && secured.loads.length < loads.length)
        ) {
          ({ loads, remaining } = secured);
          stats.securedFaces = true;
        }
        if (basicLoads && loads.length > basicLoads) stats.perchLimited = basicLoads;
      }
    }
    // 마지막 두 컨테이너 다시 나누기: 첫 화물은 늘 안쪽 벽에 붙이므로 마지막 컨테이너에 화물이 조금만 남으면 무게중심이 안쪽으로 쏠린다.
    // 마지막 컨테이너가 가볍고(앞 컨테이너 중량의 60% 미만) 두 컨테이너 중 무게배분이 위험(CTU 기준이 아니면 주의 이상)이면 두 대의 화물을 제품 규격마다 반씩 나눠 다시 싣고, 두 대에 모두 들어가며 나쁜 쪽 등급이 좋아질 때만 쓴다.
    if (!stats.repaired && !stats.securedFaces && !remaining.length && loads.length >= 2) {
      const A = loads[loads.length - 2],
        B = loads[loads.length - 1],
        grade = list => [
          Math.max(...list.map(l => l.metrics.ctuLevel)),
          list.reduce((sum, l) => sum + l.metrics.ctuLevel, 0)
        ];
      if (
        Math.max(A.metrics.ctuLevel, B.metrics.ctuLevel) >= (STRICT_BLOCK ? 2 : 1) &&
        B.totalWeight < A.totalWeight * 0.6
      ) {
        const byId = new Map(units.map(u => [u.uid, u])),
          pool = [...A.placed, ...B.placed].map(p => byId.get(p.uid)),
          groups = new Map();
        for (const u of pool) {
          if (!groups.has(u.typeKey)) groups.set(u.typeKey, []);
          groups.get(u.typeKey).push(u);
        }
        const first = [],
          second = [];
        for (const list of groups.values()) list.forEach((u, i) => (i % 2 ? second : first).push(u));
        const share = budget / Math.max(1, bound),
          deadline = started + Math.max(budget * 3, 45000);
        const la = packOneContainer({ ...ctx, widthGap: createWidthOracle(first, c.w) }, first, share, stats, deadline);
        const rest = [...second, ...la.rejected.map(({ reason, ...u }) => u)];
        const lb = la.placed.length
          ? packOneContainer({ ...ctx, widthGap: createWidthOracle(rest, c.w) }, rest, share, stats, deadline)
          : null;
        if (lb && lb.placed.length && !lb.rejected.length) {
          const before = grade([A, B]),
            after = grade([la, lb]);
          if (after[0] < before[0] || (after[0] === before[0] && after[1] < before[1])) {
            loads = [...loads.slice(0, -2), la, lb];
            stats.tailRebalanced = true;
          }
        }
      }
    }
    // 미적재 사유를 구체적으로: 최대 대수에 걸렸거나, CTU 기준에서 에어백·충전재를 모두 꺼 아무것도 실을 수 없는 경우.
    const SPACE = '공간 또는 지지 조건 부족';
    if (remaining.length && loads.length >= MAX_CONTAINERS)
      remaining = remaining.map(u =>
        u.reason === SPACE ? { ...u, reason: `최대 컨테이너 수(${MAX_CONTAINERS}대)를 넘음` } : u
      );
    else if (
      remaining.length &&
      safetyKey === 'secure' &&
      !securing.airbag &&
      !securing.filler &&
      loads.every(L => !L.placed.length)
    )
      remaining = remaining.map(u =>
        u.reason === SPACE
          ? {
              ...u,
              reason: 'CTU 기준에서 에어백·충전재를 모두 끄면 화물 옆 틈을 막을 수 없음(에어백이나 충전재를 켜세요)'
            }
          : u
      );
    onProgress(1);
    const result = {
      engine: ENGINE_VERSION,
      safety: safetyKey,
      preference,
      transportMode: mode,
      loads: loads.map(cleanLoad),
      remaining: remaining.map(stripUnit),
      stats: { ...stats, elapsedMs: Math.round(now() - started) }
    };
    result.reason = describeResult(result);
    return result;
  }

  function describeResult(result) {
    const count = result.loads.length,
      left = result.remaining.length,
      bound = result.stats.lowerBound;
    const parts = [
      `${SAFETY_LEVELS[result.safety].label} 기준(${SAFETY_LEVELS[result.safety].description})`,
      `${PREFERENCES[result.preference].label}`,
      `컨테이너 ${count}대`
    ];
    if (!left && count === bound) parts.push('부피·중량 하한과 같은 최소 대수');
    else if (!left) parts.push(`부피·중량 하한 ${bound}대`);
    if (left) parts.push(`미배치 ${left}개`);
    if (result.stats.repaired) parts.push('기존 배치 유지');
    if (result.stats.perchLimited)
      parts.push(`다른 크기 화물 위 얹힘 금지 때문에 기본 기준(${result.stats.perchLimited}대)보다 많음`);
    if (result.stats.truncated) parts.push('시간 제한으로 일부 후보 생략');
    return parts.join(' · ');
  }

