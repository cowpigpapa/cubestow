import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('footer shows the package version and the slogan once',async()=>{
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),footer=html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)[0];
  assert.match(footer,new RegExp(`id="appVersion">v${pkg.version.replaceAll('.','\.')}<`));
  assert.equal(footer.split('Load wisely. Ship safely.').length-1,1);
  assert.match(html,/<title>Cubestow — Load wisely\. Ship safely\.<\/title>/);
});
