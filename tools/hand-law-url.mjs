/* 손으로 넣은 법 노드에 법제처 링크를 단다.
 *
 *   node tools/hand-law-url.mjs
 *
 * 별칭(「임대차 3법」)으로는 법제처에서 안 열린다. db/hand_law_url.json 의 대응표를 쓴다.
 * **이미 url 이 있는 노드는 건드리지 않는다.** 자동 법은 link.mjs 가 이미 달아 준다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'hand_law_url.json'), 'utf8'));
const notFound = t.notFound || {}; delete t._; delete t.notFound;

let html = fs.readFileSync(HTML, 'utf8');
let put = 0, already = 0, miss = [];
for (const [id, v] of Object.entries(t)) {
  /* **노드를 먼저 잘라내고 그 안에서만 본다.** 파일 전체에서 찾으면 같은 이름의
     다른 필드를 고친다 — 분야 'edu' 가 인물의 학력을 고친 적이 있다.
     노드 경계는 다음 `{id:'` 까지다. */
  const head = `{id:'${id}',t:'bill'`;
  const i = html.indexOf(head);
  if (i < 0) { miss.push(id); continue }
  let j = html.indexOf("{id:'", i + head.length);
  if (j < 0) j = html.length;
  const block = html.slice(i, j);
  if (/,url:'/.test(block)) { already++; continue }
  const url = 'https://www.law.go.kr/%EB%B2%95%EB%A0%B9/' + encodeURIComponent(v.law);
  html = html.slice(0, i + head.length) + `,url:'${url}'` + html.slice(i + head.length);
  put++;
}
/* **못 찾은 것도 그 이유를 노드에 적는다.** 화면이 "확인 중" 이라고만 하면
   '아직 안 찾았다' 와 '찾아봤지만 없다' 가 구별되지 않는다.
   국군방첩사령부령은 법제처 검색 API 로도 0건이다 — 실측이다. */
let noted = 0;
for (const [id, why] of Object.entries(notFound)) {
  const head = `{id:'${id}',t:'bill'`;
  const i = html.indexOf(head);
  if (i < 0) continue;
  let j = html.indexOf("{id:'", i + head.length);
  if (j < 0) j = html.length;
  if (/,noUrl:'/.test(html.slice(i, j))) continue;
  const q2 = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  html = html.slice(0, i + head.length) + `,noUrl:${q2(why)}` + html.slice(i + head.length);
  noted++;
}
fs.writeFileSync(HTML, html, 'utf8');
console.log(`  못 찾은 이유를 적은 노드 ${noted}개`);
console.log(`손으로 넣은 법에 링크 ${put}개 · 이미 있던 것 ${already}개`);
if (miss.length) console.log(`  ! 노드를 못 찾은 id ${miss.length}개: ${miss.join(', ')}`);
console.log(`  비운 것 ${Object.keys(notFound).length}개:`);
for (const [id, why] of Object.entries(notFound)) console.log(`     · ${id} — ${why}`);
