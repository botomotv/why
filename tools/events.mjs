/* 사건 후보 목록을 지도에 올린다.
 *
 *   node tools/events.mjs --dry        세기만 한다
 *   node tools/events.mjs --limit 60   앞에서 60개만 올린다 (나눠서 넣을 때)
 *   node tools/events.mjs              전부 올린다
 *
 * ── 무엇을 사람이 하고 무엇을 기계가 하나 ──
 *   사람 : 사건의 이름·시기·한 줄 설명·관련 법 (db/event_candidates.json)
 *   기계 : 그 법 이름이 **지도에 실제로 있는지** 대조해서 잇는다. 없으면 안 잇는다.
 *
 * ── 「그 뒤에 만들어진 법」 과 「관련된 법」 은 다른 사실이다 ──
 *   `after`(그 뒤에) 의 근거는 **법 이름이나 법제처 제·개정이유에 그 사건이 적혀 있는 것**이다.
 *   목록의 「관련 법」 칸은 그게 아니라 **사람이 목록을 만들며 적은 것**이다.
 *   둘을 같은 역할로 이으면 「국회가 이 사건 때문에 만들었다」 가 되어 버린다 —
 *   우리가 만든 주장이지 기록이 아니다. 그래서 `topic` 으로 잇고, 근거 문장에
 *   **어디서 온 값인지** 적는다. 사슬 ③칸(만들어진 법)은 여전히 비어 있고 그 이유를 밝힌다.
 *
 * ── 형량은 여기서 안 만든다 ──
 *   판례 사건명은 죄명이라 사건 이름으로는 못 찾는다. 사건번호를 얻은 뒤
 *   `tools/famous.mjs` 가 법제처 주문을 읽어 채운다. 그 전에는 **왜 비었는지**만 쓴다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'db', 'event_candidates.json');
const DRY = process.argv.includes('--dry');
const LI = process.argv.indexOf('--limit');
const LIMIT = LI > 0 ? Number(process.argv[LI + 1]) : Infinity;

const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
const norm = s => String(s || '').replace(/[·・‧∙ㆍ]/g, '').replace(/\s+/g, '').trim();
const slug = s => String(s).replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 24);

const all = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const E = all.filter(e => !/이미 있음/.test(e.비고 || '')).slice(0, LIMIT);

/* 지도의 법 노드 — **자기 블록은 빼고 본다** (도구가 자기 출력을 읽으면 두 번째부터 틀린다) */
const raw = fs.readFileSync(HTML, 'utf8');
const cut = (t) => { const a = raw.indexOf(`/*AUTO-${t}-START*/`), b = raw.indexOf(`/*AUTO-${t}-END*/`); return (a >= 0 && b > a) ? [a, b] : null };
let scan = raw;
for (const t of ['EV230-N', 'EV230-L', 'EV230-PEN']) { const c = cut(t); if (c) scan = scan.slice(0, c[0]) + scan.slice(c[1]) }

const lawByName = new Map();
for (const m of scan.matchAll(/\{id:'([^']+)'[^\n]*?t:'bill'[^\n]*?title:'([^']*)'/g)) lawByName.set(norm(m[2]), m[1]);
for (const m of scan.matchAll(/\{id:'([^']+)'[^\n]*?title:'([^']*)'[^\n]*?t:'bill'/g)) lawByName.set(norm(m[2]), m[1]);

/* 목록의 분류를 지도의 분야로 옮긴다. 없는 것은 안 붙인다 — 「모른다」 를 「같은 분야」 로 만들지 않는다. */
const CAT = { 참사:'safe', 산업재해:'safe', 재해:'safe', 의료:'med', 북한:'sec', 간첩:'spy', 안보:'sec' };

const PEN_TEXT = {
  'need-no': '형량은 아직 확인하지 못했습니다 — 이 사건의 판례 사건번호를 아직 찾지 못했습니다. 판례의 사건명은 죄명이라 사건 이름으로는 찾을 수 없습니다',
  ongoing: '확정 전 — 재판이 아직 진행 중입니다. 확정된 판결만 씁니다',
  nolow: '이 사건의 판결문은 공개돼 있지 않습니다 — 법제처가 공개하는 판례는 선별된 것이고, 이 사건은 거기에 없습니다',
  none: '형사 재판이 없는 일입니다 — 처벌을 적을 수 없습니다',
  confirmed: '확정'
};

const nodes = [], links = [], pens = {};
let linked = 0, onlyEv = 0, byPen = {};
for (const e of E) {
  const id = 'ev230_' + slug(e.이름);
  byPen[e.판례] = (byPen[e.판례] || 0) + 1;
  const laws = String(e.관련법 || '').split(/\s*·\s*(?=[가-힣])/).map(x => x.trim()).filter(x => x.length > 2);
  const hit = laws.map(l => [l, lawByName.get(norm(l))]).filter(x => x[1]);
  if (hit.length) linked++; else onlyEv++;

  /* ── `w` 가 **이게 무슨 사건인지** 한 줄이다 ──
     카드 맨 위에 노란 글씨로 온다. 날짜·장소는 그 아래 줄로 내린다.
     값은 새로 만들지 않는다 — 이미 적어 둔 한 줄에서 날짜·장소만 뗀 것이다. */
  const alias = Array.isArray(e.별명) ? e.별명.filter(Boolean) : [];
  nodes.push('{' + [
    ['id', id], ['t', 'event'], ['side', 'gov'], ['lab', e.이름], ['title', e.이름],
    ['yr', String(e.연도)], ['ekind', e.연도 + '년 · 사건'],
    ['w', e.뭔지 || e.한줄],
    ['tip', e.한줄], ['body', e.한줄],
    ['cat', CAT[e.분류] || ''],
    ['src', '출처 · 사건 이름과 시기는 공개 자료에서 옮겼습니다. 기사 본문은 싣지 않습니다'],
    /* ── **왜 근거 링크가 없는지 적는다** ──
       빈 것 자체는 잘못이 아니다. 말없이 비우면 「아직 안 찾았다」 와
       「찾아봤지만 없다」 가 구별되지 않는다 (검사 60).
       이 사건들은 목록에서 온 것이라 공식 기록 페이지를 **아직 하나씩 찾지 못했다.**
       그럴듯한 링크(기관 메인·보도자료 목록)를 넣으면 「출처 있는 척」이 된다. */
    ['noUrl', '이 사건의 공식 기록 페이지를 아직 찾지 못했습니다 — 사건 이름과 시기만 공개 자료에서 옮겼고, ' +
      '그럴듯한 링크를 대신 넣지 않습니다'],
    ['chain', 1]
  ].filter(([, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => k + ':' + (k === 'chain' ? 1 : q(v))).join(',')
    + (alias.length ? ",alias:[" + alias.map(q).join(',') + "]" : '') + '}');

  /* ── **조작으로 밝혀진 것은 반드시 그렇게 쓴다** ──
     간첩 사건과 조작 사건을 같은 말로 적으면 둘이 섞인다. 섞이면 둘 다 못 읽는다. */
  pens[id] = e.조작
    ? { x: '조작으로 밝혀진 사건입니다 — 재판에서 무죄가 확정됐거나 과거사 조사로 조작이 확인됐습니다. ' +
           (PEN_TEXT[e.판례] || PEN_TEXT['need-no']) }
    : { x: PEN_TEXT[e.판례] || PEN_TEXT['need-no'] };

  for (const [name, lid] of hit)
    links.push([id, lid, '관련된 법', 'topic',
      `이 사건과 관련된 법으로 「${name}」 을 적어 두었습니다`,
      '사람이 사건 목록(db/event_candidates.json)에 적은 값입니다 — 법 이름이나 법제처 제·개정이유에 이 사건이 적혀 있다는 뜻은 아닙니다',
      '', '']);
}

console.log(`사건 ${E.length}개 (목록 ${all.length} 중 지도에 이미 있는 것 ${all.length - all.filter(x => !/이미 있음/.test(x.비고 || '')).length}개는 뺐다)`);
console.log(`  법으로 이어진 것 ${linked} · 사건만인 것 ${onlyEv} · 선 ${links.length}개`);
console.log(`  처벌 칸: ` + Object.entries(byPen).map(([k, v]) => `${k} ${v}`).join(' · '));
if (DRY) process.exit(0);

let out = fs.readFileSync(HTML, 'utf8');
const penJs = Object.entries(pens).map(([k, v]) =>
  `'${k}':{` + Object.entries(v).filter(([, x]) => x).map(([kk, x]) => kk + ':' + q(x)).join(',') + '}').join('\n,');
for (const [tag, text] of [
  ['EV230-N', nodes.length ? nodes.map(x => x + ',').join('\n') : ''],
  ['EV230-L', links.length ? links.map(l => '[' + l.map(q).join(',') + ']').join('\n,') + ',' : ''],
  ['EV230-PEN', penJs ? ',' + penJs : '']]) {
  const A = `/*AUTO-${tag}-START*/`, B = `/*AUTO-${tag}-END*/`;
  const i = out.indexOf(A), j = out.indexOf(B);
  if (i < 0 || j < 0) { console.error(`index.html 에 AUTO-${tag} 자리가 없다`); process.exit(1) }
  out = out.slice(0, i + A.length) + '\n' + text + '\n' + out.slice(j);
}
fs.writeFileSync(HTML, out, 'utf8');
console.log(`\nindex.html 에 노드 ${nodes.length}개 · 선 ${links.length}개 내보냄`);
