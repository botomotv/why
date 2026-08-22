#!/usr/bin/env node
/**
 * 열린국회정보 API probe — 필드명을 눈으로 확인하기 위한 도구
 *
 * 수집기를 짜기 전에 이걸 먼저 돌린다.
 * 응답 필드명을 추측으로 정하면 매퍼를 전부 다시 짜야 한다.
 *
 * 하는 일
 *   1. OPENSRVAPI 로 전체 API 카탈로그를 받는다
 *   2. 의안·표결·발의·의원 관련 서비스만 골라낸다
 *   3. 각각 3건씩 호출해서 실제 필드명과 샘플을 파일로 남긴다
 *   4. _SUMMARY.md 하나로 정리한다
 *
 * 실행
 *   ASSEMBLY_KEY=발급받은키 node tools/probe.mjs
 *
 * 인증키는 환경변수로만 받는다. 코드에 박지 않는다.
 * 값이 없으면 조용히 넘어가지 않고 멈춘다 — 개발용 값으로 조용히 떨어지면
 * 무엇으로 받은 데이터인지 알 수 없게 된다.
 */

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.ASSEMBLY_KEY;
const OUT = process.env.PROBE_OUT || 'probe-out';
const BASE = 'https://open.assembly.go.kr/portal/openapi';
const GAP_MS = Number(process.env.PROBE_GAP || 350);   // 호출 간격
const SAMPLE = 3;                                       // 서비스당 받아볼 건수

if (!KEY) {
  console.error(`
인증키가 없습니다. 멈춥니다.

  ASSEMBLY_KEY 환경변수에 열린국회정보 인증키를 넣고 다시 실행하세요.

    ASSEMBLY_KEY=여기에키 node tools/probe.mjs

  키는 https://open.assembly.go.kr 에서 발급받습니다.
  키를 코드나 파일에 적지 마세요. 셸 기록에도 남기고 싶지 않으면:

    read -s ASSEMBLY_KEY && export ASSEMBLY_KEY && node tools/probe.mjs
`);
  process.exit(1);
}

/* ── 이번에 볼 것만 고른다 ──
   전체 카탈로그는 수백 개다. 지금 필요한 건 의안·표결·발의·의원뿐이다.
   나머지는 창고에 넣을 이유가 아직 없다. */
const WANT = [
  { key: '의안',   why: '법안 본문·소관위·공포일자' },
  { key: '발의',   why: '대표발의자 → 법안 (lead)' },
  { key: '표결',   why: '본회의 표결 → 정당별 집계 (lead/against)' },
  { key: '의원',   why: '의원 → 정당 (소속)' },
  { key: '법률',   why: '공포 법률' },
  { key: '본회의', why: '표결이 붙는 회의' },
];
const SKIP = ['사진', '이미지', '동영상', '청원', '민원', '방송', '식당', '주차'];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ensure = d => fs.mkdirSync(d, { recursive: true });
const safe = s => String(s).replace(/[^\w가-힣.-]/g, '_').slice(0, 80);

async function call(service, params = {}) {
  const q = new URLSearchParams({ KEY, Type: 'json', pIndex: '1', pSize: String(SAMPLE), ...params });
  const url = `${BASE}/${service}?${q}`;
  const shown = url.replace(KEY, '***');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text) } catch (e) { /* JSON 이 아닐 수 있다 */ }
    return { ok: res.ok, status: res.status, url: shown, json, text: json ? null : text.slice(0, 400) };
  } catch (e) {
    return { ok: false, status: (e.cause && e.cause.code) || e.name, url: shown, json: null, text: String(e.message) };
  }
}

/* 열린국회정보 응답은 {서비스명:[{head:[...]},{row:[...]}]} 모양이다.
   에러일 때는 {RESULT:{CODE,MESSAGE}} 로 온다. 둘 다 받아낸다. */
function unpack(json) {
  if (!json || typeof json !== 'object') return { rows: [], note: '응답이 JSON 이 아님' };
  if (json.RESULT) return { rows: [], note: `${json.RESULT.CODE || ''} ${json.RESULT.MESSAGE || ''}`.trim() };
  const key = Object.keys(json).find(k => Array.isArray(json[k]));
  if (!key) return { rows: [], note: '배열을 못 찾음' };
  const arr = json[key];
  const rows = [];
  let total = null, note = '';
  arr.forEach(part => {
    if (part && Array.isArray(part.row)) rows.push(...part.row);
    if (part && Array.isArray(part.head)) part.head.forEach(h => {
      if (h && typeof h.list_total_count === 'number') total = h.list_total_count;
      if (h && h.RESULT) note = `${h.RESULT.CODE || ''} ${h.RESULT.MESSAGE || ''}`.trim();
    });
  });
  return { rows, total, note, envelope: key };
}

const trunc = v => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
};

async function main() {
  ensure(OUT);
  console.log(`열린국회정보 probe 시작 — 결과는 ${OUT}/ 에 쌓입니다\n`);

  /* ── 1. 카탈로그 ── */
  console.log('1) API 카탈로그 받는 중 (OPENSRVAPI)…');
  const cat = await call('OPENSRVAPI', { pSize: '1000' });
  fs.writeFileSync(path.join(OUT, '_catalog.raw.json'), JSON.stringify(cat.json ?? cat.text, null, 2));
  const cu = unpack(cat.json);

  if (!cu.rows.length) {
    console.error(`\n카탈로그를 못 받았습니다. 멈춥니다.`);
    console.error(`  상태 ${cat.status} · ${cu.note || cat.text || ''}`);
    console.error(`  요청 ${cat.url}`);
    console.error(`\n인증키가 아직 활성화되지 않았을 수 있습니다. 발급 화면에서 상태를 확인하세요.`);
    process.exit(2);
  }
  console.log(`   서비스 ${cu.rows.length}개 확인 (전체 ${cu.total ?? '?'})`);

  /* 카탈로그 행의 필드명도 기관마다 다르다. 이름과 코드로 쓸 만한 걸 찾는다. */
  const pick = (row, cands) => {
    for (const c of cands) if (row[c]) return String(row[c]);
    const k = Object.keys(row).find(k => cands.some(c => k.toUpperCase().includes(c.toUpperCase())));
    return k ? String(row[k]) : '';
  };

  const services = cu.rows.map(r => ({
    name: pick(r, ['SVC_NM', 'SERVICE_NM', 'API_NM', 'NM', 'TITLE']),
    code: pick(r, ['INF_ID', 'SVC_ID', 'API_ID', 'ID', 'CODE']),
    raw: r,
  })).filter(s => s.name || s.code);

  const matched = services.filter(s => {
    const hay = `${s.name} ${s.code}`;
    if (SKIP.some(k => hay.includes(k))) return false;
    return WANT.some(w => hay.includes(w.key));
  });

  console.log(`   그중 의안·표결·발의·의원 관련 ${matched.length}개\n`);
  if (!matched.length) {
    console.error('고를 서비스가 없습니다. _catalog.raw.json 을 열어 필드명을 확인하세요.');
    process.exit(3);
  }

  /* ── 2. 각 서비스 3건씩 ── */
  const report = [];
  for (let i = 0; i < matched.length; i++) {
    const s = matched[i];
    const id = s.code || s.name;
    process.stdout.write(`2) [${i + 1}/${matched.length}] ${id} ${s.name ? '· ' + s.name : ''} … `);
    const r = await call(id);
    const u = unpack(r.json);
    const fields = u.rows.length ? Object.keys(u.rows[0]) : [];
    fs.writeFileSync(
      path.join(OUT, `${safe(id)}.json`),
      JSON.stringify({ service: id, name: s.name, url: r.url, status: r.status, note: u.note,
                       total: u.total, fields, rows: u.rows }, null, 2));
    report.push({ id, name: s.name, status: r.status, total: u.total, note: u.note,
                  fields, sample: u.rows[0] || null,
                  why: (WANT.find(w => `${s.name} ${s.code}`.includes(w.key)) || {}).why || '' });
    console.log(u.rows.length ? `필드 ${fields.length}개` : `데이터 없음 (${u.note || r.status})`);
    await sleep(GAP_MS);
  }

  /* ── 3. 요약 ── */
  const ok = report.filter(r => r.fields.length);
  const bad = report.filter(r => !r.fields.length);
  const md = [];
  md.push('# 열린국회정보 API probe 결과', '');
  md.push('필드명을 **추측하지 않기 위해** 실제 응답을 받아 적은 것이다.');
  md.push('매퍼는 이 문서의 필드명만 보고 짠다.', '');
  md.push(`- 카탈로그 서비스 ${cu.rows.length}개 중 의안·표결·발의·의원 관련 **${matched.length}개**`);
  md.push(`- 응답을 받은 것 **${ok.length}개** · 못 받은 것 ${bad.length}개`);
  md.push(`- 서비스당 ${SAMPLE}건씩. 원본은 같은 폴더의 \`<서비스코드>.json\``, '');
  md.push('> 인증키는 환경변수 `ASSEMBLY_KEY` 로만 받는다. 이 문서와 결과 파일에는 키가 없다.', '');

  md.push('## 쓸 수 있는 서비스', '');
  ok.forEach(r => {
    md.push(`### \`${r.id}\` ${r.name ? `· ${r.name}` : ''}`);
    if (r.why) md.push(`무엇에 쓰나 · ${r.why}`);
    md.push(`전체 건수 · ${r.total ?? '?'}`, '');
    md.push('| 필드 | 샘플 |', '|---|---|');
    r.fields.forEach(f => md.push(`| \`${f}\` | ${trunc(r.sample?.[f]).replace(/\|/g, '\\|')} |`));
    md.push('');
  });

  if (bad.length) {
    md.push('## 응답을 못 받은 것', '');
    md.push('| 서비스 | 상태 | 메모 |', '|---|---|---|');
    bad.forEach(r => md.push(`| \`${r.id}\` | ${r.status} | ${r.note || ''} |`));
    md.push('');
    md.push('키가 아직 활성화되지 않았거나, 그 서비스가 별도 신청을 요구할 수 있다.', '');
  }

  md.push('## 다음 단계', '');
  md.push('1. 위 필드명으로 매퍼를 짠다. **필드명을 추측하지 않는다.**');
  md.push('2. 수집한 전부를 지도에 넣지 않는다. SQLite 창고에 넣고 **관계가 붙은 것만** 지도로 올린다.');
  md.push('3. 대통령 관계는 **공포일자 × 재임표 계산으로만** 만든다.');
  md.push('   발의자·소관부처 필드에서 대통령을 끌어오는 코드 경로를 두지 않는다 (규칙 3).');

  fs.writeFileSync(path.join(OUT, '_SUMMARY.md'), md.join('\n'));
  console.log(`\n끝났습니다.`);
  console.log(`  요약  ${OUT}/_SUMMARY.md`);
  console.log(`  원본  ${OUT}/*.json`);
  if (bad.length) console.log(`  ※ ${bad.length}개는 응답을 못 받았습니다. 요약 아래쪽을 보세요.`);
}

main().catch(e => { console.error('\n실패:', e && e.message ? e.message : e); process.exit(9) });
