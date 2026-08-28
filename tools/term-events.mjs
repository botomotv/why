/* 사건 노드에 **"그때 정권"** 을 붙인다.
 *
 *   node tools/term-events.mjs --dry     세기만 한다
 *   node tools/term-events.mjs           index.html 에 내보낸다
 *
 * ── 규칙 3 그대로다 ──
 *   **연도 × 재임표로만** 만든다. 사건의 주최·소관부처·인물 필드는 **읽지 않는다.**
 *   그런 경로가 생기는 순간 "○○ 정부 때 있었던 일" 이 "○○가 한 일" 로 바뀐다.
 *   그래서 이 파일이 보는 것은 노드의 `yr` 하나뿐이다.
 *   역할은 `term` 이다. `lead` 로 쓰지 않는다 — 검사 5 가 그걸 지킨다.
 *
 * ── 판례·헌재결정에는 **안 붙인다** ──
 *   법원과 헌재는 정권이 아니다. "그때 정권" 을 붙이면 판결을 정권과 엮어 읽게 된다.
 *   그리고 실측이 더 결정적이다: 선고연도와 사건번호의 접수연도가
 *   **28.7% 에서 2년 이상 벌어진다** (표본 15,269건 · 5년 이상도 2.7%).
 *   대통령 임기가 5년이니 2년 차이면 정권이 바뀐 경우가 흔하다.
 *   선고연도로 정권을 붙이면 **사건이 일어난 정권이 아닌 정권**이 붙는다.
 *   1심 사건 발생은 그보다 더 전이다. 어느 쪽을 골라도 틀린 말이 된다.
 *
 * ── 1998년 이전에는 못 붙인다 ──
 *   재임표(db/seed_president_term.sql)가 김대중 정부부터다.
 *   그 이전 사건(k01~k14 · 1945~1988)에는 안 붙이고 **몇 개인지 밝힌다.**
 *   말없이 비우면 "정권이 없었다" 와 "우리가 모른다" 가 구별되지 않는다.
 *
 * ── 집권당은 안 붙인다 ──
 *   창고의 president_term 에 대통령과 임기만 있고 소속 정당이 없다.
 *   지어내지 않는다. 정당을 넣으려면 먼저 그 표를 출처와 함께 만들어야 한다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const HTML = path.join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');

const db = new DatabaseSync(DB, { readOnly: true });
const terms = db.prepare('SELECT president, from_dt, to_dt, src FROM president_term ORDER BY from_dt').all();
db.close();
if (!terms.length) { console.error('president_term 이 비었다. db/seed_president_term.sql 을 먼저 넣어라'); process.exit(1) }

const html = fs.readFileSync(HTML, 'utf8');

/* ── 노드는 **페이지를 띄워서** 읽는다. 정규식으로 훑지 않는다 ──
   전에는 `{id:'…',t:'event'…}` 를 정규식으로 잡았는데, 노드 안에 `easy:[[…]]` 나
   `prop:{…}` 같은 중첩이 있으면 첫 번째 `}` 에서 잘린다.
   그래서 손으로 넣은 사건 153개 중 **87개만 잡혔다** — 66개를 조용히 빠뜨렸다.
   검사(jsdom)는 153개를 세는데 도구는 87개를 봤으니 둘이 갈라져 있었다.
   화면이 쓰는 배열을 그대로 읽으면 갈라질 수가 없다. */
const { JSDOM } = await import('jsdom');
const vc = new (await import('jsdom')).VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: {}, measureText: () => ({ width: 0 }), setTransform(){}, save(){}, restore(){},
      beginPath(){}, arc(){}, fill(){}, stroke(){}, moveTo(){}, lineTo(){}, closePath(){},
      clearRect(){}, fillRect(){}, fillText(){}, setLineDash(){}, createRadialGradient: () => ({ addColorStop(){} }),
      roundRect(){}, translate(){}, scale(){}, rect(){}, clip(){}, quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){}
    });
    win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
  } });
await new Promise(r => setTimeout(r, 1600));
const N = dom.window.N;
if (!N || !N.length) { console.error('N 을 못 읽었다 — 스크립트가 중간에 죽었을 수 있다'); process.exit(1) }

const prez = {};
N.filter(n => n.prez).forEach(n => { prez[n.lab] = n.id });

/* 사건 노드 — **손으로 넣은 것만.** 세 가지를 뺀다:
     · auto:1  — 판례·헌재결정 (위 이유)
     · ghost·owner — **인물에 딸린 노드.** 「IMF 조기 상환」(h1·owner=k1) 처럼
                 대통령 카드 안에서 그 사람의 업적으로 보이는 항목이고, 독립 사건이 아니다.
                 여기에 "그때 정권" 을 또 붙이면 **이미 김대중에 딸린 것에 김대중을 붙이는 것**이다.
                 게다가 index.html 이 이 노드로 가는 링크를 걸러내서,
                 **148개를 만들고 81개만 들어가고 있었다.** 만든 쪽이 틀린 것이다.
                 (ghost 표시는 선언에만 있다. 런타임 파생(v_p4_2 …)은 owner 로 걸러야 한다.)
     · yr 없음 — 아래에서 센다 */
const events = N.filter(n => n.t === 'event' && !n.auto && !n.ghost && !n.owner)
  .map(n => ({ id: n.id, yr: /^\d{4}$/.test(String(n.yr || '')) ? Number(n.yr) : null, lab: n.lab || n.id }));
dom.window.close();

/* 그 해에 재임한 대통령들. 연도만 있으므로 **해가 걸치면 둘 다** 나온다 —
   그때는 문장에 "이 해에 정권이 바뀌었습니다" 를 적는다. 하나를 고르면 그게 우리 판단이다. */
function inYear(y) {
  return terms.filter(t => Number(t.from_dt.slice(0, 4)) <= y && y <= Number(t.to_dt.slice(0, 4)))
              .filter(t => prez[t.president]);          /* 지도에 노드가 있는 사람만 */
}

const links = [];
let noYear = 0, tooOld = 0, split = 0, noNode = 0;
for (const e of events) {
  if (!e.yr) { noYear++; continue }
  const hit = inYear(e.yr);
  if (!hit.length) {
    /* 재임표에 있는데 노드가 없는 것과, 재임표 자체가 그 시기를 안 담는 것을 가른다 */
    const any = terms.some(t => Number(t.from_dt.slice(0, 4)) <= e.yr && e.yr <= Number(t.to_dt.slice(0, 4)));
    if (any) noNode++; else tooOld++;
    continue;
  }
  if (hit.length > 1) split++;
  for (const t of hit) {
    const yFrom = t.from_dt.slice(0, 4), yTo = t.to_dt.slice(0, 4);
    const span = yTo === '2099' ? `${yFrom}년~` : `${yFrom}~${yTo}`;
    const why = hit.length > 1
      ? `이 시기 대통령은 {a}였습니다 (${span}). ${e.yr}년에 정권이 바뀌어 두 정부에 걸칩니다. 그 정부가 한 일이라는 뜻이 아닙니다`
      : `이 시기 대통령은 {a}였습니다 (${span}). 그 정부가 한 일이라는 뜻이 아니라 그 시기였다는 뜻입니다`;
    links.push([prez[t.president], e.id, '그때 정권', 'term', why, `${e.yr}년 · 재임표 ${t.from_dt}~${t.to_dt}`, '', 'auto']);
  }
}

console.log(`손으로 넣은 사건 ${events.length}개`);
console.log(`  → 그때 정권을 붙인 사건 ${new Set(links.map(l => l[1])).size}개 · 링크 ${links.length}개`);
console.log(`  붙이지 못한 것: 연도 없음 ${noYear} · 재임표보다 이른 시기 ${tooOld} (재임표는 ${terms[0].from_dt} 부터다) · 지도에 대통령 노드 없음 ${noNode}`);
console.log(`  해가 걸쳐 두 정부가 붙은 사건 ${split}개`);
console.log(`  판례·헌재결정 10,364개에는 **안 붙였다** — 선고연도가 사건 발생과 28.7%에서 2년 이상 벌어진다`);

if (DRY) process.exit(0);

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
const js = links.map(l => '[' + l.map(q).join(',') + ']').join('\n,');
const A = '/*AUTO-TERM-START*/', B = '/*AUTO-TERM-END*/';
const i = html.indexOf(A), j = html.indexOf(B);
if (i < 0 || j < 0) { console.error(`index.html 에 ${A} … ${B} 블록이 없다`); process.exit(1) }
fs.writeFileSync(HTML, html.slice(0, i + A.length) + '\n' + js + '\n' + html.slice(j), 'utf8');
console.log(`\nindex.html 에 term 링크 ${links.length}개 내보냄`);
