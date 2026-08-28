/* 지표누리 통계표가 **아직 살아 있는지** 확인해서 창고에 적는다.
 *
 *   node tools/index-alive.mjs
 *
 * ── 왜 필요한가 ──
 *   AJAX(IndexTblGraphAjax.do)는 **폐지된 통계표의 값도 그대로 준다.**
 *   그런데 그 지표의 페이지를 열면 "서비스가 중지된 통계표입니다" 가 뜬다.
 *   실측: 자살률(8040) · 청년실업률(5028) · 최저임금비율(5037) · 가계부채(5024) ·
 *   인구천명당병상수(1433) 가 전부 중지된 통계표였다. 값은 받아지는데 출처가 죽는다.
 *
 *   **그 값을 지도에 올리면 규칙 7(모든 노드에 출처)이 겉으로만 지켜진다.**
 *   출처 링크를 눌렀는데 "중지되었습니다" 가 나오면 출처가 없는 것과 같다.
 *   그래서 살아있는 것만 결과 노드가 될 수 있게 표시한다.
 *
 *   값 자체는 국가승인통계 공표값이라 틀린 게 아니다. 다만 **우리가 그 출처를
 *   보여줄 수 없다.** 보여줄 수 없는 것은 안 올린다.
 */
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.WAREHOUSE_DB || path.join(ROOT, 'db', 'warehouse.db');
const GAP = Number(process.env.IDX_GAP || 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const db = new DatabaseSync(DB);
db.exec(`CREATE TABLE IF NOT EXISTS stat_alive (
  tbl_id  TEXT PRIMARY KEY,     -- 지표누리 idx_cd
  alive   INTEGER NOT NULL,     -- 1 = 페이지가 살아 있다 · 0 = "서비스가 중지된 통계표"
  checked TEXT NOT NULL
)`);

const ids = db.prepare(`SELECT DISTINCT tbl_id FROM stat_table WHERE org_id='INDEX' ORDER BY CAST(tbl_id AS INTEGER)`).all().map(r => r.tbl_id);
const done = new Set(db.prepare('SELECT tbl_id FROM stat_alive').all().map(r => r.tbl_id));
const todo = ids.filter(x => !done.has(x));
console.log(`지표 ${ids.length}개 · 이미 확인 ${done.size}개 · 이번에 ${todo.length}개`);

const ins = db.prepare('INSERT OR REPLACE INTO stat_alive (tbl_id,alive,checked) VALUES (?,?,?)');
const NOW = new Date().toISOString().slice(0, 10);
let alive = 0, dead = 0, err = 0;
db.exec('BEGIN');
for (let i = 0; i < todo.length; i++) {
  const id = todo[i];
  let ok = null;
  for (let t = 0; t < 2 && ok === null; t++) {
    try {
      const r = await fetch(`https://www.index.go.kr/unity/potal/main/EachDtlPageDetail.do?idx_cd=${id}`,
        { headers: { 'User-Agent': 'why-map/1.0 (+https://why-map.com)' } });
      const t2 = await r.text();
      /* 중지된 통계표는 이 문구를 **서버가** 내려준다. 화면 렌더를 기다릴 필요가 없다. */
      ok = /서비스가 중지된 통계표/.test(t2) ? 0 : 1;
    } catch (e) { await sleep(400) }
  }
  if (ok === null) { err++; await sleep(GAP); continue }
  ins.run(id, ok, NOW);
  ok ? alive++ : dead++;
  if (i % 40 === 0) { db.exec('COMMIT'); db.exec('BEGIN'); process.stdout.write(`\r  ${i}/${todo.length} · 살아있음 ${alive} · 중지 ${dead} · 못 물음 ${err}   `) }
  await sleep(GAP);
}
db.exec('COMMIT');
console.log(`\n\n  살아있음 ${alive} · 중지된 통계표 ${dead} · 못 물어본 것 ${err}`);
const tot = db.prepare('SELECT alive, count(*) c FROM stat_alive GROUP BY alive').all();
console.log('  창고 전체:', JSON.stringify(tot));
db.close();
