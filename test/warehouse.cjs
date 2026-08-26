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

      /* ── 표결(MONA_CD) ──
         RST_MONA_CD 는 전량에서 확정됐지만 MONA_CD 는 따로 확인해야 한다.
         쉼표로 여러 명이 오지 않는다 — 표결은 한 행이 한 사람이다.
         0 건이어도 분모를 같이 낸다. 0 은 '문제 없음' 과 '안 보고 있음' 을 구별하지 않는다. */
      const vRows = rows(
        `SELECT json_extract(row_json,'$.MONA_CD') cd,
                json_extract(row_json,'$.HG_NM')   nm
         FROM raw_row WHERE service='nojepdqqaweusdfbi'`) || [];
      if (!vRows.length) {
        NOTE('E · 표결이 창고에 없다 — MONA_CD 를 대조하지 못했다');
      } else {
        const vCds = new Set(vRows.map(r => r.cd).filter(Boolean));
        const vMiss = [...vCds].filter(cd => cd !== NOCODE && !known.has(cd));
        const vNoCode = vRows.filter(r => !r.cd || r.cd === NOCODE).length;
        NOTE(`E · MONA_CD 미매칭 ${vMiss.length} / 서로 다른 코드 ${vCds.size}개 (표결 ${vRows.length}행 · 의원명부 ${known.size}명)`);
        if (vNoCode) NOTE(`E · 표결에 코드 없음 ${vNoCode}행`);
        if (vMiss.length)
          FAIL(`E · 표결 코드 ${vMiss.length}건이 의원 명부에 없다 (예: ${vMiss.slice(0,3).join(', ')})`);
      }

      /* ── 가공층이 원본과 같은가 ──
         **party 는 계산하면 안 된다.** member.party 에서 끌어오면 탈당한 의원의
         과거 표결이 현재 당의 표결로 바뀐다. POLY_NM 을 그대로 담았는지 대조한다.
         스키마 주석에 써 놨다고 지켜지는 게 아니다 — 값을 맞대 본다. */
      if (has('vote_member')) {
        const vm = rows(`SELECT COUNT(*) n FROM vote_member`);
        const vmN = vm ? vm[0].n : 0;
        if (!vmN) {
          NOTE('E · vote_member 가 비어 있다 — 매퍼를 아직 안 돌렸다 (npm run map)');
        } else {
          const rawN = (rows(`SELECT COUNT(*) n FROM raw_row WHERE service='nojepdqqaweusdfbi'`) || [{n:0}])[0].n;
          NOTE(`E · vote_member ${vmN}행 / 원본 표결 ${rawN}행`);

          /* 원본과 값이 다른 행. 하나라도 있으면 매퍼가 무언가를 '계산' 한 것이다. */
          const bad = rows(`
            SELECT COUNT(*) n FROM vote_member v
            JOIN raw_row r ON r.id = v.src_row
            WHERE json_extract(r.row_json,'$.POLY_NM')         IS NOT v.party
               OR json_extract(r.row_json,'$.RESULT_VOTE_MOD') IS NOT v.result
               OR json_extract(r.row_json,'$.MONA_CD')         IS NOT v.member_cd`) || [{n:-1}];
          if (bad[0].n === -1) NOTE('E · 가공층↔원본 대조를 못 했다 (src_row 가 없다)');
          else if (bad[0].n > 0)
            FAIL(`E · vote_member ${bad[0].n}행이 원본과 다르다. party·result·member_cd 는 계산하지 말고 그대로 담아야 한다`);
          else NOTE(`E · vote_member 의 party·result·member_cd 가 원본과 전부 일치 (대조 ${vmN}행)`);

          /* src_row 를 안 채우면 위 대조가 통째로 조용해진다 — 그 자체가 FAIL 이다 */
          const orphan = (rows(`SELECT COUNT(*) n FROM vote_member WHERE src_row IS NULL`) || [{n:0}])[0].n;
          if (orphan) FAIL(`E · vote_member ${orphan}행에 src_row 가 없다. 원본과 대조할 길이 사라진다`);
        }
      }

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

/* ── F · 3관문 핵심어가 실제 법안명에 있는 말인가 ──
   핵심어는 **우리의 편집 판단**이고 화면의 "왜 이어졌나" 한 줄에 그대로 나간다.
   그런데 머리로 지어낸 말은 법안명에 안 나온다 — 처음 넣은 71개 중 11개가 그랬다.
   ('영주권' '방첩' '육아' '모성' '의과대학' '양도소득' … 전부 0건)
   죽은 핵심어는 **조용히 아무것도 안 잇는다.** 3관문이 일하는 것처럼 보이는데
   그 노드만 후보가 0이 된다. 0 은 '없다' 와 '안 보고 있다' 를 구별하지 않는다.

   법안명은 본회의 처리(nwbpacrgavhjryiph)의 BILL_NM 을 쓴다.
   공포일(ANNOUNCE_DT)이 있는 것만 — 2관문이 쓰는 것과 같은 집합이어야 한다. */
{
  const WH = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const nodes = [...html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?keys:\[([^\]]*)\]/g)]
    .map(m => ({ id: m[1], keys: m[2].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean) }));
  const withKeys = nodes.filter(n => n.keys.length);
  const resultN = (html.match(/t:'result'/g) || []).length;

  /* 핵심어가 **빈** 노드는 잘못이 아니다 — 주제를 가리키는 말이 법안명에 없을 수 있다
     (방첩사·GOP 경계병력이 그렇다). 다만 **화면에 그렇다고 밝혀야 한다.**
     말없이 비우면 "이을 게 없었다" 와 "우리가 안 이었다" 가 구별되지 않는다. */
  const empty = nodes.filter(n => !n.keys.length);
  if (!withKeys.length)
    FAIL(`F · 결과 노드 ${resultN}개 전부 핵심어가 비었다. 3관문이 아무것도 못 거른다`);
  if (empty.length && !/자동으로 이을 근거를 못 찾았습니다/.test(html))
    FAIL(`F · 핵심어가 빈 결과 노드 ${empty.length}개(${empty.map(n => n.id).join(', ')})인데 화면에 그렇다고 밝히는 문구가 없다`);
  if (empty.length && !/function keyNote\(/.test(html))
    FAIL('F · keyNote 가 없다 — 빈 핵심어를 화면에 밝히는 길이 없다');

  if (!fs.existsSync(WH)) {
    NOTE('F · 창고가 없어 핵심어를 법안명과 대조하지 못했다');
  } else if (withKeys.length) {
    const w = new DatabaseSync(WH, { readOnly: true });
    let names = [];
    try {
      /* **발의자 괄호를 떼고 대조한다.** BILL_NM 은 '병역법 일부개정법률안(장병완의원 등 32인)'
         꼴이라, 괄호를 안 떼면 핵심어 '장병' 이 사람 이름 '장병완' 에 걸린다 —
         실제로 13건이 전부 그 오탐이었고, 떼니 0건이 됐다.
         3관문 구현도 반드시 같은 전처리를 해야 한다. 안 하면 사람 이름으로 법을 잇는다. */
      names = w.prepare(
        `SELECT json_extract(row_json,'$.BILL_NM') nm FROM raw_row
          WHERE service='nwbpacrgavhjryiph'
            AND json_extract(row_json,'$.ANNOUNCE_DT') IS NOT NULL
            AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`)
        .all().map(r => String(r.nm || '').replace(/\([^)]*\)/g, '').trim());
    } catch { names = [] }
    w.close();

    if (!names.length) {
      NOTE('F · 공포된 법안명이 창고에 없다 — 대조 못 함 (본회의 처리를 먼저 수집한다)');
    } else {
      const dead = [], all = [];
      for (const n of withKeys) for (const k of n.keys) {
        const c = names.filter(x => x.includes(k)).length;
        all.push(c);
        if (!c) dead.push(`${n.id}:'${k}'`);
      }
      /* 노드마다 살아 있는 핵심어가 하나는 있어야 한다 — 다 죽으면 그 노드는 못 잇는다 */
      const mute = withKeys.filter(n => n.keys.every(k => !names.some(x => x.includes(k))));
      NOTE(`F · 핵심어 ${all.length}개 / 핵심어 있는 결과 노드 ${withKeys.length}개 · 비운 노드 ${empty.length}개(${empty.map(n => n.id).join(',') || '-'}) · 공포된 법안명 ${names.length}건과 대조 (발의자 괄호 제거)`);
      if (dead.length)
        FAIL(`F · 법안명에 하나도 없는 핵심어 ${dead.length}개 — 조용히 아무것도 안 잇는다 (${dead.slice(0, 5).join(', ')})`);
      if (mute.length)
        FAIL(`F · 핵심어가 전부 죽은 결과 노드 ${mute.length}개 (${mute.map(n => n.id).join(', ')}) — 3관문에서 후보 0`);
      const broad = withKeys.flatMap(n => n.keys.map(k => ({ id: n.id, k, c: names.filter(x => x.includes(k)).length })))
        .filter(x => x.c > 200);
      if (broad.length)
        WARN(`F · 너무 넓은 핵심어 ${broad.length}개 — 3관문이 거의 안 거른다 (${broad.map(x => `${x.id}:'${x.k}' ${x.c}건`).join(', ')})`);
    }
  }
}


/* ── G · 문서에 적은 API 필드가 어느 표의 것인지 밝혀져 있는가 ──
   `ANNOUNCE_DT`(공포일)를 발의법률안에 있는 줄 알고 2관문·규칙 3 을 설계했다.
   실제로는 본회의 처리 표에 있었다. **문서가 필드 이름만 적었기 때문이다.**
   구현 직전에야 알았고, 그때 설계가 통째로 흔들렸다.

   같은 사고가 또 날 자리가 세 쌍 더 있다 — 같은 뜻인데 표마다 이름이 다르다:
     법안 이름 BILL_NAME(발의) / BILL_NM(본회의)
     소관위    COMMITTEE(발의)  / COMMITTEE_NM(본회의)
     처리 결과 PROC_RESULT(발의)/ PROC_RESULT_CD(본회의)

   그래서 강제한다: **문서에 나오는 API 필드 이름은 출처 표에 있어야 한다.**
   출처 표 자체는 창고의 실제 응답에서 뽑은 것이라 문서가 지어낼 수 없다. */
{
  const WH = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
  const DOCS = path.join(ROOT, 'docs');
  const tableDoc = path.join(DOCS, '창고설계.md');

  if (!fs.existsSync(tableDoc)) {
    FAIL('G · docs/창고설계.md 이 없다 — 필드 출처 표가 사라졌다');
  } else {
    const txt = fs.readFileSync(tableDoc, 'utf8');
    const m = txt.match(/<!-- FIELD-SOURCE-TABLE-START -->([\s\S]*?)<!-- FIELD-SOURCE-TABLE-END -->/);
    if (!m) {
      FAIL('G · 필드 출처 표를 못 찾았다 (FIELD-SOURCE-TABLE 표시)');
    } else {
      const listed = new Set([...m[1].matchAll(/`([A-Z][A-Z0-9_]{3,})`/g)].map(x => x[1]));

      /* 표가 실제 응답과 맞는가 — 창고가 있을 때만. 표만 보고 통과시키면 표가 거짓말할 수 있다. */
      if (fs.existsSync(WH)) {
        const w = new DatabaseSync(WH, { readOnly: true });
        const SERV = { nzmimeepazxkubdpn: '발의법률안', nwbpacrgavhjryiph: '본회의 처리',
                       nojepdqqaweusdfbi: '개인별 표결', ALLNAMEMBER: '의원 명부' };
        const real = new Set();
        for (const svc of Object.keys(SERV)) {
          let r = null;
          try { r = w.prepare(`SELECT row_json FROM raw_row WHERE service=? LIMIT 1`).get(svc) } catch { }
          if (r) for (const k of Object.keys(JSON.parse(r.row_json))) real.add(k);
        }
        w.close();
        if (real.size) {
          /* 표에 있는데 응답에 없는 필드 — 'BILLRSNRAW' 처럼 못 받는다고 적은 것은 예외 */
          const ghost = [...listed].filter(k => !real.has(k) && !/어느 표에도 없음/.test(
            (m[1].split('\n').find(l => l.includes('`' + k + '`')) || '')));
          if (ghost.length)
            FAIL(`G · 출처 표에 있는데 실제 응답에 없는 필드 ${ghost.length}개 (${ghost.slice(0, 5).join(', ')})`);
          NOTE(`G · 출처 표 ${listed.size}개 필드 / 실제 응답 ${real.size}개 필드와 대조`);
        }
      }

      /* 문서 어딘가에 나오는 필드 이름이 표에 없으면 FAIL */
      const SKIP = new Set(['UNKNOWN', 'ASSEMBLY_KEY', 'COLLECT_AGE', 'COLLECT_STEP', 'COLLECT_DB',
        'COLLECT_PAGE', 'PROBE_GAP', 'WAREHOUSE_DB', 'ASSEMBLY_GAP', 'KOSIS', 'LAW_OC', 'OPENSRVAPI',
        'ALLBILL', 'VCONFBILLLIST', 'INF_ID', 'LICENSE', 'DISTINCT', 'DELETE', 'EXISTS', 'ISO8601',
        'KOSIS_KEY', 'KOSIS_GAP', 'LAW_OC', 'LAW_GAP', 'GATE_WIDE', 'GATE_YEARS', 'AUTOCAT', 'SIDEN', 'KINDN', 'LABEL_FAR', 'LABEL_PX', 'LABEL_FONT_PX', 'FIT_MIN', 'NARROW_W',
        'NARROW_MIN_S', 'RESULT_W', 'GAP_MS', 'VOTE_MIN_AGE', 'FAN_FEW', 'FAN_EASE', 'MAX_EDGES',
        'TERM_CAP', 'VOTE_OPEN_YEAR', 'ALLNAMEMBER']);
      /* 밑줄이 있는 대문자 = API 필드꼴. 다만 **값**은 뺀다 —
         BILL_ID 값이 'PRC_V2Z4S0…' 꼴이라 필드 이름으로 오인된다.
         값은 (1) PRC_ 로 시작하거나 (2) 24자를 넘는다. 필드 이름은 그렇게 길지 않다. */
      const isCode = k => /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(k)
        && k.length <= 24 && !/^PRC_/.test(k);
      const missing = new Map();
      for (const f of fs.readdirSync(DOCS).filter(x => x.endsWith('.md'))) {
        const body = fs.readFileSync(path.join(DOCS, f), 'utf8')
          .replace(/<!-- FIELD-SOURCE-TABLE-START -->[\s\S]*?<!-- FIELD-SOURCE-TABLE-END -->/, '');
        for (const mm of body.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) {
          const k = mm[1];
          if (SKIP.has(k) || listed.has(k) || !isCode(k)) continue;
          if (!missing.has(k)) missing.set(k, f);
        }
      }
      NOTE(`G · 문서의 API 필드 ${listed.size}개가 출처 표에 있다 · 표 밖 ${missing.size}개`);
      if (missing.size)
        FAIL(`G · 어느 표의 필드인지 안 밝힌 이름 ${missing.size}개 — ` +
          [...missing].slice(0, 6).map(([k, f]) => `${k}(${f})`).join(', ') +
          '. 필드를 문서에 적을 때는 어느 서비스·어느 표인지 같이 적는다');
    }
  }
}


/* ── H · 세 관문을 통과하는 것이 0건인 결과 노드 ──
   결과가 있는데 아무것도 안 붙는 상태다. 그 노드는 눌러도 볼 게 없다.
   **r2 가 실제로 그랬다** — 분야가 잘못 달려 0건이었고, 화면에는 아무 표시도 없었다.

   r3(방첩사)·q5(GOP 경계병력)는 **일부러 비운 것이다.** 그 일이 법률이 아니라
   대통령령·기본계획으로 이뤄져 법안명에 흔적이 없다. 화면에 그렇게 밝힌다(검사 F).
   그래서 예외로 두되 **이름을 박아 둔다** — 예외가 늘어나면 그때 다시 본다. */
{
  const WH = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
  const EXPECTED_EMPTY = { r3: '방첩사 개편은 대통령령(직제)이라 법안명에 흔적이 없다',
                           q5: 'GOP 경계병력 감축은 국방개혁 기본계획이라 법령이 아니다' };
  if (!fs.existsSync(WH)) {
    NOTE('H · 창고가 없어 관문 통과 수를 못 셌다');
  } else {
    const w = new DatabaseSync(WH, { readOnly: true });
    const has = n => w.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name=?`).get(n).n > 0;
    if (!has('cat_committee')) { NOTE('H · cat_committee 가 아직 없다 — 1관문을 못 잰다'); w.close(); }
    else {
      const cc = {};
      for (const r of w.prepare('SELECT cat, committee FROM cat_committee').all())
        (cc[r.cat] = cc[r.cat] || new Set()).add(r.committee);
      const bills = w.prepare(
        `SELECT json_extract(row_json,'$.BILL_NM') nm, json_extract(row_json,'$.ANNOUNCE_DT') dt,
                json_extract(row_json,'$.COMMITTEE_NM') cm
           FROM raw_row WHERE service='nwbpacrgavhjryiph'
            AND json_extract(row_json,'$.ANNOUNCE_DT') IS NOT NULL
            AND json_extract(row_json,'$.ANNOUNCE_DT')<>''`).all()
        .map(r => ({ nm: String(r.nm || '').replace(/\([^)]*\)/g, '').trim(),
                     y: +String(r.dt).slice(0, 4), cm: r.cm || '' }));
      w.close();

      if (!bills.length) NOTE('H · 공포된 법안이 창고에 없다 — 관문을 못 잰다');
      else {
        const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        /* 분야는 CATMAP 에서, 핵심어·연도는 노드에서 읽는다. 여기서 베껴 쓰지 않는다. */
        const cm = html.match(/var CATMAP\s*=\s*\{([\s\S]*?)\n\};/);
        const catOf = {};
        if (cm) for (const g of cm[1].matchAll(/['"]?([\w]+)['"]?\s*:\s*\[([^\]]*)\]/g))
          for (const id of g[2].split(',').map(x => x.replace(/['\s]/g, '')).filter(Boolean))
            (catOf[id] = catOf[id] || []).push(g[1]);

        const nodes = [...html.matchAll(/\{id:'([^']+)',t:'result'[\s\S]{0,400}?yr:'(\d{4})',keys:\[([^\]]*)\]/g)]
          .map(m => ({ id: m[1], yr: +m[2],
                       keys: m[3].split(',').map(x => x.replace(/'/g, '').trim()).filter(Boolean) }));

        const zero = [], counts = [];
        for (const nd of nodes) {
          const cs = new Set();
          for (const c of (catOf[nd.id] || [])) for (const x of (cc[c] || [])) cs.add(x);
          const n = nd.keys.length ? bills.filter(b =>
            cs.has(b.cm) && Math.abs(b.y - nd.yr) <= 3 && nd.keys.some(k => b.nm.includes(k))).length : 0;
          counts.push(n);
          if (!n) zero.push(nd.id);
        }
        const sum = counts.reduce((a, b) => a + b, 0);
        const unexpected = zero.filter(id => !(id in EXPECTED_EMPTY));
        const expected = zero.filter(id => id in EXPECTED_EMPTY);
        NOTE(`H · 세 관문 통과 ${sum}건 / 결과 노드 ${nodes.length}개 · 0건 ${zero.length}개` +
             (expected.length ? ` (예상된 것 ${expected.join(',')})` : ''));
        if (unexpected.length)
          WARN(`H · 관문 통과가 0건인 결과 노드 ${unexpected.length}개: ${unexpected.join(', ')} — ` +
               '결과가 있는데 아무것도 안 붙는다. 분야가 잘못 달렸거나 핵심어가 주제를 못 가리킨다');
        /* 예외로 적어 뒀는데 실제로는 0 이 아니게 됐다면 예외를 지워야 한다 */
        const revived = Object.keys(EXPECTED_EMPTY).filter(id => !zero.includes(id));
        if (revived.length)
          WARN(`H · ${revived.join(', ')} 가 이제 0건이 아니다 — 예외 목록에서 빼라`);
        if (!nodes.length) FAIL('H · 결과 노드를 하나도 못 읽었다 — 검사가 아무것도 안 보고 있다');
      }
    }
  }
}

console.log('\n창고 검사 A~H');
notes.forEach(n => console.log('  · ' + n));
if (warns.length) { console.log('\nWARN'); warns.forEach(w => console.log('  ! ' + w)) }
if (fails.length) { console.log('\nFAIL'); fails.forEach(f => console.log('  x ' + f)) }
console.log(`\n결과: ${fails.length ? 'FAIL' : 'PASS'}  (FAIL ${fails.length} · WARN ${warns.length})`);
process.exit(fails.length ? 1 : 0);
