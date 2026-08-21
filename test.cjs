/**
 * 왜(Why) — 점검 스크립트
 * 검사: 끊긴 링크 / 고립 노드 / 좌표 정상 / 정착 후 정지 / 겹침 /
 *       재임 관계 오분류 / 원인 없는 결과 노드 / 출처 / limit 칸 / 사진 라이선스
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const vc = new VirtualConsole();
const scriptErrors = [];
vc.on('jsdomError', e => scriptErrors.push(e.message));

const html = fs.readFileSync('./왜.html', 'utf8');
const VIEWPORTS = [[412, 915], [840, 1000], [1440, 900], [1920, 1080]];
const fails = [], warns = [], notes = [];
const F = (m) => fails.push(m);
const W = (m) => warns.push(m);

/* canvas 스텁 */
function stubCanvas(win) {
  const ctx = {
    canvas: null, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalAlpha: 1, textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    shadowBlur: 0, shadowColor: '',
    measureText: (t) => ({ width: String(t).length * 6.2 }),
    save(){},restore(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},
    arc(){},arcTo(){},bezierCurveTo(){},quadraticCurveTo(){},rect(){},
    fill(){},stroke(){},fillRect(){},clearRect(){},strokeRect(){},fillText(){},
    strokeText(){},translate(){},scale(){},rotate(){},setTransform(){},
    setLineDash(){},drawImage(){},clip(){},ellipse(){},
    createLinearGradient:()=>({addColorStop(){}}),
    createRadialGradient:()=>({addColorStop(){}})
  };
  win.HTMLCanvasElement.prototype.getContext = function(){ ctx.canvas=this; return ctx; };
}

function boot(w, h) {
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      try{ Object.defineProperty(win,'innerWidth',{value:w,configurable:true}); }catch(e){}
      try{ Object.defineProperty(win,'innerHeight',{value:h,configurable:true}); }catch(e){}
      try{ Object.defineProperty(win,'devicePixelRatio',{value:2,configurable:true}); }catch(e){}
      stubCanvas(win);
      win.Element.prototype.getBoundingClientRect = function () {
        return { x:0, y:0, top:0, left:0, right:w, bottom:h, width:w, height:h, toJSON(){} };
      };
      let raf = 0;
      win.requestAnimationFrame = (cb) => { if (raf++ < 900) return setTimeout(()=>cb(raf*16), 0); return 0; };
      win.cancelAnimationFrame = () => {};
    }
  });
  return dom;
}

(async () => {
  console.log('왜(Why) 점검 시작\n');

  /* ── 정적 검사: 데이터 무결성 (해상도 무관) ── */
  const dom0 = boot(1440, 900);
  await new Promise(r => setTimeout(r, 1500));
  const w0 = dom0.window;
  const N = w0.N, L = w0.L;
  if (!N || !L) { console.error('N/L 로드 실패 — 스크립트 에러 가능'); process.exit(1); }

  console.log(`노드 ${N.length} / 관계 ${L.length}\n`);
  const ids = new Set(N.map(n => n.id));

  // 1. 끊긴 링크
  let broken = 0;
  L.forEach((l, i) => {
    if (!ids.has(l[0])) { F(`끊긴 링크 #${i}: 출발 '${l[0]}' 없음`); broken++; }
    if (!ids.has(l[1])) { F(`끊긴 링크 #${i}: 도착 '${l[1]}' 없음`); broken++; }
  });
  console.log(`1. 끊긴 링크        ${broken === 0 ? 'PASS' : 'FAIL (' + broken + ')'}`);

  // 2. 고립 노드 (career 파생 노드는 owner로 붙으므로 제외)
  const deg = {}; N.forEach(n => deg[n.id] = 0);
  L.forEach(l => { if (deg[l[0]] !== undefined) deg[l[0]]++; if (deg[l[1]] !== undefined) deg[l[1]]++; });
  const iso = N.filter(n => deg[n.id] === 0 && !n.owner && !n.ghost);
  iso.forEach(n => F(`고립 노드: ${n.id} (${n.lab})`));
  const isoGhost = N.filter(n => deg[n.id] === 0 && (n.owner || n.ghost));
  console.log(`2. 고립 노드        ${iso.length === 0 ? 'PASS' : 'FAIL (' + iso.length + ')'}   [owner/ghost로 붙는 노드 ${isoGhost.length}개는 제외]`);

  // 3. 재임 관계가 밀어붙임(lead)으로 분류됐는지
  const TERMWORD = /재임|여당|집권|당시 대통령|이 시기/;
  let mis = 0;
  L.forEach((l, i) => {
    const label = String(l[2] || ''), sent = String(l[4] || '');
    const isTermish = TERMWORD.test(label) || TERMWORD.test(sent);
    if (isTermish && l[3] === 'lead') { F(`재임→밀어붙임 오분류 #${i}: ${l[0]}→${l[1]} "${label}"`); mis++; }
    if (isTermish && l[3] !== 'term') { W(`재임 표현인데 term 아님 #${i}: ${l[0]}→${l[1]} "${label}" role='${l[3]||'(빈값)'}'`); }
  });
  console.log(`3. 재임 오분류      ${mis === 0 ? 'PASS' : 'FAIL (' + mis + ')'}`);

  // 4. 원인 없는 결과 노드
  const results = N.filter(n => n.t === 'result');
  let noCause = 0;
  results.forEach(n => {
    const hasCause = L.some(l => l[1] === n.id && l[5]);
    if (!hasCause) { F(`원인 없는 결과 노드: ${n.id} (${n.lab})`); noCause++; }
  });
  console.log(`4. 원인없는 결과    ${noCause === 0 ? 'PASS' : 'FAIL (' + noCause + ')'}   [결과 노드 ${results.length}개]`);

  // 5. 출처 표기 (규칙 7)
  const noSrc = N.filter(n => !n.src && !n.ghost);
  noSrc.forEach(n => F(`출처 없음: ${n.id} (${n.lab})`));
  const noSrcGhost = N.filter(n => !n.src && n.ghost);
  console.log(`5. 출처 표기        ${noSrc.length === 0 ? 'PASS' : 'FAIL (' + noSrc.length + ')'}   [ghost 노드 중 출처없음 ${noSrcGhost.length}개]`);

  // 6. 법안 limit 칸 (규칙 5)
  const bills = N.filter(n => n.t === 'bill');
  const noLimit = bills.filter(n => !n.limit || !n.limit.length);
  noLimit.forEach(n => W(`limit 칸 비어있음: ${n.id} (${n.lab})`));
  console.log(`6. 법안 남은문제    ${noLimit.length === 0 ? 'PASS' : 'WARN (' + noLimit.length + '/' + bills.length + ' 비어있음)'}`);

  // 7. 사진 라이선스 (새 규칙)
  const hasPhotoField = N.some(n => n.photo || n.photoLicense);
  console.log(`7. 사진 라이선스    ${hasPhotoField ? '검사대상 있음' : 'N/A (photo/photoLicense 필드 아직 없음)'}`);

  // 8. "확인 중" 현황
  const pending = N.filter(n => n.check || n.pending ||
    JSON.stringify(n).includes('확인 중'));
  console.log(`8. 확인 중 노드     ${pending.length}개`);

  // 9. 정당별 노드 분포 (편향 모니터)
  const bySide = {};
  N.forEach(n => { bySide[n.side || '(없음)'] = (bySide[n.side||'(없음)'] || 0) + 1; });
  const byRole = {};
  L.forEach(l => { byRole[l[3] || '(빈값)'] = (byRole[l[3]||'(빈값)'] || 0) + 1; });

  /* ── 해상도별: 좌표 / 정착 / 겹침 ── */
  console.log('\n해상도별 레이아웃');
  const layout = [];
  for (const [w, h] of VIEWPORTS) {
    const d = (w === 1440) ? dom0 : boot(w, h);
    if (w !== 1440) await new Promise(r => setTimeout(r, 1500));
    const win = d.window, nodes = win.N;
    const bad = nodes.filter(n => !isFinite(n.x) || !isFinite(n.y));
    // 정착: 포커스 해제 후 이동량 (포커스 중엔 의도적으로 alpha 바닥이 0.014)
    const focusedAlpha = win.alpha;
    win.closePop && win.closePop();
    await new Promise(r => setTimeout(r, 2500));
    const before = nodes.map(n => [n.x, n.y]);
    await new Promise(r => setTimeout(r, 500));
    let moved = 0;
    nodes.forEach((n, i) => {
      const dx = n.x - before[i][0], dy = n.y - before[i][1];
      if (Math.hypot(dx, dy) > 1.0) moved++;
    });
    // 겹침: 화면에 실제로 그려지는 활성 노드(A)만
    const act = win.A || nodes;
    let overlap = 0;
    for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
      const a = act[i], b = act[j];
      if (!isFinite(a.x) || !isFinite(b.x)) continue;
      if (a.ghost || b.ghost) continue;
      const d2 = Math.hypot(a.x - b.x, a.y - b.y);
      const need = (a.r || 8) + (b.r || 8);
      if (d2 < need * 0.85) overlap++;
    }
    layout.push({ w, bad: bad.length, moved, overlap });
    console.log(`  ${String(w).padStart(4)}px  좌표이상 ${bad.length}  ·  미정착 ${moved}  ·  겹침 ${overlap}  ·  포커스중 alpha ${focusedAlpha.toFixed(4)}`);
    if (bad.length) F(`${w}px: 좌표 이상 ${bad.length}개`);
    if (overlap) W(`${w}px: 겹침 ${overlap}쌍`);
    if (moved > nodes.length * 0.1) W(`${w}px: 정착 안 됨 (${moved}/${nodes.length} 이동중)`);
    // window.close() 생략 — jsdom DOMException 회피
  }

  /* ── 요약 ── */
  console.log('\n' + '─'.repeat(50));
  console.log('노드 진영 분포:', JSON.stringify(bySide));
  console.log('관계 역할 분포:', JSON.stringify(byRole));
  console.log('─'.repeat(50));
  console.log(`\nFAIL ${fails.length}건 / WARN ${warns.length}건\n`);
  if (fails.length) { console.log('[FAIL]'); fails.slice(0, 40).forEach(m => console.log('  · ' + m)); if(fails.length>40)console.log(`  … 외 ${fails.length-40}건`); }
  if (warns.length) { console.log('\n[WARN]'); warns.slice(0, 40).forEach(m => console.log('  · ' + m)); if(warns.length>40)console.log(`  … 외 ${warns.length-40}건`); }

  fs.writeFileSync('./점검결과.txt',
    `FAIL ${fails.length} / WARN ${warns.length}\n\n[FAIL]\n${fails.join('\n')}\n\n[WARN]\n${warns.join('\n')}\n`);
  process.exit(0);
})();
