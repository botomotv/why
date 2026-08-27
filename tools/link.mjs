/* 자동 연결 — 관문 3개를 통과한 것만 지도에 올린다.
 *
 *   node tools/link.mjs --dry     세기만 한다 (창고·index.html 안 건드림)
 *   node tools/link.mjs           창고 link 표에 쓰고 index.html 에 내보낸다
 *
 * 관문 (docs/자동연결.md)
 *   1관문 · 분야가 겹치는가        결과 노드의 cats ↔ cat_committee ↔ COMMITTEE_NM
 *   2관문 · 시기가 겹치는가        ANNOUNCE_DT 가 결과 기준연도 ±3년
 *   3관문 · 근거가 있는가          BILL_NM 이 결과의 keys 중 하나를 포함
 *
 * 지키는 것
 *  - **role 은 topic 하나다.** 인과가 아니라 '같은 주제·같은 시기' 라는 뜻이다
 *  - link.rule · link.why 를 반드시 채운다. 근거를 못 대는 선은 주장이지 기록이 아니다
 *  - 통과·탈락을 **분모와 함께** 낸다. 말없이 거르면 "이게 전부" 라는 거짓말이 된다
 *  - 손으로 넣은 것과 섞지 않는다. 자동 노드는 auto:1 이고 화면에서도 구분된다
 *
 * 왜 법률 단위로 묶나 — 실측이다.
 *   관문을 통과한 선 340건 중 **97%가 '○○법 일부개정법률안'** 이고,
 *   한 결과 노드에 같은 이름이 최대 14번 붙는다 (출입국관리법·영유아보육법·공직선거법).
 *   그대로 올리면 목록에 같은 줄이 14개 뜬다. 이름만으로는 무엇이 바뀌었는지 알 수 없어
 *   "왜 이렇게 됐나" 의 답이 안 된다.
 *   법률 하나로 묶고 **개정 횟수와 기간을 사실로 적는다** — 340 → 78.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const RULE = 'topic_by_committee_and_year';
/* 2관문 창. 화면에도 이 숫자를 적는다.
   GATE_YEARS 로 바꿔가며 몇 개가 되는지 잰다 — 값은 실측으로 고른다. */
/* **±3년이다.** ±년은 노드를 늘리는 레버가 아니다 — 실측으로 3→10 을 훑었더니
   법률이 62→77 밖에 안 늘었다. 같은 법의 개정만 늘어나기 때문이다.
   노드를 늘리는 레버는 3관문(핵심어)이고, 그쪽을 두 글자까지 넓혔다.
   시기 조건은 좁게 두는 편이 근거가 세다. docs/자동연결.md 와 이 값이 같아야 한다. */
const YEARS = Number(process.env.GATE_YEARS || 3);
const NOW = new Date().toISOString().slice(0, 10);

const CATLAB = { spy:'간첩·기밀', sec:'안보·정보기관', land:'부동산', for:'외국인·참정권',
  pen:'연금', med:'의료', birth:'저출생', tax:'세금', nrg:'전기·에너지',
  demo:'민주화·정치제도', safe:'재난·안전', labor:'노동', civic:'시민단체·장애인',
  party:'정당 계보', elec:'선거·투표', just:'검찰·사법', econ:'기업·주식' };

/* 법안명 → 법률명. '출입국관리법 일부개정법률안' → '출입국관리법'
   **자르는 순서가 중요하다.** 처음엔 '법률안$' 를 '법' 으로 바꿨는데
   '중대재해 처벌 등에 관한 법률안' 이 '…관한법' 이 돼서 법제처에서 못 찾았다.
   제정안은 이름 끝이 두 가지다 — '…법률안'(→법률) 과 '…법안'(→법).
   긴 것부터 잘라야 한다. 실측: 이 순서로 고치니 찾는 비율이 52/65 → 62/65 가 됐다. */
const lawOf = nm => String(nm || '')
  .replace(/\([^)]*\)/g, '')                       /* 발의자 괄호. 안 떼면 사람 이름에 걸린다 */
  .replace(/\s*(일부|전부|중)?개정법률안$/, '')
  .replace(/\s*폐지법률안$/, '')
  .replace(/\s*법률안$/, ' 법률')                    /* '…에 관한 법률안' → '…에 관한 법률' */
  .replace(/법안$/, '법')                            /* '공소청법안'·'특별법안' → '…법' */
  .replace(/\s+/g, ' ')
  .trim();

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

/* 법제처 제·개정이유(원문)와 사람이 옮긴 쉬운 말.
   **타법개정은 빼야 한다** — 그 이유는 이 법의 것이 아니라 딸려 바뀌게 만든 다른 법의 것이다.
   실측: 61개 중 26개(43%)가 타법개정이고, 그중 10개가 똑같은 정부조직 개편 이유를 달고 있었다.
   그대로 실었으면 "국가정보원법이 바뀐 이유는 방송통신위원회를 폐지하려고" 가 됐다. */
let reasons = {};
try {
  for (const r of db.prepare(
    `SELECT law_nm,reason,promul_dt,rvs_kind,src_url FROM law_reason WHERE rvs_kind<>'타법개정'`).all())
    reasons[r.law_nm] = r;
} catch { reasons = {} }
/* 같은 이유 문장을 두 법이 나눠 갖고 있으면 그것도 딸려 바뀐 것이다 — 그물로 한 번 더 거른다 */
{
  const seen = {};
  for (const k of Object.keys(reasons)) {
    const sig = reasons[k].reason.replace(/\s+/g, '').slice(0, 120);
    (seen[sig] = seen[sig] || []).push(k);
  }
  for (const ks of Object.values(seen)) if (ks.length > 1) for (const k of ks) delete reasons[k];
}
/* ── 규칙 3 · 대통령은 공포일 × 재임표로만 정한다 ──
   발의자·소관부처를 읽지 않는다. 그 경로가 생기는 순간
   "○○ 정부 때 공포된 법" 이 "○○ 가 밀어붙인 법" 으로 자동 변환된다.
   법률로 묶은 것은 공포가 여러 번이라 대통령이 둘 이상일 수 있다 —
   **하나로 고르지 않고 전부 센다.** '문재인 정부 6건 · 윤석열 정부 8건' 처럼. */
let terms = [];
try { terms = db.prepare('SELECT president,from_dt,to_dt FROM president_term ORDER BY from_dt').all() } catch {}
/* 날짜 모양이 표마다 다르다. 본회의 처리의 ANNOUNCE_DT 는 'YYYY-MM-DD' 이고
   개인별 표결의 VOTE_DATE 는 'YYYYMMDD HHMMSS' 다. 둘 다 받는다 —
   'YYYYMMDD' 로만 받다가 62개 전부 대통령이 안 붙었다. */
const presOf = dt => {
  const raw = String(dt || '').trim();
  const m = raw.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  const t = terms.find(t => t.from_dt <= d && d <= t.to_dt);
  return t ? t.president : null;
};

let easy = {};
try { easy = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'law_easy.json'), 'utf8')); delete easy._ } catch {}
/* ── 발의자 ──
   **대표발의자는 이름을 쓰고, 공동발의자는 수만 쓴다.**
   대표발의는 그 법안을 대표해 낸 공적 행위이고 의안정보시스템 첫 화면에 이름이 나온다.
   공동발의자는 10~20명씩이라 **그대로 실으면 우리가 만든 명단이 된다** —
   흩어져 있던 이름을 한 곳에 모으는 것이 문제라는 규칙 8 의 이유와 같다.
   그래서 '공동발의 10명' 처럼 수만 적고, 발의 요건이 10명이라는 것도 함께 밝힌다.

   법률로 묶은 것은 개정이 여러 번이라 발의자가 여럿이다.
   **가장 최근 개정 하나만** 보여주고 나머지는 수로 밝힌다. 전부 나열하면 또 명단이다. */
const propOf = new Map();
try {
  for (const r of db.prepare(
    `SELECT json_extract(row_json,'$.BILL_ID') id, json_extract(row_json,'$.RST_PROPOSER') rst,
            json_extract(row_json,'$.PUBL_PROPOSER') publ, json_extract(row_json,'$.PROPOSER') pro
       FROM raw_row WHERE service='nzmimeepazxkubdpn'`).all()) {
    if (!r.id) continue;
    propOf.set(String(r.id), {
      rst: String(r.rst || '').trim(),
      n: String(r.publ || '').split(',').map(x => x.trim()).filter(Boolean).length,
      gov: /정부/.test(String(r.pro || '')) && !String(r.rst || '').trim()
    });
  }
} catch { }
/* 분야별 핵심어 — 결과 노드의 좁은 keys 에 **더해서** 쓴다.
   노드별 keys 만으로는 법률이 62개밖에 안 붙어 지도가 비어 보였다.
   ±년을 3→10 으로 늘려도 62→77 뿐이었다 (같은 법의 개정만 늘어난다).
   노드 수를 늘리는 레버는 3관문이지 2관문이 아니다.
   GATE_WIDE=0 으로 끄면 옛 동작 그대로다. */
let catKeys = {};
if (process.env.GATE_WIDE !== '0') {
  try { catKeys = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'cat_keys.json'), 'utf8')); delete catKeys._ } catch {}
}

const cc = {};
for (const r of db.prepare('SELECT cat, committee FROM cat_committee').all())
  (cc[r.cat] = cc[r.cat] || new Set()).add(r.committee);
if (!Object.keys(cc).length) { console.error('cat_committee 가 비었다. db/seed_cat_committee.sql 을 먼저 넣어라'); process.exit(1) }

const bills = db.prepare(
  `SELECT json_extract(row_json,'$.BILL_ID') id, json_extract(row_json,'$.BILL_NM') nm,
          json_extract(row_json,'$.ANNOUNCE_DT') dt, json_extract(row_json,'$.COMMITTEE_NM') cm
     FROM raw_row WHERE service='nwbpacrgavhjryiph'
      AND json_extract(row_json,'$.ANNOUNCE_DT') IS NOT NULL
      AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`).all()
  .map(r => ({ id: r.id, nm: String(r.nm || '').replace(/\([^)]*\)/g, '').trim(),
               law: lawOf(r.nm), y: +String(r.dt).slice(0, 4), dt: r.dt, cm: r.cm || '' }));

/* 결과 노드의 분야·핵심어는 **index.html 에서 직접 읽는다.** 여기서 베껴 쓰면 화면과 갈라진다. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cmap = html.match(/var CATMAP\s*=\s*\{([\s\S]*?)\n\};/);
const catOf = {};
for (const g of cmap[1].matchAll(/['"]?([\w]+)['"]?\s*:\s*\[([^\]]*)\]/g))
  for (const id of g[2].split(',').map(x => x.replace(/['\s]/g, '')).filter(Boolean))
    (catOf[id] = catOf[id] || []).push(g[1]);
const nodes = [...html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?lab:'([^']*)'[\s\S]{0,300}?yr:'(\d{4})',keys:\[([^\]]*)\]/g)]
  .map(m => {
    const own = m[4].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean);
    const cats = catOf[m[1]] || [];
    /* 노드가 핵심어를 **일부러 비운** 경우(r3·q5)는 넓히지 않는다 —
       그 주제는 법률이 아니라 대통령령·기본계획이라 법 이름에 흔적이 없다.
       비운 것을 분야 사전으로 채우면 우리가 만든 거짓 연결이 된다. */
    const wide = own.length ? [...new Set([...own, ...cats.flatMap(c => catKeys[c] || [])])] : [];
    return { id: m[1], lab: m[2], yr: +m[3], keys: wide, ownKeys: own, cats };
  });

/* ── 관문 ── */
const gate = { 후보: bills.length, g1: 0, g2: 0, g12: 0, g123: 0 };
const groups = new Map();           /* 결과+법률 → 통과한 개정들 */
const perNode = {};
for (const nd of nodes) {
  perNode[nd.id] = { lab: nd.lab, keys: nd.keys.length, laws: 0, amend: 0 };
  if (!nd.keys.length) continue;
  const cs = new Set();
  for (const c of nd.cats) for (const x of (cc[c] || [])) cs.add(x);
  for (const b of bills) {
    const ok1 = cs.has(b.cm);
    const ok2 = Math.abs(b.y - nd.yr) <= YEARS;
    const key = nd.keys.find(k => b.nm.includes(k));
    if (ok1) gate.g1++;
    if (ok2) gate.g2++;
    if (ok1 && ok2) gate.g12++;
    if (!(ok1 && ok2 && key)) continue;
    gate.g123++;
    const cat = nd.cats.find(c => (cc[c] || new Set()).has(b.cm));
    const gk = nd.id + ' ' + b.law;
    if (!groups.has(gk)) groups.set(gk, { res: nd, law: b.law, cat, key, items: [] });
    groups.get(gk).items.push(b);
  }
}

/* ── 노드·선 만들기 ── */
const lawNodes = new Map(), links = [];
let seq = 0;
for (const g of [...groups.values()].sort((a, b) => a.law.localeCompare(b.law))) {
  const ys = g.items.map(x => x.y).sort((a, b) => a - b);
  const from = ys[0], to = ys[ys.length - 1];
  const nid = 'auto_' + g.law.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 24) + '_' + (++seq);
  if (!lawNodes.has(g.law)) {
    const span = from === to ? `${from}년` : `${from}~${to}년`;
    lawNodes.set(g.law, {
      id: nid, t: 'bill', auto: 1, side: 'gov', kind: '법률', st: '공포',
      lab: g.law, title: g.law, yr: String(to),
      /* '공포' 는 법률 용어다 — 검사 30이 '설명 없는 어려운 말' 로 62개 전부를 잡았다.
         법이 확정돼 세상에 알려지는 것을 뜻한다. 화면에는 '고쳤습니다' 로 쓴다.
         자동으로 들어온 글도 손으로 쓴 글과 **같은 난이도 검사**를 통과해야 한다. */
      off: `${span} · ${g.items.length}번 고침`,
      /* **'무슨 법인지' 가 없으면 비운다.** 「2015~2025년 · 11번 고침」 만으로는
         국세기본법이 뭔지 알 수 없고, 그 카드는 의미가 없다.
         법 이름에서 유추하지 않는다 — 그건 지어내는 것이다 (원칙 0-B). */
      tip: (easy[g.law] && easy[g.law].what) || '',
      body: ((easy[g.law] && easy[g.law].what) ? easy[g.law].what + ' ' : '') +
            `${span} 사이에 ${g.items.length}번 고쳤습니다.`,
      /* 쉬운 말과 원문을 **따로** 담는다. 어느 쪽이 법제처 문장이고
         어느 쪽이 우리가 옮긴 문장인지 화면에서 갈려야 한다. */
      /* **필드 이름을 easy 로 쓰면 안 된다.** 손으로 넣은 사건 노드의 easy 는
         [[질문,답],…] 배열이고 화면에서 문답으로 그려진다. 같은 이름을 문자열로 쓰면
         검사가 배열을 String() 해서 '질문,답,질문,답' 을 한 문장으로 읽는다 —
         실제로 없는 96자짜리 긴 문장 48개가 만들어졌다. plain 으로 나눈다. */
      plain: (easy[g.law] && easy[g.law].easy) || '',
      reason: (reasons[g.law] && reasons[g.law].reason) || '',
      rsnDt: (reasons[g.law] && reasons[g.law].promul_dt) || '',
      rsnUrl: (reasons[g.law] && reasons[g.law].src_url) || '',
      /* 이유가 설명하지 못하는 나머지 개정 수. 말없이 하나만 보여주면 그게 전부인 줄 안다. */
      rsnRest: Math.max(0, g.items.length - 1),
      /* ── 사건에서 나온 법 ──
         「4·16세월호참사…특별법」·「10·29이태원참사…특별법」처럼 **법 이름 자체가
         그 사건이 있었다는 공식 기록**이다. 우리가 사건을 판단해 붙이는 것이 아니라
         국회가 그 이름으로 법을 만든 것이라 근거가 세다.
         실측: 공포 법안 18,156건 중 128건, 법률 59개가 여기 걸린다.
         **사건 노드를 새로 만들지 않는다** — 같은 이름이 두 번 생기고, 그건 우리가
         만든 중복이다. 이 법에 표시만 달고 화면에서 갈라 보이게 한다. */
      caseLaw: /진상규명|참사|희생자|피해자.{0,6}(지원|구제|보상)|과거사|의문사|특별검사/.test(g.law) ? 1 : 0,
      cats: [g.cat].filter(Boolean),
      src: '출처 · 국회 의안정보시스템 · 제·개정이유는 법제처 제공',
      bills: g.items.map(x => ({ id: x.id, dt: x.dt })).sort((a, b) => a.dt.localeCompare(b.dt))
    });
  }
  /* 공포일마다 대통령을 찾아 센다. 순서는 시간순 — 우리가 고르지 않는다. */
  const node = lawNodes.get(g.law);
  if (!node.prop) {
    /* 가장 최근 개정부터 거슬러 올라가며 발의자를 찾은 첫 건만 쓴다 */
    const byDt = [...g.items].sort((a, b) => String(b.dt).localeCompare(String(a.dt)));
    let found = null, gov = 0, withProp = 0;
    for (const b of byDt) {
      const p = propOf.get(String(b.id)); if (!p) continue;
      if (p.gov) { gov++; if (!found) found = { gov: 1, dt: b.dt }; continue }
      if (!p.rst) continue;
      withProp++;
      if (!found || found.gov) found = { rst: p.rst, n: p.n, dt: b.dt };
    }
    if (found) node.prop = { ...found, rest: Math.max(0, g.items.length - 1) };
  }
  if (!node.presCount) {
    const c = new Map();
    for (const b of g.items) { const p = presOf(b.dt); if (p) c.set(p, (c.get(p) || 0) + 1) }
    node.presCount = [...c.entries()]
      .sort((a, b) => {
        const fa = terms.find(t => t.president === a[0]), fb = terms.find(t => t.president === b[0]);
        return String(fa && fa.from_dt).localeCompare(String(fb && fb.from_dt));
      });
    node.presUnknown = g.items.length - node.presCount.reduce((s, x) => s + x[1], 0);
  }
  const catLab = CATLAB[g.cat] || g.cat;
  const gap = Math.abs(to - g.res.yr);
  const why = `같은 분야(${catLab}) · 공포 ${from === to ? from : from + '~' + to}` +
              ` (결과 ${g.res.yr}년, ${gap === 0 ? '같은 해' : gap + '년 차이'})` +
              ` · 법 이름에 '${g.key}'`;
  links.push({ from: node.id, to: g.res.id, why, n: g.items.length });
  perNode[g.res.id].laws++;
  perNode[g.res.id].amend += g.items.length;
}

/* ── 산출 — 통과·탈락을 분모와 함께 ── */
const nl = n => n.toLocaleString();
console.log(`자동 연결 · 결과 노드 ${nodes.length}개 대상 · 2관문 ±${YEARS}년${DRY ? '  (--dry)' : ''}\n`);
console.log(`  후보 (공포된 법안)        ${nl(gate.후보).padStart(8)}건`);
console.log(`  1관문 분야 겹침           ${nl(gate.g1).padStart(8)}쌍   탈락 ${nl(nodes.length * gate.후보 - gate.g1)}`);
console.log(`  2관문 시기 ±${YEARS}년          ${nl(gate.g2).padStart(8)}쌍`);
console.log(`  1+2                       ${nl(gate.g12).padStart(8)}쌍   탈락 ${nl(gate.g1 - gate.g12)}`);
console.log(`  3관문 이름에 핵심어        ${nl(gate.g123).padStart(8)}쌍   탈락 ${nl(gate.g12 - gate.g123)}`);
console.log(`  ────────────────────────────────────`);
console.log(`  법률로 묶은 뒤 선          ${nl(links.length).padStart(8)}개   (개정 ${nl(gate.g123)}건을 법률 ${nl(lawNodes.size)}개로)`);
console.log('');
console.log('결과 노드별 (붙은 법률 · 그 안의 개정 건수)');
for (const [id, v] of Object.entries(perNode))
  console.log(`  ${id.padEnd(5)} ${String(v.laws).padStart(3)}개 법률 · 개정 ${String(v.amend).padStart(3)}건  ${v.lab}` +
    (v.keys ? '' : '   ← 핵심어 비움 (자동으로 이을 근거 없음)'));
const zero = Object.entries(perNode).filter(([, v]) => v.keys && !v.laws);
if (zero.length) console.log(`\n  0건인 노드: ${zero.map(([k]) => k).join(', ')}`);

if (DRY) { db.close(); process.exit(0) }

/* ── 창고 link 표 ── */
db.exec('BEGIN');
try {
  db.prepare('DELETE FROM link WHERE rule=?').run(RULE);
  const ins = db.prepare(
    `INSERT INTO link (from_id,to_id,role,rule,why,evidence,built_at) VALUES (?,?,'topic',?,?,?,?)`);
  for (const l of links) ins.run(l.from, l.to, RULE, l.why, `개정 ${l.n}건`, NOW);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e }
console.log(`\n창고 link 표에 ${nl(links.length)}건 (rule=${RULE})`);

/* ── index.html 로 내보내기 ── */
/* 줄바꿈까지 막아야 한다. 제·개정이유 원문에는 줄바꿈이 들어 있어서
   그냥 넣었더니 문자열이 중간에 끊겨 index.html 이 통째로 문법 오류가 났다. */
const q = s => "'" + String(s)
  .replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, '\\n')
  .replace(/\u2028|\u2029/g, ' ') + "'";
const nodeJs = [...lawNodes.values()].map(n =>
  `{id:${q(n.id)},t:'bill',auto:1,side:${q(n.side)},kind:${q(n.kind)},st:${q(n.st)},` +
  `lab:${q(n.lab)},title:${q(n.title)},yr:${q(n.yr)},off:${q(n.off)},tip:${q(n.tip)},` +
  `body:${q(n.body)},cats:[${n.cats.map(q).join(',')}],src:${q(n.src)},` +
  (n.plain ? `plain:${q(n.plain)},` : '') +
  (n.presCount && n.presCount.length
    ? `presN:[${n.presCount.map(([p, c]) => `[${q(p)},${c}]`).join(',')}],presUnknown:${n.presUnknown},` : '') +
  (n.reason ? `reason:${q(n.reason)},rsnDt:${q(n.rsnDt)},rsnUrl:${q(n.rsnUrl)},rsnRest:${n.rsnRest},` : '') +
  (n.caseLaw ? 'caseLaw:1,' : '') +
  (n.prop ? `prop:{${n.prop.gov ? 'gov:1' : `rst:${q(n.prop.rst)},n:${n.prop.n}`},dt:${q(n.prop.dt)},rest:${n.prop.rest}},` : '') +
  `bills:[${n.bills.map(b => `[${q(b.id)},${q(b.dt)}]`).join(',')}]}`).join('\n,');
/* **선 자체에 자동 표시를 박는다.** 전에는 '붙은 노드가 auto 면 점선' 이라는 간접 방식이었다.
   그러면 표시가 빠져도 화면이 그대로라 아무도 모른다 — 실제로 자동 선 266개 전부가
   자기 표시 없이 들어가 있었다. 8번째 칸이 'auto' 다 (7번째는 손 선의 날짜 칸이라 비운다).
   강제: 검사 45. auto 노드에 닿는 선에 이 표시가 없으면 FAIL. */
const linkJs = links.map(l =>
  `[${q(l.from)},${q(l.to)},'같은 주제','topic',${q(l.why)},${q('개정 ' + l.n + '건')},'','auto']`).join('\n,');

let out = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const put = (tag, body) => {
  const a = `/*AUTO-${tag}-START*/`, b = `/*AUTO-${tag}-END*/`;
  const i = out.indexOf(a), j = out.indexOf(b);
  if (i < 0 || j < 0) { console.error(`index.html 에 ${a} 자리가 없다`); process.exit(2) }
  out = out.slice(0, i + a.length) + '\n' + body + '\n' + out.slice(j);
};
put('N', nodeJs);
put('L', linkJs);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
const withEasy = [...lawNodes.values()].filter(n => n.plain).length;
const withRsn = [...lawNodes.values()].filter(n => n.reason).length;
console.log(`index.html 에 노드 ${nl(lawNodes.size)}개 · 선 ${nl(links.length)}개 내보냄`);
const withPres = [...lawNodes.values()].filter(n => n.presCount && n.presCount.length).length;
console.log(`  당시 대통령을 붙인 것 ${withPres}/${lawNodes.size} (공포일 × 재임표)`);
console.log(`  그 법 고유의 제·개정이유가 붙은 것 ${withRsn}/${lawNodes.size}` +
            `  · 쉬운 말로 옮긴 것 ${withEasy}/${withRsn}`);
if (withRsn < lawNodes.size)
  console.log(`  나머지 ${lawNodes.size - withRsn}개는 타법개정이거나 법제처에 없다 — 화면에 "확인 중" 으로 밝힌다`);
db.close();
console.log('\n다음: npm test');
