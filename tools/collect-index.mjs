/* 지표누리(e-나라지표) 시계열 수집기 — **결과 노드('노란 원')의 원천.**
 *
 *   node tools/collect-index.mjs [시작] [끝]      기본 1000~5000
 *
 * ── 왜 이걸 쓰나 ──
 *   결과가 19개뿐이라 이 지도의 입구가 19곳이다. 사건을 1만 개 받아도 소용이 없다.
 *   KOSIS 공개 API 는 인증키가 필요한데 이 환경에 없다 (실측: err 10 · 인증KEY값 누락).
 *   e-나라지표 openApi 도 키를 요구한다.
 *
 * ── 정직하게 밝힐 것 ──
 *   **이건 공개 API 가 아니라 지표누리 화면이 쓰는 주소다.**
 *   문서화돼 있지 않고 언제든 바뀔 수 있다. 바뀌면 값이 조용히 안 들어온다 —
 *   그래서 검사가 '결과 노드 수' 를 재서 줄면 FAIL 이 나게 해 둔다.
 *   데이터 자체는 국가승인통계 공표값이고, 노드마다 원본 페이지로 링크한다 (규칙 7).
 *   KOSIS 인증키가 생기면 tools/collect-kosis.mjs 로 갈아타는 것이 맞다.
 *
 * ── 거르는 기준 (사람이 정한 것이라 여기 적는다) ──
 *   ① 연도별(YYYY) 값이 **10년 이상** — 결과 노드는 "왜 이렇게 됐나" 를 묻는 자리다.
 *      3~4년짜리는 추세를 못 보여주고 우연을 추세로 읽게 만든다
 *   ② **전국 단위만** — 항목명에 시·도 이름이 들어간 것은 뺀다.
 *      지역별로 쪼개면 같은 지표가 17개가 되고 지도가 통계 목록이 된다
 *   ③ 값이 숫자여야 한다 — '-' 나 빈칸은 버린다
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const FROM = Number(process.argv[2] || 1000), TO = Number(process.argv[3] || 5000);
const GAP = Number(process.env.IDX_GAP || 140);
const MIN_YEARS = 10;
const NOW = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SIDO = /서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|수도권|시도|지역별/;

const H = {
  'User-Agent': 'why-map/1.0 (+https://why-map.com)',
  'Referer': 'https://www.index.go.kr/',
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
};
async function series(idx) {
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch('https://www.index.go.kr/unity/index/IndexTblGraphAjax.do',
        { method: 'POST', headers: H, body: `idxCd=${idx}&sttsCd=${idx}01&chartOrd=1&freq=Y` });
      const j = JSON.parse(await r.text());
      return j.resultList || [];
    } catch { await sleep(500) }
  }
  return null;
}
/* 지표명은 화면의 graph_box 옵션 글자다 — 「출생아 수 및 합계 출산율」 */
async function idxName(idx) {
  try {
    const r = await fetch(`https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=${idx}`,
      { headers: { 'User-Agent': H['User-Agent'] } });
    const s = await r.text();
    const m = s.match(/id="graph_box"[\s\S]{0,900}?<option[^>]*>([^<]{2,80})</);
    return m ? m[1].trim() : '';
  } catch { return '' }
}

const db = new DatabaseSync(DB);
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
const insT = db.prepare(
  `INSERT OR REPLACE INTO stat_table (key,org_id,tbl_id,tbl_nm,itm_id,itm_nm,c1,c1_nm,unit,want,src_url,fetched_at)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
const insV = db.prepare('INSERT OR REPLACE INTO stat_value (key,prd,val) VALUES (?,?,?)');

console.log(`지표누리 시계열 · idxCd ${FROM}~${TO} · 연 ${MIN_YEARS}년 이상 · 전국 단위만\n`);
console.log('  ※ 공개 API 가 아니라 지표누리 화면이 쓰는 주소다. 언제든 바뀔 수 있다.\n');

let scanned = 0, withData = 0, kept = 0, tooShort = 0, regional = 0, named = 0;
db.exec('BEGIN');
for (let i = FROM; i <= TO; i++) {
  scanned++;
  const rows = await series(String(i));
  await sleep(GAP);
  if (!rows || !rows.length) continue;
  withData++;
  /* ── 항목(itemNm) **× 갈래(valNm)** 마다 따로 담는다 ──
     전에는 `itemNm || valNm` 이라 itemNm 이 있으면 valNm 을 버렸다.
     그런데 「최근 주요 사망원인별 사망률 변화」는 itemNm 이 `조사망률` 하나이고
     **자살·암·뇌혈관·심장·당뇨가 전부 valNm** 에 들어 있다.
     그래서 55행이 11행으로 뭉개졌다 — PRIMARY KEY (key,prd) 라 같은 해의 다섯 값이
     서로 덮어썼고, **어느 값이 남았는지도 알 수 없었다.**
     자살률을 못 찾은 것이 이 때문이다. 합치면 우리가 고른 것이 된다. */
  const by = new Map();
  for (const r of rows) {
    const a = String(r.itemNm || '').trim(), b = String(r.valNm || '').trim();
    const it = (a && b && a !== b) ? `${a} · ${b}` : (a || b);
    const prd = String(r.descDt || '').trim();
    const val = String(r.nmbrVal == null ? '' : r.nmbrVal).trim();
    if (!it || !/^\d{4}$/.test(prd) || !val || !/^-?[\d.,]+$/.test(val)) continue;
    if (!by.has(it)) by.set(it, []);
    by.get(it).push([prd, val.replace(/,/g, '')]);
  }
  let anyKept = false, nm = null;
  for (const [it, vals] of by) {
    if (SIDO.test(it)) { regional++; continue }
    const years = [...new Set(vals.map(v => v[0]))];
    if (years.length < MIN_YEARS) { tooShort++; continue }
    if (nm === null) { nm = await idxName(String(i)); await sleep(GAP); if (nm) named++ }
    const key = `idx:${i}:${it}`;
    insT.run(key, 'INDEX', String(i), nm || it, null, it, null, '전국', '', '지표누리',
      `https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=${i}`, NOW);
    for (const [p, v] of vals) insV.run(key, p, v);
    kept++; anyKept = true;
  }
  if (anyKept && kept % 20 === 0) { db.exec('COMMIT'); db.exec('BEGIN') }
  if (scanned % 200 === 0) process.stdout.write(`\r  ${scanned}/${TO - FROM + 1} · 데이터 ${withData} · 담음 ${kept}   `);
}
db.exec('COMMIT');
console.log(`\n\n  훑은 idxCd ${scanned} · 데이터 있음 ${withData}`);
console.log(`  담은 갈래 ${kept} · 지표명 받은 것 ${named}`);
console.log(`  ${MIN_YEARS}년 미만이라 버린 것 ${tooShort} · 지역별이라 버린 것 ${regional}`);
const tot = db.prepare("SELECT COUNT(*) c FROM stat_table WHERE org_id='INDEX'").get().c;
console.log(`\n창고 stat_table ${tot}건`);
db.close();
