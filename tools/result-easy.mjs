/* 결과 카드의 '이게 무슨 숫자인가' 를 index.html 에 내보낸다.
 *
 *   node tools/result-easy.mjs
 *
 * db/result_easy.json (사람이 쓴 말) → index.html 의 AUTO-REZ 블록.
 *
 * **숫자는 안 담는다.** 값은 노드(big·series)에 있고 여기는 말만 있다.
 * 두 곳에 숫자가 있으면 언젠가 갈라지고, 갈라지면 어느 쪽이 맞는지 알 수 없다.
 *
 * 결과 노드 목록은 **index.html 에서 직접 읽는다.** 여기서 베껴 쓰면 화면과 갈라진다.
 * 빠진 것과 남는 것을 둘 다 출력한다 — 말없이 넘어가면 "다 넣었다" 는 거짓말이 된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const easy = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'result_easy.json'), 'utf8'));
delete easy._;

let html = fs.readFileSync(HTML, 'utf8');
const ids = [...html.matchAll(/\{id:'([^']+)',t:'result'/g)].map(m => m[1]);
const uniq = [...new Set(ids)];

const missing = uniq.filter(id => !easy[id] || !easy[id].what);
const extra = Object.keys(easy).filter(id => !uniq.includes(id));

const q = s => "'" + String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, ' ') + "'";
const js = uniq.filter(id => easy[id]).map(id => {
  const e = easy[id];
  /* s·u 는 **근거 자료**다. 규칙 7이 요구하는 것은 글자로 적은 출처가 아니라
     눌러서 확인할 수 있는 링크다. 못 찾은 것은 비운다 — 가짜 링크는 없는 것보다 나쁘다. */
  return `${/^[a-z_][\w]*$/i.test(id) ? id : q(id)}:{w:${q(e.what)}` +
    (e.mean ? `,m:${q(e.mean)}` : '') + (e.chg ? `,c:${q(e.chg)}` : '') +
    (e.url ? `,s:${q(e.src || '원자료')},u:${q(e.url)}` : '') +
    /* **비운 이유도 함께 내보낸다.** 빈 것 자체는 잘못이 아니다 — 말없이 비우는 것이 잘못이다.
       화면이 "왜 없는지" 를 그대로 보여준다. 검사 60 이 이 기록을 요구한다. */
    (!e.url && e.noUrl ? `,n:${q(e.noUrl)}` : '') + '}';
}).join(',\n ');

const A = '/*AUTO-REZ-START*/', B = '/*AUTO-REZ-END*/';
const i = html.indexOf(A), j = html.indexOf(B);
if (i < 0 || j < 0) { console.error('index.html 에 AUTO-REZ 자리가 없다'); process.exit(1) }
fs.writeFileSync(HTML, html.slice(0, i + A.length) + '\n ' + js + '\n' + html.slice(j), 'utf8');

console.log(`결과 노드 ${uniq.length}개 · 쉬운 설명 ${uniq.filter(id => easy[id]).length}개 내보냄`);
if (missing.length) console.log(`  ! 설명이 없는 결과 ${missing.length}개: ${missing.join(', ')}`);
if (extra.length) console.log(`  ! 지도에 없는 id ${extra.length}개: ${extra.join(', ')} — 노드가 사라졌거나 id 가 바뀌었다`);
const noU = uniq.filter(id => easy[id] && !easy[id].url);
console.log(`  근거 링크 ${uniq.filter(id => easy[id] && easy[id].url).length}/${uniq.length}개` +
  (noU.length ? ` · 비운 것 ${noU.length}개: ${noU.join(', ')}` : ''));
for (const id of noU) if (easy[id].noUrl) console.log(`     · ${id} — ${easy[id].noUrl}`);
if (!missing.length && !extra.length) console.log('  빠진 것도 남는 것도 없다');
