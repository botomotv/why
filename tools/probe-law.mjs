/* 법제처(국가법령정보) 탐침 — **읽기만 한다. 창고에 아무것도 안 쓴다.**
 *
 * 묻는 것:
 *   1. 대통령령·시행령을 몇 건 받을 수 있나
 *   2. 공포일 · 소관부처가 응답에 있나 (2관문 · 1관문에 필요하다)
 *   3. 법안명에 없던 말('방첩' 등)이 대통령령 이름에는 있나
 *
 *   node tools/probe-law.mjs
 *   LAW_OC=xxx node tools/probe-law.mjs
 */
const OC = process.env.LAW_OC || 'botomotv';
const BASE = 'http://www.law.go.kr/DRF/lawSearch.do';
const GAP = Number(process.env.LAW_GAP || 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function search(params) {
  const u = new URL(BASE);
  u.searchParams.set('OC', OC);
  u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const res = await fetch(u, { headers: { 'User-Agent': 'why-map/probe' } });
  const txt = await res.text();
  let j = null;
  try { j = JSON.parse(txt) } catch { }
  return { status: res.status, json: j, raw: txt.slice(0, 300), url: u.toString() };
}

const first = o => (o && typeof o === 'object') ? o[Object.keys(o)[0]] : null;
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);

(async () => {
  console.log(`법제처 탐침 · OC=${OC}\n`);

  /* ── 1. 법령 종류별 건수 ── */
  console.log('── 1. 법령 종류별 건수 (target=law) ──');
  /* 법령구분(knd) 코드를 모른다. 검색어 없이 한 쪽만 받아 응답 모양부터 본다. */
  const probe = await search({ target: 'law', display: 5, page: 1 });
  if (probe.status !== 200 || !probe.json) {
    console.log(`  실패 status=${probe.status}`);
    console.log(`  ${probe.raw}`);
    console.log(`  ${probe.url}`);
    process.exit(0);
  }
  const root = first(probe.json);
  const rows = arr(root && (root.law || root.Law || root.LAW));
  console.log(`  전체 건수(totalCnt) : ${root && (root.totalCnt ?? '?')}`);
  if (rows.length) {
    console.log(`  응답 필드           : ${Object.keys(rows[0]).join(' · ')}`);
    console.log(`  첫 행               : ${JSON.stringify(rows[0], null, 1).slice(0, 700)}`);
  } else {
    console.log(`  행이 없다. 응답 앞부분: ${probe.raw}`);
  }

  /* ── 2. 종류별로 나눠 세기 ── */
  await sleep(GAP);
  console.log('\n── 2. 종류별 건수 ──');
  for (const [nm, knd] of [['법률', '001002'], ['대통령령', '001003'], ['총리령', '001004'], ['부령', '001005']]) {
    const r = await search({ target: 'law', display: 1, page: 1, knd });
    const t = first(r.json);
    console.log(`  ${nm.padEnd(6)} knd=${knd}  totalCnt=${t ? (t.totalCnt ?? '?') : '실패 ' + r.status}`);
    await sleep(GAP);
  }

  /* ── 3. 법안명에 없던 말이 법령 이름에는 있나 ── */
  console.log('\n── 3. 국회 법안명에 0건이던 말들 ──');
  for (const q of ['방첩', '군사안보지원', '기무', '정보사령부', '경계', '병력', '직제']) {
    const r = await search({ target: 'law', display: 5, page: 1, query: q });
    const t = first(r.json);
    const rs = arr(t && (t.law || t.Law));
    const names = rs.map(x => x['법령명한글'] || x['법령명'] || '').filter(Boolean);
    console.log(`  ${String(t ? (t.totalCnt ?? '?') : '실패').padStart(5)}  '${q}'` +
      (names.length ? `   예: ${names.slice(0, 3).join(' / ').slice(0, 90)}` : ''));
    await sleep(GAP);
  }
})();
