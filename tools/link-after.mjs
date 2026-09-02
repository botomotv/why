/* 「그 뒤에」 — 사건 → 법 → 결과.
 *
 *   node tools/link-after.mjs --dry     세기만 한다
 *   node tools/link-after.mjs           index.html 에 내보낸다
 *
 * ── 왜 이걸 따로 만드나 ──
 * 지금 관계는 대부분 `topic`(같은 주제)이다. 그건 **옆에 나란히 있다**는 뜻이지
 * 이어졌다는 뜻이 아니다. 이 사이트가 답하려는 것은 「그래서 어떻게 됐나」다.
 *
 * ── 근거는 우리가 만들지 않는다 ──
 *   A. **법 이름에 그 사건이 적혀 있다** — 「4·16세월호참사 피해구제 및 지원 등을 위한 특별법」
 *      국회가 그렇게 이름 붙였다. 우리가 고른 것이 아니다.
 *   B. **법제처 제·개정이유에 그 사건이 적혀 있다** — 「중대재해 처벌 등에 관한 법률」 제정이유에
 *      「태안화력발전소 압사사고」가 그대로 있다. 정부가 스스로 적은 것이라 근거가 가장 세다.
 *   C. **법이 공포된 뒤 그 결과 숫자가 어떻게 됐나** — 값은 창고에서 그대로 옮긴다.
 *
 * ── 인과를 단정하지 않는다 (규칙 4) ──
 * 「그 사건 때문에 이 법이 생겼다」가 아니라 「그 뒤에 이 법이 생겼습니다」다.
 * 결과도 마찬가지다 — 「이 법 때문에 줄었다」가 아니라 「그 뒤에 이렇게 바뀌었습니다」.
 * 카드에 그 문장을 그대로 쓴다.
 *
 * ── 규칙 8 · 규칙 1 로 빼는 것 ──
 *   · 「특별검사의 임명」 법 — 수사를 시작하는 법이지 사건의 결과가 아니다.
 *     그리고 이름에 개인 실명이 들어간다 (「최도술·이광재·양길승」).
 *   · 이름에 「의혹」이 있는 것 — 수사 중인 의혹은 안 올린다 (규칙 1)
 *   · db/name_pattern.json 그물에 걸리는 것
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const NOW = new Date().toISOString().slice(0, 10);
const RULE_A = 'law_named_after_event';
const RULE_B = 'law_reason_names_event';
const RULE_C = 'result_after_law';
const nl = n => Number(n).toLocaleString('ko-KR');

const db = new DatabaseSync(DB, DRY ? { readOnly: true } : {});
if (!DRY) db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

/* 사람 이름 그물 — 검사 47 · link-case 와 **같은 것**을 쓴다 */
const NP = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'name_pattern.json'), 'utf8'));
const NAME_HARD = [
  new RegExp(`(?:${NP.role})\\s+(?:${NP.sur})[가-힣]{0,2}(?![가-힣])(?<!${NP.josa})`),
  new RegExp(`(?:^|[\\s"'(\\[·,])(?:${NP.sur})[가-힣]{1,2}(?<!${NP.josa})\\s+(?:변호사|판사|재판장)(?![가-힣])`),
];
/* 개인 실명이 늘어선 특검법 이름 — 「최도술·이광재·양길승」 꼴. 가운뎃점으로 이어진 2~3자 이름 셋 이상 */
const NAME_LIST = new RegExp(`(?:${NP.sur})[가-힣]{1,2}[·ㆍ](?:${NP.sur})[가-힣]{1,2}`);
const DROP = /특별검사|의혹|국정농단|내란|외환|뒷거래|댓글 ?조작/;

/* ── 공포된 법안 ── */
const bills = db.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm, json_extract(row_json,'$.ANNOUNCE_DT') dt,
          json_extract(row_json,'$.COMMITTEE_NM') cm
     FROM raw_row WHERE service='nwbpacrgavhjryiph'
      AND json_extract(row_json,'$.ANNOUNCE_DT') IS NOT NULL
      AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`).all()
  .map(r => ({ nm: String(r.nm || '').replace(/\([^)]*\)/g, '').trim(),
               y: +String(r.dt).slice(0, 4), dt: String(r.dt), cm: r.cm || '' }));

/* 법 이름을 현행법 이름으로 다듬는다 (link.mjs 의 lawOf 와 같은 잣대) */
const lawOf = nm => String(nm || '')
  .replace(/[ㆍ・]/g, '·')
  .replace(/\s*(일부|전부|중)?개정법률안$/, '')
  .replace(/\s*폐지법률안$/, '')
  .replace(/\s*법률안$/, ' 법률')
  .replace(/법안$/, '법')
  .replace(/\s+/g, ' ').trim();
const lawKey = nm => String(nm || '').replace(/\s+/g, '');

/* ── A. 법 이름에 사건이 적혀 있다 ── */
const EVT_RE = /^(.{2,30}?)\s*(?:의)?\s*(진상규명|진상조사|피해구제|희생자|피해자\s?지원|피해자생활지원|참사)/;
const events = new Map();      /* 사건이름 → {yr, laws:Set} */
let dropped = { 특검: 0, 이름: 0 };
for (const b of bills) {
  const g = EVT_RE.exec(b.nm); if (!g) continue;
  let e = g[1].replace(/\s+/g, ' ').trim();
  /* 사건처럼 보이는 것만 — 날짜·지명·「사건/참사/지진」 이 들어 있어야 한다.
     「불공정무역행위 조사 및 산업피해구제…」 같은 것은 사건이 아니다. */
  if (!/[0-9·]|사건|참사|지진|살균제|세월호|원자폭탄|강제동원|한센|지뢰|의문사|산불|납북/.test(e)) continue;
  if (DROP.test(b.nm)) { dropped.특검++; continue }
  if (NAME_LIST.test(e) || NAME_HARD.some(re => re.test(b.nm))) { dropped.이름++; continue }
  /* 「4·16세월호」 처럼 잘린 것은 「참사」 를 붙여 온전한 이름으로 되돌린다 */
  if (g[2] === '참사' && !/참사$/.test(e)) e += '참사';
  const cur = events.get(e) || { yr: b.y, laws: new Map() };
  if (b.y < cur.yr) cur.yr = b.y;
  const L = lawOf(b.nm);
  const rec = cur.laws.get(lawKey(L)) || { lab: L, first: b.y, last: b.y, n: 0 };
  rec.n++; if (b.y < rec.first) rec.first = b.y; if (b.y > rec.last) rec.last = b.y;
  if (L.length > rec.lab.length) rec.lab = L;
  cur.laws.set(lawKey(L), rec);
  events.set(e, cur);
}

/* ── B. 제·개정이유에 사건이 적혀 있다 ──
   법제처가 스스로 적은 것이라 근거가 가장 세다. 사건 이름은 **A 에서 나온 것만** 찾는다 —
   여기서 새 이름을 지어내면 그건 우리가 만든 사건이 된다. */
const reasons = db.prepare('SELECT law_nm, reason, promul_dt FROM law_reason').all();
/* A 의 사건 이름 + 이유 본문에 자주 나오는 사고 이름을 사람이 확인해 넣은 것 */
const HAND = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'event_seed.json'), 'utf8'));
delete HAND._;
for (const [e, v] of Object.entries(HAND)) {
  const cur = events.get(e) || { yr: v.yr, laws: new Map(), hand: 1, src: v.src, tip: v.tip };
  cur.hand = 1; cur.src = v.src; cur.tip = v.tip; if (v.yr < cur.yr) cur.yr = v.yr;
  events.set(e, cur);
}
let reasonHit = 0;
for (const r of reasons) {
  const txt = String(r.reason || '');
  for (const [e, v] of events) {
    /* 사건 이름을 공백 없이 견준다 — 이유 본문은 띄어쓰기가 제각각이다 */
    const bare = e.replace(/\s+/g, '');
    if (!txt.replace(/\s+/g, '').includes(bare)) continue;
    const L = lawOf(String(r.law_nm));
    const y = +String(r.promul_dt || '').slice(0, 4) || 0;
    const rec = v.laws.get(lawKey(L)) || { lab: L, first: y, last: y, n: 0, byReason: 1 };
    rec.byReason = 1; if (y && y < rec.first) rec.first = y; if (y > rec.last) rec.last = y;
    v.laws.set(lawKey(L), rec); reasonHit++;
  }
}

/* 법이 하나도 안 붙은 사건은 안 올린다 — 이을 것이 없으면 사건만 떠 있게 된다 */
for (const [e, v] of [...events]) if (!v.laws.size) events.delete(e);

/* ── 지도에 이미 있는 결과·법 노드 ── */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const mapLaws = new Map();   /* lawKey → id */
for (const m of html.matchAll(/\{id:'(auto_[^']*)',t:'bill',auto:1[^}]*?lab:'([^']*)'/g))
  mapLaws.set(lawKey(m[2]), m[1]);
/* **중첩 대괄호를 정규식으로 자르지 않는다.** `series:[['2016','0.96'],…]` 를
   `[^\]]*` 로 잡으면 첫 닫는 괄호에서 끊긴다 — 실제로 0개가 파싱됐다.
   노드 머리를 찾고 **그 뒤 일정 구간**에서 연도·값 쌍을 그대로 긁는다. */
const results = [];
for (const m of html.matchAll(/\{id:'([^']+)',t:'result'/g)) {
  /* ── **다음 노드까지 넘어가면 남의 값을 읽는다** ──
     4000자 창으로 잘랐더니 「산재 사망률」(0.96~0.99)에 다른 표의 값 57.7 → 63.0 이 붙었다.
     노드가 4000자보다 짧으면 창이 다음 노드를 삼킨다.
     **값을 지어내면 안 된다** — 다음 노드가 시작하는 자리에서 자른다. */
  let end = html.indexOf("\n,{id:'", m.index + 1);
  if (end < 0 || end > m.index + 6000) end = m.index + 6000;
  const seg = html.slice(m.index, end);
  const si = seg.indexOf('series:[');
  const lab = (/lab:'([^']*)'/.exec(seg) || [])[1] || '';
  if (si < 0) { results.push({ id: m[1], lab, series: [] }); continue }
  const tail = seg.slice(si);
  results.push({ id: m[1], lab,
    series: [...tail.matchAll(/\['(\d{4})','([^']*)'\]/g)].map(x => ({ y: +x[1], v: x[2] })) });
}
/* 이미 있는 topic 선 (법 ↔ 결과) — 여기에 「그 뒤에」를 얹는다 */
const topicPairs = new Map();
for (const m of html.matchAll(/\['(auto_[^']*)','([^']*)','같은 주제','topic'/g)) {
  (topicPairs.get(m[1]) || topicPairs.set(m[1], []).get(m[1])).push(m[2]);
}

const nodes = new Map(), links = [];
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  .replace(/\r/g, '').replace(/\n/g, '\\n').replace(/[\u2028\u2029]/g, ' ') + "'";
const slug = s => s.replace(/[^가-힣A-Za-z0-9]/g, '').slice(0, 22);

let lawMade = 0, afterRes = 0;
const byShort = new Map();   /* 짧은 이름 → 노드 id. 이름이 바뀐 같은 법을 하나로 묶는다 */
for (const [e, v] of [...events].sort((a, b) => a[1].yr - b[1].yr)) {
  const eid = 'evt_' + slug(e);
  nodes.set(eid, {
    id: eid, lab: e.length > 26 ? e.slice(0, 25) + '…' : e, title: e, yr: String(v.yr),
    ekind: `${v.yr}년 · 사건`,
    tip: v.tip || `${v.yr}년에 있었던 일입니다.`,
    /* 카드는 마크다운을 렌더하지 않는다 — `**` 를 쓰면 별표가 그대로 보인다.
       그리고 tip 을 body 앞에 또 붙이면 같은 말이 두 번 나온다 (dropLead 가 앞부분만 뗀다). */
    body: v.hand
      ? '이 사건이 법제처 제·개정이유에 적혀 있습니다. 정부가 이 사건을 들어 그 법을 만들거나 고쳤다고 스스로 적은 것입니다. 그 법을 아래에 이어 두었습니다.'
      : '이 사건의 이름이 법 이름에 그대로 들어 있습니다 — 국회가 그렇게 이름 붙였습니다. 그 법을 아래에 이어 두었습니다.',
    src: v.src || '출처 · 국회 의안정보시스템 (공포된 법률의 이름)',
    url: v.srcUrl || 'https://likms.assembly.go.kr/bill/main.do',
  });
  for (const [lk, rec] of v.laws) {
    let lid = mapLaws.get(lk);
    if (!lid) {
      lid = 'aft_' + slug(rec.lab) + '_' + (++lawMade);
      mapLaws.set(lk, lid);
      /* ── 이름표는 **짧아야 읽힌다** ──
         「10·29이태원참사 피해자 권리보장과 진상규명 및 재발방지를 위한 특별법」은
         화면에서 380px 이다. 첫 화면에서 서로 겹쳐 둘 다 안 읽혔다.
         **앞부분(사건 이름 + 법 갈래)만 남긴다** — 「10·29이태원참사 특별법」.
         전체 이름은 카드의 title 에 그대로 있다. 줄인 것이 아니라 옮긴 것이다. */
      const short = (() => {
        /* **갈래를 붙여야 구별된다.** 사건 이름만 남기면 「노근리사건 특별법」이 둘이 된다 —
           하나는 진상규명, 하나는 희생자 명예회복이다. 같은 이름 둘은 검사 51 이 잡는다. */
        const m = /^(.{2,16}?)\s*(?:의)?\s*(진상규명|진상조사|피해구제|피해자|희생자|납북피해)/.exec(rec.lab);
        const KIND = { 진상규명: '진상규명법', 진상조사: '진상조사법', 피해구제: '피해구제법',
                       피해자: '피해자지원법', 희생자: '명예회복법', 납북피해: '납북피해법' };
        if (m && m[1].length <= 16) return m[1] + ' ' + KIND[m[2]];
        return rec.lab.length > 20 ? rec.lab.slice(0, 19) + '…' : rec.lab;
      })();
      /* ── 이름이 바뀐 같은 법은 **하나로 묶는다** ──
         「한센인피해사건의 진상규명 및 **피해자생활지원** 등에 관한 법률」과
         「… **피해자 지원** 등에 관한 법률」은 같은 법이 개정되며 이름이 바뀐 것이다.
         `lawKey`(공백 제거)로는 안 묶인다 — 글자가 실제로 다르다.
         **짧은 이름이 같으면 같은 법으로 본다.** 그게 곧 우리가 화면에 쓰는 이름이다. */
      const prev = byShort.get(short);
      if (prev) { mapLaws.set(lk, prev); lawMade--; lid = prev;
        const pn = nodes.get(prev);
        if (pn && rec.lab.length > (pn.title || '').length) pn.title = rec.lab;
        links.push({ from: eid, to: lid, rule: rec.byReason ? RULE_B : RULE_A,
          why: rec.byReason
            ? `법제처 제·개정이유에 「${e}」가 적혀 있습니다 — 정부가 그렇게 적었습니다`
            : `법 이름에 「${e}」가 들어 있습니다 — 국회가 그렇게 이름 붙였습니다`,
          ev: rec.first === rec.last ? `${rec.first}년 공포` : `${rec.first}~${rec.last}년 · ${rec.n}건` });
        continue;
      }
      byShort.set(short, lid);
      nodes.set(lid, { id: lid, law: 1, lab: short,
        title: rec.lab, yr: String(rec.last),
        off: rec.first === rec.last ? `${rec.first}년 공포` : `${rec.first}~${rec.last}년 · ${rec.n}번 고침`,
        tip: `${rec.lab}입니다.`,
        body: `국회를 통과해 공포된 법입니다. ${rec.first === rec.last ? `${rec.first}년에 만들어졌습니다.` : `${rec.first}년부터 ${rec.last}년까지 ${rec.n}번 고쳤습니다.`}`,
        src: '출처 · 국회 의안정보시스템',
        url: 'https://www.law.go.kr/%EB%B2%95%EB%A0%B9/' + encodeURIComponent(rec.lab) });
    }
    links.push({ from: eid, to: lid, rule: rec.byReason ? RULE_B : RULE_A,
      why: rec.byReason
        ? `법제처 제·개정이유에 「${e}」가 적혀 있습니다 — 정부가 그렇게 적었습니다`
        : `법 이름에 「${e}」가 들어 있습니다 — 국회가 그렇게 이름 붙였습니다`,
      ev: rec.first === rec.last ? `${rec.first}년 공포` : `${rec.first}~${rec.last}년 · ${rec.n}건` });
    /* ── C. 그 법이 공포된 뒤 결과 숫자가 어떻게 됐나 ──
       이미 이어져 있는 결과에만 얹는다. 새로 잇지 않는다 —
       그건 3관문이 할 일이고 여기서 넓히면 근거가 약해진다. */
    for (const rid of (topicPairs.get(lid) || [])) {
      const R = results.find(x => x.id === rid); if (!R || R.series.length < 2) continue;
      const y0 = rec.first;
      const before = R.series.filter(s => s.y <= y0).pop();
      const after = R.series.filter(s => s.y > y0).pop();
      if (!before || !after) continue;
      links.push({ from: lid, to: rid, rule: RULE_C,
        why: `이 법이 공포된 뒤(${y0}년) 이 숫자는 ${before.y}년 ${before.v} → ${after.y}년 ${after.v} 이 됐습니다. ` +
             `이 법 때문이라는 뜻은 아닙니다`,
        ev: `${before.y}${before.v} → ${after.y}${after.v}` });
      afterRes++;
    }
  }
}

/* ── 같은 쌍이 두 번 나오면 **근거가 센 쪽만** 남긴다 ──
   법 이름에도 있고 제·개정이유에도 있으면 둘 다 만들어진다. 화면에는 같은 선이 두 번이다.
   제·개정이유(B)가 더 세다 — 정부가 그 사건 때문에 고친다고 스스로 적은 것이다. */
const rank = { [RULE_B]: 0, [RULE_A]: 1, [RULE_C]: 2 };
const best = new Map();
for (const l of links) {
  const k = l.from + '\u0000' + l.to;
  const cur = best.get(k);
  if (!cur || rank[l.rule] < rank[cur.rule]) best.set(k, l);
}
const dupDropped = links.length - best.size;
links.length = 0; links.push(...best.values());

console.log(`「그 뒤에」 · 사건 ${nl(events.size)}개 · 선 ${nl(links.length)}개`);
console.log(`  A 법 이름에 사건이 적힌 것   ${nl(links.filter(l => l.rule === RULE_A).length)}건`);
console.log(`  B 제·개정이유에 적힌 것      ${nl(links.filter(l => l.rule === RULE_B).length)}건 (이유 ${nl(reasons.length)}건을 훑음)`);
console.log(`  C 법 공포 뒤 결과 수치       ${nl(afterRes)}건`);
console.log(`  새로 만든 법 노드            ${nl(lawMade)}개`);
console.log(`  겹쳐서 뺀 선 ${nl(dupDropped)}개 (근거가 센 쪽만 남긴다)\n  뺀 것 · 특검·의혹 ${dropped.특검}건 · 사람 이름 ${dropped.이름}건 (규칙 1·8)`);
if (DRY) { db.close(); process.exit(0) }

db.exec('BEGIN');
try {
  db.prepare('DELETE FROM link WHERE rule IN (?,?,?)').run(RULE_A, RULE_B, RULE_C);
  const ins = db.prepare(
    `INSERT INTO link (from_id,to_id,role,rule,why,evidence,built_at) VALUES (?,?,'after',?,?,?,?)`);
  for (const l of links) ins.run(l.from, l.to, l.rule, l.why, l.ev, NOW);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e }

const nodeJs = [...nodes.values()].map(n => n.law
  ? `{id:${q(n.id)},t:'bill',auto:1,side:'gov',kind:'법률',st:'공포',lab:${q(n.lab)},title:${q(n.title)},` +
    `yr:${q(n.yr)},off:${q(n.off)},tip:${q(n.tip)},body:${q(n.body)},src:${q(n.src)},url:${q(n.url)},cats:[]}`
  : `{id:${q(n.id)},t:'event',auto:1,side:'rec',lab:${q(n.lab)},title:${q(n.title)},yr:${q(n.yr)},` +
    `ekind:${q(n.ekind)},tip:${q(n.tip)},body:${q(n.body)},src:${q(n.src)},url:${q(n.url)},cats:[]}`
).join('\n,');
const linkJs = links.map(l =>
  `[${q(l.from)},${q(l.to)},'그 뒤에','after',${q(l.why)},${q(l.ev)},'','auto']`).join('\n,');

let out = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const put = (tag, body) => {
  const s = `/*AUTO-${tag}-START*/`, e = `/*AUTO-${tag}-END*/`;
  const i = out.indexOf(s), j = out.indexOf(e);
  if (i < 0 || j < 0) { console.error(`index.html 에 ${s} 자리가 없다`); process.exit(2) }
  out = out.slice(0, i + s.length) + '\n' + body + (body ? '\n,' : '\n') + out.slice(j);
};
put('AFTER-N', nodeJs); put('AFTER-L', linkJs);
fs.writeFileSync(path.join(ROOT, 'index.html'), out);
console.log(`\nindex.html 에 노드 ${nl(nodes.size)}개 · 선 ${nl(links.length)}개 내보냄`);
db.close();
