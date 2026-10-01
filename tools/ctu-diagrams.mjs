// CTU Code 해설용 정밀 도면(SVG)을 만든다. AI 그림과 달리 치수·각도·계수를 코드로 계산해 그린다.
// 사용: node tools/ctu-diagrams.mjs  → public/images/ctu/*.svg
// 치수: 20ft 일반 컨테이너 내부 5.90 × 2.35 × 2.39 m. 계수: CTU Code 5장 표(도로, 해상 A·B·C).
import { writeFile } from 'node:fs/promises';

const W = 1672,
  H = 941,
  FONT = "Pretendard, 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif";
const C = {
  ink: '#1d2a3a',
  muted: '#5f6b78',
  line: '#c9d2dc',
  wall: '#2f5aa8',
  wallFill: '#eef3fb',
  crate: '#d9a066',
  crateEdge: '#a8743a',
  red: '#d9482b',
  green: '#1f8a5b',
  blue: '#1f6fd1',
  amber: '#c98a00',
  strap: '#e4572e'
};
const svg = body =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}">
<defs>
  ${['red', 'green', 'blue', 'strap', 'ink'].map(k => `<marker id="a-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${C[k]}"/></marker>`).join('')}
</defs>
<rect width="${W}" height="${H}" fill="#ffffff"/>
${body}
</svg>
`;
const text = (x, y, s, { size = 22, weight = 600, fill = C.ink, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;
const arrow = (x1, y1, x2, y2, color, { width = 5, both = false } = {}) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C[color]}" stroke-width="${width}" marker-end="url(#a-${color})"${both ? ` marker-start="url(#a-${color})"` : ''}/>`;
const rect = (x, y, w, h, { fill = 'none', stroke = C.ink, sw = 2, rx = 0, dash = '' } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
const crate = (x, y, w, h) =>
  `${rect(x, y, w, h, { fill: C.crate, stroke: C.crateEdge, sw: 3 })}<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${C.crateEdge}" stroke-width="2"/><line x1="${x + w}" y1="${y}" x2="${x}" y2="${y + h}" stroke="${C.crateEdge}" stroke-width="2"/>`;
const panel = (x, y, w, h, title) =>
  `${rect(x, y, w, h, { fill: '#fbfcfd', stroke: C.line, sw: 2, rx: 16 })}${text(x + 24, y + 42, title, { size: 26, weight: 800 })}`;

// 1) 5장 가속도: 옆·위에서 본 방향 + 운송별 계수 막대
function accelerations() {
  const s = 62, // px per m
    L = 5.9 * s,
    Hc = 2.39 * s,
    Wc = 2.35 * s;
  const sx = 70,
    sy = 150;
  let b = panel(30, 30, 620, 880, '방향 (20ft 컨테이너, 실제 비율)');
  // 옆에서 본 모습
  b += text(sx, sy - 20, '옆에서 본 모습', { size: 20, fill: C.muted });
  b += rect(sx, sy, L, Hc, { fill: C.wallFill, stroke: C.wall, sw: 5 });
  b += text(sx + 8, sy + Hc + 30, '앞벽', { size: 18, fill: C.muted });
  b += text(sx + L - 8, sy + Hc + 30, '문', { size: 18, fill: C.muted, anchor: 'end' });
  b += crate(sx + L / 2 - 0.6 * s, sy + Hc - 1.0 * s, 1.2 * s, 1.0 * s);
  b += arrow(sx + L / 2 - 1.6 * s, sy + 0.55 * s, sx + L / 2 + 1.6 * s, sy + 0.55 * s, 'red', { both: true });
  b += text(sx + L / 2, sy + 0.55 * s - 14, '종방향(앞뒤)', { size: 20, fill: C.red, anchor: 'middle' });
  b += arrow(sx + L + 40, sy + 20, sx + L + 40, sy + Hc - 10, 'blue');
  b += text(sx + L + 54, sy + Hc / 2, '수직', { size: 20, fill: C.blue });
  b += text(sx + L + 54, sy + Hc / 2 + 24, '하방', { size: 20, fill: C.blue });
  // 위에서 본 모습
  const py = sy + Hc + 110;
  b += text(sx, py - 20, '위에서 본 모습', { size: 20, fill: C.muted });
  b += rect(sx, py, L, Wc, { fill: C.wallFill, stroke: C.wall, sw: 5 });
  b += crate(sx + L / 2 - 0.6 * s, py + Wc / 2 - 0.5 * s, 1.2 * s, 1.0 * s);
  b += arrow(sx + L + 40, py + 10, sx + L + 40, py + Wc - 10, 'green', { both: true });
  b += text(sx + L + 54, py + Wc / 2 - 4, '횡방향', { size: 20, fill: C.green });
  b += text(sx + L + 54, py + Wc / 2 + 20, '(좌우)', { size: 20, fill: C.green });
  b += text(sx, py + Wc + 50, '종방향과 횡방향은 따로 계산합니다(§5.3).', { size: 19, weight: 500, fill: C.muted });
  b += text(sx, py + Wc + 78, '수직 하방은 화물을 바닥에 누르는 최소 값입니다.', {
    size: 19,
    weight: 500,
    fill: C.muted
  });

  // 운송별 계수 막대
  const modes = [
    ['도로', 0.8, 0.5, 1.0],
    ['해상 A', 0.3, 0.5, 0.5],
    ['해상 B', 0.3, 0.7, 0.3],
    ['해상 C', 0.4, 0.8, 0.2]
  ];
  const bx = 690,
    by = 30;
  b += panel(bx, by, 952, 880, '가속도 계수 (g의 배수, CTU Code 5장 표)');
  const chartX = bx + 150,
    chartY = by + 120,
    unit = 300; // 1.0 g = 300 px
  // 눈금
  for (let v = 0; v <= 1.0001; v += 0.2) {
    const x = chartX + v * unit;
    b += `<line x1="${x}" y1="${chartY - 10}" x2="${x}" y2="${chartY + 640}" stroke="${C.line}" stroke-width="${v === 0 ? 2 : 1}"/>`;
    b += text(x, chartY - 18, `${v.toFixed(1)}g`, { size: 16, weight: 500, fill: C.muted, anchor: 'middle' });
  }
  const rows = [
    ['종방향(앞)', 'red'],
    ['횡방향', 'green'],
    ['수직 하방*', 'blue']
  ];
  modes.forEach(([name, lon, tr, vz], i) => {
    const y0 = chartY + 10 + i * 160;
    b += text(chartX - 20, y0 + 52, name, { size: 24, weight: 800, anchor: 'end' });
    [lon, tr, vz].forEach((v, k) => {
      const y = y0 + k * 40;
      b += `<rect x="${chartX}" y="${y}" width="${v * unit}" height="30" fill="${C[rows[k][1]]}" rx="4"/>`;
      b += text(chartX + v * unit + 10, y + 23, `${v.toFixed(1)}`, { size: 19, weight: 700, fill: C[rows[k][1]] });
    });
  });
  // 범례
  const lx = chartX + 420;
  rows.forEach(([label, color], k) => {
    b += `<rect x="${lx}" y="${chartY + 20 + k * 36}" width="22" height="22" rx="3" fill="${C[color]}"/>`;
    b += text(lx + 32, chartY + 38 + k * 36, label, { size: 19, weight: 600 });
  });
  b += text(bx + 30, by + 830, '* 종방향을 고정할 때 함께 쓰는 수직 하방 값. 횡방향 고정 때는 모두 1.0g입니다.', {
    size: 17,
    weight: 500,
    fill: C.muted
  });
  b += text(bx + 30, by + 858, '해상은 종방향 앞뒤가 같은 값이고, 도로의 뒤쪽은 0.5g입니다.', {
    size: 17,
    weight: 500,
    fill: C.muted
  });
  return svg(b);
}

// 2) 부속서 7 §4: 직접 래싱 각도, 톱오버 래싱, 전도 조건
function lashing() {
  let b = '';
  const s = 120; // px per m
  // 패널 1: 직접 래싱
  b += panel(30, 30, 520, 880, '직접 래싱');
  const fx = 70,
    fy = 760,
    cw = 1.2 * s,
    ch = 1.4 * s,
    cx = 290 - cw / 2;
  b += `<line x1="${fx}" y1="${fy}" x2="${fx + 440}" y2="${fy}" stroke="${C.wall}" stroke-width="6"/>`;
  b += crate(cx, fy - ch, cw, ch);
  const ang = 45 * (Math.PI / 180),
    top = [cx, fy - ch + 30],
    run = (ch - 30) / Math.tan(ang),
    anchor = [cx - run, fy];
  b += `<line x1="${top[0]}" y1="${top[1]}" x2="${anchor[0]}" y2="${anchor[1]}" stroke="${C.strap}" stroke-width="8"/>`;
  b += `<circle cx="${anchor[0]}" cy="${anchor[1]}" r="9" fill="${C.ink}"/>`;
  const r = 70;
  b += `<path d="M ${anchor[0] + r} ${fy} A ${r} ${r} 0 0 0 ${anchor[0] + r * Math.cos(ang)} ${fy - r * Math.sin(ang)}" fill="none" stroke="${C.ink}" stroke-width="2.5"/>`;
  b += text(anchor[0] + r + 8, fy - 18, 'α', { size: 26, weight: 700 });
  b += text(fx, 120, '화물의 고정점과 바닥 고정점을', { size: 20, weight: 500 });
  b += text(fx, 148, '바로 잇습니다. 힘을 CTU 구조로', { size: 20, weight: 500 });
  b += text(fx, 176, '직접 넘기며, 능력은 MSL에 비례.', { size: 20, weight: 500 });
  b += text(fx, 230, '미끄럼 방지 각도 α = 30°~60°', { size: 22, weight: 800, fill: C.strap });
  b += text(fx, 262, '사전장력은 MSL의 50% 이하', { size: 20, weight: 600, fill: C.muted });
  b += text(fx, 290, '가장 약한 요소만큼만 믿습니다', { size: 20, weight: 600, fill: C.muted });
  b += text(fx, 820, '그림의 α = 45° (§4.3.2)', { size: 18, weight: 500, fill: C.muted });

  // 패널 2: 톱오버 래싱
  b += panel(576, 30, 520, 880, '톱오버(타이다운) 래싱');
  const gx = 616,
    gy = 760,
    tx = 836 - cw / 2;
  b += `<line x1="${gx}" y1="${gy}" x2="${gx + 440}" y2="${gy}" stroke="${C.wall}" stroke-width="6"/>`;
  b += crate(tx, gy - ch, cw, ch);
  const aL = [tx - 90, gy],
    aR = [tx + cw + 90, gy];
  b += `<polyline points="${aL[0]},${aL[1]} ${tx},${gy - ch} ${tx + cw},${gy - ch} ${aR[0]},${aR[1]}" fill="none" stroke="${C.strap}" stroke-width="8" stroke-linejoin="round"/>`;
  b += `<circle cx="${aL[0]}" cy="${aL[1]}" r="9" fill="${C.ink}"/><circle cx="${aR[0]}" cy="${aR[1]}" r="9" fill="${C.ink}"/>`;
  b += arrow(tx + cw / 2, gy - ch - 90, tx + cw / 2, gy - ch - 14, 'blue', { width: 6 });
  b += text(tx + cw / 2 + 16, gy - ch - 52, 'FV ≈ 1.8 × 사전장력', { size: 20, weight: 700, fill: C.blue });
  b += text(gx, 120, '화물 위로 넘겨 양쪽 바닥에 겁니다.', { size: 20, weight: 500 });
  b += text(gx, 148, '사전장력이 화물을 바닥에 눌러', { size: 20, weight: 500 });
  b += text(gx, 176, '마찰을 키웁니다(마찰 고정).', { size: 20, weight: 500 });
  b += text(gx, 230, '추가 고정력 Fsec = FV · μ', { size: 22, weight: 800, fill: C.strap });
  b += text(gx, 262, '예) STF 4kN → FV 7.2kN, μ 0.3 → 약 2.2kN', { size: 18, weight: 600, fill: C.muted });
  b += text(gx, 290, '무거운 화물은 톱오버만으로 막기 어렵습니다', { size: 18, weight: 600, fill: C.muted });
  b += text(gx, 820, '수직 래싱 기준 (§4.2.7)', { size: 18, weight: 500, fill: C.muted });

  // 패널 3: 전도 조건
  b += panel(1122, 30, 520, 880, '전도(넘어짐) 조건');
  const hx = 1162,
    hy = 760,
    bw = 0.8 * s,
    bh = 1.9 * s,
    bxx = 1382 - bw / 2;
  b += `<line x1="${hx}" y1="${hy}" x2="${hx + 440}" y2="${hy}" stroke="${C.wall}" stroke-width="6"/>`;
  b += crate(bxx, hy - bh, bw, bh);
  const cg = [bxx + bw / 2, hy - bh / 2];
  b += `<circle cx="${cg[0]}" cy="${cg[1]}" r="12" fill="#fff" stroke="${C.ink}" stroke-width="3"/><path d="M${cg[0]} ${cg[1] - 12}A12 12 0 0 1 ${cg[0] + 12} ${cg[1]}L${cg[0]} ${cg[1]}Z M${cg[0]} ${cg[1] + 12}A12 12 0 0 1 ${cg[0] - 12} ${cg[1]}L${cg[0]} ${cg[1]}Z" fill="${C.ink}"/>`;
  const axis = [bxx + bw, hy];
  b += `<circle cx="${axis[0]}" cy="${axis[1]}" r="8" fill="${C.red}"/>`;
  b += text(axis[0] + 14, axis[1] + 30, '전도축', { size: 18, weight: 700, fill: C.red });
  b += `<line x1="${cg[0]}" y1="${cg[1]}" x2="${cg[0]}" y2="${hy}" stroke="${C.ink}" stroke-width="2" stroke-dasharray="6 5"/>`;
  b += `<line x1="${cg[0]}" y1="${hy - 16}" x2="${axis[0]}" y2="${hy - 16}" stroke="${C.ink}" stroke-width="2"/>`;
  b += text((cg[0] + axis[0]) / 2, hy - 26, 'b', { size: 22, weight: 800, anchor: 'middle' });
  b += text(cg[0] - 16, (cg[1] + hy) / 2, 'd', { size: 22, weight: 800, anchor: 'end' });
  b += arrow(cg[0] - 150, cg[1], cg[0] - 20, cg[1], 'red', { width: 6 });
  b += text(cg[0] - 150, cg[1] - 14, 'c · m · g', { size: 20, weight: 700, fill: C.red });
  b += arrow(cg[0] + 60, cg[1] - 70, cg[0] + 60, cg[1] + 30, 'blue', { width: 6 });
  b += text(cg[0] + 74, cg[1] - 30, 'cz · m · g', { size: 20, weight: 700, fill: C.blue });
  b += text(hx, 120, '아래 식이 참이면(같아도) 고정이 필요합니다.', { size: 20, weight: 500 });
  b += text(hx, 170, 'c · d ≥ cz · b', { size: 30, weight: 800, fill: C.strap });
  b += text(hx, 210, '무게중심이 가운데면 높이/폭 ≥ cz/c', { size: 19, weight: 600, fill: C.muted });
  b += text(hx, 246, '도로 앞 1.25 · 도로 좌우 2.0', { size: 19, weight: 700 });
  b += text(hx, 274, '해상 C 좌우 1.25 · 해상 C 앞뒤 0.5', { size: 19, weight: 700 });
  b += text(hx, 820, '그림: 폭 0.8m × 높이 1.9m 화물 (§4.3.1)', { size: 18, weight: 500, fill: C.muted });
  return svg(b);
}

// 3) 부속서 7 §3: 종방향 무게중심과 5%·10% 범위, 60/50 어림 규칙
function centerOfGravity() {
  const s = 220, // px per m
    L = 5.9 * s,
    Hc = 2.39 * s * 0.42; // 높이는 그림 공간 때문에 줄여 그림(길이 방향 위치만 정확)
  const x0 = (W - L) / 2;
  let b = '';
  b += text(x0, 62, '종방향 무게중심 (20ft 내부 길이 5.90m, 길이 방향 실제 비율)', { size: 26, weight: 800 });
  const scene = (y, items, title) => {
    let g = text(x0, y - 16, title, { size: 22, weight: 800 });
    g += rect(x0, y, L, Hc, { fill: C.wallFill, stroke: C.wall, sw: 5 });
    // 5%·10% 범위
    const mid = x0 + L / 2;
    g += `<rect x="${mid - 0.1 * L}" y="${y + 4}" width="${0.2 * L}" height="${Hc - 8}" fill="#fff3cf"/>`;
    g += `<rect x="${mid - 0.05 * L}" y="${y + 4}" width="${0.1 * L}" height="${Hc - 8}" fill="#dff3e7"/>`;
    g += `<line x1="${mid}" y1="${y}" x2="${mid}" y2="${y + Hc}" stroke="${C.ink}" stroke-width="2" stroke-dasharray="8 6"/>`;
    let sum = 0,
      mom = 0;
    for (const [from, len, mass, h] of items) {
      g += crate(x0 + from * s, y + Hc - h * s * 0.42, len * s, h * s * 0.42);
      g += text(x0 + (from + len / 2) * s, y + Hc - h * s * 0.42 + 28, `${mass}t`, {
        size: 20,
        weight: 800,
        anchor: 'middle'
      });
      sum += mass;
      mom += mass * (from + len / 2);
    }
    const d = mom / sum,
      off = ((d - 2.95) / 5.9) * 100,
      cx = x0 + d * s,
      ok = Math.abs(off) <= 5,
      col = ok ? C.green : Math.abs(off) <= 10 ? C.amber : C.red;
    g += `<line x1="${cx}" y1="${y - 6}" x2="${cx}" y2="${y + Hc + 6}" stroke="${col}" stroke-width="4"/>`;
    g += `<circle cx="${cx}" cy="${y + Hc + 22}" r="13" fill="#fff" stroke="${col}" stroke-width="4"/>`;
    g += text(cx, y + Hc + 62, `무게중심 ${d.toFixed(2)}m · 중앙에서 ${off >= 0 ? '+' : ''}${off.toFixed(1)}%`, {
      size: 21,
      weight: 800,
      fill: col,
      anchor: 'middle'
    });
    g += text(x0, y + Hc + 30, '앞벽', { size: 18, weight: 600, fill: C.muted });
    g += text(x0 + L, y + Hc + 30, '문', { size: 18, weight: 600, fill: C.muted, anchor: 'end' });
    return { g, d, off, sum };
  };
  // 위: 원문 부록 4 예시와 같은 결과(18.5t, d ≈ 2.85m)가 되도록 배치
  const a = scene(
    130,
    [
      [0.0, 1.2, 4.0, 1.8],
      [1.2, 1.4, 4.5, 1.6],
      [2.6, 1.4, 4.0, 1.6],
      [4.0, 1.9, 6.0, 1.2]
    ],
    '고르게: 중앙 5% 안 (양호)'
  );
  const bScene = scene(
    500,
    [
      [0.0, 1.2, 6.0, 1.8],
      [1.2, 1.4, 6.5, 1.6],
      [2.6, 1.4, 4.0, 1.6],
      [4.0, 1.9, 2.0, 1.2]
    ],
    '앞쪽으로 치우침: 10% 밖 (위험)'
  );
  b += a.g + bScene.g;
  // 범례
  const ly = 846;
  b += `<rect x="${x0}" y="${ly - 18}" width="26" height="20" fill="#dff3e7" stroke="${C.line}"/>`;
  b += text(x0 + 36, ly, '중앙 ±5% (양호)', { size: 19, weight: 600 });
  b += `<rect x="${x0 + 230}" y="${ly - 18}" width="26" height="20" fill="#fff3cf" stroke="${C.line}"/>`;
  b += text(x0 + 266, ly, '±10% (주의)', { size: 19, weight: 600 });
  b += text(
    x0,
    ly + 40,
    '어림 규칙: 길이 절반 구간에 화물 총질량의 60%가 넘게 몰리지 않게 합니다(§3.1.4). 높이는 줄여 그렸고 길이 방향 위치는 실제 비율입니다.',
    {
      size: 19,
      weight: 600,
      fill: C.muted
    }
  );
  return { svg: svg(b), a, b: bScene };
}

const cg = centerOfGravity();
await writeFile('public/images/ctu/accelerations.svg', accelerations());
await writeFile('public/images/ctu/lashing-and-tipping.svg', lashing());
await writeFile('public/images/ctu/center-of-gravity.svg', cg.svg);
console.log(
  'cog scenes',
  [cg.a, cg.b].map(x => `${x.sum}t d=${x.d.toFixed(2)} off=${x.off.toFixed(1)}%`)
);
