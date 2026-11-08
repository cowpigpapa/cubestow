import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const activeFiles = ['../index.html', '../app.js', '../project-store.js', '../project-model.js', '../privacy.html'];

test('the active web client has no algorithm review recording or admin history UI', async () => {
  const source = (await Promise.all(activeFiles.map(file => readFile(new URL(file, import.meta.url), 'utf8')))).join(
    '\n'
  );
  assert.doesNotMatch(source, /record_algorithm_flag|recordAlgorithmFlag|algorithmFlagList|fromAlgorithmFlag/);
  assert.doesNotMatch(source, /알고리즘 점검 기록/);
});
