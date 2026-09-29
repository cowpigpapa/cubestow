// 파일 가져오기(Excel·CSV)와 내보내기(PDF·Excel·CSV). app.js에서 분리했다(1.1.85).
// app.js보다 먼저 불러온다. products·shipment 등 화면 상태와 $·esc는 app.js에 있고 호출할 때만 쓴다.

// Excel 파서(약 860KB)는 가져오기·내보내기를 처음 할 때만 불러온다.
let xlsxLoading = null;
function loadXLSX() {
  if (typeof XLSX !== 'undefined') return Promise.resolve();
  return (xlsxLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'vendor/xlsx.full.min.js?v=0.18.5';
    script.onload = resolve;
    script.onerror = reject;
    document.head.append(script);
  }).catch(() => {
    xlsxLoading = null;
  }));
}
async function readFile(file) {
  if (!file) return;
  if ($('importDialog').open) $('importDialog').close();
  try {
    let rows;
    if (file.name.toLowerCase().endsWith('.csv')) rows = parseCSV(await file.text());
    else {
      await loadXLSX();
      if (typeof XLSX === 'undefined')
        throw new Error('Excel 파서를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV를 사용해 주세요.');
      const wb = XLSX.read(await file.arrayBuffer()),
        sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    }
    const mapped = rows.map((r, i) => mapRow(r, i)).filter(Boolean);
    if (!mapped.length) throw new Error('인식 가능한 제품 데이터가 없습니다. 열 이름을 확인해 주세요.');
    if (editingIndex >= 0) {
      stopEditing();
      clearProductForm();
    }
    products = mapped;
    renderProducts();
    markSimulationChanged();
    window.loadwiseStorage?.detach(file.name.replace(/\.[^.]+$/, ''));
    if (
      await showAppMessage(`${mapped.length}개 품목을 불러왔습니다.\n바로 시뮬레이션을 진행할까요?`, {
        title: '파일 불러오기 완료',
        tone: 'success',
        confirmAction: true,
        actionLabel: '시뮬레이션 실행',
        cancelLabel: '불러오기만'
      })
    )
      await simulate();
  } catch (e) {
    showAppMessage(e.message, { title: '파일을 불러오지 못했습니다', tone: 'error' });
  }
}
function parseFlag(value, label, row) {
  const v = String(value).trim().toLowerCase();
  if (['yes', 'true', '1', '예', '허용'].includes(v)) return true;
  if (['no', 'false', '0', '아니오', '금지'].includes(v)) return false;
  throw new Error(`${row}행 ${label}은 yes/no, 예/아니오, true/false, 1/0 중 하나여야 합니다.`);
}
function mapRow(r, i) {
  const row = i + 2,
    get = (...keys) => {
      const key = Object.keys(r).find(k => keys.some(x => k.toLowerCase().replace(/\s/g, '') === x));
      return key ? r[key] : '';
    },
    shape = String(get('형상', '제품형상', 'shape'))
      .trim()
      .toLowerCase(),
    qty = Number(get('수량', 'qty', 'quantity')),
    topRaw = get('상부허용하중', '상부허용하중(kg)', 'maxtopload', 'maxtopload(kg)'),
    maxTopLoadKg = topRaw === '' ? null : Number(topRaw),
    values = {
      l: Number(get('길이', '길이(mm)', 'length', 'length(mm)')),
      w: Number(get('너비', '폭', '너비(mm)', 'width', 'width(mm)')),
      h: Number(get('높이', '높이(mm)', 'height', 'height(mm)')),
      weight: Number(get('중량', '중량(kg)', 'weight', 'weight(kg)'))
    },
    name = String(get('제품명', 'name', 'product')).trim();
  if (!name) throw new Error(`${row}행 제품명이 비어 있습니다.`);
  if (!['박스형', 'box', '원통형', 'cylinder'].includes(shape))
    throw new Error(`${row}행 형상은 박스형 또는 원통형이어야 합니다.`);
  if (Object.values(values).some(v => !Number.isFinite(v) || v <= 0))
    throw new Error(`${row}행 치수와 중량은 0보다 큰 숫자여야 합니다.`);
  if (!Number.isInteger(qty) || qty <= 0) throw new Error(`${row}행 수량은 1 이상의 정수여야 합니다.`);
  if (maxTopLoadKg != null && (!Number.isFinite(maxTopLoadKg) || maxTopLoadKg < 0))
    throw new Error(`${row}행 상부 허용하중은 0 이상의 숫자이거나 빈 값이어야 합니다.`);
  return {
    name,
    group: get('제품군', 'group', 'category') || '기타',
    shape: shape === '원통형' || shape === 'cylinder' ? 'cylinder' : 'box',
    ...values,
    maxTopLoadKg,
    qty,
    rotate: parseFlag(get('눕힘허용', '눕혀서적재가능', '회전허용', 'rotation'), '눕힘허용', row),
    fragile: parseFlag(get('상부적재금지', 'fragile'), '상부적재금지', row),
    id: Date.now() + i,
    color: COLORS[i % COLORS.length]
  };
}
function parseCSV(text) {
  const rows = [],
    cells = splitCSV(text.replace(/^\uFEFF/, ''));
  let row = [];
  for (const cell of cells) {
    if (cell === null) {
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else row.push(cell.trim());
  }
  if (row.some(v => v !== '')) rows.push(row);
  const heads = rows.shift() || [];
  return rows.map(values => Object.fromEntries(heads.map((h, i) => [h, values[i] || ''])));
}
function splitCSV(text) {
  let out = [],
    cur = '',
    q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && text[i + 1] === '"') {
      cur += '"';
      i++;
    } else if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else if ((ch === '\n' || ch === '\r') && !q) {
      out.push(cur);
      out.push(null);
      cur = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else cur += ch;
  }
  if (q) throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  out.push(cur);
  return out;
}
function downloadTemplate() {
  download(
    'cubestow-template.csv',
    '\uFEFF제품명,제품군,형상,길이(mm),너비(mm),높이(mm),중량(kg),상부허용하중(kg),수량,눕힘허용,상부적재금지\n산업용 펌프,기계류,박스형,1200,800,900,420,1500,4,yes,no\n케이블 드럼,부품,원통형,900,900,700,310,,6,no,no'
  );
}
async function captureView(mode) {
  const previous = viewMode;
  setView(mode);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const source = threeView?.renderer?.domElement || $('loadingCanvas'),
    image = source.toDataURL('image/png');
  setView(previous);
  return image;
}
async function exportPdf() {
  if (resultStale)
    return showAppMessage('입력이 바뀌었습니다. 다시 계산한 뒤 내보내 주세요.', {
      title: '결과가 최신이 아닙니다',
      tone: 'warning'
    });
  if (!shipment) return;
  if (shipment.unallocated.length) {
    showAppMessage(`미배치 화물 ${shipment.unallocated.length}개를 해결한 후 작업지시서를 만들 수 있습니다.`, {
      title: 'PDF 작업지시서가 제한됩니다',
      tone: 'warning'
    });
    return;
  }
  if (!(await confirmExportNotice())) return;
  const printWindow = window.open('', 'loadwise-work-instruction');
  if (!printWindow) {
    showAppMessage('작업지시서 새 창을 열 수 없습니다. 브라우저의 팝업 차단을 해제해 주세요.', {
      title: '새 창이 차단되었습니다',
      tone: 'warning'
    });
    return;
  }
  printWindow.document.write(
    '<!doctype html><title>작업지시서 준비 중</title><p style="font-family:sans-serif;padding:24px">작업지시서를 준비하고 있습니다…</p>'
  );
  const outcome = shipmentOutcome(shipment),
    balance = LoadwiseInsights.ctu(result),
    validation = LoadwiseValidator.validateLoad(result, { minSupport: shipmentMinSupport() }),
    compression = validation.metrics,
    iso = await captureView('iso'),
    top = await captureView('top'),
    door = await captureView('door'),
    plan = result.placed
      .map(
        p =>
          `<tr><td>${p.order}</td><td>${esc(p.name)}</td><td>${p.unit}</td><td>${p.l}×${p.w}×${p.h}</td><td>${p.weight.toLocaleString()} kg</td></tr>`
      )
      .join(''),
    transport = TRANSPORT_PROFILES[result.securing?.transportMode] || TRANSPORT_PROFILES.combined,
    fixedSummary = `${transport.label} 운송 · 부목 ${result.securing?.dunnage.length || 0}개 · 에어백 ${result.securing?.airbags.length || 0}개 · 안정성 검토 ${result.securing?.reviews.length || 0}건`;
  const report = `<div class="review-banner"><strong>검토용 · 현장 확인 필요</strong> 이 계획은 화물 강도·실제 차량 축하중·래싱 용량·위험물 규정을 계산하지 않습니다. 적재 전 담당 전문가가 확인하세요.</div><header><div><small>CUBESTOW WORK INSTRUCTION</small><h1>${esc($('projectName').value || '적재 계획')}</h1></div><b>${new Date().toLocaleDateString('ko-KR')}</b></header><section class="report-summary"><div><span>컨테이너</span><b>${esc(result.container.name)} · ${activeContainer + 1}/${shipment.containers.length}</b></div><div><span>적재 결과</span><b>${outcome.loaded}/${outcome.total}개</b></div><div><span>공간 / 중량</span><b>${result.volumeRate.toFixed(1)}% / ${result.weightRate.toFixed(1)}%</b></div><div><span>총중량</span><b>${result.totalWeight.toLocaleString()} kg</b></div></section><section><h2>적재 시점</h2><div class="report-images"><figure><img src="${iso}"><figcaption>3D 전체</figcaption></figure><figure><img src="${top}"><figcaption>상면</figcaption></figure><figure><img src="${door}"><figcaption>문 입구</figcaption></figure></div></section><section><h2>CTU 중량배분 사전검사와 고정재</h2><div class="report-metrics"><span>문쪽 / 안쪽<b>${balance.door.toFixed(1)} / ${balance.rear.toFixed(1)}%</b></span><span>좌측 / 우측<b>${balance.left.toFixed(1)} / ${balance.right.toFixed(1)}%</b></span><span>중심 편차(총중량)<b>${Math.abs(balance.grossXOffset).toFixed(1)} / ${Math.abs(balance.grossYOffset).toFixed(1)}%</b></span><span>50% 길이 최대 질량<b>${balance.concentration.toFixed(1)}%</b></span><span>수직 무게중심<b>높이의 ${balance.vertical.toFixed(1)}%</b></span><span>압축하중<b>${compression.compressionVerified}개 검증 · ${compression.compressionUnverified}개 미입력</b></span></div><p><strong>고정재 목록:</strong> ${fixedSummary}. 상세 위치는 3D 화면과 Excel 계획의 고정재 시트를 확인하세요.</p>${ctuSecuringSummary(result.securing?.ctu)}</section><section><h2>적재 순서</h2><table><thead><tr><th>순서</th><th>제품</th><th>번호</th><th>배치 크기(mm)</th><th>중량</th></tr></thead><tbody>${plan}</tbody></table></section><section class="field-record"><h2>현장 작업 기록</h2><div><span>실제 적재 수량<strong></strong></span><span>실제 컨테이너 수<strong></strong></span><span>추가 고정재<strong></strong></span></div><p>변경·파손·특이사항</p><i></i><i></i></section><footer><p><strong>안전 고지</strong> 본 문서는 작업 검토용입니다. 상부 허용하중 미입력 화물, 실제 차량 축하중, 바닥 집중하중, 마찰·동하중과 래싱 용량은 별도 확인해야 합니다.</p><div>현장 확인자 ____________________ &nbsp; 날짜 ____________________</div></footer>`;
  const css = `@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#f5f5f7;color:#1d1d1f;font:12px/1.45 Arial,"Noto Sans KR",sans-serif}.toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:12px calc((100% - 190mm)/2);background:#111;z-index:2}.toolbar button{border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer}.toolbar .primary{background:#0878d1;color:#fff}main{width:210mm;min-height:297mm;margin:20px auto;padding:10mm;background:#fff;box-shadow:0 8px 30px #0002}header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1d1d1f;padding-bottom:8px}h1{margin:3px 0 0;font-size:24px}h2{margin:16px 0 7px;font-size:15px}.report-summary,.report-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:9px}.report-metrics{grid-template-columns:repeat(3,1fr)}.report-summary div,.report-metrics span{padding:8px;border:1px solid #ddd;border-radius:6px}.report-summary span,.report-metrics span{color:#666}.report-summary b,.report-metrics b{display:block;margin-top:3px;color:#111}.report-images{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.report-images figure{margin:0;border:1px solid #ddd}.report-images img{display:block;width:100%;height:120px;object-fit:contain}.report-images figcaption{padding:4px;text-align:center}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:4px 6px;border:1px solid #ddd;text-align:left}thead{display:table-header-group}.field-record{break-inside:avoid}.field-record>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.field-record span{padding:8px;border:1px solid #bbb}.field-record strong{display:block;height:22px}.field-record p{margin:12px 0 3px}.field-record i{display:block;height:26px;border-bottom:1px solid #aaa}footer{display:block;margin-top:16px;border-top:1px solid #333;padding-top:9px}footer div{margin-top:16px;text-align:right}.review-banner{margin:0 0 14px;padding:10px 12px;border:2px solid #c2410c;border-radius:8px;background:#fff4e8;color:#7c2d12;font-size:12.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}.review-banner strong{margin-right:6px;color:#9a3412}section{break-inside:avoid}@media print{body{background:#fff}.toolbar{display:none}main{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}}`;
  printWindow.document.open();
  printWindow.document.write(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc($('projectName').value || '적재 계획')} · 작업지시서</title><style>${css}</style></head><body><nav class="toolbar"><button id="closePrint">창 닫기</button><button class="primary" id="startPrint">인쇄 / PDF 저장</button></nav><main>${report}</main></body></html>`
  );
  printWindow.document.close();
  printWindow.document.getElementById('startPrint').onclick = () => printWindow.print();
  printWindow.document.getElementById('closePrint').onclick = () => printWindow.close();
  printWindow.focus();
}
// 현장으로 나가는 문서는 내보내기 전에 한 번 확인받는다(세션마다 한 번).
let exportNoticeAccepted = false;
async function confirmExportNotice() {
  if (exportNoticeAccepted) return true;
  const ok = await showAppMessage(EXPORT_NOTICE, {
    title: '현장 확인이 필요한 검토용 문서입니다',
    tone: 'warning',
    confirmAction: true,
    actionLabel: '확인하고 내보내기',
    cancelLabel: '취소'
  });
  if (ok === true) exportNoticeAccepted = true;
  return ok === true;
}
const EXPORT_NOTICE =
  '이 계획은 작업 검토용 베타 결과입니다. 화물 강도·상부 허용하중, 실제 차량 축하중·바닥 집중하중, 마찰·동하중과 래싱 용량, 위험물 규정은 계산하지 않습니다. 실제 적재 전 담당 전문가가 현장 확인해야 합니다.';
async function exportPlan() {
  if (resultStale)
    return showAppMessage('입력이 바뀌었습니다. 다시 계산한 뒤 내보내 주세요.', {
      title: '결과가 최신이 아닙니다',
      tone: 'warning'
    });
  if (!(await confirmExportNotice())) return;
  await loadXLSX();
  if (!result) return;
  if (shipment?.unallocated.length) {
    showAppMessage(
      `미배치 화물 ${shipment.unallocated.length}개가 남아 있습니다. 입력 조건을 수정하고 다시 계산한 뒤 내보내 주세요.`,
      { title: 'Excel 내보내기가 제한됩니다', tone: 'warning' }
    );
    return;
  }
  if (typeof XLSX === 'undefined') {
    showAppMessage('Excel 내보내기 모듈을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.', {
      title: 'Excel 내보내기 오류',
      tone: 'error'
    });
    return;
  }
  const loads = shipment ? shipment.containers : [result],
    plan = [],
    summary = [],
    securing = [];
  loads.forEach((load, i) => {
    const balance = LoadwiseInsights.ctu(load),
      validation = LoadwiseValidator.validateLoad(load, { minSupport: shipmentMinSupport() }),
      compression = validation.metrics,
      transport = TRANSPORT_PROFILES[load.securing?.transportMode] || TRANSPORT_PROFILES.combined;
    summary.push({
      '컨테이너 번호': i + 1,
      '컨테이너 규격': load.container.name,
      운송모드: transport.label,
      '적재 전략': shipment?.strategy?.label || '사용자 선택',
      '선택 근거': shipment?.strategy?.reason || '',
      '적재 수량': load.placed.length,
      '총 중량(kg)': load.totalWeight,
      '공간 활용률(%)': Number(load.volumeRate.toFixed(1)),
      '중량 활용률(%)': Number(load.weightRate.toFixed(1)),
      '문쪽 중량배분(%)': Number(balance.door.toFixed(1)),
      '안쪽 중량배분(%)': Number(balance.rear.toFixed(1)),
      '좌측 중량배분(%)': Number(balance.left.toFixed(1)),
      '우측 중량배분(%)': Number(balance.right.toFixed(1)),
      '무게중심 X(mm)': Math.round(balance.cog.x),
      '무게중심 Y(mm)': Math.round(balance.cog.y),
      '무게중심 Z(mm)': Math.round(balance.cog.z),
      '컨테이너 자체중량(kg)': balance.tare,
      '전후 편차 총중량 기준(%)': Number(Math.abs(balance.grossXOffset).toFixed(1)),
      '좌우 편차 총중량 기준(%)': Number(Math.abs(balance.grossYOffset).toFixed(1)),
      '50% 길이 최대 질량(%)': Number(balance.concentration.toFixed(1)),
      '수직 무게중심(높이%)': Number(balance.vertical.toFixed(1)),
      '압축하중 검증 화물': compression.compressionVerified,
      '압축하중 미입력 화물': compression.compressionUnverified,
      'CTU 사전검사': balance.level === 'safe' ? '양호' : balance.level === 'caution' ? '주의' : '위험'
    });
    load.placed.forEach(p =>
      plan.push({
        '컨테이너 번호': i + 1,
        '컨테이너 규격': load.container.name,
        '적재 순서': p.order,
        제품명: p.name,
        제품군: p.group,
        '제품 번호': p.unit,
        '제품 형상': p.shape === 'cylinder' ? '원통형' : '박스형',
        '문에서 안쪽 X(mm)': p.x,
        '좌측에서 우측 Y(mm)': p.y,
        '바닥에서 위 Z(mm)': p.z,
        '배치 길이(mm)': p.l,
        '배치 너비(mm)': p.w,
        '배치 높이(mm)': p.h,
        '개당 중량(kg)': p.weight
      })
    );
    const fixed = [...(load.securing?.dunnage || []), ...(load.securing?.airbags || [])];
    fixed.forEach((f, n) =>
      securing.push({
        '컨테이너 번호': i + 1,
        번호: n + 1,
        구분: f.type === 'dunnage' ? (f.kind === 'beam' ? '가로 각재' : '부목') : '에어백',
        '추천 위치': f.location || '화물 간극',
        '관련 제품': f.product || '',
        'X(mm)': Math.round(f.x),
        'Y(mm)': Math.round(f.y),
        'Z(mm)': Math.round(f.z),
        '길이(mm)': Math.round(f.l),
        '너비(mm)': Math.round(f.w),
        '높이(mm)': Math.round(f.h)
      })
    );
    (load.securing?.reviews || []).forEach((review, n) =>
      securing.push({
        '컨테이너 번호': i + 1,
        번호: fixed.length + n + 1,
        구분: reviewLabel(review),
        '추천 위치': review.location,
        '관련 제품': review.product,
        '미지지 방향': review.axes || ''
      })
    );
    const ctuReview = load.securing?.ctu,
      base = fixed.length + (load.securing?.reviews || []).length;
    ctuSecuringDirections(ctuReview)
      .map(d => ({
        구분: 'CTU 참고 계산',
        '추천 위치': d.label,
        '관련 제품': d.worst?.product || '',
        '필요 억제력(kN)': Number(d.forceKN.toFixed(1)),
        '전도 위험 화물': d.tipping,
        '막히지 않은 화물': d.unblocked,
        '가장 불리한 높이 비율': d.worst ? Number(d.worst.ratio.toFixed(2)) : '',
        '전도 한계': d.worst ? Number(d.worst.limit.toFixed(2)) : ''
      }))
      .forEach((row, n) => securing.push({ '컨테이너 번호': i + 1, 번호: base + n + 1, ...row }));
  });
  const productRows = products.map(p => ({
    제품명: p.name,
    제품군: p.group,
    '제품 형상': p.shape === 'cylinder' ? '원통형' : '박스형',
    수량: p.qty,
    '길이(mm)': p.l,
    '너비(mm)': p.w,
    '높이(mm)': p.h,
    '개당 중량(kg)': p.weight,
    '상부 허용하중(kg)': Number.isFinite(p.maxTopLoadKg) ? p.maxTopLoadKg : '미입력',
    '눕힘 허용': p.rotate ? '예' : '아니오',
    '상부 적재 금지': p.fragile ? '예' : '아니오'
  }));
  const wb = XLSX.utils.book_new();
  const notice = [
    {
      구분: '사용 한계',
      내용: '본 결과는 작업 검토용 베타입니다. 전역 최적해, 압축강도, 실제 차량 축하중, 위험물 규정을 보장하지 않습니다.'
    },
    { 구분: '현장 검증', 내용: '실제 적재 전 전문가가 화물 강도, 중량중심, 고정재, 운송 규정을 확인해야 합니다.' }
  ];
  [
    ['안전고지', notice],
    ['요약', summary],
    ['적재계획', plan],
    ['제품목록', productRows],
    ['고정재', securing]
  ].forEach(([name, rows]) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '해당 항목 없음' }]);
    ws['!cols'] = Object.keys(rows[0] || { 내용: '' }).map(k => ({
      wch: Math.max(12, Math.min(48, k.length * 2 + 4))
    }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  XLSX.writeFile(wb, 'cubestow-loading-plan.xlsx');
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
