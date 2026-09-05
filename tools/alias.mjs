/* 법의 **별명**을 index.html 로 내보낸다.
 *
 *   node tools/alias.mjs [--dry]
 *
 * ── 왜 필요한가 ──
 * 「민식이법」이 검색이 안 됐다. 사람들은 「도로교통법 일부개정법률안」으로 기억하지 않는다.
 * **검색에서 안 나오면 없는 것과 같다.**
 *
 * ── 규칙 8 의 예외 ──
 * 「민식이법」·「김용균법」에는 사람 이름이 들어 있다. 우리가 붙인 것이 아니라
 * **국회·정부·언론이 그 법을 부르는 통칭**이고, 주인이 그 예외를 명시적으로 정했다.
 * **법의 별명에만** 쓴다 — 판결·사건·피해자 설명에는 여전히 안 쓴다.
 *
 * ── 이름으로 맞춘다 ──
 * 노드 id 는 도구가 다시 돌면 번호가 바뀐다(`auto_도로교통법_294`).
 * 그래서 **정식 법 이름**으로 맞추고, 띄어쓰기·가운뎃점은 무시한다
 * (창고는 「4ㆍ16」, 지도는 「4·16」 을 쓴다 — 다른 글자다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'db', 'law_alias.json');
const DRY = process.argv.includes('--dry');

const spec = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const norm = s => String(s || '').replace(/[\s·ㆍ]/g, '');
const html = fs.readFileSync(HTML, 'utf8');

/* 지도에 있는 법 이름을 모은다 — 붙을 곳이 없는 별명은 밝힌다 */
const titles = new Set();
for (const m of html.matchAll(/t:'bill'[^\n]*?title:'([^']+)'/g)) titles.add(norm(m[1]));

const rows = [], noHome = [];
for (const a of spec.alias) {
  const k = norm(a.law);
  if (!titles.has(k)) { noHome.push(a.law); continue }
  const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const al = (Array.isArray(a.alias) ? a.alias : [a.alias]).map(q).join(',');
  rows.push(`${q(k)}:{a:[${al}],w:${q(a.why)},s:${q(a.src || '')}}`);
}
console.log(`별명 ${spec.alias.length}개 중 ${rows.length}개를 붙였다`);
if (noHome.length) {
  console.log(`  붙을 법 노드가 없어 못 붙인 것 ${noHome.length}개:`);
  noHome.forEach(x => console.log(`    · ${x}`));
}
if (spec.notFound && spec.notFound.length)
  console.log(`  아직 확인 못 한 별명 ${spec.notFound.length}개 (db/law_alias.json 의 notFound)`);
if (DRY) process.exit(0);

/* **쓰기 직전에 다시 읽는다** — 다른 도구·사람의 편집을 덮어쓰지 않는다 */
const fresh = fs.readFileSync(HTML, 'utf8');
const block = `/*AUTO-ALIAS-START*/${rows.join('\n,')}/*AUTO-ALIAS-END*/`;
const out = fresh.replace(/\/\*AUTO-ALIAS-START\*\/[\s\S]*?\/\*AUTO-ALIAS-END\*\//, block);
if (out === fresh && rows.length) { console.error('AUTO-ALIAS 자리를 못 찾았다'); process.exit(1) }
fs.writeFileSync(HTML, out, 'utf8');
console.log('index.html 에 썼다');
