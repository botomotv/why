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
INSERT OR REPLACE INTO rule (name, role, reads, note) VALUES
 ('case_by_reviewed_article', 'topic', 'court_case,case_detail,bill',
  '심판대상조문(헌재)·참조조문(법원)이 가리키는 법에 잇는다. 재판부가 스스로 그 조문을 적은 것이라 세 관문 중 가장 센 근거다');

-- ── 「그 뒤에」 규칙 셋 ──
-- 「같은 주제」는 옆에 나란히 있다는 뜻이지 이어졌다는 뜻이 아니다.
-- 이건 다르다 — 사건이 먼저 있었고 **그 뒤에** 이 법이 생겼다.
-- 근거는 우리가 만든 것이 아니다: 법 이름이나 법제처 제·개정이유에 그 사건이 적혀 있다.
-- **그래도 인과를 단정하지 않는다 (규칙 4).** 「때문에」가 아니라 「그 뒤에」다.
INSERT OR REPLACE INTO rule(name,role,reads,note) VALUES
 ('law_named_after_event','after','raw_row',
  '법 이름에 그 사건이 들어 있다 — 국회가 그렇게 이름 붙였다. 「4·16세월호참사 피해구제 및 지원 등을 위한 특별법」'),
 ('law_reason_names_event','after','law_reason',
  '법제처 제·개정이유에 그 사건이 적혀 있다 — 정부가 스스로 적었다. 「중대재해 처벌 등에 관한 법률」 제정이유의 「태안화력발전소 압사사고」'),
 ('result_after_law','after','stat_value',
  '그 법이 공포된 뒤 이 결과 숫자가 어떻게 됐나. 값은 창고에서 그대로 옮긴다. 이 법 때문이라는 뜻은 아니다');
