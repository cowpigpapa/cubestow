import {test,expect} from '@playwright/test';

const openMenu=(page,name)=>page.locator('details.menu>summary',{hasText:name}).click();
async function loadSample(page,number=1){
  await openMenu(page,'불러오기');await page.getByRole('button',{name:'샘플',exact:true}).click();
  await expect(page.getByRole('heading',{name:'샘플 시나리오 선택'})).toBeVisible();
  await page.locator(`[data-sample="${number}"]`).click();
  await expect(page.locator('#loadedCount')).not.toHaveText('—',{timeout:20000});
}

test('algorithm policy opens inside the app',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'알고리즘 정책'}).click();
  await expect(page.getByRole('heading',{name:'알고리즘 정책과 한계'})).toBeVisible();
  await expect(page.locator('#policyDialog')).toHaveAttribute('open','');
});

test('user guide opens inside the app',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'사용 가이드'}).click();
  await expect(page.locator('#guideDialog')).toHaveAttribute('open','');
  await expect(page.getByRole('heading',{name:'Cubestow 사용 가이드'})).toBeVisible();
});

test('sample picker lists twenty scenarios and filters them by category',async({page})=>{
  await page.goto('/');
  await openMenu(page,'불러오기');await page.getByRole('button',{name:'샘플',exact:true}).click();
  await expect(page.locator('#sampleDialog [data-sample]')).toHaveCount(20);
  await expect(page.locator('#sampleDialog')).toContainText('혼합 화물');
  await expect(page.locator('#sampleDialog')).toContainText('양문형 냉장고');
  await page.locator('[data-sample-filter="원통"]').click();
  await expect(page.locator('#sampleDialog [data-sample]')).toHaveCount(3);
  await page.locator('[data-sample="16"]').click();
  await expect(page.locator('#containerType')).toHaveValue('40ft');
  await expect(page.locator('#transportMode')).toHaveValue('sea');
  await expect(page.locator('#loadedCount')).toHaveText('24개',{timeout:30000});
});

test('file import lets the user load only or start simulation',async({page})=>{
  await page.goto('/');await openMenu(page,'불러오기');await page.getByRole('button',{name:'Excel / CSV'}).click();await expect(page.locator('#importDialog')).toHaveAttribute('open','');await expect(page.locator('#importDialog #downloadTemplate')).toBeVisible();
  await page.locator('#fileInput').setInputFiles('test-projects/03-single-large.csv');
  await expect(page.getByRole('heading',{name:'파일 불러오기 완료'})).toBeVisible();
  await expect(page.getByRole('button',{name:'불러오기만'})).toBeVisible();
  await expect(page.getByRole('button',{name:'시뮬레이션 실행',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'불러오기만'}).click();await expect(page.locator('#productCount')).toContainText('1개 품목');
  await openMenu(page,'불러오기');await page.getByRole('button',{name:'Excel / CSV'}).click();await page.locator('#fileInput').setInputFiles('test-projects/03-single-large.csv');
  await page.locator('#messageDialog').getByRole('button',{name:'시뮬레이션 실행',exact:true}).click();await expect(page.locator('#loadedCount')).toHaveText(/\d+개/,{timeout:20000});await expect(page.locator('#containerTabs .page-label')).toHaveText('1 / 2');
});

test('product list title and mobile layout do not wrap or overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  const title=page.locator('.collapsible-head strong'),count=page.locator('#productCount');
  await expect(title).toHaveText('제품 목록');await expect(title).toHaveCSS('white-space','nowrap');
  const positions=await page.locator('.collapsible-head').evaluate(el=>{const heading=el.querySelector('strong'),meta=el.querySelector('#productCount');return{titleBottom:heading.getBoundingClientRect().bottom,countTop:meta.getBoundingClientRect().top,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}});
  expect(positions.countTop).toBeGreaterThanOrEqual(positions.titleBottom);expect(positions.scrollWidth).toBe(positions.clientWidth);
});

test('CTU Code guide opens inside the app',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'CTU Code'}).click();
  await expect(page.locator('#ctuDialog')).toHaveAttribute('open','');
  await expect(page.getByRole('heading',{name:'CTU Code란?'})).toBeVisible();
  await expect(page.getByText('Cubestow의 현재 반영 범위')).toBeVisible();
});

test('validation warning uses the in-app notice dialog',async({page})=>{
  await page.goto('/');
  await page.locator('#productName').fill('');
  await page.locator('#addProduct').click();
  await expect(page.locator('#messageDialog')).toHaveAttribute('open','');
  await expect(page.getByRole('heading',{name:'제품 정보를 확인해 주세요'})).toBeVisible();
});

test('admin controls stay hidden before login',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#adminButton')).toBeHidden();
});

test('login offers social, email and guest options',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'로그인'}).click();
  await expect(page.getByRole('button',{name:'Google로 계속하기'})).toBeVisible();
  await expect(page.locator('#microsoftLogin')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'인증번호 받기'})).toBeVisible();
  await expect(page.locator('#emailOtp')).toBeHidden();
  await expect(page.locator('.guest-save-note')).toContainText('현재 브라우저');
});

test('beta safety notice sits in the header and expands to the full warning',async({page})=>{
  await page.goto('/');
  await expect(page.locator('.topbar .safety-notice')).toContainText('작업 검토용 베타');
  await page.locator('.topbar .safety-notice summary').click();await expect(page.locator('.topbar .safety-notice')).toContainText('현장 전문가가 검증');
  await expect(page.locator('.result-panel .safety-notice')).toHaveCount(0);
});

test('metrics follow the 3D view and dense sections collapse',async({page})=>{
  await page.goto('/');
  await expect(page.locator('#simulate')).toHaveCount(0);
  await expect(page.locator('.control-panel #containerType')).toHaveCount(0);
  await expect(page.locator('.simulation-config-bar #containerType')).toBeVisible();
  await expect(page.locator('.simulation-config-bar #transportMode')).toHaveValue('combined');
  await expect(page.locator('#toggleBands')).toHaveCount(0);
  await expect(page.locator('.result-header #recalculateOptions')).toBeVisible();
  await expect(page.locator('#canvasWrap + #stats')).toHaveCount(1);
  await expect(page.locator('#balanceCard + .loading-plan')).toHaveCount(1);
  await expect(page.locator('#securingPanel')).not.toHaveAttribute('open','');
  await expect(page.locator('.loading-plan + #securingPanel')).toHaveCount(1);
  await expect(page.locator('.loading-plan')).toHaveCSS('border-top-style','solid');
  for(const control of ['#toggleProducts','#securingPanel .collapse-state','#toggleSequence']){await expect(page.locator(control)).toHaveCSS('border-radius','999px');await expect(page.locator(control)).toHaveCSS('min-height','34px')}
  await loadSample(page);
  const products=page.locator('.product-list-card');await expect(products).toHaveClass(/expanded/);await expect(page.locator('#toggleProducts')).toHaveText('접기 ▴');await expect(page.locator('#productList')).toHaveCSS('overflow-y','visible');await page.locator('#toggleProducts').click();await expect(products).not.toHaveClass(/expanded/);await expect(page.locator('#toggleProducts')).toHaveText('펼치기 ▾');await expect(page.locator('#productList')).toHaveCSS('overflow-y','auto');
  await expect(page.locator('#toggleSequence')).toHaveText('펼치기 ▾');await page.locator('#toggleSequence').click();await expect(page.locator('.loading-plan')).toHaveClass(/expanded/);await expect(page.locator('#toggleSequence')).toHaveText('접기 ▴');
  const securing=page.locator('#securingPanel');await expect(securing).not.toHaveAttribute('open','');await securing.locator('summary').click();await expect(securing).toHaveAttribute('open','');
});

test('guest project saves, reloads, and recalculates automatically',async({page})=>{
  await page.goto('/');
  await loadSample(page);
  await expect(page.locator('#loadedCount')).toHaveText('36개',{timeout:20000});
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await page.getByRole('textbox',{name:'저장 이름'}).fill('E2E 자동 계산');
  await page.getByRole('button',{name:'이 이름으로 저장'}).click();
  await expect(page.locator('#saveState')).toHaveText('브라우저 저장됨');
  await page.getByRole('button',{name:'저장',exact:true}).click();
  await expect(page.getByRole('heading',{name:'현재 프로젝트에 저장할까요?'})).toBeVisible();
  await expect(page.getByRole('button',{name:'다른 이름으로 저장'})).toBeVisible();
  await page.getByRole('button',{name:'취소'}).click();
  await page.getByRole('button',{name:'새 프로젝트'}).click();
  await expect(page.locator('#loadedCount')).toHaveText('—');
  await openMenu(page,'불러오기');await page.getByRole('button',{name:'저장 목록'}).click();
  await page.locator('[data-open]').filter({hasText:'E2E 자동 계산'}).click();
  await expect(page.locator('#loadedCount')).toHaveText('36개',{timeout:20000});
  await expect(page.locator('#simulationStatus')).toBeHidden();await expect(page.locator('#calcTime')).toContainText('계산');await expect(page.locator('#containerCount')).toHaveText('1대');
});

test('weight balance, view presets and printable work instruction work together',async({page})=>{
  await page.goto('/');await loadSample(page);await expect(page.locator('#balanceCard')).toBeVisible();await expect(page.locator('#frontRearBalance')).not.toHaveText('—');
  const cog=page.getByRole('button',{name:'무게중심',exact:true});await cog.click();await expect(cog).toHaveClass(/active/);await expect(cog).toHaveAttribute('aria-pressed','true');await cog.click();await expect(cog).not.toHaveClass(/active/);
  for(const name of ['문 기준','좌측면','우측면','상면','3D']){await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('button',{name,exact:true})).toHaveClass(/active/)}
  await page.getByRole('button',{name:'우측면',exact:true}).click();await page.getByRole('button',{name:'보기 초기화'}).click();await expect(page.getByRole('button',{name:'3D',exact:true})).toHaveClass(/active/);
  await expect(page.locator('#fieldResultButton')).toHaveCount(0);const popupPromise=page.waitForEvent('popup');await page.locator('#exportPdf').click();const report=await popupPromise;await report.waitForLoadState();await expect(report.getByRole('button',{name:'인쇄 / PDF 저장'})).toBeVisible();await expect(report.getByText('현장 작업 기록')).toBeVisible();await expect(report.getByText('실제 적재 수량')).toBeVisible();await report.close();
});

test('CTU pre-check and compression status render after simulation',async({page})=>{
  await page.goto('/');await loadSample(page);
  await expect(page.locator('#ctuConcentration')).not.toHaveText('—');
  await expect(page.locator('#ctuVertical')).not.toHaveText('—');
  await expect(page.locator('#compressionStatus')).not.toHaveText('—');
});

test('simulation result does not move the view controls',async({page})=>{
  await page.goto('/');const view=page.getByRole('button',{name:'문 기준',exact:true}),before=await view.boundingBox();await loadSample(page);const after=await view.boundingBox(),divider=await page.locator('#planner').evaluate(e=>{const s=getComputedStyle(e,'::after');return{bottom:parseFloat(s.bottom),left:parseFloat(s.left),display:s.display,marginBottom:parseFloat(getComputedStyle(e).marginBottom)}});expect(after.x).toBe(before.x);await expect(page.locator('#simulationStatus')).toBeHidden();expect(divider).toEqual({bottom:16,left:430,display:'block',marginBottom:12});
});

test('one run button, view controls inside the 3D view and an XYZ axis toggle',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('button',{name:/시뮬레이션 실행/})).toHaveCount(1);
  await expect(page.locator('#canvasWrap .result-control-row #viewIso')).toBeVisible();
  await expect(page.locator('#canvasWrap .axis-legend')).toHaveCount(0);await expect(page.locator('#canvasHint')).toHaveCount(0);
  await expect(page.locator('.result-kicker')).toHaveCount(0);
  await loadSample(page);await expect(page.locator('#viewAxes')).toHaveAttribute('aria-pressed','true');await page.locator('#viewAxes').click();await expect(page.locator('#viewAxes')).toHaveAttribute('aria-pressed','false');await expect(page.locator('#viewAxes b')).toHaveText('OFF');
});

test('footer keeps professional contrast and aligns the visitor counter',async({page})=>{
  await page.goto('/');const footer=page.locator('.site-footer'),workspace=page.locator('.workspace'),visitors=page.locator('.site-footer .visitor-count'),style=await footer.evaluate(e=>getComputedStyle(e).backgroundColor),workBox=await workspace.boundingBox(),footerBox=await footer.boundingBox(),visitorBox=await visitors.boundingBox();expect(style).toBe('rgb(16, 21, 18)');expect(Math.abs(workBox.x+workBox.width-(visitorBox.x+visitorBox.width))).toBeLessThanOrEqual(20);expect(Math.abs(footerBox.y+footerBox.height/2-(visitorBox.y+visitorBox.height/2))).toBeLessThanOrEqual(1);
});

test('CTU sliding and tipping reference calculation appears in the securing panel',async({page})=>{
  await page.goto('/');await loadSample(page);
  await page.locator('#securingPanel').evaluate(panel=>panel.open=true);
  await expect(page.locator('#securingRecommendation')).toContainText('CTU Code 참고 계산');
  await expect(page.locator('#securingRecommendation')).toContainText('필요 억제력');
  await expect(page.locator('#securingCount')).toContainText('CTU 고정 필요');
});

test('condition dropdowns open a smooth list and keep the native select value in sync',async({page})=>{
  await page.goto('/');
  const transport=page.locator('.select-box').filter({has:page.locator('#transportMode')});
  await transport.locator('.select-button').click();await expect(transport).toHaveClass(/open/);
  await transport.getByRole('option',{name:'해상 · 보수적'}).click();
  await expect(page.locator('#transportMode')).toHaveValue('sea');await expect(transport.locator('.select-button')).toHaveText('해상 · 보수적');await expect(transport).not.toHaveClass(/open/);
  await transport.locator('.select-button').press('ArrowDown');await expect(page.locator('#transportMode')).toHaveValue('combined');
});

test('product name and group inputs suggest previously entered values',async({page})=>{
  await page.goto('/');
  for(const [name,group] of [['산업용 펌프','기계류'],['제어반','전기장비']]){await page.fill('#productName',name);await page.fill('#productGroup',group);await page.fill('#productWeight','100');await page.fill('#productLength','1000');await page.fill('#productWidth','800');await page.fill('#productHeight','700');await page.click('#addProduct')}
  await page.reload();await page.locator('#productName').click();await page.keyboard.type('제');
  const suggestions=page.locator('.suggest-box.open li');await expect(suggestions).toHaveText(['제어반']);
  await suggestions.first().click();await expect(page.locator('#productName')).toHaveValue('제어반');
  await page.locator('#productGroup').click();await expect(page.locator('.suggest-box.open li')).toHaveText(['전기장비','기계류']);
});
