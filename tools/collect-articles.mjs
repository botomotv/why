/* 법의 **조문 제목**만 받는다 — "무슨 법인지" 를 풀어 쓸 재료.
 *
 *   node tools/collect-articles.mjs
 *
 * 제1조(목적) 한 줄로는 부족하다. 「상가건물 임대차보호법」이
 * "가게를 빌려 쓰는 사람을 보호하는 법입니다" 하나면 뭘 보호하는지가 없다.
 * 조문 제목을 보면 알 수 있다 — 「대항력」·「계약갱신 요구권」·「권리금 회수기회 보호」.
 *
 * **제목만 담는다.** 본문은 안 담는다. 우리가 쓸 것은 제목이면 충분하고,
 * 본문까지 담으면 창고가 원문 저장소가 된다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const GAP = Number(process.env.LAW_GAP || 130);
const NOW = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
const api = async p => {
  const u = new URL('http://www.law.go.kr/DRF/lawService.do');
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, String(v));
  for (let i = 0; i < 3; i++) {
    try { return JSON.parse(await (await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } })).text()) }
    catch { await sleep(500 * (i + 1)) }
  }
  return null;
};
const db = new DatabaseSync(DB);
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
const src = db.prepare('SELECT law_nm, mst FROM law_purpose').all();
const have = new Set(db.prepare('SELECT law_nm FROM law_articles').all().map(r => r.law_nm));
const ins = db.prepare('INSERT OR REPLACE INTO law_articles (law_nm,mst,titles,n,fetched_at) VALUES (?,?,?,?,?)');
console.log(`조문 제목 · 대상 ${src.length}개 · 이미 받은 것 ${have.size}\n`);
let got = 0, none = 0;
db.exec('BEGIN');
for (const r of src) {
  if (have.has(r.law_nm)) continue;
  const d = await api({ target: 'law', MST: r.mst });
  await sleep(GAP);
  const o = d && (d[Object.keys(d)[0]] || d);
  const jos = arr(o && o['조문'] && (o['조문']['조문단위'] || o['조문']));
  const ts = [...new Set(jos.map(j => String(j['조문제목'] || '').trim())
    .filter(t => t && t !== '목적' && t.length <= 30))];
  if (!ts.length) { none++; continue }
  ins.run(r.law_nm, r.mst, ts.join('·'), ts.length, NOW);
  got++;
  if (got % 40 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); process.stdout.write(`\r  ${got}개   `) }
}
db.exec('COMMIT');
console.log(`\n  받은 것 ${got} · 조문 제목이 없는 법 ${none}`);
const tot = db.prepare('SELECT COUNT(*) c FROM law_articles').get().c;
console.log(`창고 law_articles ${tot}건`);
db.close();
