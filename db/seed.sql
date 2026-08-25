-- 규칙 목록. reads 가 그 규칙이 읽어도 되는 표다.
-- 검사 B 가 .sql 원문을 읽어 이 목록 밖의 표가 나오면 FAIL 시킨다.
INSERT OR REPLACE INTO rule (name, role, reads, note) VALUES
 ('lead_by_rst_proposer','push','bill,bill_proposer',
  '대표발의자 → 법안. 공동발의는 선을 만들지 않는다'),
 ('term_by_promulgation','term','bill,president_term',
  '공포일 x 재임표만. 발의자·소관부처를 읽지 않는다 (규칙 3)'),
 ('topic_by_committee_and_year','topic','bill,cat_committee',
  '관문 3개 — 분야(소관위 대응표) x 공포 ±3년 x 법안명 핵심어. 인과가 아니라 같은 주제·같은 시기다');
