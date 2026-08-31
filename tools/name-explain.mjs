/* 목적 조문도 조문 제목도 못 받은 법의 **이름을 푼다.**
 *
 *   node tools/name-explain.mjs --dry
 *   node tools/name-explain.mjs
 *
 * ── 이건 유추가 아니다. 이름을 푸는 것이다 ──
 *   「개별소비세법」은 "개별소비세를 어떻게 매기고 걷는지 정한 법" 이다.
 *   법 이름 안에 이미 답이 있고, 우리는 그 구조를 풀어 쓸 뿐이다.
 *   **이름에 없는 말은 한 글자도 넣지 않는다.** 「국방반도체 육성 및 지원에 관한 법률」에
 *   "반도체 산업을 키우려고" 같은 배경을 붙이면 그건 지어내는 것이다.
 *
 *   그래서 만든 문장에는 `nameTip:1` 을 붙이고 화면에서 **"법 이름을 풀어 쓴 것입니다"**
 *   라고 밝힌다. 제1조(목적) 원문과 같은 자리에 두되 같은 것처럼 보이면 안 된다.
 *
 * ── 규칙이 못 푸는 것은 지도에서 뺀다 ──
 *   "확인 중" 이 화면에 남아 있는 것은 미완성을 보여주는 것이다.
 *   빼는 개수를 반드시 출력한다 — 말없이 빼면 "없었다" 와 "우리가 뺐다" 가 구별되지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'law_name_tip.json');
const DRY = process.argv.includes('--dry');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { JSDOM, VirtualConsole } = await import('jsdom');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: {}, measureText: () => ({ width: 0 }), setTransform(){}, save(){}, restore(){},
      beginPath(){}, arc(){}, fill(){}, stroke(){}, moveTo(){}, lineTo(){}, closePath(){},
      clearRect(){}, fillRect(){}, fillText(){}, setLineDash(){}, roundRect(){}, translate(){},
      scale(){}, rect(){}, clip(){}, quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){},
      createRadialGradient: () => ({ addColorStop(){} })
    });
    win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
  } });
await new Promise(r => setTimeout(r, 1600));
const win = dom.window;
const need = win.N.filter(n => n.t === 'bill' && !(win.tipOf ? win.tipOf(n) : n.tip))
  .map(n => ({ id: n.id, lab: n.lab }));
dom.window.close();

/* ── **노드가 없는 법도 대상이다** ──
   link.mjs 는 한 줄 설명이 없는 법의 **노드를 아예 안 만든다.** 그래서 index.html 을
   읽는 것만으로는 그 법을 찾을 수 없다 — "설명이 없어서 뺐다 → 설명을 받을 수 없다" 는
   고리에 갇힌다. 실제로 결과 노드 24개가 그 법을 가리켜 **고립**됐다.
   link.mjs 가 `db/law_need_tip.json` 에 이름을 남기므로 여기서 이어받는다. */
try {
  const nt = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'law_need_tip.json'), 'utf8'));
  const seen = new Set(need.map(b => b.lab));
  for (const lab of (nt.laws || [])) if (!seen.has(lab)) { need.push({ id: '(노드 없음)', lab }); seen.add(lab) }
} catch {}

/* ── 이름을 푸는 규칙 ──
   각 규칙은 **이름의 어느 부분을 어떻게 옮겼는지** 설명할 수 있어야 한다.
   설명할 수 없으면 규칙이 아니라 추측이다. */
/* 받침에 따라 조사를 고른다 — 「소기업 및 소상공인 지원를」 은 틀린 말이다 */
const eul = w => { const c = String(w).trim().slice(-1).charCodeAt(0);
  return (c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28) ? '을' : '를' };
const RULES = [
  { /* 「A 등 N개 법률의 일부개정에 관한 법률」 · 「A 소관 N개 법률 일부개정을 위한 법률」
       → 여러 법을 한꺼번에 고치는 **개정 법률**이다. 법제처 현행법령에 없는 게 당연하다 —
         개정 내용이 각 법에 흡수되고 이 법률 자체는 남지 않는다. */
    re: /^(.+?)(?:을|를) 위한\s+(.+?)\s*(?:등|소관)\s*(\d+)개 법률/,
    make: (m) => `여러 법을 한꺼번에 고치려고 만든 법입니다. ${m[3]}개 법률을 함께 손봤고, ` +
      `무엇을 위해 고쳤는지는 법 이름에 그대로 적혀 있습니다 — 「${m[1]}」.` },
  { re: /(.+?)\s*등\s*(\d+)개 법률의 일부개정에 관한 법률$/,
    make: (m) => `여러 법을 한꺼번에 고치려고 만든 법입니다. 「${m[1]}」을 비롯한 ${m[2]}개 법률을 함께 손봤습니다.` },
  { /* 「○○세법」 → 그 세금을 어떻게 매기고 걷는지 정한 법. 이름 그대로다. */
    re: /^(.+?세)법$/,
    make: (m) => `「${m[1]}」를 누구에게 얼마나 매기고 어떻게 걷는지 정한 법입니다.` },
  { /* 「○○ 정원법」 → 사람을 몇 명 둘지 정한 법 */
    re: /^(.+?)\s*정원법$/,
    make: (m) => `「${m[1]}」에 사람을 몇 명 둘지 정한 법입니다.` },
  { /* 「○○에 관한 특별조치법」 → 한시적·예외적으로 정한 법. '특별조치' 가 이름에 있다. */
    re: /^(.+?)에 관한 특별조치법$/,
    make: (m) => `「${m[1]}」에 대해 한동안 특별히 다르게 처리하려고 만든 법입니다. ` +
      `이름의 '특별조치' 가 그 뜻입니다.` },
  { re: /^(.+?)에 관한 특례법$/,
    make: (m) => `「${m[1]}」에 대해 일반 법과 다르게 정한 법입니다. 이름의 '특례' 가 그 뜻입니다.` },
  { re: /^(.+?)에 관한 특별법$/,
    make: (m) => `「${m[1]}」를 위해 따로 만든 법입니다.` },
  { /* 「○○ 육성 및 지원에 관한 법률」 */
    re: /^(.+?)\s*육성 및 지원에 관한 법률$/,
    make: (m) => `「${m[1]}」를 키우고 돕는 일을 나라가 어떻게 할지 정한 법입니다.` },
  { /* 「○○ 제정에 관한 법률」 */
    re: /^(.+?)\s*제정에 관한 법률$/,
    make: (m) => `「${m[1]}」을 정한 법입니다.` },
  { /* 「○○ 직무집행법」 */
    re: /^(.+?)\s*직무집행법$/,
    make: (m) => `「${m[1]}」이 하는 일과 그 권한을 정한 법입니다.` },
  { /* 「…법률안」 — 아직 법이 아니다. 이건 사실 그 자체다. */
    re: /법률안$/,
    make: (m, lab) => `아직 법이 아니라 국회에 낸 **법안**입니다. 이름은 「${lab}」입니다.` },
  { /* 「○○청법」 → 그 관청을 두고 무슨 일을 하는지 정한 법 */
    re: /^(.+?)청법$/,
    make: (m) => `「${m[1]}청」을 두고 그곳이 무슨 일을 하는지 정한 법입니다.` },
  { /* 「○○를 위한 특별법」 — 위의 '에 관한 특별법' 과 조사만 다르다 */
    re: /^(.+?)(?:을|를) 위한 특별법$/,
    make: (m) => `「${m[1]}」를 위해 따로 만든 법입니다.` },
  { /* 「○○ 운영 및 지원에 관한 법률」 */
    re: /^(.+?)\s*운영 및 지원에 관한 법률$/,
    make: (m) => `「${m[1]}」를 어떻게 운영하고 지원할지 정한 법입니다.` },
  { /* 「○○ 지원을 위한 특별조치법」 — 위의 '에 관한 특별조치법' 과 조사만 다르다 */
    re: /^(.+?)\s*(?:을|를)? ?위한 특별조치법$/,
    make: (m) => `「${m[1]}」${eul(m[1])} 위해 한동안 특별히 다르게 처리하려고 만든 법입니다. ` +
      `이름의 '특별조치' 가 그 뜻입니다.` },
  { /* 「○○특별회계법」 → 그 일에 쓸 돈을 따로 떼어 관리하는 법.
       '특별회계' 는 나라 살림에서 **쓸 곳을 정해 둔 돈주머니**를 뜻하는 말이다. */
    re: /^(.+?)\s*특별회계법$/,
    make: (m) => `「${m[1]}」에 쓸 돈을 나라 살림에서 따로 떼어 관리하려고 만든 법입니다. ` +
      `이름의 '특별회계' 가 그 돈주머니를 뜻합니다.` },
  { /* 「○○특례법」 — 위의 '에 관한 특례법' 과 달리 조사가 없다 (「입양특례법」) */
    re: /^(.+?)특례법$/,
    make: (m) => `「${m[1]}」에 대해 일반 법과 다르게 정한 법입니다. 이름의 '특례' 가 그 뜻입니다.` },
  { /* 「A, B 및 C에 관한 법률」 — 쉼표와 '및' 으로 여러 일을 묶은 이름.
       (「화재예방, 소방시설 설치·유지 및 안전관리에 관한 법률」)
       **이름에 적힌 일들을 그대로 늘어놓는다.** 없는 말은 넣지 않는다. */
    re: /^(.+?),\s*(.+?)\s*및\s*(.+?)에 관한 법률$/,
    make: (m) => `「${m[1]}」·「${m[2]}」·「${m[3]}」 세 가지를 어떻게 할지 정한 법입니다.` },
  { /* 「A 등 B의 C에 관한 법률」 (「구직서류 반환 등 채용절차의 공정화에 관한 법률」)
       **「○○화」는 「○○하게 하는 것」이다** — 한자어를 그대로 옮기지 않는다.
       「공정화」→「공정하게」. 이름에 없는 말을 넣는 것이 아니라 같은 말의 다른 꼴이다. */
    re: /^(.+?)\s*등\s*(.+?)의\s*(.+?)에 관한 법률$/,
    make: (m) => {
      const c = /화$/.test(m[3]) ? m[3].replace(/화$/, '하게') : `「${m[3]}」하게`;
      return `「${m[2]}」를 ${c} 하려고 만든 법입니다. 「${m[1]}」도 여기서 정합니다.`;
    } },
  { /* 「A에 대한 B 및 C 등에 관한 법률」
       (「특정 범죄자에 대한 보호관찰 및 전자장치 부착 등에 관한 법률」) */
    re: /^(.+?)에 대한\s*(.+?)\s*및\s*(.+?)\s*등에 관한 법률$/,
    make: (m) => `「${m[1]}」에게 「${m[2]}」과 「${m[3]}」을 어떻게 할지 정한 법입니다.` },
];

const tips = {}, unsolved = [];
for (const b of need) {
  let done = false;
  for (const r of RULES) {
    const m = r.re.exec(b.lab);
    if (!m) continue;
    tips[b.lab] = r.make(m, b.lab);
    done = true; break;
  }
  if (!done) unsolved.push(b);
}

console.log(`한 줄 설명이 없던 법 ${need.length}개`);
console.log(`  → 이름을 풀어 채운 것 ${Object.keys(tips).length}개`);
console.log(`  → 규칙이 못 푼 것 ${unsolved.length}개 — **지도에서 뺀다**\n`);
Object.entries(tips).slice(0, 8).forEach(([k, v]) => console.log(`  「${k}」\n      ${v}`));
if (unsolved.length) { console.log('\n  뺄 것:'); unsolved.forEach(b => console.log(`   · ${b.id} — ${b.lab}`)) }

if (DRY) process.exit(0);
/* ── **이미 푼 것을 덮어쓰지 않는다** ──
   전에는 이 실행에서 푼 것만 담아 파일을 통째로 다시 썼다. 그런데 link.mjs 는
   설명이 생긴 법의 노드를 만들고 나면 **또 다른 법을 새로 목록에 올린다** —
   그래서 A그룹을 풀면 파일에서 B그룹이 지워지고, B그룹을 풀면 A그룹이 지워졌다.
   두 그룹이 번갈아 나오며 **영영 수렴하지 않았다.** 읽어서 합친다. */
let prev = { tip: {}, drop: [] };
try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch {}
const merged = Object.assign({}, prev.tip || {}, tips);
const dropSet = new Set([...(prev.drop || []), ...unsolved.map(b => b.id)]);
/* 이번에 푼 것은 '못 푼 것' 목록에서 뺀다 */
for (const lab of Object.keys(tips)) dropSet.delete(lab);
fs.writeFileSync(OUT, JSON.stringify({
  _: ['법 이름을 **규칙으로 풀어 쓴** 한 줄 설명. tools/name-explain.mjs 가 쓴다.',
      '제1조(목적) 원문이 아니다 — 화면에서 "법 이름을 풀어 쓴 것입니다" 라고 밝힌다.',
      '이름에 없는 말은 한 글자도 넣지 않는다. 배경·취지를 붙이면 그건 지어내는 것이다.',
      '**돌릴 때마다 합친다.** 덮어쓰면 앞서 푼 것이 사라져 link.mjs 와 무한히 번갈아 돈다.'],
  drop: [...dropSet],
  tip: merged
}, null, 2), 'utf8');
console.log(`  (이전에 푼 것 ${Object.keys(prev.tip || {}).length}개와 합쳐 ${Object.keys(merged).length}개)`);
console.log(`\ndb/law_name_tip.json 에 ${Object.keys(tips).length}개 · 뺄 노드 ${unsolved.length}개를 적었다`);
