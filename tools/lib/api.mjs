/**
 * 열린국회정보 API 호출 공통부.
 * probe · count · collect 가 같은 코드로 부른다.
 * 호출 방식이 셋으로 갈리면 "probe 는 됐는데 수집기는 안 된다" 가 생긴다.
 */

export const BASE = process.env.ASSEMBLY_BASE || 'https://open.assembly.go.kr/portal/openapi';
export const GAP_MS = Number(process.env.ASSEMBLY_GAP || 1000);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 인증키를 환경변수로만 받는다. 없으면 조용히 넘어가지 않고 멈춘다. */
export function needKey(who) {
  const k = process.env.ASSEMBLY_KEY;
  if (k) return k;
  console.error(`
인증키가 없습니다. 멈춥니다.

  ASSEMBLY_KEY 환경변수에 열린국회정보 인증키를 넣고 다시 실행하세요.
  셸 기록에 키를 남기지 않으려면:

    read -s ASSEMBLY_KEY && export ASSEMBLY_KEY && node ${who}
`);
  process.exit(1);
}

/** 파라미터를 키 정렬한 JSON 문자열로. 같은 호출을 두 번 저장하지 않기 위해서다. */
export const paramKey = p =>
  JSON.stringify(Object.fromEntries(Object.entries(p).sort(([a], [b]) => a < b ? -1 : 1)));

export async function call(key, service, params = {}) {
  const q = new URLSearchParams({ KEY: key, Type: 'json', pIndex: '1', pSize: '100', ...params });
  const url = `${BASE}/${service}?${q}`;
  const res = await fetch(url);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text) } catch { /* HTML 오류쪽지일 수 있다 */ }
  return { url: url.replace(key, '***'), status: res.status, text, json };
}

/**
 * 응답에서 head / row 를 꺼낸다.
 * 열린국회정보는 성공하면 {서비스명:[{head},{row}]}, 실패하면 {RESULT:{CODE,MESSAGE}} 로 온다.
 */
export function unpack(json) {
  if (!json) return { rows: [], total: null, code: '', msg: '응답이 JSON 이 아닙니다' };
  if (json.RESULT) return { rows: [], total: null, code: json.RESULT.CODE || '', msg: json.RESULT.MESSAGE || '' };

  const arr = Object.values(json).find(Array.isArray);
  if (!arr) return { rows: [], total: null, code: '', msg: '알 수 없는 모양' };

  let rows = [], total = null, code = '', msg = '';
  for (const part of arr) {
    if (!part || typeof part !== 'object') continue;
    if (Array.isArray(part.row)) rows = part.row;
    if (Array.isArray(part.head)) for (const h of part.head) {
      if (h.list_total_count != null) total = h.list_total_count;
      if (h.RESULT) { code = h.RESULT.CODE || code; msg = h.RESULT.MESSAGE || msg }
    }
  }
  return { rows, total, code, msg };
}

/** 에러 코드가 뜻하는 바. 310 과 300 은 완전히 다른 문제다. */
export function explain(code, msg) {
  if (code === 'ERROR-310') return '서비스명이 틀렸다 (그런 서비스가 없다)';
  if (code === 'ERROR-300') return '필수 파라미터가 빠졌다 (서비스명은 맞다)';
  if (code === 'ERROR-336') return '요청 건수 초과일 수 있다';
  if (code === 'ERROR-290' || code === 'ERROR-291') return '인증키 문제';
  if (code && code !== 'INFO-000' && code !== 'INFO-200') return msg || code;
  return '';
}
