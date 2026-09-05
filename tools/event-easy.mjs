/* 사건 설명을 index.html 로 내보낸다.
 *
 *   node tools/event-easy.mjs [--dry]
 *
 * ── 왜 필요한가 ──
 * 「이태원 참사」를 눌렀는데 **무슨 사건이었는지가 없었다.** 사건 노드 25개가
 * 전부 「이 사건의 이름이 법 이름에 그대로 들어 있습니다」 라는 틀 문장만 갖고 있었다.
 * 사건이 뭔지 모르면 그 뒤(처벌·법·보상·수치)를 볼 이유가 없다.
 *
 * ── 어디서 가져오나 ── **법의 제1조(목적)**
 * 국회가 그 법에 날짜·장소·무슨 일을 적어 두었다:
 *   「2014년 4월 16일 … 진도군 조도면 부근 해상에서 여객선 세월호가 침몰함에 따른 참사」
 * 우리는 **쉬운 말로 옮기기만** 한다. 원본은 db/event_easy.json 이고 사람이 쓴다.
 *
 * ── 사람 수는 대부분 못 쓴다 ──
 * 법에도 법제처 제·개정이유에도 사람 수가 없다 (실측: 7개 법 중 0건).
 * **공식 기관 페이지로 확인한 것만** 적고 나머지는 비운다 — 지어내지 않는다.
 * 화면은 비운 것을 「확인 중」 이라고 밝힌다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'db', 'event_easy.json');
const DRY = process.argv.includes('--dry');

const spec = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const html = fs.readFileSync(HTML, 'utf8');

/* 지도에 실제로 있는 사건 노드만 — 없는 것에 설명을 담아도 화면에 못 온다 */
const have = new Set();
for (const m of html.matchAll(/\{id:'(evt_[^']+)',t:'event'/g)) have.add(m[1]);

const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const rows = [], noNode = [];
for (const e of spec.events) {
  if (!have.has(e.id)) { noNode.push(e.id); continue }
  const f = [`e:${q(e.easy)}`, `s:${q(e.src || '')}`];
  if (e.people) f.push(`p:${q(e.people)}`);
  if (e.peopleSrc) f.push(`ps:${q(e.peopleSrc)}`);
  if (e.peopleUrl) f.push(`pu:${q(e.peopleUrl)}`);
  rows.push(`${q(e.id)}:{${f.join(',')}}`);
}
const miss = [...have].filter(id => !spec.events.some(e => e.id === id));
console.log(`사건 노드 ${have.size}개 · 설명을 붙인 것 ${rows.length}개`);
if (miss.length) {
  console.log(`  아직 설명이 없는 사건 ${miss.length}개 — 화면에 「확인 중」 으로 나간다:`);
  miss.forEach(x => console.log(`    · ${x}`));
}
if (noNode.length) console.log(`  붙을 노드가 없는 설명 ${noNode.length}개: ${noNode.join(' ')}`);
const withPeople = spec.events.filter(e => e.people).length;
console.log(`  사람 수까지 확인한 것 ${withPeople}개 (나머지는 법에 안 적혀 있어 비운다)`);
if (DRY) process.exit(0);

/* **쓰기 직전에 다시 읽는다** — 다른 도구·사람의 편집을 덮어쓰지 않는다 */
const fresh = fs.readFileSync(HTML, 'utf8');
const block = `/*AUTO-EVEZ-START*/${rows.join('\n,')}/*AUTO-EVEZ-END*/`;
const out = fresh.replace(/\/\*AUTO-EVEZ-START\*\/[\s\S]*?\/\*AUTO-EVEZ-END\*\//, block);
/* **자리가 있는데 내용이 같을 수 있다.** 그때 out===fresh 라서
   「자리를 못 찾았다」 고 잘못 말했다 — 다시 돌리면 늘 실패했다.
   찾는 것은 **자리**이지 달라졌는지가 아니다. */
if (!/\/\*AUTO-EVEZ-START\*\//.test(fresh)) { console.error('AUTO-EVEZ 자리를 못 찾았다'); process.exit(1) }
fs.writeFileSync(HTML, out, 'utf8');
console.log('index.html 에 썼다');
