/* 「국민이 무엇을 불안해하는가」 를 근거로 첫 화면 결과를 고른다.
 *
 *   node tools/concern.mjs --dry     세기만 한다
 *   node tools/concern.mjs           index.html 에 내보낸다
 *
 * ── 왜 이 도구가 있나 ──
 * 첫 화면 결과는 그동안 주인이 궁금해한 38개였다. **주인이 고르면 주인의 관심사가 들어간다.**
 * 그걸 줄이려고 밖에서 조사한 것을 쓴다 — 정부·통계청·여론조사기관이 발표한
 * 「국민이 무엇을 불안해하는가」 다. 우리가 만든 값이 아니다.
 *
 * ── 무엇을 하고 무엇을 안 하나 ──
 *  · 한다  : 어떤 결과를 **먼저 보여줄지** 정한다 (srcRank 0). 그 근거를 카드에 적는다.
 *  · 안 한다: 값을 바꾸지 않는다. 조사가 「부동산 1위」 라고 해서 집값 숫자를 손대지 않는다.
 *
 * ── 없는 것은 없다고 적는다 ──
 * `notFound` 에 적힌 것은 화면의 '보는 법' 서랍에 그대로 나온다.
 * 말없이 비우면 「이을 게 없었다」 와 「우리가 안 이었다」 가 구별되지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const SRC = path.join(ROOT, 'db', 'public_concern.json');
const spec = JSON.parse(fs.readFileSync(SRC, 'utf8'));

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/[\r\n\u2028\u2029]+/g, ' ') + "'";

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* 결과 노드가 실제로 있는지 본다 — 없는 id 를 내보내면 조용히 아무 일도 안 일어난다 */
const have = new Set();
for (const m of html.matchAll(/\{id:'([^']+)',t:'result'/g)) have.add(m[1]);

const srcById = new Map(spec.sources.map(s => [s.id, s]));
const rows = [];
const missing = [];
for (const c of spec.concerns) {
  /* why 는 「출처id — 문장」 꼴이다. 출처 id 를 떼어 주소를 붙인다 */
  const m = /^(\w+)\s*[—-]\s*(.+)$/.exec(c.why || '');
  const s = m && srcById.get(m[1]);
  if (!s) { console.error(`! 「${c.concern}」 의 why 가 출처 id 로 시작하지 않는다: ${c.why}`); process.exit(2) }
  for (const id of c.nodes) {
    if (!have.has(id)) { missing.push(`${c.concern} → ${id}`); continue }
    rows.push({ id, c: c.concern, e: m[2], s: `${s.org} 「${s.title}」 · ${s.date}`, u: s.url });
  }
}
if (missing.length) {
  console.error('! index.html 에 없는 결과 id:'); missing.forEach(x => console.error('   ' + x));
  process.exit(2);
}

/* 같은 결과가 두 관심사에 걸리면 **먼저 적힌 것**을 쓴다 — 순서가 곧 우선순위다 */
const byId = new Map();
for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r);

const js = [...byId.values()].map(r =>
  ` ${r.id}:{c:${q(r.c)},e:${q(r.e)},s:${q(r.s)},u:${q(r.u)}}`).join(',\n');

/* '보는 법' 서랍에 넣을 「못 찾은 것」 */
const nf = spec.notFound.map(x => `{w:${q(x.want)},y:${q(x.why)}}`).join(',\n ');

console.log(`관심사 ${spec.concerns.length}개 · 조사 ${spec.sources.length}건 · ` +
  `첫 화면 등급이 되는 결과 ${byId.size}개 · 못 찾은 것 ${spec.notFound.length}건`);
spec.concerns.forEach(c => console.log(`  ${c.concern.padEnd(18)} ${c.nodes.length}개  ${c.why}`));
spec.notFound.forEach(x => console.log(`  ✗ ${x.want}`));
if (DRY) process.exit(0);

const put = (tag, body) => {
  const a = `/*AUTO-${tag}-START*/`, b = `/*AUTO-${tag}-END*/`;
  const i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) { console.error(`index.html 에 ${a} 자리가 없다`); process.exit(2) }
  html = html.slice(0, i + a.length) + '\n' + body + '\n' + html.slice(j);
};
put('CONCERN', js);
put('CONCERN-MISS', ' ' + nf);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log('index.html 에 내보냈다');
