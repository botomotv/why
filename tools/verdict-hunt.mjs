/* 형량이 빈 사건의 **확정 판결을 찾아본다.**
 *
 *   node tools/verdict-hunt.mjs --dry
 *   node tools/verdict-hunt.mjs          db/verdict_hand.json 에 후보를 적는다
 *
 * ── 어떻게 찾나 ──
 *   판례의 사건명은 **죄명**이라 사건 이름으로는 못 찾는다(창고 20만건에서 「삼풍」 0건).
 *   그래서 세 관문을 통과한 것만 후보로 삼는다:
 *     ① 죄명이 겹친다      — 목록에 사람이 적어 둔 죄명
 *     ② 시기가 맞는다      — 사건 해 ~ +9년 안에 선고된 **대법원** 판결
 *     ③ **본문에 그 사건의 표지가 있다** — 지명·시설 이름 같은 고유한 말
 *
 *   ③ 이 핵심이다. ①②만으로는 남의 사건이 붙는다 —
 *   실측: 「판교 환풍구 붕괴」 후보 두 건은 본문에 「판교」·「환풍구」 가 **하나도 없었다.**
 *   그대로 붙였으면 우리가 만든 거짓 연결이 된다. 표지가 없으면 **버린다.**
 *
 * ── 형량은 주문에서만 ──
 *   대법원 주문이 상고기각이어야 확정이다. 형량은 **원심 주문**에 있으므로 원심을 다시 받는다.
 *   원심이 법제처에 없으면 「확정은 확인했지만 형량은 못 읽었다」 로 남긴다. 지어내지 않는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFinalDismissal, lowerCourt, pickVerdict, penShort, junLines } from './lib/verdict.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const SRC = path.join(ROOT, 'db', 'event_candidates.json');
const OUT = path.join(ROOT, 'db', 'verdict_hand.json');
const OC = process.env.LAW_OC || 'botomotv';
const DRY = process.argv.includes('--dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 사건 이름에서 **고유한 표지**를 뽑는다. 흔한 말은 표지가 아니다. */
const STOP = new Set(['사건', '사고', '참사', '사태', '논란', '의혹', '화재', '붕괴', '침몰', '추락',
  '폭발', '살인', '테러', '유출', '피격', '포격', '대한민국', '한국', '정부', '국회', '아동', '학대',
  '노동자', '어린이', '여성', '경찰', '군인', '병원', '학교', '공장', '건물', '사망', '집단']);
const marks = name => [...new Set(String(name).split(/[\s·\-—()]+/)
  .map(w => w.replace(/(사건|사고|참사|사태)$/, ''))
  .filter(w => w.length >= 2 && !STOP.has(w)))];

const db = new DatabaseSync(DB, { readOnly: true });
const E = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const conf = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const done = new Set((conf.cases || []).map(c => c.이름));

async function prec(sn) {
  try {
    const r = await fetch(`https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&type=JSON&ID=${sn}`);
    return (JSON.parse(await r.text())).PrecService || null;
  } catch { return null }
}
async function byNo(no) {
  try {
    const r = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=prec&type=JSON&nb=${encodeURIComponent(no)}&display=3`);
    let l = (JSON.parse(await r.text()))?.PrecSearch?.prec || [];
    if (!Array.isArray(l)) l = [l];
    return l[0] ? l[0].판례일련번호 : null;
  } catch { return null }
}

/* ── **총칭에는 판결 하나를 붙이지 않는다** ──
   「저축은행 사태」 는 여러 저축은행의 부실을 묶어 부르는 말이다. 그중 한 건의 형량을
   그 사태 전체의 형량인 것처럼 적으면 **읽는 사람이 오해한다.**
   한 번에 일어난 하나의 사건만 붙인다. 이름이 사태·논란·의혹·파동·대란으로 끝나면 뺀다. */
const LUMP = /(사태|논란|의혹|파동|대란|확산|급증)$/;
const targets = E.filter(e => e.판례 === 'need-no' && e.죄명 && !done.has(e.이름) && !LUMP.test(e.이름));
console.log(`형량이 빈 사건 중 죄명이 적힌 것 ${targets.length}건을 훑는다`);

const found = [], noMark = [], noCand = [];
for (const e of targets) {
  const ks = String(e.죄명).split(/[·,]/).map(x => x.trim().replace(/\s+/g, '')).filter(x => x.length >= 3);
  const mk = marks(e.이름);
  if (!ks.length || !mk.length) { noCand.push(e.이름); continue }
  /* ①② 죄명 + 대법원 + 시기 */
  let rows = [];
  for (const k of ks.slice(0, 2)) {
    rows = rows.concat(db.prepare(
      `SELECT case_sn, case_no, end_dt FROM court_case
        WHERE court='대법원' AND REPLACE(case_nm,' ','') LIKE ? AND yr BETWEEN ? AND ? LIMIT 6`
    ).all('%' + k + '%', Number(e.연도), Number(e.연도) + 9));
  }
  const seen = new Set(); rows = rows.filter(r => !seen.has(r.case_sn) && seen.add(r.case_sn));
  if (!rows.length) { noCand.push(e.이름); continue }

  /* ③ 본문에 표지가 있나 */
  let hit = null;
  for (const r of rows.slice(0, 6)) {
    const p = await prec(r.case_sn); await sleep(280);
    if (!p) continue;
    const b = String(p.판례내용 || '').replace(/<[^>]+>/g, ' ');
    const got = mk.filter(m => b.indexOf(m) >= 0);
    if (got.length >= Math.min(2, mk.length)) { hit = { p, r, got }; break }
  }
  if (!hit) { noMark.push(e.이름); continue }

  const body = String(hit.p.판례내용 || '');
  const jl = junLines(body);
  const fin = isFinalDismissal(jl);
  const low = lowerCourt(body);
  const rec = {
    이름: e.이름, 사건번호: hit.p.사건번호, 법원: '대법원',
    확정일: String(hit.p.선고일자 || '').replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3'),
    확정: fin, 표지: hit.got.join('·'),
    url: `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${hit.r.case_sn}&type=HTML`
  };
  if (!fin) { rec.비고 = '대법원이 원심을 파기했다 — 확정 전이라 형량을 쓰지 않는다'; found.push(rec);
    console.log(`  ✓ ${e.이름} · ${rec.사건번호} · 확정 전 (표지 ${rec.표지})`); continue }
  /* 형량은 원심 주문에 있다 */
  if (low) {
    const lsn = await byNo(low.no); await sleep(280);
    if (lsn) {
      const lp = await prec(lsn); await sleep(280);
      const pv = lp ? pickVerdict(String(lp.판례내용 || '')) : null;
      if (pv && pv.ok) {
        rec.형량 = penShort(pv.verdict);
        rec.형량출처 = `${lp.법원명 || ''} ${low.no} 주문`;
        rec.원심url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${lsn}&type=HTML`;
      }
    }
  }
  if (!rec.형량) rec.비고 = `확정은 확인했지만 형량은 원심(${low ? low.no : '?'}) 주문에 있고 그 판결문이 법제처 공개 판례에 없다`;
  found.push(rec);
  console.log(`  ✓ ${e.이름} · ${rec.사건번호} · ${rec.확정 ? '확정' : '확정 전'}${rec.형량 ? ' · ' + rec.형량 : ' · 형량 못 읽음'} (표지 ${rec.표지})`);
}
db.close();

console.log(`\n찾음 ${found.length} · 표지가 없어 버림 ${noMark.length} · 후보 자체가 없음 ${noCand.length}`);
if (noMark.length) console.log(`  버린 것: ${noMark.slice(0, 8).join(' · ')}${noMark.length > 8 ? ' 외' : ''}`);
if (DRY) process.exit(0);
conf.cases = (conf.cases || []).concat(found);
fs.writeFileSync(OUT, JSON.stringify(conf, null, 1), 'utf8');
console.log(`db/verdict_hand.json 에 ${found.length}건 더함 (전체 ${conf.cases.length})`);
