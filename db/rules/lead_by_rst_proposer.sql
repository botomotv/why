-- lead_by_rst_proposer · role=push · reads: bill, bill_proposer
--
-- 대표발의자 → 법안. 공식 기록이라 그대로 쓴다.
-- 공동발의(kind='publ')는 선을 만들지 않는다. 법안 하나에 10개씩 붙어 상한 6개를 바로 넘긴다.
-- 공동발의는 창고에 그대로 있고 카드에 숫자로 뜬다. docs/창고설계.md 5장.
INSERT OR IGNORE INTO link (from_id, to_id, role, rule, why, evidence, built_at)
SELECT
  p.member_cd,
  b.bill_id,
  'push',
  'lead_by_rst_proposer',
  '왜 이어졌나 · 대표발의 · ' || COALESCE(b.propose_dt, '날짜 확인 중'),
  b.detail_url,
  :now
FROM bill_proposer p
JOIN bill b ON b.bill_id = p.bill_id
WHERE p.kind = 'rst';
