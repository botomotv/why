#!/usr/bin/env node
/**
 * 창고 검사 A~E — 규칙 3 을 스키마와 검사로 강제한다.
 *
 * 규칙이 프롬프트에만 있으면 샌다. 여기서 막는다.
 *
 *   A · role='term' 인 선은 rule='term_by_promulgation' 만 만들 수 있다
 *   B · 규칙 .sql 원문에 rule.reads 밖의 표가 나오면 FAIL
 *   C · role='term' 인 선을 재계산해서 공포일이 재임 구간 밖이면 FAIL
 *   D · 실패 주입 — 발의자에서 대통령을 끌어오는 가짜 규칙을 넣고
 *       B 가 실제로 FAIL 하는지 본다
 *
 * D 를 빼지 않는다. 아무것도 안 잡는 검사는 언제나 PASS 라서 가장 오래 산다.
 * 이 프로젝트에서 그런 검사가 이미 두 번 나왔다 (CLAUDE.md 6·7번).
 *
 * 창고 파일이 없어도 돈다 — 임시 창고를 만들어 규칙 자체를 검사한다.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const RULES = path.join(ROOT, 'db', 'rules');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
const SEED = fs.readFileSync(path.join(ROOT, 'db', 'seed.sql'), 'utf8');

const fails = [], warns = [], notes = [];
const FAIL = m => fails.push(m);
const WARN = m => warns.push(m);
const NOTE = m => notes.push(m);

/* 스키마에 선언된 표 이름 전부. B 가 이 목록으로 SQL 원문을 훑는다. */
const TABLES = [...SCHEMA.matchAll(/CREATE (?:TABLE|VIEW) IF NOT EXISTS (\w+)/g)].map(m => m[1]);

function freshDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA.replace(/PRAGMA journal_mode = WAL;/, ''));
  db.exec(SEED);
  return db;
}

/* ── SQL 원문에서 실제로 읽는 표를 뽑는다 ──
   주석은 먼저 지운다. 주석 안의 표 이름을 세면 검사가 헛것을 잡는다.
   (CLAUDE.md 7번 — 주석이 셀렉터 머리에 붙어 중복을 하나도 못 잡았던 사고와 같은 종류다) */
function tablesRead(sql) {
  const bare = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const from = new Set();
  for (const m of bare.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)) from.add(m[1]);
  return [...from].filter(t => TABLES.includes(t));
}
function tableWritten(sql) {
  const bare = sql.replace(/--[^\n]*/g, ' ');
  const m = bare.match(/INSERT(?:\s+OR\s+\w+)?\s+INTO\s+(\w+)/i);
  return m ? m[1] : null;
}

/* ── 검사 B 본체. D 가 이걸 그대로 다시 부른다 ── */
function checkReads(rules, ruleSql) {
  const bad = [];
  for (const [name, sql] of Object.entries(ruleSql)) {
    const r = rules[name];
    if (!r) { bad.push(`규칙 ${name}.sql 이 rule 표에 없다`); continue }
    const allowed = new Set(r.reads.split(',').map(s => s.trim()));
    const wrote = tableWritten(sql);
    for (const t of tablesRead(sql)) {
      if (t === wrote) continue;
      if (!allowed.has(t)) bad.push(`규칙 ${name} 이 허용 안 된 표 '${t}' 를 읽는다 (reads: ${r.reads})`);
    }
  }
  return bad;
}

/* ══════════════════════════════════════════════ */
const db = freshDb();
const rules = Object.fromEntries(db.prepare('SELECT * FROM rule').all().map(r => [r.name, r]));
const ruleSql = {};
for (const f of fs.readdirSync(RULES).filter(f => f.endsWith('.sql')))
  ruleSql[f.replace(/\.sql$/, '')] = fs.readFileSync(path.join(RULES, f), 'utf8');

NOTE(`규칙 ${Object.keys(ruleSql).length}개 · 표 ${TABLES.length}개`);

/* ── A · term 은 term_by_promulgation 만 ── */
{
  const termRules = Object.values(rules).filter(r => r.role === 'term').map(r => r.name);
  if (termRules.length !== 1 || termRules[0] !== 'term_by_promulgation')
    FAIL(`A · role='term' 규칙은 term_by_promulgation 하나여야 한다. 지금 ${termRules.length}개: ${termRules.join(', ') || '없음'}`);
  else NOTE(`A · term 규칙 1개 (term_by_promulgation) — 통과`);

  /* 스키마 수준에서도 막혀 있어야 한다: link.rule 이 NOT NULL 이고 rule 을 참조하는가 */
  if (!/rule\s+TEXT NOT NULL REFERENCES rule\(name\)/.test(SCHEMA))
    FAIL('A · link.rule 이 NOT NULL REFERENCES rule(name) 이 아니다 — 규칙 없는 선이 들어갈 수 있다');
  if (!/why\s+TEXT NOT NULL/.test(SCHEMA))
    FAIL('A · link.why 가 NOT NULL 이 아니다 — 근거 없는 선이 들어갈 수 있다');
}

/* ── B · 규칙이 읽어도 되는 표만 읽는가 ── */
{
  const bad = checkReads(rules, ruleSql);
  bad.forEach(b => FAIL('B · ' + b));
  const checked = Object.keys(ruleSql).length;
  NOTE(`B · 위반 ${bad.length} / 검사한 규칙 ${checked}개`);
  if (!checked) FAIL('B · 검사한 규칙이 0개다 — db/rules/ 가 비었다면 이 검사는 아무것도 안 잡는다');

  /* 규칙 3 을 이름으로 한 번 더 못 박는다 */
  const t = ruleSql['term_by_promulgation'] || '';
  for (const forbidden of ['bill_proposer', 'member', 'vote_member'])
    if (tablesRead(t).includes(forbidden))
      FAIL(`B · term_by_promulgation 이 '${forbidden}' 를 읽는다 — 대통령을 발의자에서 끌어오는 경로다 (규칙 3)`);
  if (!/announce_dt/.test(t))
    FAIL('B · term_by_promulgation 이 공포일(announce_dt)을 안 쓴다 — 규칙 3 의 유일한 입력이다');
  for (const wrong of ['propose_dt', 'proc_dt'])
    if (new RegExp(`b\\.${wrong}`).test(t.replace(/--[^\n]*/g, '')))
      FAIL(`B · term_by_promulgation 이 ${wrong} 을 쓴다 — 공포일만 써야 한다`);
}

/* ── C · term 선을 실제로 만들어 재임 구간 안에 있는지 ── */
{
  const now = '2026-01-01T00:00:00Z';
  db.exec(`
    INSERT INTO president_term VALUES
      ('갑','2017-05-10','2022-05-09','재임표'),
      ('을','2022-05-10','2027-05-09','재임표');
    INSERT INTO bill (bill_id,nm,age,announce_dt) VALUES
      ('B1','구간 안',21,'2020-06-01'),
      ('B2','경계 첫날',21,'2022-05-10'),
      ('B3','공포 안 됨',21,NULL);
  `);
  db.prepare(ruleSql['term_by_promulgation'].replace(/--[^\n]*/g, '')).run({ now });

  const rows = db.prepare(`
    SELECT l.from_id p, l.to_id b, bi.announce_dt d, t.from_dt f, t.to_dt e
    FROM link l JOIN bill bi ON bi.bill_id=l.to_id
    JOIN president_term t ON t.president=l.from_id
    WHERE l.role='term'`).all();

  let out = 0;
  for (const r of rows) if (!(r.d >= r.f && r.d <= r.e)) { out++; FAIL(`C · ${r.b} 공포일 ${r.d} 가 ${r.p} 재임(${r.f}~${r.e}) 밖이다`) }

  const noDate = db.prepare(`SELECT COUNT(*) n FROM link WHERE role='term' AND to_id='B3'`).get().n;
  if (noDate) FAIL(`C · 공포일 없는 법안(B3)에 term 선이 ${noDate}개 붙었다`);
  if (rows.length !== 2) FAIL(`C · term 선이 2개여야 하는데 ${rows.length}개다 (경계 첫날 포함 여부 확인)`);
  NOTE(`C · 구간 밖 ${out} / 검사한 term 선 ${rows.length}개`);
}

/* ── D · 실패 주입. B 가 진짜로 잡는지 ── */
{
  const 가짜 = `
    -- 발의자에서 대통령을 끌어오는 가짜 규칙. 검사 B 가 이걸 잡아야 한다.
    INSERT INTO link (from_id,to_id,role,rule,why,built_at)
    SELECT m.nm, b.bill_id, 'term', 'term_by_promulgation', '재임 중', :now
    FROM bill b JOIN bill_proposer p ON p.bill_id=b.bill_id
                JOIN member m ON m.cd=p.member_cd;`;
  const 잡힘 = checkReads(rules, { term_by_promulgation: 가짜 });

  if (!잡힘.length)
    FAIL('D · 발의자에서 대통령을 끌어오는 가짜 규칙을 B 가 못 잡았다. 검사 B 는 아무것도 안 잡고 있다');
  else
    NOTE(`D · 실패 주입 ${잡힘.length}건 잡음 — B 가 살아 있다 (${잡힘[0].slice(0, 46)}…)`);

  /* 두 번째 주입: 규칙 표에 없는 선을 넣으려 하면 스키마가 막는가 */
  let 막힘 = false;
  try {
    db.prepare(`INSERT INTO link (from_id,to_id,role,rule,why,built_at)
                VALUES ('x','y','term','아무거나','',?)`).run('2026-01-01');
  } catch { 막힘 = true }
  if (!막힘) FAIL('D · rule 표에 없는 규칙 이름으로 선이 들어갔다 — 외래키가 안 걸려 있다');
  else NOTE('D · 등록 안 된 규칙으로는 선이 안 들어감 — 통과');

  /* 세 번째 주입: why 없이 선을 넣을 수 있는가 */
  let 막힘2 = false;
  try {
    db.prepare(`INSERT INTO link (from_id,to_id,role,rule,built_at)
                VALUES ('x','y','term','term_by_promulgation',?)`).run('2026-01-01');
  } catch { 막힘2 = true }
  if (!막힘2) FAIL('D · 근거(why) 없이 선이 들어갔다');
  else NOTE('D · 근거 없는 선은 안 들어감 — 통과');
}

db.close();

/* ── E · 코드 체계 대조 — 실제 창고가 있을 때만 ──
   NAAS_CD(의원명부) · RST_MONA_CD(발의) · MONA_CD(표결) 가 정말 같은 체계인가.
   probe 표본에서 T2T8225E(강경숙) 한 쌍이 맞았지만 확인된 건 1쌍뿐이다.
   전량 수집 뒤 여기서 분모와 함께 다시 센다.

   창고가 없으면 "안 봤다" 라고 말한다. 조용히 통과시키지 않는다 —
   0건은 '문제 없음' 과 '안 보고 있음' 을 구별하지 않는다. */
{
  /* 경로를 열어 둔다. 작은 가짜 창고로 실패를 주입해 봐야 이 검사를 믿을 수 있다. */
  const WH = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
  if (!fs.existsSync(WH)) {
    NOTE('E · 창고가 아직 없어 코드 체계를 대조하지 못했다 (db/warehouse.db). 수집 후 다시 돌린다');
  } else {
    const w = new DatabaseSync(WH, { readOnly: true });
    const has = n => w.prepare(
      `SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?`).get(n).n > 0;
    const rows = s => { try { return w.prepare(s).all() } catch { return null } };

    const mem = has('raw_row') ? rows(
      `SELECT DISTINCT natural_k k FROM raw_row WHERE service='ALLNAMEMBER'`) : null;
    if (!mem || !mem.length) {
      NOTE('E · 의원 명부가 창고에 없다 — 대조 못 함');
    } else {
      const known = new Set(mem.map(r => r.k));

      /* ── 발의(RST_MONA_CD) ──
         쉼표로 여러 명이 온다. 공동대표발의가 실재한다 (2명 166건 · 3명 45건).
         쪼개지 않으면 'UOS16250,51A45980' 이 통째로 한 코드로 잡혀
         미매칭 288건이 유령으로 뜬다 — 실제로 그렇게 떴다.
         PUBL_MONA_CD 는 쪼개기로 해놓고 RST_ 에는 같은 생각을 안 했다.

         'UNKNOWN' 은 코드가 아니라 '코드 없음' 표시다. 매칭 대상이 아니다.
         예외로 숨기지 않고 몇 건인지 세어서 남긴다. */
      const split = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
      const NOCODE = 'UNKNOWN';

      const bills = rows(
        `SELECT json_extract(row_json,'$.RST_MONA_CD') cd,
                json_extract(row_json,'$.RST_PROPOSER') nm,
                CAST(json_extract(row_json,'$.AGE') AS INT) age
         FROM raw_row WHERE service='nzmimeepazxkubdpn'`) || [];

      let pairs = 0, noCode = 0, bMiss = [], billNoProposer = 0;
      const noCodeAge = {};
      for (const b of bills) {
        const cds = split(b.cd);
        if (!cds.length) { billNoProposer++; continue }
        let anyReal = false;
        for (const cd of cds) {
          pairs++;
          if (cd === NOCODE) { noCode++; noCodeAge[b.age] = (noCodeAge[b.age] || 0) + 1; continue }
          anyReal = true;
          if (!known.has(cd)) bMiss.push(`${cd} ${b.nm || ''}`);
        }
        if (!anyReal) billNoProposer++;
      }

      NOTE(`E · RST_MONA_CD 미매칭 ${bMiss.length} / 대조 ${pairs - noCode}개 (법안 ${bills.length}건 · 의원명부 ${known.size}명)`);

      /* 코드 없음은 사실로 기록한다. 조용히 빼면 나중에 또 만난다. */
      if (noCode) {
        const ages = Object.keys(noCodeAge).map(Number).sort((a, b) => a - b);
        NOTE(`E · 코드 없음('${NOCODE}') ${noCode}건 — 제${ages[0]}~${ages[ages.length-1]}대에만 있다. 그 시절 데이터에 의원 고유코드가 없다`);
        NOTE(`E · 그래서 발의자를 못 붙이는 법안 ${billNoProposer}건 / ${bills.length}건 — 지도에 이 숫자를 밝힌다`);
      }
      if (bMiss.length)
        FAIL(`E · 발의자 코드 ${bMiss.length}건이 의원 명부에 없다 (예: ${bMiss.slice(0,3).join(', ')})`);

      /* 이름은 같은데 코드가 다른 사람 — 동명이인이 실제로 있다는 증거 */
      const dup = rows(
        `SELECT json_extract(row_json,'$.NAAS_NM') nm, COUNT(DISTINCT natural_k) n
         FROM raw_row WHERE service='ALLNAMEMBER' GROUP BY nm HAVING n>1`) || [];
      NOTE(`E · 동명이인 ${dup.length}명${dup.length ? ' (예: ' + dup.slice(0,3).map(r=>r.nm+' '+r.n+'명').join(', ') + ')' : ''} — 이름 조인을 두지 않는 이유`);
    }
    w.close();
  }
}

/* ══════════════════════════════════════════════ */
console.log('\n창고 검사 A~E');
notes.forEach(n => console.log('  · ' + n));
if (warns.length) { console.log('\nWARN'); warns.forEach(w => console.log('  ! ' + w)) }
if (fails.length) { console.log('\nFAIL'); fails.forEach(f => console.log('  x ' + f)) }
console.log(`\n결과: ${fails.length ? 'FAIL' : 'PASS'}  (FAIL ${fails.length} · WARN ${warns.length})`);
process.exit(fails.length ? 1 : 0);
