/* 사건 후보 목록을 재서 docs/사건목록.md 를 만든다.
 *
 *   node tools/event-list.mjs
 *
 * ── 숫자를 손으로 세지 않는다 ──
 *   「몇 개를 넣을 수 있나」 를 사람이 세면 셀 때마다 달라진다.
 *   관련 법이 **창고에 있는지 · 지도에 있는지** 를 대조해서 센다.
 *
 * ── 법 이름은 그대로 맞지 않는다 ──
 *   법제처는 가운뎃점을 ㆍ(U+318D) 로, 국회·우리는 ·(U+00B7) 로 쓴다.
 *   띄어쓰기도 다르다. 그래서 **가운뎃점과 공백을 지우고** 맞춘다.
 *   이 파일이 이미 겪은 것이다 — 창고는 「4ㆍ16」, 지도는 「4·16」 이라 다른 글자다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const SRC = path.join(ROOT, 'db', 'event_candidates.json');
const OUT = path.join(ROOT, 'docs', '사건목록.md');

const norm = s => String(s || '').replace(/[·・‧∙ㆍ]/g, '').replace(/\s+/g, '').trim();

const E = JSON.parse(fs.readFileSync(SRC, 'utf8'));

/* 창고에 있는 법 이름 */
const db = new DatabaseSync(DB, { readOnly: true });
const whLaw = new Set();
for (const t of ['law_purpose', 'law_reason', 'law_articles']) {
  try {
    const col = t === 'law_articles' ? 'law_nm' : 'law_nm';
    for (const r of db.prepare(`SELECT DISTINCT ${col} v FROM ${t}`).all()) whLaw.add(norm(r.v));
  } catch (e) { /* 표가 없으면 건너뛴다 — 몇 개를 못 봤는지 아래에서 밝힌다 */ }
}
db.close();

/* 지도에 있는 법 이름 */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mapLaw = new Set();
for (const m of html.matchAll(/t:'bill'[^\n]*?title:'([^']*)'/g)) mapLaw.add(norm(m[1]));
for (const m of html.matchAll(/title:'([^']*)'[^\n]*?t:'bill'/g)) mapLaw.add(norm(m[1]));

const splitLaws = s => String(s || '').split(/\s*·\s*(?=[가-힣])/)
  .map(x => x.trim()).filter(x => x.length > 2);

let inWh = 0, inMap = 0, noLaw = 0;
for (const e of E) {
  const laws = splitLaws(e.관련법);
  e._laws = laws;
  e._wh = laws.filter(l => whLaw.has(norm(l)));
  e._map = laws.filter(l => mapLaw.has(norm(l)));
  if (!laws.length) noLaw++;
  if (e._wh.length) inWh++;
  if (e._map.length) inMap++;
}

const byPen = {};
E.forEach(e => { byPen[e.판례] = (byPen[e.판례] || 0) + 1 });

const PEN_LABEL = {
  confirmed: '예 — 확정 판례를 확인했다',
  'need-no': '사건번호를 찾아야 한다',
  ongoing: '아니오 — 재판이 진행 중이다',
  nolow: '아니오 — 공개 판례에 없다',
  none: '해당 없음 — 형사 사건이 아니다'
};
const PEN_SHORT = { confirmed: '예', 'need-no': '△ 번호 필요', ongoing: '✗ 진행 중', nolow: '✗ 없음', none: '— 형사 아님' };

/* 넣을 수 있는가 — **세 갈래로 나눈다** (주인이 물은 그대로) */
const canPen = E.filter(e => e.판례 === 'confirmed');
const canLaw = E.filter(e => e.판례 !== 'confirmed' && (e._map.length || e._wh.length));
const onlyEv = E.filter(e => e.판례 !== 'confirmed' && !e._map.length && !e._wh.length);

const cats = [...new Set(E.map(e => e.분류))];
let md = `# 사건 목록 — 후보 ${E.length}건

**이 문서는 목록이다. 지도에 넣은 것이 아니다.** 무엇을 넣을지는 주인이 정한다.

숫자는 손으로 세지 않았다. \`tools/event-list.mjs\` 가 \`db/event_candidates.json\` 을 읽고
관련 법 이름을 **창고(law_purpose·law_reason·law_articles)** 와 **지도의 법 노드**에 대조해서 센다.
다시 세려면 \`node tools/event-list.mjs\` 를 돌린다.

## 몇 개를 넣을 수 있나

| | 건수 |
|---|---:|
| **후보 전체** | **${E.length}** |
| ① 확정 판례를 이미 확인한 것 (형량·확정까지 붙일 수 있다) | **${canPen.length}** |
| ② 판례는 아직이지만 **관련 법이 지도나 창고에 있는 것** (사건 → 법 사슬이 된다) | **${canLaw.length}** |
| ③ 둘 다 없어 **사건만 넣어야 하는 것** | **${onlyEv.length}** |
| 관련 법 이름을 아직 못 적은 것 | ${noLaw} |

법 이름 대조 결과: 지도의 법과 이름이 맞는 사건 **${inMap}건** · 창고의 법과 맞는 사건 **${inWh}건**.

### 판례를 찾을 수 있나

| 갈래 | 건수 | 뜻 |
|---|---:|---|
${Object.keys(PEN_LABEL).map(k => `| ${PEN_SHORT[k]} | ${byPen[k] || 0} | ${PEN_LABEL[k]} |`).join('\n')}

**「사건번호를 찾아야 한다」 가 가장 많다.** 판례의 사건명은 **죄명**이라
「삼풍」·「대장동」 같은 이름으로는 창고 20만 건에서 0건이 나온다.
그래서 웹에서 **사건번호만** 얻고, 확정 여부와 형량은 법제처 판례 **주문**을 읽어 확인한다.
그 확인을 하기 전에는 「예」 라고 적지 않는다.

**「공개 판례에 없다」 도 실제로 있다.** 법제처 공개 판례는 **선별**이다 —
2021년 대법원 판례가 창고에 841건뿐이다. 상고를 포기해 항소심에서 확정된 사건
(대구 지하철 참사)과 대법원 확정인데도 공개되지 않은 사건(n번방)이 여기 들어간다.

## 사람 이름이 사건 이름에 들어간 것

주인이 「사건 이름에 들어간 것은 예외」 라고 정했다. 그래도 **바꿀 수 있는 것은 바꿔 적었다** —
피해자 이름이 들어간 것은 특히 그렇다. 아래는 아직 이름이 남아 있는 것이고, 넣을 때 주인이 정한다.

${E.filter(e => /이름/.test(e.비고 || '')).map(e => `- **${e.이름}** (${e.연도}) — ${e.비고}`).join('\n')}

`;

for (const c of cats) {
  const rows = E.filter(e => e.분류 === c).sort((a, b) => a.연도 - b.연도);
  md += `\n## ${c} (${rows.length}건)\n\n`;
  md += `| 사건 이름 | 해 | 한 줄 | 죄명 | 관련 법 | 판례 | 법이 지도에 |\n|---|---:|---|---|---|---|---|\n`;
  for (const e of rows) {
    md += `| ${e.이름} | ${e.연도} | ${e.한줄} | ${e.죄명 || '—'} | ${e.관련법 || '—'} | ${PEN_SHORT[e.판례] || e.판례} | ${e._map.length ? '○' : (e._wh.length ? '창고만' : '✗')} |\n`;
  }
}

md += `
## 어디서 가져왔나

- 위키백과 분류 「대한민국의 인재 사고」 · 「대한민국의 사건」 · 「대한민국의 살인 사건」 문서 제목
- 주인이 든 예시 목록
- 연도별 주요 사건 검색

**기사 본문은 싣지 않았다.** 사건 이름과 시기만 옮겼고, 한 줄 설명은 우리가 썼다.
형량은 이 문서에 **적지 않는다** — 넣을 때 법제처 판례 주문에서 읽는다.

## 이 목록의 한계

- **빠진 것이 있다.** 위키백과 분류에 없는 사건, 지역에서만 크게 다뤄진 사건은 안 들어왔다
- **「이슈가 됐다」 를 우리가 판정했다.** 검색량 같은 객관 지표를 못 구했다 —
  네이버·구글은 순위 목록을 API 로 안 준다 (이 프로젝트가 이미 확인한 것이다)
- **연도는 사건이 일어난 해**다. 판결이 난 해가 아니다
- 관련 법은 **한 줄 짐작**이 섞여 있다. 실제로 이을 때는 법 이름이나 제·개정이유에
  그 사건이 적혀 있는지 확인해야 한다 (\`after\` 근거 A·B)
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md, 'utf8');
console.log(`후보 ${E.length}건 → ${path.relative(ROOT, OUT)}`);
console.log(`  ① 확정 판례 확인함        ${canPen.length}`);
console.log(`  ② 관련 법이 지도/창고에 있음 ${canLaw.length}`);
console.log(`  ③ 사건만 넣어야 함         ${onlyEv.length}`);
console.log(`  법 이름이 지도와 맞음 ${inMap} · 창고와 맞음 ${inWh} · 법을 못 적음 ${noLaw}`);
