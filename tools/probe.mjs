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

  /* 카탈로그 레코드가 실제로 어떤 키를 갖는지 그대로 보여준다.
     추측으로 필드명을 고르면 그다음이 전부 어긋난다. */
  console.log('\n   레코드 한 건의 키 전부:');
  const sample0 = cu.rows[0] || {};
  Object.keys(sample0).forEach(k => {
    const v = String(sample0[k] === null || sample0[k] === undefined ? '' : sample0[k]).replace(/\s+/g, ' ');
    console.log(`     ${k.padEnd(22)} ${v.slice(0, 60)}`);
  });
  console.log('');

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

  console.log(`   그중 의안·표결·발의·의원 관련 ${matched.length}개`);

  /* 카탈로그의 ID 는 문서 페이지 번호이지 호출에 쓰는 서비스명이 아니다.
     실제로 확인된 것: 같은 이름 '의안정보 통합 API' 가 서로 다른 ID 로 두 번 나온다
     (OOWY4R001216HX11536 / OOWY4R001216HX11440). 그 값으로 호출하면 전부 ERROR-310 이다.
     그래서 알려진 서비스명을 코드에 두고 그걸로 부른다.
     이 목록은 검증되지 않았다 — 하나를 먼저 불러보고, 되면 나머지를 돈다. */
  /* 서비스명은 카탈로그로 못 얻는다. 실제로 확인한 것:
       · OPENSRVAPI 레코드의 키는 INF_ID INF_NM INF_EXP CATE_NM OPEN_DTTM ORG_NM
         LOAD_DTTM SRC_EXP DDC_URL SRV_URL CCL_NM LOAD_NM LOAD_CONT — 서비스명 자리가 없다.
       · SRV_URL(상세 페이지) HTML 에도 없다. ALLBILL 도 nzmimeepazxkubdpn 도 안 나온다.
     그래서 목록을 손으로 관리한다. 12개뿐이고 서비스명은 자주 바뀌지 않는다.
     robots.txt 는 /admin/ 만 막지만, HTML 파싱은 구조가 바뀌면 조용히 깨진다.
     "확인된 것만 싣는다" 는 이 프로젝트 원칙에는 명시적 목록이 맞다.

     list:true 는 '파라미터 없이 목록이 나오는' 서비스다. 목록형부터 검증한다 —
     파라미터가 필요한 서비스로 검증하면 이름이 맞아도 실패해서 목록 전체를 의심하게 된다. */
  const KNOWN = [
    ['ALLNAMEMBER',       '국회의원 인적사항',              '의원 → 정당 (소속)',              true],
    ['ALLBILL',           '의안정보 통합 API',              '법안 본문·소관위·공포일자',        true],
    ['nzmimeepazxkubdpn', '국회의원 발의법률안',            '대표발의자 → 법안 (lead)',        true],
    ['nqfvrbsdafrmuzixe', '의안접수목록',                  '접수일',                        true],
    ['BILLRSNRAW',        '법률안 제안이유 및 주요내용',     '자동 연결 3관문 · 조문 언급',      false],
    ['nojepdqqaweusdfbi', '국회의원 본회의 표결정보',        '표결 → 정당별 집계',             false],
    ['nwbpacrgavhjryiph', '본회의 처리안건_법률안',          '가결·부결',                     false],
    ['nrqwepvouwwsghmze', '위원회 심사(계류의안)',          '소관위',                        false],
    ['VCONFBILLCONFIRM',  '위원회 심사(처리의안)',          '소관위',                        false],
    ['BILLJSDCONFIRM',    '위원회 심사(처리의안)_예결위',    '소관위',                        false],
    ['nzgjnyaowzmvhzpqi', '위원회 심사(처리의안)_본회의부의', '소관위',                       false],
    ['VCONFBILLLIST',     '위원회 심사(처리의안)_의안검색',  '소관위',                        false],
  ];

  /* 목록형 하나로 먼저 확인한다. 이게 되면 서비스명 규칙이 맞다는 뜻이다.
     파라미터가 필요한 서비스로 확인하면 이름이 맞아도 실패해서 엉뚱한 결론이 난다. */
  const first = KNOWN.find(k => k[3]) || KNOWN[0];
  console.log(`\n2) 서비스명 확인 — 파라미터 없이 되는 것으로 먼저 (${first[0]} · ${first[1]})`);
  const probe1 = await call(first[0]);
  const u1 = unpack(probe1.json);
  if (!u1.rows.length) {
    const code1 = (u1.note || '').match(/ERROR-\d+/);
    console.error(`\n   실패 — ${u1.note || probe1.status}`);
    console.error(`   요청 ${probe1.url}`);
    if (code1 && code1[0] === 'ERROR-310') {
      console.error(`\n서비스명이 틀렸습니다. ERROR-310 은 '그런 서비스가 없다' 는 뜻입니다.`);
      console.error(`KNOWN 목록을 고쳐야 합니다. 카탈로그(_catalog.raw.json)에는 서비스명이 없으므로`);
      console.error(`열린국회정보 각 API 화면에서 요청 주소 끝의 이름을 직접 확인하세요.`);
    } else if (code1 && code1[0] === 'ERROR-300') {
      console.error(`\n서비스명은 맞습니다. ERROR-300 은 '필수 파라미터가 빠졌다' 는 뜻입니다.`);
      console.error(`목록형이라고 표시했지만 실제로는 파라미터가 필요한 서비스입니다.`);
      console.error(`KNOWN 목록에서 이 항목의 마지막 값을 false 로 바꾸세요.`);
    } else {
      console.error(`\n인증키가 아직 활성화되지 않았을 수 있습니다.`);
    }
    process.exit(3);
  }
  console.log(`   성공 — 필드 ${Object.keys(u1.rows[0]).length}개. 나머지를 돕니다.\n`);
  matched.length = 0;
  KNOWN.forEach(([code, name, why, list]) => matched.push({ name, code, why, list }));

  /* ── 2. 각 서비스 3건씩 ── */
  const report = [];
  for (let i = 0; i < matched.length; i++) {
    const s = matched[i];
    const id = s.code || s.name;
    process.stdout.write(`2) [${i + 1}/${matched.length}] ${id} ${s.name ? '· ' + s.name : ''} … `);
    let r = await call(id);
    let u = unpack(r.json);
    let usedParams = null;

    /* ERROR-300 은 '서비스는 있는데 필수 파라미터가 빠졌다' 는 뜻이다.
       흔한 값을 몇 개만 시도한다. 그래도 안 되면 '필수 파라미터 미상' 으로 남긴다.
       추측으로 채우지 않는다 — 틀린 파라미터로 받은 데이터가 더 나쁘다. */
    if (!u.rows.length && /ERROR-300/.test(u.note || '')) {
      const tries = [
        { AGE: '22' },
        { AGE: '21' },
        { UNIT_CD: '100022' },
        { AGE: '22', BILL_ID: '' },
      ];
      for (const t of tries) {
        await sleep(GAP_MS);
        const r2 = await call(id, t);
        const u2 = unpack(r2.json);
        if (u2.rows.length) { r = r2; u = u2; usedParams = t; break }
      }
    }

    const fields = u.rows.length ? Object.keys(u.rows[0]) : [];
    const errCode = (String(u.note || '').match(/ERROR-\d+|INFO-\d+/) || [])[0] || '';
    fs.writeFileSync(
      path.join(OUT, `${safe(id)}.json`),
      JSON.stringify({ service: id, name: s.name, url: r.url, status: r.status, note: u.note,
                       errCode, params: usedParams, total: u.total, fields, rows: u.rows }, null, 2));
    report.push({ id, name: s.name, status: r.status, total: u.total, note: u.note, errCode,
                  params: usedParams, fields, sample: u.rows[0] || null, why: s.why || '' });
    console.log(u.rows.length
      ? `필드 ${fields.length}개${usedParams ? ' (파라미터 ' + JSON.stringify(usedParams) + ')' : ''}`
      : `실패 ${errCode || r.status}`);
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
    if (r.params) md.push(`필수 파라미터 · \`${JSON.stringify(r.params)}\``);
    md.push(`전체 건수 · ${r.total ?? '?'}`, '');
    md.push('| 필드 | 샘플 |', '|---|---|');
    r.fields.forEach(f => md.push(`| \`${f}\` | ${trunc(r.sample?.[f]).replace(/\|/g, '\\|')} |`));
    md.push('');
  });

  if (bad.length) {
    /* ERROR-310 과 ERROR-300 은 완전히 다른 문제다.
       310 은 이름이 틀린 것이고, 300 은 이름이 맞는데 파라미터가 빠진 것이다.
       구분해서 보여줘야 다음에 무엇을 고칠지 안다. */
    const notFound = bad.filter(r => /ERROR-310/.test(r.errCode || r.note || ''));
    const needParam = bad.filter(r => /ERROR-300/.test(r.errCode || r.note || ''));
    const other = bad.filter(r => !notFound.includes(r) && !needParam.includes(r));

    if (needParam.length) {
      md.push('## 서비스는 있는데 필수 파라미터를 모른다 (ERROR-300)', '');
      md.push('**서비스명은 맞다.** 이름을 고치지 말고 파라미터를 찾아야 한다.');
      md.push('AGE=22 · AGE=21 · UNIT_CD=100022 를 시도했지만 안 됐다.');
      md.push('열린국회정보 각 API 화면의 "요청인자" 표에서 필수 항목을 확인할 것.', '');
      md.push('| 서비스 | 이름 | 무엇에 쓰나 |', '|---|---|---|');
      needParam.forEach(r => md.push(`| \`${r.id}\` | ${r.name || ''} | ${r.why || ''} |`));
      md.push('');
    }
    if (notFound.length) {
      md.push('## 서비스명이 틀렸다 (ERROR-310)', '');
      md.push('**그런 서비스가 없다.** KNOWN 목록의 이름을 고쳐야 한다.', '');
      md.push('| 서비스 | 이름 |', '|---|---|');
      notFound.forEach(r => md.push(`| \`${r.id}\` | ${r.name || ''} |`));
      md.push('');
    }
    if (other.length) {
      md.push('## 그 밖의 실패', '');
      md.push('| 서비스 | 상태 | 메모 |', '|---|---|---|');
      other.forEach(r => md.push(`| \`${r.id}\` | ${r.errCode || r.status} | ${r.note || ''} |`));
      md.push('');
    }
  }

  md.push('## 다음 단계', '');
  md.push('1. 위 필드명으로 매퍼를 짠다. **필드명을 추측하지 않는다.**');
  md.push('2. 수집한 전부를 지도에 넣지 않는다. SQLite 창고에 넣고 **관계가 붙은 것만** 지도로 올린다.');
  md.push('3. 대통령 관계는 **공포일자 × 재임표 계산으로만** 만든다.');
  md.push('   발의자·소관부처 필드에서 대통령을 끌어오는 코드 경로를 두지 않는다 (규칙 3).');

  /* 파일이 실제로 저장됐는지 확인하고 말한다.
     전에 "완료" 는 떴는데 파일이 없었다. 그것도 거짓 초록불이다. */
  const sumPath = path.join(OUT, '_SUMMARY.md');
  fs.writeFileSync(sumPath, md.join('\n'));
  if (!fs.existsSync(sumPath)) {
    console.error(`\n요약 파일을 저장하지 못했습니다: ${sumPath}`);
    process.exit(5);
  }
  const kb = Math.max(1, Math.round(fs.statSync(sumPath).size / 1024));

  console.log(`\n받은 것 ${ok.length}개 · 못 받은 것 ${bad.length}개`);
  console.log(`  요약  ${sumPath}  (${kb}KB)`);
  console.log(`  원본  ${OUT}/*.json`);

  /* 전부 실패했는데 "끝났습니다" 로 끝내지 않는다. 성공 0개는 실패다. */
  if (!ok.length) {
    console.error(`\n한 건도 못 받았습니다. 실패로 끝냅니다.`);
    bad.slice(0, 5).forEach(r => console.error(`  · ${r.id} — ${r.note || r.status}`));
    process.exit(4);
  }
  if (bad.length) console.log(`  ※ ${bad.length}개는 응답을 못 받았습니다. 요약 아래쪽을 보세요.`);
}

main().catch(e => { console.error('\n실패:', e && e.message ? e.message : e); process.exit(9) });
