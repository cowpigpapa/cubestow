import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// 테스트는 운영 Supabase(방문자 수·알고리즘 점검 기록)에 쓰지 않는다.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, route => route.abort());
});

const openMenu = (page, name) => page.locator('details.menu>summary', { hasText: name }).click();
// 샘플 창: 대표 셋 아래 "전체 샘플" 이 접혀 있으므로 펼친 뒤 고른다.
async function pickSample(page, number) {
  const all = page.locator('#sampleAll');
  if (!(await all.evaluate(d => d.open))) await all.locator('summary').click();
  await page.locator(`[data-sample="${number}"]`).click();
}
async function loadSample(page, number = 1) {
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: '샘플', exact: true }).click();
  await expect(page.getByRole('heading', { name: '샘플 시나리오 선택' })).toBeVisible();
  await pickSample(page, number);
  await expect(page.locator('#loadedCount')).not.toHaveText('—', { timeout: 20000 });
}

test('algorithm policy opens inside the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '알고리즘 정책' }).click();
  await expect(page.getByRole('heading', { name: '알고리즘 정책과 한계' })).toBeVisible();
  await expect(page.locator('#policyDialog')).toHaveAttribute('open', '');
});

test('user guide opens inside the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '사용 가이드' }).click();
  await expect(page.locator('#guideDialog')).toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'Cubestow 사용 가이드' })).toBeVisible();
});

test('sample picker lists twenty scenarios and filters them by category', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: '샘플', exact: true }).click();
  await expect(page.locator('#sampleDialog [data-sample]')).toHaveCount(20);
  await expect(page.locator('#sampleDialog')).toContainText('혼합 화물');
  await expect(page.locator('#sampleDialog')).toContainText('양문형 냉장고');
  // 전체 목록은 접혀 있다 - 펼쳐야 분류 단추가 보인다
  await page.locator('#sampleAll > summary').click();
  await page.locator('[data-sample-filter="원통"]').click();
  await expect(page.locator('#sampleDialog [data-sample]')).toHaveCount(3);
  await pickSample(page, 16);
  await expect(page.locator('#containerType')).toHaveValue('40ft');
  await expect(page.locator('#transportMode')).toHaveValue('sea');
  await expect(page.locator('#loadedCount')).toHaveText('24개', { timeout: 30000 });
});

test('file import lets the user load only or start simulation', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: 'Excel / CSV' }).click();
  await expect(page.locator('#importDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#importDialog #downloadTemplate')).toBeVisible();
  await page.locator('#fileInput').setInputFiles('test-projects/03-single-large.csv');
  await expect(page.getByRole('heading', { name: '파일 불러오기 완료' })).toBeVisible();
  await expect(page.getByRole('button', { name: '불러오기만' })).toBeVisible();
  await expect(page.getByRole('button', { name: '시뮬레이션 실행', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '불러오기만' }).click();
  await expect(page.locator('#productCount')).toContainText('1개 품목');
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: 'Excel / CSV' }).click();
  await page.locator('#fileInput').setInputFiles('test-projects/03-single-large.csv');
  await page.locator('#messageDialog').getByRole('button', { name: '시뮬레이션 실행', exact: true }).click();
  await expect(page.locator('#loadedCount')).toHaveText(/\d+개/, { timeout: 20000 });
  await expect(page.locator('#containerTabs .page-label')).toHaveText('1 / 2');
});

test('product list title and mobile layout do not wrap or overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  // 빈 프로젝트는 결과 탭부터 보이므로 입력 탭으로 간다
  await page.getByRole('tab', { name: '입력' }).click();
  const title = page.locator('.collapsible-head strong'),
    count = page.locator('#productCount');
  await expect(title).toHaveText('제품 목록');
  await expect(title).toHaveCSS('white-space', 'nowrap');
  await expect(count).toBeVisible();
  const positions = await page.locator('.collapsible-head').evaluate(el => {
    const heading = el.querySelector('strong'),
      meta = el.querySelector('#productCount');
    return {
      titleBottom: heading.getBoundingClientRect().bottom,
      countTop: meta.getBoundingClientRect().top,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    };
  });
  expect(positions.countTop).toBeGreaterThanOrEqual(positions.titleBottom);
  expect(positions.scrollWidth).toBe(positions.clientWidth);
});

test('the algorithm policy holds the CTU Code scope and the CTU Code menu opens the reference library', async ({
  page
}) => {
  await page.goto('/');
  // 상단 메뉴: 사용 가이드 · 알고리즘 정책 · 샘플 결과 · CTU Code (CTU Code 팝업 단추는 없다)
  await expect(page.locator('#ctuButton')).toHaveCount(0);
  await expect(page.locator('.topbar nav a[href="/library/ctu-code"]')).toHaveText('CTU Code');
  await page.getByRole('button', { name: '알고리즘 정책' }).click();
  const policy = page.locator('#policyDialog');
  await expect(policy.locator('summary', { hasText: 'CTU Code 반영 범위' })).toBeVisible();
  await policy.locator('summary', { hasText: 'CTU Code 반영 범위' }).click();
  await expect(policy).toContainText('빠른 래싱 가이드 C 표와 고른 고정 조건');
  await policy.locator('a[href="/library/ctu-code"]').click();
  await expect(policy).not.toBeVisible();
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('.lib-head h2')).toHaveText('CTU Code');
});

test('validation warning uses the in-app notice dialog', async ({ page }) => {
  await page.goto('/');
  await page.locator('#productName').fill('');
  await page.locator('#addProduct').click();
  await expect(page.locator('#messageDialog')).toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: '제품 정보를 확인해 주세요' })).toBeVisible();
  // 틀린 칸을 하나씩 짚어 주고, 닫으면 첫 번째 틀린 칸에 커서를 둔다
  await expect(page.locator('#messageText')).toContainText('제품명을 입력하세요');
  await expect(page.locator('#messageText')).toContainText('개당 중량은 0보다 커야 합니다');
  await page.locator('#messageConfirm').click();
  await expect(page.locator('#productName')).toBeFocused();
});

test('admin controls stay hidden before login', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#adminButton')).toBeHidden();
});

test('login offers social, email and guest options', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '로그인' }).click();
  await expect(page.getByRole('button', { name: 'Google로 계속하기' })).toBeVisible();
  await expect(page.locator('#microsoftLogin')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '인증번호 받기' })).toBeVisible();
  await expect(page.locator('#emailOtp')).toBeHidden();
  await expect(page.locator('.guest-save-note')).toContainText('현재 브라우저');
});

test('beta safety notice sits in the header and expands to the full warning', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.topbar .safety-notice')).toContainText('작업 검토용 베타');
  await page.locator('.topbar .safety-notice summary').click();
  await expect(page.locator('.topbar .safety-notice')).toContainText('현장 전문가가 검증');
  await expect(page.locator('.result-panel .safety-notice')).toHaveCount(0);
});

test('metrics follow the 3D view and dense sections collapse', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#simulate')).toHaveCount(0);
  await expect(page.locator('.control-panel #containerType')).toHaveCount(0);
  // 컨테이너 규격은 실행 버튼 옆에 있고, 선택지에 치수와 최대 중량이 함께 보인다.
  await expect(page.locator('.run-group .select-button').first()).toContainText(
    '20ft Dry (5.90 × 2.35 × 2.39 m · 최대 28.2 t)'
  );
  await expect(page.locator('.simulation-config-bar #transportMode')).toHaveValue('combined');
  await expect(page.locator('#toggleBands')).toHaveCount(0);
  await expect(page.locator('.result-header #recalculateOptions')).toBeVisible();
  // 3D 바로 아래 결과 첫 줄, 그다음 지표 카드
  await expect(page.locator('#canvasWrap + #resultHeadline + #stats')).toHaveCount(1);
  await expect(page.locator('#balanceCard + .loading-plan')).toHaveCount(1);
  await expect(page.locator('#securingPanel')).not.toHaveAttribute('open', '');
  await expect(page.locator('.loading-plan + #securingPanel')).toHaveCount(1);
  await expect(page.locator('.loading-plan')).toHaveCSS('border-top-style', 'solid');
  for (const control of ['#toggleProducts', '#securingPanel .collapse-state', '#toggleSequence']) {
    await expect(page.locator(control)).toHaveCSS('border-radius', '999px');
    await expect(page.locator(control)).toHaveCSS('min-height', '30px');
    await expect(page.locator(control)).toHaveCSS('font-size', '12px');
    await expect(page.locator(control)).toHaveCSS('font-weight', '700');
  }
  await loadSample(page);
  const products = page.locator('.product-list-card');
  await expect(products).toHaveClass(/expanded/);
  await expect(page.locator('#toggleProducts')).toHaveText('접기');
  await expect(page.locator('#toggleProducts')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#productList')).toHaveCSS('overflow-y', 'visible');
  await page.locator('#toggleProducts').click();
  await expect(products).not.toHaveClass(/expanded/);
  await expect(page.locator('#toggleProducts')).toHaveText('펼치기');
  await expect(page.locator('#toggleProducts')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#productList')).toHaveCSS('overflow-y', 'auto');
  await expect(page.locator('#toggleSequence')).toHaveText('펼치기');
  await expect(page.locator('#toggleSequence')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#toggleSequence').click();
  await expect(page.locator('.loading-plan')).toHaveClass(/expanded/);
  await expect(page.locator('#toggleSequence')).toHaveText('접기');
  await expect(page.locator('#toggleSequence')).toHaveAttribute('aria-expanded', 'true');
  const securing = page.locator('#securingPanel');
  await expect(securing).not.toHaveAttribute('open', '');
  await securing.locator('summary').click();
  await expect(securing).toHaveAttribute('open', '');
});

test('guest project saves, reloads, and recalculates automatically', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await expect(page.locator('#loadedCount')).toHaveText('36개', { timeout: 20000 });
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('textbox', { name: '저장 이름' }).fill('E2E 자동 계산');
  await page.getByRole('button', { name: '이 이름으로 저장' }).click();
  await expect(page.locator('#saveState')).toHaveText('브라우저 저장됨');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '현재 프로젝트에 저장할까요?' })).toBeVisible();
  await expect(page.getByRole('button', { name: '다른 이름으로 저장' })).toBeVisible();
  await page.getByRole('button', { name: '취소' }).click();
  await page.getByRole('button', { name: '새 프로젝트' }).click();
  await expect(page.locator('#loadedCount')).toHaveText('—');
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: '저장 목록' }).click();
  await page.locator('[data-open]').filter({ hasText: 'E2E 자동 계산' }).click();
  await expect(page.locator('#loadedCount')).toHaveText('36개', { timeout: 20000 });
  await expect(page.locator('#simulationStatus')).toBeHidden();
  await expect(page.locator('#calcTime')).toContainText('계산');
  await expect(page.locator('#containerCount')).toHaveText('1대');
});

test('weight balance, view presets and printable work instruction work together', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await expect(page.locator('#balanceCard')).toBeVisible();
  await expect(page.locator('#frontRearBalance')).not.toHaveText('—');
  const cog = page.getByRole('button', { name: '무게중심', exact: true });
  await cog.click();
  await expect(cog).toHaveClass(/active/);
  await expect(cog).toHaveAttribute('aria-pressed', 'true');
  await cog.click();
  await expect(cog).not.toHaveClass(/active/);
  for (const name of ['문 기준', '좌측면', '우측면', '상면', '3D']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveClass(/active/);
  }
  await page.getByRole('button', { name: '우측면', exact: true }).click();
  await page.getByRole('button', { name: '보기 초기화' }).click();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveClass(/active/);
  await expect(page.locator('#fieldResultButton')).toHaveCount(0);
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#exportPdf').click();
  await expect(page.locator('#messageDialog')).toContainText('현장 확인');
  await page.locator('#messageConfirm').click();
  const report = await popupPromise;
  await report.waitForLoadState();
  await expect(report.getByRole('button', { name: '인쇄 / PDF 저장' })).toBeVisible();
  await expect(report.getByText('현장 작업 기록')).toBeVisible();
  await expect(report.getByText('실제 적재 수량')).toBeVisible();
  // 화면 결과 요약과 같은 안전 판정·자동 평가·축하중 추정이 PDF에도 들어간다
  await expect(report.getByRole('heading', { name: '안전 판정과 자동 평가' })).toBeVisible();
  await expect(report.locator('.verdict')).toContainText(/자동 평가 (양호|주의|재검토 필요)/);
  await expect(report.getByRole('heading', { name: '도로 축하중 추정' })).toBeVisible();
  await expect(report.getByText('차량 총중량')).toBeVisible();
  await report.close();
});

test('CTU pre-check and compression status render after simulation', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await expect(page.locator('#ctuConcentration')).not.toHaveText('—');
  await expect(page.locator('#ctuVertical')).not.toHaveText('—');
  await expect(page.locator('#compressionStatus')).not.toHaveText('—');
});

test('simulation result does not move the view controls', async ({ page }) => {
  await page.goto('/');
  const view = page.getByRole('button', { name: '문 기준', exact: true }),
    before = await view.boundingBox();
  await loadSample(page);
  const after = await view.boundingBox(),
    divider = await page.locator('#planner').evaluate(e => {
      const s = getComputedStyle(e, '::after');
      return {
        bottom: parseFloat(s.bottom),
        left: parseFloat(s.left),
        display: s.display,
        marginBottom: parseFloat(getComputedStyle(e).marginBottom)
      };
    });
  expect(after.x).toBe(before.x);
  await expect(page.locator('#simulationStatus')).toBeHidden();
  expect(divider).toEqual({ bottom: 16, left: 430, display: 'block', marginBottom: 12 });
});

test('one run button, view controls inside the 3D view and an XYZ axis toggle', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: /시뮬레이션 실행/ })).toHaveCount(1);
  await expect(page.locator('#canvasWrap .result-control-row #viewIso')).toBeVisible();
  await expect(page.locator('#canvasWrap .axis-legend')).toHaveCount(0);
  await expect(page.locator('#canvasHint')).toHaveCount(0);
  await expect(page.locator('.result-kicker')).toHaveCount(0);
  await loadSample(page);
  await expect(page.locator('#viewAxes')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#viewAxes').click();
  await expect(page.locator('#viewAxes')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#viewAxes b')).toHaveText('OFF');
});

test('footer keeps professional contrast and shows visitors as one quiet line beside the version', async ({ page }) => {
  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(size);
    await page.goto('/');
    const footer = page.locator('.site-footer'),
      visitors = page.locator('.site-footer .footer-meta .footer-visitors'),
      version = page.locator('#appVersion'),
      made = page.locator('.footer-meta > span', { hasText: 'Made by' });
    expect(await footer.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(16, 21, 18)');
    await expect(visitors).toHaveCount(1);
    await expect(visitors).toContainText('오늘');
    await expect(visitors).toContainText('누적');
    const [versionBox, visitorBox, madeBox] = await Promise.all([
      version.boundingBox(),
      visitors.boundingBox(),
      made.boundingBox()
    ]);
    // 한 줄: 버전 → 방문자 → 제작자 순서로 같은 줄에 놓인다
    for (const box of [visitorBox, madeBox])
      expect(Math.abs(box.y + box.height / 2 - (versionBox.y + versionBox.height / 2))).toBeLessThanOrEqual(2);
    expect(visitorBox.x).toBeGreaterThan(versionBox.x + versionBox.width);
    expect(madeBox.x).toBeGreaterThan(visitorBox.x + visitorBox.width);
    // 배지 없이 버전과 같은 크기·색, 숫자는 고정폭
    const look = await visitors.evaluate(el => {
      const s = getComputedStyle(el),
        v = getComputedStyle(document.getElementById('appVersion')),
        inner = [...el.querySelectorAll('span')].map(x => getComputedStyle(x));
      return {
        sameSize: inner.every(x => x.fontSize === v.fontSize),
        sameColor: inner.every(x => x.color === v.color),
        badge: [s, ...inner].some(x => x.backgroundColor !== 'rgba(0, 0, 0, 0)' || x.borderTopWidth !== '0px'),
        tabular: [...el.querySelectorAll('b')].every(b =>
          getComputedStyle(b).fontVariantNumeric.includes('tabular-nums')
        )
      };
    });
    expect(look).toEqual({ sameSize: true, sameColor: true, badge: false, tabular: true });
  }
});

test('CTU sliding and tipping reference calculation appears in the securing panel', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await page.locator('#securingPanel').evaluate(panel => (panel.open = true));
  await expect(page.locator('#securingRecommendation')).toContainText('CTU Code 참고 계산');
  await expect(page.locator('#securingRecommendation')).toContainText('필요 억제력');
  await expect(page.locator('#securingCount')).toContainText('CTU 고정 필요');
});

test('container dropdown opens a smooth list and keeps the native select value in sync', async ({ page }) => {
  await page.goto('/');
  const box = page.locator('.select-box').filter({ has: page.locator('#containerType') });
  await box.locator('.select-button').click();
  await expect(box).toHaveClass(/open/);
  await box.getByRole('option', { name: /^40ft Dry/ }).click();
  await expect(page.locator('#containerType')).toHaveValue('40ft');
  await expect(box.locator('.select-button')).toHaveText('40ft Dry (12.03 × 2.35 × 2.39 m · 최대 26.7 t)');
  await expect(box).not.toHaveClass(/open/);
});

test('safety slider, segmented choices and securing chips drive the hidden values', async ({ page }) => {
  await page.goto('/');
  // 안전 수준 슬라이더: 단계마다 이름과 한 줄 설명이 바뀐다.
  await page.locator('#safetySlider').fill('2');
  await expect(page.locator('#safetyLevel')).toHaveValue('secure');
  await expect(page.locator('#safetyLabel')).toHaveText('CTU 기준 적용');
  await expect(page.locator('#safetyHint')).toContainText('화물이나 고정재로 막습니다');
  await expect(page.locator('#messageDialog')).toContainText('20~40초');
  await page.locator('#messageConfirm').click();
  await expect(page.locator('#messageDialog')).not.toHaveAttribute('open', '');
  await page.locator('#safetySlider').fill('1');
  await page.locator('#safetySlider').fill('2');
  await expect(page.locator('#messageDialog')).not.toHaveAttribute('open', '');
  await page.locator('#safetySlider').fill('0');
  await expect(page.locator('#safetyLevel')).toHaveValue('standard');
  await expect(page.locator('#safetyLabel')).toHaveText('적재량 우선');
  // 배치 방식과 운송 경로는 3칸 버튼이다. 폭 균형은 추천에 합쳐 선택지에 없다.
  await expect(page.locator('.segmented[data-for="preference"] button')).toHaveText(['추천', '붙여 싣기', '무게중심']);
  await page.locator('.segmented[data-for="preference"] button', { hasText: '붙여 싣기' }).click();
  await expect(page.locator('#preference')).toHaveValue('density');
  await page.locator('.segmented[data-for="transportMode"] button', { hasText: '해상' }).click();
  await expect(page.locator('#transportMode')).toHaveValue('sea');
  await expect(page.locator('.segmented[data-for="transportMode"] button[aria-checked="true"]')).toHaveText('해상');
  // 고정재 칩을 누르면 꺼지고 다시 누르면 켜진다.
  const nails = page.locator('#securingChips button[data-key="nails"]');
  await nails.click();
  await expect(nails).toHaveAttribute('aria-pressed', 'false');
  await nails.click();
  await expect(nails).toHaveAttribute('aria-pressed', 'true');
});

test('product name and group inputs suggest previously entered values', async ({ page }) => {
  await page.goto('/');
  for (const [name, group] of [
    ['산업용 펌프', '기계류'],
    ['제어반', '전기장비']
  ]) {
    await page.fill('#productName', name);
    await page.fill('#productGroup', group);
    await page.fill('#productWeight', '100');
    await page.fill('#productLength', '1000');
    await page.fill('#productWidth', '800');
    await page.fill('#productHeight', '700');
    await page.click('#addProduct');
  }
  await page.reload();
  await page.locator('#productName').click();
  await page.keyboard.type('제');
  const suggestions = page.locator('.suggest-box.open li');
  await expect(suggestions).toHaveText(['제어반']);
  await suggestions.first().click();
  await expect(page.locator('#productName')).toHaveValue('제어반');
  await page.locator('#productGroup').click();
  await expect(page.locator('.suggest-box.open li')).toHaveText(['전기장비', '기계류']);
});

test('adding clears the form and a listed product can be edited in full', async ({ page }) => {
  await page.goto('/');
  const add = async (name, weight, l, w, h) => {
    await page.fill('#productName', name);
    await page.fill('#productWeight', weight);
    await page.fill('#productLength', l);
    await page.fill('#productWidth', w);
    await page.fill('#productHeight', h);
    await page.click('#addProduct');
  };
  await add('펌프', '420', '1200', '800', '900');
  await expect(page.locator('#productName')).toHaveValue('');
  await expect(page.locator('#productQty')).toHaveValue('1');
  await add('제어반', '180', '900', '600', '1100');
  await page.getByRole('button', { name: '펌프 수정' }).click();
  await expect(page.locator('#productLength')).toHaveValue('1200');
  await expect(page.locator('#recalculateOptions')).toBeDisabled();
  await expect(page.locator('.product-item.editing [data-qty-input]')).toBeDisabled();
  await expect(page.locator('.input-card')).toHaveClass(/editing/);
  await expect(page.locator('#addProduct')).toContainText('변경 내용 저장');
  await page.fill('#productLength', '1500');
  await page.fill('#productWeight', '500');
  await page.click('#addProduct');
  await expect(page.locator('.product-item').first()).toContainText('1500×800×900 mm · 500 kg');
  await expect(page.locator('.product-item')).toHaveCount(2);
  await expect(page.locator('.input-card')).not.toHaveClass(/editing/);
  await expect(page.locator('#productName')).toHaveValue('');
  await expect(page.getByRole('button', { name: /삭제/ })).toHaveCount(0);
  await page.getByRole('button', { name: '제어반 수정' }).click();
  await expect(page.locator('#inputHint')).toHaveText('제어반 수정 중');
  await expect(page.getByRole('button', { name: '제어반 삭제' })).toBeVisible();
  await expect(page.getByRole('button', { name: '펌프 삭제' })).toHaveCount(0);
  await page.getByRole('button', { name: '제어반 수정 취소' }).click();
  await expect(page.locator('#productName')).toHaveValue('');
  await expect(page.locator('#inputHint')).toHaveText('');
  await expect(page.locator('#inputHint')).toBeHidden();
  await expect(page.getByRole('button', { name: /삭제/ })).toHaveCount(0);
  await page.getByRole('button', { name: '제어반 수정' }).click();
  await page.getByRole('button', { name: '제어반 삭제' }).click();
  await expect(page.locator('.product-item')).toHaveCount(1);
  await expect(page.locator('.input-card')).not.toHaveClass(/editing/);
});

test('clicking a product input selects its value so typing replaces it', async ({ page }) => {
  await page.goto('/');
  await page.fill('#productName', '산업용 펌프');
  await page.fill('#productLength', '1200');
  await page.locator('#productGroup').click();
  await page.locator('#productName').click();
  await page.keyboard.type('제어반');
  await expect(page.locator('#productName')).toHaveValue('제어반');
  await page.locator('#productLength').click();
  await page.keyboard.type('900');
  await expect(page.locator('#productLength')).toHaveValue('900');
});

test('result cards share one title size and the load sequence header toggles the list', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  const sizes = await page.evaluate(() =>
    ['.balance-card h3', '.plan-head h2', '.securing-card>summary strong'].map(
      s => getComputedStyle(document.querySelector(s)).fontSize
    )
  );
  expect(new Set(sizes).size).toBe(1);
  await page.locator('.plan-head h2').click();
  await expect(page.locator('.loading-plan')).toHaveClass(/expanded/);
  await page.locator('.plan-head h2').click();
  await expect(page.locator('.loading-plan')).not.toHaveClass(/expanded/);
});

test('loading a sample after opening a saved project starts a new unsaved project', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('textbox', { name: '저장 이름' }).fill('드럼 적재');
  await page.getByRole('button', { name: '이 이름으로 저장' }).click();
  await expect(page.locator('#currentProjectName')).toHaveText('드럼 적재');
  await loadSample(page, 2);
  await expect(page.locator('#currentProjectName')).toHaveText('샘플 2 · 단일 규격 반복');
  await expect(page.locator('#saveState')).toHaveText('저장되지 않음');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '저장 이름' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '현재 프로젝트에 저장할까요?' })).toHaveCount(0);
});

test('changing inputs after a run blocks exports until the plan is recalculated', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await expect(page.locator('#exportPlan')).toBeEnabled();
  await page.locator('[data-qty-up="0"]').click();
  await expect(page.locator('#exportPlan')).toBeDisabled();
  await expect(page.locator('#exportPdf')).toBeDisabled();
  await page.click('#recalculateOptions');
  await expect(page.locator('#exportPlan')).toBeEnabled({ timeout: 30000 });
});

test('starting and cancelling an edit keeps a saved project saved', async ({ page }) => {
  await page.goto('/');
  await loadSample(page);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('textbox', { name: '저장 이름' }).fill('편집 확인');
  await page.getByRole('button', { name: '이 이름으로 저장' }).click();
  await expect(page.locator('#saveState')).toHaveText('브라우저 저장됨');
  await page.locator('.edit-product').first().click();
  await page.locator('.edit-product').first().click();
  await expect(page.locator('#saveState')).toHaveText('브라우저 저장됨');
});

test('a change made while a plan is calculating discards the stale result', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: '샘플', exact: true }).click();
  await pickSample(page, 13);
  await expect(page.locator('#simulationStatus')).toHaveClass(/busy/);
  await page.locator('[data-qty-up="0"]').click();
  await expect(page.locator('#simulationStatus')).toBeHidden({ timeout: 60000 });
  await expect(page.locator('#loadedCount')).toHaveText('—');
  await expect(page.locator('#recalculateOptions')).toContainText('다시 계산');
});

test('loading another sample while calculating recalculates for the new sample', async ({ page }) => {
  await page.goto('/');
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: '샘플', exact: true }).click();
  await pickSample(page, 13);
  await expect(page.locator('#simulationStatus')).toHaveClass(/busy/);
  await loadSample(page, 2).catch(() => {});
  await expect(page.locator('#loadedCount')).toHaveText('42개', { timeout: 60000 });
  await expect(page.locator('#currentProjectName')).toHaveText('샘플 2 · 단일 규격 반복');
});

test('result summary shows the safety verdict and field results compare with the plan', async ({ page }) => {
  await page.goto('/');
  await loadSample(page, 1);
  // 결과 요약: 안전 판정·꼭 필요한 고정재·확인할 항목이 지표 아래에 먼저 보인다.
  const summary = page.locator('#resultSummary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('안전 판정');
  // 안전 판정 한 줄에 자동 평가 등급도 함께 적는다
  await expect(summary.locator('.summary-verdict')).toContainText(/자동 평가 (양호|주의|재검토 필요)/);
  await expect(summary).toContainText('꼭 필요한 고정재');
  // 도로·복합 운송이면 축하중 추정(트랙터 앞축·뒤축·샤시 축·총중량)과 일반 제원 가정을 함께 보여 준다.
  const axle = summary.locator('.summary-axle');
  await expect(axle).toBeVisible();
  await expect(axle).toContainText('트랙터 앞축');
  await expect(axle).toContainText('샤시 축(2축)');
  await expect(axle).toContainText('차량 총중량');
  await expect(axle).toContainText('일반 제원 가정');
  // 자동 평가(규칙 기반): 등급과 항목이 결과 요약 아래에 보인다.
  const review = page.locator('#autoReview');
  await expect(review).toBeVisible();
  await expect(review).toContainText('자동 평가');
  await expect(review.locator('.auto-review-head strong')).toHaveText(/양호|주의|재검토 필요/);
  await expect(review.locator('li').first()).toBeVisible();
  // 판정 범위: 사전 검토용이며 CTU·도로 법규 적합 판정이 아니라고 적는다.
  await expect(review.locator('.auto-review-scope')).toContainText('사전 검토용');
  // 현장 결과를 기록하면 계획과의 차이를 보여 주고 프로젝트가 저장되지 않음 상태가 된다.
  await page.locator('#fieldPanel').evaluate(panel => (panel.open = true));
  await page.locator('#fieldLoaded').fill('30');
  await page.locator('#fieldContainers').fill('2');
  await page.locator('#fieldNotes').fill('문쪽 1열 재배치');
  await page.locator('#saveField').click();
  await expect(page.locator('#fieldCompare')).toContainText('실제 30개');
  await expect(page.locator('#fieldCompare')).toContainText('2대(계획 1대, +1)');
  await expect(page.locator('#fieldSummary')).toContainText('기록됨');
});

test('the product input can be folded and the whole left column hidden to widen the 3D view', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('loadwise.v3.ui.inputCollapsed');
    localStorage.removeItem('loadwise.v3.ui.panelHidden');
  });
  await page.reload();
  // 제품 데이터 입력칸 접기: 제목 옆 버튼. 접으면 입력칸과 추가 버튼이 숨는다.
  await page.locator('#toggleInput').click();
  await expect(page.locator('#manualPane')).toBeHidden();
  await expect(page.locator('#addProduct')).toBeHidden();
  await expect(page.locator('#toggleInput')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#toggleInput').click();
  await expect(page.locator('#manualPane')).toBeVisible();
  // 왼쪽 칸 전체 숨기기: 칸 경계 손잡이. 3D 화면이 넓어지고 상태를 기억한다.
  const before = await page.locator('#canvasWrap').boundingBox();
  await page.locator('#togglePanel').click();
  await expect(page.locator('#controlPanel')).toBeHidden();
  await expect
    .poll(async () => (await page.locator('#canvasWrap').boundingBox()).width)
    .toBeGreaterThan(before.width + 200);
  await page.reload();
  await expect(page.locator('#controlPanel')).toBeHidden();
  await page.locator('#togglePanel').click();
  await expect(page.locator('#controlPanel')).toBeVisible();
});

test('the sample results preview sits between the header and footer and compares the three safety levels', async ({
  page
}) => {
  await page.goto('/');
  const link = page.locator('.topbar nav a[href="/samples"]');
  await expect(link).toHaveText('샘플 결과');
  await link.click();
  await expect(page.locator('#samplesView')).toBeVisible();
  await expect(page.locator('#planner')).toBeHidden();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('.site-footer')).toBeVisible();
  await expect(link).toHaveClass(/active/);
  await expect(page.locator('#samplesView section.sv-sample')).toHaveCount(20);
  const first = page.locator('#samples-1');
  await expect(first.locator('.sv-col-head')).toHaveCount(3);
  await expect(first.locator('.sv-col-head').nth(2)).toContainText('CTU 기준 적용');
  await expect(first.locator('.sv-shot img').first()).toHaveAttribute(
    'src',
    /sample-results\/img\/s01-standard-1\.jpg/
  );
  // 그림을 누르면 정반대 대각선 캡처로 바뀌고, 다시 누르면 정면으로 돌아온다. 확대 창은 없다.
  const shot = first.locator('.sv-shot').first();
  await shot.click();
  await expect(shot.locator('img')).toHaveAttribute('src', /s01-standard-1-back\.jpg/);
  await expect(shot.locator('.sv-dir')).toHaveText('반대쪽');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await shot.click();
  await expect(shot.locator('img')).toHaveAttribute('src', /s01-standard-1\.jpg/);
  // 전체 반대쪽 보기는 모든 그림을 한 번에 바꾼다.
  await page.locator('#svFlipAll').click();
  await expect(page.locator('#samplesView .sv-shot.can-flip:not(.is-back)')).toHaveCount(0);
  await page.locator('#svFlipAll').click();
  await expect(page.locator('#samplesView .sv-shot.is-back')).toHaveCount(0);
  await page.locator('#svToolbar button[data-cat="원통"]').click();
  await expect(page.locator('#samplesView section.sv-sample:not([hidden])')).toHaveCount(3);
  // 고른 분류에 없는 번호 바로가기는 비활성으로 표시된다.
  await expect(page.locator('#svToolbar a[data-jump]:not(.is-off)')).toHaveCount(3);
  await expect(page.locator('#svToolbar a[data-jump="1"]')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('#svToolbar button[data-cat="전체"]').click();
  await expect(page.locator('#svToolbar a[data-jump].is-off')).toHaveCount(0);
  // 적재 플래너로 돌아오면 플래너가 다시 보이고, 예전 주소(sample-results.html)는 샘플 결과로 넘어간다.
  await page.locator('.topbar .brand').click();
  await expect(page.locator('#planner')).toBeVisible();
  await expect(page.locator('#samplesView')).toBeHidden();
  await page.goto('/sample-results.html');
  await expect(page).toHaveURL(/\/samples$/);
  await expect(page.locator('#samplesView')).toBeVisible();
});

test('the header menu stays visible on phones and every item fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  const nav = page.locator('.topbar nav');
  await expect(nav).toBeVisible();
  // 네 메뉴가 모두 화면 안에 들어오고 가로 스크롤이 생기지 않는다(적재 플래너는 로고로 간다).
  const fit = await nav.evaluate(el => ({
    items: [...el.children].map(c => {
      const b = c.getBoundingClientRect();
      return [b.left, b.right];
    }),
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(fit.items).toHaveLength(4);
  for (const [l, r] of fit.items) {
    expect(l).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(fit.width);
  }
  expect(fit.scroll).toBe(fit.width);
  // 로그인한 긴 이메일도 헤더 첫 줄에 들어간다: 로고는 왼쪽, 베타 안내는 로고 바로 오른쪽, 계정은 오른쪽 끝.
  await page.evaluate(() => {
    document.getElementById('accountButton').hidden = true;
    document.getElementById('accountMenu').hidden = false;
    document.getElementById('accountIdentity').textContent = 'someone.longname@example.com';
  });
  const head = await page.evaluate(() => {
    const b = s => document.querySelector(s).getBoundingClientRect();
    return {
      brand: b('.topbar .brand'),
      beta: b('.header-beta'),
      ident: b('#accountIdentity'),
      nav: b('.topbar nav'),
      width: document.documentElement.clientWidth
    };
  });
  expect(head.brand.left).toBeLessThan(30);
  expect(head.beta.left).toBeGreaterThan(head.brand.right);
  expect(head.beta.left - head.brand.right).toBeLessThan(30);
  expect(head.ident.right).toBeLessThanOrEqual(head.width);
  expect(head.ident.bottom).toBeLessThanOrEqual(head.nav.top);
  expect(head.ident.top).toBeLessThan(head.brand.bottom);
  // 이메일 글자는 계정 칸의 위아래 가운데에 있다.
  const pad = await page.locator('#accountIdentity').evaluate(el => {
    const b = el.getBoundingClientRect(),
      r = document.createRange();
    r.selectNodeContents(el);
    const t = r.getBoundingClientRect();
    return [t.top - b.top, b.bottom - t.bottom];
  });
  expect(Math.abs(pad[0] - pad[1])).toBeLessThanOrEqual(2);
  // 계정 버튼 삼각형은 불러오기와 같은 CSS 삼각형이고, 말줄임된 이메일에 가리지 않게 오른쪽에 붙는다.
  const tri = sel =>
    page.locator(sel).evaluate(el => {
      const s = getComputedStyle(el, '::after');
      return [s.borderLeftWidth, s.borderTopWidth, s.content];
    });
  expect(await tri('#accountIdentity')).toEqual(await tri('.load-menu>summary'));
  expect(await page.locator('#accountIdentity').evaluate(el => getComputedStyle(el, '::after').position)).toBe(
    'absolute'
  );
  await expect(page.locator('meta[name="format-detection"]')).toHaveAttribute('content', /email=no/);
  await page.locator('.topbar nav a[href="/samples"]').click();
  await expect(page.locator('#samplesView')).toBeVisible();
  // 샘플 결과의 고정 툴바는 두 줄 헤더 바로 아래에 붙는다.
  await expect(page.locator('#samplesView section.sv-sample')).toHaveCount(20);
  await page.evaluate(() => window.scrollTo(0, 1500));
  await expect
    .poll(() =>
      page.evaluate(() =>
        Math.round(
          document.querySelector('#svToolbar').getBoundingClientRect().top -
            document.querySelector('.topbar').getBoundingClientRect().bottom
        )
      )
    )
    .toBe(0);
});

test('algorithm flags leave out product names and stop at ten a day per browser', async ({ page }) => {
  const bodies = [];
  await page.route(/record_algorithm_flag/, async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('loadwise.v3.algorithmFlags');
    localStorage.removeItem('loadwise.v3.algorithmFlagsSent');
  });
  // 예전 대기열처럼 제품명·제품군이 들어간 기록 12건을 넣는다.
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      window.loadwiseStorage.recordAlgorithmFlag({
        appVersion: 'test',
        engine: 'test',
        settings: {},
        flags: [{ code: 'inner-void' }],
        input: {
          products: [{ name: '비밀 제품', group: '영업', shape: 'box', l: 1000, w: 800, h: 600, weight: 100, qty: 3 }]
        },
        fingerprint: `e2e${String(i).padStart(13, '0')}`
      });
      await new Promise(r => setTimeout(r, 120));
    }
  });
  await expect.poll(() => bodies.length).toBe(10);
  await page.waitForTimeout(500);
  expect(bodies).toHaveLength(10);
  for (const body of bodies) {
    const product = body.p_input.products[0];
    expect(product.name).toBeUndefined();
    expect(product.group).toBeUndefined();
    expect(product.weight).toBe(100);
  }
  // 하루 한도를 넘은 기록은 대기열에 남아 다음 날 보낸다.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('loadwise.v3.algorithmFlags')).length)).toBe(2);
});

test('securing conditions set friction, lashing MSL and lashing points for the lashing count', async ({ page }) => {
  await page.goto('/');
  const summary = page.locator('#securingConditionsSummary');
  await expect(summary).toHaveText('마찰 0.3 · 래싱 2t · 고정점 ISO 최소');
  await page.locator('#securingConditions>summary').click();
  await page.locator('#securingFriction').selectOption('wood-pallet');
  await page.locator('#lashingMsl').selectOption('4000');
  await page.locator('#anchorRating').selectOption('rated');
  await expect(summary).toHaveText('마찰 0.45 · 래싱 4t · 고정점 표시 확인');
  // 고르는 동안에는 열려 있고, 바깥을 누르면 닫힌다(다시 "고정 조건"을 누르지 않아도 된다).
  await expect(page.locator('#securingConditions')).toHaveJSProperty('open', true);
  await page.locator('#productName').click();
  await expect(page.locator('#securingConditions')).toHaveJSProperty('open', false);
  // 계산하면 고정재 계획에 쓴 조건이 기준 문장에 나온다.
  await loadSample(page, 3);
  await page.locator('#securingPanel').evaluate(panel => (panel.open = true));
  await expect(page.locator('#securingRecommendation')).toContainText('마찰 0.45');
  await expect(page.locator('#securingRecommendation')).toContainText('래싱 MSL 4,000daN');
  await expect(page.locator('#securingRecommendation')).toContainText('고정점 표시 확인');
});

test('the library links the official CTU Code sources and opens Korean commentaries between the header and footer', async ({
  page
}) => {
  await page.goto('/');
  await page.locator('.topbar nav a[href="/library/ctu-code"]').click();
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('#planner')).toBeHidden();
  await expect(page.locator('.topbar nav a[href="/library/ctu-code"]')).toHaveClass(/active/);
  // 공식 원문은 IMO 배포 링크로만 건다(파일을 다시 올리지 않음).
  await expect(page.locator('.lib-card[href*="imo.org"]')).toHaveCount(5);
  // 빠른 래싱 가이드도 IMO 공식 파일로만 링크한다(다른 곳의 사본은 걸지 않는다).
  await expect(page.locator('#libraryView a[href*="mariterm"]')).toHaveCount(0);
  await expect(page.locator('#libraryView')).toContainText('사전 서면 허가 없이 복제할 수 없습니다');
  // 해설을 열고 CTU Code 목록으로 돌아온다.
  await page.locator('a.lib-doc[href="/library/ctu-code/qlg-c"]').click();
  await expect(page).toHaveURL(/\/library\/ctu-code\/qlg-c$/);
  await expect(page.locator('.lib-article h2')).toHaveText('빠른 래싱 가이드 C — Cubestow가 쓰는 표');
  await expect(page.locator('.lib-article')).toContainText('6.1t');
  await page.locator('.lib-crumb a').click();
  // 해설 16개 + 번역 준비 중 카드 2개. 원문별 구간에 공식 원문과 해설이 함께 있다.
  await expect(page.locator('a.lib-doc')).toHaveCount(16);
  const section = title => page.locator('.lib-section').filter({ has: page.locator('h3', { hasText: title }) });
  await expect(section('CTU Code 본문').locator('a.lib-card[href$="1497.pdf"]')).toHaveCount(1);
  await expect(section('CTU Code 본문').locator('a.lib-doc[href="/library/ctu-code/a7-securing"]')).toHaveCount(1);
  await expect(section('CTU Code 정보자료').locator('a.lib-doc[href="/library/ctu-code/qlg-c"]')).toHaveCount(1);
  await expect(section('CTU Code 정보자료').locator('a.lib-card[href$="1498.pdf#page=65"]')).toHaveCount(1);
  // 한국어 번역은 원문 카드 바로 옆에 준비 중 카드로, 설명은 아래 안내에
  await expect(
    section('CTU Code 본문').locator('a.lib-card[href$="1497.pdf"] + .lib-soon', { hasText: '본문 한국어 번역' })
  ).toHaveCount(1);
  await expect(
    section('CTU Code 정보자료').locator('a.lib-card[href$="1498.pdf"] + .lib-soon', {
      hasText: '정보자료 한국어 번역'
    })
  ).toHaveCount(1);
  await expect(section('안내')).toContainText('IMO에 게시 허가를 요청해 두었습니다');
  // 참고 자료는 법령·표준을 반영한 Cubestow 글
  await page.goto('/library/ctu-code/kr-road');
  await expect(page.locator('.lib-article')).toContainText('500만원 이하의 과태료');
  await expect(page.locator('.lib-article')).toContainText('16.7m');
  await page.goto('/library/ctu-code');
  // 참고 자료는 Cubestow가 쓴 글만(외부 사이트 링크 없음), 해설 진행표는 없음
  await expect(section('참고 자료').locator('a.lib-card')).toHaveCount(0);
  await expect(section('참고 자료').locator('a.lib-doc')).toHaveCount(2);
  await expect(page.locator('.lib-plan')).toHaveCount(0);
  // 안내 문구는 문장마다 줄을 바꾼다
  await expect(page.locator('.lib-head p br')).toHaveCount(2);
  // 구조 안내: 1497·1498·1531 비교와, 참조 항목마다 해설 링크가 있는 지도
  await page.locator('.lib-head a[href="/library/ctu-code/structure"]').click();
  await expect(page.locator('.lib-article h2')).toContainText('1497·1498·1531');
  const map = page.locator('.lib-article table').filter({ hasText: 'Cubestow 반영' });
  await expect(map.locator('tbody tr')).toHaveCount(16);
  await expect(map.locator('a[href="/library/ctu-code/ch5-accel"]')).toHaveText('완료');
  // 전체 요약: 본문 13장·부속서 10개·정보자료 10개가 중요도와 함께 나온다
  await page.goto('/library/ctu-code/ctu-overview');
  await expect(page.locator('.lib-article h2')).toContainText('CTU Code 전체 요약');
  await expect(page.locator('.lib-item')).toHaveCount(33);
  await expect(page.locator('.lib-item[data-level="3"]').first()).toContainText('꼭 알아야 함');
  await page.goto('/library/ctu-code/structure');
  await map.locator('a[href="/library/ctu-code/a7-securing"]').click();
  await expect(page.locator('.lib-article')).toContainText('cx,y · d ≥ cz · b');
  await page.locator('.lib-crumb a').click();
  // 주소로 바로 열어도 되고, 샘플 결과·플래너와 서로 바뀐다.
  await page.goto('/library/ctu-code/anchor-points');
  await expect(page.locator('.lib-article h2')).toContainText('고정점');
  await page.locator('.topbar nav a[href="/samples"]').click();
  await expect(page.locator('#samplesView')).toBeVisible();
  await expect(page.locator('#libraryView')).toBeHidden();
  await page.locator('.topbar .brand').click();
  await expect(page.locator('#planner')).toBeVisible();
  await expect(page.locator('#samplesView')).toBeHidden();
  await expect(page.locator('#libraryView')).toBeHidden();
  // 알고리즘 정책 창에서도 CTU Code 메뉴로 간다.
  await page.click('#policyButton');
  await page.locator('#policyDialog a[href="/library/ctu-code"]').click();
  await expect(page.locator('#policyDialog')).not.toBeVisible();
  await expect(page.locator('#libraryView')).toBeVisible();
});

test('the empty planner offers two starts: a sample or my own products', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const empty = page.locator('#emptyState');
  await expect(empty).toBeVisible();
  // "최적의" 같은 보장할 수 없는 표현은 쓰지 않는다.
  await expect(empty).toContainText('제품을 추가하면 적재 배치를 계산합니다');
  await expect(empty).not.toContainText('최적');
  await page.locator('#emptyInput').click();
  await expect(page.locator('#productName')).toBeFocused();
  await page.locator('#emptySample').click();
  await expect(page.locator('#sampleDialog')).toBeVisible();
  await pickSample(page, 1);
  await expect(page.locator('#loadedCount')).not.toHaveText('—', { timeout: 20000 });
  await expect(empty).toBeHidden();
  // 선택 입력 표시
  await expect(page.locator('.form-grid label', { hasText: '제품군' })).toContainText('(선택)');
});

test('units sit inside the inputs right after the number and optional marks sit beside the titles', async ({
  page
}) => {
  await page.goto('/');
  const weight = page.getByLabel('개당 중량 (kg)'),
    suffix = page.locator('#productWeight + .unit-suffix');
  // 비어 있으면 예시 숫자 뒤에 흐린 단위, 입력하면 입력한 숫자 바로 뒤에 단위(100kg)
  await expect(suffix).toBeVisible();
  const colors = () =>
    weight.evaluate(i => ({
      text: getComputedStyle(i).color,
      example: getComputedStyle(i, '::placeholder').color,
      unit: getComputedStyle(i.nextElementSibling).color
    }));
  // 예시는 숫자와 단위가 같은 흐린 색, 입력한 값은 숫자와 단위가 같은 글자색
  let c = await colors();
  expect(c.unit).toBe(c.example);
  expect(c.example).not.toBe(c.text);
  await weight.fill('100');
  await expect(suffix).toHaveText('kg');
  c = await colors();
  expect(c.unit).toBe(c.text);
  const gap = async () => {
    const [box, unit] = await Promise.all([weight.boundingBox(), suffix.boundingBox()]);
    return unit.x - box.x;
  };
  const short = await gap();
  await weight.fill('100000');
  expect(await gap()).toBeGreaterThan(short + 10);
  // 코드로 값을 넣을 때(제품 편집·초기화)도 단위가 따라간다
  await page.evaluate(() => {
    document.getElementById('productLength').value = 1200;
  });
  await expect(page.locator('#productLength').locator('xpath=..')).toHaveClass(/has-value/);
  await expect(page.getByLabel('길이 (mm)')).toHaveValue('1200');
  // (선택)은 제목과 같은 줄
  const title = page.locator('.field-title', { hasText: '제품군' });
  const [t, s] = await Promise.all([title.boundingBox(), title.locator('small').boundingBox()]);
  expect(s.y + s.height).toBeLessThanOrEqual(t.y + t.height + 1);
  expect(t.height).toBeLessThan(24);
});

test('products that cannot fit the chosen container are rejected before the calculation with a concrete reason', async ({
  page
}) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const dialog = page.locator('#messageDialog');
  // 20ft 폭 2,352mm보다 넓은 화물: 등록 단계에서 이유와 함께 막는다
  await page.fill('#productName', '넓은 기계');
  await page.fill('#productWeight', '500');
  await page.fill('#productLength', '2400');
  await page.fill('#productWidth', '2500');
  await page.fill('#productHeight', '1000');
  await page.click('#addProduct');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('컨테이너에 들어갈 수 없는 제품');
  await expect(dialog).toContainText('짧은 변 2,400mm');
  await page.locator('#messageConfirm').click();
  await expect(page.locator('#productCount')).toContainText('0개 품목');
  // 높이만 넘는 화물은 눕히기를 켜면 들어간다
  await page.fill('#productLength', '2000');
  await page.fill('#productWidth', '1000');
  await page.fill('#productHeight', '2500');
  await page.click('#addProduct');
  await expect(dialog).toContainText('높이 2,500mm');
  await expect(dialog).toContainText('눕혀서 적재 가능이 꺼져 있음');
  await page.locator('#messageConfirm').click();
  await page.check('#allowRotation');
  await page.click('#addProduct');
  await expect(page.locator('#productCount')).toContainText('1개 품목');
});

test('the summary cards separate this container from the shipment total', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#emptySample').click();
  await pickSample(page, 6);
  await expect(page.locator('#loadedCount')).not.toHaveText('—', { timeout: 120000 });
  await expect(page.locator('#containerCount')).toHaveText(/^[2-9]대$/);
  await expect(page.locator('.stats span', { hasText: '이 컨테이너 수량' })).toBeVisible();
  await expect(page.locator('#loadedDetail')).toContainText('대 합계');
  await expect(page.locator('#loadedDetail')).toContainText('전체 100개');
  await expect(page.locator('#weightDetail')).toContainText('대 합계');
  await expect(page.locator('#weightDetail')).toContainText('대당 허용');
});

test('the securing conditions explain the lashing-point default and the option hints sit in one aligned row on desktop', async ({
  page
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/');
  // 고정점 기본값(ISO 최소) 설명이 선택 상자 바로 아래에 있다
  await page.locator('#securingConditions>summary').click();
  const note = page.locator('.securing-conditions-panel .condition-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('ISO 1496-1 최소값');
  await expect(note).toContainText('표시 확인함');
  await page.keyboard.press('Escape');
  // 안전 수준·배치 방식·운송 경로 설명 상자는 같은 줄에 같은 높이로 놓인다(3줄 높이, 세로 가운데)
  const [a, b, c] = await Promise.all([
    page.locator('.safety-hint').boundingBox(),
    page.locator('.pref-field .segment-hint').boundingBox(),
    page.locator('.route-field .segment-hint').boundingBox()
  ]);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(b.height - c.height)).toBeLessThanOrEqual(1);
  expect(a.height).toBeGreaterThanOrEqual(74);
  // 고정재 줄은 설명 상자 아래 한 줄 전체
  const sec = await page.locator('.securing-field').boundingBox();
  expect(sec.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(sec.width).toBeGreaterThan(a.width * 2);
});

test('the safety step labels move the slider and the route hint shows its accelerations on a second line', async ({
  page
}) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const stops = page.locator('.slider-stops span');
  await stops.nth(2).click();
  await expect(page.locator('#safetySlider')).toHaveValue('2');
  await expect(page.locator('#safetyLevel')).toHaveValue('secure');
  await expect(page.locator('#safetyLabel')).toHaveText('CTU 기준 적용');
  // CTU 기준은 처음 고를 때 한 번 안내한다
  await expect(page.locator('#messageDialog')).toHaveAttribute('open', '');
  await page.locator('#messageConfirm').click();
  await stops.nth(0).click();
  await expect(page.locator('#safetySlider')).toHaveValue('0');
  await expect(page.locator('#safetyLevel')).toHaveValue('standard');
  // 운송 경로 설명: 문장 한 줄, 가속도 한 줄
  await page.locator('.segmented[data-for="transportMode"] button', { hasText: '육상' }).click();
  const hint = page.locator('.route-field .segment-hint');
  await expect(hint).toHaveText(/도로 기준으로 계산합니다\s*\(좌우 0\.5g, 급정거 0\.8g\)/);
  const lines = await hint.evaluate(el => el.innerText.split('\n').filter(Boolean).length);
  expect(lines).toBe(2);
});

test('long dialogs fit inside a short phone screen and scroll inside', async ({ page }) => {
  // iOS Safari 는 100vh 가 보이는 높이보다 커서 팝업 위가 주소창 뒤로 숨었다. 보이는 높이 안에 들어와야 한다.
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/');
  for (const [button, dialog] of [
    ['#guideButton', '#guideDialog'],
    ['#policyButton', '#policyDialog']
  ]) {
    await page.locator(button).click();
    const box = await page.locator(dialog).boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(640);
    await page.keyboard.press('Escape');
  }
});

test('a scroll-to-top button appears after scrolling down a long page and takes the reader back up', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/library/ctu-code/ctu-overview');
  const top = page.locator('button.to-top');
  // 맨 위에서는 보이지 않는다
  await expect(top).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 3000));
  await expect(top).toBeVisible();
  await expect(top).toHaveAttribute('aria-label', '맨 위로');
  // 맨 아래에서는 바닥글 위에 서서 방문자 수와 겹치지 않는다
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => {
      const [b, f] = await Promise.all([top.boundingBox(), page.locator('.site-footer').boundingBox()]);
      return b.y + b.height <= f.y;
    })
    .toBe(true);
  await top.click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5);
  await expect(top).toBeHidden();
});

test('on a wide screen the scroll-to-top button sits beside the document and lines up with its bottom', async ({
  page
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/library/ctu-code/ctu-overview');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const top = page.locator('button.to-top');
  await expect(top).toBeVisible();
  await expect
    .poll(async () => {
      const [b, a] = await Promise.all([top.boundingBox(), page.locator('.lib-article').boundingBox()]);
      // 글 카드 오른쪽 바깥에 간격을 두고 서고, 아래 끝선이 맞는다
      return b.x >= a.x + a.width + 8 && Math.abs(b.y + b.height - (a.y + a.height)) <= 2;
    })
    .toBe(true);
});

test('the sample dialog leads with three purpose-picked samples and folds the full list', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#emptySample').click();
  const featured = page.locator('#sampleFeatured [data-featured-sample]');
  await expect(featured).toHaveCount(3);
  await expect(featured.nth(0)).toContainText('처음 써보기');
  // 전체 20개는 접혀 있다
  await expect(page.locator('#sampleList [data-sample="20"]')).toBeHidden();
  await featured.nth(0).click();
  await expect(page.locator('#currentProjectName')).toHaveText('샘플 2 · 단일 규격 반복', { timeout: 60000 });
  // 결과 첫 줄: 실렸는지 · 몇 대 · 자동 평가를 크게
  const headline = page.locator('#resultHeadline');
  await expect(headline).toBeVisible({ timeout: 60000 });
  await expect(headline).toContainText('전량 적재');
  await expect(headline).toContainText(/대/);
  await expect(headline).toContainText(/자동 평가 (양호|주의|재검토 필요)/);
});

// 관리자 점검 기록: 가짜 관리자 세션과 가짜 Supabase 응답으로만 돌린다(운영 데이터에 닿지 않는다).
test('an admin can replay an algorithm flag with its products and conditions, and still download or delete flags', async ({
  page
}) => {
  const now = Math.floor(Date.now() / 1000),
    b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url'),
    user = {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'admin@example.com'
    },
    session = {
      access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp: now + 3600, role: 'authenticated' })}.sig`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: 'e2e-refresh',
      user
    };
  let rows = [
    {
      id: 42,
      created_at: '2026-09-20T01:00:00Z',
      app_version: '1.1.90',
      engine: 'ep-lex-portfolio-2026.09.01',
      settings: {
        container: '40hc',
        safety: 'secure',
        preference: 'density',
        transportMode: 'sea',
        securing: {
          airbag: false,
          filler: true,
          nails: false,
          lashing: true,
          friction: 'rubber',
          lashingMsl: 4000,
          anchors: 'rated'
        }
      },
      flags: [{ code: 'inner-void' }],
      input: {
        products: [
          {
            shape: 'box',
            l: 1200,
            w: 1000,
            h: 900,
            weight: 350,
            qty: 12,
            rotate: false,
            fragile: false,
            maxTopLoadKg: 800
          },
          {
            shape: 'box',
            l: 1100,
            w: 900,
            h: 800,
            weight: 200,
            qty: 6,
            rotate: true,
            fragile: true,
            maxTopLoadKg: null
          },
          {
            shape: 'cylinder',
            l: 900,
            w: 900,
            h: 1100,
            weight: 500,
            qty: 4,
            rotate: false,
            fragile: false,
            maxTopLoadKg: null
          }
        ]
      }
    },
    {
      id: 7,
      created_at: '2026-08-01T01:00:00Z',
      app_version: '1.0.3',
      engine: 'old',
      settings: { container: '53ft', optimization: 'volume', transportMode: 'road' },
      flags: [{ code: 'validation' }],
      input: {
        products: [
          { shape: 'box', l: 1000, w: 800, h: 600, weight: 100, qty: 3 },
          { shape: 'box', l: 1000, w: 0, h: 600, weight: 100, qty: 2 }
        ]
      }
    },
    {
      id: 9,
      created_at: '2026-08-02T01:00:00Z',
      app_version: '1.1.50',
      engine: 'x',
      settings: { container: '20ft', safety: 'strict', preference: 'auto', transportMode: 'combined' },
      flags: [{ code: 'thin-last' }],
      input: { products: [{ shape: 'box', l: 600, w: 400, h: 300, weight: 10, qty: 1 }] }
    }
  ];
  const deletes = [],
    projectWrites = [],
    json = (route, body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, route => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/is_admin')) return json(route, true);
    if (url.pathname.endsWith('/rpc/admin_user_stats')) return json(route, []);
    if (url.pathname.endsWith('/rpc/get_visit_counts')) return json(route, { today: 1, total: 2 });
    if (url.pathname.endsWith('/rest/v1/admin_users'))
      return json(route, [{ email: user.email, created_at: '2026-01-01T00:00:00Z' }]);
    if (url.pathname.endsWith('/rest/v1/algorithm_flags')) {
      if (request.method() === 'DELETE') {
        const id = Number(String(url.searchParams.get('id')).replace('eq.', ''));
        deletes.push(id);
        rows = rows.filter(r => r.id !== id);
        return route.fulfill({ status: 204, body: '' });
      }
      return json(route, rows);
    }
    if (url.pathname.endsWith('/rest/v1/projects')) {
      if (request.method() !== 'GET') projectWrites.push(request.method());
      return json(route, []);
    }
    if (url.pathname.includes('/rpc/')) return json(route, null);
    return route.abort();
  });
  await page.addInitScript(
    value => localStorage.setItem('sb-wejegdshcpqqqhhjbtox-auth-token', value),
    JSON.stringify(session)
  );
  await page.goto('/');
  const openAdmin = async () => {
    await page.locator('#accountMenu > summary').click();
    await page.locator('#adminButton').click();
    await expect(page.locator('#adminDialog')).toHaveJSProperty('open', true);
    await expect(page.locator('#algorithmFlagList tr')).toHaveCount(rows.length);
  };
  const flagRow = id => page.locator('#algorithmFlagList tr', { has: page.locator(`[data-flag-replay="${id}"]`) });
  await openAdmin();
  // 버튼 순서: 다시 계산 · JSON 내려받기 · 삭제
  await expect(flagRow(42).locator('button')).toHaveText(['이 조건으로 다시 계산', 'JSON 내려받기', '삭제']);

  // 0) 확인 창에서 취소하면 입력 화면도 관리자 창도 그대로다
  await flagRow(42).getByRole('button', { name: '이 조건으로 다시 계산' }).click();
  await expect(page.locator('#messageTitle')).toHaveText('이 조건으로 다시 계산할까요?');
  await page.locator('#messageCancel').click();
  await expect(page.locator('#adminDialog')).toHaveJSProperty('open', true);
  await expect(page.locator('#productList .product-item')).toHaveCount(0);
  await expect(page.locator('#containerType')).toHaveValue('20ft');
  await page.locator('#adminDialog').evaluate(d => d.close());
  await openAdmin();

  // 1) 구버전·일부 누락 기록: 오류 없이 불러오고, 옮기지 못한 것만 알린다
  await flagRow(7).getByRole('button', { name: '이 조건으로 다시 계산' }).click();
  const note = page.locator('#messageText');
  await expect(page.locator('#messageTitle')).toHaveText('이 조건으로 다시 계산할까요?');
  await expect(note).toContainText('이 기록은 v1.0.3 / 엔진 old에서 생성되었습니다.');
  await expect(note).toContainText('점검 제품 2: 치수나 무게가 없어 넣지 못했습니다.');
  await expect(note).toContainText('컨테이너: 알 수 없는 값(53ft)');
  await expect(note).toContainText('저장본은 바뀌지 않고, 원래 점검 기록도 그대로 남습니다');
  await expect(note).not.toContainText('안전 수준');
  await page.locator('#messageConfirm').click();
  await expect(page.locator('#adminDialog')).toHaveJSProperty('open', false);
  await expect(page.locator('#productList .product-item')).toHaveCount(1);
  await expect(page.locator('#productList')).toContainText('점검 제품 1');
  await expect(page.locator('#safetyLevel')).toHaveValue('standard');
  await expect(page.locator('#transportMode')).toHaveValue('road');
  await expect(page.locator('#loadedCount')).toHaveText('3개', { timeout: 20000 });
  // 저장 프로젝트와 연결을 끊은 새 작업으로 계산한다
  await expect(page.locator('#currentProjectName')).toHaveText('점검 기록 #7 다시 계산');

  // 2) 전체 기록: 제품 셋과 컨테이너·계산 조건·고정 조건이 모두 복원되고 계산이 실제로 돈다
  await openAdmin();
  await flagRow(42).getByRole('button', { name: '이 조건으로 다시 계산' }).click();
  await expect(note).toContainText('이 기록은 v1.1.90 / 엔진 ep-lex-portfolio-2026.09.01에서 생성되었습니다.');
  await expect(note).not.toContainText('그대로 옮기지 못한 항목');
  await page.locator('#messageConfirm').click();
  await expect(page.locator('#adminDialog')).toHaveJSProperty('open', false);
  await expect(page.locator('#productList .product-item strong')).toHaveText([
    '점검 제품 1',
    '점검 제품 2',
    '점검 제품 3'
  ]);
  await expect(page.locator('#containerType')).toHaveValue('40hc');
  await expect(page.locator('#safetyLevel')).toHaveValue('secure');
  await expect(page.locator('#preference')).toHaveValue('density');
  await expect(page.locator('#transportMode')).toHaveValue('sea');
  await expect(page.locator('#securingConditionsSummary')).toHaveText('마찰 0.6 · 래싱 4t · 고정점 표시 확인');
  expect(
    await page.evaluate(() => {
      const s = window.loadwiseProject.snapshot();
      return [
        s.securing,
        s.products.map(p => [p.l, p.w, p.h, p.weight, p.qty, p.rotate, p.fragile, p.maxTopLoadKg, p.shape])
      ];
    })
  ).toEqual([
    rows[0].settings.securing,
    rows[0].input.products.map(p => [p.l, p.w, p.h, p.weight, p.qty, p.rotate, p.fragile, p.maxTopLoadKg, p.shape])
  ]);
  await expect(page.locator('#loadedCount')).not.toHaveText('—', { timeout: 20000 });
  await expect(page.locator('#resultHeadline')).toBeVisible();
  // 다시 계산해도 원본 기록은 지우지 않고, 저장 프로젝트에도 쓰지 않는다
  expect(deletes).toEqual([]);
  expect(projectWrites).toEqual([]);

  // 3) JSON 내려받기와 삭제는 그대로 동작한다
  await openAdmin();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    flagRow(42).getByRole('button', { name: 'JSON 내려받기' }).click()
  ]);
  expect(download.suggestedFilename()).toBe('cubestow-algorithm-flag-42.json');
  const saved = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(saved.input.products).toHaveLength(3);
  await flagRow(9).getByRole('button', { name: '삭제' }).click();
  await page.locator('#messageConfirm').click();
  await expect(page.locator('#algorithmFlagList tr')).toHaveCount(2);
  expect(deletes).toEqual([9]);
});

// 주소 구조: /simulator · /samples · /library/ctu-code(/해설). 옛 # 주소는 새 주소로 옮긴다.
test('path addresses open each screen directly, move old hash links, and navigate without reloading', async ({
  page
}) => {
  test.setTimeout(60000);
  const missing = [];
  page.on('response', r => {
    if (r.status() === 404 && new URL(r.url()).origin === new URL(page.url() || 'http://x').origin)
      missing.push(r.url());
  });
  const canonical = () => page.locator('link[rel="canonical"]').getAttribute('href');

  // 깊은 주소로 바로 열어도 CSS·스크립트·작업자가 모두 뜬다
  await page.goto('/library/ctu-code/qlg-c');
  await expect(page.locator('#libraryView .lib-article h2')).toBeVisible();
  await expect(page.locator('#planner')).toBeHidden();
  await expect(page).toHaveTitle(/CTU Code · Cubestow/);
  expect(await canonical()).toBe('https://cubestow.onharu.app/library/ctu-code/qlg-c');
  await page.goto('/library/ctu-code');
  await expect(page.locator('#libraryView .lib-head h2')).toHaveText('CTU Code');
  await expect(page.locator('.topbar nav a[href="/library/ctu-code"]')).toHaveClass(/active/);
  expect(await canonical()).toBe('https://cubestow.onharu.app/library/ctu-code');
  await page.goto('/samples');
  await expect(page.locator('#samplesView')).toBeVisible();
  await expect(page).toHaveTitle(/샘플 결과 · Cubestow/);
  await page.goto('/simulator');
  await expect(page.locator('#planner')).toBeVisible();
  await expect(page.locator('#libraryView')).toBeHidden();
  expect(await canonical()).toBe('https://cubestow.onharu.app/');
  await loadSample(page, 2);
  await expect(page.locator('#loadedCount')).not.toHaveText('—');

  // /library 는 아직 목록 화면이 없어 CTU Code 로 보낸다. 모르는 주소는 플래너(/)로.
  await page.goto('/library');
  await expect(page).toHaveURL(/\/library\/ctu-code$/);
  await page.goto('/no-such-page');
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.locator('#planner')).toBeVisible();

  // 옛 # 주소(공유된 링크·즐겨찾기)는 새 주소로 옮긴다
  await page.goto('/#library/kr-road');
  await expect(page).toHaveURL(/\/library\/ctu-code\/kr-road$/);
  await expect(page.locator('#libraryView .lib-article')).toBeVisible();
  await page.goto('/#library');
  await expect(page).toHaveURL(/\/library\/ctu-code$/);
  await page.goto('/#samples');
  await expect(page).toHaveURL(/\/samples$/);
  await expect(page.locator('#samplesView')).toBeVisible();
  await page.goto('/sample-results.html');
  await expect(page).toHaveURL(/\/samples$/);

  // 메뉴·해설 링크는 새로고침 없이 바뀌고, 뒤로 가기로 돌아온다
  await page.goto('/');
  await page.evaluate(() => (window.__sameDocument = true));
  await page.locator('.topbar nav a[href="/library/ctu-code"]').click();
  await expect(page).toHaveURL(/\/library\/ctu-code$/);
  await page.locator('a.lib-doc[href="/library/ctu-code/qlg-c"]').click();
  await expect(page).toHaveURL(/\/library\/ctu-code\/qlg-c$/);
  await expect(page.locator('#libraryView .lib-article')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/library\/ctu-code$/);
  await expect(page.locator('#libraryView .lib-head')).toBeVisible();
  await page.locator('a.brand').click();
  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.locator('#planner')).toBeVisible();
  expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
  expect(missing).toEqual([]);
});

// 휴대폰·태블릿(한 줄 배치): 적재 플래너를 입력 / 결과 탭으로 나누고, 계산이 끝나면 결과 탭으로 넘어간다.
test('on a phone the planner splits into input and result tabs and shows the result after calculating', async ({
  page
}) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const tabs = page.locator('.mobile-tabs [role="tab"]'),
    inputTab = page.getByRole('tab', { name: '입력' }),
    resultTab = page.getByRole('tab', { name: '결과' });
  await expect(tabs).toHaveText(['입력', '결과']);
  // 빈 프로젝트는 결과 탭의 첫 화면(샘플 보기 · 직접 입력)부터 보인다
  await expect(resultTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#emptyState')).toBeVisible();
  await expect(page.locator('#controlPanel')).toBeHidden();
  // 직접 입력 → 입력 탭, 제품명 칸에 바로 쓸 수 있다
  await page.locator('#emptyInput').click();
  await expect(inputTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#productName')).toBeFocused();
  // 입력 탭: 제품 입력과 계산 조건, 실행 단추. 결과(3D·지표·순서)는 숨는다
  await expect(page.locator('.simulation-config-bar')).toBeVisible();
  await expect(page.locator('#recalculateOptions')).toBeVisible();
  await expect(page.locator('#canvasWrap')).toBeHidden();
  await expect(page.locator('.loading-plan')).toBeHidden();
  await resultTab.click();
  await expect(page.locator('#canvasWrap')).toBeVisible();
  await expect(page.locator('#controlPanel')).toBeHidden();
  await expect(page.locator('.simulation-config-bar')).toBeHidden();
  await inputTab.click();
  // 입력 탭에서 샘플을 불러와 계산하면 결과 탭으로 넘어가고 3D가 화면 안에 보인다
  await loadSample(page, 2);
  await expect(resultTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#resultHeadline')).toBeVisible();
  await expect(page.locator('.loading-plan')).toBeVisible();
  await expect
    .poll(() => page.locator('#canvasWrap').evaluate(el => Math.round(el.getBoundingClientRect().top)))
    .toBeLessThan(844);
  const canvas = await page.locator('#canvasWrap canvas:visible').first().boundingBox();
  expect(canvas.width).toBeGreaterThan(300);
  expect(canvas.height).toBeGreaterThan(150);
  // 탭은 화면에 고정하지 않는다(따라다니는 단추 없음)
  expect(await page.locator('.mobile-tabs').evaluate(el => getComputedStyle(el).position)).not.toMatch(/sticky|fixed/);

  // 넓은 화면에서는 탭이 없고 입력과 결과가 나란히 보인다
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.mobile-tabs')).toBeHidden();
  await expect(page.locator('#controlPanel')).toBeVisible();
  await expect(page.locator('#canvasWrap')).toBeVisible();
  await expect(page.locator('.simulation-config-bar')).toBeVisible();
});
