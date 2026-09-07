/* 사건 목록이 가리키는데 **지도에 없는 법**을 법제처에서 받아 노드로 올린다.
 *
 *   node tools/law-add.mjs --dry
 *   node tools/law-add.mjs
 *
 * ── 왜 필요한가 ──
 *   사건 290개에 사람이 적어 둔 관련 법이 279번 나오는데, 그중 146번이
 *   **그 법이 지도에 없어서** 이어지지 않았다. 사건 카드가 「이어진 법이 없습니다」 라고
 *   말하는 이유가 「그런 법이 없다」 가 아니라 **「우리가 안 올렸다」** 였던 것이다.
 *
 * ── 지어내지 않는다 ──
 *   법제처 국가법령정보에서 **이름으로 찾아 실제로 있는 것만** 올린다.
 *   못 찾으면 안 올리고 몇 개인지 밝힌다. URL 은 법제처가 준 MST 로 만든다 —
 *   이름으로 주소를 만들면 폐지·개명된 법에서 조용히 죽는다(이 파일이 겪은 일이다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'db', 'event_candidates.json');
const CACHE = path.join(ROOT, 'db', 'law_add.json');
const OC = process.env.LAW_OC || 'botomotv';
const DRY = process.argv.includes('--dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";
const norm = s => String(s || '').replace(/[·・‧∙ㆍ]/g, '').replace(/\s+/g, '').trim();
const slug = s => norm(s).slice(0, 28);

const raw0 = fs.readFileSync(HTML, 'utf8');
const a0 = raw0.indexOf('/*AUTO-LAWADD-N-START*/'), b0 = raw0.indexOf('/*AUTO-LAWADD-N-END*/');
const scan = (a0 >= 0 && b0 > a0) ? raw0.slice(0, a0) + raw0.slice(b0) : raw0;
const onMap = new Set();
for (const m of scan.matchAll(/t:'bill'[^\n]*?title:'([^']*)'/g)) onMap.add(norm(m[1]));
for (const m of scan.matchAll(/title:'([^']*)'[^\n]*?t:'bill'/g)) onMap.add(norm(m[1]));

const E = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const want = new Map();
for (const e of E)
  for (const l of String(e.관련법 || '').split(/\s+·\s+/).map(x => x.trim()).filter(x => x.length > 2))
    if (!onMap.has(norm(l))) want.set(l, (want.get(l) || 0) + 1);

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
let got = 0, miss = [];
for (const name of want.keys()) {
  if (cache[name] !== undefined) { if (cache[name]) got++; else miss.push(name); continue }
  const u = `https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=law&type=JSON&query=${encodeURIComponent(name)}&display=5`;
  let hit = null;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'why-map/law-add' } });
    const j = JSON.parse(await r.text());
    let list = j?.LawSearch?.law || [];
    if (!Array.isArray(list)) list = [list];
    /* **이름이 정확히 같은 것만** 쓴다. 비슷한 것을 고르면 다른 법을 올린다 */
    hit = list.find(x => norm(x.법령명한글) === norm(name)) || null;
  } catch { }
  await sleep(260);
  cache[name] = hit ? { nm: hit.법령명한글, mst: hit.법령일련번호 || hit.법령ID, dt: String(hit.공포일자 || ''), kind: hit.법령구분명 || '법률' } : null;
  if (hit) got++; else miss.push(name);
}
fs.writeFileSync(CACHE, JSON.stringify(cache, null, 1), 'utf8');

console.log(`지도에 없던 관련 법 ${want.size}종`);
console.log(`  법제처에서 찾음 ${got} · 못 찾음 ${miss.length}`);
if (miss.length) console.log(`  못 찾은 것: ${miss.slice(0, 12).join(' · ')}${miss.length > 12 ? ' 외' : ''}`);
if (DRY) process.exit(0);

const nodes = [];
for (const [name, v] of Object.entries(cache)) {
  if (!v || !want.has(name)) continue;
  const yr = (v.dt || '').slice(0, 4);
  nodes.push('{' + [
    ['id', 'law2_' + slug(name)], ['t', 'bill'], ['auto', 1], ['side', 'gov'],
    ['kind', v.kind || '법률'], ['st', '공포'],
    ['lab', name.length > 22 ? name.slice(0, 21) + '…' : name], ['title', name],
    ['yr', yr],
    ['tip', '「' + name + '」 입니다.'],
    ['body', '무슨 법인지는 아래 원문 링크에서 볼 수 있습니다.'],
    ['url', `https://www.law.go.kr/법령/${encodeURIComponent(name)}`],
    ['src', '출처 · 법제처 국가법령정보']
  ].filter(([, x]) => x !== '' && x !== undefined)
    .map(([k, x]) => k + ':' + (k === 'auto' ? 1 : q(x))).join(',') + '}');
}
let out = fs.readFileSync(HTML, 'utf8');
const A = '/*AUTO-LAWADD-N-START*/', B = '/*AUTO-LAWADD-N-END*/';
const i = out.indexOf(A), j = out.indexOf(B);
if (i < 0 || j < 0) { console.error('index.html 에 AUTO-LAWADD-N 자리가 없다'); process.exit(1) }
fs.writeFileSync(HTML, out.slice(0, i + A.length) + '\n' + nodes.map(x => x + ',').join('\n') + '\n' + out.slice(j), 'utf8');
console.log(`\nindex.html 에 법 ${nodes.length}개 내보냄`);
