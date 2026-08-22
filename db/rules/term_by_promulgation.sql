-- term_by_promulgation · role=term · reads: bill, president_term
--
-- 규칙 3. "재임 중" ≠ "밀어붙임".
-- 이 규칙이 읽는 표는 bill 과 president_term 둘뿐이다.
-- bill_proposer 도 member 도 읽지 않는다. 그런 경로를 아예 두지 않는다.
-- 발의자에서 대통령을 끌어오는 순간 "OO 정부 때 통과된 법" 이
-- "OO 가 밀어붙인 법" 으로 자동 변환된다.
--
-- 입력은 공포일(announce_dt) 하나뿐이다. 발의일도 처리일도 쓰지 않는다.
INSERT OR IGNORE INTO link (from_id, to_id, role, rule, why, evidence, built_at)
SELECT
  t.president,
  b.bill_id,
  'term',
  'term_by_promulgation',
  '왜 이어졌나 · 공포일 ' || b.announce_dt || ' 이 ' || t.president || ' 재임 중 · 밀어붙였다는 뜻이 아니다',
  t.src,
  :now
FROM bill b
JOIN president_term t
  ON b.announce_dt >= t.from_dt
 AND b.announce_dt <= t.to_dt
WHERE b.announce_dt IS NOT NULL;
