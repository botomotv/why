/* 법이 정한 **보상·지원**을 index.html 로 내보낸다.
 *
 *   node tools/relief.mjs [--dry]
 *
 * ── 「피해자는 어떻게 보상받았나」 에 대한 답 ──
 * 형사 판결에는 형량이 있지만 배상은 별개 재판이다. 그리고 우리 창고의
 * 민사 손해배상 판례는 **형사 사건과 이어지는 것이 아주 적다** (전수 조사로 확인).
 *
 * 그런데 **국가 보상은 법에 적혀 있다.** 「○○ 피해구제법」·「○○ 지원법」의
 * 조문 제목이 그대로 답이다 — 「보상금」·「위로금」·「의료지원금」·「생활지원금 등」.
 *
 * **우리가 요약하지 않는다.** 국회가 그 법에 써 넣은 조문 제목을 그대로 옮긴다.
 * 금액은 안 쓴다 — 조문 제목에 없고, 시행령·고시로 정해져 창고에 없다.
 * 「얼마」 를 지어내느니 「무엇을」 만 말한다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const HTML = path.join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');

/* 무엇을 보상·지원으로 볼 것인가 — **낱말을 좁게 잡는다.**
   「지원」 하나로 열면 「기술 지원」·「행정 지원」 같은 것이 다 딸려 온다.
   실제로 피해자에게 가는 돈·급여·서비스를 가리키는 말만 쓴다. */
const RELIEF_RE = /(보상금|배상금|위로금|위로지원금|의료지원금|생활지원금|생계비|지원금|구제급여|요양급여|장해급여|유족급여|간병급여|장례비|치료비|학자금|장학|심리상담|치유|추모|피해자\s*지원|피해구제|손실의\s*보상|배상\s*및\s*보상)/;
/* 보상이 **아닌** 것 — 환수·제한·시효는 받는 이야기가 아니다 */
const NOT_RE = /(환수|제한|중지|정지|반환|시효|벌칙|과태료|비용의\s*부담|구상)/;

const db = new DatabaseSync(DB, { readOnly: true });
const nz = s => String(s || '').replace(/[\s·ㆍ]/g, '');
const arts = {};
for (const r of db.prepare('SELECT law_nm,titles FROM law_articles').all()) arts[nz(r.law_nm)] = String(r.titles || '');

const html = fs.readFileSync(HTML, 'utf8');
/* 지도에 있는 법만 — 없는 법의 보상을 담아도 화면에 못 온다 */
const laws = [...new Set([...html.matchAll(/t:'bill'[^\n]*?title:'([^']+)'/g)].map(m => m[1]))];

const rows = [];
let hit = 0, noArt = 0, noRelief = 0;
for (const t of laws) {
  const a = arts[nz(t)];
  if (a === undefined) { noArt++; continue }
  const list = a.split('·').map(x => x.trim()).filter(Boolean)
    .filter(x => RELIEF_RE.test(x) && !NOT_RE.test(x));
  const uniq = [...new Set(list)].slice(0, 8);
  if (!uniq.length) { noRelief++; continue }
  hit++;
  const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  rows.push(`${q(nz(t))}:[${uniq.map(q).join(',')}]`);
}
console.log(`지도의 법 ${laws.length}개`);
console.log(`  보상·지원 조문이 있다      ${hit}개`);
console.log(`  조문은 있는데 보상은 없다  ${noRelief}개`);
console.log(`  조문을 아직 못 받았다      ${noArt}개  ← 「아직 확인하지 못했습니다」 로 나간다`);
if (DRY) process.exit(0);

const fresh = fs.readFileSync(HTML, 'utf8');
const block = `/*AUTO-RELIEF-START*/${rows.join('\n,')}/*AUTO-RELIEF-END*/`;
const out = fresh.replace(/\/\*AUTO-RELIEF-START\*\/[\s\S]*?\/\*AUTO-RELIEF-END\*\//, block);
if (out === fresh && rows.length) { console.error('AUTO-RELIEF 자리를 못 찾았다'); process.exit(1) }
fs.writeFileSync(HTML, out, 'utf8');
console.log(`index.html 에 ${rows.length}개를 썼다`);
db.close();
