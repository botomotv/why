/* 손으로 넣은 사건 노드에 **「이게 뭔지」 한 줄**(w)을 붙인다.
 *
 *   node tools/event-what.mjs
 *
 * ── 값을 새로 만들지 않는다 ──
 *   이 노드들은 이미 `tip` 에 한 줄 설명을 갖고 있다. 34개 중 31개는 그 자체가
 *   「이게 무슨 사건인가」 다 — 「좁은 골목에 사람이 몰려 159명이 숨졌습니다」.
 *   나머지 셋만 날짜로 시작한다. **날짜·장소만 떼고 그대로 쓴다.**
 *   없는 사실을 지어내지 않고, 있는 문장을 자리만 옮기는 것이다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
/* ── **자기가 쓴 블록을 비우고 읽는다** ──
   그냥 읽으면 두 번째 실행에서 자기 출력이 이미 적용돼 있어 「없는 것 0개」 가 되고,
   블록을 빈 채로 다시 써서 **34개를 통째로 날린다.** famous.mjs 가 겪은 것과 같다.
   도구가 자기 출력을 읽는 자리가 있으면 언제나 이 함정이 있다. */
const html = (() => {
  const raw0 = fs.readFileSync(HTML, 'utf8');
  const a = raw0.indexOf('/*AUTO-EVW-START*/'), b = raw0.indexOf('/*AUTO-EVW-END*/');
  return (a >= 0 && b > a) ? raw0.slice(0, a + 18) + raw0.slice(b) : raw0;
})();
const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";

const DATE = /^\s*\d{4}년(\s*\d{1,2}월)?(\s*\d{1,2}일)?\s*(밤|낮|오전|오후)?\s*/;
const PLACE = /^(?:[가-힣]+(?:도|시|군|구|동|읍|면|역|항|공항|대교|앞바다|해상)의?\s+)/;
function whatOf(tip, body) {
  let s = String(tip || body || '').trim().split(/(?<=다\.)\s/)[0];
  s = s.replace(DATE, '').replace(PLACE, '').replace(/^(의|에서|에)\s*/, '').trim();
  return s;
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = () => ({
      canvas: {}, measureText: () => ({ width: 0 }), setTransform(){}, save(){}, restore(){},
      beginPath(){}, arc(){}, fill(){}, stroke(){}, moveTo(){}, lineTo(){}, closePath(){},
      clearRect(){}, fillRect(){}, fillText(){}, setLineDash(){}, roundRect(){}, translate(){},
      scale(){}, rect(){}, clip(){}, quadraticCurveTo(){}, bezierCurveTo(){}, ellipse(){},
      createRadialGradient: () => ({ addColorStop(){} })
    });
    win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
  }
});
await new Promise(r => setTimeout(r, 1600));
const N = dom.window.N;
if (!N || !N.length) { console.error('N 을 못 읽었다'); process.exit(1) }
const kind = dom.window.nodeKind;
const need = N.filter(n => n.t === 'event' && !n.auto && !n.ghost && !n.owner &&
  (typeof kind !== 'function' || kind(n) === 'event') && !(n.w && String(n.w).trim().length > 4));
const out = {}, skip = [];
for (const n of need) {
  const w = whatOf(n.tip, n.body);
  if (w && w.length > 4 && !DATE.test(w)) out[n.id] = w; else skip.push(n.lab || n.id);
}
dom.window.close();

console.log(`「이게 뭔지」 가 없던 사건 ${need.length}개 → ${Object.keys(out).length}개 채움`);
if (skip.length) console.log(`  못 만든 것 ${skip.length}개: ${skip.join(', ')} — tip 이 없거나 날짜만 있다`);

const js = Object.entries(out).map(([k, v]) => `'${k}':${q(v)}`).join('\n,');
let raw = fs.readFileSync(HTML, 'utf8');
const A = '/*AUTO-EVW-START*/', B = '/*AUTO-EVW-END*/';
const i = raw.indexOf(A), j = raw.indexOf(B);
if (i < 0 || j < 0) { console.error('index.html 에 AUTO-EVW 자리가 없다'); process.exit(1) }
fs.writeFileSync(HTML, raw.slice(0, i + A.length) + '\n' + js + '\n' + raw.slice(j), 'utf8');
console.log(`index.html 에 ${Object.keys(out).length}개 내보냄`);
