-- 규칙 목록. reads 가 그 규칙이 읽어도 되는 표다.
-- 검사 B 가 .sql 원문을 읽어 이 목록 밖의 표가 나오면 FAIL 시킨다.
INSERT OR REPLACE INTO rule (name, role, reads, note) VALUES
 ('lead_by_rst_proposer','push','bill,bill_proposer',
  '대표발의자 → 법안. 공동발의는 선을 만들지 않는다'),
 ('term_by_promulgation','term','bill,president_term',
  '공포일 x 재임표만. 발의자·소관부처를 읽지 않는다 (규칙 3)'),
 ('topic_by_committee_and_year','topic','bill,cat_committee',
  '관문 3개 — 분야(소관위 대응표) x 공포 ±3년 x 법안명 핵심어. 인과가 아니라 같은 주제·같은 시기다');

-- 사건 규칙. reads 는 그 규칙이 읽어도 되는 표다 (검사 B 가 원문을 훑는다).
INSERT OR REPLACE INTO rule (name, role, reads, note) VALUES
 ('case_by_law_name', 'topic', 'court_case,bill',
  '사건 이름에 법 이름이 그대로 있으면 그 법률에 잇는다. 재판부가 스스로 그 법을 적은 것이라 3관문보다 센 근거다'),
 ('case_by_keyword_and_year', 'topic', 'court_case,cat_committee',
  '사건 이름에 결과의 핵심어가 있고 시기가 ±3년이면 그 결과에 잇는다. 같은 주제·같은 시기라는 뜻이지 인과가 아니다');
