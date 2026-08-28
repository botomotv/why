/* 지표누리 시계열 → 결과 노드('노란 원').
 *
 *   node tools/index-nodes.mjs --dry     세기만 한다
 *   node tools/index-nodes.mjs           index.html 에 내보낸다
 *
 * 결과 노드에 필요한 것: lab · big · cap · yr · src · cats · keys
 *
 * **지어낸 말을 쓰지 않는다.**
 *   lab·big·cap 은 지표 이름과 받은 값에서만 만든다.
 *   keys 는 지표·항목 이름을 쪼개서 뽑되, **실제 법안 이름에 있는 말만 남긴다** —
 *   창고의 공포 법안과 대조해 3건 미만이면 버린다. 죽은 핵심어를 만들 때 막는다 (검사 F).
 *   cats(분야)는 **그 핵심어가 걸린 법안의 소관위**에서 거꾸로 정한다.
 *   우리가 "이건 의료 분야" 라고 정하지 않는다.
 *
 * **시계열을 살린다.** cap 에 "2015년 1.239 → 2024년 0.748" 을 적는다.
 *   그게 "왜 이렇게 됐나" 를 묻게 만드는 부분이다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const MIN_HIT = Number(process.env.IDX_MIN_HIT || 3);
/* ── **너무 넓은 말은 핵심어가 못 된다** ──
   `국내` `대상` `여자` `통한` 은 법안 이름 수백 건에 걸린다. 그런 말로 이으면
   「에너지 과잉 섭취자 분율」이 전력 관련 법에 붙는다 — 실제로 그렇게 나왔다.
   **몇 건에 걸리느냐로 자른다.** 우리가 "이 말은 넓다" 고 고르는 게 아니라
   창고의 공포 법안 18,158건이 정한다. 상한은 실측으로 골랐다 (아래 표). */
const MAX_HIT = Number(process.env.IDX_MAX_HIT || 300);
const WIDE = Number(process.env.IDX_WIDE || 120);   /* 한 낱말로 물을 때의 상한 */
const MAX_N = Number(process.env.IDX_MAX || 200);

const db = new DatabaseSync(DB, { readOnly: true });
const tables = db.prepare("SELECT * FROM stat_table WHERE org_id='INDEX'").all();
if (!tables.length) { console.error('stat_table 이 비었다. 먼저 node tools/collect-index.mjs'); process.exit(1) }

const bills = db.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm, json_extract(row_json,'$.COMMITTEE_NM') cm
     FROM raw_row WHERE service='nwbpacrgavhjryiph'`).all()
  .map(r => ({ nm: String(r.nm || '').replace(/\([^)]*\)/g, ''), cm: r.cm || '' }));
const cc = {};
for (const r of db.prepare('SELECT cat, committee FROM cat_committee').all())
  (cc[r.committee] = cc[r.committee] || []).push(r.cat);

/* 이름을 쪼갠다. 단위·괄호·형식어는 뺀다. */
const STOP = new Set(['현황', '통계', '조사', '자료', '지표', '연간', '분기', '월별', '연도', '전국', '추이',
  '구성비', '증감', '기준', '이상', '미만', '합계', '전체', '수준', '비율', '지수', '및']);
/* ── **조각을 만들지 않는다** ──
   전에는 낱말의 모든 부분문자열을 뽑았다. 그랬더니 핵심어가
   `장품` `한부` `모가` `민생` `활체` 처럼 **말이 아닌 조각**이 됐다.
   조각은 법안 이름 어딘가에 반드시 걸린다 — `모가` 는 「부모가」 에,
   `민생` 은 「국민생활」 에 걸린다. **그건 우리가 만든 거짓 연결이다.**
   그래서 **띄어쓰기로 나뉜 낱말을 통째로만** 쓴다.
   합성어(「한부모가족복지시설」)가 법안 이름에 안 나오면 그건 0건이 맞다 —
   억지로 이을 말을 만드는 것보다 **못 이었다고 밝히는 쪽**이 정직하다. */
const chunks = nm => [...new Set(String(nm).replace(/\([^)]*\)/g, ' ').split(/[^가-힣]+/)
  .filter(w => w.length >= 2 && !STOP.has(w)))];

/* ── **대표 핵심어는 희소성으로 고른다** ──
   `국내` `대상` `여자` 는 지표 이름 수십 개에 나온다. 그런 말이 대표가 되면
   「국내 석탄 수급」이 외국인 분야로 간다 — 실제로 그렇게 나왔다.
   길이로 고르면 같은 2글자끼리 못 가른다.
   **1,009개 지표 이름에서 몇 번 나오는지**를 센다. 드문 말일수록 그 지표만의 말이다.
   우리가 "이 말이 중요하다" 고 고르는 게 아니라 수집물이 정한다. */
const df = {};
for (const t of tables) for (const w of new Set(chunks(t.tbl_nm + ' ' + (t.itm_nm || '')))) df[w] = (df[w] || 0) + 1;

const nodes = [];
let seq = 0, short = 0, noKey = 0, noCat = 0;
for (const t of tables) {
  const vals = db.prepare('SELECT prd,val FROM stat_value WHERE key=? ORDER BY prd').all(t.key)
    .filter(v => v.val !== '' && v.val != null);
  if (vals.length < 10) { short++; continue }
  const first = vals[0], last = vals[vals.length - 1];

  const cand = chunks(t.tbl_nm + ' ' + (t.itm_nm || '')).map(w => ({ w, hit: bills.filter(b => b.nm.includes(w)).length }))
    /* **구체적인 말이 먼저다.** 전에는 짧은 것을 앞에 뒀더니 `국내` `대상` 이 대표가 돼
       「의약품 허가·신고」가 국토·경제 분야로 갔다. 긴 말일수록 그 표만의 말이다. */
    .filter(x => x.hit >= MIN_HIT && x.hit <= MAX_HIT)
    /* **드문 말이 그 지표만의 말이다.** 두 곳에서 드물어야 한다 —
       지표 이름들 사이에서(df) 그리고 법안 이름들 사이에서(hit).
       df 만 보면 「의약품 허가·신고」의 대표가 `제조` 가 되어 국토 분야로 갔다.
       `제조` 는 법안 이름 수백 건에 나오고 `의약품` 은 적게 나온다. 곱해서 고른다. */
    .sort((a, b) => ((df[a.w]||0)*a.hit) - ((df[b.w]||0)*b.hit) || b.w.length - a.w.length);
  const keys = [];
  for (const x of cand) if (!keys.some(k => k.includes(x.w) || x.w.includes(k))) keys.push(x.w);
  const top = keys.slice(0, 4);
  if (!top.length) { noKey++; continue }

  /* ── **핵심어를 하나 고르지 않는다. 다 같이 투표하되 몫이 다르다** ──
     대표를 하나 뽑으려고 세 번 고쳤다 — 길이순, 지표 이름에서 드문 순, 그 둘의 곱.
     번번이 「의약품 허가·신고」의 대표가 `허가`·`제조` 가 되어 국토 분야로 갔다.
     **고르는 방식이 문제가 아니라 하나만 고르는 것이 문제였다.**

     그래서 핵심어 넷이 다 묻는다. 다만 **낱말마다 총 한 표**다 —
     한 낱말이 법안 n건에 걸리면 한 건당 1/n 을 준다.
     `허가` 는 수백 건에 걸려 여러 소관위로 흩어지고,
     `의약품` 은 몇 건에 몰려 보건복지위에 한 표를 거의 다 준다.
     **우리가 어느 낱말이 중요한지 정하지 않는다** — 몇 건에 걸리느냐가 정한다.

     그래도 1등이 4할을 못 넘으면 **비운다.** 문턱을 0.25 로 낮춰 봤더니
     「학점은행 및 독학을 통한 학위 취득」이 국토 분야로 갔다 —
     **낮추면 커버리지가 아니라 오답이 는다.** 여기까지가 한계다.
     못 정한 개수는 화면에 밝힌다. 빈 것 자체는 잘못이 아니고, 말없이 비우는 것이 잘못이다. */
  const votes = {};
  for (const k of top) {
    const hs = bills.filter(b => b.nm.includes(k));
    if (!hs.length) continue;
    const w = 1 / hs.length;
    for (const b of hs) for (const c of (cc[b.cm] || [])) votes[c] = (votes[c] || 0) + w;
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  const tot = ranked.reduce((a, x) => a + x[1], 0);
  const cats = (ranked.length && ranked[0][1] / Math.max(tot, 1e-9) >= 0.4) ? [ranked[0][0]] : [];
  if (!cats.length) noCat++;

  const item = (t.itm_nm || '').trim();
  const title = (t.tbl_nm || '').trim();
  /* ── 이름은 **무엇의 숫자인지** 가 읽혀야 한다 ──
     전에는 지표명이 길면 항목명만 썼다. 그래서 `이혼 112` `생계독립 2` 가 나왔다 —
     무엇의 이혼인지, 무엇이 2인지 알 수가 없다.
     지표명을 앞에 두고 항목은 뒤에 붙인다. 지표명이 길면 지표명만 자른다. */
  const clean = x => x.replace(/\([^)]*\)/g, '').trim();
  const short_t = (item && item !== title && clean(title).length <= 12)
    ? clean(title) + ' ' + clean(item) : clean(title) || clean(item);
  nodes.push({
    id: 'ix' + (++seq), tbl: t.tbl_nm,
    lab: `${short_t} ${last.val}`.trim().slice(0, 30),
    big: String(last.val),
    cap: `${title}${item && item !== title ? ' · ' + item : ''} — ` +
         `${first.prd}년 ${first.val} → ${last.prd}년 ${last.val} (${vals.length}개 해)`,
    yr: last.prd, first: first.prd, firstVal: first.val, lastVal: last.val, n: vals.length,
    src: `출처 · 지표누리(e-나라지표) · ${title}`,
    url: t.src_url, cats, keys: top,
    series: vals.map(v => [v.prd, v.val])
  });
}
/* 이어질 수 있는 것부터. 핵심어가 많이 걸리는 것이 결과로서 쓸모가 있다. */
nodes.sort((a, b) => b.keys.length - a.keys.length || b.n - a.n);
/* ── **한 표에서 하나만 올린다** ──
   「한부모가족복지시설 현황」 하나에서 `연중입소자수` `연중퇴소자수` `생계독립` `이혼` …
   다섯 개가 각각 노드가 됐다. 핵심어도 분야도 똑같아서 **같은 자리에 다섯 겹**으로
   쌓이고, 지도가 다시 무늬가 된다. 나머지는 지우는 게 아니라 **안 올리는 것**이다 —
   같은 표의 다른 항목은 원문 링크에 그대로 있다. */
const seenTbl = new Set();
const use = nodes.filter(n => { if (seenTbl.has(n.tbl)) return false; seenTbl.add(n.tbl); return true })
                 .slice(0, MAX_N);
const dropDup = nodes.length - nodes.filter((n,i,a)=>a.findIndex(x=>x.tbl===n.tbl)===i).length;
console.log(`  같은 표의 다른 항목이라 안 올린 것 ${dropDup}`);
console.log(`지표누리 갈래 ${tables.length}개 → 결과 노드 후보 ${nodes.length}개 · 올릴 것 ${use.length}개`);
console.log(`  10년 미만 ${short} · 살아 있는 핵심어가 없어 버린 것 ${noKey} · 분야를 못 정해 비운 것 ${noCat}`);
if (use.length) {
  console.log('\n예시 6개');
  use.slice(0, 6).forEach(n => console.log(`  ${n.lab}\n      ${n.cap}\n      분야 ${n.cats.join(',')} · 핵심어 ${n.keys.join(' ')}`));
}
if (DRY) { db.close(); process.exit(0) }

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
const js = use.map(n =>
  `{id:${q(n.id)},t:'result',auto:1,side:'gold',lab:${q(n.lab)},big:${q(n.big)},cap:${q(n.cap)},` +
  `yr:${q(n.yr)},tip:${q(n.cap.slice(0, 110))},body:${q(n.cap)},src:${q(n.src)},url:${q(n.url)},` +
  `series:[${n.series.map(s => `[${q(s[0])},${q(s[1])}]`).join(',')}],` +
  `cats:[${n.cats.map(q).join(',')}],keys:[${n.keys.map(q).join(',')}]}`).join('\n,');
let out = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const a = '/*AUTO-KOSIS-START*/', b = '/*AUTO-KOSIS-END*/';
const i = out.indexOf(a), j = out.indexOf(b);
if (i < 0 || j < 0) { console.error('index.html 에 ' + a + ' 자리가 없다'); process.exit(2) }
out = out.slice(0, i + a.length) + '\n' + js + '\n' + out.slice(j);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
console.log(`\nindex.html 에 결과 노드 ${use.length}개 내보냄`);
db.close();
