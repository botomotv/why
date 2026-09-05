/* 판례 주문에서 **형량만** 뽑는 공식. 한 곳에만 둔다.
 *
 * 전에는 tools/sentence.mjs 안에만 있었다. 그런데 tools/verdict.mjs 가 같은 일을
 * 하게 되면서 두 벌이 될 뻔했다 — **두 벌이 되는 순간 갈라진다** (CLAUDE.md).
 * 그래서 여기로 옮기고 둘이 이것을 import 한다.
 *
 * ── 규칙 8 을 어떻게 지키나 ──
 * 법제처 `판례내용` 에는 검사·변호사·피고인 이름이 그대로 있다:
 *     【검 사】 차병곤 외 1인【변 호 인】 변호사 홍푸른 외 1인
 * 그래서 **전문을 담지 않는다.** 【주 문】 구간만 잘라내고 그 안에서 형량 문장만 뽑는다.
 * 이름이 섞인 문장은 **통째로 버린다** — 오려내다 놓치면 이름이 지도에 올라간다.
 */

/* ── 사람 이름이 섞였나 ── 검사 47 과 같은 잣대다.
   **띄어쓰기를 반드시 요구한다.** `\s*` 로 뒀더니 죄명 「증인도피」를
   '증인'+'도피' 로 읽은 적이 있다. 익명 마스크(○)가 있으면 그 자리가 사람 이름이다. */
export const SURNAME = '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허유남심노하곽성차주우구신임나전민유진지엄채원천방공현함변염양변여추도소석선설마길연위표명기반왕금옥육인맹제모장남탁국여진어은편구';
/* **조사를 허용해야 한다.** 처음엔 이름 뒤에 `(?![가-힣])` 를 걸었는데 실제 주문은
   「검사 차병곤**의**」처럼 조사가 붙어서 **하나도 못 잡았다.** */
export const NAME_RE = new RegExp(`(?:피\\s*고\\s*인|검\\s*사|변\\s*호\\s*인|변호사|청구인|원고|피고|증인|참고인|고소인|피해자|신청인|항고인|상고인)\\s+[${SURNAME}][가-힣]{1,2}(?=[을를이가은는의에과와도만및·,\\s.)\\]]|$)`);
export const MASK_RE = /[가-힣]\s*○\s*[가-힣]?/;
export const hasName = s => NAME_RE.test(s) || MASK_RE.test(s);

/* ── 형량 문장 ──
   꼴을 하나씩 정규식으로 잡으면 끝이 없다 (30건 중 5건을 놓쳤다).
   **문장 단위로 쪼개고 형벌 낱말이 든 문장을 담는다.**
   몰수·추징은 뺀다 — 「압수된 과도 1자루」처럼 사건 묘사가 딸려 온다. */
export const PENAL = /(징역|금고|벌금|구류|사형|무기|집행을?\s*[0-9]*\s*년?간?\s*유예|무죄|면소|공소기각|기각한다|파기|환송|형(?:의\s*선고)?을\s*면제)/;
export const NOTPENAL = /(몰수한다|추징한다|압수|가납|소송비용|보호관찰을\s*명|이수를\s*명|취업제한|공개를?\s*명|고지를?\s*명)/;

/** 판례내용에서 【주 문】 구간만 잘라 형량 문장을 뽑는다 */
export function pickVerdict(body) {
  const m = String(body || '').match(/【\s*주\s*문\s*】([\s\S]*?)(?=【\s*이\s*유\s*】|$)/);
  if (!m) return { ok: 0, why: '주문 구간을 못 찾았다' };
  const juntext = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const sents = juntext.split(/(?<=다\.)\s+/).map(x => x.trim()).filter(Boolean);
  const out = [];
  for (const line of sents) {
    if (!PENAL.test(line)) continue;
    if (NOTPENAL.test(line)) continue;
    if (hasName(line)) continue;
    if (line.length > 160) continue;
    if (!out.includes(line)) out.push(line);
  }
  if (!out.length) return { ok: 0, why: '주문에서 형량 문장을 못 찾았다', jun: juntext.slice(0, 120) };
  return { ok: 1, verdict: out };
}

/** 형량 여러 줄을 **한 줄**로 줄인다.
 *  「주범」이라고 쓰지 않는다 — 어느 피고인이 주범인지는 주문에 없고 우리가 정할 값이 아니다.
 *  **「가장 무거운 형」**이라고 쓴다. 그건 주문에 적힌 것을 정렬한 사실이다. */
export function penShort(lines) {
  const txt = lines.join(' / ');
  const yrs = [];
  for (const m of txt.matchAll(/(?:징역|금고)\s*(\d+)\s*년(?:\s*(\d+)\s*(?:개)?월)?/g))
    yrs.push(+m[1] * 12 + (m[2] ? +m[2] : 0));
  for (const m of txt.matchAll(/(?:징역|금고)\s*(\d+)\s*(?:개)?월/g)) yrs.push(+m[1]);
  const life = /무기징역/.test(txt), death = /사형/.test(txt);
  const fine = [...txt.matchAll(/벌금\s*([\d,]+)\s*(원|만원)/g)]
    .map(m => +m[1].replace(/,/g, '') * (m[2] === '만원' ? 10000 : 1));
  const fmt = mo => (mo < 12 ? mo + '개월' : (mo % 12 ? (mo / 12 | 0) + '년 ' + (mo % 12) + '개월' : (mo / 12) + '년'));
  const parts = [];
  if (death) parts.push('사형');
  if (life) parts.push('무기징역');
  if (yrs.length) {
    const lo = Math.min(...yrs), hi = Math.max(...yrs);
    parts.push('징역 ' + (lo === hi ? fmt(hi) : fmt(hi) + '~' + fmt(lo)));
  }
  if (fine.length) parts.push('벌금 ' + Math.max(...fine).toLocaleString('ko-KR') + '원');
  if (!parts.length) return '';
  const who = new Set(txt.match(/피고인\s*\d+/g) || []).size;
  return '가장 무거운 형 ' + parts[0] + (parts.length > 1 ? ' · 나머지 ' + parts.slice(1).join(' · ') : '')
    + (who > 1 ? ` · 피고인 ${who}명` : '');
}

/** 대법원 주문이 **상고기각**이면 원심이 그대로 확정된 것이다. */
export const isFinalDismissal = lines =>
  lines.some(l => /상고를?\s*(모두\s*)?기각한다/.test(l)) &&
  !lines.some(l => /파기|환송|이송/.test(l));

/** 판례내용의 【원심판결】 줄에서 법원·사건번호를 꺼낸다.
 *  이 줄에는 사람 이름이 없다 — 법원 이름·선고일·사건번호뿐이다. */
export function lowerCourt(body) {
  const b = String(body || '').replace(/<[^>]+>/g, '\n');
  const m = b.match(/【\s*원\s*심\s*판\s*결\s*】([^\n【]{0,120})/);
  if (!m) return null;
  const line = m[1].trim();
  const no = line.match(/(\d{4}(?:재)?[가-힣]{1,3}\d+)/);
  const ct = line.match(/^([^\s]+(?:지법|고법|지방법원|고등법원|법원)[^\s]*)/);
  return no ? { no: no[1], court: ct ? ct[1] : '', line } : null;
}
