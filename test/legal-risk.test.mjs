import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('privacy policy matches the deployed processors and retired data use', async () => {
  const privacy = await readFile(new URL('../privacy.html', import.meta.url), 'utf8');
  assert.match(privacy, /Vercel Inc\./);
  assert.match(privacy, /일본\(도쿄, ap-northeast-1\)/);
  assert.match(privacy, /국외 이전을 원하지 않을 경우/);
  assert.match(privacy, /개인정보 보호 담당자: JUAN\.HJLEE/);
  assert.doesNotMatch(privacy, /Cloudflare|적재 알고리즘 품질 점검 및 개선/);
});

test('terms and login require explicit agreement and identify high-risk exclusions', async () => {
  const [terms, index] = await Promise.all([
    readFile(new URL('../terms.html', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  assert.match(index, /id="authConsent"/);
  assert.match(index, /id="googleLogin"[^>]+disabled/);
  assert.match(index, /동의하지 않으면 Google 로그인과 계정 저장 기능을 이용할 수 없습니다/);
  assert.match(terms, /명시적으로 동의/);
  assert.doesNotMatch(terms, /품질 개선에 필요한 범위/);
  assert.match(terms, /위험물, 액체·벌크, 탱크, 냉동·온도관리 화물/);
  assert.match(terms, /만 14세 미만 이용자가 계정을 생성하거나 사용하는 행위/);
});

test('restored Google sessions require the current legal consent version', async () => {
  const store = await readFile(new URL('../project-store.js', import.meta.url), 'utf8');
  assert.match(store, /LEGAL_CONSENT_VERSION/);
  assert.match(store, /legal_consent_version/);
  assert.match(store, /client\.auth\.updateUser/);
  assert.match(store, /개정된 이용약관과 개인정보처리방침에 동의한 뒤 다시 로그인/);
});

test('public pages do not contact Google Fonts before consent', async () => {
  const pages = await Promise.all(
    ['index.html', 'privacy.html', 'terms.html'].map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8'))
  );
  for (const html of pages) assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/);
});

test('legal pages use clean public URLs with legacy redirects', async () => {
  const [index, privacy, terms, vercel] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../privacy.html', import.meta.url), 'utf8'),
    readFile(new URL('../terms.html', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(index, /href="(?:terms|privacy)\.html"/);
  assert.match(privacy, /cubestow\.onharu\.app\/privacy"/);
  assert.match(terms, /cubestow\.onharu\.app\/terms"/);
  assert.match(vercel, /"source": "\/terms\.html"/);
  assert.match(vercel, /"destination": "\/terms"/);
  assert.match(vercel, /"source": "\/privacy"/);
  assert.match(vercel, /"destination": "\/privacy\.html"/);
});
