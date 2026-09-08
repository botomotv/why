/* 법 노드에 **제1조(목적) 원문**과 **쉬운 말**을 채운다.
 *
 *   node tools/law-purpose.mjs --dry
 *   node tools/law-purpose.mjs
 *
 * ── 지어내지 않는다 (원칙 0-B) ──
 *   원문은 창고 `law_purpose.purpose` 를 **그대로** 옮긴다. 요약하지 않는다.
 *   쉬운 말은 **사람이 쓴 것**(db/law_easy.json)만 쓴다. 없으면 원문만 보여준다.
 *   LLM 이 그 자리에서 지어낸 문장은 안 쓴다 — 그래서 검사 75 가
 *   쉬운 말에 원문에 없는 **숫자**가 있으면 FAIL 한다.
 *
 * ── 왜 필요한가 ──
 *   실측: 지도의 법 495개 중 400개가 창고에 제1조를 갖고 있는데
 *   **84개는 화면에 「무슨 법인지는 아래 원문 링크에서」 뿐**이었다.
 *   원문 링크만 있으면 아무도 안 누른다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const HTML = path.join(ROOT, 'index.html');
const DRY = process.argv.includes('--dry');
const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
const norm = s => String(s || '').replace(/[·・‧∙ㆍ]/g, '').replace(/\s+/g, '').trim();

const db = new DatabaseSync(DB, { readOnly: true });
const pur = new Map();
for (const r of db.prepare('SELECT law_nm, purpose FROM law_purpose').all())
  if (r.purpose && String(r.purpose).trim()) pur.set(norm(r.law_nm), String(r.purpose).trim());
/* ── 쉬운 말이 **어느 원문에서 왔는지** 함께 담는다 ──
   `db/law_easy.json` 은 머리글에 「법제처 **제·개정이유**를 쉬운 말로 옮긴 것」 이라고 적혀 있다.
   그런데 검사 75 는 처음에 **제1조**하고만 대조했다 — 그래서 「기초연금법 : 65」 같은
   멀쩡한 값이 「지어낸 숫자」 로 걸렸다. **검사가 다른 것을 재고 있었다.**
   두 원문을 다 넘기고, 둘 중 어디에도 없는 숫자만 잡게 한다. */
const rea = new Map();
for (const r of db.prepare('SELECT law_nm, reason FROM law_reason').all())
  if (r.reason && String(r.reason).trim()) rea.set(norm(r.law_nm), String(r.reason).trim());
db.close();

const easy = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'law_easy.json'), 'utf8'));
const easyBy = new Map();
for (const [k, v] of Object.entries(easy)) if (k !== '_' && v && v.what) easyBy.set(norm(k), v.what);

const raw = fs.readFileSync(HTML, 'utf8');
const a0 = raw.indexOf('/*AUTO-LAWP-START*/'), b0 = raw.indexOf('/*AUTO-LAWP-END*/');
const scan = (a0 >= 0 && b0 > a0) ? raw.slice(0, a0) + raw.slice(b0) : raw;

const laws = new Map();
for (const m of scan.matchAll(/\{id:'([^']+)'[^\n]*?t:'bill'[^\n]*?title:'([^']*)'/g)) laws.set(m[1], m[2]);
for (const m of scan.matchAll(/\{id:'([^']+)'[^\n]*?title:'([^']*)'[^\n]*?t:'bill'/g)) if (!laws.has(m[1])) laws.set(m[1], m[2]);

const out = {};
let hasP = 0, hasE = 0, none = [];
for (const [id, title] of laws) {
  const p = pur.get(norm(title)) || '';
  const e = easyBy.get(norm(title)) || '';
  if (!p && !e) { none.push(title); continue }
  out[id] = {}; if (p) { out[id].p = p; hasP++ } if (e) { out[id].e = e; hasE++ }
  /* 검사가 대조할 원문. 화면에는 안 쓰고 **검사만** 본다 — 길어서 카드에 다 실을 수 없다 */
  const r2 = rea.get(norm(title)) || '';
  if (e && r2) out[id].r = r2.slice(0, 1200);
}
console.log(`지도의 법 ${laws.size}개`);
console.log(`  제1조(목적) 원문을 붙인 것 ${hasP} · 쉬운 말이 있는 것 ${hasE}`);
console.log(`  둘 다 없는 것 ${none.length}${none.length ? ' — ' + none.slice(0, 6).join(' · ') + (none.length > 6 ? ' 외' : '') : ''}`);
if (DRY) process.exit(0);

const js = Object.entries(out).map(([k, v]) =>
  `'${k}':{` + Object.entries(v).map(([kk, x]) => kk + ':' + q(x)).join(',') + '}').join('\n,');
let html = fs.readFileSync(HTML, 'utf8');
const A = '/*AUTO-LAWP-START*/', B = '/*AUTO-LAWP-END*/';
const i = html.indexOf(A), j = html.indexOf(B);
if (i < 0 || j < 0) { console.error('index.html 에 AUTO-LAWP 자리가 없다'); process.exit(1) }
fs.writeFileSync(HTML, html.slice(0, i + A.length) + '\n' + js + '\n' + html.slice(j), 'utf8');
console.log(`\nindex.html 에 ${Object.keys(out).length}개 내보냄`);
