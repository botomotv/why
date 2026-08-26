/* 헌재결정례 상세 — **심판대상조문**을 받는다. 사건 → 법을 잇는 가장 센 근거다.
 *
 *   node tools/collect-detc.mjs [건수]      기본 1000
 *
 * 규칙 8 · 사람 이름
 *   응답의 `전문` 에는 `담당변호사 ○○○` 이 그대로 있다. **읽자마자 버린다.**
 *   창고에도 안 담고 지도에도 안 올린다. 담는 것은 조문과 요약뿐이다.
 *
 * 무엇을 먼저 받나 — **편집 판단을 피한다.**
 *   "중요한 사건" 을 고르면 그게 우리 판단이다. 대신 **이을 수 있는 것**을 먼저 받는다:
 *   사건명에 지도에 이미 올라간 법 이름이 들어 있는 것 → 그다음 최근 것 순.
 *   즉 기준은 '중요도' 가 아니라 '연결 가능성' 과 '시간' 이다.
 *
 * 실측: 표본 25건 중 심판대상조문이 있는 것은 6건(24%)이다.
 *   지정재판부 각하 결정은 조문·판시사항이 비어 있다. 그래서 목표 수를 채울 때까지 받는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const WANT = Number(process.argv[2] || 1000);
const GAP = Number(process.env.CASE_GAP || 110);
const NOW = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const db = new DatabaseSync(DB);
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

/* 지도에 올라간 법 이름 — index.html 에서 직접 읽는다 */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const laws = [...new Set([...html.matchAll(/\{id:'auto_[^']*',t:'bill',auto:1[^}]*?lab:'([^']*)'/g)].map(m => m[1]))]
  .filter(x => x.length >= 4);
console.log(`헌재결정례 상세 · 목표 ${WANT}건 · 지도의 법 ${laws.length}개\n`);

const have = new Set(db.prepare("SELECT case_sn FROM case_detail WHERE kind='detc'").all().map(r => r.case_sn));
const all = db.prepare(
  `SELECT case_sn,case_no,case_nm,yr FROM court_case WHERE kind='detc' AND case_nm<>'' AND yr IS NOT NULL`).all();
/* ① 사건명에 지도의 법 이름이 있는 것 ② 그다음 최근 것. 둘 다 시간 내림차순 */
const hit = [], rest = [];
for (const c of all) (laws.some(L => c.case_nm.includes(L)) ? hit : rest).push(c);
const order = [...hit.sort((a, b) => b.yr - a.yr), ...rest.sort((a, b) => b.yr - a.yr)]
  .filter(c => !have.has(c.case_sn));
console.log(`  법 이름이 든 사건 ${hit.length.toLocaleString()} · 나머지 ${rest.length.toLocaleString()} · 이미 받은 것 ${have.size}`);

const ins = db.prepare(
  `INSERT OR REPLACE INTO case_detail (case_sn,kind,arts,gist,summary,fetched_at) VALUES (?,'detc',?,?,?,?)`);
let got = 0, tried = 0, empty = 0, fail = 0;
db.exec('BEGIN');
for (const c of order) {
  if (got >= WANT) break;
  tried++;
  const u = new URL('http://www.law.go.kr/DRF/lawService.do');
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  u.searchParams.set('target', 'detc'); u.searchParams.set('ID', c.case_sn);
  let o = null;
  try { const j = JSON.parse(await (await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } })).text());
        o = j[Object.keys(j)[0]] } catch { fail++ }
  if (o) {
    /* **전문을 여기서 버린다.** 아래로 절대 안 내려간다 (규칙 8) */
    delete o.전문;
    const arts = clean(o.심판대상조문) || clean(o.참조조문);
    const gist = clean(o.판시사항), sum = clean(o.결정요지);
    if (arts || gist) { ins.run(c.case_sn, arts, gist, sum, NOW); got++ }
    else empty++;
  }
  if (got % 100 === 0 && got) process.stdout.write(`\r  받음 ${got}/${WANT} · 시도 ${tried} · 내용 없음 ${empty} · 실패 ${fail}   `);
  if (tried % 200 === 0) { db.exec('COMMIT'); db.exec('BEGIN') }
  await sleep(GAP);
}
db.exec('COMMIT');
console.log(`\n\n  담은 것 ${got} / 시도 ${tried} (내용 없음 ${empty} · 실패 ${fail})`);
const wa = db.prepare("SELECT COUNT(*) c FROM case_detail WHERE kind='detc' AND arts<>''").get().c;
console.log(`  심판대상조문이 있는 것 ${wa} — 이것만 법에 이을 수 있다`);
db.close();
