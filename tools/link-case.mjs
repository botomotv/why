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
/* ── 검사 47 과 **같은 그물**을 쓴다 (db/name_pattern.json) ──
   전에는 여기 그물에 `변호인` 이 없어서 「변호인 선임권」이 담긴 판시사항이 그대로 올라갔고,
   검사 47 이 그것을 FAIL 로 잡았다. **거르는 쪽과 재는 쪽이 다르면 반드시 갈라진다.**
   오탐이 섞여도 **버리는 쪽으로 기운다** — 오려내다 놓치면 이름이 지도에 올라간다. */
const NP = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'name_pattern.json'), 'utf8'));
const NAME_HARD = [
  new RegExp(`(?:${NP.role})\\s+(?:${NP.sur})[가-힣]{0,2}(?![가-힣])(?<!${NP.josa})`),
  new RegExp(`(?:^|[\\s"'(\\[·,])(?:${NP.sur})[가-힣]{1,2}(?<!${NP.josa})\\s+(?:변호사|판사|재판장)(?![가-힣])`),
];
function safeGist(g) {
  if (NAME_RISK.test(g) || NAME_HARD.some(re => re.test(g))) { gistDropped++; return false }
  return true }

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
    /* ── **사건 이름을 본문에 다시 싣지 않는다** ──
       전에는 `사건 이름은 "…" 이고` 로 제목을 통째로 인용했다. 두 가지가 나빴다:
         · 카드에 **같은 말이 두 번** 나온다 (제목에 이미 있다)
         · 사건 이름은 재판부가 쓴 원문이라 어렵고 길다. 그걸 우리 설명문에 넣으니
           **우리 글이 어려운 것으로 집계됐다** — 검사 30 실측:
           판례 889개 중 433개가 '60자 넘는 문장' · 헌재 1,227개 중 721개가 '어려운 말'.
           그 어려움은 우리가 쓴 것이 아니라 **우리가 옮겨 담은 것**이었다.
       제목은 카드가 이미 보여준다. 본문은 우리가 하는 말만 한다. */
    body: (byNo ? '결정한 날짜를 못 받아서, 연도는 사건이 접수된 해입니다. ' : '') +
      '무슨 판단을 했는지는 아래 원문 링크에서 볼 수 있습니다.',
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
  /* ── B · 사건명에 결과의 핵심어 — **없앴다** ──
     「중국 국적 81%」(외국인 유권자 중 중국 국적 비율)에 74개가 붙었는데
     **69개가 이 관문으로 들어왔고 전부 무관했다:**
       · 외국인투자세액감면 대상이 아님
       · 베트남에 둔 고정사업장 외국납부세액공제
       · 마약류관리법위반 · 출입국관리법위반
       · 성매매알선등행위처벌법위반 · 출입국관리법위반
     `외국인` 이라는 **글자**가 사건명에 있으면 붙었다. 세금 판례와 형사 판례가
     유권자 비율에 붙은 것이다. **글자가 같은 것과 주제가 같은 것은 다르다.**

     ── 그리고 구조 자체가 틀렸다 ──
     판례는 **법에 붙어야지 통계에 붙는 것이 아니다.** 판결은 그 법을 어떻게 적용할지
     정한 것이고, 통계 숫자를 만든 것이 아니다. 그래서 길을 하나로 한다:

         결과 —(법 관문: 분야·시기·핵심어)→ 법 —(관문 C: 참조조문)→ 판례·헌재

     관문 C 는 **재판부가 스스로 "이 조문을 심판했다" 고 적은 것**이라 근거가 세다.
     관문 A(사건명에 법 이름이 그대로)도 법으로만 간다.
     결과 카드에는 법 3~5개가 남고, 그 법을 누르면 판례가 보인다. */
  if (!hit) none++;
}
/* ── 같은 사건 이름을 하나로 묶는다 ──
   「출입국관리법」 카드에 판례 48 + 헌재 33 = 81개가 붙었고,
   그중 「국적법 제10조 제3항 위헌확인」 같은 것이 5건씩 있었다.
   법을 **법률 단위**로 묶은 것(link.mjs)과 같은 방식이다.

   ── 무엇을 같다고 보나 ──
   사건 이름을 정규화해서 같으면 묶는다. 종류(판례/헌재)가 다르면 안 묶는다.
   **조문만 같고 심판 종류가 다르면 안 묶는다** — 「제10조 제3항 위헌확인」과
   「위헌소원」은 헌마와 헌바로 절차가 다르다. 그래서 정규화는 공백·괄호·'구 ' 만 건드린다.

   ── 헌재와 판례는 뜻이 다르다. 그래서 화면 글자도 다르게 적는다 ──
   · 헌재 사건명은 **심판대상 조문**이다 — 이름이 같으면 같은 쟁점이다
   · 판례 사건명은 **죄명**이다 — 「공직선거법위반」 290건은 서로 다른 사건이다.
     그래서 '같은 쟁점' 이라고 쓰지 않고 **'사건 이름이 같은 판례 N건'** 이라고 쓴다.
     묶는 이유는 쟁점이 같아서가 아니라, 290줄을 늘어놓으면 아무도 못 읽기 때문이다.

   ── 안 담는 것 ──
   · 판시사항(gist) — 여러 건의 요약을 하나로 합치면 **우리가 만든 요약**이 된다
   · 헌재 결론(verdict) — 건마다 다르다. 대신 **분포를 사실로 적는다** (위헌 2 · 합헌 1)
   · 1건짜리는 묶지 않는다. 그건 지금까지처럼 판시사항·결론을 그대로 갖는다 */
const GROUP_MAX = 20;      /* 카드에 사건번호를 몇 개까지 적나. 나머지는 개수로 밝힌다 */
const normCase = t => String(t || '').replace(/^구\s+/, '')
  .replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '');
let groupedAway = 0, groupN = 0;
{
  const byKey = new Map();
  for (const n of new Set(nodes.values())) {
    const kind = n.id.split('_')[1];
    const k = kind + '|' + normCase(n.title);
    (byKey.get(k) || byKey.set(k, []).get(k)).push(n);
  }
  const rep = new Map();           /* 옛 노드 id → 묶은 노드 */
  const merged = [];
  for (const [k, arr] of byKey) {
    if (arr.length < 2) continue;
    const kind = k.split('|')[0];
    /* 대표는 **가장 짧은 이름**을 쓴다. 같은 사건을 길게 적은 것에는 부가 설명이 붙어 있다.
       같으면 사건번호 순 — 실행마다 달라지면 그 흔들림도 우리가 고른 것이 된다. */
    const sorted = [...arr].sort((a, b) =>
      (a.title.length - b.title.length) || String(a.id).localeCompare(String(b.id)));
    const head = sorted[0];
    const yrs = arr.map(x => +x.yr).filter(Boolean).sort((a, b) => a - b);
    const from = yrs[0], to = yrs[yrs.length - 1];
    const span = from === to ? `${from}년` : `${from}~${to}년`;
    const kn = KIND[kind] || kind;
    const list = arr.map(x => ({ no: String(x.off || '').split(' · ').pop(), yr: x.yr, url: x.url }))
      .sort((a, b) => (b.yr - a.yr) || String(a.no).localeCompare(String(b.no)));
    /* 헌재 결론 분포 — **우리 판단이 아니라 센 것이다** */
    const vd = {};
    for (const x of arr) if (x.verdict) vd[x.verdict] = (vd[x.verdict] || 0) + 1;
    /* 결론 이름은 법률 용어다. **처음 한 번은 괄호로 풀어 준다** — 검사 30 의 기준이기도 하다. */
    const VD_EASY = { '위헌':'헌법에 어긋난다', '헌법불합치':'헌법에 어긋나지만 당장은 그대로 둔다',
      '합헌':'헌법에 어긋나지 않는다', '각하':'따져 보지 않고 돌려보낸다', '기각':'받아들이지 않는다' };
    /* **한 문장에 다 넣지 않는다.** 괄호 설명까지 이어 붙이면 60자를 넘어 못 읽는다.
       세는 것과 풀어 주는 것을 문장으로 나눈다. */
    /* ── 한 종류에 한 문장 ──
       세 가지를 한꺼번에 만족해야 한다: 60자 아래 · 어려운 말 옆에 괄호 설명 ·
       읽어서 자연스러울 것. 종류마다 문장을 나누면 셋이 다 된다.
       (한 문장에 다 넣으면 60자를 넘고, 설명만 뒤로 빼면 어려운 말 옆에 괄호가 없어진다.) */
    const vdSum = Object.values(vd).reduce((a, b) => a + b, 0);
    const vdTxt = Object.keys(vd).length
      ? ' 결론은 이렇습니다.' +
        Object.entries(vd).map(([v, c]) =>
          ` ${v}${VD_EASY[v] ? `(${VD_EASY[v]})` : ''} ${c}건입니다.`).join('') +
        (vdSum < arr.length ? ` 나머지 ${arr.length - vdSum}건은 결론을 못 읽었습니다.` : '')
      : '';
    const same = kind === 'detc' ? '같은 조문을 다툰' : '사건 이름이 같은';
    const g = {
      id: 'case_' + kind + '_g' + (++groupN), t: 'event', auto: 1, side: 'gov',
      lab: (head.title.length > 28 ? head.title.slice(0, 27) + '…' : head.title) + ` · ${arr.length}건`,
      title: head.title, yr: String(to),
      ekind: `${span} · ${kn} ${arr.length}건`,
      off: `${kn} · ${arr.length}건 · ${span}`,
      tip: `${same} ${kn} ${arr.length}건입니다.`,
      body: `${same} ${kn} ${arr.length}건을 하나로 묶었습니다 (${span}).` +
        (kind === 'prec' ? ' 사건 이름이 죄명이라 같은 이름이라도 서로 다른 사건입니다.' : '') +
        vdTxt + ' 사건번호는 아래와 같고, 각각의 원문은 링크에서 볼 수 있습니다.',
      src: `출처 · 법제처 국가법령정보 공동활용 (${kn})`,
      url: head.url, cats: [],
      cases: list.slice(0, GROUP_MAX), casesMore: Math.max(0, list.length - GROUP_MAX),
      grouped: arr.length
    };
    merged.push(g);
    for (const x of arr) rep.set(x.id, g);
    groupedAway += arr.length - 1;
  }
  /* 노드 목록을 새로 만든다 — 묶인 것은 빼고 묶음을 넣는다 */
  const keep = [...new Set(nodes.values())].filter(n => !rep.has(n.id));
  nodes.clear();
  let seq2 = 0;
  for (const n of keep.concat(merged)) nodes.set('k' + (++seq2), n);
  /* ── 선도 묶음 쪽으로 옮긴다 ──
     **여기서는 규칙을 빼고 (사건 → 법) 으로만 겹침을 본다.** 묶기 전에는 서로 다른
     사건이 규칙 A 와 C 로 같은 법에 붙는 것이 자연스러웠는데, 묶고 나면
     **같은 묶음에서 같은 법으로 가는 선이 둘**이 된다 — 카드에 같은 법이 두 번 뜬다.
     남기는 것은 **더 센 근거**다: C(재판부가 적은 조문) > A(이름이 맞음). */
  const strength = { [RULE_C]: 2, [RULE_A]: 1, [RULE_B]: 0 };
  const best = new Map();
  for (const l of links) {
    const g = rep.get(l.from);
    if (g) { l.from = g.id; l.why = l.why + ` (묶음 ${g.grouped}건 중 한 건)` }
    const k = l.from + '|' + l.to;
    const prev = best.get(k);
    if (!prev || (strength[l.rule] || 0) > (strength[prev.rule] || 0)) best.set(k, l);
  }
  links.length = 0; links.push(...best.values());
}

const nl = n => n.toLocaleString();
console.log(`  C 조문이 가리키는 법        ${nl(cc).padStart(8)}건   ← 가장 센 근거`);
console.log(`  A 사건명에 법 이름          ${nl(a).padStart(8)}건`);
console.log(`  B 핵심어 + 시기 ±${YEARS}년      ${nl(b).padStart(8)}건   ← 없앴다 (결과에 직접 잇지 않는다)`);
console.log(`  ────────────────────────────────────`);
console.log(`  올라간 사건 ${nl(new Set(nodes.values()).size)} / ${nl(cases.length)}  ·  선 ${nl(links.length)}개`);
console.log(`  어느 관문도 못 지난 사건 ${nl(none)} (${(none / cases.length * 100).toFixed(1)}%) — 안 올린다`);
const byKind = {}; for (const n of new Set(nodes.values())) { const k = n.id.split('_')[1]; byKind[k] = (byKind[k] || 0) + 1 }
console.log(`  종류별 ${JSON.stringify(byKind)}`);
console.log(`  판시사항을 버린 것 ${nl(gistDropped)}개 — 당사자·대리인 이름이 섞일 수 있다 (규칙 8)`);
console.log(`  같은 이름을 묶은 것 ${nl(groupN)}묶음 · 노드 ${nl(groupedAway)}개 줄었다`);
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
const nodeJs = [...new Set(nodes.values())].map(n =>
  `{id:${q(n.id)},t:'event',auto:1,side:'gov',lab:${q(n.lab)},title:${q(n.title)},yr:${q(n.yr)},` +
  `ekind:${q(n.ekind)},off:${q(n.off)},tip:${q(n.tip)},body:${q(n.body)},` +
  (n.verdict ? `verdict:${q(n.verdict)},` : '') +
  (n.gist ? `gist:${q(n.gist)},raw:1,` : '') +
  (n.grouped ? `grouped:${n.grouped},casesMore:${n.casesMore},cases:[` +
    n.cases.map(c => `[${q(c.no)},${q(c.yr)},${q(c.url)}]`).join(',') + '],' : '') +
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
console.log(`\nindex.html 에 사건 ${nl(new Set(nodes.values()).size)}개 · 선 ${nl(links.length)}개 내보냄`);
db.close();
