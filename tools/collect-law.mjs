/* 법제처 제·개정이유 수집기 — 원본을 그대로 창고에 담는다.
 *
 *   node tools/collect-law.mjs            자동으로 붙은 법률만
 *   node tools/collect-law.mjs --dry      받아만 보고 안 쓴다
 *
 * 지키는 것
 *  - **원문을 요약하지 않는다.** reason 칸에 받은 그대로 넣는다.
 *    쉬운 말로 옮기는 것은 사람이 따로 하고 db/law_easy.json 에 둔다.
 *  - 법제처는 **현행 법령만** 준다. 그래서 이 이유는 가장 최근 개정 하나의 것이다.
 *    그 앞의 개정 이유는 받을 방법이 없다 — 화면에 밝힌다.
 *  - 못 받은 것은 세어서 밝힌다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const OC = process.env.LAW_OC || 'botomotv';
const DRY = process.argv.includes('--dry');
const GAP = Number(process.env.LAW_GAP || 250);
const NOW = new Date().toISOString().slice(0, 10);

const first = o => (o && typeof o === 'object') ? o[Object.keys(o)[0]] : null;
const arr = v => Array.isArray(v) ? v : (v ? [v] : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 법제처는 가운뎃점을 ㆍ(U+318D) 로 쓰고 국회는 ·(U+00B7) 로 쓴다.
   맞추지 않으면 '저출산·고령사회기본법' 을 못 찾는다 — 실측으로 3건이 그랬다. */
const norm = s => String(s || '').replace(/[·・‧∙]/g, 'ㆍ').replace(/\s+/g, ' ').trim();

async function api(t, p) {
  const u = new URL('http://www.law.go.kr/DRF/' + t);
  u.searchParams.set('OC', OC); u.searchParams.set('type', 'JSON');
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, String(v));
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'why-map/collect' } });
    return JSON.parse(await r.text());
  } catch { return null }
}

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

/* 받을 대상 = 지도에 올라간 자동 법률. index.html 에서 직접 읽는다. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const laws = [...new Set([...html.matchAll(/\{id:'auto_[^']*',t:'bill',auto:1[^}]*?lab:'([^']*)'/g)].map(m => m[1]))];
if (!laws.length) { console.error('자동 법률이 index.html 에 없다. 먼저 node tools/link.mjs'); process.exit(1) }

console.log(`법제처 제·개정이유 · 대상 ${laws.length}개${DRY ? '  (--dry)' : ''}\n`);
const have = new Set(DRY ? [] : db.prepare('SELECT law_nm FROM law_reason').all().map(r => r.law_nm));

const ins = DRY ? null : db.prepare(
  `INSERT OR REPLACE INTO law_reason
     (law_nm,mst,law_kind,rvs_kind,promul_dt,effect_dt,dept,reason,src_url,fetched_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`);

let got = 0, skip = 0; const miss = [];
for (const nm of laws) {
  if (have.has(nm)) { skip++; continue }
  const q = norm(nm);
  const s = await api('lawSearch.do', { target: 'law', display: 40, query: q });
  await sleep(GAP);
  const t = first(s);
  const rows = arr(t && (t.law || t.Law)).filter(r => norm(r['법령명한글']) === q);
  if (!rows.length) { miss.push(nm); continue }
  const r0 = rows[0];
  const d = await api('lawService.do', { target: 'law', MST: r0['법령일련번호'] });
  await sleep(GAP);
  const root = first(d);
  const rz = root && root['제개정이유'] && root['제개정이유']['제개정이유내용'];
  const reason = arr(rz).flat().filter(x => typeof x === 'string').join('\n').trim();
  if (reason.length < 40) { miss.push(nm + ' (이유 없음)'); continue }
  got++;
  if (!DRY) ins.run(nm, String(r0['법령일련번호']), r0['법령구분명'] || null,
    r0['제개정구분명'] || null, r0['공포일자'] || null, r0['시행일자'] || null,
    r0['소관부처명'] || null, reason,
    'https://www.law.go.kr/법령/' + encodeURIComponent(norm(nm)), NOW);
  process.stdout.write(`\r  받은 것 ${got} · 건너뜀 ${skip} · 못 받음 ${miss.length}   `);
}
console.log('');
console.log(`\n받음 ${got} · 이미 있어 건너뜀 ${skip} · 못 받음 ${miss.length} / 대상 ${laws.length}`);
if (miss.length) console.log(`  못 받은 것: ${miss.join(' · ')}`);
if (!DRY) {
  const n = db.prepare('SELECT COUNT(*) n FROM law_reason').get().n;
  console.log(`\nlaw_reason ${n}건`);
  console.log('다음: 쉬운 말로 옮긴 것을 db/law_easy.json 에 넣고 node tools/link.mjs');
}
db.close();
