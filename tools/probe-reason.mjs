/* 법제처 제·개정이유를 받을 수 있나 — **읽기만 한다.**
 * 자동으로 붙인 법률 하나하나를 법제처에서 찾아 제개정이유가 있는지 센다.
 *   node tools/probe-reason.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OC = process.env.LAW_OC || 'botomotv';
const first = o => (o && typeof o === 'object') ? o[Object.keys(o)[0]] : null;
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function S(t, p) {
  const u = new URL('http://www.law.go.kr/DRF/' + t);
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, String(v));
  try { const r = await fetch(u, { headers: { 'User-Agent': 'why-map/probe' } }); return JSON.parse(await r.text()) }
  catch { return null }
}
const lawOf = nm => String(nm || '').replace(/\([^)]*\)/g, '')
  .replace(/\s*(일부|전부|중)?개정법률안$/, '').replace(/\s*폐지법률안$/, '')
  .replace(/\s*법률안$/, ' 법률').replace(/법안$/, '법').replace(/\s+/g, ' ').trim();

const db = new DatabaseSync(path.join(ROOT, 'db', 'warehouse.db'), { readOnly: true });
const cc = {}; for (const r of db.prepare('SELECT cat, committee FROM cat_committee').all())
  (cc[r.cat] = cc[r.cat] || new Set()).add(r.committee);
const bills = db.prepare(`SELECT json_extract(row_json,'$.BILL_NM') nm,
  json_extract(row_json,'$.ANNOUNCE_DT') dt, json_extract(row_json,'$.COMMITTEE_NM') cm
  FROM raw_row WHERE service='nwbpacrgavhjryiph'
   AND json_extract(row_json,'$.ANNOUNCE_DT') IS NOT NULL AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`).all()
  .map(r => ({ nm: String(r.nm || '').replace(/\([^)]*\)/g, '').trim(), law: lawOf(r.nm),
               y: +String(r.dt).slice(0, 4), cm: r.cm || '' }));
db.close();
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cmap = html.match(/var CATMAP\s*=\s*\{([\s\S]*?)\n\};/);
const catOf = {};
for (const g of cmap[1].matchAll(/['"]?([\w]+)['"]?\s*:\s*\[([^\]]*)\]/g))
  for (const id of g[2].split(',').map(x => x.replace(/['\s]/g, '')).filter(Boolean))
    (catOf[id] = catOf[id] || []).push(g[1]);
const nodes = [...html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?yr:'(\d{4})',keys:\[([^\]]*)\]/g)]
  .map(m => ({ id: m[1], yr: +m[2], keys: m[3].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean),
               cats: catOf[m[1]] || [] }));
const laws = new Set();
for (const nd of nodes) { if (!nd.keys.length) continue;
  const cs = new Set(); for (const c of nd.cats) for (const x of (cc[c] || [])) cs.add(x);
  for (const b of bills) if (cs.has(b.cm) && Math.abs(b.y - nd.yr) <= 3 && nd.keys.some(k => b.nm.includes(k))) laws.add(b.law) }

console.log(`자동 법률 ${laws.size}개 · 법제처에서 제·개정이유를 찾는다\n`);
let found = 0, withR = 0, lens = []; const miss = [];
for (const nm of [...laws].sort()) {
  const s = await S('lawSearch.do', { target: 'law', display: 40, query: nm });
  await sleep(220);
  const t = first(s); const rows = arr(t && (t.law || t.Law)).filter(r => (r['법령명한글'] || '') === nm);
  if (!rows.length) { miss.push(nm); continue }
  found++;
  const d = await S('lawService.do', { target: 'law', MST: rows[0]['법령일련번호'] });
  await sleep(220);
  const root = first(d);
  const rz = root && root['제개정이유'] && root['제개정이유']['제개정이유내용'];
  const txt = arr(rz).flat().filter(x => typeof x === 'string' && x.length > 40).join(' ');
  if (txt.length > 40) { withR++; lens.push(txt.length) }
}
lens.sort((a, b) => a - b);
console.log(`법제처에서 이름이 정확히 맞는 것 : ${found} / ${laws.size}`);
console.log(`그중 제·개정이유가 있는 것       : ${withR}`);
console.log(`이유 글자 수 (중앙값 / 최대)     : ${lens.length ? lens[Math.floor(lens.length / 2)] : 0} / ${lens.length ? lens[lens.length - 1] : 0}`);
console.log(`못 찾은 것 ${miss.length}: ${miss.join(' · ')}`);
