/* db/node_url.json 의 근거 링크를 index.html 노드에 넣는다.
 *
 *   node tools/node-url.mjs
 *
 * **노드를 먼저 잘라내고 그 안에서만 고친다.** 파일 전체에서 찾으면
 * 같은 이름의 다른 필드를 고친다 — 분야 'edu' 가 인물의 학력을 고친 적이 있다.
 * 이미 url 이 있으면 건드리지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'node_url.json'), 'utf8'));
const notFound = t.notFound || {}; delete t._; delete t.notFound;
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

let html = fs.readFileSync(HTML, 'utf8');
let put = 0, already = 0, miss = [], noted = 0;
const cut = id => {
  const head = `{id:'${id}',t:'`;
  const i = html.indexOf(head);
  if (i < 0) return null;
  let j = html.indexOf("{id:'", i + head.length);
  if (j < 0) j = html.length;
  /* 필드를 넣을 자리는 `t:'xxx'` 바로 뒤다 */
  const m = /^\{id:'[^']*',t:'[^']*'/.exec(html.slice(i, j));
  return { i, j, at: i + m[0].length, block: html.slice(i, j) };
};
for (const [id, v] of Object.entries(t)) {
  const c = cut(id);
  if (!c) { miss.push(id); continue }
  if (/,url:'/.test(c.block)) { already++; continue }
  html = html.slice(0, c.at) + `,url:${q(v[1])},src2:${q(v[0] + ' · ' + v[2])}` + html.slice(c.at);
  put++;
}
for (const [id, why] of Object.entries(notFound)) {
  const c = cut(id);
  if (!c || /,noUrl:'/.test(c.block)) continue;
  html = html.slice(0, c.at) + `,noUrl:${q(why)}` + html.slice(c.at);
  noted++;
}
fs.writeFileSync(HTML, html, 'utf8');
console.log(`근거 링크 ${put}개 넣음 · 이미 있던 것 ${already}개 · 못 찾은 이유 ${noted}개`);
if (miss.length) console.log(`  ! 노드를 못 찾은 id ${miss.length}개: ${miss.join(', ')}`);
