// 규칙 기반 자동 평가: 계산이 끝난 적재안을 항목별로 점검해 화면에 보여 주고,
// 알고리즘이 잘못했을 가능성이 있는 결과(anomalies)는 따로 모아 관리자 점검 기록으로 보낸다.
// AI를 쓰지 않으며 같은 결과에는 항상 같은 평가를 낸다.
(function (root) {
  const LEVEL_ORDER = { ok: 0, info: 1, warn: 2, bad: 3 };
  const INNER_VOID_M2 = 0.75,
    DOOR_ZONE = 1500;

  // 안쪽에 갇힌 바닥 빈 곳(문쪽에 화물이 있는 칸)의 넓이 m². 엔진의 innerVoid와 같은 방식(100mm 격자).
  function innerVoidArea(load) {
    const c = load.container,
      cell = 100,
      nx = Math.ceil(c.l / cell),
      ny = Math.ceil(c.w / cell),
      cov = new Uint8Array(nx * ny);
    for (const p of load.placed) {
      if (p.z > 2) continue;
      for (let i = Math.floor(p.x / cell), ie = Math.ceil((p.x + p.l) / cell); i < ie; i++)
        for (let j = Math.floor(p.y / cell), je = Math.ceil((p.y + p.w) / cell); j < je; j++) cov[i * ny + j] = 1;
    }
    let cells = 0;
    for (let j = 0; j < ny; j++) {
      let seen = false;
      for (let i = 0; i < nx; i++) {
        if (cov[i * ny + j]) seen = true;
        else if (seen) cells++;
      }
    }
    return (cells * cell * cell) / 1e6;
  }

  function review(shipment, { validator = root.LoadwiseValidator, insights = root.LoadwiseInsights } = {}) {
    const items = [],
      anomalies = [],
      loads = shipment?.containers || [],
      safety = shipment?.safety || 'strict';
    const add = (level, code, title, detail, fix = '') => items.push({ level, code, title, detail, fix });
    const flag = (code, detail) => anomalies.push({ code, detail });
    const left = shipment?.unallocated?.length || 0;
    if (left)
      add(
        'bad',
        'unallocated',
        `미적재 ${left}개`,
        '실을 수 없는 화물이 남았습니다.',
        '컨테이너 규격, 제품 치수·회전·중량을 확인하세요.'
      );
    if (shipment?.validation && !shipment.validation.valid) {
      add(
        'bad',
        'validation',
        '검증 실패',
        shipment.validation.errors.slice(0, 2).join(' · '),
        '결과를 쓰지 말고 다시 계산하세요.'
      );
      flag('validation', shipment.validation.errors.slice(0, 5));
    }
    const bound = shipment?.stats?.lowerBound;
    if (Number.isFinite(bound) && loads.length > bound)
      add(
        'info',
        'containers',
        `컨테이너 ${loads.length}대 (부피·중량 하한 ${bound}대)`,
        shipment?.stats?.perchLimited
          ? `다른 크기 화물 위 얹힘 금지 때문에 기본 기준(${shipment.stats.perchLimited}대)보다 많습니다.`
          : '바닥 면적·적층 제한 때문에 하한보다 많을 수 있습니다.',
        ''
      );
    const weights = loads.map(l => l.totalWeight || 0);
    loads.forEach((load, i) => {
      const n = i + 1,
        c = load.container,
        placed = load.placed || [],
        plan = load.securing || { dunnage: [], airbags: [], reviews: [] };
      if (!placed.length) {
        add('bad', 'empty', `${n}번 컨테이너가 비어 있음`, '', '');
        flag('empty-container', `컨테이너 ${n}`);
        return;
      }
      // 무게배분(CTU 사전검사)
      const ctu = insights?.ctu?.(load);
      if (ctu?.level === 'danger') {
        add(
          'bad',
          'cog',
          `${n}번 무게배분 위험`,
          `앞뒤 ${ctu.grossXOffset.toFixed(1)}% · 좌우 ${ctu.grossYOffset.toFixed(1)}% 치우침`,
          '무게중심 배치로 다시 계산하거나 무거운 화물 위치를 조정하세요.'
        );
        flag('cog-danger', { container: n, x: +ctu.grossXOffset.toFixed(1), y: +ctu.grossYOffset.toFixed(1) });
      } else if (ctu?.level === 'caution')
        add(
          'warn',
          'cog',
          `${n}번 무게배분 주의`,
          `앞뒤 ${ctu.grossXOffset.toFixed(1)}% · 좌우 ${ctu.grossYOffset.toFixed(1)}% 치우침`,
          '고정재를 권고대로 쓰고 운송사와 확인하세요.'
        );
      // 첫 화물 안쪽 벽 밀착(무거운 화물을 가운데로 옮긴 경우는 예외)
      const first = placed.find(p => p.order === 1);
      if (first && !load.shifted && first.x + first.l < c.l - 1) {
        add('bad', 'flush', `${n}번 첫 화물이 안쪽 벽에서 떨어짐`, `${Math.round(c.l - (first.x + first.l))}mm`, '');
        flag('not-flush', { container: n, gap: Math.round(c.l - (first.x + first.l)) });
      }
      // 다른 크기 화물 위 얹힘(문쪽이 열린 채)
      const perched = validator
        ? (validator.validateLoad(load, { blockSides: true }).errors || []).filter(e => /얹혀/.test(e)).length
        : 0;
      if (perched) {
        add(
          safety === 'secure' ? 'bad' : 'warn',
          'perch',
          `${n}번 얹힌 화물 ${perched}개`,
          '다른 크기 화물 위에 문쪽이 열린 채 올라가 있습니다.',
          'CTU 기준으로 다시 계산하거나 문쪽을 래싱으로 묶으세요.'
        );
        if (safety === 'secure') flag('perch-in-ctu', { container: n, count: perched });
      }
      // 높은 탑의 열린 면(넘어짐)
      const towers = validator
        ? (validator.validateLoad(load, { towerLimit: 3 }).errors || []).filter(e => /전도/.test(e)).length
        : 0;
      if (towers)
        add(
          safety === 'standard' ? 'warn' : 'bad',
          'tower',
          `${n}번 높은 적층 ${towers}곳의 면이 열림`,
          safety === 'standard' ? '적재량 우선은 넘어짐 검사를 하지 않습니다.' : '넘어질 수 있는 높은 적층입니다.',
          '기본 이상으로 다시 계산하거나 래싱으로 묶으세요.'
        );
      if (towers && safety !== 'standard') flag('tower-open', { container: n, count: towers });
      // 안쪽에 갇힌 빈 곳
      const voidArea = innerVoidArea(load);
      if (voidArea >= INNER_VOID_M2) {
        add(
          'warn',
          'inner-void',
          `${n}번 안쪽에 빈 곳 ${voidArea.toFixed(1)}m²`,
          '빈 곳은 보통 문쪽에 두고 안쪽부터 꽉 채웁니다.',
          ''
        );
        flag('inner-void', { container: n, m2: +voidArea.toFixed(2) });
      }
      // 문쪽이 아닌 곳의 충전재·스페이서
      const inside = plan.dunnage.filter(
        d =>
          (d.kind === 'filler' || d.kind === 'spacer') &&
          !/맞버팀/.test(d.location || '') &&
          d.x > DOOR_ZONE &&
          d.x + d.l < c.l - 300
      );
      if (inside.length) {
        add(
          'info',
          'filler-inside',
          `${n}번 컨테이너 중간 충전재 ${inside.length}곳`,
          inside
            .slice(0, 2)
            .map(d => d.location)
            .join(' · '),
          ''
        );
        flag('filler-inside', { container: n, count: inside.length });
      }
      // 에어백 개수
      if (plan.airbags.length >= 10 && plan.airbags.length > placed.length * 0.5) {
        add(
          'info',
          'airbags',
          `${n}번 에어백 ${plan.airbags.length}개`,
          `화물 ${placed.length}개에 비해 많습니다.`,
          ''
        );
        flag('many-airbags', { container: n, airbags: plan.airbags.length, items: placed.length });
      }
      // 바닥 선하중·검토 항목
      for (const r of plan.reviews.filter(r => r.product === '바닥 선하중'))
        add('warn', 'line-load', `${n}번 바닥 선하중 초과`, r.location, '');
    });
    // 상부 허용하중을 입력하지 않은 화물 위에 다른 화물이 얹힘: 엔진은 한도를 무제한으로 보므로 따로 알린다.
    // 위에 실린 무게가 자기 무게 이상이면 주의, 그보다 가벼우면 안내.
    const over = (a, b) =>
      Math.min(a.x + a.l, b.x + b.l) > Math.max(a.x, b.x) && Math.min(a.y + a.w, b.y + b.w) > Math.max(a.y, b.y);
    let unknownStacked = 0,
      unknownHeavy = 0;
    for (const load of loads)
      for (const p of load.placed || []) {
        if (Number.isFinite(p.maxTopLoadKg)) continue;
        const above = (load.placed || []).filter(q => q !== p && Math.abs(q.z - (p.z + p.h)) < 2 && over(p, q));
        if (!above.length) continue;
        unknownStacked++;
        if (above.reduce((s, q) => s + (q.weight || 0), 0) >= (p.weight || 0)) unknownHeavy++;
      }
    if (unknownStacked)
      add(
        unknownHeavy ? 'warn' : 'info',
        'top-load-unknown',
        `상부 허용하중 미입력 화물 ${unknownStacked}개 위에 적층`,
        unknownHeavy
          ? `그중 ${unknownHeavy}개는 자기 무게 이상이 위에 실렸습니다. 미입력 화물은 한도 없이 쌓을 수 있는 것으로 계산했습니다.`
          : '미입력 화물은 한도 없이 쌓을 수 있는 것으로 계산했습니다.',
        '제품의 상부 허용하중을 입력하면 압축하중을 검증합니다. 모르면 상부 적재 금지를 켜세요.'
      );
    // 조금만 실린 마지막 컨테이너
    if (loads.length >= 2) {
      const last = loads[loads.length - 1],
        others = weights.slice(0, -1),
        avg = others.reduce((a, b) => a + b, 0) / others.length;
      if (last.placed.length <= 5 && weights[weights.length - 1] < avg * 0.2) {
        add(
          'info',
          'thin-last',
          `마지막 컨테이너에 ${last.placed.length}개만 실림`,
          '',
          '화물 수량을 조정하거나 LCL을 검토하세요.'
        );
        flag('thin-last', { items: last.placed.length });
      }
    }
    const worst = items.reduce((m, it) => Math.max(m, LEVEL_ORDER[it.level]), 0);
    const grade =
      worst >= 3
        ? { key: 'bad', label: '재검토 필요' }
        : worst >= 2
          ? { key: 'warn', label: '주의' }
          : { key: 'ok', label: '양호' };
    if (!items.length) add('ok', 'clean', '지적 사항 없음', '모든 자동 점검을 통과했습니다.', '');
    return {
      grade,
      items: mergeContainerItems(items).sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]),
      anomalies
    };
  }

  // 여러 컨테이너에서 같은 지적("1번 바닥 선하중 초과"와 "2번 …")이 나오면 "1·2번 …" 하나로 묶는다.
  function mergeContainerItems(items) {
    const out = [],
      groups = new Map();
    for (const it of items) {
      const m = /^(\d+)번 (.*)$/.exec(it.title);
      if (!m) {
        out.push(it);
        continue;
      }
      const key = [it.code, it.level, m[2], it.detail, it.fix].join('\u0000');
      let g = groups.get(key);
      if (!g) {
        g = { ...it, numbers: [] };
        groups.set(key, g);
        out.push(g);
      }
      g.numbers.push(m[1]);
    }
    return out.map(it => {
      if (!it.numbers) return it;
      const { numbers, ...rest } = it;
      return { ...rest, title: it.title.replace(/^\d+번/, `${numbers.join('·')}번`) };
    });
  }

  // 같은 입력·조건·지적이면 같은 값(서버에서 중복 기록을 막는다).
  function fingerprint(value) {
    const s = JSON.stringify(value);
    let h1 = 0x811c9dc5,
      h2 = 5381;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 16777619) >>> 0;
      h2 = (Math.imul(h2, 33) + ch) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  root.LoadwiseReview = { review, innerVoidArea, fingerprint };
})(typeof window !== 'undefined' ? window : globalThis);
