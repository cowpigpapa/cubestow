import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 도해는 두 가지: AI 생성 도해(설명용 WebP)와 Cubestow 도면(치수·계수를 코드로 그린 SVG, tools/ctu-diagrams.mjs).
test('CTU 요약 도해는 접근 가능한 로컬 이미지와 설명을 사용한다', async () => {
  const source = await readFile(path.join(root, 'library.js'), 'utf8');
  const figures = [
    ...source.matchAll(
      /<figure class="lib-figure( lib-drawing)?"><img src="([^"]+)" alt="([^"]+)" loading="lazy" decoding="async"><figcaption><span>(AI 생성 도해|Cubestow 도면)<\/span>([^<]+)<\/figcaption><\/figure>/g
    )
  ];

  assert.equal(figures.length, 28);
  assert.equal(new Set(figures.map(match => match[2])).size, 28);

  for (const [, drawing, sourcePath, alt, label, caption] of figures) {
    if (drawing) {
      assert.equal(label, 'Cubestow 도면');
      assert.match(sourcePath, /^\/images\/ctu\/[a-z0-9-]+\.svg$/);
    } else {
      assert.equal(label, 'AI 생성 도해');
      assert.match(sourcePath, /^\/images\/ctu\/[a-z0-9-]+\.webp$/);
    }
    assert.ok(alt.length >= 20, `${sourcePath}의 대체 텍스트가 너무 짧습니다.`);
    assert.ok(caption.trim().length >= 20, `${sourcePath}의 캡션이 너무 짧습니다.`);
    await access(path.join(root, 'public', sourcePath.slice(1)));
  }
});

// 정밀 도면은 계수·비율이 원문과 같아야 한다. 생성 도구를 다시 돌려 저장된 SVG와 같은지 본다.
test('Cubestow 도면 SVG는 생성 도구의 결과와 같고 CTU Code 5장 계수를 담는다', async () => {
  const acc = await readFile(path.join(root, 'public/images/ctu/accelerations.svg'), 'utf8');
  for (const v of ['0.8', '0.5', '1.0', '0.3', '0.7', '0.4', '0.2']) assert.ok(acc.includes(`>${v}<`), v);
  const cog = await readFile(path.join(root, 'public/images/ctu/center-of-gravity.svg'), 'utf8');
  assert.match(cog, /중앙에서 -0\.7%/);
  assert.match(cog, /중앙에서 -14\.2%/);
  const lash = await readFile(path.join(root, 'public/images/ctu/lashing-and-tipping.svg'), 'utf8');
  assert.match(lash, /30°~60°/);
  assert.match(lash, /c · d ≥ cz · b/);
});

test('추가 Cubestow 도면은 원문 계산 예·기준값과 같은 숫자를 보여 준다', async () => {
  const read = f => readFile(path.join(root, 'public/images/ctu', f), 'utf8');
  const calc = await read('securing-calc.svg');
  assert.match(calc, /≈ 24kN/); // 5×10cm 각재 6개, 자유 길이 2.2m
  assert.match(calc, /≈ 56kN/);
  assert.match(calc, /≈ 48kN/);
  assert.match(calc, /1\.32m²/);
  const rail = await read('rail-axles.svg');
  assert.match(rail, />18\.9t</);
  assert.match(rail, />21\.1t</);
  const anchor = await read('anchor-points.svg');
  assert.match(anchor, /1,000daN/);
  assert.match(anchor, /500daN/);
});
