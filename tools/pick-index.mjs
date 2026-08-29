/* **골라 넣은** 지표를 결과 노드로 만든다. 자동 수집이 아니다.
 *
 *   node tools/pick-index.mjs --dry
 *   node tools/pick-index.mjs
 *
 * 목록과 그 이유는 db/picked_index.json 에 있다.
 * 이 파일은 그 목록대로 창고에서 값을 꺼내 index.html 의 AUTO-KOSIS 블록에 쓴다.
 *
 * ── 거부하는 것 ──
 *   ① 창고에 그 key 가 없다
 *   ② **폐지된 통계표다** (stat_alive.alive=0) — 값은 받아지지만 출처 링크가 죽는다
 *   ③ 값이 10개 해 미만이다
 *   ④ keys 가 실제 공포 법안 이름에 안 나온다 (죽은 핵심어)
 *   거부한 것은 **화면이 아니라 여기 출력에** 이유와 함께 남긴다. 조용히 빠뜨리지 않는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const HTML = path.join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');
const MIN_HIT = 3;

const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'picked_index.json'), 'utf8'));
/* ── **사람이 값을 직접 준 통계** (db/hand_stats.json) ──
   API 로 못 받는 공식 통계가 많다 — KOSIS·한국은행·부동산원은 인증키가 필요하고,
   지표누리는 810개 중 334개가 폐지된 통계표라 출처 링크가 죽는다.
   최저임금은 법제처 고시에 있지만 **시급이 PDF 첨부에만** 있고 현행 2건뿐이라 시계열이 안 된다.
   그래서 값을 손으로 넣되 **출처 URL 이 실제로 열려야 하고**(검사 53),
   그 페이지에 그 값이 있어야 한다. 우리가 옮긴 것이지 만든 것이 아니다. */
let hand = { stats: [] };
try { hand = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'hand_stats.json'), 'utf8')) } catch {}
const db = new DatabaseSync(DB, { readOnly: true });

const bills = db.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm FROM raw_row WHERE service='nwbpacrgavhjryiph'`)
  .all().map(r => String(r.nm || '').replace(/\([^)]*\)/g, ''));

const nodes = [], rejected = [];
for (const p of spec.picked) {
  const t = db.prepare('SELECT * FROM stat_table WHERE key=?').get(p.key);
  if (!t) { rejected.push([p.id, `창고에 ${p.key} 가 없다`]); continue }
  const alive = db.prepare('SELECT alive FROM stat_alive WHERE tbl_id=?').get(t.tbl_id);
  if (!alive) { rejected.push([p.id, `살아있는지 확인 안 됐다 — node tools/index-alive.mjs 를 먼저 돌려라`]); continue }
  if (!alive.alive) { rejected.push([p.id, `폐지된 통계표다 (idx_cd=${t.tbl_id}). 값은 있지만 출처 링크가 죽는다`]); continue }

  const vals = db.prepare('SELECT prd,val FROM stat_value WHERE key=? ORDER BY prd').all(p.key)
    .filter(v => v.val !== '' && v.val != null);
  if (vals.length < 10) { rejected.push([p.id, `값이 ${vals.length}개 해뿐이다 (10개 이상이라야 추세를 말할 수 있다)`]); continue }

  const dead = (p.keys || []).filter(k => bills.filter(b => b.includes(k)).length < MIN_HIT);
  if (dead.length) { rejected.push([p.id, `핵심어가 죽었다: ${dead.join(', ')} (공포 법안 이름에 ${MIN_HIT}건 미만)`]); continue }

  const f = vals[0], l = vals[vals.length - 1];
  const u = p.unit || '';
  const title = String(t.tbl_nm || '').trim();
  const item = String(t.itm_nm || '').trim();
  const cap = `${title}${item && item !== title ? ' · ' + item : ''} — ` +
    `${f.prd}년 ${f.val}${u} → ${l.prd}년 ${l.val}${u} (${vals.length}개 해)` +
    (u ? '' : '. 지표누리가 단위를 주지 않아 숫자만 적었습니다 — 원본 표에서 확인하세요');

  nodes.push({
    id: p.id, lab: p.lab, big: `${l.val}${u}`, cap, yr: String(l.prd),
    cats: p.cats || [], keys: p.keys || [],
    src: `출처 · 지표누리(e-나라지표) · ${title}`,
    url: t.src_url,
    series: vals.map(v => [v.prd, v.val])
  });
}
/* ── 손으로 준 값 → 결과 노드 ──
   창고를 안 거치므로 폐지 여부·시계열 길이는 여기서 직접 본다. */
let handN = 0;
for (const h of (hand.stats || [])) {
  const v = (h.values || []).filter(x => x && x[0] && x[1] != null && x[1] !== '');
  if (v.length < 10) { rejected.push([h.id, `값이 ${v.length}개 해뿐이다 (10개 이상이라야 추세를 말할 수 있다)`]); continue }
  const dead = (h.keys || []).filter(k => bills.filter(b => b.includes(k)).length < MIN_HIT);
  if (dead.length) { rejected.push([h.id, `핵심어가 죽었다: ${dead.join(', ')}`]); continue }
  if (!h.srcUrl) { rejected.push([h.id, '출처 URL 이 없다 — 규칙 7']); continue }
  const f = v[0], l = v[v.length - 1];
  const u = h.unit || '';
  const num = x => Number(String(x).replace(/,/g, ''));
  const fmt = x => num(x).toLocaleString('ko-KR');
  const times = (num(f[1]) > 0) ? (num(l[1]) / num(f[1])).toFixed(2) : null;
  const cap = `${l[0]}년 ${fmt(l[1])}${u} · ${f[0]}년에는 ${fmt(f[1])}${u}이었습니다` +
    (times ? ` — ${Number(l[0]) - Number(f[0])}년 만에 ${times}배` : '') +
    `. ${v.length}개 해를 ${h.srcName} 표에서 그대로 옮겼습니다.`;
  nodes.push({
    id: h.id, lab: h.lab, big: `${fmt(l[1])}${u}`, cap, yr: String(l[0]),
    cats: h.cats || [], keys: h.keys || [],
    src: `출처 · ${h.srcName}${h.srcPage ? ' · ' + h.srcPage : ''}`,
    url: h.srcUrl,
    series: v.map(x => [x[0], String(num(x[1]))]),
    hand: 1
  });
  handN++;
}
db.close();

console.log(`골라 넣은 지표 ${spec.picked.length}개 · 손으로 준 통계 ${(hand.stats||[]).length}개 → 결과 노드 ${nodes.length}개 (그중 손 ${handN}개)`);
nodes.forEach(n => console.log(`  ${n.lab}\n      ${n.cap}\n      분야 ${n.cats.join(',') || '(비움)'} · 핵심어 ${n.keys.join(' ')}`));
if (rejected.length) { console.log('\n  거부한 것:'); rejected.forEach(([id, why]) => console.log(`   · ${id} — ${why}`)) }
if (spec.notFound && spec.notFound.length) {
  console.log('\n  아직 못 찾은 것 (지어내지 않고 비워 둔다):');
  spec.notFound.forEach(x => console.log(`   · ${x.want} — ${x.why}`));
}
if (DRY) process.exit(0);

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
/* **`yr` 바로 뒤에 `keys` 를 둔다.** tools/link.mjs 가 결과 노드를 읽을 때
   `yr:'YYYY',keys:[…]` 를 한 덩어리로 찾는다. 사이에 tip 이 끼면 그 노드는
   자동 연결 대상에서 조용히 빠진다 — 실제로 그래서 새 결과 2개가 고립됐다. */
const js = nodes.map(n =>
  `{id:${q(n.id)},t:'result',auto:1,side:'gold',lab:${q(n.lab)},big:${q(n.big)},cap:${q(n.cap)},` +
  `yr:${q(n.yr)},keys:[${n.keys.map(q).join(',')}],cats:[${n.cats.map(q).join(',')}],` +
  (n.hand ? 'hand:1,' : '') +
  `tip:${q(n.cap.slice(0, 110))},body:${q(n.cap)},src:${q(n.src)},url:${q(n.url)},` +
  `series:[${n.series.map(s => `[${q(s[0])},${q(s[1])}]`).join(',')}]}`).join('\n,');

let html = fs.readFileSync(HTML, 'utf8');

/* ── CATMAP 에도 넣는다 ──
   link.mjs 의 1관문은 노드의 `cats` 가 아니라 **CATMAP**(분야별 노드 id 목록)을 읽는다.
   두 곳에 있어야 하는 것이 이상하지만, CATMAP 은 화면의 분야 단추도 쓰는 표라
   한쪽만 채우면 지도에서는 안 보이고 연결만 되거나 그 반대가 된다.
   여기서 함께 넣어 갈라지지 않게 한다. */
for (const n of nodes) for (const c of n.cats) {
  const re = new RegExp(`(\\n ['"]?${c}['"]?:\\[)([^\\]]*)(\\])`);
  const m = re.exec(html);
  if (!m) { console.log(`  ! CATMAP 에 분야 '${c}' 가 없다 — ${n.id} 는 분야 필터에 안 나온다`); continue }
  if (m[2].includes(`'${n.id}'`)) continue;
  html = html.replace(re, `$1$2,'${n.id}'$3`);
}
const A = '/*AUTO-KOSIS-START*/', B = '/*AUTO-KOSIS-END*/';
const i = html.indexOf(A), j = html.indexOf(B);
if (i < 0 || j < 0) { console.error('index.html 에 AUTO-KOSIS 블록이 없다'); process.exit(1) }
fs.writeFileSync(HTML, html.slice(0, i + A.length) + '\n' + js + '\n' + html.slice(j), 'utf8');
console.log(`\nindex.html 에 결과 노드 ${nodes.length}개 내보냄`);
