/* 핵심어가 공포 법안 이름에 몇 건 걸리나 센다.
 *
 *   node tools/key-count.mjs 고용 산재 교통사고
 *
 * **핵심어를 넣기 전에 반드시 이걸 돌린다.**
 *   · 3건 미만  → 죽은 핵심어. pick-index.mjs 가 거부한다
 *   · 수백 건   → 너무 넓다. 무관한 법을 끌어온다 (「외국」 300건대로 뇌물방지법이 딸려 온 적이 있다)
 *   · 10~80건   → 대체로 좋다
 *
 * 발의자 괄호는 뗀다 — 「병역법 일부개정법률안(장병완의원 등 32인)」의 '장병' 같은
 * 사람 이름에 걸리는 것을 막는다.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db'), { readOnly: true });
const bills = db.prepare(
  `SELECT json_extract(row_json,'$.BILL_NM') nm FROM raw_row WHERE service='nwbpacrgavhjryiph'`)
  .all().map(r => String(r.nm || '').replace(/\([^)]*\)/g, ''));
const words = process.argv.slice(2);
for (const w of words) {
  const hit = bills.filter(b => b.includes(w));
  const sample = [...new Set(hit)].slice(0, 3).map(s => s.trim().slice(0, 34));
  const mark = hit.length < 3 ? '죽음' : hit.length > 200 ? '너무넓다' : hit.length > 80 ? '넓다' : 'OK';
  console.log(`${w.padEnd(12)} ${String(hit.length).padStart(5)}건  ${mark.padEnd(8)} ${sample.join(' · ')}`);
}
