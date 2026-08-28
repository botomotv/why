/* 헌재 결정의 **결론**을 결정요지의 마지막 문장에서 찾는다.
 *
 *   node tools/detc-verdict.mjs --dry
 *
 * ── 왜 이게 필요한가 ──
 *   삼각형(헌재 결정)을 눌러도 "헌법재판소 결정입니다. 사건번호는 …입니다" 뿐이었다.
 *   **왜 지도에 있는지 모르는 노드**다. 사람들이 궁금한 것은 셋이다:
 *     ① 무엇을 위헌/합헌이라고 했나  ② 그래서 그 법이 어떻게 됐나  ③ 언제
 *
 * ── 법제처 응답에 무엇이 있고 없나 (실측) ──
 *   있다: 사건번호 · 사건명 · 종국일자(③) · 심판대상조문(96.8%) · 판시사항 · 결정요지
 *   **없다: 주문(결론).** 【주 문】은 `전문` 에만 있고 거기엔 당사자·대리인 실명이 있다 —
 *          규칙 8 때문에 안 받는다.
 *   **없다: 그 뒤 법이 어떻게 됐나(②).** 위헌 결정 후 개정 여부를 알려주는 필드가 없다.
 *
 * ── 그래서 결정요지의 **마지막 문장**을 본다 ──
 *   본문 전체에서 '위헌' 을 찾으면 참조판례 인용에 걸린다 (전체 22.8% 가 잡히는데 오염됐다).
 *   결론은 요지의 끝에 온다 — "…이 사건 심판청구를 각하한다", "…헌법에 위반되지 않는 것이다".
 *
 * ── **애매하면 안 잡는다** ──
 *   "위배된다고 볼 수 없다"(합헌)를 "위배된다"(위헌)로 뒤집는 것이 최악이다.
 *   그래서 부정 표현을 **먼저** 보고, 명시적인 말만 잡는다.
 *   못 잡은 것은 결론을 비워 둔다 — 틀린 결론을 보여주느니 안 보여주는 게 낫다.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');

/* 순서가 중요하다 — **부정 표현을 먼저 본다.** */
export const VERDICT = [
  { k: '합헌', re: /헌법에\s*위반되지\s*(아니한다|않는다|않는 것이다)|위반된다고\s*볼\s*수\s*없|위배된다고\s*볼\s*수\s*없|합헌으로\s*결정/ },
  { k: '헌법불합치', re: /헌법불합치/ },
  { k: '각하', re: /각하한다/ },
  { k: '기각', re: /기각한다/ },
  { k: '위헌', re: /헌법에\s*위반된다|위헌임을\s*확인한다|위헌으로\s*결정|위헌이다/ },
];

/* 요지의 마지막 두 문장. 결론은 거기에 온다. */
export function tailOf(summary) {
  const t = String(summary || '').trim();
  if (!t) return '';
  const sents = t.split(/(?<=다\.)\s*/).filter(Boolean);
  return sents.slice(-2).join(' ');
}
export function verdictOf(summary) {
  const tail = tailOf(summary);
  if (!tail) return null;
  for (const v of VERDICT) if (v.re.test(tail)) return v.k;
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db.prepare("SELECT case_sn, summary, arts FROM case_detail WHERE kind='detc'").all();
  const cnt = {}, hit = [];
  for (const r of rows) {
    const v = verdictOf(r.summary);
    if (v) { cnt[v] = (cnt[v] || 0) + 1; hit.push(r) }
  }
  const n = hit.length;
  console.log(`헌재 상세 ${rows.length}건`);
  console.log(`  결론을 찾은 것 ${n}건 (${(n / rows.length * 100).toFixed(1)}%) — ${JSON.stringify(cnt)}`);
  console.log(`  못 찾은 ${rows.length - n}건은 **결론을 비운다.** 틀린 결론보다 없는 결론이 낫다`);
  const withArts = hit.filter(r => r.arts && r.arts.length > 5).length;
  console.log(`  그중 심판대상조문까지 있는 것 ${withArts}건 — "어느 법의 어느 조문을 어떻게 판단했나" 가 완성된다\n`);
  console.log('  표본 6개:');
  hit.slice(0, 6).forEach(r => console.log(`   [${verdictOf(r.summary)}] …${tailOf(r.summary).slice(-90)}`));
  db.close();
}
