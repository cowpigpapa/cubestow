import { test, expect } from '@playwright/test';

// 테스트는 운영 Supabase(방문자 수·알고리즘 점검 기록)에 쓰지 않는다.
test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, route => route.abort());
});

const openMenu = (page, name) => page.locator('details.menu>summary', { hasText: name }).click();
async function loadSample(page, number = 1) {
  await openMenu(page, '불러오기');
  await page.getByRole('button', { name: '샘플', exact: true }).click();
  await expect(page.getByRole('heading', { name: '샘플 시나리오 선택' })).toBeVisible();
  await page.locator(`[data-sample="${number}"]`).click();
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
  await page.locator('[data-sample-filter="원통"]').click();
  await expect(page.locator('#sampleDialog [data-sample]')).toHaveCount(3);
  await page.locator('[data-sample="16"]').click();
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

test('CTU Code guide opens inside the app', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'CTU Code' }).click();
  await expect(page.locator('#ctuDialog')).toHaveAttribute('open', '');
  await expect(page.getByRole('heading', { name: 'CTU Code란?' })).toBeVisible();
  await expect(page.getByText('Cubestow의 현재 반영 범위')).toBeVisible();
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
  await expect(page.locator('#canvasWrap + #stats')).toHaveCount(1);
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

test('footer keeps professional contrast and aligns the visitor counter', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('.site-footer'),
    workspace = page.locator('.workspace'),
    visitors = page.locator('.site-footer .visitor-count'),
    style = await footer.evaluate(e => getComputedStyle(e).backgroundColor),
    workBox = await workspace.boundingBox(),
    footerBox = await footer.boundingBox(),
    visitorBox = await visitors.boundingBox();
  expect(style).toBe('rgb(16, 21, 18)');
  expect(Math.abs(workBox.x + workBox.width - (visitorBox.x + visitorBox.width))).toBeLessThanOrEqual(20);
  expect(Math.abs(footerBox.y + footerBox.height / 2 - (visitorBox.y + visitorBox.height / 2))).toBeLessThanOrEqual(1);
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
  await page.locator('[data-sample="13"]').click();
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
  await page.locator('[data-sample="13"]').click();
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
  const link = page.locator('.topbar nav a[href="#samples"]');
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
  await expect(page).toHaveURL(/#samples$/);
  await expect(page.locator('#samplesView')).toBeVisible();
});

test('the header menu stays visible on phones and every item fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  const nav = page.locator('.topbar nav');
  await expect(nav).toBeVisible();
  // 다섯 메뉴가 모두 화면 안에 들어오고 가로 스크롤이 생기지 않는다(적재 플래너는 로고로 간다).
  const fit = await nav.evaluate(el => ({
    items: [...el.children].map(c => {
      const b = c.getBoundingClientRect();
      return [b.left, b.right];
    }),
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth
  }));
  expect(fit.items).toHaveLength(5);
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
  await page.locator('.topbar nav a[href="#samples"]').click();
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
  await page.locator('.topbar nav a[href="#library"]').click();
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(page.locator('#planner')).toBeHidden();
  await expect(page.locator('.topbar nav a[href="#library"]')).toHaveClass(/active/);
  // 공식 원문은 IMO 배포 링크로만 건다(파일을 다시 올리지 않음).
  await expect(page.locator('.lib-card[href*="imo.org"]')).toHaveCount(4);
  await expect(page.locator('#libraryView')).toContainText('사전 서면 허가 없이 복제할 수 없습니다');
  // 해설을 열고 자료실로 돌아온다.
  await page.locator('a.lib-doc[href="#library/qlg-c"]').click();
  await expect(page).toHaveURL(/#library\/qlg-c$/);
  await expect(page.locator('.lib-article h2')).toHaveText('빠른 래싱 가이드 C — Cubestow가 쓰는 표');
  await expect(page.locator('.lib-article')).toContainText('6.1t');
  await page.locator('.lib-crumb a').click();
  await expect(page.locator('.lib-doc')).toHaveCount(4);
  // 주소로 바로 열어도 되고, 샘플 결과·플래너와 서로 바뀐다.
  await page.goto('/#library/anchor-points');
  await expect(page.locator('.lib-article h2')).toContainText('고정점');
  await page.locator('.topbar nav a[href="#samples"]').click();
  await expect(page.locator('#samplesView')).toBeVisible();
  await expect(page.locator('#libraryView')).toBeHidden();
  await page.locator('.topbar .brand').click();
  await expect(page.locator('#planner')).toBeVisible();
  await expect(page.locator('#samplesView')).toBeHidden();
  await expect(page.locator('#libraryView')).toBeHidden();
  // CTU Code 창에서도 자료실로 간다.
  await page.click('#ctuButton');
  await page.locator('#ctuDialog a[href="#library"]').click();
  await expect(page.locator('#ctuDialog')).not.toBeVisible();
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
  await page.locator('[data-sample="1"]').click();
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
  await page.locator('[data-sample="6"]').click();
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
