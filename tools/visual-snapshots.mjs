// 화면 회귀 확인(CSS·레이아웃을 고칠 때):
//   node tools/visual-snapshots.mjs <폴더>              여러 폭 × 여러 상태의 전체 화면을 PNG로 찍는다
//   node tools/visual-snapshots.mjs --compare <A> <B>  두 폴더의 같은 이름 PNG가 바이트까지 같은지 비교한다
// 고치기 전에 한 번, 고친 뒤에 한 번 찍어 비교한다. 계산 시간 표시와 3D 캔버스는 가린다(매번 달라서).
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const [a, b] = args.slice(1);
  const files = readdirSync(a).filter(f => f.endsWith('.png'));
  const diff = files.filter(f => {
    try {
      return !readFileSync(join(a, f)).equals(readFileSync(join(b, f)));
    } catch {
      return true;
    }
  });
  console.log(diff.length ? `다름 ${diff.length}/${files.length}:\n${diff.join('\n')}` : `모두 같음 ${files.length}장`);
  process.exit(diff.length ? 1 : 0);
}
const out = args[0];
if (!out) {
  console.error('사용법: node tools/visual-snapshots.mjs <폴더> | --compare <A> <B>');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4232,
  BASE = `http://127.0.0.1:${PORT}/`;
const server = spawn(process.execPath, ['dev-server.mjs', `--port=${PORT}`], { cwd: root, stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const browser = await chromium.launch();
  for (const w of [1400, 1000, 820, 390]) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce'
    });
    const page = await ctx.newPage();
    // 운영 Supabase(방문자 수·점검 기록)에 쓰지 않는다.
    await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, r => r.abort());
    const shot = async name => {
      await page.waitForTimeout(400);
      await page.screenshot({
        path: join(out, `${w}-${name}.png`),
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        mask: [page.locator('#calcTime'), page.locator('#canvasWrap canvas')],
        maskColor: '#ff00ff'
      });
    };
    const settle = async () => {
      for (let i = 0; i < 3; i++) {
        if (await page.locator('#messageDialog[open]').count()) {
          await page.locator('#messageConfirm').click();
          await page.waitForTimeout(250);
        }
      }
    };
    await page.goto(BASE);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(800);
    await shot('empty');
    for (const id of ['guideButton', 'policyButton', 'ctuButton']) {
      await page.click('#' + id);
      await page.waitForTimeout(300);
      await shot(id);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
    await page.locator('details.menu>summary', { hasText: '불러오기' }).click();
    await shot('loadmenu');
    await page.getByRole('button', { name: '샘플', exact: true }).click();
    await page.waitForTimeout(300);
    await shot('sampledialog');
    await page.click('[data-sample="6"]');
    await page.waitForFunction(
      () => typeof shipment !== 'undefined' && shipment && !document.getElementById('recalculateOptions').disabled,
      null,
      { timeout: 180000 }
    );
    await page.waitForTimeout(1200);
    await settle();
    await shot('result');
    await page
      .locator('#toggleInput')
      .click()
      .catch(() => {});
    await shot('collapsed');
    await page
      .locator('#toggleInput')
      .click()
      .catch(() => {});
    if (w >= 1000) {
      await page
        .locator('#togglePanel')
        .click()
        .catch(() => {});
      await shot('panelhidden');
      await page
        .locator('#togglePanel')
        .click()
        .catch(() => {});
    }
    await page.goto(BASE + '#samples');
    await page.waitForTimeout(1500);
    await shot('samples');
    await ctx.close();
  }
  await browser.close();
  console.log(`찍음: ${out}`);
} finally {
  server.kill();
}
