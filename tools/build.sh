#!/bin/sh
# 결과 노드를 넣거나 고친 뒤 **이 순서로** 돌린다.
#
#   sh tools/build.sh
#
# 순서가 곧 의존이다 — 한 번 꼬여서 결과 노드 40개가 통째로 고립됐다.
#   pick-index   결과 노드를 index.html 에 쓴다 (AUTO-KOSIS)
#   link         그 결과에 법을 잇는다 (AUTO-N · AUTO-L) — **결과가 먼저 있어야 한다**
#   link-case    그 법에 판례·헌재를 잇는다 (AUTO-CASE-*) — **법이 먼저 있어야 한다**
#   link-after   사건 → 법 → 결과 「그 뒤에」 (AUTO-AFTER-*) — **법이 먼저 있어야 한다**
#   result-easy  결과 카드의 쉬운 설명 (AUTO-REZ)
#   node-url     근거 링크
#   result-roster 결과 명부 (검사 61 이 대조한다)
set -e
cd "$(dirname "$0")/.."
node tools/pick-index.mjs

# ── link → name-explain → link 를 **두 번** 돈다 ──
# link.mjs 는 한 줄 설명이 없는 법의 노드를 안 만들고 이름만 law_need_tip.json 에 남긴다.
# name-explain.mjs 가 그 파일을 읽어 이름을 풀어 준다.
# 그런데 그 결과로 노드가 생기면 **또 다른 법이 새로 목록에 오른다** — 한 번으로는 안 끝난다.
# 실제로 첫 바퀴에 6개를 풀었더니 다른 6개가 새로 나왔다.
node tools/link.mjs
# 새로 붙은 법의 한 줄 설명을 법제처에서 받는다 (없으면 노드가 안 만들어진다)
node tools/collect-missing.mjs
node tools/name-explain.mjs
node tools/link.mjs
node tools/collect-missing.mjs
node tools/name-explain.mjs
node tools/link.mjs
node tools/name-explain.mjs
node tools/link.mjs

node tools/link-case.mjs
# ── 「그 뒤에」 — 사건 → 법 → 결과 ──
# **법 노드가 확정된 뒤에 돌린다.** 이 도구는 지도에 이미 있는 법을 찾아 잇고,
# 없으면 새로 만든다. link.mjs 보다 먼저 돌리면 법 id 가 바뀌어 선이 끊긴다.
# 확정 판결의 형량 — 사람이 db/crime_cases.json 에 사건번호를 넣으면 주문에서 형량만 뽑는다.
# **link-after 보다 먼저** 돌린다: link-after 가 그 값을 사건 노드에 얹기 때문이다.
node tools/sentence.mjs || echo '  (형량 건너뜀 — 사건번호가 없거나 창고에 판례가 없다)'
node tools/link-after.mjs
node tools/result-easy.mjs 2>/dev/null || echo '  (result-easy 건너뜀)'
node tools/node-url.mjs
node tools/hand-law-url.mjs
node tools/result-roster.mjs
echo
echo '다음: node tools/link-check.mjs (링크 전수) → npm test'
