(function (root) {
  const CURRENT_SCHEMA_VERSION = 5,
    CURRENT_ALGORITHM_VERSION = 'ep-lex-portfolio-2026.10.28';
  const allowedContainers = new Set(['20ft', '40ft', '40hc', '45hc', '20ft-kr', '40ft-kr', '40hc-kr', '45hc-kr']),
    allowedSafety = new Set(['strict', 'standard', 'secure']),
    allowedPreferences = new Set(['auto', 'density', 'width', 'balance']),
    legacyOptimizations = {
      intelligent: ['strict', 'auto'],
      sequence: ['strict', 'auto'],
      hybrid: ['strict', 'width'],
      volume: ['standard', 'density'],
      balance: ['strict', 'balance']
    },
    allowedTransportModes = new Set(['sea', 'combined', 'road']);
  function number(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
  function normalizeProduct(p = {}) {
    const maxTopLoadKg = p.maxTopLoadKg == null || p.maxTopLoadKg === '' ? null : Math.max(0, Number(p.maxTopLoadKg));
    return {
      name: String(p.name || '').trim(),
      group: String(p.group || '기타').trim() || '기타',
      shape: p.shape === 'cylinder' ? 'cylinder' : 'box',
      qty: Math.max(1, Math.floor(number(p.qty, 1))),
      l: number(p.l),
      w: number(p.w),
      h: number(p.h),
      weight: number(p.weight),
      maxTopLoadKg: Number.isFinite(maxTopLoadKg) ? maxTopLoadKg : null,
      rotate: Boolean(p.rotate),
      fragile: Boolean(p.fragile),
      source: ['manual', 'csv', 'excel', 'json'].includes(p.source) ? p.source : 'manual'
    };
  }
  function normalizeResultSummary(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      state: ['complete', 'partial', 'failed'].includes(value.state) ? value.state : 'failed',
      loaded: Math.max(0, Math.floor(Number(value.loaded) || 0)),
      total: Math.max(0, Math.floor(Number(value.total) || 0)),
      containerCount: Math.max(0, Math.floor(Number(value.containerCount) || 0)),
      totalWeight: Math.max(0, Number(value.totalWeight) || 0),
      calculatedAt: String(value.calculatedAt || '')
    };
  }
  function normalizeFieldResult(value) {
    if (!value || typeof value !== 'object') return null;
    return {
      loaded: Math.max(0, Math.floor(Number(value.loaded) || 0)),
      containers: Math.max(0, Math.floor(Number(value.containers) || 0)),
      notes: String(value.notes || '').slice(0, 240),
      recordedAt: String(value.recordedAt || '')
    };
  }
  // 스키마 4 이하의 단일 전략(optimization)을 안전 기준 × 우선 기준으로 옮긴다.
  function normalizeStrategy(data) {
    const legacy = legacyOptimizations[data.optimization] || legacyOptimizations.intelligent;
    return {
      safety: allowedSafety.has(data.safety) ? data.safety : legacy[0],
      preference: allowedPreferences.has(data.preference) ? data.preference : legacy[1]
    };
  }
  // 고정재 선택. 없으면 모두 사용.
  // 고정 조건: 마찰(CTU 표의 화물 밑면), 래싱 MSL(daN), 고정점(iso: ISO 최소값, rated: 표시 확인). 모르는 값은 기본값.
  const FRICTION_KEYS = new Set([
      'unknown',
      'wood-pallet',
      'planed-wood',
      'plastic-pallet',
      'steel-crate',
      'rubber',
      'slip'
    ]),
    LASHING_MSLS = new Set([2000, 2500, 4000, 5000]);
  function normalizeSecuring(value) {
    const v = value && typeof value === 'object' ? value : {};
    return {
      airbag: v.airbag !== false,
      filler: v.filler !== false,
      nails: v.nails !== false,
      lashing: v.lashing !== false,
      friction: FRICTION_KEYS.has(v.friction) ? v.friction : 'unknown',
      lashingMsl: LASHING_MSLS.has(Number(v.lashingMsl)) ? Number(v.lashingMsl) : 2000,
      anchors: v.anchors === 'rated' ? 'rated' : 'iso'
    };
  }
  function normalizeSnapshot(data = {}) {
    const products = Array.isArray(data.products)
      ? data.products.map(normalizeProduct).filter(p => p.name && p.l && p.w && p.h && p.weight)
      : [];
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      algorithmVersion: String(data.algorithmVersion || 'legacy'),
      products,
      containerType: allowedContainers.has(data.containerType) ? data.containerType : '20ft',
      ...normalizeStrategy(data),
      transportMode: allowedTransportModes.has(data.transportMode) ? data.transportMode : 'combined',
      securing: normalizeSecuring(data.securing),
      resultSummary: normalizeResultSummary(data.resultSummary),
      fieldResult: normalizeFieldResult(data.fieldResult)
    };
  }
  function createSnapshot(products, containerType, strategy = {}, metadata = {}) {
    return normalizeSnapshot({
      products,
      containerType,
      ...(typeof strategy === 'string' ? { optimization: strategy } : strategy),
      ...metadata
    });
  }
  // 관리자 "이 조건으로 다시 계산": 알고리즘 점검 기록 한 건(서버 행 또는 브라우저 대기열 형식)을 입력 스냅숏으로 바꾼다.
  // 기록에는 제품명·제품군이 없으므로 "점검 제품 N"으로 채운다. 옮기지 못한 항목만 notes에 남기고, 쓸 제품이 없으면 snapshot은 null.
  const SAFETY_LABELS = { strict: '기본', standard: '적재량 우선', secure: 'CTU 기준 적용' },
    PREFERENCE_LABELS = { auto: '추천', density: '붙여 싣기', balance: '무게중심' },
    TRANSPORT_LABELS = { road: '육상', combined: '복합', sea: '해상' },
    SECURING_LABELS = {
      airbag: '에어백',
      filler: '충전재',
      nails: '바닥 못',
      lashing: '래싱',
      friction: '바닥 마찰',
      lashingMsl: '래싱 MSL',
      anchors: '고정점'
    };
  function fromAlgorithmFlag(row, current = {}) {
    const record = row && typeof row === 'object' ? row : {},
      settings = record.settings && typeof record.settings === 'object' ? record.settings : {},
      input = record.input && typeof record.input === 'object' ? record.input : {},
      notes = [],
      products = [];
    (Array.isArray(input.products) ? input.products : []).forEach((raw, i) => {
      const name = `점검 제품 ${i + 1}`,
        p = raw && typeof raw === 'object' ? raw : {},
        product = normalizeProduct({ ...p, name, group: '점검 기록' });
      if (!(product.l && product.w && product.h && product.weight)) {
        notes.push(`${name}: 치수나 무게가 없어 넣지 못했습니다.`);
        return;
      }
      if (!(Number(p.qty) >= 1)) notes.push(`${name}: 수량이 없어 1개로 넣었습니다.`);
      products.push(product);
    });
    if (!products.length) notes.push('다시 계산할 수 있는 제품이 기록에 없습니다.');
    const option = (label, value, allowed, fallback, labels) => {
      if (allowed(value)) return value;
      notes.push(
        value == null || value === ''
          ? `${label}: 기록에 없어 기본값(${labels?.[fallback] || fallback})으로 계산합니다.`
          : `${label}: 알 수 없는 값(${String(value).slice(0, 30)})이라 기본값(${labels?.[fallback] || fallback})으로 계산합니다.`
      );
      return fallback;
    };
    const containerType = option('컨테이너', settings.container, v => allowedContainers.has(v), '20ft');
    // 예전 단일 전략(optimization)만 있는 기록은 안전 수준 × 배치 방식으로 옮긴다.
    const legacy = legacyOptimizations[settings.optimization],
      safety =
        legacy && !allowedSafety.has(settings.safety)
          ? legacy[0]
          : option('안전 수준', settings.safety, v => allowedSafety.has(v), 'strict', SAFETY_LABELS);
    let preference =
      legacy && !allowedPreferences.has(settings.preference)
        ? legacy[1]
        : option('배치 방식', settings.preference, v => allowedPreferences.has(v), 'auto', PREFERENCE_LABELS);
    if (preference === 'width') {
      notes.push('배치 방식: 예전 방식(width)은 지금 없어 추천으로 계산합니다.');
      preference = 'auto';
    }
    const transportMode = option(
      '운송 모드',
      settings.transportMode,
      v => allowedTransportModes.has(v),
      'combined',
      TRANSPORT_LABELS
    );
    const s = settings.securing && typeof settings.securing === 'object' ? settings.securing : null,
      valid = {
        airbag: v => typeof v === 'boolean',
        filler: v => typeof v === 'boolean',
        nails: v => typeof v === 'boolean',
        lashing: v => typeof v === 'boolean',
        friction: v => FRICTION_KEYS.has(v),
        lashingMsl: v => LASHING_MSLS.has(Number(v)),
        anchors: v => v === 'iso' || v === 'rated'
      };
    if (!s)
      notes.push(
        '고정 조건: 기록에 없어 기본값(고정재 모두 사용 · 마찰 0.3 · 래싱 2t · 고정점 ISO 최소)으로 계산합니다.'
      );
    else {
      const missing = Object.keys(valid).filter(key => !valid[key](s[key]));
      if (missing.length)
        notes.push(
          `고정 조건 중 ${missing.map(key => SECURING_LABELS[key]).join(' · ')}: 기록에 없어 기본값으로 계산합니다.`
        );
    }
    const recorded = {
        appVersion: String(record.app_version ?? record.appVersion ?? '').replace(/^v/, ''),
        engine: String(record.engine ?? '')
      },
      now = { appVersion: String(current.appVersion ?? '').replace(/^v/, ''), engine: String(current.engine ?? '') },
      versionNote =
        recorded.appVersion === now.appVersion && recorded.engine === now.engine
          ? ''
          : `이 기록은 ${recorded.appVersion ? `v${recorded.appVersion}` : '버전 정보 없음'} / 엔진 ${recorded.engine || '정보 없음'}에서 생성되었습니다. 현재 버전(v${now.appVersion} / 엔진 ${now.engine}) 결과와 다를 수 있습니다.`;
    return {
      snapshot: products.length
        ? normalizeSnapshot({ products, containerType, safety, preference, transportMode, securing: s || {} })
        : null,
      notes,
      versionNote
    };
  }
  root.LoadwiseProjectModel = {
    CURRENT_SCHEMA_VERSION,
    CURRENT_ALGORITHM_VERSION,
    normalizeProduct,
    normalizeSnapshot,
    createSnapshot,
    fromAlgorithmFlag
  };
})(globalThis);
