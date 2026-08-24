/* 매퍼 — 원본층(raw_row) → 가공층(vote_member).
 *
 * 원본층은 절대 고치지 않는다. 가공층은 **언제든 지우고 다시 만든다.**
 * 그래서 이 스크립트는 매번 vote_member 를 비우고 새로 채운다.
 * 되돌릴 수 없는 계산을 여기서 하지 않는다 — 원본이 남아 있으므로 언제든 다시 만든다.
 *
 *   node tools/map.mjs            표결을 옮긴다
 *   node tools/map.mjs --dry      쓰지 않고 세기만 한다
 *
 * 규칙:
 *  1. POLY_NM(표결 당시 정당)을 **그대로** 담는다. member.party 에서 끌어오지 않는다.
 *     탈당하면 과거 표결이 현재 당의 표결로 바뀐다. 그건 사실 왜곡이다.
 *  2. 건너뛴 행은 **세어서 밝힌다.** 말없이 빼면 "이게 전부" 라는 거짓말이 된다.
 *  3. 사람이 손으로 넣는 값은 없다. 전부 원본층에서 온다.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const DRY = process.argv.includes('--dry');
const VOTE = 'nojepdqqaweusdfbi';

if (!fs.existsSync(DB)) { console.error(`창고가 없다: ${DB}`); process.exit(1) }

const db = new DatabaseSync(DB);
db.exec('PRAGMA journal_mode=WAL');
db.exec(fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

const one = s => db.prepare(s).get();
const all = s => db.prepare(s).all();

/* 표결 날짜: '20241114 143336' → '2024-11-14'.
   시각은 버린다. 지도가 쓰는 단위가 날짜이고, 시각까지 두면
   같은 날 표결이 서로 다른 값으로 보인다. 원본은 raw_row 에 그대로 남는다. */
const ymd = v => {
  const s = String(v || '').trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const rawN = one(`SELECT COUNT(*) n FROM raw_row WHERE service='${VOTE}'`).n;
if (!rawN) {
  console.error('원본층에 표결이 없다. 먼저 수집해라: COLLECT_STEP=4 npm run collect');
  process.exit(1);
}

console.log(`창고 ${DB}`);
console.log(`원본 표결 행 ${rawN.toLocaleString()}건${DRY ? ' (--dry · 쓰지 않는다)' : ''}\n`);

/* 의원 명부. 코드 체계가 같은지 여기서도 본다 — 검사 E 와 같은 질문이지만
   매퍼가 먼저 만난다. 모르는 코드를 조용히 넣지 않는다. */
const known = new Set(all(`SELECT DISTINCT natural_k k FROM raw_row WHERE service='ALLNAMEMBER'`).map(r => r.k));

const rows = all(
  `SELECT id, natural_k,
          json_extract(row_json,'$.BILL_ID')         bill_id,
          json_extract(row_json,'$.MONA_CD')         cd,
          json_extract(row_json,'$.HG_NM')           nm,
          json_extract(row_json,'$.RESULT_VOTE_MOD') result,
          json_extract(row_json,'$.POLY_NM')         party,
          json_extract(row_json,'$.VOTE_DATE')       vdate,
          CAST(json_extract(row_json,'$.AGE') AS INTEGER) age
   FROM raw_row WHERE service='${VOTE}'`);

/* 버리는 것과 세기만 하는 것을 나눈다.
   party·날짜가 비어도 표결 자체는 사실이므로 담는다 — 다만 몇 건인지 밝힌다. */
const drop = { 법안없음: 0, 코드없음: 0, 명부에없음: 0, 결과없음: 0, 중복키: 0 };
const note = { 정당없음: 0, 날짜없음: 0 };
const keep = [];
const seen = new Set();

for (const r of rows) {
  if (!r.bill_id) { drop.법안없음++; continue }
  if (!r.cd || r.cd === 'UNKNOWN') { drop.코드없음++; continue }
  if (!known.has(r.cd)) { drop.명부에없음++; continue }
  if (!r.result) { drop.결과없음++; continue }
  const k = r.bill_id + ' ' + r.cd;
  if (seen.has(k)) { drop.중복키++; continue }
  seen.add(k);
  if (!r.party) note.정당없음++;
  const d = ymd(r.vdate);
  if (!d) note.날짜없음++;
  keep.push([r.bill_id, r.cd, r.nm, r.result, r.party, d, r.age, r.id]);
}

const dropped = Object.values(drop).reduce((a, b) => a + b, 0);
console.log('버린 행 (0 이 아니면 이유를 안다):');
for (const [k, v] of Object.entries(drop)) console.log(`  ${k.padEnd(10)} ${v}`);
console.log('담되 비어 있는 칸:');
for (const [k, v] of Object.entries(note)) console.log(`  ${k.padEnd(10)} ${v}`);
console.log(`\n담을 행 ${keep.length.toLocaleString()} / 원본 ${rawN.toLocaleString()} (버린 것 ${dropped})\n`);

if (DRY) { db.close(); process.exit(0) }

db.exec('BEGIN');
try {
  db.exec('DELETE FROM vote_member');
  const ins = db.prepare(
    `INSERT INTO vote_member (bill_id, member_cd, member_nm, result, party, vote_date, age, src_row)
     VALUES (?,?,?,?,?,?,?,?)`);
  for (const v of keep) ins.run(...v);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e }

const n = one('SELECT COUNT(*) n FROM vote_member').n;
console.log(`vote_member ${n.toLocaleString()}건`);
console.log('법안 ' + one('SELECT COUNT(DISTINCT bill_id) n FROM vote_member').n +
            ' · 의원 ' + one('SELECT COUNT(DISTINCT member_cd) n FROM vote_member').n +
            ' · 대수 ' + all('SELECT DISTINCT age FROM vote_member ORDER BY age').map(r => r.age).join(','));
console.log('\n결과별');
for (const r of all('SELECT result, COUNT(*) n FROM vote_member GROUP BY result ORDER BY n DESC'))
  console.log(`  ${String(r.result).padEnd(6)} ${r.n.toLocaleString()}`);
console.log('\n표결 당시 정당별 (member.party 가 아니라 POLY_NM 그대로)');
for (const r of all('SELECT party, COUNT(*) n FROM vote_member GROUP BY party ORDER BY n DESC'))
  console.log(`  ${String(r.party ?? '(없음)').padEnd(12)} ${r.n.toLocaleString()}`);
db.close();
console.log('\n다음: npm test 로 검사 E 가 MONA_CD 미매칭을 세게 한다');
