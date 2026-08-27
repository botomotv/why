/* 법 제1조(목적) → **쉬운 말 초안**.
 *
 *   node tools/law-easy.mjs            db/law_easy_auto.json 을 만든다
 *   node tools/law-easy.mjs --dry      만들지 않고 세기만 한다
 *
 * ── 무엇을 하는가 ──
 *   제1조는 문장 틀이 거의 같다:
 *     "이 법은 [A 에 관하여] [B 를 규정]함으로써 [C] 를 목적으로 한다"
 *   사람이 알고 싶은 것은 **A+B**(이 법이 무엇을 정하는가)지 C(지향점)가 아니다.
 *   그래서 '…함으로써' 앞을 잘라내고, 치환표(db/easy_words.json)로 한자어를 바꾼다.
 *
 * ── 지키는 것 (원칙 0-B) ──
 *   **원문에 있는 말만 바꾼다.** 없는 내용을 더하지 않는다.
 *   그래서 이 초안은 '지어낸 것' 이 아니라 '옮긴 것' 이다 — 원문을 카드에 나란히 둔다.
 *   규칙으로 안 되는 것(너무 길거나 어려운 말이 남는 것)은 **사람이 쓴다.**
 *   사람이 쓴 것은 db/law_easy.json 에 있고 그쪽이 우선이다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const MAXLEN = 60;                    /* 검사 30 의 한 문장 한도 */

/* 검사 30 이 '설명 없이 쓰면 안 된다' 고 보는 말. 여기서도 같은 목록을 쓴다 —
   두 벌이 되면 갈라진다. 검사가 쓰는 배열을 그대로 옮겨 적지 않고 파일에서 읽는다. */
const chk = fs.readFileSync(path.join(ROOT, 'test', 'check.cjs'), 'utf8');
const hardM = chk.match(/var HARD=\[([\s\S]*?)\];/);
const HARD = hardM ? [...hardM[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];

const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'easy_words.json'), 'utf8'));
delete words._;
/* 긴 것부터 바꾼다 — '이바지함' 을 먼저 바꾸면 '발전에 이바지함' 을 못 잡는다 */
const pairs = Object.entries(words).sort((a, b) => b[0].length - a[0].length);

let hand = {};
try { hand = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'law_easy.json'), 'utf8')); delete hand._ } catch { }

const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare('SELECT law_nm, purpose FROM law_purpose').all();

/* 원문에서 '무엇을 정하는 법인가' 만 남긴다 */
function core(p) {
  let s = String(p || '')
    .replace(/^제\s*1\s*조\s*\([^)]*\)\s*/, '')      /* 「제1조(목적)」 머리 */
    .replace(/^이\s*법은\s*/, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/「|」/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/\([^)]*\)/g, ' ');                 /* 괄호 안 한자·단서는 뺀다 */
  /* '…함으로써' 뒤는 지향점(C)이라 뺀다 */
  const cut = s.search(/함으로써|음으로써|으로써/);
  if (cut > 8) s = s.slice(0, cut);
  else s = s.replace(/(을|를)?\s*목적으로 한다\.?$/, '');
  s = s.replace(/\s+/g, ' ').trim();
  /* ── **마지막 목적어구만 남긴다** ──
     제1조는 배경 설명이 길다. 「모든 국민이 …다양한 영역에서 수준 높은 간호 혜택을
     받을 수 있도록 **간호에 관하여 필요한 사항을 규정**」 처럼, 정작 '무엇을 정하는지' 는
     맨 뒤에 짧게 있다. 앞을 다 남기면 163자가 되고 아무도 안 읽는다.
     그래서 '…을 규정/정함' 바로 앞의 한 덩어리만 가져온다. **원문에 있는 말만 쓴다.** */
  const m = s.match(/([^,，]{2,40}?)(?:에 관하여|에 관한|에 대하여)?\s*필요한\s*사항[을를]?\s*(?:규정|정)/);
  if (m) return m[1].replace(/\s+/g, ' ').trim() + '에 필요한 것';
  const m2 = s.match(/([^,，]{2,40})[을를]\s*(?:규정|정|규율)(?:함|한다|하는)?\s*$/);
  if (m2) return m2[1].replace(/\s+/g, ' ').trim();
  /* 그래도 길면 마지막 쉼표 뒤만 — 배경이 아니라 본론이 뒤에 온다 */
  const parts = s.split(/[,，]/).map(x => x.trim()).filter(Boolean);
  if (parts.length > 1 && s.length > 46) return parts[parts.length - 1];
  return s;
}
function easy(s) {
  let t = s;
  for (const [a, b] of pairs) t = t.split(a).join(b);
  t = t.replace(/\s+/g, ' ').replace(/\s([,.])/g, '$1').trim();
  t = t.replace(/(을|를|을를)?\s*(정함|정하는 것|규정함|규정)$/, '');
  t = t.replace(/[.\s]+$/, '');
  if (!t) return '';
  /* 받침이 있으면 '을', 없으면 '를'. 조사를 잘못 붙이면 옮긴 티가 난다. */
  const last = t.charCodeAt(t.length - 1);
  const josa = (last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0) ? '을' : '를';
  return t + josa + ' 정한 법입니다.';
}
const okLen = s => s.split(/(?<=[.!?])\s+/).every(x => x.trim().length <= MAXLEN);
const okHard = s => !HARD.some(w => s.indexOf(w) >= 0);
const okTone = s => /니다[.!?]?$/.test(s.trim());

const out = {}, fails = [];
let pass = 0, byHand = 0;
for (const r of rows) {
  if (hand[r.law_nm] && hand[r.law_nm].what) { byHand++; continue }   /* 사람이 쓴 게 우선 */
  const c = core(r.purpose);
  const e = easy(c);
  const ok = e && okLen(e) && okHard(e) && okTone(e);
  if (ok) { out[r.law_nm] = { what: e, src: r.purpose }; pass++ }
  else fails.push({ law: r.law_nm, draft: e, why: !e ? '빈 문장' : !okLen(e) ? '60자 초과(' + e.length + ')' : !okHard(e) ? '어려운 말' : '말투' });
}
console.log(`제1조 원문 ${rows.length}건`);
console.log(`  사람이 이미 쓴 것          ${byHand}`);
console.log(`  규칙으로 옮겨 검사 통과     ${pass}`);
console.log(`  규칙으로 안 되는 것        ${fails.length}  ← 사람이 써야 한다`);
const why = {}; fails.forEach(f => why[f.why] = (why[f.why] || 0) + 1);
console.log(`  안 되는 까닭: ${JSON.stringify(why)}`);
if (fails.length) { console.log('\n예 5개'); fails.slice(0, 5).forEach(f => console.log(`  · ${f.law}\n    [${f.why}] ${f.draft.slice(0, 90)}`)) }
if (!DRY) {
  const body = { _: ['제1조(목적) 원문을 **규칙으로** 옮긴 초안. tools/law-easy.mjs 가 만든다.',
    '원문(src)을 함께 담는다 — 옮긴 말이 원문에서 나왔는지 대조할 수 있어야 한다.',
    '사람이 쓴 db/law_easy.json 이 있으면 그쪽이 우선이다. 여기 것은 손대지 마라 — 다시 만들면 덮인다.'] };
  Object.keys(out).sort().forEach(k => body[k] = out[k]);
  fs.writeFileSync(path.join(ROOT, 'db', 'law_easy_auto.json'), JSON.stringify(body, null, 1) + '\n');
  fs.writeFileSync(path.join(ROOT, 'db', 'law_easy_todo.json'),
    JSON.stringify({ _: ['규칙으로 안 되는 법. **사람이 db/law_easy.json 에 what 을 써야 한다.**',
      '원문(src)을 함께 둔다. 지어내지 말고 원문을 옮겨라.'],
      list: fails.map(f => ({ law: f.law, why: f.why, draft: f.draft,
        src: (rows.find(r => r.law_nm === f.law) || {}).purpose })) }, null, 1) + '\n');
  console.log(`\ndb/law_easy_auto.json ${pass}건 · db/law_easy_todo.json ${fails.length}건`);
}
db.close();
