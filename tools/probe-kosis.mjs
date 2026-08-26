/* KOSIS(국가통계포털) 탐침 — **읽기만 한다. 창고에 아무것도 안 쓴다.**
 *
 *   read -s KOSIS_KEY && export KOSIS_KEY && node tools/probe-kosis.mjs
 *
 * 묻는 것 — 결과 노드로 쓰려면 셋이 필요하다.
 *   1. **시계열이어야 한다.** 한 시점 값만으로는 "왜 이렇게 됐나" 를 못 묻는다
 *   2. **원자료 링크**를 걸 수 있어야 한다 (규칙 7 · 출처)
 *   3. **갱신 주기**가 있어야 한다. 한 번 받고 끝나면 지도가 늙는다
 *
 * 응답 필드 이름은 **추측하지 않는다.** 받아서 그대로 찍는다.
 */
const KEY = process.env.KOSIS_KEY;
const GAP = Number(process.env.KOSIS_GAP || 400);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!KEY) {
  console.error(`KOSIS_KEY 가 없습니다.

  read -s KOSIS_KEY && export KOSIS_KEY && node tools/probe-kosis.mjs

키는 화면에 찍히지 않고 이 셸에만 남습니다. 창고에도 저장하지 않습니다.`);
  process.exit(1);
}

const BASE = 'https://kosis.kr/openapi';
async function call(path, params) {
  const u = new URL(BASE + path);
  u.searchParams.set('apiKey', KEY);
  u.searchParams.set('format', 'json');
  u.searchParams.set('jsonVD', 'Y');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const shown = u.toString().replace(encodeURIComponent(KEY), '***').replace(KEY, '***');
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'why-map/probe' } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t) } catch { }
    return { status: r.status, json: j, raw: t.slice(0, 300), url: shown };
  } catch (e) { return { status: 0, json: null, raw: String(e).slice(0, 200), url: shown } }
}
const show = (nm, r) => {
  console.log(`\n── ${nm}`);
  console.log(`   ${r.url}`);
  console.log(`   status ${r.status}`);
  if (!r.json) { console.log(`   (JSON 아님) ${r.raw.replace(/\s+/g, ' ')}`); return null }
  const arr = Array.isArray(r.json) ? r.json : [r.json];
  if (arr[0] && (arr[0].err || arr[0].errMsg)) {
    console.log(`   오류: ${JSON.stringify(arr[0]).slice(0, 200)}`); return null;
  }
  console.log(`   행 ${arr.length}`);
  if (arr[0]) console.log(`   필드: ${Object.keys(arr[0]).join(' · ')}`);
  if (arr[0]) console.log(`   첫 행: ${JSON.stringify(arr[0], null, 1).slice(0, 700)}`);
  return arr;
};

(async () => {
  console.log('KOSIS 탐침 — 응답 필드는 받은 그대로 찍는다 (추측하지 않는다)');

  /* ① 통계표 목록 — 무엇을 받을 수 있나 */
  show('통계목록 (statisticsList.do · vwCd=MT_ZTITLE 주제별)',
    await call('/statisticsList.do', { method: 'getList', vwCd: 'MT_ZTITLE', parentListId: 'A' }));
  await sleep(GAP);

  /* ② 통계표 검색 — docs/다음단계.md 의 후보 목록이 실제로 검색되나 */
  const WANT = ['합계출산율', '최저임금', '자살률', '청년 실업률', '가계부채',
                '아파트 매매가격', '비정규직', '고독사', '사교육비', '지역소멸'];
  console.log('\n\n══ 찾을 목록이 실제로 검색되나 (docs/다음단계.md) ══');
  for (const q of WANT) {
    const r = await call('/statisticsSearch.do', { method: 'getList', searchNm: q, startCount: 1, resultCount: 3 });
    const a = Array.isArray(r.json) ? r.json : null;
    if (!a) { console.log(`  ${q.padEnd(12)} 실패 ${String(r.raw).replace(/\s+/g, ' ').slice(0, 70)}`); }
    else if (a[0] && (a[0].err || a[0].errMsg)) { console.log(`  ${q.padEnd(12)} 오류 ${JSON.stringify(a[0]).slice(0, 90)}`) }
    else {
      const f = a[0] || {};
      console.log(`  ${q.padEnd(12)} ${a.length}건  ${(f.TBL_NM || f.tblNm || '') .slice(0, 40)}` +
                  `  [orgId=${f.ORG_ID || f.orgId || '?'} tblId=${f.TBL_ID || f.tblId || '?'}]`);
      if (q === WANT[0]) console.log(`     필드: ${Object.keys(f).join(' · ')}`);
    }
    await sleep(GAP);
  }

  /* ③ 시계열 — 한 표를 실제로 받아 본다. 파라미터 이름을 확인한다 */
  console.log('\n\n══ 시계열을 받을 수 있나 ══');
  const s = await call('/statisticsSearch.do', { method: 'getList', searchNm: '합계출산율', startCount: 1, resultCount: 1 });
  const hit = Array.isArray(s.json) ? s.json[0] : null;
  if (!hit || hit.err) { console.log('  검색이 안 돼서 시계열을 못 시도했다'); }
  else {
    const orgId = hit.ORG_ID || hit.orgId, tblId = hit.TBL_ID || hit.tblId;
    console.log(`  대상: orgId=${orgId} tblId=${tblId} ${(hit.TBL_NM || hit.tblNm || '')}`);
    await sleep(GAP);
    show('시계열 (statisticsParameterData.do)', await call('/Param/statisticsParameterData.do', {
      method: 'getList', apiKey: KEY, itmId: 'ALL', objL1: 'ALL',
      orgId, tblId, prdSe: 'Y', startPrdDe: '2015', endPrdDe: '2024' }));
    await sleep(GAP);
    show('표 메타 (statisticsExplData.do)', await call('/statisticsExplData.do', {
      method: 'getMeta', type: 'TBL', orgId, tblId }));
  }
  console.log('\n\n판단할 것 — 시계열 O/X · 원자료 링크 O/X · 갱신 주기 O/X');
})();
