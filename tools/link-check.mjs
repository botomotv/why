/* 지도에 있는 **모든** 근거 링크를 실제로 열어 본다.
 *
 *   node tools/link-check.mjs            전부
 *   node tools/link-check.mjs --sample 40  종류별 표본만
 *
 * 결과는 db/link_check.json 에 남긴다. 검사(60번)가 그 파일을 읽는다 —
 * 2,200개를 매 검사마다 열면 40분이 걸려서 아무도 안 돌리게 된다.
 * **오래된 결과는 결과가 아니다.** 검사가 잰 날짜를 함께 본다.
 *
 * ── 200 이 곧 살아있음은 아니다 ──
 * 법제처는 없는 이름에도 200 과 함께 「오류페이지」를 준다.
 * status 만 보면 죽은 링크를 통째로 놓친다. 그래서 제목까지 본다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'db', 'link_check.json');
const ai = process.argv.indexOf('--sample');
const SAMPLE = ai > 0 ? Number(process.argv[ai + 1] || 40) : 0;
const CONC = Number(process.env.LC_CONC || 8);

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'),
  { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
    beforeParse(win) {
      win.HTMLCanvasElement.prototype.getContext = () => ({ canvas:{}, measureText:()=>({width:0}),
        setTransform(){},save(){},restore(){},beginPath(){},arc(){},fill(){},stroke(){},moveTo(){},lineTo(){},
        closePath(){},clearRect(){},fillRect(){},fillText(){},setLineDash(){},roundRect(){},translate(){},scale(){},
        rect(){},clip(){},quadraticCurveTo(){},bezierCurveTo(){},ellipse(){},createRadialGradient:()=>({addColorStop(){}}) });
      win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
    } });
await new Promise(r => setTimeout(r, 2600));
const w = dom.window, RZ = w.REZ || {};
const kindOf = n => n.id.startsWith('case_prec_') ? '판례' : n.id.startsWith('case_detc_') ? '헌재'
  : n.t === 'bill' ? '법' : n.t === 'result' ? '결과' : n.t === 'event' ? '사건' : n.t;
const seen = new Set(), targets = [];
const add = (kind, id, url) => { const k = kind + '|' + url; if (seen.has(k)) return; seen.add(k); targets.push({ kind, id, url }) };
for (const n of w.N) {
  if (n.ghost) continue;
  const k = kindOf(n);
  if (n.url && /^https?:\/\//.test(n.url)) add(k, n.id, n.url);
  (n.official2 || []).forEach(r => { if (r[1]) add(k, n.id, String(r[1])) });
  if (n.t === 'result' && RZ[n.id] && RZ[n.id].u) add(k, n.id, RZ[n.id].u);
}
dom.window.close();

let list = targets;
if (SAMPLE) {
  const by = {};
  for (const t of targets) (by[t.kind] = by[t.kind] || []).push(t);
  list = [];
  /* **고르는 방식이 판단이 되면 안 된다.** 같은 간격으로 집는다 — 실행마다 같은 표본이다. */
  for (const arr of Object.values(by)) {
    const step = Math.max(1, Math.ceil(arr.length / SAMPLE));
    for (let i = 0; i < arr.length; i += step) list.push(arr[i]);
  }
}
console.log(`근거 링크 ${targets.length}개${SAMPLE ? ` · 표본 ${list.length}개` : ''} · 동시 ${CONC}개`);

const BAD_TITLE = /오류|error|찾을 수 없|없습니다|not found/i;
async function probe(u) {
  for (let t = 0; t < 2; t++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'why-map/1.0 (+https://why-map.com)' },
        signal: AbortSignal.timeout(25000), redirect: 'follow' });
      const txt = await r.text();
      const m = /<title[^>]*>([\s\S]*?)<\/title>/.exec(txt);
      const ti = m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      const ok = r.status >= 200 && r.status < 400 && !BAD_TITLE.test(ti);
      return { status: r.status, title: ti, ok, len: txt.length };
    } catch (e) { if (t) return { status: 0, title: String(e.message || e).slice(0, 40), ok: false, len: 0 } }
  }
  return { status: 0, title: '알 수 없음', ok: false, len: 0 };
}

const res = [];
let done = 0, bad = 0;
async function worker(q) {
  while (q.length) {
    const t = q.shift();
    const v = await probe(t.url);
    res.push({ ...t, ...v });
    done++; if (!v.ok) bad++;
    if (done % 25 === 0 || !v.ok) process.stdout.write(`\r  ${done}/${list.length} · 안 열림 ${bad}   `);
  }
}
const queue = [...list];
await Promise.all(Array.from({ length: CONC }, () => worker(queue)));
console.log(`\n  다 열어 봤다 — ${res.filter(r => r.ok).length}/${res.length} · 안 열림 ${bad}개`);

const byKind = {};
for (const r of res) {
  const k = byKind[r.kind] = byKind[r.kind] || { n: 0, ok: 0, bad: [] };
  k.n++; if (r.ok) k.ok++; else if (k.bad.length < 40) k.bad.push({ id: r.id, url: r.url, status: r.status, title: r.title });
}
for (const [k, v] of Object.entries(byKind)) console.log(`  ${k} ${v.ok}/${v.n}`);
for (const [k, v] of Object.entries(byKind)) if (v.bad.length) {
  console.log(`\n[${k}] 안 열리는 것 ${v.bad.length}개`);
  v.bad.slice(0, 20).forEach(b => console.log(`   ${b.status} ${b.title} — ${b.id} ${decodeURIComponent(b.url).slice(0, 80)}`));
}
fs.writeFileSync(OUT, JSON.stringify({
  _: ['tools/link-check.mjs 가 쓴다. **모든 근거 링크를 실제로 열어 본 결과**다.',
      '검사 60 이 이 파일을 읽는다 — 2,200개를 매 검사마다 열면 40분이 걸려 아무도 안 돌린다.',
      '**오래된 결과는 결과가 아니다.** 검사가 잰 날짜를 함께 본다.'],
  at: new Date().toISOString().slice(0, 10),
  sample: SAMPLE || 0,
  total: res.length, ok: res.filter(r => r.ok).length,
  byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, { n: v.n, ok: v.ok }])),
  bad: res.filter(r => !r.ok).map(r => ({ kind: r.kind, id: r.id, url: r.url, status: r.status, title: r.title }))
}, null, 1) + '\n');
console.log(`\ndb/link_check.json 에 남겼다`);
