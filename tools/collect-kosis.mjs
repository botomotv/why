/* KOSIS 수집기 — 결과 노드('노란 원')의 원천.
 *
 *   read -s KOSIS_KEY && export KOSIS_KEY && node tools/collect-kosis.mjs
 *   … --dry     받아만 보고 창고에 안 쓴다
 *
 * 왜 이게 급한가 — 이 지도는 **결과를 눌러서 시작하는 구조**다.
 * 법안을 아무리 붙여도 입구가 19개면 19개 문으로만 들어온다.
 *
 * 지키는 것
 *  - **응답 필드 이름을 추측하지 않는다.** 대·소문자 두 가지를 다 받고,
 *    못 알아본 응답은 통째로 찍어 사람이 보게 한다.
 *  - **값을 손대지 않는다.** 받은 그대로 문자열로 담는다.
 *  - 못 받은 것을 분모와 함께 밝힌다. 말없이 건너뛰면 "없다" 와 "안 봤다" 가 안 갈린다.
 *  - 인증키는 창고에도 로그에도 남기지 않는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const KEY = process.env.KOSIS_KEY;
const DRY = process.argv.includes('--dry');
const GAP = Number(process.env.KOSIS_GAP || 350);
const TOP = Number(process.env.KOSIS_TOP || 6);      /* 검색어 하나가 가져올 통계표 수 */
const NOW = new Date().toISOString().slice(0, 10);
if (!KEY) {
  console.error(`KOSIS_KEY 가 없습니다.

  read -s KOSIS_KEY && export KOSIS_KEY && node tools/collect-kosis.mjs

키는 화면에 찍히지 않고 이 셸에만 남습니다. 창고에도 로그에도 저장하지 않습니다.`);
  process.exit(1);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== '') return String(o[k]); return '' };
const hide = s => String(s).split(KEY).join('***');

async function call(pathname, params) {
  const u = new URL('https://kosis.kr/openapi' + pathname);
  u.searchParams.set('apiKey', KEY);
  u.searchParams.set('format', 'json'); u.searchParams.set('jsonVD', 'Y');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } });
      const txt = await r.text();
      let j = null; try { j = JSON.parse(txt) } catch { }
      if (j) return { j, raw: txt };
      if (t === 2) return { j: null, raw: txt.slice(0, 300) };
    } catch (e) { if (t === 2) return { j: null, raw: hide(String(e)).slice(0, 200) } }
    await sleep(800 * (t + 1));
  }
  return { j: null, raw: '' };
}
const errOf = j => {
  const a = Array.isArray(j) ? j[0] : j;
  return (a && (a.err || a.errMsg || a.ERR_MSG)) ? JSON.stringify(a).slice(0, 160) : null;
};

const WANT = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'kosis_want.json'), 'utf8'))
  .filter(x => x && !x.startsWith('#'));

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
const insT = DRY ? null : db.prepare(
  `INSERT OR REPLACE INTO stat_table (key,org_id,tbl_id,tbl_nm,itm_id,itm_nm,c1,c1_nm,unit,want,src_url,fetched_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insV = DRY ? null : db.prepare('INSERT OR REPLACE INTO stat_value (key,prd,val) VALUES (?,?,?)');

console.log(`KOSIS · 찾을 말 ${WANT.length}개 · 표마다 상위 ${TOP}개${DRY ? '  (--dry)' : ''}\n`);
let nTbl = 0, nVal = 0, nSeries = 0; const noHit = [], noData = [];

for (const want of WANT) {
  const s = await call('/statisticsSearch.do',
    { method: 'getList', searchNm: want, startCount: 1, resultCount: TOP });
  await sleep(GAP);
  const list = Array.isArray(s.j) ? s.j : null;
  if (!list) { noHit.push(`${want} (응답이 목록이 아니다: ${hide(String(s.raw)).replace(/\s+/g, ' ').slice(0, 80)})`); continue }
  const e = errOf(list); if (e) { noHit.push(`${want} (${e})`); continue }
  if (!list.length) { noHit.push(`${want} (0건)`); continue }

  for (const t of list) {
    const orgId = pick(t, 'ORG_ID', 'orgId'), tblId = pick(t, 'TBL_ID', 'tblId');
    const tblNm = pick(t, 'TBL_NM', 'tblNm');
    if (!orgId || !tblId) continue;
    /* 해마다 나오는 것만 쓴다 — 결과 노드는 시계열이어야 "왜 이렇게 됐나" 를 물을 수 있다 */
    const d = await call('/Param/statisticsParameterData.do', {
      method: 'getList', apiKey: KEY, itmId: 'ALL', objL1: 'ALL',
      orgId, tblId, prdSe: 'Y', newEstPrdCnt: 30 });
    await sleep(GAP);
    const rows = Array.isArray(d.j) ? d.j : null;
    if (!rows || errOf(rows) || !rows.length) { noData.push(`${tblNm} [${orgId}/${tblId}]`); continue }

    /* 한 표에 항목×분류가 여러 갈래다. 갈래마다 따로 담는다 —
       합치면 우리가 고른 것이 되고, 무엇을 골랐는지 화면에서 안 보인다. */
    const by = new Map();
    for (const r of rows) {
      const itmId = pick(r, 'ITM_ID', 'itmId'), c1 = pick(r, 'C1', 'c1');
      const k = `${orgId}:${tblId}:${itmId}:${c1}`;
      if (!by.has(k)) by.set(k, { itmId, c1, itmNm: pick(r, 'ITM_NM', 'itmNm'), c1Nm: pick(r, 'C1_NM', 'c1Nm'),
        unit: pick(r, 'UNIT_NM', 'unitNm'), tblNm: pick(r, 'TBL_NM', 'tblNm') || tblNm, vals: [] });
      by.get(k).vals.push([pick(r, 'PRD_DE', 'prdDe'), pick(r, 'DT', 'dt')]);
    }
    if (!DRY) db.exec('BEGIN');
    for (const [k, v] of by) {
      const good = v.vals.filter(([p, x]) => /^\d{4}$/.test(p) && x !== '');
      if (good.length < 3) continue;         /* 3년도 안 되면 시계열이 아니다 */
      if (insT) insT.run(k, orgId, tblId, v.tblNm, v.itmId, v.itmNm, v.c1, v.c1Nm, v.unit, want,
        `https://kosis.kr/statHtml/statHtml.do?orgId=${orgId}&tblId=${tblId}`, NOW);
      for (const [p, x] of good) { if (insV) insV.run(k, p, x); nVal++ }
      nSeries++;
    }
    if (!DRY) db.exec('COMMIT');
    nTbl++;
    process.stdout.write(`\r  ${want.padEnd(12)} ${String(nSeries).padStart(4)}갈래 · 값 ${String(nVal).padStart(6)}   `);
  }
}
console.log('');
console.log(`\n표 ${nTbl}개에서 갈래 ${nSeries}개 · 값 ${nVal.toLocaleString()}개`);
if (noHit.length) { console.log(`\n검색이 안 된 말 ${noHit.length}/${WANT.length}`); noHit.forEach(x => console.log('  · ' + x)) }
if (noData.length) console.log(`\n해마다 나오는 값이 없어 건너뛴 표 ${noData.length}개\n  · ` + noData.slice(0, 12).join('\n  · '));
db.close();
console.log('\n다음: node tools/kosis-nodes.mjs   (결과 노드로 만든다)');
