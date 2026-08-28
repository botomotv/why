/* 사건(헌재결정례·판례) → 지도. 창고 court_case 에서 관문을 통과한 것만 올린다.
 *
 *   node tools/link-case.mjs --dry     세기만 한다
 *   node tools/link-case.mjs           창고 link 표에 쓰고 index.html 에 내보낸다
 *
 * 관문 두 가지 — **근거의 세기가 다르다. 섞지 않고 따로 센다.**
 *
 *   A. 사건명에 법 이름이 그대로 있다     → 그 법률 노드에 잇는다
 *      "구 국적법 부칙 제7조 제1항 위헌소원" 은 국적법을 다툰 것이다.
 *      추측이 아니라 재판부가 스스로 그 법을 적은 것이다. **가장 센 근거다.**
 *   B. 사건명에 결과의 핵심어가 있고 시기가 겹친다 → 그 결과에 잇는다
 *      법안 3관문과 같은 세기다. 자동 법률에 쓰는 것과 같은 잣대다.
 *
 * 지키는 것
 *  - role 은 topic 하나다. **인과가 아니라 '같은 주제' 다.** 헌재가 법을 심판한 것은
 *    사실이지만, 그것이 결과 숫자를 만들었다는 주장은 우리가 하지 않는다.
 *  - link.why 를 반드시 채운다. 근거를 못 대는 선은 넣지 않는다.
 *  - **전문을 싣지 않는다.** 사건명·사건번호·날짜만 내보낸다. 창고에도 전문은 없다.
 *  - 연도가 사건번호(접수연도)에서 온 것은 화면에 그렇게 적는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const YEARS = Number(process.env.CASE_YEARS || 3);
const RULE_A = 'case_by_law_name', RULE_B = 'case_by_keyword_and_year';
const RULE_C = 'case_by_reviewed_article';
const NOW = new Date().toISOString().slice(0, 10);
const KIND = { detc: '헌법재판소 결정', prec: '법원 판례' };
/* 헌재 결론(위헌·합헌·헌법불합치·각하·기각). 결정요지의 마지막 문장에서만 찾는다 —
   본문 전체에서 찾으면 참조판례 인용에 걸린다. 자세한 이유는 tools/detc-verdict.mjs. */
const { verdictOf } = await import('./detc-verdict.mjs');

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

/* 지도에 이미 있는 것을 index.html 에서 직접 읽는다. 여기서 베껴 쓰면 화면과 갈라진다. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const laws = [...html.matchAll(/\{id:'(auto_[^']*)',t:'bill',auto:1[^}]*?lab:'([^']*)'[^}]*?yr:'(\d{4})'/g)]
  .map(m => ({ id: m[1], lab: m[2], yr: +m[3] }));
const cmap = html.match(/var CATMAP\s*=\s*\{([\s\S]*?)\n\};/);
const catOf = {};
for (const g of cmap[1].matchAll(/['"]?([\w]+)['"]?\s*:\s*\[([^\]]*)\]/g))
  for (const id of g[2].split(',').map(x => x.replace(/['\s]/g, '')).filter(Boolean))
    (catOf[id] = catOf[id] || []).push(g[1]);
const results = [...html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?lab:'([^']*)'[\s\S]{0,300}?yr:'(\d{4})',keys:\[([^\]]*)\]/g)]
  .map(m => ({ id: m[1], lab: m[2], yr: +m[3], cats: catOf[m[1]] || [],
    keys: m[4].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean) }));
let catKeys = {};
try { catKeys = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'cat_keys.json'), 'utf8')); delete catKeys._ } catch { }
/* ── 사건에는 분야 사전을 쓰지 않는다 ──
   법안은 이름이 「○○법 일부개정법률안」 이라 분야 사전(넓은 말)이 잘 맞는다.
   사건 이름은 「손해배상(기)」·「부당이득금」 이라 넓은 말을 대면 무관한 것이 무더기로 온다.
   실측: 넓은 말로 21,016건이 붙어 사건 노드가 19,148개가 됐다 — 대부분 근거가 약하다.
   그래서 사건은 **결과 노드가 직접 정한 좁은 핵심어**만 쓴다. 사람이 고른 말이다. */
for (const r of results) r.wide = r.keys;

/* 법 이름이 긴 것부터 본다 — '국적법' 이 '국적법시행령' 을 먼저 삼키면 안 된다 */
const lawsBy = [...laws].sort((a, b) => b.lab.length - a.lab.length);

const cases = db.prepare(
  `SELECT case_sn,kind,case_no,case_nm,end_dt,yr,yr_src,court,ctype,src_url
     FROM court_case WHERE case_nm<>'' AND yr IS NOT NULL`).all();
console.log(`사건 ${cases.length.toLocaleString()}건 · 법률 ${laws.length}개 · 결과 ${results.length}개` +
            ` · 2관문 ±${YEARS}년${DRY ? '  (--dry)' : ''}\n`);

/* ── 판시사항에도 사람 이름이 있다 (규칙 8) ──
   "판시사항엔 이름이 없다" 고 넘겨짚었다가 검사 47 이 진짜를 하나 잡았다:
     [당사자]청구인 박○현 국선대리인 변호사 송한사(사임) …
   헌재 판시사항 앞머리에 당사자·대리인 블록이 붙는 경우가 있다.
   **수술하듯 오려내지 않고 그 판시사항을 통째로 안 쓴다.**
   오려내다 놓치면 이름이 지도에 올라간다 — 남는 쪽이 아니라 버리는 쪽으로 기운다.
   몇 개를 버렸는지는 아래에서 밝힌다. */
let gistDropped = 0;
/* **익명 마스크(○)가 있으면 그 자리가 사람 이름이다.**
   `청구인 김○현` 처럼 성만 남기고 가린 꼴이 판시사항에 그대로 온다.
   성 한 글자도 이름이다 — 사건번호와 함께 있으면 누구인지 좁혀진다.
   그래서 ○ 가 하나라도 있으면 그 판시사항은 안 쓴다. */
const NAME_RISK = /[○●◯]|\[당사자\]|대리인|변호사|청구인\s*[가-힣]|피청구인\s*[가-힣]|피고인\s*[가-힣]{2,3}(?![가-힣])|증인\s*[가-힣]{2,3}(?![가-힣])/;
function safeGist(g) { if (NAME_RISK.test(g)) { gistDropped++; return false } return true }

const nodes = new Map(), links = [];
/* **같은 사건번호는 하나만.** 법제처가 같은 사건을 일련번호만 달리해 두 번 주는 경우가 있다
   (재심·병합 등). 그대로 두면 목록에 같은 줄이 두 번 뜬다 — 사람에게는 그냥 중복이다.
   실측 35건. 검사 51 이 이름+사건번호가 같은 것을 FAIL 로 잡는다. */
const byNoDedup = new Map();
const add = c => {
  if (nodes.has(c.case_sn)) return nodes.get(c.case_sn);
  const noKey = c.kind + '|' + String(c.case_no || '').replace(/\s/g, '');
  if (c.case_no && byNoDedup.has(noKey)) { const o = byNoDedup.get(noKey); nodes.set(c.case_sn, o); return o }
  const byNo = c.yr_src === 'caseno';
  const n = {
    id: 'case_' + c.kind + '_' + c.case_sn, t: 'event', auto: 1, side: 'gov',
    lab: c.case_nm.length > 34 ? c.case_nm.slice(0, 33) + '…' : c.case_nm,
    title: c.case_nm, yr: String(c.yr),
    ekind: `${c.yr}년 · ${KIND[c.kind] || c.kind}` + (byNo ? ' · 연도는 사건 접수 연도' : ''),
    off: `${KIND[c.kind] || c.kind} · ${c.case_no}`,
    tip: `${KIND[c.kind] || c.kind}입니다. 사건번호는 ${c.case_no}입니다.`,
    /* 사건명이 400자를 넘는 것이 있다 — 죄명과 피고인 번호를 다 나열한 것이다.
       (「…위반(횡령)[피고인4·5·6…에대한예비적죄명…]」) 전문이 아니라 이름 자체가 길다.
       그래도 카드에 그대로 실으면 못 읽고, 검사 I 의 '400자 넘는 본문' 에도 걸린다. */
    body: `${KIND[c.kind] || c.kind}입니다. 사건 이름은 "${c.case_nm.length > 160 ? c.case_nm.slice(0, 159) + '…' : c.case_nm}" 이고 사건번호는 ${c.case_no}입니다.` +
      (byNo ? ' 결정한 날짜를 못 받아서, 연도는 사건이 접수된 해입니다.' : '') +
      ' 무슨 판단을 했는지는 아래 원문 링크에서 볼 수 있습니다.',
    src: `출처 · 법제처 국가법령정보 공동활용 (${KIND[c.kind] || c.kind})`,
    url: c.src_url, cats: []
  };
  /* **판시사항이 있으면 그것을 싣는다.** 「손해배상(기) · 2015다200111」 만 보여주면
     사람이 못 읽는다 — 읽을 수 없는 노드는 없는 것이나 마찬가지다.
     판시사항은 재판부가 쓴 요약이고 **전문이 아니다** (규칙 8). */
  const dd = detail.get(c.kind + ':' + c.case_sn);
  /* ── 헌재 결정의 **결론** ──
     삼각형을 눌러도 "헌법재판소 결정입니다. 사건번호는 …" 뿐이라 **왜 지도에 있는지
     알 수 없었다.** 사람들이 궁금한 건 "무엇을 위헌이라고 했나" 다.
     법제처 응답에 주문(결론)은 없다 — 【주 문】은 `전문` 에만 있고 거기엔 실명이 있다.
     그래서 결정요지의 마지막 문장에서 찾는다. **애매하면 안 잡는다** (실측 15.2%). */
  if (c.kind === 'detc' && dd && dd.summary) {
    const v = verdictOf(dd.summary);
    if (v) { n.verdict = v }   /* tip 은 안 바꾼다 — 카드는 배지를 쓴다 */
  }
  if (dd && dd.gist && safeGist(dd.gist)) {
    n.gist = dd.gist.length > 400 ? dd.gist.slice(0, 399) + '…' : dd.gist;
    /* **이 글은 재판부가 쓴 원문이다.** 우리가 쉬운 말로 옮긴 것이 아니다.
       화면에도 그렇게 밝히고, 난이도 검사(30번)도 원문은 재지 않는다 —
       원문이 어려운 것은 우리 잘못이 아니고, 재면 '고칠 수 없는 FAIL' 만 쌓인다.
       대신 **쉬운 말이 없는 것이 몇 개인지 센다.** 그게 남은 일이다. */
    n.raw = 1;
    n.body = `${KIND[c.kind] || c.kind}입니다. 무엇을 다퉜는지 재판부가 적은 요약은 아래와 같습니다.` +
             (byNo ? ' 결정한 날짜를 못 받아서, 연도는 사건이 접수된 해입니다.' : '');
  }
  nodes.set(c.case_sn, n);
  if (c.case_no) byNoDedup.set(c.kind + '|' + String(c.case_no).replace(/\s/g, ''), n);
  return n;
};

/* ── C · 심판대상조문 / 참조조문 ──
   **가장 센 근거다.** 재판부가 스스로 "이 조문을 심판했다" 고 적은 것이라
   우리가 이름을 맞춰 본 것(A)이나 핵심어(B)와 세기가 다르다.
   상세를 받은 사건에만 있다. */
let detail = new Map();
try {
  for (const r of db.prepare('SELECT case_sn,kind,arts,gist,summary FROM case_detail').all())
    detail.set(r.kind + ':' + r.case_sn, r);
} catch { }

let a = 0, b = 0, cc = 0, none = 0;
for (const c of cases) {
  const nm = c.case_nm;
  let hit = false;
  /* C · 조문이 가리키는 법에 잇는다 */
  const d = detail.get(c.kind + ':' + c.case_sn);
  if (d && d.arts) {
    const seenL = new Set();
    for (const L of lawsBy) {
      if (L.lab.length < 4 || !d.arts.includes(L.lab) || seenL.has(L.id)) continue;
      seenL.add(L.id);
      const n = add(c); hit = true; cc++;
      links.push({ from: n.id, to: L.id, rule: RULE_C,
        why: `${c.kind === 'detc' ? '헌법재판소가 심판대상조문' : '법원이 참조조문'}에 '${L.lab}' 을 적었습니다`,
        ev: `${KIND[c.kind]} ${c.case_no}` });
      if (seenL.size >= 3) break;    /* 한 사건이 조문을 여러 개 적어도 셋까지. 더 붙이면 같은 말이 늘어난다 */
    }
  }
  /* A · 사건명에 법 이름이 있다. C 로 이미 이었으면 같은 말이라 건너뛴다 */
  if (!hit) for (const L of lawsBy) {
    if (L.lab.length < 4 || !nm.includes(L.lab)) continue;
    const n = add(c); hit = true; a++;
    links.push({ from: n.id, to: L.id, rule: RULE_A,
      why: `사건 이름에 법 이름 '${L.lab}' 이 그대로 있습니다`,
      ev: `${KIND[c.kind]} ${c.case_no}` });
    break;                              /* 가장 긴 이름 하나만. 여러 개 붙이면 같은 말이 늘어난다 */
  }
  /* B · 사건명에 결과의 핵심어가 있고 시기가 겹친다 */
  for (const r of results) {
    if (!r.wide.length || Math.abs(c.yr - r.yr) > YEARS) continue;
    const k = r.wide.find(x => x.length >= 2 && nm.includes(x));
    if (!k) continue;
    const n = add(c); hit = true; b++;
    links.push({ from: n.id, to: r.id, rule: RULE_B,
      why: `사건 이름에 '${k}' 이 있고 시기가 ${Math.abs(c.yr - r.yr) === 0 ? '같은 해' : Math.abs(c.yr - r.yr) + '년 차이'}입니다`,
      ev: `${KIND[c.kind]} ${c.case_no}` });
  }
  if (!hit) none++;
}
const nl = n => n.toLocaleString();
console.log(`  C 조문이 가리키는 법        ${nl(cc).padStart(8)}건   ← 가장 센 근거`);
console.log(`  A 사건명에 법 이름          ${nl(a).padStart(8)}건`);
console.log(`  B 핵심어 + 시기 ±${YEARS}년      ${nl(b).padStart(8)}건`);
console.log(`  ────────────────────────────────────`);
console.log(`  올라간 사건 ${nl(nodes.size)} / ${nl(cases.length)}  ·  선 ${nl(links.length)}개`);
console.log(`  어느 관문도 못 지난 사건 ${nl(none)} (${(none / cases.length * 100).toFixed(1)}%) — 안 올린다`);
const byKind = {}; for (const n of nodes.values()) { const k = n.id.split('_')[1]; byKind[k] = (byKind[k] || 0) + 1 }
console.log(`  종류별 ${JSON.stringify(byKind)}`);
console.log(`  판시사항을 버린 것 ${nl(gistDropped)}개 — 당사자·대리인 이름이 섞일 수 있다 (규칙 8)`);
/* 같은 (사건 → 대상 → 규칙) 이 두 번 나오면 같은 사실을 두 번 적는 것이다.
   창고의 UNIQUE 가 먼저 잡아 줬다 — 몇 개였는지 밝히고 하나로 줄인다. */
{
  const seen = new Set(), keep = [];
  for (const l of links) { const k = l.from + '|' + l.to + '|' + l.rule; if (seen.has(k)) continue; seen.add(k); keep.push(l) }
  const dup = links.length - keep.length;
  if (dup) console.log(`  같은 선이 두 번 나온 것 ${nl(dup)}개 — 하나로 줄였다`);
  links.length = 0; links.push(...keep);
}
if (DRY) { db.close(); process.exit(0) }

db.exec('BEGIN');
try {
  db.prepare('DELETE FROM link WHERE rule IN (?,?,?)').run(RULE_A, RULE_B, RULE_C);
  const ins = db.prepare(
    `INSERT INTO link (from_id,to_id,role,rule,why,evidence,built_at) VALUES (?,?,'topic',?,?,?,?)`);
  for (const l of links) ins.run(l.from, l.to, l.rule, l.why, l.ev, NOW);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e }

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\u2028|\u2029/g, ' ') + "'";
const nodeJs = [...nodes.values()].map(n =>
  `{id:${q(n.id)},t:'event',auto:1,side:'gov',lab:${q(n.lab)},title:${q(n.title)},yr:${q(n.yr)},` +
  `ekind:${q(n.ekind)},off:${q(n.off)},tip:${q(n.tip)},body:${q(n.body)},` +
  (n.verdict ? `verdict:${q(n.verdict)},` : '') +
  (n.gist ? `gist:${q(n.gist)},raw:1,` : '') +
  `src:${q(n.src)},url:${q(n.url)},cats:[]}`).join('\n,');
const linkJs = links.map(l =>
  `[${q(l.from)},${q(l.to)},'같은 주제','topic',${q(l.why)},${q(l.ev)},'','auto']`).join('\n,');

let out = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const put = (tag, body) => {
  const s = `/*AUTO-${tag}-START*/`, e = `/*AUTO-${tag}-END*/`;
  const i = out.indexOf(s), j = out.indexOf(e);
  if (i < 0 || j < 0) { console.error(`index.html 에 ${s} 자리가 없다`); process.exit(2) }
  out = out.slice(0, i + s.length) + '\n' + body + '\n' + out.slice(j);
};
put('CASE-N', nodeJs); put('CASE-L', linkJs);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
console.log(`\nindex.html 에 사건 ${nl(nodes.size)}개 · 선 ${nl(links.length)}개 내보냄`);
db.close();
