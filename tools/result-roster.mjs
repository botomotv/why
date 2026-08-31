/* 지도에 있는 결과 노드 id 를 db/result_roster.json 에 적어 둔다.
 *
 *   node tools/result-roster.mjs          지금 지도로 명부를 갱신한다
 *   node tools/result-roster.mjs --check  대조만 한다 (사라진 것이 있으면 종료 1)
 *
 * **왜 개수가 아니라 목록인가.** 하나가 빠지고 하나가 늘면 개수는 같은데 사라진 것이다.
 * 실제로 사교육비가 조용히 사라진 적이 있다 — 그때도 개수만 보면 몰랐다.
 *
 * 일부러 뺀 것은 `removed` 에 이유를 적는다. 이유가 있으면 통과다 —
 * 빈 것 자체는 잘못이 아니고, 말없이 비우는 것이 잘못이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'result_roster.json');
const CHECK = process.argv.includes('--check');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const now = [...new Set([...html.matchAll(/\{id:'([^']+)',t:'result'/g)].map(m => m[1]))];
const labOf = {};
for (const m of html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?lab:'((?:[^'\\]|\\.)*)'/g)) labOf[m[1]] = m[2];

let old = { ids: [], removed: {} };
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch {}
const removed = old.removed || {};
const gone = (old.ids || []).filter(id => !now.includes(id) && !removed[id]);
const added = now.filter(id => !(old.ids || []).includes(id));

console.log(`결과 노드 ${now.length}개 (명부 ${(old.ids || []).length}개)`);
if (added.length) console.log(`  새로 들어온 것 ${added.length}개: ${added.map(i => i + '(' + (labOf[i] || '') + ')').join(', ')}`);
if (gone.length) {
  console.log(`  ★ 사라진 것 ${gone.length}개: ${gone.join(', ')}`);
  console.log(`     일부러 뺀 것이면 db/result_roster.json 의 removed 에 이유를 적어라.`);
}
if (CHECK) process.exit(gone.length ? 1 : 0);

fs.writeFileSync(OUT, JSON.stringify({
  _: ['**결과 노드 명부.** tools/result-roster.mjs 가 쓴다.',
      '결과는 지도의 입구다 — 하나가 조용히 사라지면 그 입구가 없어진다.',
      '실제로 사교육비가 사라진 적이 있다. 개수만 보면 몰랐다.',
      '일부러 뺐으면 removed 에 이유를 적는다. 이유가 있으면 검사가 통과시킨다.'],
  at: new Date().toISOString().slice(0, 10),
  n: now.length,
  ids: now.sort(),
  labs: Object.fromEntries(now.sort().map(i => [i, labOf[i] || ''])),
  removed
}, null, 1) + '\n');
console.log(`db/result_roster.json 에 ${now.length}개를 적었다`);
