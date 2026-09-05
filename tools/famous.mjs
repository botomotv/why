/* 사람들이 아는 이름의 사건을 지도에 올린다.
 *
 *   node tools/famous.mjs --dry     받아만 보고 안 쓴다
 *   node tools/famous.mjs           index.html 의 AUTO-FAME 블록에 쓴다
 *
 * ── 무엇을 사람이 하고 무엇을 기계가 하나 ──
 *   사람이 하는 것 : 사건의 **이름·시기·한 줄 설명**, 그리고 **대법원 사건번호**
 *   기계가 하는 것 : 그 사건번호로 법제처 판례를 받아 **주문을 읽고** 확정 여부를 가린다
 *
 *   웹 검색은 **사건번호를 얻는 데만** 쓴다. 형량·확정 여부는 기사에서 옮기지 않는다 —
 *   옮기는 순간 그건 우리가 만든 값이다. 「기사 본문을 싣지 마라」 가 그 뜻이다.
 *
 * ── 확정은 **주문으로만** 가린다 ──
 *   「대법원 판결이 있으니 확정」 은 틀렸다. 주문이 「상고를 기각한다」 여야 확정이고,
 *   「파기환송」 이면 확정 전이다. 실측으로 넷 중 둘이 파기환송이었다.
 *   판정은 tools/lib/verdict.mjs 하나가 한다 — 두 벌이 되면 갈라진다.
 *
 * ── 형량을 못 쓰는 경우가 있다 ──
 *   형량은 **원심(하급심) 주문**에 있는데, 법제처 공개 판례는 대법원 위주다.
 *   삼풍(96노118)·성수대교(95노2918) 둘 다 검색 결과 0건이었다.
 *   그때는 「확정됐다」 까지만 쓰고 형량은 비운다. 뉴스에서 옮기면 지어낸 값이 된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFinalDismissal, lowerCourt, pickVerdict, penShort, junLines } from './lib/verdict.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'db', 'famous_events.json');
const OC = process.env.LAW_OC || 'botomotv';
const DRY = process.argv.includes('--dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const conf = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const q = s => "'" + String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '').replace(/\n/g, '\\n') + "'";

async function prec(sn) {
  const u = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&type=JSON&ID=${sn}`;
  try {
    const r = await fetch(u, { headers: { 'User-Agent': 'why-map/famous' } });
    const j = JSON.parse(await r.text());
    return j.PrecService || null;
  } catch { return null }
}

const nodes = [], links = [], pens = {}, notes = [];
/* ── 「이미 있나」 를 볼 때 **자기가 쓴 블록은 빼고 본다** ──
   그냥 index.html 전체를 보면, 두 번째 실행에서 **첫 실행이 쓴 자기 노드**를 보고
   「이미 있다」 며 안 쓴다. 블록은 통째로 다시 쓰이므로 그 노드는 사라지고,
   그것을 가리키던 선도 한쪽 끝이 없어 버려진다 — 사건이 **고립 노드**가 됐다.
   문법 오류가 안 나고 검사가 잡기 전까지 조용하다. */
const already = (() => {
  const raw = fs.readFileSync(HTML, 'utf8');
  const a = raw.indexOf('/*AUTO-FAME-N-START*/'), b = raw.indexOf('/*AUTO-FAME-N-END*/');
  return (a >= 0 && b > a) ? raw.slice(0, a) + raw.slice(b) : raw;
})();
for (const e of conf.events) {
  let fix = '확정 여부를 아직 확인하지 못했습니다', pen = '', url = '', no = e.prec, court = '';
  if (e.precSn) {
    const p = await prec(e.precSn);
    await sleep(300);
    if (!p) { notes.push(`${e.lab}: 법제처에서 판례를 못 받았다 (ID ${e.precSn})`) }
    else {
      const body = String(p.판례내용 || '');
      const lines = body.replace(/<[^>]+>/g, '\n').split('\n').map(s => s.trim()).filter(Boolean);
      court = String(p.법원명 || '');
      no = String(p.사건번호 || e.prec);
      url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${e.precSn}&type=HTML`;
      /* ── 확정은 **주문 구간으로만** 가린다 ──
         처음엔 판결문 전체 줄을 넘겼다. 그랬더니 삼풍(96도1231)이 「확정 전 · 파기」로 나왔다 —
         주문은 「상고를 모두 기각한다」인데 **이유 본문에 「파기」라는 낱말이 있었기 때문**이다.
         이 파일이 이미 적어 둔 것과 같다: 표시가 아니라 주문을 본다. 그 주문만 본다. */
      if (isFinalDismissal(junLines(body))) {
        const lc = lowerCourt(body);
        /* ── 값은 **다른 곳과 같은 말**을 써야 묶인다 ──
           문장을 통째로 넣었더니 검사 70 이 「확정 362」 옆에 이 한 건씩을 **따로** 세었다.
           같은 뜻인데 글자가 달라 다른 갈래가 된 것이다. 자세한 것은 사건번호 칸이 말한다. */
        fix = '확정';
        /* 형량은 **원심 주문**에 있다. 그 판결이 공개돼 있지 않으면 비운다. */
        /* `pickVerdict` 는 **판례내용 원문**을 받고 {ok,verdict} 를 돌려준다.
           줄 배열을 넘기면 조용히 안 맞는다 — 두 함수의 입출력을 맞춰 쓴다. */
        const v = pickVerdict(body);
        pen = (v && v.ok) ? penShort(v.verdict) : '';
        if (!pen) notes.push(`${e.lab}: 형량은 원심(${lc ? lc.no : '?'}) 주문에 있는데 그 판결이 법제처 공개 판례에 없다 — 비웠다`);
      } else {
        fix = '확정 전 · 대법원이 원심을 파기했습니다';
        notes.push(`${e.lab}: 파기환송이라 형량을 안 쓴다`);
      }
    }
  }
  /* ── 사건을 **그 판결에** 잇는다 ──
     안 이으면 고립 노드가 된다 — 눌러도 갈 곳이 없고 지도에서 점 하나로 뜬다.
     억지로 잇지 않는다: **판결문이 스스로 이 사건을 적었다.**
       96도1231 「…서울 서초구 서초동 1685의 3 소재 … 삼풍백화점 A동 건물」
       97도1740 「이 사건 교량(성수대교)의 붕괴원인…」
     웹 검색은 사건번호를 얻는 데만 썼고, 그 번호가 이 사건이 맞는지는 **판결문 본문으로** 확인했다. */
  if (e.precSn && e.mark) {
    const pid = 'case_prec_' + e.precSn;
    if (!already.includes(`id:'${pid}'`))
      nodes.push('{' + [['id', pid], ['t', 'event'], ['auto', 1], ['side', 'gov'],
        ['lab', (e.precNm || e.lab + ' 형사판결')], ['title', (e.precNm || e.lab + ' 형사판결')],
        ['yr', String(e.precYr || '')], ['ekind', (e.precYr || '') + '년 · 법원 판례'],
        ['tip', '이 사건의 형사재판입니다. 사건번호는 ' + e.prec + '입니다.'],
        ['body', '무슨 판단을 했는지는 아래 원문 링크에서 볼 수 있습니다.'],
        ['url', `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=prec&ID=${e.precSn}&type=HTML`],
        ['src', '출처 · 법제처 국가법령정보 공동활용 (법원 판례)']]
        .filter(([, v]) => v !== '' && v !== undefined)
        .map(([k, v]) => k + ':' + (k === 'auto' ? 1 : q(v))).join(',') + '}');
    links.push([e.id, pid, '이 사건의 재판', 'topic',
      `판결문이 이 사건을 「${e.mark}」 라고 적었습니다`, `대법원 ${e.prec} 판례내용`, '', 'auto']);
  }
  nodes.push('{' + [
    ['id', e.id], ['t', 'event'], ['side', 'gov'], ['lab', e.lab], ['title', e.lab],
    ['dt', e.dt], ['yr', e.yr], ['ekind', e.yr + '년 · 사건'],
    ['tip', e.what.split('.')[0] + '.'], ['body', e.what],
    ['url', url || ''], ['src', '출처 · ' + (e.peopleSrc || '법제처 국가법령정보')],
    ['cat', e.cat || ''], ['fame', 1]
  ].filter(([, v]) => v !== '' && v !== undefined)
    .map(([k, v]) => k + ':' + (k === 'fame' ? 1 : q(v))).join(',') + '}');
  pens[e.id] = { n: no, c: court, u: url, x: fix, p: pen };
}

console.log(`사람들이 아는 사건 ${nodes.length}개`);
Object.entries(pens).forEach(([k, v]) => console.log(`  ${k} · ${v.x}${v.p ? ' · ' + v.p : ' · 형량 비움'}`));
console.log(`못 넣은 것 ${conf['못 넣은 것'].length}개 (db/famous_events.json 에 이유를 적어 두었다)`);
notes.forEach(n => console.log('  ! ' + n));
if (DRY) process.exit(0);

const penJs = Object.entries(pens).map(([k, v]) =>
  `'${k}':{` + Object.entries(v).filter(([, x]) => x).map(([kk, x]) => kk + ':' + q(x)).join(',') + '}'
).join('\n,');

/* ── 블록마다 **그때그때 다시 찾는다** ──
   한 번 읽은 html 의 인덱스로 두 군데를 고치면, 첫 번째를 바꾼 순간 두 번째 인덱스가 어긋난다.
   길이가 달라지기 때문이다. 문법 오류가 안 나고 **엉뚱한 자리를 덮어쓴다.** */
let out = fs.readFileSync(HTML, 'utf8');
/* ── 쉼표는 **앞이 아니라 뒤에** 붙인다 ──
   앞 블록(AUTO-AFTER-N)이 이미 쉼표로 끝난다. 앞에 또 붙이면 `, ,` 가 되어
   **배열에 구멍(hole)이 생긴다** — 문법 오류가 안 나고 N.length 만 늘어난다.
   뒤에 붙이면 다음 블록(AUTO-CASE-N)의 첫 원소와 이어진다.
   실제로 뒤 쉼표를 빠뜨려 `}{` 가 되면서 스크립트가 통째로 죽었다. */
const linkJs = links.map(l => '[' + l.map(q).join(',') + ']').join('\n,');
for (const [tag, text] of [['FAME-N', nodes.length ? nodes.map(x => x + ',').join('\n') : ''],
                           ['FAME-L', links.length ? linkJs + ',' : ''],
                           /* PEN 객체 **안**에 들어가므로 앞에 쉼표가 필요하다 */
                           ['FAME-PEN', penJs ? ',' + penJs : '']]) {
  const A = `/*AUTO-${tag}-START*/`, B = `/*AUTO-${tag}-END*/`;
  const i = out.indexOf(A), j = out.indexOf(B);
  if (i < 0 || j < 0) { console.error(`index.html 에 AUTO-${tag} 자리가 없다`); process.exit(1) }
  out = out.slice(0, i + A.length) + '\n' + text + '\n' + out.slice(j);
}
fs.writeFileSync(HTML, out, 'utf8');
console.log(`\nindex.html 에 노드 ${nodes.length}개 · 선 ${links.length}개 · 형량 ${Object.keys(pens).length}개 내보냄`);
