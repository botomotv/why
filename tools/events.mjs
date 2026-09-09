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
/* ── 법제처에 없지만 **확정 사실은 공식 기록으로 아는 것** ──
   사건번호·법원·확정일·출처만 적는다. **형량은 안 적는다** —
   주문을 직접 읽은 것만 쓴다. 대법원 보도자료를 기계로 읽었더니
   「징역 40년」 을 「징역 40개월」 로 잘못 읽었다. 그런 값은 우리가 만든 값이다. */
const HANDV = (() => {
  const f = path.join(ROOT, 'db', 'verdict_hand.json');
  if (!fs.existsSync(f)) return {};
  const o = {};
  for (const c of JSON.parse(fs.readFileSync(f, 'utf8')).cases || []) o[c.이름] = c;
  return o;
})();
/* ── 지도에 **이미 있는 사건도 법에는 이어야 한다** ──
   노드를 두 번 만들지 않으려고 건너뛰었더니, 그 사건의 관련 법만 올라가고
   **아무 데도 안 이어진 법 11개**가 생겼다 (시설물안전법·계엄법·5·18보상법…).
   삼풍·성수대교는 지도에 있는데 그 법으로 가는 길이 없었던 것이다.
   노드는 안 만들고 **선만** 기존 노드에서 낸다. */
const already = all.filter(e => /이미 있음/.test(e.비고 || ''));

/* 지도의 법 노드 — **자기 블록은 빼고 본다** (도구가 자기 출력을 읽으면 두 번째부터 틀린다) */
const raw = fs.readFileSync(HTML, 'utf8');
const cut = (t) => { const a = raw.indexOf(`/*AUTO-${t}-START*/`), b = raw.indexOf(`/*AUTO-${t}-END*/`); return (a >= 0 && b > a) ? [a, b] : null };
let scan = raw;
for (const t of ['EV230-N', 'EV230-L', 'EV230-PEN']) { const c = cut(t); if (c) scan = scan.slice(0, c[0]) + scan.slice(c[1]) }

/* 지도에 이미 있는 사건 노드를 이름으로 찾는다 */
const evByName = new Map();
for (const m of scan.matchAll(/\{id:'([^']+)',t:'event'[^\n]*?(?:lab|title):'([^']*)'/g)) {
  const k = norm(m[2]); if (!evByName.has(k)) evByName.set(k, m[1]);
}
const lawByName = new Map();
for (const m of scan.matchAll(/\{id:'([^']+)'[^\n]*?t:'bill'[^\n]*?title:'([^']*)'/g)) lawByName.set(norm(m[2]), m[1]);
for (const m of scan.matchAll(/\{id:'([^']+)'[^\n]*?title:'([^']*)'[^\n]*?t:'bill'/g)) lawByName.set(norm(m[2]), m[1]);

/* 목록의 분류를 지도의 분야로 옮긴다. 없는 것은 안 붙인다 — 「모른다」 를 「같은 분야」 로 만들지 않는다. */
/* ── **분류 12개를 빠짐없이 분야에 맞춘다** ──
   전에는 일곱 개만 적어 두었다. 그래서 범죄 49 · 사회 36 · 경제 34 · 정치 23 · 노동 4 가
   **어느 분야에도 안 들어갔고**, 분야가 없으면 화면이 그것을 **모든 분야**에 넣는다.
   「분야를 눌러도 볼 게 없다」 와 「엉뚱한 게 뜬다」 가 같은 원인이었다. */
const CAT = {
  참사: 'safe', 산업재해: 'safe', 재해: 'safe', 의료: 'med',
  북한: 'sec', 안보: 'sec', 간첩: 'spy',
  범죄: 'viol', 경제: 'econ', 정치: 'demo', 노동: 'labor', 사회: 'civic'
};

/* ── **「안 한 것」 과 「없는 것」 을 가른다** ──
   전에는 둘 다 「아직 확인하지 못했습니다」 였다. 그건 우리가 안 한 것도,
   법제처에 아예 없는 것도 같은 말로 덮는다.
     need-no  우리가 사건번호를 못 찾았다        → **우리가 안 한 것**
     nolow    사건번호를 알아도 법제처에 없다     → **없는 것**
   실측: 윤 일병 사건(2016도8612)은 대법원에서 확정됐는데
   창고 20만건에도 법제처 검색에도 **0건**이다. 공개 판례는 선별이다. */
const PEN_TEXT = {
  'need-no': '형량을 아직 확인하지 못했습니다 — 사건번호를 못 찾았습니다',
  ongoing: '재판이 진행 중입니다',
  nolow: '이 사건의 판결문은 법제처 공개 판례에 없습니다',
  none: '형사 재판이 없었습니다',
  confirmed: '확정'
};

const nodes = [], links = [], pens = {};
let linked = 0, onlyEv = 0, byPen = {}, srcOk = 0, handv = 0;
for (const e of E) {
  const id = 'ev230_' + slug(e.이름);
  byPen[e.판례] = (byPen[e.판례] || 0) + 1;
  /* ── 가운뎃점은 **법 이름 안에도** 있다 ──
     ` · ` (앞뒤 공백)로만 나눈다. 그냥 `·` 로 나누면
     「진실·화해를 위한 과거사정리 기본법」 이 「화해를 위한…」 으로,
     「아동·청소년의 성보호에 관한 법률」 이 「청소년의…」 로 잘린다.
     그 이름으로는 법제처에도 지도에도 없다 — **조용히 안 이어진다.** */
  const laws = String(e.관련법 || '').split(/\s+·\s+/).map(x => x.trim()).filter(x => x.length > 2);
  const hit = laws.map(l => [l, lawByName.get(norm(l))]).filter(x => x[1]);
  if (hit.length) linked++; else onlyEv++;

  /* ── `w` 가 **이게 무슨 사건인지** 한 줄이다 ──
     카드 맨 위에 노란 글씨로 온다. 날짜·장소는 그 아래 줄로 내린다.
     값은 새로 만들지 않는다 — 이미 적어 둔 한 줄에서 날짜·장소만 뗀 것이다. */
  const alias = Array.isArray(e.별명) ? e.별명.filter(Boolean) : [];
  /* ── 근거 링크 ──
     **국회가 이 사건을 법 이름에 넣어 법을 만들었으면**, 그 법의 원문이 곧
     이 사건의 공식 기록이다 — 「4·16세월호참사 피해구제…특별법」·「제주4·3사건…특별법」.
     그럴듯한 링크(기관 메인·보도자료 목록)는 안 쓴다 — 그건 「출처 있는 척」이다.
     실측: 이렇게 채울 수 있는 사건은 12개뿐이다. 나머지는 비우고 이유를 적는다. */
  const bare = norm(e.이름).replace(/(참사|사건|사고|사태|피격|폭파|붕괴|화재|침몰|추락|지진|테러|유출)$/, '');
  const named = hit.find(([nm]) => bare.length >= 3 && norm(nm).includes(bare));
  const evUrl = named ? 'https://www.law.go.kr/법령/' + encodeURIComponent(named[0]) : '';
  if (evUrl) srcOk++;
  nodes.push('{' + [
    ['id', id], ['t', 'event'], ['side', 'gov'], ['lab', e.이름], ['title', e.이름],
    ['yr', String(e.연도)], ['ekind', e.연도 + '년 · 사건'],
    ['w', e.뭔지 || e.한줄],
    /* ── `body` 는 **자세한 설명**이 있으면 그것 ──
       한 줄만 있으면 「이게 뭔지」 와 같은 문장이 두 번 나온다. 자세한 설명이 있으면
       그것을 본문으로 쓰고, 없으면 한 줄만 쓴다 — **없는 것을 지어내지 않는다.** */
    ['tip', e.한줄], ['body', e.자세히 || e.한줄],
    ['cat', CAT[e.분류] || ''],
    ['url', evUrl],
    ['src', evUrl
      ? '출처 · 법제처 국가법령정보 — 국회가 이 사건을 법 이름에 넣어 만든 법의 원문입니다'
      : '출처 · 사건 이름과 시기는 공개 자료에서 옮겼습니다. 기사 본문은 싣지 않습니다'],
    /* ── **왜 근거 링크가 없는지 적는다** ──
       빈 것 자체는 잘못이 아니다. 말없이 비우면 「아직 안 찾았다」 와
       「찾아봤지만 없다」 가 구별되지 않는다 (검사 60).
       이 사건들은 목록에서 온 것이라 공식 기록 페이지를 **아직 하나씩 찾지 못했다.**
       그럴듯한 링크(기관 메인·보도자료 목록)를 넣으면 「출처 있는 척」이 된다. */
    ['noUrl', evUrl ? '' : '이 사건의 공식 기록 페이지를 아직 찾지 못했습니다 — 그럴듯한 링크를 대신 넣지 않습니다'],
    ['chain', 1]
  ].filter(([, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => k + ':' + (k === 'chain' ? 1 : q(v))).join(',')
    + (alias.length ? ",alias:[" + alias.map(q).join(',') + "]" : '') + '}');

  /* ── **조작으로 밝혀진 것은 반드시 그렇게 쓴다** ──
     간첩 사건과 조작 사건을 같은 말로 적으면 둘이 섞인다. 섞이면 둘 다 못 읽는다. */
  const hv = HANDV[e.이름];
  if (hv) {
    /* ── 세 갈래로 적는다 ──
       ① 확정 + 형량까지 읽었다 → 형량을 쓴다 (원심 주문에서 읽은 것이다)
       ② 확정은 확인했는데 판결문이 법제처에 없다 → 그 사실만 쓴다
       ③ 파기환송 → 「확정 전」. 형량을 쓰지 않는다 (규칙 1) */
    pens[id] = hv.확정 && hv.형량
      ? { p: hv.형량, n: hv.사건번호, c: hv.법원, u: hv.원심url || hv.url,
          x: `확정 · ${hv.법원} ${hv.사건번호} 가 ${hv.확정일} 상고를 기각했습니다 · 형량은 ${hv.형량출처} 에서 읽었습니다` }
      : hv.확정
        ? { n: hv.사건번호, c: hv.법원, u: hv.url,
            x: `${hv.법원} ${hv.사건번호} 로 ${hv.확정일} 확정됐습니다. ` +
               `다만 그 판결문이 법제처 공개 판례에 없어 형량은 적지 않습니다` }
        /* ── **그 판결을 말하지, 지금 상태를 단정하지 않는다** ──
           2018도13792 는 2019년에 원심을 파기했지만 그 뒤 재상고심에서 확정됐다.
           우리가 읽은 것은 **그 판결 하나의 주문**이다 — 「확정 전」 이라고 현재를 단정하면
           나중에 확정된 사건에서 틀린 말이 된다. 읽은 것만 말하고 나머지는 모른다고 한다. */
        : { n: hv.사건번호, c: hv.법원, u: hv.url,
            x: `${hv.법원} ${hv.사건번호}(${hv.확정일})이 원심을 파기했습니다. ` +
               `그 뒤 확정됐는지는 확인하지 못했습니다 — 확정된 판결만 형량을 씁니다` };
    handv++;
  } else pens[id] = e.조작
    ? { x: '조작으로 밝혀진 사건입니다 — 재판에서 무죄가 확정됐거나 과거사 조사로 조작이 확인됐습니다. ' +
           (PEN_TEXT[e.판례] || PEN_TEXT['need-no']) }
    : { x: PEN_TEXT[e.판례] || PEN_TEXT['need-no'] };

  for (const [name, lid] of hit)
    links.push([id, lid, '관련된 법', 'topic',
      `이 사건과 관련된 법으로 「${name}」 을 적어 두었습니다`,
      '사람이 사건 목록(db/event_candidates.json)에 적은 값입니다 — 법 이름이나 법제처 제·개정이유에 이 사건이 적혀 있다는 뜻은 아닙니다',
      '', '']);
}

/* ── 이미 있는 사건에서도 법으로 선을 낸다 ── */
let alsoLinked = 0;
for (const e of already) {
  /* 목록 이름과 지도 이름이 다른 것이 있다 — 「사드 배치 논란」 대 「사드 배치 결정」.
     그 짝을 목록에 적어 둔다(`지도이름`). 안 적으면 그 법이 **아무 데도 안 이어진다.** */
  const eid = evByName.get(norm(e.지도이름 || e.이름)) || evByName.get(norm(e.이름));
  if (!eid) continue;
  const laws = String(e.관련법 || '').split(/\s+·\s+/).map(x => x.trim()).filter(x => x.length > 2);
  const hit = laws.map(l => [l, lawByName.get(norm(l))]).filter(x => x[1]);
  for (const [name, lid] of hit) {
    if (lid === eid) continue;
    links.push([eid, lid, '관련된 법', 'topic',
      `이 사건과 관련된 법으로 「${name}」 을 적어 두었습니다`,
      '사람이 사건 목록(db/event_candidates.json)에 적은 값입니다 — 법 이름이나 법제처 제·개정이유에 이 사건이 적혀 있다는 뜻은 아닙니다',
      '', '']);
    alsoLinked++;
  }
}
console.log(`  지도에 이미 있던 사건에서 낸 선 ${alsoLinked}개`);
console.log(`사건 ${E.length}개 (목록 ${all.length} 중 지도에 이미 있는 것 ${all.length - all.filter(x => !/이미 있음/.test(x.비고 || '')).length}개는 뺐다)`);
console.log(`  법으로 이어진 것 ${linked} · 사건만인 것 ${onlyEv} · 선 ${links.length}개`);
console.log(`  확정 사실을 공식 기록으로 밝힌 것 ${handv}개 (형량은 안 쓴다)`);
console.log(`  근거 링크가 붙은 것 ${srcOk} · 없는 것 ${E.length-srcOk} (왜 없는지 카드가 적는다)`);
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
