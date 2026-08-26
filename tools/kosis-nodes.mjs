/* KOSIS 시계열 → 결과 노드('노란 원').
 *
 *   node tools/kosis-nodes.mjs --dry     세기만 한다
 *   node tools/kosis-nodes.mjs           index.html 에 내보낸다
 *
 * 결과 노드에 필요한 것: lab · big · cap · yr · src · cats · keys
 *
 * **지어낸 말을 쓰지 않는다.**
 *   lab·big·cap 은 통계표 이름과 받은 값에서만 만든다.
 *   keys 는 통계표 이름을 쪼개서 뽑되, **실제 법안 이름에 있는 말만 남긴다** —
 *   창고의 공포 법안 18,158건과 대조해 0건인 말은 버린다.
 *   전에 핵심어 11개가 조용히 죽어 있던 사고가 있었다 (검사 F).
 *   자동으로 뽑으면 그런 것이 더 생긴다. 그래서 만들 때 대조한다.
 *
 * cats(분야)는 **핵심어가 실제로 걸린 법안의 소관위**에서 거꾸로 정한다.
 *   우리가 "이건 의료 분야" 라고 정하지 않는다 — 그 말이 걸린 법이 어느 위원회에
 *   갔는지를 세어서 가장 많은 쪽을 쓴다. 사실에서 나온 값이다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const MIN_HIT = Number(process.env.KOSIS_MIN_HIT || 3);   /* 핵심어가 최소 몇 건에 걸려야 살리나 */

const db = new DatabaseSync(DB, { readOnly: true });
let tables = [];
try { tables = db.prepare('SELECT * FROM stat_table').all() } catch { }
if (!tables.length) {
  console.error(`stat_table 이 비었다. 먼저:

  read -s KOSIS_KEY && export KOSIS_KEY && node tools/collect-kosis.mjs
`);
  process.exit(1);
}
const bills = db.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm, json_extract(row_json,'$.COMMITTEE_NM') cm
     FROM raw_row WHERE service='nwbpacrgavhjryiph'`).all()
  .map(r => ({ nm: String(r.nm || '').replace(/\([^)]*\)/g, ''), cm: r.cm || '' }));
const cc = {};
for (const r of db.prepare('SELECT cat, committee FROM cat_committee').all())
  (cc[r.committee] = cc[r.committee] || []).push(r.cat);

/* 통계표 이름을 쪼갠다. 괄호·단위·조사를 떼고 2~6자 토막만 본다. */
const STOP = new Set(['현황', '통계', '조사', '자료', '지표', '연간', '분기', '월별', '연도', '전국',
  '시도', '시군구', '총계', '합계', '전체', '기준', '이상', '미만', '구성비', '증감', '추이']);
const chunks = nm => [...new Set(String(nm).replace(/\([^)]*\)/g, ' ').split(/[^가-힣]+/)
  .flatMap(w => { const o = []; for (let L = Math.min(6, w.length); L >= 2; L--) for (let i = 0; i + L <= w.length; i++) o.push(w.slice(i, i + L)); return o })
  .filter(w => w.length >= 2 && !STOP.has(w)))];

const nodes = [];
let seq = 0, dropped = 0, noKey = 0;
for (const t of tables) {
  const vals = db.prepare('SELECT prd,val FROM stat_value WHERE key=? ORDER BY prd').all(t.key)
    .filter(v => v.val !== '' && v.val != null);
  if (vals.length < 10) { dropped++; continue }
  const last = vals[vals.length - 1], first = vals[0];
  /* 핵심어 — 이름에서 뽑고 **법안 이름과 대조해 살아 있는 것만** 남긴다 */
  const cand = chunks(t.tbl_nm).map(w => ({ w, hit: bills.filter(b => b.nm.includes(w)).length }))
    .filter(x => x.hit >= MIN_HIT).sort((a, b) => a.w.length - b.w.length || b.hit - a.hit);
  /* 짧은 말이 긴 말을 포함하면 긴 말은 버린다 (같은 법을 두 번 세지 않는다) */
  const keys = [];
  for (const x of cand) if (!keys.some(k => x.w.includes(k))) keys.push(x.w);
  const top = keys.slice(0, 6);
  if (!top.length) { noKey++; continue }
  /* 분야 — 그 핵심어가 걸린 법안의 소관위에서 거꾸로 센다 */
  const votes = {};
  for (const b of bills) if (top.some(k => b.nm.includes(k)))
    for (const c of (cc[b.cm] || [])) votes[c] = (votes[c] || 0) + 1;
  const cats = Object.entries(votes).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  if (!cats.length) { noKey++; continue }
  const unit = (t.unit || '').trim();
  nodes.push({
    id: 'ks' + (++seq),
    lab: `${t.tbl_nm.replace(/\([^)]*\)/g, '').trim().slice(0, 22)} ${last.val}${unit}`.trim(),
    big: `${last.val}${unit}`,
    cap: `${t.tbl_nm.trim()} (${first.prd}년 ${first.val}${unit} → ${last.prd}년 ${last.val}${unit})`,
    yr: last.prd, src: `출처 · KOSIS 국가통계포털 · ${t.tbl_nm} (${t.org_id}/${t.tbl_id})`,
    url: t.src_url, cats, keys: top, n: vals.length, itm: t.itm_nm || ''
  });
}
console.log(`KOSIS 결과 노드 · 통계 갈래 ${tables.length}개 → 노드 ${nodes.length}개`);
console.log(`  10년 미만이라 버린 것 ${dropped} · 살아 있는 핵심어가 없어 버린 것 ${noKey}`);
if (nodes.length) {
  console.log('\n예시 5개');
  nodes.slice(0, 5).forEach(n => console.log(`  ${n.id} ${n.lab}\n      분야 ${n.cats.join(',')} · 핵심어 ${n.keys.join(' ')}`));
}
if (DRY) { db.close(); process.exit(0) }

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
const js = nodes.map(n =>
  `{id:${q(n.id)},t:'result',auto:1,side:'gold',lab:${q(n.lab)},big:${q(n.big)},cap:${q(n.cap)},` +
  `yr:${q(n.yr)},tip:${q(n.cap.slice(0, 90))},body:${q(n.cap)},src:${q(n.src)},url:${q(n.url)},` +
  `cats:[${n.cats.map(q).join(',')}],keys:[${n.keys.map(q).join(',')}]}`).join('\n,');
let out = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const a = '/*AUTO-KOSIS-START*/', b = '/*AUTO-KOSIS-END*/';
const i = out.indexOf(a), j = out.indexOf(b);
if (i < 0 || j < 0) { console.error('index.html 에 ' + a + ' 자리가 없다'); process.exit(2) }
out = out.slice(0, i + a.length) + '\n' + js + '\n' + out.slice(j);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
console.log(`\nindex.html 에 결과 노드 ${nodes.length}개 내보냄`);
db.close();
