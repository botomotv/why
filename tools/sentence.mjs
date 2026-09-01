/* 확정 판결에서 **형량만** 뽑는다.
 *
 *   node tools/sentence.mjs --find 살인 2024        죄명·연도로 후보를 찾는다
 *   node tools/sentence.mjs --case 2024고합637       사건번호 하나를 받아 형량을 본다
 *   node tools/sentence.mjs --dry                    db/crime_cases.json 을 훑기만 한다
 *   node tools/sentence.mjs                          받아서 db/crime_cases.json 을 채운다
 *
 * ── 규칙 8 을 어떻게 지키나 ──
 * 법제처 `판례내용` 에는 **검사·변호사·피고인 이름이 그대로** 있다:
 *     【검 사】 차병곤 외 1인【변 호 인】 변호사 홍푸른 외 1인
 * 그래서 **전문을 담지 않는다.** 【주 문】 ~ 【이 유】 구간만 잘라내고,
 * 그 안에서 **형량 문장만** 정규식으로 뽑는다. 나머지는 그 자리에서 버린다.
 *
 * 범죄사실도 안 담는다 — 실명이 있고, 피해 내용을 자세히 적지 않는다는 약속도 있다.
 * 압수물 목록(「과도 1자루」)도 안 담는다. 그건 형량이 아니라 사건 묘사다.
 *
 * ── 「사건 이름 + 시기 + 죄명」 만으로는 못 찾는다 ──
 * 판례의 `사건명` 은 **죄명**이지 「n번방」 같은 언론 명칭이 아니다.
 * 죄명으로 좁혀도 수백 건이고, 그중 어느 것인지 가릴 단서(피고인 이름·사실관계)는
 * 규칙 8 이 금지한다. 그래서 `--find` 는 **후보를 좁혀 보여줄 뿐** 고르지 않는다.
 * 사람이 사건번호를 확인해 넣는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OUT = path.join(ROOT, 'db', 'crime_cases.json');
const OC = process.env.LAW_OC || 'botomotv';
const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const val = f => { const i = ARGV.indexOf(f); return i < 0 ? null : ARGV[i + 1] };

/* ── 사람 이름이 섞였나 ── 검사 47 과 같은 잣대다.
   **띄어쓰기를 반드시 요구한다.** `\s*` 로 뒀더니 죄명 「증인도피」를
   '증인'+'도피' 로 읽은 적이 있다. 그리고 익명 마스크(○)가 있으면 그 자리가 사람 이름이다. */
const SURNAME = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구신임나전민유진지엄채원천방공현함변염양변여추도소석선설마길연위표명기반왕금옥육인맹제모장남탁국여진어은편구';
/* ── **조사를 허용해야 한다** ──
   처음엔 이름 뒤에 `(?![가-힣])` 를 걸었다. 그런데 실제 주문은
   「검사 차병곤**의**」·「피고인 박지훈**을**」처럼 **조사가 붙는다.**
   그래서 부정 전방탐색에 걸려 **하나도 못 잡았다** —
   실패를 주입해 보니 「검사 차병곤」·「변호사 홍푸른」이 그대로 통과했다.
   30/30 을 뽑고 이름 0건이라던 결과는 **주문에 이름이 없었을 뿐**이지
   검사가 잡는다는 증명이 아니었다.
   조사·구두점·괄호·끝을 허용한다. 「피고인 1을」 같은 번호는 성씨가 아니라 안 걸린다. */
const NAME_RE = new RegExp(`(?:피\\s*고\\s*인|검\\s*사|변\\s*호\\s*인|변호사|청구인|원고|피고|증인|참고인|고소인|피해자|신청인|항고인|상고인)\\s+[${SURNAME}][가-힣]{1,2}(?=[을를이가은는의에과와도만및·,\\s.)\\]]|$)`);
const MASK_RE = /[가-힣]\s*○\s*[가-힣]?/;
const hasName = s => NAME_RE.test(s) || MASK_RE.test(s);

/* ── 형량 문장 ──
   **주문에 적힌 그대로만 뽑는다.** 「보통 몇 년」 같은 평균은 만들지 않는다.

   처음엔 「피고인을 징역 N년에 처한다」 같은 **꼴을 하나씩 정규식으로** 잡았다.
   그런데 주문의 표현이 생각보다 다양해 30건 중 5건을 놓쳤다:
       피고인 1을 징역 10개월에, 피고인 2를 징역 5개월에 각 처한다   (여럿을 한 문장에)
       피고인의 항소를 기각한다                                     (항소심)
       나머지 상고 및 피고인 2의 상고를 각 기각한다                  (일부만 기각)
       원심판결 중 무죄 부분을 파기하고 … 환송한다                   (일부 파기)
   꼴을 늘려 쫓아가면 끝이 없다.

   그래서 **문장 단위로 쪼개고 형벌 낱말이 든 문장을 담는다.** 놓치는 것이 적고,
   이름 검사는 문장마다 하므로 안전은 그대로다.
   몰수·추징은 뺀다 — 「압수된 과도 1자루」처럼 **사건 묘사가 딸려 온다.** */
const PENAL = /(징역|금고|벌금|구류|사형|무기|집행을?\s*[0-9]*\s*년?간?\s*유예|무죄|면소|공소기각|기각한다|파기|환송|형(?:의\s*선고)?을\s*면제)/;
const NOTPENAL = /(몰수한다|추징한다|압수|가납|소송비용|보호관찰을\s*명|이수를\s*명|취업제한|공개를?\s*명|고지를?\s*명)/;

function pickVerdict(body) {
  /* ① 주문 구간만 자른다. 【이 유】부터는 범죄사실이라 손대지 않는다. */
  const m = body.match(/【\s*주\s*문\s*】([\s\S]*?)(?=【\s*이\s*유\s*】|$)/);
  if (!m) return { ok: 0, why: '주문 구간을 못 찾았다' };
  const juntext = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  /* ② 문장으로 쪼갠다 — 주문은 「…한다.」 로 끝난다 */
  const sents = juntext.split(/(?<=다\.)\s+/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const line of sents) {
    if (!PENAL.test(line)) continue;
    if (NOTPENAL.test(line)) continue;
    /* ③ **이름이 섞이면 그 문장을 통째로 버린다.**
          오려내다 놓치면 이름이 지도에 올라간다 — 남기는 쪽이 아니라 버리는 쪽으로 기운다. */
    if (hasName(line)) continue;
    if (line.length > 160) continue;   /* 너무 길면 형량이 아니라 설명이다 */
    if (!out.includes(line)) out.push(line);
  }
  if (!out.length) return { ok: 0, why: '주문에서 형량 문장을 못 찾았다', jun: juntext.slice(0, 120) };
  return { ok: 1, verdict: out };
}

async function fetchPrec(id) {
  const u = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${id}&type=JSON`;
  const r = await fetch(u, { headers: { 'User-Agent': 'why-map/1.0' } });
  if (!r.ok) return { err: `HTTP ${r.status}` };
  const j = await r.json().catch(() => null);
  const p = j && (j.PrecService || j);
  if (!p || !p.판례내용) return { err: '판례내용이 없다' };
  return {
    caseNo: String(p.사건번호 || ''), caseNm: String(p.사건명 || ''),
    court: String(p.법원명 || ''), dt: String(p.선고일자 || ''),
    body: String(p.판례내용 || ''),
  };
}

const db = fs.existsSync(DB) ? new DatabaseSync(DB, { readOnly: true }) : null;

/* ── --find : 죄명·연도로 후보를 좁힌다 ── */
if (has('--find')) {
  if (!db) { console.error('창고가 없다'); process.exit(2) }
  const word = ARGV[ARGV.indexOf('--find') + 1];
  const yr = ARGV[ARGV.indexOf('--find') + 2];
  if (!word) { console.error('  node tools/sentence.mjs --find <죄명> [연도]'); process.exit(2) }
  const rows = db.prepare(
    `SELECT case_sn,case_no,case_nm,court,yr FROM court_case
      WHERE kind='prec' AND case_nm LIKE ? ${yr ? 'AND yr BETWEEN ? AND ?' : ''}
      ORDER BY yr DESC LIMIT 40`)
    .all(...(yr ? [`%${word}%`, +yr - 1, +yr + 1] : [`%${word}%`]));
  console.log(`「${word}」${yr ? ` · ${yr}±1년` : ''} 후보 ${rows.length}건`);
  console.log('**우리가 고르지 않는다.** 사건번호를 확인해서 db/crime_cases.json 에 넣어라.\n');
  const lower = rows.filter(r => /지방법원|지원/.test(r.court || ''));
  console.log(`  1심(지방법원) ${lower.length}건 — 형량은 여기 있다`);
  rows.forEach(r => console.log(`   ${String(r.yr).padEnd(5)} ${(r.court || '').padEnd(14)} ${(r.case_no || '').padEnd(16)} ${r.case_nm}`));
  process.exit(0);
}

/* ── --case : 사건번호(또는 일련번호) 하나를 받아 형량을 본다 ── */
if (has('--case')) {
  const q = val('--case');
  let sn = /^\d+$/.test(q) ? q : null;
  if (!sn) {
    if (!db) { console.error('창고가 없어 사건번호를 일련번호로 못 바꾼다'); process.exit(2) }
    const r = db.prepare(`SELECT case_sn,case_nm,court,yr FROM court_case WHERE kind='prec' AND case_no=?`).all(q);
    if (!r.length) { console.log(`창고에 「${q}」 가 없다. 법제처가 안 주는 판결일 수 있다`); process.exit(1) }
    if (r.length > 1) console.log(`같은 사건번호가 ${r.length}건이다 — 전부 본다`);
    sn = r[0].case_sn;
    r.forEach(x => console.log(`  ${x.yr} ${x.court} ${x.case_nm}`));
  }
  const p = await fetchPrec(sn);
  if (p.err) { console.log(`못 받았다: ${p.err}`); process.exit(1) }
  const v = pickVerdict(p.body);
  console.log(`\n${p.court} ${p.caseNo} (${p.dt})`);
  console.log(`  사건명 ${p.caseNm}`);
  if (v.ok) v.verdict.forEach(x => console.log(`  형량   ${x}`));
  else console.log(`  형량   못 뽑았다 — ${v.why}${v.jun ? `\n         주문 앞부분: ${v.jun}` : ''}`);
  process.exit(0);
}

/* ── 목록을 받아 채운다 ── */
let spec = { _: [], cases: [] };
try { spec = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch {}
if (!spec.cases || !spec.cases.length) {
  console.log('db/crime_cases.json 에 사건이 없다. 아래 형식으로 넣어라:\n');
  console.log(JSON.stringify({
    cases: [{
      id: 'c_example', lab: '사건 이름(짧게)', yr: '2020',
      charge: '죄명', caseNo: '2024고합637',
      court: '서울남부지방법원', finalNo: '2025도1234',
      why: '왜 넣는지 · 어디서 사건번호를 확인했는지',
    }]
  }, null, 2));
  process.exit(0);
}
const DRY = has('--dry');
const done = [];
for (const c of spec.cases) {
  if (!c.caseNo) { console.log(`  ! ${c.id} — 사건번호가 없다. 죄명만으로는 못 찾는다 (--find 로 후보를 좁혀라)`); continue }
  if (DRY) { console.log(`  ${c.id} ${c.caseNo} (받지 않음)`); continue }
  let sn = null;
  if (db) {
    const r = db.prepare(`SELECT case_sn FROM court_case WHERE kind='prec' AND case_no=?`).get(c.caseNo);
    sn = r && r.case_sn;
  }
  if (!sn) { console.log(`  ! ${c.id} — 창고에 ${c.caseNo} 가 없다`); continue }
  const p = await fetchPrec(sn);
  if (p.err) { console.log(`  ! ${c.id} — ${p.err}`); continue }
  const v = pickVerdict(p.body);
  if (!v.ok) { console.log(`  ! ${c.id} — ${v.why}`); continue }
  c.verdict = v.verdict;
  c.court = p.court; c.dt = p.dt; c.caseNm = p.caseNm;
  c.src = '출처 · 법제처 국가법령정보 공동활용 (법원 판례)';
  c.url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${sn}&type=HTML`;
  done.push(c);
  console.log(`  ${c.id} ${p.court} ${p.caseNo} → ${v.verdict.join(' / ')}`);
  await new Promise(r => setTimeout(r, 400));
}
if (!DRY) {
  fs.writeFileSync(OUT, JSON.stringify(spec, null, 2), 'utf8');
  console.log(`\n${done.length}/${spec.cases.length}건에 형량을 채웠다 → db/crime_cases.json`);
}
if (db) db.close();
