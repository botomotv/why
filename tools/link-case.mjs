/* 사건(헌재결정례·판례) → 지도. 창고 court_case 에서 관문을 통과한 것만 올린다.
 *
 *   node tools/link-case.mjs --dry     세기만 한다
 *   node tools/link-case.mjs           창고 link 표에 쓰고 index.html 에 내보낸다
 *
 * 관문 두 가지 — **근거의 세기가 다르다. 섞지 않고 따로 센다.**
 *
 *   A. 사건명에 법 이름이 그대로 있다     → 그 법률 노드에 잇는다
 *      "구 국적법 부칙 제7조 제1항 위헌소원" 은 국적법을 다툰 것이다.
 *      추측이 아니라 재판부가 스스로 그 법을 적은 것이다. **가장 센 근거다.**
 *   B. 사건명에 결과의 핵심어가 있고 시기가 겹친다 → 그 결과에 잇는다
 *      법안 3관문과 같은 세기다. 자동 법률에 쓰는 것과 같은 잣대다.
 *
 * 지키는 것
 *  - role 은 topic 하나다. **인과가 아니라 '같은 주제' 다.** 헌재가 법을 심판한 것은
 *    사실이지만, 그것이 결과 숫자를 만들었다는 주장은 우리가 하지 않는다.
 *  - link.why 를 반드시 채운다. 근거를 못 대는 선은 넣지 않는다.
 *  - **전문을 싣지 않는다.** 사건명·사건번호·날짜만 내보낸다. 창고에도 전문은 없다.
 *  - 연도가 사건번호(접수연도)에서 온 것은 화면에 그렇게 적는다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const YEARS = Number(process.env.CASE_YEARS || 3);
const RULE_A = 'case_by_law_name', RULE_B = 'case_by_keyword_and_year';
const NOW = new Date().toISOString().slice(0, 10);
const KIND = { detc: '헌법재판소 결정', prec: '법원 판례' };

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

/* 지도에 이미 있는 것을 index.html 에서 직접 읽는다. 여기서 베껴 쓰면 화면과 갈라진다. */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const laws = [...html.matchAll(/\{id:'(auto_[^']*)',t:'bill',auto:1[^}]*?lab:'([^']*)'[^}]*?yr:'(\d{4})'/g)]
  .map(m => ({ id: m[1], lab: m[2], yr: +m[3] }));
const cmap = html.match(/var CATMAP\s*=\s*\{([\s\S]*?)\n\};/);
const catOf = {};
for (const g of cmap[1].matchAll(/['"]?([\w]+)['"]?\s*:\s*\[([^\]]*)\]/g))
  for (const id of g[2].split(',').map(x => x.replace(/['\s]/g, '')).filter(Boolean))
    (catOf[id] = catOf[id] || []).push(g[1]);
const results = [...html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?lab:'([^']*)'[\s\S]{0,300}?yr:'(\d{4})',keys:\[([^\]]*)\]/g)]
  .map(m => ({ id: m[1], lab: m[2], yr: +m[3], cats: catOf[m[1]] || [],
    keys: m[4].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean) }));
let catKeys = {};
try { catKeys = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'cat_keys.json'), 'utf8')); delete catKeys._ } catch { }
for (const r of results)
  r.wide = r.keys.length ? [...new Set([...r.keys, ...r.cats.flatMap(c => catKeys[c] || [])])] : [];

/* 법 이름이 긴 것부터 본다 — '국적법' 이 '국적법시행령' 을 먼저 삼키면 안 된다 */
const lawsBy = [...laws].sort((a, b) => b.lab.length - a.lab.length);

const cases = db.prepare(
  `SELECT case_sn,kind,case_no,case_nm,end_dt,yr,yr_src,court,ctype,src_url
     FROM court_case WHERE case_nm<>'' AND yr IS NOT NULL`).all();
console.log(`사건 ${cases.length.toLocaleString()}건 · 법률 ${laws.length}개 · 결과 ${results.length}개` +
            ` · 2관문 ±${YEARS}년${DRY ? '  (--dry)' : ''}\n`);

const nodes = new Map(), links = [];
const add = c => {
  if (nodes.has(c.case_sn)) return nodes.get(c.case_sn);
  const byNo = c.yr_src === 'caseno';
  const n = {
    id: 'case_' + c.kind + '_' + c.case_sn, t: 'event', auto: 1, side: 'gov',
    lab: c.case_nm.length > 34 ? c.case_nm.slice(0, 33) + '…' : c.case_nm,
    title: c.case_nm, yr: String(c.yr),
    ekind: `${c.yr}년 · ${KIND[c.kind] || c.kind}` + (byNo ? ' · 연도는 사건 접수 연도' : ''),
    off: `${KIND[c.kind] || c.kind} · ${c.case_no}`,
    tip: `${KIND[c.kind] || c.kind}입니다. 사건번호는 ${c.case_no}입니다.`,
    body: `${KIND[c.kind] || c.kind}입니다. 사건 이름은 "${c.case_nm}" 이고 사건번호는 ${c.case_no}입니다.` +
      (byNo ? ' 결정한 날짜를 못 받아서, 연도는 사건이 접수된 해입니다.' : '') +
      ' 무슨 판단을 했는지는 아래 원문 링크에서 볼 수 있습니다.',
    src: `출처 · 법제처 국가법령정보 공동활용 (${KIND[c.kind] || c.kind})`,
    url: c.src_url, cats: []
  };
  nodes.set(c.case_sn, n); return n;
};

let a = 0, b = 0, none = 0;
for (const c of cases) {
  const nm = c.case_nm;
  let hit = false;
  /* A · 사건명에 법 이름이 있다 */
  for (const L of lawsBy) {
    if (L.lab.length < 4 || !nm.includes(L.lab)) continue;
    const n = add(c); hit = true; a++;
    links.push({ from: n.id, to: L.id, rule: RULE_A,
      why: `사건 이름에 법 이름 '${L.lab}' 이 그대로 있습니다`,
      ev: `${KIND[c.kind]} ${c.case_no}` });
    break;                              /* 가장 긴 이름 하나만. 여러 개 붙이면 같은 말이 늘어난다 */
  }
  /* B · 사건명에 결과의 핵심어가 있고 시기가 겹친다 */
  for (const r of results) {
    if (!r.wide.length || Math.abs(c.yr - r.yr) > YEARS) continue;
    const k = r.wide.find(x => x.length >= 2 && nm.includes(x));
    if (!k) continue;
    const n = add(c); hit = true; b++;
    links.push({ from: n.id, to: r.id, rule: RULE_B,
      why: `사건 이름에 '${k}' 이 있고 시기가 ${Math.abs(c.yr - r.yr) === 0 ? '같은 해' : Math.abs(c.yr - r.yr) + '년 차이'}입니다`,
      ev: `${KIND[c.kind]} ${c.case_no}` });
  }
  if (!hit) none++;
}
const nl = n => n.toLocaleString();
console.log(`  A 사건명에 법 이름          ${nl(a).padStart(8)}건`);
console.log(`  B 핵심어 + 시기 ±${YEARS}년      ${nl(b).padStart(8)}건`);
console.log(`  ────────────────────────────────────`);
console.log(`  올라간 사건 ${nl(nodes.size)} / ${nl(cases.length)}  ·  선 ${nl(links.length)}개`);
console.log(`  어느 관문도 못 지난 사건 ${nl(none)} (${(none / cases.length * 100).toFixed(1)}%) — 안 올린다`);
const byKind = {}; for (const n of nodes.values()) { const k = n.id.split('_')[1]; byKind[k] = (byKind[k] || 0) + 1 }
console.log(`  종류별 ${JSON.stringify(byKind)}`);
/* 같은 (사건 → 대상 → 규칙) 이 두 번 나오면 같은 사실을 두 번 적는 것이다.
   창고의 UNIQUE 가 먼저 잡아 줬다 — 몇 개였는지 밝히고 하나로 줄인다. */
{
  const seen = new Set(), keep = [];
  for (const l of links) { const k = l.from + '|' + l.to + '|' + l.rule; if (seen.has(k)) continue; seen.add(k); keep.push(l) }
  const dup = links.length - keep.length;
  if (dup) console.log(`  같은 선이 두 번 나온 것 ${nl(dup)}개 — 하나로 줄였다`);
  links.length = 0; links.push(...keep);
}
if (DRY) { db.close(); process.exit(0) }

db.exec('BEGIN');
try {
  db.prepare('DELETE FROM link WHERE rule IN (?,?)').run(RULE_A, RULE_B);
  const ins = db.prepare(
    `INSERT INTO link (from_id,to_id,role,rule,why,evidence,built_at) VALUES (?,?,'topic',?,?,?,?)`);
  for (const l of links) ins.run(l.from, l.to, l.rule, l.why, l.ev, NOW);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e }

const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\u2028|\u2029/g, ' ') + "'";
const nodeJs = [...nodes.values()].map(n =>
  `{id:${q(n.id)},t:'event',auto:1,side:'gov',lab:${q(n.lab)},title:${q(n.title)},yr:${q(n.yr)},` +
  `ekind:${q(n.ekind)},off:${q(n.off)},tip:${q(n.tip)},body:${q(n.body)},src:${q(n.src)},url:${q(n.url)},cats:[]}`).join('\n,');
const linkJs = links.map(l =>
  `[${q(l.from)},${q(l.to)},'같은 주제','topic',${q(l.why)},${q(l.ev)},'','auto']`).join('\n,');

let out = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const put = (tag, body) => {
  const s = `/*AUTO-${tag}-START*/`, e = `/*AUTO-${tag}-END*/`;
  const i = out.indexOf(s), j = out.indexOf(e);
  if (i < 0 || j < 0) { console.error(`index.html 에 ${s} 자리가 없다`); process.exit(2) }
  out = out.slice(0, i + s.length) + '\n' + body + '\n' + out.slice(j);
};
put('CASE-N', nodeJs); put('CASE-L', linkJs);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
console.log(`\nindex.html 에 사건 ${nl(nodes.size)}개 · 선 ${nl(links.length)}개 내보냄`);
db.close();
