#!/usr/bin/env node
/**
 * 대수별 건수 세기 — 수집 전에 진짜 규모를 먼저 안다.
 *
 * 추측하지 않는다. pSize=1 로 22번 부르면 list_total_count 가 정확한 답을 준다.
 * 역대 전체가 몇 건인지 모르는 채로 수집을 시작하면
 * "며칠 걸리나" 를 끝까지 모른다.
 *
 * 실행
 *   read -s ASSEMBLY_KEY && export ASSEMBLY_KEY && node tools/count.mjs
 */

import fs from 'node:fs';
import { needKey, call, unpack, explain, sleep, GAP_MS } from './lib/api.mjs';

const KEY = needKey('tools/count.mjs');
const OUT = process.env.COUNT_OUT || 'probe-out/_COUNT.md';
const FROM = Number(process.env.COUNT_FROM || 1);
const TO   = Number(process.env.COUNT_TO   || 22);

/* 세어볼 것. 표결(nojepdqqaweusdfbi)은 BILL_ID 가 필수라 대수만으로는 못 센다. */
const SERVICES = [
  { id: 'nzmimeepazxkubdpn', nm: '의원 발의법률안' },
  { id: 'nwbpacrgavhjryiph', nm: '본회의 처리안건_법률안' },
];

async function main() {
  const grid = {};      // {service: {age: count|null}}
  const errs = [];

  for (const s of SERVICES) {
    grid[s.id] = {};
    for (let age = FROM; age <= TO; age++) {
      const r = await call(KEY, s.id, { AGE: String(age), pIndex: '1', pSize: '1' });
      const u = unpack(r.json);
      const why = explain(u.code, u.msg);

      /* 그 대수에 데이터가 없는 것(INFO-200)과 부를 수 없는 것(ERROR-*)은 다르다.
         전자는 0 이고 후자는 '모름' 이다. 둘을 같은 0 으로 적으면 거짓말이 된다. */
      if (u.total != null)              grid[s.id][age] = u.total;
      else if (u.code === 'INFO-200')   grid[s.id][age] = 0;
      else { grid[s.id][age] = null; errs.push(`${s.nm} AGE=${age} · ${u.code || r.status} ${why}`) }

      process.stdout.write(`\r${s.nm} 제${age}대 … ${grid[s.id][age] ?? '모름'}          `);
      await sleep(GAP_MS);
    }
    process.stdout.write('\n');
  }

  /* ── 표 ── */
  const md = ['# 대수별 건수', '', `센 날짜 · ${new Date().toISOString().slice(0, 10)}`, '',
    '`pSize=1` 로 부르고 `list_total_count` 만 읽었다. 추정이 아니라 실측이다.', '',
    '| 대 | ' + SERVICES.map(s => s.nm).join(' | ') + ' |',
    '|---:|' + SERVICES.map(() => '---:').join('|') + '|'];

  const sum = {}; SERVICES.forEach(s => sum[s.id] = 0);
  let unknown = 0;
  for (let age = FROM; age <= TO; age++) {
    const cells = SERVICES.map(s => {
      const v = grid[s.id][age];
      if (v == null) { unknown++; return '모름' }
      sum[s.id] += v; return v.toLocaleString();
    });
    md.push(`| 제${age}대 | ${cells.join(' | ')} |`);
  }
  md.push(`| **합계** | ${SERVICES.map(s => `**${sum[s.id].toLocaleString()}**`).join(' | ')} |`, '');

  /* 0 은 의심한다. 분모를 같이 낸다. */
  const cells = SERVICES.length * (TO - FROM + 1);
  md.push(`센 칸 ${cells - unknown} / ${cells}개 · 못 센 칸 ${unknown}개`, '');

  /* ── 수집 시간 추정 — 확인된 값으로만 ── */
  const bills = sum[SERVICES[0].id];
  const pages = Math.ceil(bills / 1000) + Math.ceil(sum[SERVICES[1].id] / 1000);
  md.push('## 수집 시간', '',
    '| | 호출 수 | 1초 간격 |', '|---|---:|---:|',
    `| 목록 (pSize=1000) | ${pages}회 | ${Math.round(pages / 60)}분 |`,
    `| 표결 (BILL_ID 필수, 법안당 1회) | ${bills.toLocaleString()}회 | ${(bills / 3600).toFixed(1)}시간 |`, '',
    '표결은 BILL_ID 가 필수라 법안당 한 번씩 불러야 한다.',
    '요청 제한 횟수는 "제한없음" 으로 명시돼 있다.', '',
    '**단, 표결은 20대부터만 제공된다.** 19대 이전은 이 API 로 못 얻는다.', '');

  if (errs.length) {
    md.push('## 못 센 것', '', '이건 0 이 아니라 **모름** 이다.', '');
    errs.forEach(e => md.push(`- ${e}`));
    md.push('');
  }

  fs.mkdirSync(OUT.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(OUT, md.join('\n'));

  console.log(`\n발의법률안 합계 ${bills.toLocaleString()}건 · 본회의 처리 ${sum[SERVICES[1].id].toLocaleString()}건`);
  console.log(`못 센 칸 ${unknown} / ${cells}개`);
  console.log(`  ${OUT}`);

  /* 절반 넘게 못 셌으면 실패다. 조용히 통과시키지 않는다. */
  if (unknown > cells / 2) { console.error('\n절반 넘게 못 셌습니다. 결과를 믿지 마세요.'); process.exit(4) }
}

main().catch(e => { console.error('\n' + e.stack); process.exit(1) });
