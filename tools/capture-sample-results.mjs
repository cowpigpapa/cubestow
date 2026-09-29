// 샘플 결과 미리보기(상단 메뉴 샘플 결과, #samples)에 쓰는 캡처를 다시 만든다.
// 샘플 20개 × 안전 수준 3개(적재량 우선·기본·CTU 기준 적용)를 실제 화면으로 계산해 컨테이너마다 3D 화면을 JPEG로 찍고,
// 정반대 대각선(카메라를 180° 돌린 방향)에서도 한 장씩 더 찍어 결과 요약을 sample-results/manifest.json에 쓴다. 알고리즘이 바뀌면 `npm run samples:capture`로 다시 만든다.
/* global shipment, LoadwiseEngine, LoadwiseReview, LoadwiseInsights, SAMPLE_SETS, CONTAINERS, camera, drawThree -- page.evaluate 안에서 쓰는 화면 전역 */
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'sample-results'),
  imgDir = join(outDir, 'img');
const PORT = 4231,
  BASE = `http://127.0.0.1:${PORT}/`;
const MODES = [
  ['standard', '0', '적재량 우선'],
  ['strict', '1', '기본'],
  ['secure', '2', 'CTU 기준 적용']
];
const only = process.argv
  .find(a => a.startsWith('--samples='))
  ?.split('=')[1]
  ?.split(',')
  .map(Number);

const server = spawn(process.execPath, ['dev-server.mjs', `--port=${PORT}`], { cwd: root, stdio: 'ignore' });
const stop = () => {
  try {
    server.kill();
  } catch {}
};
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('local server did not start');
}

try {
  await waitForServer();
  await rm(outDir, { recursive: true, force: true });
  await mkdir(imgDir, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  // 캡처는 운영 Supabase(방문자 수·알고리즘 점검 기록)에 쓰지 않는다.
  await page.route(/^https:\/\/[a-z0-9]+\.supabase\.co\//, route => route.abort());
  await page.goto(BASE);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(800);
  // 확인 창(저장 안 한 변경, 일부 적재 안내, CTU 안내 등)이 열리면 확인을 눌러 닫는다.
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      if (await page.locator('#messageDialog[open]').count()) {
        await page.locator('#messageConfirm').click();
        await page.waitForTimeout(250);
      } else break;
    }
  };
  const meta = await page.evaluate(() => ({
    appVersion: (document.getElementById('appVersion')?.textContent || '').replace(/^v/, ''),
    engine: LoadwiseEngine.ENGINE_VERSION,
    samples: Object.entries(SAMPLE_SETS).map(([id, s]) => ({
      id: Number(id),
      name: s.name,
      category: s.category,
      description: s.description,
      container: CONTAINERS[s.container]?.name || s.container,
      transport: LoadwiseEngine.TRANSPORT_PROFILES[s.mode]?.label || s.mode,
      products: s.products.map(p => ({
        name: p.name,
        shape: p.shape,
        qty: p.qty,
        size: `${p.l}×${p.w}×${p.h}`,
        weight: p.weight
      }))
    }))
  }));
  const samples = meta.samples.filter(s => !only || only.includes(s.id));
  for (const [safety, slider, label] of MODES) {
    for (const sample of samples) {
      await settle();
      await page.evaluate(() => {
        window.__prev = typeof shipment !== 'undefined' ? shipment : null;
      });
      await page.locator('details.menu>summary', { hasText: '불러오기' }).click();
      await page.getByRole('button', { name: '샘플', exact: true }).click();
      await page.click(`[data-sample="${sample.id}"]`);
      await page.waitForTimeout(300);
      await settle();
      await page.waitForFunction(
        () =>
          typeof shipment !== 'undefined' &&
          shipment &&
          shipment !== window.__prev &&
          !document.getElementById('recalculateOptions').disabled,
        null,
        { timeout: 180000 }
      );
      // 샘플을 불러오면 한 번 계산된다. 안전 수준을 맞추고 다시 계산한다.
      await settle();
      await page.locator('#safetySlider').fill(slider);
      await settle();
      await page.evaluate(() => {
        window.__prev = shipment;
      });
      await page.click('#recalculateOptions');
      await page.waitForFunction(
        () => shipment !== window.__prev && !document.getElementById('recalculateOptions').disabled,
        null,
        { timeout: 300000 }
      );
      await page.waitForTimeout(900);
      await settle();
      const info = await page.evaluate(() => {
        const review = window.LoadwiseReview ? LoadwiseReview.review(shipment) : null;
        return {
          safety: shipment.safety,
          unallocated: shipment.unallocated.length,
          total: shipment.totalUnits,
          reason: shipment.strategy?.reason || '',
          grade: review?.grade?.label || '',
          findings: (review?.items || [])
            .filter(it => it.level !== 'ok')
            .slice(0, 4)
            .map(it => it.title),
          containers: shipment.containers.map(l => {
            const ctu = LoadwiseInsights.ctu(l),
              plan = l.securing || { dunnage: [], airbags: [] },
              count = k => plan.dunnage.filter(d => d.kind === k).length;
            return {
              placed: l.placed.length,
              weightKg: Math.round(l.totalWeight),
              volumeRate: Math.round(l.volumeRate),
              ctuLevel: ctu?.level || '',
              airbags: plan.airbags.length,
              fillers: count('filler') + count('spacer'),
              beams: count('beam'),
              lashing: count('lashing') + count('strap')
            };
          })
        };
      });
      if (info.safety !== safety) throw new Error(`sample ${sample.id}: expected ${safety}, got ${info.safety}`);
      info.images = [];
      info.backImages = [];
      for (let k = 0; k < info.containers.length; k++) {
        if (k > 0) {
          await settle();
          await page.click('#nextContainerArrow');
          await page.waitForTimeout(700);
        }
        const file = `img/s${String(sample.id).padStart(2, '0')}-${safety}-${k + 1}.jpg`;
        await page.locator('#canvasWrap').screenshot({ path: join(outDir, file), type: 'jpeg', quality: 78 });
        info.images.push(file);
        // 반대쪽: 카메라를 180° 돌려 찍고 원래 방향으로 되돌린다.
        const back = file.replace(/.jpg$/, '-back.jpg');
        await page.evaluate(() => {
          camera.yaw += Math.PI;
          drawThree();
        });
        await page.waitForTimeout(250);
        await page.locator('#canvasWrap').screenshot({ path: join(outDir, back), type: 'jpeg', quality: 78 });
        await page.evaluate(() => {
          camera.yaw -= Math.PI;
          drawThree();
        });
        info.backImages.push(back);
      }
      (sample.results ||= {})[safety] = info;
      console.log(
        label,
        sample.id,
        `${info.containers.length}대`,
        info.unallocated ? `미적재 ${info.unallocated}` : ''
      );
    }
  }
  await browser.close();
  const manifest = {
    generatedAt: new Date().toISOString(),
    appVersion: meta.appVersion,
    engine: meta.engine,
    modes: MODES.map(([key, , label]) => ({ key, label })),
    samples
  };
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(`done: ${samples.length} samples → sample-results/manifest.json`);
} finally {
  stop();
}
