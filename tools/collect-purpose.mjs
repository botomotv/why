/* 법 제1조(목적) 수집기 — **"이게 무슨 법인지" 의 원문 출처.**
 *
 *   node tools/collect-purpose.mjs [--dry]
 *
 * 왜 필요한가 — 카드가 「국세기본법 · 2015~2025년 · 11번 고침」 이 전부였다.
 *   국세기본법이 뭔지 모르면 나머지가 다 의미가 없다.
 *
 * 지키는 것 (원칙 0-B)
 *  - **원문을 그대로 담는다.** 요약·의역은 여기서 하지 않는다.
 *  - 제1조가 목적 조문이 아니면(「제1장 총칙」 같은 장 제목) **비운다.**
 *    법 이름에서 유추하지 않는다 — 그건 지어내는 것이다.
 *  - 못 받은 것을 분모와 함께 밝힌다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const DRY = process.argv.includes('--dry');
const GAP = Number(process.env.LAW_GAP || 130);
const NOW = new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
/* 법제처는 가운뎃점을 ㆍ(U+318D) 로 쓰고 국회는 ·(U+00B7) 로 쓴다. */
const norm = s => String(s || '').replace(/[·・‧∙]/g, 'ㆍ').replace(/\s+/g, ' ').trim();

const api = async (t, p) => {
  const u = new URL('http://www.law.go.kr/DRF/' + t);
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, String(v));
  for (let i = 0; i < 3; i++) {
    try { return JSON.parse(await (await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } })).text()) }
    catch { await sleep(500 * (i + 1)) }
  }
  return null;
};

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const laws = [...new Set([...html.matchAll(/\{id:'auto_[^']*',t:'bill',auto:1[^}]*?lab:'([^']*)'/g)].map(m => m[1]))];
console.log(`법 제1조(목적) · 대상 ${laws.length}개${DRY ? '  (--dry)' : ''}\n`);

const have = new Set(DRY ? [] : db.prepare('SELECT law_nm FROM law_purpose').all().map(r => r.law_nm));
const ins = DRY ? null : db.prepare(
  `INSERT OR REPLACE INTO law_purpose (law_nm,mst,jo_title,purpose,src_url,fetched_at) VALUES (?,?,?,?,?,?)`);

let got = 0, noHit = 0, noPurpose = 0, skip = 0;
const missing = [];
for (const nm of laws) {
  if (have.has(nm)) { skip++; continue }
  const s = await api('lawSearch.do', { target: 'law', query: nm, display: 5 });
  await sleep(GAP);
  const rows = arr(s && s.LawSearch && s.LawSearch.law);
  const hit = rows.find(r => norm(r['법령명한글']) === norm(nm)) || rows[0];
  if (!hit) { noHit++; missing.push(nm); continue }
  const mst = String(hit['법령일련번호'] || '');
  const d = await api('lawService.do', { target: 'law', MST: mst });
  await sleep(GAP);
  const o = d && (d[Object.keys(d)[0]] || d);
  const jos = arr(o && o['조문'] && (o['조문']['조문단위'] || o['조문']));
  /* **'목적' 조문을 찾는다.** 첫 조문이 「제1장 총칙」 인 법이 있어서
     그냥 [0] 을 쓰면 목적이 아닌 것이 들어온다 — 실측으로 확인했다. */
  const jo = jos.find(j => String(j['조문제목'] || '').trim() === '목적')
          || jos.find(j => /^제1조\s*\(\s*목적\s*\)/.test(String(j['조문내용'] || '').trim()));
  if (!jo) { noPurpose++; missing.push(nm); continue }
  const body = String(jo['조문내용'] || '').replace(/\s+/g, ' ').trim();
  if (!body) { noPurpose++; missing.push(nm); continue }
  if (ins) ins.run(nm, mst, String(jo['조문제목'] || ''), body,
    `https://www.law.go.kr/법령/${encodeURIComponent(nm)}`, NOW);
  got++;
  if (got % 25 === 0) process.stdout.write(`\r  받음 ${got} · 목적 조문 없음 ${noPurpose} · 못 찾음 ${noHit}   `);
}
console.log(`\n\n  새로 받은 것 ${got} · 이미 있던 것 ${skip}`);
console.log(`  목적 조문이 없는 법 ${noPurpose} · 법제처에서 못 찾은 법 ${noHit}`);
if (!DRY) {
  const tot = db.prepare('SELECT COUNT(*) c FROM law_purpose').get().c;
  console.log(`\n창고 law_purpose ${tot}건 / 대상 ${laws.length}개 (${(tot / laws.length * 100).toFixed(0)}%)`);
}
if (missing.length) console.log(`\n못 채운 법 ${missing.length}개 앞 10:\n  ` + missing.slice(0, 10).join('\n  '));
db.close();
