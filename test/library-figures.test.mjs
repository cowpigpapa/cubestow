import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('CTU 요약 도해는 접근 가능한 로컬 이미지와 설명을 사용한다', async () => {
  const source = await readFile(path.join(root, 'library.js'), 'utf8');
  const figures = [
    ...source.matchAll(
      /<figure class="lib-figure"><img src="([^"]+)" alt="([^"]+)" loading="lazy" decoding="async"><figcaption><span>AI 생성 도해<\/span>([^<]+)<\/figcaption><\/figure>/g
    )
  ];

  assert.equal(figures.length, 6);
  assert.equal(new Set(figures.map(match => match[1])).size, 6);

  for (const [, sourcePath, alt, caption] of figures) {
    assert.match(sourcePath, /^\/images\/ctu\/[a-z0-9-]+\.webp$/);
    assert.ok(alt.length >= 20, `${sourcePath}의 대체 텍스트가 너무 짧습니다.`);
    assert.ok(caption.trim().length >= 20, `${sourcePath}의 캡션이 너무 짧습니다.`);
    await access(path.join(root, 'public', sourcePath.slice(1)));
  }
});
