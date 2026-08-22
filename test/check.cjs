/**
 * 왜(Why) — 점검 스크립트
 * 검사: 끊긴 링크 / 고립 노드 / 좌표 정상 / 정착 후 정지 / 겹침 /
 *       재임 관계 오분류 / 원인 없는 결과 노드 / 출처 / limit 칸 / 사진 라이선스
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require('jsdom');
const vc = new VirtualConsole();
const scriptErrors = [];
vc.on('jsdomError', e => scriptErrors.push(e.message));

const html = fs.readFileSync(path.join(ROOT, '왜.html'), 'utf8');
const VIEWPORTS = [[412, 915], [840, 1000], [1440, 900], [1920, 1080]];
/* 이름표는 캔버스 배율(cam.s)에 곱해져 그려진다. 소스의 고정 폰트 크기가 12px 이므로
   화면상 크기는 12 × cam.s 다. 배율이 0.5면 6px 이 되어 읽을 수 없다. */
const LABEL_FONT_PX = 12;
const LABEL_MIN_PX = 11;
const fails = [], warns = [], notes = [];
const F = (m) => fails.push(m);
const W = (m) => warns.push(m);

/* canvas 스텁 */
/* 글자 폭 추정.
   전에는 글자 수 × 6.2px 였다. 한글은 12px 폰트에서 폭이 거의 12px 인데
   6.2px 로 재고 있었으니 이름표 폭을 절반으로 줄여 본 셈이다.
   이름표 겹침을 재려면 폭이 맞아야 한다. 전각/반각을 나눠 센다. */
function textWidth(str, fontPx) {
  let units = 0;
  for (const ch of String(str)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x11FF) ||   // 한글 자모
      (c >= 0x2E80 && c <= 0x303F) ||   // CJK 부수·기호
      (c >= 0x3040 && c <= 0x30FF) ||   // 가나
      (c >= 0x3400 && c <= 0x4DBF) ||   // CJK 확장A
      (c >= 0x4E00 && c <= 0x9FFF) ||   // 한자
      (c >= 0xAC00 && c <= 0xD7A3) ||   // 한글 음절
      (c >= 0xF900 && c <= 0xFAFF) ||   // CJK 호환 한자
      (c >= 0xFF00 && c <= 0xFF60);     // 전각 영숫자
    units += wide ? 1.0 : 0.52;
  }
  return units * fontPx;
}

/* ctx.font 문자열에서 px 크기를 뽑는다. 못 뽑으면 12px 로 본다. */
function fontPxOf(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(String(font || ''));
  return m ? parseFloat(m[1]) : 12;
}

function stubCanvas(win) {
  const ctx = {
    canvas: null, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
    globalAlpha: 1, textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    shadowBlur: 0, shadowColor: '',
    measureText(t) { return { width: textWidth(t, fontPxOf(this.font)) }; },
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

/* 네트워크 연결 확인 — 대상 URL 의 호스트 이름을 실제로 찾을 수 있는지 본다.
   하나라도 찾히면 온라인. 전부 못 찾으면 오프라인으로 보고 검사를 SKIP 한다. */
async function online(targets) {
  const dns = require('dns').promises;
  const hosts = [...new Set(targets.map(t => { try { return new URL(t.url).hostname; } catch (e) { return null; } }).filter(Boolean))];
  for (const h of hosts.concat(['example.com'])) {
    try { await dns.lookup(h); return true; } catch (e) { /* 다음 호스트 */ }
  }
  return false;
}

/* 링크 한 개 확인.
   2xx/3xx        → 살아있음
   405/501        → HEAD 미지원. GET 으로 재시도
   403/429        → 봇 차단 의심. 죽었다고 단정하지 않고 WARN (사람이 확인)
   그 외 4xx/5xx  → 죽음
   네트워크 오류  → 죽음 (온라인인데 이 호스트만 안 되는 경우) */
async function probe(url) {
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
  const hit = async (method) => {
    const res = await fetch(url, {
      method, redirect: 'follow', signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': UA, 'Accept': '*/*' }
    });
    return res.status;
  };
  // HEAD 는 빠르지만 거짓말을 한다. 실제로 국가법령정보센터는 HEAD 에 404 를,
  // 같은 URL 의 GET 에는 200 을 돌려준다. 그래서 HEAD 가 실패하면 반드시 GET 으로
  // 다시 확인한다. 최종 판정은 언제나 GET 이 이긴다 — 사람이 브라우저로 여는 방식이 GET 이다.
  let headStatus = null;
  try { headStatus = await hit('HEAD'); } catch (e) { headStatus = (e.cause && e.cause.code) || e.name || 'ERR'; }
  if (typeof headStatus === 'number' && headStatus >= 200 && headStatus < 400) {
    return { ok: true, status: headStatus, via: 'HEAD' };
  }
  try {
    const st = await hit('GET');
    if (st >= 200 && st < 400) return { ok: true, status: st, via: 'GET', headLied: headStatus };
    if (st === 403 || st === 429) return { ok: false, blocked: true, status: st, via: 'GET' };
    return { ok: false, blocked: false, status: st, via: 'GET' };
  } catch (e) {
    const code = (e && e.cause && e.cause.code) || (e && e.name) || 'ERR';
    return { ok: false, blocked: false, status: code, via: 'GET' };
  }
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

  // 3. 재임 관계 분류 (규칙 3) — FAIL 승격
  //    (a) 재임 표현이 라벨이든 문장이든 있으면 role='lead' 는 절대 금지
  //    (b) 관계 라벨 자체가 재임 표현이면 role='term' 이어야 한다
  //    문장에만 "재임 중" 이 있는 서술형(예: 시장 직위 → 그가 한 시정 활동)은
  //    본인이 실제로 한 일이므로 term 이 아니다. WARN 으로만 남긴다.
  const TERMWORD = /재임|여당|집권|당시 대통령|이 시기/;
  let mis = 0;
  L.forEach((l, i) => {
    const label = String(l[2] || ''), sent = String(l[4] || '');
    const labelTermish = TERMWORD.test(label);
    const anyTermish = labelTermish || TERMWORD.test(sent);
    if (anyTermish && l[3] === 'lead') {
      F(`재임→밀어붙임 오분류 #${i}: ${l[0]}→${l[1]} "${label}" — 재임을 근거로 lead 를 붙일 수 없다`); mis++;
    }
    if (labelTermish && l[3] !== 'term') {
      F(`재임 라벨인데 term 아님 #${i}: ${l[0]}→${l[1]} "${label}" role='${l[3]||'(빈값)'}'`); mis++;
    }
    if (!labelTermish && anyTermish && l[3] !== 'term') {
      W(`문장에 재임 표현 (서술형, term 아님) #${i}: ${l[0]}→${l[1]} "${label}" role='${l[3]||'(빈값)'}' · "${sent}"`);
    }
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

  // 5. 출처 표기 (규칙 7) — FAIL 승격, ghost 예외 없음
  //    런타임 파생 노드도 화면에 노드로 보인다. 예외를 두면 규칙이 아니다.
  const noSrc = N.filter(n => !n.src);
  noSrc.forEach(n => F(`출처 없음: ${n.id} (${n.lab})${n.ghost ? ' [ghost]' : ''}`));
  const noSrcGhost = noSrc.filter(n => n.ghost).length;
  console.log(`5. 출처 표기        ${noSrc.length === 0 ? 'PASS' : 'FAIL (' + noSrc.length + ')'}   [그중 ghost ${noSrcGhost}개]`);

  // 6. 법안 limit 칸 (규칙 5)
  const bills = N.filter(n => n.t === 'bill');
  const noLimit = bills.filter(n => !n.limit || !n.limit.length);
  noLimit.forEach(n => W(`limit 칸 비어있음: ${n.id} (${n.lab})`));
  console.log(`6. 법안 남은문제    ${noLimit.length === 0 ? 'PASS' : 'WARN (' + noLimit.length + '/' + bills.length + ' 비어있음)'}`);

  // 7. 사진 라이선스 (규칙 6)
  //    photo 가 있는데 photoLicense 가 없으면 FAIL. 저작권 사고는 되돌릴 수 없다.
  const withPhoto = N.filter(n => n.photo);
  const noLicense = withPhoto.filter(n => !n.photoLicense);
  noLicense.forEach(n => F(`사진 라이선스 없음: ${n.id} (${n.lab}) — photo 는 있는데 photoLicense 가 없다`));
  const orphanLicense = N.filter(n => n.photoLicense && !n.photo);
  orphanLicense.forEach(n => W(`photoLicense 만 있고 photo 없음: ${n.id} (${n.lab})`));
  console.log(`7. 사진 라이선스    ${withPhoto.length === 0
    ? 'N/A (photo 필드 아직 없음)'
    : (noLicense.length === 0 ? `PASS (${withPhoto.length}장 전부 라이선스 확인됨)` : `FAIL (${noLicense.length}/${withPhoto.length} 라이선스 없음)`)}`);

  // 8. "확인 중" 현황
  const pending = N.filter(n => n.check || n.pending ||
    JSON.stringify(n).includes('확인 중'));
  console.log(`8. 확인 중 노드     ${pending.length}개`);

  // 9. 진영 분포 (규칙 5 · 편향 모니터)
  //    자동 판정하지 않는다. 기울기가 보이도록 매 실행마다 눈앞에 띄우는 게 목적이다.
  const bySide = {};
  N.forEach(n => { bySide[n.side || '(없음)'] = (bySide[n.side||'(없음)'] || 0) + 1; });
  const byRole = {};
  L.forEach(l => { byRole[l[3] || '(빈값)'] = (byRole[l[3]||'(빈값)'] || 0) + 1; });

  const SIDE_LAB = { blue:'진보', red:'보수', gov:'정부', gold:'결과', both:'양쪽', labor:'노동', civic:'시민', rec:'기록', pend:'확인중', other:'기타' };
  const sideRows = Object.entries(bySide).sort((a, b) => b[1] - a[1]);
  const sideMax = sideRows.length ? sideRows[0][1] : 0;
  console.log('9. 진영 분포        (편향 모니터 · 자동 판정 없음)');
  sideRows.forEach(([k, v]) => {
    const bar = '█'.repeat(Math.max(1, Math.round(v / sideMax * 24)));
    const pct = (v / N.length * 100).toFixed(1);
    console.log(`     ${(SIDE_LAB[k] || k).padEnd(4)} ${String(k).padEnd(6)} ${String(v).padStart(3)}  ${String(pct).padStart(5)}%  ${bar}`);
  });
  const blue = bySide.blue || 0, red = bySide.red || 0;
  if (blue + red > 0) {
    const skew = Math.abs(blue - red) / (blue + red) * 100;
    console.log(`     진보/보수 격차 ${blue}:${red} · 기울기 ${skew.toFixed(1)}%${skew > 20 ? '  ← API 로 발의·표결 데이터를 채우면 완화된다' : ''}`);
  }

  // 10. official2 링크 검증 (규칙 2)
  //     검색 결과에 URL 이 떴다는 것만으로는 출처가 아니다. 실제로 열려야 출처다.
  //     오프라인이면 검사를 건너뛰고 그 사실을 분명히 출력한다 (조용히 PASS 하지 않는다).
  const linkTargets = [];
  N.forEach(n => (n.official2 || []).forEach((r, k) => {
    const u = String(r[1] || '');
    if (u) linkTargets.push({ id: n.id, lab: n.lab, title: String(r[0] || ''), url: u, k });
  }));

  console.log(`\n10. official2 링크   대상 ${linkTargets.length}개 (노드 ${new Set(linkTargets.map(t => t.id)).size}개)`);

  if (linkTargets.length === 0) {
    console.log('    SKIP — official2 링크가 아직 없다');
  } else if (!(await online(linkTargets))) {
    console.log('    ★ SKIP — 네트워크에 연결되어 있지 않다. 링크 검증을 하지 못했다.');
    console.log('      온라인에서 npm test 를 다시 돌려야 규칙 2가 실제로 강제된다.');
    notes.push('official2 링크 검증 SKIP (오프라인)');
  } else {
    let dead = 0, blocked = 0, alive = 0;
    for (const t of linkTargets) {
      const v = await probe(t.url);
      if (v.ok) {
        alive++;
        console.log(`    OK   ${v.status}  ${t.url}${v.headLied ? `   (HEAD 는 ${v.headLied} 를 돌려줬다 — GET 으로 확인)` : ''}`);
      }
      else if (v.blocked) {
        blocked++;
        W(`링크 봇차단 의심 (${v.status}) ${t.id} · ${t.title} — 사람이 직접 열어 확인할 것: ${t.url}`);
        console.log(`    ??   ${v.status}  ${t.url}   ← 봇 차단 의심, 사람이 확인`);
      } else {
        dead++;
        F(`죽은 링크 (${v.status}) ${t.id} (${t.lab}) · ${t.title}: ${t.url}`);
        console.log(`    DEAD ${v.status}  ${t.url}`);
      }
    }
    console.log(`    ${dead === 0 ? 'PASS' : 'FAIL (' + dead + ')'}   살아있음 ${alive} · 차단의심 ${blocked} · 죽음 ${dead}`);
  }

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
    // 점 겹침: 화면에 실제로 그려지는 활성 노드(A)의 '원' 만 본다.
    // 이 숫자가 0이라고 화면이 깨끗한 게 아니다 — 실제로 겹치는 건 아래 '이름표' 다.
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

    // ── 이름표 검사 ──
    // 전에는 이 검사가 아예 없었다. 점 겹침만 재고 "겹침 0" 이라고 출력했다.
    // 검사가 화면을 봤다고 착각하게 만드는 게 제일 위험하다. 그래서 셋을 잰다:
    //   (1) 이름표가 몇 개나 실제로 그려지는가  (2) 이름표끼리 몇 쌍이 겹치는가
    //   (3) 화면상 글자가 몇 px 인가
    const camS = (win.cam && win.cam.s) || 1;
    const labeled = act.filter(n =>
      typeof win.labelOn === 'function' && win.labelOn(n) && n.a > 0.16 &&
      isFinite(n.x) && isFinite(n.__hw) && isFinite(n.__hh));

    let labOverlap = 0;
    const labPairs = [];
    for (let i = 0; i < labeled.length; i++) for (let j = i + 1; j < labeled.length; j++) {
      const a = labeled[i], b = labeled[j];
      // 이름표는 점 아래에 가운데 정렬로 그려진다 (n.y + n.r + 14 부근)
      const ay = a.y + (a.r || 8) + a.__hh, by = b.y + (b.r || 8) + b.__hh;
      if (Math.abs(a.x - b.x) < (a.__hw + b.__hw) && Math.abs(ay - by) < (a.__hh + b.__hh)) {
        labOverlap++;
        if (labPairs.length < 3) labPairs.push(`${a.lab} × ${b.lab}`);
      }
    }
    const labPx = +(LABEL_FONT_PX * camS).toFixed(1);

    layout.push({ w, bad: bad.length, moved, overlap, labels: labeled.length, labOverlap, labPx });
    console.log(`  ${String(w).padStart(4)}px  좌표이상 ${bad.length}  ·  미정착 ${moved}  ·  점겹침 ${overlap}  ·  포커스중 alpha ${focusedAlpha.toFixed(4)}`);
    console.log(`          이름표 ${String(labeled.length).padStart(3)}/${act.length}개 그려짐  ·  이름표겹침 ${labOverlap}쌍  ·  화면상 글자 ${labPx}px  (배율 ${camS.toFixed(3)})`);

    if (bad.length) F(`${w}px: 좌표 이상 ${bad.length}개`);
    if (overlap) W(`${w}px: 점 겹침 ${overlap}쌍`);
    if (moved > nodes.length * 0.1) W(`${w}px: 정착 안 됨 (${moved}/${nodes.length} 이동중)`);

    // 이름표가 하나도 안 그려지면 색깔 점만 보인다. 뭐가 뭔지 알 방법이 없다.
    if (act.length > 0 && labeled.length === 0)
      W(`${w}px: 이름표가 하나도 안 그려진다 (활성 ${act.length}개, 배율 ${camS.toFixed(3)} — labelOn 기준 미달)`);
    if (labOverlap)
      W(`${w}px: 이름표 겹침 ${labOverlap}쌍 (예: ${labPairs.join(' / ')})`);
    if (labeled.length && labPx < LABEL_MIN_PX)
      W(`${w}px: 화면상 글자 ${labPx}px — 읽을 수 있는 하한 ${LABEL_MIN_PX}px 미만`);
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

  if (notes.length) { console.log('\n[SKIP · 확인 못 한 것]'); notes.forEach(m => console.log('  · ' + m)); }

  fs.writeFileSync(path.join(ROOT, '점검결과.txt'),
    `FAIL ${fails.length} / WARN ${warns.length}\n\n[FAIL]\n${fails.join('\n')}\n\n[WARN]\n${warns.join('\n')}\n\n[SKIP]\n${notes.join('\n')}\n`);

  // FAIL 이 있으면 실제로 실패해야 한다. 통과 코드로 끝내면 강제가 아니라 장식이다.
  console.log(fails.length ? '\n결과: FAIL — 커밋하지 마라.' : '\n결과: PASS');
  process.exit(fails.length ? 1 : 0);
})();
