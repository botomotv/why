/* **한 줄 설명이 없는 법**만 골라 다시 받는다.
 *
 *   node tools/collect-missing.mjs
 *
 * 화면에 "이 법이 무슨 법인지는 확인 중입니다" 가 나오는 것은 미완성을 보여주는 것이다.
 * 32개가 그랬다. 그 32개만 법제처에 다시 물어 목적 조문·조문 제목을 채운다.
 *
 * ── 왜 처음에 못 받았나 ──
 *   collect-purpose 는 **제1조가 목적 조문일 때만** 담는다. 「개별소비세법」은
 *   제1조가 '과세대상과 세율' 이라 비웠다 — 그건 맞는 판단이다.
 *   그런데 collect-articles 도 같은 목록을 돌아서 조문 제목까지 같이 빠졌다.
 *   **목적이 없다고 조문까지 없는 것이 아니다.** 실제로 개별소비세법은
 *   조문 40개가 그대로 받아진다 (과세대상과 세율 · 잠정세율 · 비과세 …).
 *
 * ── 지키는 것 (원칙 0-B) ──
 *   원문만 담는다. 요약·의역은 하지 않는다. 없으면 비우고 몇 개인지 밝힌다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const GAP = Number(process.env.LAW_GAP || 260);
const NOW = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 어떤 법이 비어 있나 — **페이지에서 읽는다.** 목록을 손으로 적으면 갈라진다. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const { JSDOM } = await import('jsdom');
const { VirtualConsole } = await import('jsdom');
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
  .map(n => ({ id: n.id, lab: n.lab, arts: (n.arts || []).length }));
dom.window.close();
console.log(`한 줄 설명이 없는 법 ${need.length}개 — 이것만 다시 받는다\n`);
if (!need.length) process.exit(0);

const db = new DatabaseSync(DB);
const insP = db.prepare('INSERT OR REPLACE INTO law_purpose (law_nm,mst,jo_title,purpose,src_url,fetched_at) VALUES (?,?,?,?,?,?)');
const insA = db.prepare('INSERT OR REPLACE INTO law_articles (law_nm,mst,titles,n,fetched_at) VALUES (?,?,?,?,?)');

const J = async (u) => {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'why-map/1.0 (+https://why-map.com)' } });
      const x = await r.text(); return JSON.parse(x); } catch (e) { await sleep(500) }
  }
  return null;
};

let gotP = 0, gotA = 0, noLaw = 0, noArt = 0;
const still = [];
for (const b of need) {
  const q = encodeURIComponent(b.lab);
  const s = await J(`https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=law&type=JSON&query=${q}&display=100`);
  await sleep(GAP);
  let list = s && s.LawSearch && s.LawSearch.law; if (list && !Array.isArray(list)) list = [list];
  /* **이름이 정확히 같은 것만.** 「개별소비세법 시행령」을 잡으면 다른 법을 싣게 된다.
     다만 띄어쓰기와 가운뎃점은 표마다 다르다 — 「교통·에너지·환경세법」 과
     「교통ㆍ에너지ㆍ환경세법」 은 같은 법이다. 그것만 맞춰 놓고 비교한다.
     그리고 display 를 5 로 뒀더니 「에너지법」이 6번째라 못 찾았다 — 100 으로 올린다. */
  const norm = x => String(x || '').replace(/[\sㆍ·・]/g, '');
  const hit = (list || []).find(x => norm(x['법령명한글']) === norm(b.lab));
  if (!hit) { noLaw++; still.push([b.lab, '법제처에서 같은 이름의 법을 못 찾았다']); continue }
  const mst = String(hit['법령일련번호'] || '');
  const d = await J(`https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&type=JSON&MST=${mst}`);
  await sleep(GAP);
  let arts = d && d['법령'] && d['법령']['조문'] && d['법령']['조문']['조문단위'];
  if (arts && !Array.isArray(arts)) arts = [arts];
  if (!arts || !arts.length) { noArt++; still.push([b.lab, '법제처가 조문을 안 준다']); continue }

  /* 목적 조문이 있으면 담는다 — **제1조이면서 제목이 '목적'** 일 때만. */
  const p1 = arts.find(a => String(a['조문번호']) === '1' && /목적/.test(String(a['조문제목'] || '')));
  if (p1) {
    const body = String(p1['조문내용'] || '').replace(/^제1조\([^)]*\)\s*/, '').trim();
    if (body.length > 10) {
      insP.run(b.lab, mst, String(p1['조문제목'] || ''), body,
        `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&MST=${mst}&type=HTML`, NOW);
      gotP++;
    }
  }
  const titles = arts.map(a => String(a['조문제목'] || '').trim()).filter(Boolean);
  if (titles.length) { insA.run(b.lab, mst, titles.join('·'), titles.length, NOW); gotA++; }
  else still.push([b.lab, '조문에 제목이 없다']);
  process.stdout.write(`\r  ${gotP + gotA}/${need.length * 2}   `);
}
db.close();
console.log(`\n\n  목적 조문을 새로 받은 것 ${gotP}개 · 조문 제목을 받은 것 ${gotA}개`);
console.log(`  법제처에 이름이 없는 것 ${noLaw}개 · 조문을 안 주는 것 ${noArt}개`);
if (still.length) { console.log('\n  여전히 비어 있는 것:'); still.forEach(([a, b]) => console.log(`   · ${a} — ${b}`)) }
