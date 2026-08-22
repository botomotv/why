#!/usr/bin/env node
/**
 * 수집기 — 원본층(raw_fetch · raw_row)만 채운다.
 *
 * 매퍼는 여기 없다. 원본이 남아 있으면 가공층은 언제든 다시 만들 수 있다.
 * 반대는 안 된다 — 매퍼가 틀린 걸 나중에 발견했을 때
 * 원본이 없으면 API 를 처음부터 다시 긁어야 한다.
 *
 * 순서가 중요하다. 표결은 BILL_ID 가 필수라서
 * 발의법률안을 먼저 받아 BILL_ID 목록을 확보한 뒤에만 부를 수 있다.
 *
 *   1. 의원 명부        ALLNAMEMBER          파라미터 없음
 *   2. 발의법률안       nzmimeepazxkubdpn    AGE      ← BILL_ID 가 여기서 나온다
 *   3. 본회의 처리      nwbpacrgavhjryiph    AGE
 *   4. 개인별 표결      nojepdqqaweusdfbi    BILL_ID + AGE   법안당 1회
 *
 * 중단해도 된다. 같은 (service, params) 는 건너뛴다.
 *
 * 실행
 *   read -s ASSEMBLY_KEY && export ASSEMBLY_KEY && node tools/collect.mjs
 *   COLLECT_AGE=22 COLLECT_STEP=1,2 node tools/collect.mjs      일부만
 */

import fs from 'node:fs';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { needKey, call, unpack, explain, paramKey, sleep, GAP_MS } from './lib/api.mjs';

const KEY  = needKey('tools/collect.mjs');
const DB   = process.env.COLLECT_DB || 'db/warehouse.db';
const AGES = (process.env.COLLECT_AGE || '22').split(',').map(Number);
const STEP = new Set((process.env.COLLECT_STEP || '1,2,3,4').split(','));
const PAGE = Number(process.env.COLLECT_PAGE || 1000);   // 열린국회정보 pSize 상한

/* 표결은 20대부터만 제공된다. 19대 이전은 이 API 로 못 얻는다. */
const VOTE_MIN_AGE = 20;

/* 서비스별 자연키. 이게 있어야 같은 행을 두 번 저장하지 않는다. */
const NATURAL = {
  ALLNAMEMBER:        r => r.NAAS_CD,
  nzmimeepazxkubdpn:  r => r.BILL_ID,
  nwbpacrgavhjryiph:  r => r.BILL_ID,
  nojepdqqaweusdfbi:  r => `${r.BILL_ID}:${r.MONA_CD}`,
};

/* ── 창고 열기 ── */
fs.mkdirSync(DB.replace(/\/[^/]+$/, ''), { recursive: true });
const db = new DatabaseSync(DB);
db.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));

const qFetchSeen = db.prepare('SELECT id,row_count,total FROM raw_fetch WHERE service=? AND params=?');
const qFetchIns  = db.prepare(`INSERT INTO raw_fetch
  (service,params,fetched_at,status,code,total,row_count,body) VALUES (?,?,?,?,?,?,?,?)`);
const qRowIns    = db.prepare(`INSERT OR IGNORE INTO raw_row
  (fetch_id,service,natural_k,row_json) VALUES (?,?,?,?)`);
const qBillIds   = db.prepare(
  `SELECT natural_k FROM raw_row WHERE service='nzmimeepazxkubdpn' ORDER BY natural_k`);
const qVoteDone  = db.prepare(
  `SELECT params FROM raw_fetch WHERE service='nojepdqqaweusdfbi'`);

let calls = 0, saved = 0, skipped = 0;
const WARNED = [];

/**
 * 한 번 부르고 원본층에 넣는다. 이미 있으면 안 부른다.
 * 반환: {rows, total, fresh}
 */
async function fetchOnce(service, params) {
  const pk = paramKey(params);
  const seen = qFetchSeen.get(service, pk);
  /* 이미 받은 쪽은 다시 부르지 않는다.
     행 수를 PAGE 로 가정하면 마지막 쪽에서 끝을 한 쪽 넘어간다 —
     재실행할 때마다 쓸데없는 호출이 나고 빈 응답이 창고에 쌓인다.
     그래서 저장해 둔 row_count 를 그대로 돌려준다. 재개가 정확해진다. */
  if (seen) { skipped++; return { count: seen.row_count, total: seen.total, fresh: false } }

  const r = await call(KEY, service, params);
  calls++;
  const u = unpack(r.json);

  /* 알 수 없는 실패면 멈춘다. 조용히 넘어가면 무엇이 빠졌는지 모른 채 끝난다. */
  const why = explain(u.code, u.msg);
  const empty = u.code === 'INFO-200';           // 데이터 없음. 정상이다
  if (!u.rows.length && !empty && why) {
    throw new Error(
      `${service} ${pk}\n  ${u.code} · ${why}\n  ${u.msg}\n\n` +
      `여기서 멈춥니다. 지금까지 받은 것은 ${DB} 에 남아 있고, 다시 실행하면 이어서 받습니다.`);
  }

  const fetchId = qFetchIns.run(service, pk, new Date().toISOString(),
    r.status, u.code || null, u.total, u.rows.length,
    zlib.gzipSync(Buffer.from(r.text))).lastInsertRowid;

  const key = NATURAL[service];
  for (const row of u.rows) {
    const nk = key(row);
    if (!nk) continue;                            // 자연키 없는 행은 넣지 않는다
    qRowIns.run(fetchId, service, String(nk), JSON.stringify(row));
  }
  saved += u.rows.length;
  await sleep(GAP_MS);
  return { count: u.rows.length, total: u.total, fresh: true };
}

/** 목록형: pIndex 를 끝까지 넘긴다. */
async function fetchAll(service, base, label) {
  let page = 1, total = null, got = 0;
  for (;;) {
    const r = await fetchOnce(service, { ...base, pIndex: String(page), pSize: String(PAGE) });
    if (total == null) total = r.total;
    got += r.count;
    process.stdout.write(`\r${label} ${page}쪽 … 누적 ${got}${total ? '/' + total : ''}      `);
    if (r.count < PAGE) break;                    // 마지막 쪽. 캐시된 쪽도 같은 기준으로 끝난다
    if (total != null && got >= total) break;
    if (page > 5000) { WARNED.push(`${label} 이 ${page}쪽에서 멈췄다 — 끝을 못 찾았다`); break }
    page++;
  }
  process.stdout.write('\n');
}

async function main() {
  console.log(`창고 ${DB} · 대수 ${AGES.join(',')} · 단계 ${[...STEP].join(',')}\n`);

  if (STEP.has('1')) await fetchAll('ALLNAMEMBER', {}, '1) 의원 명부');

  for (const age of AGES) {
    if (STEP.has('2')) await fetchAll('nzmimeepazxkubdpn', { AGE: String(age) }, `2) 발의법률안 제${age}대`);
    if (STEP.has('3')) await fetchAll('nwbpacrgavhjryiph', { AGE: String(age) }, `3) 본회의 처리 제${age}대`);
  }

  /* ── 4단계: 표결. BILL_ID 가 필수라 2단계 뒤에만 돌 수 있다 ── */
  if (STEP.has('4')) {
    const ages = AGES.filter(a => a >= VOTE_MIN_AGE);
    const skip = AGES.filter(a => a < VOTE_MIN_AGE);
    if (skip.length) console.log(`\n표결 건너뜀 · 제${skip.join(',')}대 — 20대부터만 제공된다`);

    if (ages.length) {
      const ids = qBillIds.all().map(r => r.natural_k);
      if (!ids.length) {
        console.error('\nBILL_ID 가 하나도 없습니다. 2단계를 먼저 돌려야 합니다.');
        process.exit(3);
      }
      const done = new Set(qVoteDone.all().map(r => JSON.parse(r.params).BILL_ID));
      const todo = ids.filter(id => !done.has(id));
      console.log(`\n4) 개인별 표결 · 법안 ${ids.length}건 중 ${todo.length}건 남음 (완료 ${done.size}건)`);

      for (let i = 0; i < todo.length; i++) {
        for (const age of ages) {
          await fetchOnce('nojepdqqaweusdfbi',
            { BILL_ID: todo[i], AGE: String(age), pIndex: '1', pSize: String(PAGE) });
        }
        if (i % 20 === 0 || i === todo.length - 1) {
          const pct = ((i + 1) / todo.length * 100).toFixed(1);
          const left = ((todo.length - i - 1) * GAP_MS * ages.length / 3600000).toFixed(1);
          process.stdout.write(`\r   ${i + 1}/${todo.length} (${pct}%) · 남은 시간 약 ${left}시간      `);
        }
      }
      process.stdout.write('\n');
    }
  }

  /* ── 무엇이 담겼나. 0 은 분모와 함께 낸다 ── */
  console.log(`\n호출 ${calls}회 · 건너뜀 ${skipped}회 · 새로 담은 행 ${saved}건\n`);
  const tally = db.prepare(
    `SELECT service, COUNT(*) n FROM raw_row GROUP BY service ORDER BY service`).all();
  const fetches = db.prepare(`SELECT COUNT(*) n FROM raw_fetch`).get().n;
  console.log(`창고 안 (호출 ${fetches}회분)`);
  for (const t of tally) console.log(`  ${t.service.padEnd(20)} ${String(t.n).padStart(8)}행`);
  if (!tally.length) { console.error('\n한 행도 안 담겼습니다.'); process.exit(4) }

  /* 실패로 남은 호출을 밝힌다. 말없이 두면 "이게 전부" 라는 거짓말이 된다. */
  if (WARNED.length) { console.log('\n주의'); WARNED.forEach(w => console.log('  ! ' + w)) }

  const bad = db.prepare(
    `SELECT code, COUNT(*) n FROM raw_fetch WHERE row_count=0 GROUP BY code`).all();
  if (bad.length) {
    console.log('\n행이 안 온 호출');
    for (const b of bad) console.log(`  ${(b.code || '(코드없음)').padEnd(20)} ${b.n}회  ${explain(b.code, '')}`);
  }
  db.close();
}

main().catch(e => { console.error('\n' + (e.message || e.stack)); process.exit(1) });
