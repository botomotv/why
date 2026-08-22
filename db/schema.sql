-- 왜(why-map.com) 창고 스키마
-- 설계 근거는 docs/창고설계.md 에 있다. 여기엔 "왜 이렇게 생겼는지"만 짧게 적는다.
--
-- 층은 셋이다.
--   원본층  raw_fetch · raw_row       받은 그대로. 절대 고치지 않는다
--   가공층  member · bill · ...        언제든 DROP 하고 원본층에서 다시 만든다
--   관계층  link                        선마다 어느 규칙이 만들었는지 남는다

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ══════════════════════════════════════════════════════════
-- 원본층 — 절대 고치지 않는다
-- ══════════════════════════════════════════════════════════

-- 한 번의 API 호출. 무엇을 언제 어떤 파라미터로 불렀는가.
CREATE TABLE IF NOT EXISTS raw_fetch (
  id          INTEGER PRIMARY KEY,
  service     TEXT    NOT NULL,
  params      TEXT    NOT NULL,   -- 키 정렬한 JSON. 같은 호출을 두 번 저장하지 않으려고
  fetched_at  TEXT    NOT NULL,
  status      INTEGER,
  code        TEXT,               -- INFO-000 / ERROR-300 / ERROR-310
  total       INTEGER,            -- list_total_count
  row_count   INTEGER,
  body        BLOB    NOT NULL    -- 응답 원문(gzip). 지우지 않는다
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_fetch_key ON raw_fetch(service, params);

-- 응답에서 뽑은 행 하나. 여전히 원본 JSON 그대로다.
CREATE TABLE IF NOT EXISTS raw_row (
  id        INTEGER PRIMARY KEY,
  fetch_id  INTEGER NOT NULL REFERENCES raw_fetch(id),
  service   TEXT    NOT NULL,
  natural_k TEXT    NOT NULL,     -- 서비스별 자연키 (BILL_ID · NAAS_CD · BILL_ID:MONA_CD)
  row_json  TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS raw_row_key ON raw_row(service, natural_k);

-- ══════════════════════════════════════════════════════════
-- 가공층 — 매퍼가 만든다. 사람이 손으로 넣는 값은 없다
-- ══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS member (
  cd        TEXT PRIMARY KEY,     -- NAAS_CD. 유일한 조인 키
  nm        TEXT NOT NULL,        -- 표시용. 조인에 쓰지 않는다 (동명이인)
  nm_hanja  TEXT,
  party     TEXT,                 -- 현재 정당 (PLPT_NM 의 마지막 조각)
  party_all TEXT,                 -- PLPT_NM 원문. 정당 이력
  eraco     TEXT,
  district  TEXT,
  cmit      TEXT,
  pic_url   TEXT,
  src_row   INTEGER REFERENCES raw_row(id)
);

CREATE TABLE IF NOT EXISTS bill (
  bill_id     TEXT PRIMARY KEY,
  bill_no     TEXT,
  nm          TEXT NOT NULL,
  age         INTEGER NOT NULL,
  committee   TEXT,
  propose_dt  TEXT,
  proc_dt     TEXT,
  proc_result TEXT,
  announce_dt TEXT,               -- 공포일. 규칙 3(대통령)의 유일한 입력
  detail_url  TEXT,
  src_row     INTEGER REFERENCES raw_row(id)
);
CREATE INDEX IF NOT EXISTS bill_age      ON bill(age);
CREATE INDEX IF NOT EXISTS bill_announce ON bill(announce_dt);

-- 대표발의(rst)와 공동발의(publ)를 종류로 나눈다.
-- PUBL_MONA_CD 는 쉼표로 붙어 오는데, 저장할 때 쪼갠다.
-- 문자열째 두면 LIKE '%코드%' 로 조회하게 되고 그건 틀린 결과를 낸다.
CREATE TABLE IF NOT EXISTS bill_proposer (
  bill_id   TEXT    NOT NULL REFERENCES bill(bill_id),
  member_cd TEXT    NOT NULL,
  member_nm TEXT,                 -- 검증·표시용. 조인에 쓰지 않는다
  kind      TEXT    NOT NULL CHECK (kind IN ('rst','publ')),
  ord       INTEGER,
  PRIMARY KEY (bill_id, member_cd)
);
CREATE INDEX IF NOT EXISTS bp_member ON bill_proposer(member_cd, kind);

CREATE TABLE IF NOT EXISTS vote_tally (
  bill_id  TEXT PRIMARY KEY REFERENCES bill(bill_id),
  total    INTEGER, yes INTEGER, no INTEGER, blank INTEGER,
  proc_dt  TEXT,
  src_row  INTEGER REFERENCES raw_row(id)
);

-- 개인별 표결.
-- party 를 여기 따로 저장한다. member.party 에서 끌어오면
-- 탈당한 의원의 과거 표결이 현재 당의 표결로 바뀐다. 그건 사실 왜곡이다.
-- API 응답에 POLY_NM(그 시점 정당)이 들어있으므로 계산하지 않고 그대로 담는다.
CREATE TABLE IF NOT EXISTS vote_member (
  bill_id   TEXT NOT NULL,
  member_cd TEXT NOT NULL,        -- MONA_CD
  member_nm TEXT,
  result    TEXT NOT NULL,        -- RESULT_VOTE_MOD
  party     TEXT,                 -- POLY_NM. 표결 당시 정당
  vote_date TEXT,
  age       INTEGER,
  src_row   INTEGER REFERENCES raw_row(id),
  PRIMARY KEY (bill_id, member_cd)
);
CREATE INDEX IF NOT EXISTS vm_member ON vote_member(member_cd);

-- 정당 → 진영. 코드에 박지 않고 표로 둔다. 근거(src)를 반드시 적는다.
CREATE TABLE IF NOT EXISTS party_side (
  party TEXT PRIMARY KEY,
  side  TEXT NOT NULL CHECK (side IN ('blue','red','gov','gold')),
  src   TEXT NOT NULL
);

-- 대통령 재임표. 규칙 3 이 읽는 유일한 표.
CREATE TABLE IF NOT EXISTS president_term (
  president TEXT PRIMARY KEY,
  from_dt   TEXT NOT NULL,
  to_dt     TEXT NOT NULL,
  src       TEXT NOT NULL
);

-- 매퍼가 만든 값을 사람이 덮어써야 할 때만 쓴다.
-- 가공층에 직접 손대지 않기 위한 자리다. 매퍼가 마지막에 이걸 덮는다.
CREATE TABLE IF NOT EXISTS override (
  tbl    TEXT NOT NULL,
  key    TEXT NOT NULL,
  col    TEXT NOT NULL,
  val    TEXT,
  why    TEXT NOT NULL,
  PRIMARY KEY (tbl, key, col)
);

-- ══════════════════════════════════════════════════════════
-- 관계층 — 선마다 어느 규칙이 만들었는지 남는다
-- ══════════════════════════════════════════════════════════

-- reads: 이 규칙이 읽어도 되는 테이블 목록(쉼표).
-- term_by_promulgation 은 bill,president_term 뿐이다.
-- 발의자·소관부처에서 대통령을 끌어오는 경로를 아예 두지 않기 위한 선언이다.
CREATE TABLE IF NOT EXISTS rule (
  name  TEXT PRIMARY KEY,
  role  TEXT NOT NULL CHECK (role IN ('push','block','topic','term','rel')),
  reads TEXT NOT NULL,
  note  TEXT NOT NULL
);

-- rule 이 NOT NULL 인 게 핵심이다.
-- 잘못 이어진 선을 발견하면 그 규칙이 만든 선을 한 번에 지울 수 있다.
--   DELETE FROM link WHERE rule = 'topic_by_committee_and_year';
-- why 도 NOT NULL 이다. 근거를 못 대는 선은 주장이지 기록이 아니다.
CREATE TABLE IF NOT EXISTS link (
  id       INTEGER PRIMARY KEY,
  from_id  TEXT NOT NULL,
  to_id    TEXT NOT NULL,
  role     TEXT NOT NULL CHECK (role IN ('push','block','topic','term','rel')),
  rule     TEXT NOT NULL REFERENCES rule(name),
  why      TEXT NOT NULL,
  evidence TEXT,
  built_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS link_key  ON link(from_id, to_id, role, rule);
CREATE INDEX        IF NOT EXISTS link_rule ON link(rule);

-- 지도에 내보낼 것 — 관계가 붙은 것만.
-- 수집한 전부를 지도에 넣지 않는다. 빠진 건수는 화면에 밝힌다.
CREATE VIEW IF NOT EXISTS map_bill AS
SELECT b.* FROM bill b
WHERE EXISTS (SELECT 1 FROM link l WHERE l.from_id = b.bill_id OR l.to_id = b.bill_id);
