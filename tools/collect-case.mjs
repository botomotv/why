/* 사건 수집기 — 헌재결정례 · 판례. **목록만 받는다.**
 *
 *   node tools/collect-case.mjs            전부 (detc 38,672 + prec 171,220)
 *   node tools/collect-case.mjs detc       하나만
 *   node tools/collect-case.mjs --dry      받아만 보고 안 쓴다
 *
 * 지키는 것
 *  - **전문(판례내용)을 받지 않는다.** 거기 변호사·당사자 실명이 있다.
 *    화면에 안 그려도 내보낸 파일에 있으면 우리가 배포한 것이 된다 (CLAUDE.md).
 *  - 중단해도 이어서 받는다. 이미 받은 일련번호는 건너뛴다.
 *  - **연도의 출처를 밝힌다.** 종국일자가 '0' 인 것이 있어서 그럴 때만
 *    사건번호의 접수연도를 쓴다. 접수연도는 결정연도가 아니다 — 섞으면 거짓말이다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const DRY = process.argv.includes('--dry');
const GAP = Number(process.env.CASE_GAP || 120);
const NOW = new Date().toISOString().slice(0, 10);
const PICK = process.argv.slice(2).filter(a => !a.startsWith('--'));
const TARGETS = (PICK.length ? PICK : ['detc', 'prec']);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async p => {
  const u = new URL('http://www.law.go.kr/DRF/lawSearch.do');
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, String(v));
  for (let t = 0; t < 3; t++) {
    try { return JSON.parse(await (await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } })).text()) }
    catch { await sleep(600 * (t + 1)) }
  }
  return null;
};
const rowsOf = j => {
  if (!j) return null;
  const b = j[Object.keys(j)[0]]; if (!b) return null;
  const k = Object.keys(b).find(x => Array.isArray(b[x]));
  return { total: +b.totalCnt || 0, rows: k ? b[k] : [] };
};
/* '2002.07.15' · '20020715' → 2002. '0' 이면 없는 것이다 */
/* '0' 뿐 아니라 **'0001.01.01' 도 날짜가 아니다.** 판례 29,180건이 그렇게 왔는데
   그대로 담았더니 연도 1년짜리 사건이 창고에 들어갔다. 1900년 아래는 없는 것으로 본다
   — 대한민국 법원·헌재 기록에 그런 해는 없다. */
const yrOfDt = d => { const m = String(d || '').match(/^(\d{4})/); const y = m ? +m[1] : 0; return y >= 1900 ? y : 0 };
/* 헌재 '95헌마122' → 1995, '2017헌바323' → 2017 · 판례 '대법원-2025-두-34754' → 2025.
   **이건 접수연도지 결정연도가 아니다.** yr_src 에 그렇게 적는다. */
const yrOfNo = no => {
  const s = String(no || '');
  let m = s.match(/(^|[^\d])(\d{4})([^\d]|$)/); if (m) return +m[2];
  m = s.match(/^(\d{2})[가-힣]/); if (m) return +m[1] + (+m[1] > 40 ? 1900 : 2000);
  return 0;
};

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
const ins = DRY ? null : db.prepare(
  `INSERT OR REPLACE INTO court_case
     (case_sn,kind,case_no,case_nm,end_dt,yr,yr_src,court,ctype,src_url,fetched_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?)`);

for (const tg of TARGETS) {
  const head = rowsOf(await api({ target: tg, display: 1, page: 1 }));
  if (!head) { console.error(`${tg} · 목록을 못 받았다`); continue }
  const pages = Math.ceil(head.total / 100);
  const have = DRY ? new Set() : new Set(
    db.prepare('SELECT case_sn FROM court_case WHERE kind=?').all(tg).map(r => r.case_sn));
  console.log(`\n${tg} · 전체 ${head.total.toLocaleString()}건 · ${pages}쪽` +
              (have.size ? ` · 이미 받은 것 ${have.size.toLocaleString()}` : '') + (DRY ? '  (--dry)' : ''));
  let got = 0, dup = 0, noYr = 0, byNo = 0; const failed = [];
  if (!DRY) db.exec('BEGIN');
  for (let p = 1; p <= pages; p++) {
    const r = rowsOf(await api({ target: tg, display: 100, page: p }));
    if (!r || !r.rows.length) { failed.push(p); await sleep(GAP); continue }
    for (const x of r.rows) {
      const sn = String(x.헌재결정례일련번호 || x.판례일련번호 || '');
      if (!sn) continue;
      if (have.has(sn)) { dup++; continue }
      have.add(sn);
      const end = String(x.종국일자 || x.선고일자 || '');
      let yr = yrOfDt(end), ys = 'end';
      if (!yr) { yr = yrOfNo(x.사건번호); ys = 'caseno'; byNo++ }
      if (!yr) { noYr++; ys = 'none' }
      if (ins) ins.run(sn, tg, String(x.사건번호 || ''), String(x.사건명 || ''), end, yr || null, ys,
        String(x.법원명 || x.데이터출처명 || ''), String(x.사건종류명 || ''),
        `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=${tg}&ID=${sn}&type=HTML`, NOW);
      got++;
    }
    if (!DRY && p % 50 === 0) { db.exec('COMMIT'); db.exec('BEGIN') }
    if (p % 100 === 0 || p === pages)
      process.stdout.write(`\r  ${p}/${pages}쪽 · 새로 ${got.toLocaleString()} · 이미 있던 것 ${dup.toLocaleString()}   `);
    await sleep(GAP);
  }
  if (!DRY) db.exec('COMMIT');
  console.log(`\n  새로 담은 것 ${got.toLocaleString()} / 전체 ${head.total.toLocaleString()}`);
  console.log(`  연도를 사건번호(접수연도)에서 가져온 것 ${byNo.toLocaleString()} · 끝내 연도 없음 ${noYr.toLocaleString()}`);
  if (failed.length) console.log(`  **못 받은 쪽 ${failed.length}개** (${failed.slice(0, 10).join(',')}${failed.length > 10 ? '…' : ''}) — 다시 돌리면 이어서 받는다`);
}
if (!DRY) {
  const s = db.prepare('SELECT kind,COUNT(*) c,MIN(yr) a,MAX(yr) b FROM court_case GROUP BY kind').all();
  console.log('\n창고 court_case');
  for (const r of s) console.log(`  ${r.kind}  ${String(r.c).padStart(7)}건  ${r.a}~${r.b}년`);
}
db.close();
