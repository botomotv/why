/* 세 관문 시뮬레이션 — **읽기만 한다.** 창고에 아무것도 안 쓴다.
 *
 * 결과 노드마다 몇 건이 관문을 통과하는지 센다.
 * 분야(cats)·핵심어(keys)는 **페이지에서 직접 읽는다** — 여기서 베껴 쓰면 화면과 갈라진다.
 *
 *   node tools/gate-sim.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const YEARS = 3;                       /* 2관문 창. 화면에도 이 숫자를 적는다 */

const w = new DatabaseSync(DB, { readOnly: true });
const cc = {};
for (const r of w.prepare('SELECT cat, committee FROM cat_committee').all())
  (cc[r.cat] = cc[r.cat] || new Set()).add(r.committee);

/* 후보 = 공포된 법안. 법안명은 본회의 처리 BILL_NM 이고 **발의자 괄호를 뗀다** */
const bills = w.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm, json_extract(row_json,'$.ANNOUNCE_DT') dt,
          json_extract(row_json,'$.COMMITTEE_NM') cm
     FROM raw_row WHERE service='nwbpacrgavhjryiph'
      AND json_extract(row_json,'$.ANNOUNCE_DT') IS NOT NULL
      AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`).all()
  .map(r => ({ nm: String(r.nm || '').replace(/\([^)]*\)/g, '').trim(),
               y: +String(r.dt).slice(0, 4), cm: r.cm || '' }));
w.close();

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {
      get: (t, k) => k === 'measureText' ? (() => ({ width: 10 }))
        : k === 'createLinearGradient' ? (() => ({ addColorStop() {} })) : (() => {}) });
    win.requestAnimationFrame = () => 0; win.cancelAnimationFrame = () => {};
  }});
await new Promise(r => setTimeout(r, 1500));
const nodes = dom.window.N.filter(n => n.t === 'result' && !n.ghost)
  .map(n => ({ id: n.id, lab: n.lab, yr: +n.yr, keys: n.keys || [], cats: n.cats || [] }));
dom.window.close();

console.log(`후보 ${bills.length.toLocaleString()}건 (공포된 법안) · 결과 노드 ${nodes.length}개 · 2관문 ±${YEARS}년\n`);
console.log('노드  결과'.padEnd(32) + '분야'.padEnd(22) + ' 1관문   2관문  1+2   1+2+3');
let sum = 0; const zero = [], over = [];
for (const nd of nodes) {
  const cs = new Set();
  for (const c of nd.cats) for (const x of (cc[c] || [])) cs.add(x);
  const g1 = bills.filter(b => cs.has(b.cm));
  const g2 = bills.filter(b => Math.abs(b.y - nd.yr) <= YEARS);
  const g12 = g1.filter(b => Math.abs(b.y - nd.yr) <= YEARS);
  const g123 = nd.keys.length ? g12.filter(b => nd.keys.some(k => b.nm.includes(k))) : [];
  sum += g123.length;
  if (!g123.length) zero.push(nd);
  if (g123.length > 6) over.push(nd);
  console.log((nd.id + '  ' + nd.lab).padEnd(32) + nd.cats.join(',').padEnd(22).slice(0, 22) +
    String(g1.length).padStart(6) + String(g2.length).padStart(8) +
    String(g12.length).padStart(6) + String(g123.length).padStart(8) +
    (nd.keys.length ? '' : '   ← 핵심어 비움'));
}
console.log(`\n통과 합계 ${sum}건 · 0건인 노드 ${zero.length}개 (${zero.map(n => n.id).join(',') || '-'}) · 6개 초과 ${over.length}/${nodes.length}`);
