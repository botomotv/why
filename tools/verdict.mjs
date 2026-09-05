/* 판례 노드에 **확정 판결의 형량**을 채운다.
 *
 *   node tools/verdict.mjs --dry            받지 않고 규모만 센다
 *   node tools/verdict.mjs --limit 200      200건만 받는다 (이어서 받는다)
 *   node tools/verdict.mjs                  전부 받고 index.html 에 쓴다
 *
 * ── 왜 필요한가 ──
 * 지도의 판례 노드 2,819개가 **죄명만** 갖고 있었다. 「업무상과실치사」 라고만 적혀 있으면
 * 무슨 일이 있었는지도, 그래서 어떻게 됐는지도 모른다.
 * 사람들이 진짜 궁금해하는 것은 「그래서 걔 어떻게 됐어?」 다.
 *
 * ── 어떻게 확정을 확인하나 ── **우리가 판단하지 않는다**
 *   ① 대법원 판례의 주문이 「상고를 기각한다」 면 원심이 그대로 확정된 것이다
 *   ② 그 대법원 판례내용의 【원심판결】 줄에 원심 법원·사건번호가 적혀 있다
 *   ③ 그 원심 주문에 형량이 있다
 * 파기환송이면 형량이 아직 정해지지 않은 것이다 — **「확정 전」이라고 밝히고 형량을 안 쓴다.**
 * 규칙 1(확정된 것만)을 이렇게 지킨다.
 *
 * ── 왜 「사건 이름 + 죄명」 으로는 못 하나 ──
 * 판례의 사건명은 **죄명**이라 「살인」이 504건이다. 어느 것인지 가릴 단서는
 * 피고인 이름·사실관계뿐이고 규칙 8 이 그것을 금지한다.
 * 그래서 **법제처가 스스로 적은 【원심판결】 줄**만 쓴다. 거기엔 이름이 없다.
 *
 * ── 담지 않는 것 ──
 *   판례 전문 · 범죄사실 · 압수물 목록 · 당사자/대리인 이름 (규칙 8)
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickVerdict, penShort, isFinalDismissal, lowerCourt } from './lib/verdict.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const HTML = path.join(ROOT, 'index.html');
const CACHE = path.join(ROOT, 'db', 'verdicts.json');
const OC = process.env.LAW_OC || 'botomotv';
const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const num = f => { const i = ARGV.indexOf(f); return i < 0 ? 0 : +ARGV[i + 1] || 0 };
const DRY = has('--dry'), LIMIT = num('--limit') || Infinity;

/* ── 형사 판례만 고른다 ──
   민사·행정 판례에는 형량이 없다. 받아 봐야 버린다. */
const CRIM = /(위반|살인|치사|치상|상해|강간|추행|절도|사기|횡령|배임|방화|폭행|학대|음란|마약|도주|무고|뇌물|공갈|강도|협박|감금|유기|과실|은닉|알선|교사|방조|미수)/;

const html = fs.readFileSync(HTML, 'utf8');
/* 지도에 실제로 올라간 개별 판례 노드만. 묶음(_g)은 여러 건이라 형량 하나를 못 붙인다. */
const nodes = [];
const reN = /\{id:'(case_prec_(\d+))'[^\n]*?lab:'([^']*)'/g;
for (const m of html.matchAll(reN)) if (CRIM.test(m[3])) nodes.push({ id: m[1], sn: m[2], lab: m[3] });

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')) } catch {}
const todo = nodes.filter(n => !cache[n.id]);

console.log(`판례 노드 ${nodes.length}건(형사) · 이미 받은 것 ${nodes.length - todo.length}건 · 받을 것 ${Math.min(todo.length, LIMIT)}건`);
if (DRY) { console.log('(--dry 라 받지 않는다)'); process.exit(0) }

const db = fs.existsSync(DB) ? new DatabaseSync(DB, { readOnly: true }) : null;
const snOf = no => {
  if (!db) return null;
  const r = db.prepare(`SELECT case_sn FROM court_case WHERE kind='prec' AND case_no=? ORDER BY end_dt LIMIT 1`).get(no);
  return r && r.case_sn;
};
async function snByApi(no) {
  const u = `https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=prec&type=JSON&nb=${encodeURIComponent(no)}&display=5`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'why-map/1.0' } });
    const j = await r.json();
    let p = j && j.PrecSearch && j.PrecSearch.prec;
    if (!p) return null;
    if (!Array.isArray(p)) p = [p];
    return p.length ? String(p[0].판례일련번호) : null;
  } catch { return null }
}
async function fetchPrec(sn) {
  const u = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${sn}&type=JSON`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'why-map/1.0' } });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    const j = await r.json();
    const p = j && (j.PrecService || j);
    if (!p || !p.판례내용) return { err: '판례내용이 없다' };
    return { no: String(p.사건번호 || ''), nm: String(p.사건명 || ''), court: String(p.법원명 || ''),
             dt: String(p.선고일자 || ''), body: String(p.판례내용 || '') };
  } catch (e) { return { err: e.message } }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

let got = 0, fin = 0, pend = 0, none = 0, n = 0;
for (const nd of todo) {
  if (n++ >= LIMIT) break;
  const top = await fetchPrec(nd.sn);
  await sleep(220);
  if (top.err) { cache[nd.id] = { why: top.err }; continue }
  const tv = pickVerdict(top.body);

  /* 하급심 노드면 그 주문에 형량이 있다. 다만 **확정 여부를 모른다.** */
  if (top.court !== '대법원') {
    cache[nd.id] = tv.ok
      ? { p: penShort(tv.verdict), n: top.no, c: top.court, u: url(nd.sn), x: '확정 여부 확인 못 함' }
      : { why: tv.why || '형량 없음' };
    if (cache[nd.id].p) { got++; pend++ } else none++;
    continue;
  }
  /* 대법원 — 주문이 상고기각이어야 확정이다 */
  if (!tv.ok) { cache[nd.id] = { why: tv.why }; none++; continue }
  if (!isFinalDismissal(tv.verdict)) {
    cache[nd.id] = { n: top.no, c: top.court, u: url(nd.sn), x: '확정 전 · 대법원이 원심을 파기했습니다' };
    pend++; continue;
  }
  const low = lowerCourt(top.body);
  if (!low) { cache[nd.id] = { why: '원심판결 줄이 없다', x: '확정' }; none++; continue }
  let lsn = snOf(low.no) || await snByApi(low.no);
  await sleep(220);
  if (!lsn) { cache[nd.id] = { why: `원심 ${low.no} 를 법제처가 안 준다`, x: '확정', f: top.no }; none++; continue }
  const lo = await fetchPrec(lsn);
  await sleep(220);
  if (lo.err) { cache[nd.id] = { why: lo.err, x: '확정', f: top.no }; none++; continue }
  const lv = pickVerdict(lo.body);
  if (!lv.ok) { cache[nd.id] = { why: lv.why, x: '확정', f: top.no }; none++; continue }
  const p = penShort(lv.verdict);
  if (!p) { cache[nd.id] = { why: '형량 문장에서 숫자를 못 뽑았다', x: '확정', f: top.no }; none++; continue }
  cache[nd.id] = { p, n: lo.no, c: lo.court, f: top.no, u: url(lsn), x: '확정' };
  got++; fin++;
  if (got % 20 === 0) fs.writeFileSync(CACHE, JSON.stringify(cache, null, 0), 'utf8');
}
function url(sn) { return `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${sn}&type=HTML` }

fs.writeFileSync(CACHE, JSON.stringify(cache, null, 0), 'utf8');
console.log(`형량을 얻은 것 ${got}건 (확정 ${fin} · 확정 전/미확인 ${pend}) · 못 얻은 것 ${none}건`);

/* ── index.html 에 쓴다 ── */
const rows = [];
for (const nd of nodes) {
  const v = cache[nd.id];
  if (!v || (!v.p && !v.x)) continue;
  const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const f = [];
  if (v.p) f.push(`p:${q(v.p)}`);
  if (v.n) f.push(`n:${q(v.n)}`);
  if (v.c) f.push(`c:${q(v.c)}`);
  if (v.f) f.push(`f:${q(v.f)}`);
  if (v.u) f.push(`u:${q(v.u)}`);
  if (v.x) f.push(`x:${q(v.x)}`);
  if (f.length) rows.push(`${q(nd.id)}:{${f.join(',')}}`);
}
const block = `/*AUTO-PEN-START*/${rows.join('\n,')}/*AUTO-PEN-END*/`;
/* ── **쓰기 직전에 다시 읽는다** ──
   받는 데 15분이 걸린다. 그 사이에 사람이 index.html 을 고칠 수 있다.
   시작할 때 읽어 둔 내용을 끝에 통째로 다시 쓰면 **그 편집이 조용히 사라진다** —
   실제로 그렇게 네 군데(범례·점선·역할 테두리·원 크기)를 날렸다.
   문법 오류가 안 나고 화면만 옛날로 돌아가서, 검사가 FAIL 할 때까지 몰랐다.
   고치는 것은 한 줄이다 — **자기가 쓸 자리만 바꾸고 나머지는 지금 파일 그대로 둔다.** */
const fresh = fs.readFileSync(HTML, 'utf8');
const out = fresh.replace(/\/\*AUTO-PEN-START\*\/[\s\S]*?\/\*AUTO-PEN-END\*\//, block);
if (out === fresh && rows.length) { console.error('AUTO-PEN 자리를 못 찾았다'); process.exit(1) }
fs.writeFileSync(HTML, out, 'utf8');
console.log(`index.html 에 ${rows.length}건을 썼다`);
if (db) db.close();
