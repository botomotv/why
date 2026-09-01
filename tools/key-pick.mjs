/* 후보 핵심어를 **실제 1+2 통과 법안 이름**에 대고 골라낸다.
   짐작으로 쓰면 띄어쓰기 하나에 0건이 된다 — 「국민기초생활 보장법」에는 빈칸이 있다. */
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
const CAND = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const YEARS = 3;
const w = new DatabaseSync('db/warehouse.db', { readOnly: true });
const cc = {};
for (const r of w.prepare('SELECT cat, committee FROM cat_committee').all())
  (cc[r.cat] = cc[r.cat] || new Set()).add(r.committee);
const bills = w.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm, json_extract(row_json,'$.ANNOUNCE_DT') dt,
          json_extract(row_json,'$.COMMITTEE_NM') cm FROM raw_row
    WHERE service='nwbpacrgavhjryiph' AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`).all()
  .map(r => ({ nm: String(r.nm||'').replace(/\([^)]*\)/g,'').trim(), y: +String(r.dt).slice(0,4), cm: r.cm||'' }));
w.close();
const html = fs.readFileSync('index.html','utf8');
const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, beforeParse(win){
  win.HTMLCanvasElement.prototype.getContext = () => new Proxy({},{get:(t,k)=>k==='measureText'?(()=>({width:10})):k==='createLinearGradient'?(()=>({addColorStop(){}})):(()=>{})});
  win.requestAnimationFrame=()=>0; win.cancelAnimationFrame=()=>{}}});
await new Promise(r=>setTimeout(r,1500));
const N = dom.window.N.filter(n=>n.t==='result'&&!n.ghost).map(n=>({id:n.id,lab:n.lab,yr:+n.yr,cats:n.cats||[]}));
dom.window.close();
const out = {};
for (const [id, cands] of Object.entries(CAND)) {
  const nd = N.find(n=>n.id===id);
  if (!nd) { console.log(id, '← 노드 없음'); continue }
  const cs = new Set(); for (const c of nd.cats) for (const x of (cc[c]||[])) cs.add(x);
  const g12 = bills.filter(b => cs.has(b.cm) && Math.abs(b.y-nd.yr)<=YEARS);
  const hit = cands.map(k => [k, g12.filter(b=>b.nm.includes(k)).length]).filter(x=>x[1]>0);
  out[id] = hit.map(x=>x[0]);
  console.log(id.padEnd(18)+nd.lab.slice(0,14).padEnd(16)+'1+2='+String(g12.length).padStart(5)+'  '+
    (hit.length?hit.map(x=>x[0]+'('+x[1]+')').join(' · '):'← 후보 전부 0건'));
}
fs.writeFileSync(process.argv[3], JSON.stringify(out,null,1));
