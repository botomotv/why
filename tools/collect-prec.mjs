/* 판례 — **참조조문으로 역검색한다** (`search=3`).
 *
 *   node tools/collect-prec.mjs
 *
 * 왜 search=3 인가 — 실측이다.
 *   search=2(본문)로 '중대재해' 를 찾으면 793건이 오는데 사건명이
 *   「단체교섭청구의소」·「부당이득금」 이다. 본문에 그 말이 스쳐 지나간 것뿐이다.
 *   search=3 은 5건인데 표본 12건을 상세까지 받아 보니 **12/12 전부**
 *   참조조문에 그 법이 들어 있었다. **재판부가 스스로 그 법을 적은 것**이다.
 *
 * 규칙 8 · 사람 이름
 *   상세의 `판례내용` 에는 `담당변호사 ○○○` 이 그대로 있다. **읽자마자 버린다.**
 *   담는 것은 참조조문·판시사항·판결요지뿐이다.
 *
 * 무엇을 받나 — 지도에 이미 올라간 법률을 인용한 판례. 그래서 반드시 이어진다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const PER = Number(process.env.PREC_PER || 12);      /* 법 하나에서 받을 판례 수 */
const GAP = Number(process.env.CASE_GAP || 110);
const NOW = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const api = async (t, p) => {
  const u = new URL('http://www.law.go.kr/DRF/' + t);
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, String(v));
  for (let i = 0; i < 3; i++) {
    try { return JSON.parse(await (await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } })).text()) }
    catch { await sleep(500 * (i + 1)) }
  }
  return null;
};

const db = new DatabaseSync(DB);
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const laws = [...new Set([...html.matchAll(/\{id:'auto_[^']*',t:'bill',auto:1[^}]*?lab:'([^']*)'/g)].map(m => m[1]))]
  .filter(x => x.length >= 4);
console.log(`판례 · 참조조문 역검색(search=3) · 법 ${laws.length}개 × 최대 ${PER}건\n`);

const insC = db.prepare(
  `INSERT OR REPLACE INTO court_case (case_sn,kind,case_no,case_nm,end_dt,yr,yr_src,court,ctype,src_url,fetched_at)
   VALUES (?,'prec',?,?,?,?,?,?,?,?,?)`);
const insD = db.prepare(
  `INSERT OR REPLACE INTO case_detail (case_sn,kind,arts,gist,summary,fetched_at) VALUES (?,'prec',?,?,?,?)`);
const seen = new Set(db.prepare("SELECT case_sn FROM case_detail WHERE kind='prec'").all().map(r => r.case_sn));

let nLaw = 0, nHit = 0, nDet = 0, noRef = 0; const zero = [];
db.exec('BEGIN');
for (const L of laws) {
  nLaw++;
  const s = await api('lawSearch.do', { target: 'prec', query: L, search: 3, display: PER, page: 1 });
  await sleep(GAP);
  const rows = (s && s.PrecSearch && s.PrecSearch.prec) || [];
  if (!rows.length) { zero.push(L); continue }
  for (const r of rows) {
    const sn = String(r.판례일련번호 || ''); if (!sn) continue;
    nHit++;
    if (seen.has(sn)) continue;
    const d = await api('lawService.do', { target: 'prec', ID: sn });
    await sleep(GAP);
    if (!d) continue;
    const o = d[Object.keys(d)[0]] || {};
    delete o.판례내용;                         /* 규칙 8 — 전문은 여기서 버린다 */
    const arts = clean(o.참조조문);
    if (!arts) { noRef++; continue }           /* 조문이 없으면 이을 근거가 없다 */
    const dt = String(r.선고일자 || '').replace(/\./g, '');
    const y = /^(\d{4})/.test(dt) && +dt.slice(0, 4) >= 1900 ? +dt.slice(0, 4) : null;
    insC.run(sn, String(r.사건번호 || ''), String(r.사건명 || ''), String(r.선고일자 || ''),
      y, y ? 'end' : 'none', String(r.법원명 || r.데이터출처명 || ''), String(r.사건종류명 || ''),
      `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${sn}&type=HTML`, NOW);
    insD.run(sn, arts, clean(o.판시사항), clean(o.판결요지), NOW);
    seen.add(sn); nDet++;
  }
  if (nLaw % 20 === 0) { db.exec('COMMIT'); db.exec('BEGIN');
    process.stdout.write(`\r  법 ${nLaw}/${laws.length} · 검색 ${nHit} · 담음 ${nDet} · 참조조문 없음 ${noRef}   `) }
}
db.exec('COMMIT');
console.log(`\n\n  법 ${nLaw}개 · 검색으로 나온 판례 ${nHit} · 상세까지 담은 것 ${nDet}`);
console.log(`  참조조문이 없어 버린 것 ${noRef} — 이을 근거가 없다`);
if (zero.length) console.log(`  판례가 0건인 법 ${zero.length}/${laws.length}: ${zero.slice(0, 8).join(', ')}${zero.length > 8 ? ' …' : ''}`);
db.close();
