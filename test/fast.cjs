/* 빠른 검사 — **jsdom 없이 데이터만** 본다.
 *
 *   npm run check:fast
 *
 * ── 왜 따로 있나 ──
 *   전체 검사(test/check.cjs)는 9.5MB 짜리 index.html 을 jsdom 으로 **45번** 띄운다.
 *   해상도마다·상황마다 화면을 실제로 그려 봐야 하기 때문인데, 그래서 8분 걸린다.
 *   고치고 8분, 또 고치고 8분이면 하루에 몇 개 못 한다.
 *
 *   그런데 자주 깨지는 것의 대부분은 **화면이 아니라 데이터**다 —
 *   끊긴 링크 · 고립 노드 · 출처 빠짐 · 규칙 3 · 별명 · 중복.
 *   그건 배열만 읽어도 알 수 있다. 그래서 이 파일은 DOM 도 네트워크도 안 쓴다.
 *
 * ── 이 검사가 **못 보는 것** ──
 *   글자 겹침 · 배치 · 거리 · 카드가 실제로 그리는지 · 링크가 열리는지.
 *   그건 화면을 그려 봐야 안다. **push 전에는 반드시 전체 검사를 돌린다.**
 *   빠른 검사가 통과했다고 화면이 맞다는 뜻이 아니다 — 이 저장소가 일곱 번 겪은 일이다.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const t0 = Date.now();
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lines = src.split('\n');

/* 최상위 `var X=[` … `];` 를 그대로 읽는다. 데이터 리터럴이라 실행할 필요가 없다. */
function readArr(name) {
  const a = lines.findIndex(l => l.startsWith(`var ${name}=[`));
  if (a < 0) return null;
  /* 끝줄이 늘 `];` 인 것은 아니다 — AUTO 블록은 `/*AUTO-N-END*\/];` 로 끝난다.
     처음에 `=== '];'` 만 봤더니 여섯 배열을 통째로 못 읽었다. */
  let b = -1;
  for (let i = a; i < lines.length; i++) if (/^(?:\/\*AUTO-[A-Z0-9-]+-END\*\/)?\];\s*$/.test(lines[i])) { b = i; break }
  if (b < 0) return null;
  const body = lines.slice(a, b + 1).join('\n').replace(new RegExp(`^var ${name}=`), '').replace(/;\s*$/, '');
  try { return new Function('return ' + body)() } catch (e) { return { __err: e.message } }
}
function readObj(name) {
  const a = lines.findIndex(l => l.startsWith(`var ${name}={`));
  if (a < 0) return null;
  let b = -1;
  for (let i = a; i < lines.length; i++) if (lines[i] === '};' || /^\};/.test(lines[i])) { b = i; break }
  if (b < 0) return null;
  const body = lines.slice(a, b + 1).join('\n').replace(new RegExp(`^var ${name}=`), '').replace(/;\s*$/, '');
  try { return new Function('return ' + body)() } catch (e) { return null }
}

const fails = [], warns = [];
const F = m => fails.push(m), W = m => warns.push(m);

const parts = ['N', 'AUTO_N', 'KOSIS_N', 'CASE_N'];
const lparts = ['L', 'AUTO_L', 'TERM_L', 'CASE_L'];
let N = [], L = [];
for (const p of parts) {
  const v = readArr(p);
  if (!v) { F(`배열 ${p} 를 못 읽었다`); continue }
  if (v.__err) { F(`배열 ${p} 파싱 실패: ${v.__err}`); continue }
  N = N.concat(v);
}
for (const p of lparts) {
  const v = readArr(p);
  if (!v) { F(`배열 ${p} 를 못 읽었다`); continue }
  if (v.__err) { F(`배열 ${p} 파싱 실패: ${v.__err}`); continue }
  L = L.concat(v);
}
if (fails.length) { fails.forEach(m => console.log('  · ' + m)); console.log('\n결과: FAIL — 데이터를 못 읽었다'); process.exit(1) }

const map = {}; N.forEach(n => { if (n && n.id) map[n.id] = n });
console.log(`노드 ${N.length} · 관계 ${L.length}   (${Date.now() - t0}ms)`);

/* 1. 중복 id */
const seen = {}, dup = [];
N.forEach(n => { if (n && n.id) { if (seen[n.id]) dup.push(n.id); seen[n.id] = 1 } });
if (dup.length) F(`중복 id ${dup.length}개: ${[...new Set(dup)].slice(0, 6).join(', ')}`);
console.log(`1. 중복 id          ${dup.length ? 'FAIL ' + dup.length : 'PASS'}`);

/* 2. 끊긴 링크 — 한쪽 끝이 없는 선. 화면은 조용히 버리므로 여기서 잡는다 */
const brk = L.filter(l => l && (!map[l[0]] || !map[l[1]]));
if (brk.length > 0) W(`끊긴 링크 ${brk.length}개 (화면이 버린다): ${brk.slice(0, 4).map(l => l[0] + '→' + l[1]).join(', ')}`);
console.log(`2. 끊긴 링크        ${brk.length}개 ${brk.length ? '(화면이 버린다)' : ''}`);

/* 3. 고립 노드 — 사건 목록에서 온 것(chain)은 뺀다. 그건 「아무 법도 없다」 는 사실이다 */
const deg = {}; N.forEach(n => n && n.id && (deg[n.id] = 0));
L.forEach(l => { if (l && deg[l[0]] !== undefined) deg[l[0]]++; if (l && deg[l[1]] !== undefined) deg[l[1]]++ });
const iso = N.filter(n => n && n.id && !deg[n.id] && !n.owner && !n.ghost &&
  !(n.chain && n.t === 'event') && !(n.t === 'result' && (!n.keys || !n.keys.length)));
const isoEv = N.filter(n => n && n.id && !deg[n.id] && n.chain && n.t === 'event');
iso.forEach(n => F(`고립 노드: ${n.id} (${n.lab})`));
console.log(`3. 고립 노드        ${iso.length ? 'FAIL ' + iso.length : 'PASS'}   [아무 데도 안 이어진 사건 ${isoEv.length}개는 뺀다 — 그것도 사실이다]`);

/* 4. 출처 (규칙 7) */
const noSrc = N.filter(n => n && n.id && !n.ghost && !n.src && !n.url && !n.noUrl);
if (noSrc.length) F(`출처도 이유도 없는 노드 ${noSrc.length}개: ${noSrc.slice(0, 5).map(n => n.id).join(', ')}`);
console.log(`4. 출처             ${noSrc.length ? 'FAIL ' + noSrc.length : 'PASS'}`);

/* 5. 규칙 3 — 한 사건에 대통령이 둘 붙으면 FAIL */
const prez = {}; N.forEach(n => { if (n && n.prez) prez[n.id] = n.lab });
const byEv = {}, otherPath = [];
L.forEach(l => {
  if (!l) return;
  const a = map[l[0]], b = map[l[1]]; if (!a || !b) return;
  const p = prez[l[0]] ? l[0] : (prez[l[1]] ? l[1] : null); if (!p) return;
  const e = (p === l[0]) ? b : a; if (e.t !== 'event') return;
  if (l[3] === 'term') { (byEv[e.id] = byEv[e.id] || {})[p] = 1 }
  else if (l[7] === 'auto' && !e.owner && !e.ghost) otherPath.push(`${e.id} ↔ ${prez[p]} role=${l[3] || '(빈값)'}`);
});
const two = Object.keys(byEv).filter(k => Object.keys(byEv[k]).length > 1);
two.forEach(k => F(`규칙 3 — 「${map[k].lab}」 에 대통령이 둘 붙었다: ${Object.keys(byEv[k]).map(p => prez[p]).join(', ')}`));
if (otherPath.length) F(`규칙 3 — 사건과 대통령이 term 이 아닌 자동 경로로 이어졌다 ${otherPath.length}개: ${otherPath.slice(0, 3).join(' / ')}`);
console.log(`5. 규칙 3           ${two.length || otherPath.length ? 'FAIL' : 'PASS'}   [그때 정권 ${Object.keys(byEv).length}개 사건]`);

/* 6. 사건에 「이게 뭔지」 한 줄 */
const EVW = readObj('EVW') || {};
/* 전체 검사의 `nodeKind(n)==='event'` 와 **같은 것을 세야 한다** —
   더 넓게 세면 헌재 결정(「대통령 파면」)까지 사건으로 잡아 없는 문제를 만든다.
   실측으로 3개가 그렇게 걸렸다. 검사끼리 다른 것을 세면 어느 쪽이 맞는지 알 수 없다. */
const isEvent = n => n && n.t === 'event' && !n.auto && !n.ghost && !n.owner &&
  n.evk !== 'record' && !/헌법재판소|헌재/.test(String(n.ekind || '')) && !n.off;
const ev = N.filter(isEvent);
const noW = ev.filter(n => !((n.w && String(n.w).trim().length > 4) || (EVW[n.id] && String(EVW[n.id]).trim().length > 4)));
if (noW.length) F(`「이게 뭔지」 한 줄이 없는 사건 ${noW.length}개: ${noW.slice(0, 5).map(n => n.lab || n.id).join(', ')}`);
const dateFirst = ev.filter(n => n.w && /^\s*\d{4}년/.test(String(n.w)));
if (dateFirst.length) F(`「이게 뭔지」 가 날짜로 시작하는 사건 ${dateFirst.length}개`);
console.log(`6. 이게 뭔지        ${noW.length || dateFirst.length ? 'FAIL' : 'PASS'}   [사건 ${ev.length}개]`);

/* 7. 법 쉬운 말이 원문에 없는 숫자를 만들지 않았나 (원칙 0-B) */
const LAWP = readObj('LAWP') || {};
let ezN = 0, badEz = [];
for (const [id, v] of Object.entries(LAWP)) {
  if (!v || !v.e) continue;
  ezN++;
  /* 공백만 남으면 「있다」 로 읽힌다 — 판정 전에 다듬는다 (전체 검사도 같은 실수를 했다) */
  const s2 = (String(v.p || '') + ' ' + String(v.r || '')).trim();
  if (!s2) continue;
  for (const num of String(v.e).match(/[0-9]+/g) || [])
    if (s2.indexOf(num) < 0) { badEz.push(`${(map[id] || {}).title || id} : ${num}`); break }
}
if (badEz.length) F(`쉬운 말에 원문에 없는 숫자 ${badEz.length}개: ${badEz.slice(0, 4).join(' / ')}`);
console.log(`7. 법 쉬운 말       ${badEz.length ? 'FAIL ' + badEz.length : 'PASS'}   [쉬운 말 ${ezN}개]`);

/* 8. 별명이 실제 법에 붙었나 */
const MUST = ['민식이법', '김용균법', '윤창호법', '구하라법', '태완이법', 'n번방 방지법', '김영란법', '세월호 특별법', '중대재해처벌법'];
const aliasAll = new Set();
N.forEach(n => (n && n.alias || []).forEach(a => aliasAll.add(a)));
const ALIAS = readObj('ALIAS') || {};
Object.values(ALIAS).forEach(v => (v && v.a || []).forEach(a => aliasAll.add(a)));
const missAlias = MUST.filter(a => !aliasAll.has(a));
if (missAlias.length) F(`별명이 사라졌다: ${missAlias.join(', ')}`);
console.log(`8. 별명             ${missAlias.length ? 'FAIL' : 'PASS'}   [별명 ${aliasAll.size}개]`);

/* 9. 결과 명부 — 사라진 결과를 잡는다 */
try {
  const roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'result_roster.json'), 'utf8'));
  const have = new Set(N.filter(n => n && n.t === 'result').map(n => n.id));
  const removed = new Set(Object.keys(roster.removed || {}));
  const gone = (roster.ids || []).filter(id => !have.has(id) && !removed.has(id));
  gone.forEach(id => F(`결과 「${id}」 가 사라졌다 (db/result_roster.json 에 있는데 지도에 없다)`));
  console.log(`9. 결과 명부        ${gone.length ? 'FAIL ' + gone.length : 'PASS'}   [명부 ${(roster.ids || []).length}개]`);
} catch (e) { console.log('9. 결과 명부        건너뜀 (db/result_roster.json 없음)') }

/* 10. limit 빈 법안 (규칙 5) — WARN */
const noLimit = N.filter(n => n && n.t === 'bill' && !n.auto && (!n.limit || !n.limit.length));
if (noLimit.length) W(`limit 칸이 빈 법안 ${noLimit.length}개: ${noLimit.slice(0, 6).map(n => n.id).join(', ')}`);
console.log(`10. limit           ${noLimit.length}개 비어 있음 (WARN)`);

console.log('\n' + '─'.repeat(46));
if (warns.length) { console.log('[WARN]'); warns.forEach(m => console.log('  ! ' + m)) }
if (fails.length) { console.log('[FAIL]'); fails.forEach(m => console.log('  · ' + m)) }
console.log(`\nFAIL ${fails.length}건 / WARN ${warns.length}건 · ${Date.now() - t0}ms`);
console.log(fails.length
  ? '결과: FAIL'
  : '결과: PASS — **화면은 안 봤다.** push 전에 `npm test` 로 전체 검사를 돌려라.');
process.exit(fails.length ? 1 : 0);
