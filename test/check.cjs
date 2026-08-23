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

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
/* 볼 해상도. 태블릿 세로와 폴드가 통째로 빠져 있었다.
   폴드 펼친 상태의 CSS 픽셀은 출처마다 다르다 —
   phone-simulator.com 은 816x616, yesviz.com 은 984x1092 로 적는다.
   어느 쪽이 맞는지 확인 못 했으므로 둘 다 넣는다. 하나만 넣으면 못 보는 쪽이 생긴다.
   폴드 펼침이 900px 경계 양쪽에 걸쳐 있어서 이 둘은 서로 다른 화면이 된다. */
const VIEWPORTS = [
  [412, 915],    // 폰
  [344, 882],    // 폴드 접음
  [816, 616],    // 폴드 펼침 후보 A (900 아래 — 아래 서랍)
  [820, 1180],   // 아이패드 세로
  [840, 1000],   // 기존
  [984, 1092],   // 폴드 펼침 후보 B (900 위 — 왼쪽 고정 패널)
  [1440, 900],   // 노트북
  [1920, 1080],  // 데스크톱
  [915, 412],    // 폰 가로 — 높이가 낮아 카드를 옆으로 붙인다
  [882, 344],    // 폴드 접힘 가로 — 가장 낮다
  [1180, 820],   // 아이패드 가로
  [1280, 800],   // 갤럭시탭 가로
];
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
    fill(){},stroke(){},fillRect(){},clearRect(){},strokeRect(){},
    /* 그려진 글자를 기록한다. 캔버스는 픽셀이라 '무엇을 그렸는지' 를
       나중에 물어볼 수 없다. 그리는 순간에 받아 적어야 한다. */
    fillText(t){ win.__drawn && win.__drawn.push(String(t)) },
    strokeText(){},translate(){},scale(){},rotate(){},setTransform(){},
    setLineDash(){},drawImage(){},clip(){},ellipse(){},
    createLinearGradient:()=>({addColorStop(){}}),
    createRadialGradient:()=>({addColorStop(){}})
  };
  win.__drawn = [];
  win.HTMLCanvasElement.prototype.getContext = function(){ ctx.canvas=this; return ctx; };
}

/* 사람이 화면에서 실제로 보는 글자만 모은다.
   textContent 는 <script> 안의 소스까지 읽어서, 상수에 적어둔 값이
   '화면에 보인다' 로 잘못 잡힌다. script·style·template 을 떼고 센다. */
function visibleText(doc) {
  const b = doc.body.cloneNode(true);
  b.querySelectorAll('script,style,template,noscript').forEach(el => el.remove());
  return String(b.textContent || '');
}

/* <style> 안을 최상위 블록 단위로 자른다.
   문자열('...')과 주석(/* ... *\/) 안의 중괄호에 속으면 안 되므로 상태를 들고 훑는다.
   정규식으로 자르면 블록이 통째로 날아가도 문법 검사는 통과한다. */
function topLevelCss(htmlText) {
  const a = htmlText.indexOf('<style>');
  const b = htmlText.indexOf('</style>');
  if (a < 0 || b < 0) return [];
  const css = htmlText.slice(a + 7, b);
  const out = [];
  let i = 0, depth = 0, start = 0, isMedia = false, str = null, com = false;
  while (i < css.length) {
    const c = css[i];
    if (com) { if (c === '*' && css[i + 1] === '/') { com = false; i += 2; continue } i++; continue }
    if (str) { if (c === '\\') { i += 2; continue } if (c === str) str = null; i++; continue }
    if (c === '/' && css[i + 1] === '*') { com = true; i += 2; continue }
    if (c === '"' || c === "'") { str = c; i++; continue }
    if (c === '{') { if (depth === 0) isMedia = css.slice(start, i).indexOf('@media') >= 0; depth++; i++; continue }
    if (c === '}') {
      depth--;
      if (depth === 0) { out.push({ media: isMedia, text: css.slice(start, i + 1) }); start = i + 1 }
      i++; continue }
    i++;
  }
  return out;
}

/* 블록에서 셀렉터만 뽑는다. 미디어쿼리면 안쪽 규칙들의 셀렉터를 뽑는다. */
function selectorsOf(block) {
  const body = /^\s*@media[^{]*\{([\s\S]*)\}\s*$/.exec(block);
  const src = body ? body[1] : block;
  const sels = [];
  src.replace(/([^{}]+)\{[^{}]*\}/g, (_, sel) => {
    sel.split(',').forEach(x => { const t = x.trim(); if (t && !t.startsWith('@')) sels.push(t) });
    return '';
  });
  return [...new Set(sels)];
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

  // 11. CSS 순서 — 미디어쿼리 뒤에 일반 규칙을 두지 않는다
  //     같은 특정도면 나중에 선언한 쪽이 이긴다. 미디어쿼리 뒤에 일반 규칙을 두면
  //     반응형이 조용히 무력화된다. 화면은 깨지는데 문법 오류는 없어서 아무도 모른다.
  //     이 프로젝트에서 세 번 났다: .brand(제목 '왜왜'), .search input(폰 안내문 사라짐),
  //     .ub([hidden] 무시). 개별 버그가 아니라 구조 문제라 규칙으로 박는다.
  const cssBlocks = topLevelCss(html);
  const firstMediaAt = cssBlocks.findIndex(b => b.media);
  const strayRules = firstMediaAt < 0 ? []
    : cssBlocks.slice(firstMediaAt + 1).filter(b => !b.media);

  if (strayRules.length) {
    // 미디어쿼리 안에 같은 셀렉터가 있으면 실제로 덮어쓰는 사고다. 그것부터 보여준다.
    const inMedia = new Set();
    cssBlocks.filter(b => b.media).forEach(b =>
      selectorsOf(b.text).forEach(sel => inMedia.add(sel)));

    strayRules.forEach(b => {
      const sels = selectorsOf(b.text);
      const clash = sels.filter(sel => inMedia.has(sel));
      F(`미디어쿼리 뒤의 일반 규칙: ${sels.join(', ').slice(0, 70)}` +
        (clash.length ? `  ← 미디어쿼리 안의 ${clash.join(', ').slice(0, 50)} 를 덮어쓴다` : ''));
    });
  }
  console.log(`11. CSS 순서        ${strayRules.length === 0
    ? `PASS   [일반 ${cssBlocks.filter(b => !b.media).length} · 미디어 ${cssBlocks.filter(b => b.media).length}, 미디어쿼리가 전부 뒤에 있다]`
    : `FAIL (${strayRules.length}) — 미디어쿼리 뒤에 일반 규칙이 있다`}`);

  // 12. 죽은 CSS 규칙 — 절대 매칭될 수 없는 셀렉터
  //     셀렉터 끝에 줄바꿈만 남고 잘리면 다음 규칙이 통째로 삼켜진다.
  //     실제로 "body.panelon" 두 줄이 .pclose 를 삼켜서
  //     카드 ✕ 버튼이 브라우저 기본 회색 네모로 나오고 있었다. npm test 는 PASS 였다.
  //     문법 오류가 아니라 화면만 틀린다 — 검사가 못 보면 아무도 못 본다.
  const deadRules = [];
  cssBlocks.filter(b => !b.media).forEach(b => {
    const head = b.text.slice(0, b.text.indexOf('{'));
    head.split(',').forEach(sel => {
      const t = sel.split(/\s+/).filter(Boolean).join(' ');
      if (!t) return;
      // body/html 은 문서에 하나뿐이다. 자손으로 두 번 나오면 영원히 매칭 안 된다.
      const dup = (t.match(/(^|[\s>+~])(body|html)\b/g) || []).length;
      if (dup > 1) deadRules.push(t.slice(0, 80));
    });
  });
  deadRules.forEach(t => F(`죽은 CSS 규칙 (절대 매칭 안 됨): ${t}`));
  // 같은 셀렉터가 뒤에서 같은 속성을 덮어쓰면 앞 선언은 죽은 코드다.
  // 미디어쿼리를 파일 끝으로 몬 뒤로 '같은 특정도면 뒤엣것이 이긴다' 가 기본 구조가 됐다.
  // 특히 display 를 끄려고 앞에 none 을 넣으면 뒤 원본에 그대로 진다.
  // 실제로 .rolebar 를 그렇게 껐다가 화면에 그대로 보였다. 그건 FAIL 로 잡는다.
  const propsOf = (text) => {
    const body = text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'));
    const out = {};
    body.split(/;(?![^(]*\))/).forEach(d => {
      const i = d.indexOf(':');
      if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    });
    return out;
  };
  const seenSel = {};
  const shadowed = [], displayTraps = [];
  // 블록 머리에는 앞선 주석이 그대로 붙어 온다. 떼지 않으면 같은 셀렉터가
  // 서로 다른 문자열이 되어 중복을 못 잡는다 (실제로 못 잡았다).
  const headSel = (text) => text.slice(0, text.indexOf('{')).replace(/\/\*[\s\S]*?\*\//g, '');
  cssBlocks.filter(b => !b.media).forEach(b => {
    const head = headSel(b.text);
    const pr = propsOf(b.text);
    head.split(',').map(x => x.split(/\s+/).filter(Boolean).join(' ')).filter(Boolean).forEach(sel => {
      const prev = seenSel[sel];
      if (prev) {
        const dup = Object.keys(prev).filter(k => k in pr);
        if (dup.length) {
          shadowed.push(`${sel} → ${dup.join(', ')}`);
          // 앞에서 display:none 으로 껐는데 뒤에서 display 를 되살린 경우
          if (prev.display === 'none' && 'display' in pr && pr.display !== 'none')
            displayTraps.push(`${sel} — 앞의 display:none 이 뒤의 display:${pr.display} 에 진다. 뒤에 있는 원본 규칙을 고쳐라`);
        }
      }
      seenSel[sel] = Object.assign({}, prev || {}, pr);
    });
  });
  displayTraps.forEach(t => F(`뒤 규칙이 덮어씀: ${t}`));
  shadowed.slice(0, 20).forEach(t => W(`같은 셀렉터를 뒤에서 덮어씀 (앞 선언은 죽은 코드): ${t}`));

  console.log(`12. 죽은 CSS 규칙   ${(deadRules.length + displayTraps.length) === 0 ? 'PASS' : 'FAIL (' + (deadRules.length + displayTraps.length) + ')'}` + `   [뒤에서 덮어쓴 셀렉터 ${shadowed.length}건은 WARN]`);

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
    /* 이름표 배치는 200ms 캐시가 걸려 있다. 물리가 그 뒤에도 움직이므로
       옛 위치로 배치한 결과를 지금 위치로 재면 없던 겹침이 나온다.
       재기 직전에 다시 계획시킨다 — 화면이 실제로 그리는 것과 같아진다. */
    try { win.labelSet = null; win.labelKey = ''; win.draw() } catch (e) {}
    const labeled = act.filter(n =>
      typeof win.labelOn === 'function' && win.labelOn(n) && n.a > 0.16 &&
      isFinite(n.x) && isFinite(n.__hw) && isFinite(n.__hh));

    /* 상자를 여기서 다시 계산하지 않는다. 페이지의 labelBox() 를 그대로 부른다.
       검사가 자기 식으로 계산하면 화면과 갈라지고, 그때 우리는 검사를 안 의심한다.
       (전에 화면 글자 크기를 따로 계산하다가 거짓 경보를 며칠 냈다.) */
    let labOverlap = 0;
    const labPairs = [];
    if (typeof win.labelBox !== 'function') F(`${w}px: labelBox() 가 없다 — 검사가 이름표 상자를 못 읽는다`);
    else {
      const boxes = labeled.map(n => Object.assign(win.labelBox(n), { lab: n.lab }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (Math.abs(a.x - b.x) < (a.w + b.w) && Math.abs(a.y - b.y) < (a.h + b.h)) {
          labOverlap++;
          if (labPairs.length < 3) labPairs.push(`${a.lab} × ${b.lab}`);
        }
      }
    }
    /* 화면상 글자 크기는 배율 × 글꼴크기가 아니다.
       draw() 가 labelFontScale() = LABEL_PX/(12*cam.s) 를 곱해 그리므로
       배율이 변해도 화면 글자는 일정하다. 그 항을 빼먹고 곱하면
       배율이 작을수록 글자가 작다는 거짓 숫자가 나온다 —
       1440·1920 에서 "5.5px, 읽을 수 있는 하한 미만" 경고가 계속 떴는데
       실제로는 12px 이었다. 거짓 경보였다.
       그래서 페이지에서 직접 계산해 읽는다. 공식을 여기 베껴 쓰지 않는다. */
    let labPx = 0;
    try { labPx = +win.eval('(function(){return 12.5*labelFontScale()*cam.s})()').toFixed(1) }
    catch (e) { labPx = +(LABEL_FONT_PX * camS).toFixed(1) }

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

  // 13. 편집 UI 노출 — 방문자 화면에 편집 도구가 하나라도 있으면 FAIL
  //     방문자가 데이터를 건드릴 수 있으면 안 된다. 이 사이트에서 데이터는 신뢰의 전부다.
  //     사진 입력창이 인물 카드에 그대로 나와 있었는데 검사가 못 잡았다.
  //     그래서 '보이는지' 가 아니라 '문서에 있는지' 를 본다 — 숨긴 것은 언제든 열린다.
  const EDIT_SEL = 'input, textarea, [contenteditable="true"], ' +
    '[data-psave], [data-pdel], [data-pu], [data-pn], [data-refdel], [data-ulkdel], [data-nd], [data-nl], [data-md], ' +
    '.photobox, .photobtn, .refform, .refbtn, .refdel, .refin, .srnew, .newsbtn, #make, #news, #photos';
  // 검색창 하나만 방문자용이다. 그 외 input 은 전부 편집 도구다.
  const ALLOW_IDS = new Set(['q']);

  const dEdit = boot(412, 915);
  await new Promise(r => setTimeout(r, 1500));
  const we = dEdit.window;
  const leaks = [];

  const describe = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '';
    return (el.tagName.toLowerCase() + id + cls).slice(0, 60);
  };
  const scan = (where) => {
    we.document.querySelectorAll(EDIT_SEL).forEach(el => {
      if (el.id && ALLOW_IDS.has(el.id)) return;
      leaks.push(`${where}: ${describe(el)}`);
    });
  };

  scan('첫 화면');
  // 모든 노드 종류의 카드를 하나씩 열어 본다. 종류마다 렌더 경로가 다르다.
  const kinds = [...new Set(we.N.map(n => n.t))];
  const opened = [];
  kinds.forEach(k => {
    const n = we.N.find(x => x.t === k);
    if (!n) return;
    try { we.setFocus(n.id); } catch (e) { return }
    opened.push(`${k}(${n.lab})`);
    scan(`${k} 카드`);
  });

  const uniq = [...new Set(leaks)];
  uniq.forEach(t => F(`편집 UI 노출: ${t}`));
  console.log(`13. 편집 UI 노출    ${uniq.length === 0
    ? `PASS   [EDIT=false · 노드 종류 ${opened.length}개 카드 확인: ${opened.map(o => o.split('(')[0]).join(' ')}]`
    : `FAIL (${uniq.length}) — 방문자 화면에 편집 도구가 있다`}`);


  // 15. 링크 미리보기 카드 (og:*)
  //     정치 사이트는 링크로 퍼진다. 카톡·트위터 카드가 사실상 첫인상이다.
  //     그런데 이건 화면을 아무리 봐도 안 보인다 — 크롤러만 읽는다. 그래서 검사가 봐야 한다.
  //     og:image 는 절대 주소여야 하고(상대 경로는 크롤러가 못 읽는다),
  //     가리키는 파일이 저장소에 실제로 있어야 한다.
  const metaOf = (attr, val) => {
    const re = new RegExp(`<meta[^>]*${attr}=["']${val}["'][^>]*content=["']([^"']*)["']`, 'i');
    const m = re.exec(html); return m ? m[1] : null;
  };
  const ogImg = metaOf('property', 'og:image');
  const ogUrl = metaOf('property', 'og:url');
  const ogDesc = metaOf('property', 'og:description');
  const ogTitle = metaOf('property', 'og:title');
  const ogProblems = [];

  if (!ogTitle) ogProblems.push('og:title 없음');
  if (!ogDesc) ogProblems.push('og:description 없음');
  if (!ogUrl) ogProblems.push('og:url 없음');
  else if (!/^https?:\/\//.test(ogUrl)) ogProblems.push(`og:url 이 절대 주소가 아님: ${ogUrl}`);

  let ogImgNote = '없음';
  if (!ogImg) ogProblems.push('og:image 없음 — 그림 없는 카드가 뜬다');
  else if (!/^https?:\/\//.test(ogImg)) ogProblems.push(`og:image 가 절대 주소가 아님: ${ogImg}`);
  else {
    const file = ogImg.split('/').pop();
    const fp = path.join(ROOT, file);
    if (!fs.existsSync(fp)) ogProblems.push(`og:image 파일이 저장소에 없음: ${file}`);
    else {
      const kb = Math.round(fs.statSync(fp).size / 1024);
      // PNG 헤더에서 크기를 직접 읽는다. 선언한 값과 실물이 다르면 카드가 잘린다.
      const buf = fs.readFileSync(fp);
      let dim = '';
      if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
        dim = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
        if (dim !== '1200x630') ogProblems.push(`og:image 크기가 1200x630 이 아님: ${dim}`);
      }
      if (kb > 300) ogProblems.push(`og:image 가 너무 큼: ${kb}KB (300KB 이하)`);
      ogImgNote = `${file} ${dim} ${kb}KB`;
    }
  }
  ogProblems.forEach(t => F(`링크 카드: ${t}`));
  console.log(`15. 링크 미리보기   ${ogProblems.length === 0 ? `PASS   [${ogImgNote}]` : `FAIL (${ogProblems.length})`}`);

  // 16. 워터마크 · 저작권
  //     캡처하면 출처가 따라가야 한다. 워터마크는 캔버스에 직접 그리므로
  //     DOM 을 아무리 뒤져도 안 보인다 — 그리는 순간을 잡아야 확인된다.
  //     실수로 지워지거나 다른 그림에 가려지면 아무도 모른 채 출처 없는 캡처가 퍼진다.
  const wmProblems = [];
  const wmSeen = [];
  for (const [w, h] of VIEWPORTS) {
    const dw = boot(w, h);
    await new Promise(r => setTimeout(r, 900));
    const ww = dw.window;
    const site = ww.SITE || {};
    const drawn = (ww.__drawn || []).map(String);
    const hit = drawn.filter(t => site.host && t.indexOf(site.host) >= 0);
    wmSeen.push(`${w}px ${hit.length ? '○' : '✕'}`);
    if (!site.host) { wmProblems.push(`${w}px: SITE.host 가 없다`); continue }
    if (!hit.length) wmProblems.push(`${w}px: 워터마크가 캔버스에 안 그려졌다 (찾는 글자: ${site.host})`);
    if (hit.length && site.name && hit[0].indexOf(site.name) < 0)
      wmProblems.push(`${w}px: 워터마크에 사이트 이름 '${site.name}' 이 없다`);
  }

  // ── 도메인이 한 벌로 맞는가 ──
  // 화면(워터마크·카드·안내)은 SITE 한 곳에서 온다. 그런데 <head> 메타는 크롤러가
  // JS 실행 전에 읽어야 해서 HTML 에 박아야 하고, 링크 카드 그림과 문서도 따로 있다.
  // 정적 파일에서 이건 피할 수 없다. 대신 '한 곳을 고치면 나머지를 전부 지목한다' 로 만든다.
  // 도메인을 바꿀 때 여기 목록만 보면 어디를 안 고쳤는지 바로 나온다.
  const w0host = (dom0.window.SITE || {}).host;
  if (!w0host) wmProblems.push('SITE.host 가 비어 있다');
  else {
    const mustHaveHost = [
      ['index.html <head> og:url',      html, /<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']*)["']/i],
      ['index.html <head> og:image',    html, /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i],
      ['index.html <head> twitter:image', html, /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']*)["']/i],
      ['index.html <head> canonical',    html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i],
    ];
    mustHaveHost.forEach(([what, src, re]) => {
      const v = (re.exec(src) || [])[1];
      if (!v) wmProblems.push(`${what} 가 없다`);
      else if (v.indexOf(w0host) < 0)
        wmProblems.push(`${what}(${v}) 에 SITE.host(${w0host}) 가 없다 — 도메인을 한 곳만 고쳤다`);
    });
    // 링크 카드 그림 원본과 문서의 출처 표기 예시도 같은 도메인이어야 한다.
    [['docs/og.html', 'og.html'], ['README.md', null], ['LICENSE', null], ['docs/배포.md', null]]
      .forEach(([rel]) => {
        const fp = path.join(ROOT, rel);
        if (!fs.existsSync(fp)) return;
        const t = fs.readFileSync(fp, 'utf8');
        // 도메인이 전혀 안 나오는 문서는 검사 대상이 아니다
        if (!/[a-z0-9-]+\.(com|dev|kr|org|net)/i.test(t)) return;
        if (t.indexOf(w0host) < 0)
          wmProblems.push(`${rel} 에 SITE.host(${w0host}) 가 없다 — 옛 도메인이 남았을 수 있다`);
      });
  }

  // 카드 하단 저작권 한 줄
  const licInCard = /class="cardlic"/.test(html);
  if (!licInCard) wmProblems.push('카드 하단 저작권 줄(.cardlic)이 없다');
  if (!fs.existsSync(path.join(ROOT, 'LICENSE'))) wmProblems.push('LICENSE 파일이 없다');

  // 화면에는 사이트 이름만 쓴다. 개인 이름이 걸리면 '누구의 사이트' 처럼 보여
  // 중립성이 흐려진다. 권리는 LICENSE 와 README 가 갖고, 화면은 담백하게 간다.
  const owner16 = (dom0.window.SITE || {}).owner;
  if (owner16) {
    const de = dom0.window.document;
    // 노드 종류별 카드를 열어 화면에 실명이 나오는지 본다
    [...new Set(dom0.window.N.map(n => n.t))].forEach(k => {
      const n = dom0.window.N.find(x => x.t === k);
      if (!n) return;
      try { dom0.window.setFocus(n.id) } catch (e) { return }
      // jsdom 은 innerText 를 지원하지 않는다 (undefined). textContent 를 쓰되,
      // textContent 는 <script> 안의 소스까지 읽는다 — SITE 상수의 owner 가 그대로 잡힌다.
      // 사람이 화면에서 보는 글자만 남기려면 script·style 을 떼고 봐야 한다.
      if (visibleText(de).indexOf(owner16) >= 0)
        wmProblems.push(`${k} 카드 화면에 저작권자 실명('${owner16}')이 보인다 — 화면은 SITE.display 를 쓴다`);
    });
    // LICENSE 와 README 에는 반대로 실명이 있어야 한다. 권리 주체가 사라지면 안 된다.
    [['LICENSE'], ['README.md']].forEach(([rel]) => {
      const fp = path.join(ROOT, rel);
      if (fs.existsSync(fp) && fs.readFileSync(fp, 'utf8').indexOf(owner16) < 0)
        wmProblems.push(`${rel} 에 저작권자('${owner16}')가 없다 — 권리 주체가 빠졌다`);
    });
  }

  wmProblems.forEach(t => F(`워터마크·저작권: ${t}`));
  console.log(`16. 워터마크        ${wmProblems.length === 0
    ? `PASS   [${wmSeen.join(' · ')} · 카드 저작권 ○ · LICENSE ○]`
    : `FAIL (${wmProblems.length})`}`);

  // 17. 지도 선 상한 · 잘린 개수 표시
  //     실측으로 정한 값이다 — 이웃 6개까지 이름표가 100% 읽히고, 8개에서 63%,
  //     10개를 넘으면 선 간격이 3.2° 로 붙어 눈으로 구분할 수 없다.
  //     그리고 잘랐으면 반드시 밝혀야 한다. 말없이 자르면 "이게 전부" 라는 거짓말이 된다.
  //     전에는 13개에서 소리 없이 잘리고 있었다.
  //     13번 창(412px)을 재사용하면 안 된다. 폰은 카드가 화면 대부분을 덮어
  //     포커스 노드가 배지를 그릴 수 있는 자리에 오지 않는다. 데스크톱으로 따로 띄운다.
  const dCap = boot(1440, 900);
  await new Promise(r => setTimeout(r, 1500));
  const we17 = dCap.window;
  const cap = we17.MAX_EDGES, termCap = we17.TERM_CAP;
  const capProblems = [];
  let checked17 = 0, cutSeen = 0;

  if (typeof cap !== 'number') capProblems.push('MAX_EDGES 가 없다 — 상한이 코드에 없다');
  else {
    // 연결이 상한을 넘는 노드만 본다. 그런 노드가 없으면 검사가 아무것도 안 보는 셈이다.
    const over = we17.N
      .filter(n => (we17.adj[n.id] || []).length > cap)
      .sort((a, b) => we17.adj[b.id].length - we17.adj[a.id].length);

    over.slice(0, 12).forEach(n => {
      try { we17.setFocus(n.id) } catch (e) { capProblems.push(`${n.lab} 카드가 깨진다: ${e.message}`); return }
      // 배지는 draw() 안에서 그려진다. setFocus 직후에는 아직 한 프레임도 안 돌았다.
      // 기다리는 대신 직접 부른다 — 무엇을 그렸는지 그 자리에서 받아 적어야 한다.
      we17.__drawn.length = 0;
      try { we17.draw() } catch (e) { capProblems.push(`${n.lab} draw 실패: ${e.message}`); return }
      checked17++;
      const drawnEdges = Object.keys(we17.ring || {}).filter(k => we17.ring[k] === 1).length;
      const total = we17.adj[n.id].length;
      const hidden = we17.hiddenEdges;

      if (drawnEdges > cap)
        capProblems.push(`${n.lab}: 지도에 선 ${drawnEdges}개 — 상한 ${cap} 초과`);

      // term 이 6칸을 다 먹으면 지도가 '정권 지도' 처럼 보인다. 규칙 3이 경계하는 오해다.
      const termDrawn = we17.adj[n.id]
        .filter(l => l[3] === 'term' && we17.ring[l[0] === n.id ? l[1] : l[0]] === 1).length;
      if (typeof termCap === 'number' && termDrawn > termCap)
        capProblems.push(`${n.lab}: term 이 ${termDrawn}개 그려짐 — 상한 ${termCap} 초과`);

      if (hidden > 0) {
        cutSeen++;
        // 잘렸으면 지도(캔버스 배지)와 카드(안내문) 둘 다에 표시가 있어야 한다.
        const badge = we17.__drawn.some(t => String(t) === '+' + hidden);
        const note = !!we17.document.querySelector('.cutnote');
        if (!badge) capProblems.push(`${n.lab}: ${hidden}개를 잘랐는데 지도에 '+${hidden}' 배지가 없다`);
        if (!note) capProblems.push(`${n.lab}: ${hidden}개를 잘랐는데 카드에 안내(.cutnote)가 없다`);
        if (hidden !== total - drawnEdges)
          capProblems.push(`${n.lab}: 잘린 수가 안 맞는다 (표시 ${hidden} · 실제 ${total - drawnEdges})`);
      }
    });

    if (!over.length) capProblems.push('상한을 넘는 노드가 하나도 없다 — 검사가 아무것도 못 본다');
  }

  capProblems.forEach(t => F(`지도 선 상한: ${t}`));
  console.log(`17. 지도 선 상한    ${capProblems.length === 0
    ? `PASS   [상한 ${cap} · term ${termCap} · 초과 노드 ${checked17}개 확인 · 그중 ${cutSeen}개에서 잘림 표시 확인]`
    : `FAIL (${capProblems.length})`}`);

  // 18. 이름표 진영 분포
  //     이름표를 겹치면 숨기는 순간 '무엇을 남길지' 를 우리가 정하게 된다.
  //     우선순위에 side 를 쓰지 않아도 결과는 기운다 — 데이터가 이미 기울어 있고
  //     연결 수로 정렬하기 때문이다. 규칙 5와 같은 종류의 위험이다.
  //     자동 판정하지 않는다. 매 실행마다 눈앞에 띄우는 것까지가 검사의 역할이다.
  //     멀리서(전체 보기)는 결과 숫자만 그리는 게 설계다. 거기서 gold 100% 는 편향이 아니다.
  //     기울기는 '확대해서 전 종류를 그릴 때' 봐야 뜻이 있다. 둘 다 잰다.
  const SIDE_LAB18 = { blue:'진보', red:'보수', gov:'정부', gold:'결과', both:'양쪽',
                       labor:'노동', civic:'시민', rec:'기록', pend:'확인중', other:'기타' };
  const dLbl = boot(1440, 900);
  await new Promise(r => setTimeout(r, 1500));
  const wl = dLbl.window;

  const snapLabels = (scale) => {
    wl.cam.s = scale; wl.cam.ts = scale;
    wl.labelSet = null; wl.labelKey = '';            // 계획 캐시를 비운다
    try { wl.draw() } catch (e) { return null }
    const st = wl.labelStat || { shown:0, total:0, side:{} };
    return { shown: st.shown, total: st.total, side: Object.assign({}, st.side) };
  };

  const baseSide = {};
  (wl.A || []).forEach(n => { baseSide[n.side || '(없음)'] = (baseSide[n.side || '(없음)'] || 0) + 1 });
  const baseTot = (wl.A || []).length || 1;

  const far = snapLabels(0.5);     // 전체 보기 — 결과 숫자만
  const near = snapLabels(1.0);    // 확대 — 전 종류

  if (!far || !near || !near.total) F('이름표 통계(labelStat)가 비어 있다 — 배치 계획이 안 돌았다');
  else {
    console.log(`18. 이름표 진영     멀리 ${far.shown}/${far.total}개 · 확대 ${near.shown}/${near.total}개 (자동 판정 없음)`);
    const rows = Object.keys(baseSide)
      .filter(k => baseSide[k] >= 8)
      .sort((a, b) => baseSide[b] - baseSide[a]);
    rows.forEach(k => {
      const bp = baseSide[k] / baseTot * 100;
      const np = (near.side[k] || 0) / (near.shown || 1) * 100;
      const gap = np - bp, arrow = gap > 0 ? '▲' : gap < 0 ? '▼' : ' ';
      console.log(`     ${(SIDE_LAB18[k] || k).padEnd(4)} 화면 ${bp.toFixed(1).padStart(5)}%` +
        ` → 확대 시 이름표 ${np.toFixed(1).padStart(5)}%  ${arrow}${Math.abs(gap).toFixed(1)}%p` +
        `  (${near.side[k] || 0}/${baseSide[k]})`);
    });
    const bB = baseSide.blue || 0, bR = baseSide.red || 0;
    const nB = near.side.blue || 0, nR = near.side.red || 0;
    if (bR && nR) {
      const bRatio = bB / bR, sRatio = nB / nR;
      console.log(`     진보/보수 화면 ${bRatio.toFixed(2)}:1 → 이름표 ${sRatio.toFixed(2)}:1`);
      if (sRatio > bRatio * 1.3)
        W(`이름표 진영 기울기가 커졌다: 화면 ${bRatio.toFixed(2)}:1 → 이름표 ${sRatio.toFixed(2)}:1` +
          ` — 우선순위가 한쪽을 밀어올린다. 손으로 맞추지 말고 데이터로 푼다`);
    } else if (bR && !nR) {
      W(`확대해도 이름표에 보수 진영이 하나도 없다 (화면에는 ${bR}개)`);
    }
    // 멀리서는 결과 숫자만 나오는 게 설계다. 그게 깨지면 알아야 한다.
    const farNonGold = Object.keys(far.side).filter(k => k !== 'gold')
      .reduce((a, k) => a + far.side[k], 0);
    if (far.shown && farNonGold)
      W(`전체 보기에서 결과 숫자가 아닌 이름표가 ${farNonGold}개 그려진다 (설계는 결과만)`);
  }

  // 14. 스크립트 실행 오류
  //     페이지가 멀쩡해 보여도 스크립트가 중간에 죽으면 그 뒤 초기화가 전부 안 돈다.
  //     함수 선언은 호이스팅돼서 이미 정의돼 있으므로 카드도 열리고 검색창도 보인다.
  //     실제로 편집 패널을 DOM 에서 먼저 지웠더니 그 요소에 핸들러를 붙이는 줄에서
  //     null 을 만나 멈췄고, 그 뒤 안내문·검색 초기화가 통째로 죽었는데 npm test 는 PASS 였다.
  const scriptErrs = [...new Set(scriptErrors)];
  scriptErrs.slice(0, 10).forEach(m => F(`스크립트 오류: ${String(m).split('\n')[0].slice(0, 110)}`));
  console.log(`14. 스크립트 오류   ${scriptErrs.length === 0 ? 'PASS' : 'FAIL (' + scriptErrs.length + ')'}`);

  // 19. 고정 패널이 화면 세로를 넘치는가
  //     .rail 은 position:fixed 라 내용이 화면보다 길면 그냥 잘린다.
  //     실제로 진영 필터와 라이선스 카드가 그렇게 잘려 있었다 —
  //     다 보려면 화면 높이 1683px 이 필요한데 그런 화면은 없다.
  //     기능이 통째로 사라지는데 화면은 멀쩡해 보인다.
  //
  //     jsdom 은 레이아웃을 안 한다. scrollHeight·offsetHeight 가 전부 0 이라
  //     "넘쳤는지" 를 실제로 잴 수 없다. 스텁이 0 을 주면 검사는 조용히 통과한다.
  //     그래서 높이를 재지 않고 CSS 계약을 강제한다 —
  //     세로 한계(bottom 또는 max-height)와 overflow-y 가 둘 다 있어야 한다.
  //     둘 중 하나만 있으면 못 막는다: 한계가 없으면 안 잘리고 넘치고,
  //     overflow 가 없으면 잘린 데 손이 안 닿는다.
  {
    const FIXED_PANELS = ['.rail'];          // position:fixed 로 화면에 붙는 긴 패널
    const blocks19 = topLevelCss(html);
    let checked = 0;

    for (const sel of FIXED_PANELS) {
      /* 같은 셀렉터의 선언을 순서대로 모은다. 뒤엣것이 이긴다. */
      const decls = [];
      /* 주석을 먼저 지운다. 안 지우면 주석이 셀렉터 머리에 붙어 매칭이 안 된다 —
         7번 사고(중복을 하나도 못 잡은 중복 검사)와 같은 종류다. */
      const decomment = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ');
      for (const b of blocks19) {
        const re = new RegExp('(^|[},;])\\s*' + sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}', 'g');
        let m;
        const raw = decomment(b.text);
        const body = b.media ? raw.slice(raw.indexOf('{') + 1) : raw;
        while ((m = re.exec(body))) decls.push({ media: b.media, css: m[2] });
      }
      if (!decls.length) { F(`19. ${sel} 규칙을 못 찾았다 — 검사가 아무것도 안 보고 있다`); continue }
      checked++;

      /* 미디어쿼리 밖(= 모든 폭에 적용되는) 선언만 본다.
         좁은 화면 규칙은 뒤에서 따로 덮으므로 기본이 안전해야 한다. */
      const base = decls.filter(d => !d.media).map(d => d.css).join(';');
      const prop = (name) => {
        const mm = base.match(new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'g'));
        return mm ? mm[mm.length - 1].split(':').slice(1).join(':').trim() : null;
      };
      const bottom = prop('bottom');
      const maxH   = prop('max-height');
      const ovf    = prop('overflow-y') || prop('overflow');
      const bound  = (bottom && bottom !== 'auto') || (maxH && maxH !== 'none');
      const scroll = ovf && /auto|scroll/.test(ovf);

      if (!bound)
        F(`19. ${sel} 에 세로 한계가 없다 (bottom·max-height 둘 다 없음) — 화면보다 길면 잘린다`);
      if (!scroll)
        F(`19. ${sel} 에 overflow-y:auto 가 없다 — 잘린 부분에 손이 닿지 않는다`);

      /* 뒤에 오는 미디어쿼리가 overflow 를 되돌리면 헛일이다 */
      for (const d of decls.filter(d => d.media)) {
        const o = d.css.match(/overflow(?:-y)?\s*:\s*(visible|hidden)/);
        if (o) F(`19. ${sel} 이 미디어쿼리 안에서 overflow:${o[1]} 로 되돌아간다 — 기본 규칙이 무력화된다`);
      }

      console.log(`19. 패널 넘침       ${sel} 세로한계 ${bound ? (bottom ? 'bottom:' + bottom : 'max-height:' + maxH) : '없음'} · 스크롤 ${scroll ? ovf : '없음'} · 선언 ${decls.length}곳`);
    }
    if (!checked) F('19. 검사한 패널이 0개다 — 아무것도 안 잡는 검사다');
  }

  // 20. 노드를 눌렀을 때 이어진 것이 화면 안에 있는가 · 반지름이 안 흔들렸는가
  //     고치기 전: 폰 2/6(33%) · 태블릿 세로 3/6(50%). 조작이 안 되는 문제였다.
  //     각도만 모아서 푼다 — 반지름은 연도라서 흔들리면 연도가 거짓말이 된다.
  //     그래서 두 가지를 같이 잰다. 하나만 재면 다른 하나가 조용히 깨진다.
  {
    const SIZES20 = [[412,915,'폰'],[820,1180,'태블릿 세로'],[1440,900,'노트북']];
    for (const [w,h,nm] of SIZES20) {
      const d20 = boot(w,h);
      await new Promise(r => setTimeout(r, 1200));
      const win = d20.window;
      const r = win.eval(`(function(){
        if(typeof setFocus!=='function'||typeof A==='undefined'||!A.length)return null;
        var c=A.filter(function(n){return n.t==='result'&&adj[n.id]});
        if(!c.length)return null;
        var t=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
        setFocus(t.id);
        /* jsdom 스텁은 모든 요소에 창 전체 크기를 준다. 실물은 카드가 열리면
           #stage 가 줄어든다 — 폰 412x915 에서 실제 지도는 412x518 이었다.
           스텁 값을 그대로 쓰면 검사가 실물보다 넓은 화면을 가정해
           통과하는데 실물은 화면 밖인 상태가 생긴다.
           CSS 의 카드 규칙(<=620 bottom:32dvh, <=1000 62dvh, 그 위 right:448px)으로
           지도 크기를 근사한다. 실물 브라우저 값과 대조해 맞췄다. */
        /* 카드가 열리면 지도가 줄어든다. CSS 의 카드 높이와 맞춘다 —
           <=620 은 32dvh, 621~1000 은 38dvh, 그 위는 오른쪽 448px.
           상단바+검색은 실측 104px. 폰 412x915 에서 지도 412x518 로 맞았다.
           이 숫자가 CSS 와 어긋나면 검사가 실물보다 넓은 화면을 가정하게 된다. */
        /* 카드가 열리면 지도가 줄어든다. CSS 의 카드 규칙과 맞춘다 —
           높이 <=520 이고 폭 >=620 이면 옆으로 붙는다 (min(380px,46vw)),
           그 밖에는 아래로: <=620 은 32dvh, 621~1000 은 38dvh, >1000 은 오른쪽 448px.
           상단바+검색은 실측 104px(가로 화면은 58px). 폰 412x915 에서 412x518 로 맞았다. */
        var pw=${w}, ph=${h};
        if(ph<=520&&pw>=620){
          var cw=Math.min(380, pw*0.46);
          W = pw-cw; H = ph-114;
        } else {
          W = pw>1000 ? pw-448 : pw;
          H = pw>1000 ? ph-104
            : Math.round(ph*(pw<=620?0.68:0.62)-104);
        }
        if(typeof gatherFan==='function')gatherFan();   /* 크기를 고친 뒤에 모은다 */
        for(var i=0;i<420;i++)tick();
        if(typeof fitFocus==='function')fitFocus();
        cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        for(var i=0;i<40;i++)tick();
        var nb=Object.keys(ring).filter(function(k){return ring[k]===1});
        var inn=0;
        nb.forEach(function(k){var n=map[k];if(!n)return;
          var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
          if(sx>=0&&sx<=W&&sy>=0&&sy<=H)inn++});
        var drift=0,worst=0,checked=0;
        A.forEach(function(n){ if(typeof n.tang!=='number')return; checked++;
          var R=ringR(n), rr=Math.hypot(n.x,n.y/0.86);
          var dd=Math.abs(rr-R); if(dd>1)drift++; if(dd>worst)worst=dd});
        var lblOn=nb.filter(function(k){return map[k]&&labelOn(map[k])}).length;
        return {nb:nb.length, inn:inn, s:+cam.s.toFixed(2), lbl:lblOn,
                mw:W, mh:H, drift:drift, worst:+worst.toFixed(1), checked:checked};
      })()`);
      d20.window.close();

      if (!r) { F(`20. ${nm} ${w}px — 측정 자체를 못 했다 (setFocus·A 가 없다)`); continue }

      const pct = r.nb ? Math.round(100*r.inn/r.nb) : 0;
      console.log(`20. 연결 화면안     ${nm} ${w}×${h} (지도 ${r.mw}×${r.mh}) · ${r.inn}/${r.nb}개 (${pct}%) · 배율 ${r.s} · 이웃 이름표 ${r.lbl}/${r.nb} · 반지름 흔들림 ${r.drift}/${r.checked}개(최대 ${r.worst}px)`);

      /* 0 은 의심한다. 이웃이 0개면 잰 게 없는 것이지 통과가 아니다. */
      if (!r.nb) { F(`20. ${nm} — 이웃이 0개라 아무것도 못 쟀다`); continue }
      if (!r.checked) F(`20. ${nm} — 각도를 모은 노드가 0개다. 부채꼴이 아예 안 돌았다`);
      if (pct < 100) F(`20. ${nm} ${w}×${h} — 이어진 것 ${r.nb - r.inn}개가 화면 밖이다 (${r.inn}/${r.nb})`);
      if (r.drift)   F(`20. ${nm} — 반지름이 흔들린 노드 ${r.drift}/${r.checked}개 (최대 ${r.worst}px). 연도가 거짓말이 된다`);
      /* 배율 바닥(FIT_MIN 0.45)까지는 허용한다. 우선순위는 '이어진 것이 보이는 것' 이다.
         이름표 하한(0.62) 밑으로 내려가면 이름이 준다는 사실은 WARN 으로 남긴다. */
      if (r.s < 0.45) F(`20. ${nm} — 배율 ${r.s} 가 바닥 0.45 미만이다. 점만 남는다`);
      else if (r.s < 0.62) W(`20. ${nm} — 배율 ${r.s} 가 이름표 하한 0.62 미만이다 (이웃 이름표 ${r.lbl}/${r.nb}). 지도가 ${r.mw}×${r.mh} 로 좁아서다 — 카드 높이 문제다`);
      /* 이름표는 판정하지 않는다. 카드가 폰 화면의 43% 를 먹어 지도가 412×518 밖에 안 되고,
         부채꼴 폭을 0.10~0.30 으로 훑어도 2~3/6 에서 안 올라간다(실물 측정).
         물리적 한계라 자동 판정하면 못 고칠 FAIL 이 된다. 눈앞에 띄우는 것까지가 검사의 역할이다. */
    }
  }

  // 21. 화면 크기가 뒤늦게 바뀐 뒤에도 다시 맞추는가
  //     폰·폴드는 주소창이 접히며 화면이 커진다. 그때 카메라가 다시 안 맞으면
  //     한쪽으로 쏠린 채 남는다. 전에는 reheat 뒤 420ms 에 fit() 을 불렀는데
  //     가라앉는 데 270틱(4.5초)이 걸려 한창 움직이는 중에 맞추고 있었다.
  //     첫 화면 자체는 26번이 8개 해상도로 잰다. 여기는 '크기가 바뀐 뒤' 만 본다.
  {
    const d21 = boot(344, 700);              // 주소창이 보이는 상태
    await new Promise(r => setTimeout(r, 1300));
    const win = d21.window;
    const r = win.eval(`(function(){
      var mid=function(){
        var on=[];
        A.forEach(function(n){var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
          if(sx>=0&&sx<=W&&sy>=0&&sy<=H)on.push([sx,sy])});
        if(!on.length)return null;
        var cx2=0,cy2=0; on.forEach(function(p){cx2+=p[0];cy2+=p[1]});
        return Math.round(Math.hypot(cx2/on.length-W/2, cy2/on.length-H/2));
      };
      var t=0; while(alpha>=0.02&&t<900){tick();t++}
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      var before=mid();
      /* 주소창이 접혀 화면이 커졌다 — 물리가 다시 데워진다 */
      H=882; W=344; setAngles(); reheat(0.35);
      var t2=0; while(alpha>=0.02&&t2<900){tick();t2++}    /* 가라앉음을 보고 기다린다 */
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      return {before:before, after:mid(), ticks:t2,
              has:typeof refitWhenSettled==='function'};
    })()`);
    d21.window.close();
    console.log(`21. 화면 커진 뒤    폴드 접힘 344 · 무리 중심 ${r.before}px → ${r.after}px (${r.ticks}틱 기다림)`);
    if (!r.has) F('21. refitWhenSettled 가 없다 — 화면이 커진 뒤 다시 맞추는 경로가 사라졌다');
    if (r.after == null) F('21. 화면이 커진 뒤 노드가 하나도 안 보인다');
    else if (r.after > 60) F(`21. 화면이 커진 뒤 무리 중심이 ${r.after}px 어긋났다`);
    if (r.ticks < 20) F(`21. ${r.ticks}틱 만에 가라앉았다 — 물리가 안 도는 것일 수 있다`);
  }

  // 22. 고리 밀도 — 어느 시기가 넘치는가
  //     '전체 보기' 에서 노드가 한쪽에 뭉치는 원인이다.
  //     각도는 고르다(12방향에 10~20개). 문제는 반지름이다 —
  //     84년을 680px 에 넣어 1년당 8.1px 인데 노드 지름은 12~74px 이다.
  //     그래서 최근처럼 노드가 많은 시기는 고리 넓이보다 노드 면적이 커진다.
  //     자동 판정하지 않는다. 데이터가 늘면 자연히 변하는 값이고,
  //     고치는 건 흩뿌리는 방식을 바꾸는 일이라 사람이 정할 문제다.
  //     매 실행마다 눈앞에 띄우는 것까지가 검사의 역할이다.
  {
    const d22 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1200));
    const r = d22.window.eval(`(function(){
      if(typeof pyOf!=='function'||!A.length)return null;
      var g={};
      A.forEach(function(n){var b=Math.floor(pyOf(n)/10)*10;(g[b]=g[b]||[]).push(n)});
      var years=Object.keys(g).map(Number).sort(function(a,b){return a-b});
      var rows=years.map(function(y){
        var r1=radY(y), r2=radY(y+10);
        var lo=Math.min(r1,r2), hi=Math.max(r1,r2);
        var area=Math.PI*0.93*(hi*hi-lo*lo);
        var used=0;
        g[y].forEach(function(n){used+=Math.max(2*n.r,(n.lw||60))*(2*n.r+(n.lh||24))});
        return {y:y, n:g[y].length, p:area>0?used/area:0};
      });
      return {rows:rows, perYear:+((ROUT-RIN)/(RY1-RY0)).toFixed(1)};
    })()`);
    d22.window.close();
    if (!r) F('22. 고리 밀도를 못 쟀다');
    else {
      const over = r.rows.filter(x => x.p > 1);
      const mx = r.rows.reduce((a, b) => b.p > a.p ? b : a);
      const mn = r.rows.reduce((a, b) => b.p < a.p ? b : a);
      console.log(`22. 고리 밀도       1년당 반지름 ${r.perYear}px · 최대 ${mx.y}년대 ${(mx.p*100).toFixed(0)}% · 최소 ${mn.y}년대 ${(mn.p*100).toFixed(0)}% · 차이 ${(mx.p/Math.max(mn.p,1e-6)).toFixed(0)}배 · 넘치는 연대 ${over.length}/${r.rows.length}개`);
      r.rows.forEach(x => {
        const bar = '█'.repeat(Math.min(20, Math.round(x.p * 10)));
        console.log(`     ${x.y}년대 ${String(x.n).padStart(3)}개  ${String((x.p*100).toFixed(0)+'%').padStart(5)} ${bar}${x.p > 1 ? '  ← 넘침' : ''}`);
      });
      /* 넘치면 FAIL 이다. 수집기가 데이터를 넣으면 다시 넘칠 텐데,
         그때 조용히 뭉치면 화면만 나빠지고 아무도 모른다. */
      if (over.length) F(`22. 고리 밀도 — ${over.map(x => x.y + '년대 ' + (x.p*100).toFixed(0) + '%').join(', ')} 가 고리 넓이를 넘는다 (100% 초과). 고리 폭 배분을 다시 봐야 한다 (docs/고리밀도.md)`);
    }
  }

  // 23. 물리가 끝나길 시계로 기다리는 자리가 있는가
  //     reheat(0.85) 뒤 alpha 가 0.02 까지 내려가는 데 약 180틱(3초)이 걸린다.
  //     그런데 setTimeout(fit, 260~320) 으로 16~19틱 만에 맞추던 자리가 여덟 군데 있었다.
  //     420ms 짜리는 폰에서만 우연히 맞았고 폴드 접힘에서 화면이 한쪽으로 쏠렸다.
  //     시계로 물리를 기다리면 기기마다 다르게 틀린다. 가라앉음(alpha)을 보고 맞춰야 한다.
  {
    const src = html;
    /* reheat 뒤에 시계로 fit 을 부르는 꼴을 찾는다 */
    const bad = [];
    /* setInterval 도 본다 — setTimeout 만 보다가 시간 방향 뒤집기의
       setInterval(…alpha<0.03…fit()) 를 놓쳤다. 그건 가라앉음을 보긴 했지만
       기준이 refitWhenSettled 와 달라 따로 관리되는 자리였다. */
    const re = /set(?:Timeout|Interval)\(\s*(?:function\s*\([^)]*\)\s*\{[^}]*\b(?:fit|fitFocus)\s*\(|fit\s*,|fitFocus\s*,)/g;
    let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split('\n').length;
      const near = src.slice(Math.max(0, m.index - 260), m.index);
      if (/reheat\s*\(/.test(near)) bad.push(`${line}줄`);
    }
    const has = /function\s+refitWhenSettled/.test(src);
    const uses = (src.match(/refitWhenSettled\s*\(/g) || []).length;
    console.log(`23. 물리 대기        시계로 기다리는 자리 ${bad.length}곳 · refitWhenSettled ${has ? '있음' : '없음'} · 쓰는 곳 ${uses}군데`);
    if (bad.length) F(`23. reheat 뒤 시계로 fit 을 부르는 자리 ${bad.length}곳 (${bad.join(', ')}) — 기기마다 다르게 틀린다. refitWhenSettled 를 써라`);
    if (!has) F('23. refitWhenSettled 가 없다 — 가라앉음을 보고 맞추는 경로가 사라졌다');
    /* 0 은 의심한다. 아무 데서도 안 쓰면 검사가 통과해도 의미가 없다. */
    if (has && uses < 3) F(`23. refitWhenSettled 를 ${uses}군데서만 쓴다 — 대부분이 아직 시계로 기다리는 것일 수 있다`);
  }

  // 24. 상수를 쓰는 곳보다 뒤에 선언했는가 (var 호이스팅)
  //     var 는 선언만 끌어올리고 값은 안 끌어올린다.
  //     NARROW_MIN_S = LABEL_FAR 를 LABEL_FAR 선언보다 앞에 두었더니
  //     undefined 가 됐고, 이름표가 171/171 개 그려지며 겹침이 314쌍 났다.
  //     문법 오류가 아니고 에러도 안 난다. 화면을 보기 전까지 모른다.
  {
    const a = html.indexOf('<script>'), b = html.lastIndexOf('</script>');
    const js = a >= 0 ? html.slice(a + 8, b) : '';
    const lines = js.split('\n');
    /* 줄 맨 앞에서 시작하는 var 만 본다 — 함수 안쪽은 실행 시점이 달라 판단이 다르다 */
    const decl = new Map();                 // 이름 → 선언 줄
    const inits = [];                       // {name, line, expr}
    lines.forEach((ln, i) => {
      const m = ln.match(/^var\s+(.*)$/);
      if (!m) return;
      /* var A=1, B=2 형태를 쉼표로 나눈다 (괄호 안 쉼표는 무시) */
      let depth = 0, cur = '', parts = [];
      for (const ch of m[1]) {
        if ('([{'.includes(ch)) depth++;
        if (')]}'.includes(ch)) depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
        cur += ch;
      }
      parts.push(cur);
      parts.forEach(pt => {
        const mm = pt.match(/^\s*([A-Za-z_$][\w$]*)\s*(=\s*([\s\S]*))?$/);
        if (!mm) return;
        if (!decl.has(mm[1])) decl.set(mm[1], i + 1);
        if (mm[3]) inits.push({ name: mm[1], line: i + 1, expr: mm[3] });
      });
    });

    const bad = [];
    inits.forEach(d => {
      /* 초기값에 쓰인 이름 중, 같은 최상위 var 인데 더 뒤에서 선언된 것 */
      const ids = d.expr.match(/[A-Za-z_$][\w$]*/g) || [];
      new Set(ids).forEach(id => {
        if (id === d.name) return;
        const at = decl.get(id);
        if (at && at > d.line) bad.push(`${d.name}(${d.line}줄)이 ${id}(${at}줄)를 먼저 쓴다 — undefined 다`);
      });
    });

    console.log(`24. 선언 순서       최상위 var ${decl.size}개 · 값 있는 것 ${inits.length}개 · 뒤엣것을 먼저 쓰는 자리 ${bad.length}곳`);
    bad.forEach(m2 => F(`24. ${m2}`));
    /* 0 은 의심한다. 아무것도 못 읽었으면 검사가 빈손이다. */
    if (!decl.size) F('24. 최상위 var 를 하나도 못 찾았다 — 검사가 아무것도 안 보고 있다');
  }

  // 25. 반지름 순서가 연도 순서와 맞는가
  //     C안은 고리 폭을 노드 개수에 비례해 나눈다. 비례는 잃어도 **순서는 지켜야 한다.**
  //     안쪽이 항상 과거, 바깥이 항상 최근(또는 시간 방향을 뒤집으면 그 반대).
  //     이게 깨지면 지도가 거짓말이 된다 — 1970년 법안이 2020년 법안보다 바깥에 놓인다.
  {
    const d25 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1200));
    const r = d25.window.eval(`(function(){
      if(typeof radY!=='function')return null;
      var out={};
      [false,true].forEach(function(dir){
        timeOut=dir;
        if(typeof ringLUT!=='undefined')ringLUTKey='';   /* 표를 다시 만들게 */
        var ys=[];
        for(var y=RY0;y<=RY1;y++)ys.push({y:y,r:radY(y)});
        /* 방향을 정한다 — 첫 값과 끝 값 중 어느 쪽이 큰가 */
        var inc = ys[ys.length-1].r > ys[0].r;
        var bad=[];
        for(var i=1;i<ys.length;i++){
          var d=ys[i].r-ys[i-1].r;
          if(inc? d < -0.01 : d > 0.01)
            bad.push(ys[i-1].y+'→'+ys[i].y+' ('+ys[i-1].r.toFixed(1)+'→'+ys[i].r.toFixed(1)+')');
        }
        out[dir?'timeOut':'timeIn']={
          bad:bad, n:ys.length, dir:inc?'연도↑ 반지름↑':'연도↑ 반지름↓',
          rin:+ys[0].r.toFixed(1), rout:+ys[ys.length-1].r.toFixed(1)};
      });
      timeOut=true; ringLUTKey='';
      return out;
    })()`);
    d25.window.close();
    if (!r) F('25. radY 를 못 불렀다');
    else {
      Object.keys(r).forEach(k => {
        const x = r[k];
        console.log(`25. 반지름 순서     ${k.padEnd(8)} ${x.dir} · ${x.rin}→${x.rout}px · 어긋난 곳 ${x.bad.length}/${x.n - 1}`);
        if (x.bad.length) F(`25. ${k} — 반지름 순서가 연도 순서와 어긋난 곳 ${x.bad.length}곳 (${x.bad.slice(0,3).join(', ')}). 안쪽이 항상 과거여야 한다`);
      });

      /* 고리 간격이 실제 시간 간격과 다르다는 것을 화면에 밝히는가.
         C안은 시간 축을 비선형으로 만든다. 밝히지 않으면 시간을 왜곡해 보여주는 게 된다.
         정확성 문제라 문구가 사라지면 FAIL 이다.
         워터마크 검사(16번)와 같은 방식으로 fillText 를 가로채 실제로 그려지는지 본다. */
      for (const [vw, vh] of [[412, 915], [1440, 900]]) {
        const dN = boot(vw, vh);
        await new Promise(rr => setTimeout(rr, 1100));
        const drawn = dN.window.eval(`(function(){
          var seen=[];
          var g=cv.getContext('2d');
          var real=g.fillText;
          g.fillText=function(t){seen.push(String(t));return real&&real.apply(g,arguments)};
          try{draw()}catch(e){}
          g.fillText=real;
          return seen;
        })()`) || [];
        dN.window.close();
        const hit = drawn.some(t => /고리 간격은 실제 시간 간격과 다릅니다/.test(t));
        console.log(`25. 간격 안내       ${vw}px · ${hit ? '그려짐' : '없음'} (그린 글자 ${drawn.length}개)`);
        if (!drawn.length) F(`25. ${vw}px — fillText 를 하나도 못 잡았다. 검사가 화면을 안 보고 있다`);
        else if (!hit) F(`25. ${vw}px — '고리 간격은 실제 시간 간격과 다릅니다' 가 화면에 없다. 시간 축이 비선형인데 밝히지 않으면 왜곡이다`);
      }
      /* 0 은 의심한다. 재본 구간이 없으면 통과가 아니라 빈손이다. */
      if (!Object.keys(r).length) F('25. 재본 방향이 0개다');
    }
  }

  // 26. 첫 화면 — 중앙에 오는가, 고루 퍼지는가
  //     처음 들어왔을 때 화면이 이상한 문제가 계속 났다. 매번 원인은 달랐지만
  //     (fit 을 시계로 기다림 / 낡은 H / 배율 1.0 / 노드 하나만 중앙에)
  //     결과는 늘 같았다 — 들어오면 한쪽으로 쏠려 있거나 텅 비어 있다.
  //     그래서 결과 쪽을 잰다. 원인이 무엇이든 이 숫자가 나빠지면 잡힌다.
  //
  //     반드시 '가라앉은 뒤' 를 잰다. 지금까지 틀린 이유가 전부 그거였다.
  //     칸은 정사각형으로 나눈다 — 3×3 은 화면비에 휘둘린다.
  //     빈 칸은 '노드가 놓인 상자 안' 에서만 센다.
  //     고리 배치라 화면 네 귀퉁이는 원래 비는데, 그걸 세면 늘 나쁘게 나온다.
  {
    const OFF_MAX = 6;      // 중심 어긋남 한도 (화면 대각선의 %)
    const EMPTY_MAX = 45;   // 노드 상자 안 빈 칸 한도 (%)
    for (const [w, h] of VIEWPORTS) {
      const d26 = boot(w, h);
      await new Promise(r => setTimeout(r, 1100));
      const r = d26.window.eval(`(function(){
        if(typeof fit!=='function'||!A.length)return null;
        var t=0; while(alpha>=0.02&&t<900){tick();t++}      /* 가라앉을 때까지 */
        fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        for(var i=0;i<30;i++)tick();
        labelSet=null;labelKey='';draw();
        var on=[];
        A.forEach(function(n){var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
          if(sx>=0&&sx<=W&&sy>=0&&sy<=H)on.push([sx,sy])});
        if(!on.length)return {ticks:t,on:0,tot:A.length};
        var INS=(typeof mapInsetLeft==='function')?mapInsetLeft():0;
        var cx2=0,cy2=0; on.forEach(function(p){cx2+=p[0];cy2+=p[1]});
        cx2/=on.length; cy2/=on.length;
        /* '화면 중앙' 이 아니라 '보이는 영역의 중앙' 이다 — 왼쪽 패널이 지도를 가린다.
           페이지의 viewCX() 를 그대로 부른다. 여기서 따로 계산하면 화면과 갈라진다.
           단 jsdom 은 레이아웃을 안 해 모든 요소가 창 전체 크기로 나오므로
           여기서는 인셋이 늘 0 이다. 패널이 가리는 실제 효과는 브라우저로 확인한다. */
        var CX=(typeof viewCX==='function')?viewCX():W/2;
        var off=Math.hypot(cx2-CX, cy2-H/2), diag=Math.hypot(W,H);
        /* 정사각형 칸 */
        var cell=Math.max(80,Math.min(W,H)/4);
        var gx=Math.ceil(W/cell), gy=Math.ceil(H/cell);
        var g=new Array(gx*gy).fill(0);
        var mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;
        on.forEach(function(p){
          g[Math.min(gy-1,Math.floor(p[1]/cell))*gx+Math.min(gx-1,Math.floor(p[0]/cell))]++;
          mnx=Math.min(mnx,p[0]);mxx=Math.max(mxx,p[0]);
          mny=Math.min(mny,p[1]);mxy=Math.max(mxy,p[1])});
        /* 노드 상자와 겹치는 칸만 센다 */
        var inBox=0, emptyIn=0;
        for(var yy=0;yy<gy;yy++)for(var xx=0;xx<gx;xx++){
          var l=xx*cell,rr=l+cell,tp=yy*cell,bt=tp+cell;
          if(rr<mnx||l>mxx||bt<mny||tp>mxy)continue;
          inBox++; if(!g[yy*gx+xx])emptyIn++;
        }
        return {ticks:t, off:Math.round(off), pct:+(off/diag*100).toFixed(1),
                on:on.length, tot:A.length, lbl:labelStat?labelStat.shown:0,
                emptyIn:emptyIn, inBox:inBox, cells:g.length,
                emptyAll:g.filter(function(v){return v===0}).length,
                s:+cam.s.toFixed(2)};
      })()`);
      d26.window.close();
      if (!r) { F(`26. ${w}×${h} — 첫 화면을 못 쟀다`); continue }
      if (!r.on) { F(`26. ${w}×${h} — 첫 화면에 노드가 하나도 없다 (전체 ${r.tot}개)`); continue }
      const ep = Math.round(100 * r.emptyIn / Math.max(1, r.inBox));
      console.log(`26. 첫 화면        ${String(w + '×' + h).padEnd(10)} 가라앉기 ${String(r.ticks).padStart(3)}틱 · 중심어긋남 ${String(r.off + 'px').padStart(6)} (${r.pct}%) · 화면안 ${r.on}/${r.tot} · 이름표 ${String(r.lbl).padStart(2)} · 빈칸 ${r.emptyIn}/${r.inBox} (${ep}%) · 배율 ${r.s}`);

      if (r.ticks < 20) F(`26. ${w}×${h} — ${r.ticks}틱 만에 가라앉았다. 물리가 안 도는 것일 수 있다`);
      if (r.pct > OFF_MAX) F(`26. ${w}×${h} — 노드 무리 중심이 화면 중심에서 ${r.off}px 어긋났다 (대각선의 ${r.pct}%, 한도 ${OFF_MAX}%)`);
      if (r.on < 20) F(`26. ${w}×${h} — 첫 화면에 노드가 ${r.on}/${r.tot}개뿐이다. 빈 화면으로 보인다`);
      if (!r.lbl) F(`26. ${w}×${h} — 첫 화면에 이름표가 하나도 없다. 색깔 점만 보인다`);
      if (ep > EMPTY_MAX) W(`26. ${w}×${h} — 노드가 놓인 상자 안에서 ${ep}% 가 비어 있다 (${r.emptyIn}/${r.inBox}칸). 한쪽에 뭉쳤을 수 있다`);
    }
  }

  // 27. 카드 규칙이 CSS 와 검사에서 같은 값인가
  //     검사 20·26 은 지도 크기를 근사한다 — jsdom 이 레이아웃을 안 하기 때문이다.
  //     그 근사값이 CSS 와 어긋나면 검사가 실물보다 넓은 화면을 가정하고 통과한다.
  //     실제로 카드를 62dvh → 38dvh 로 바꿨을 때 검사는 62dvh 로 재고 있었다.
  //     그래서 CSS 원문에서 값을 읽어 검사의 가정과 맞는지 본다.
  {
    const want = [
      { re: /@media \(max-width:620px\)[\s\S]{0,4000}?body\.panelon #stage\{[^}]*bottom:(\d+)vh/, want: 32, nm: '≤620 카드 높이(dvh)' },
      { re: /@media \(max-width:1000px\)[\s\S]{0,4000}?body\.panelon #stage\{[^}]*bottom:(\d+)vh/, want: 38, nm: '621~1000 카드 높이(dvh)' },
      { re: /@media \(max-height:520px\)[\s\S]*?body\.panelon #stage\{right:min\((\d+)px/, want: 380, nm: '낮은 가로 카드 폭(px)' },
    ];
    let ok = 0;
    want.forEach(w2 => {
      const m = html.match(w2.re);
      if (!m) { F(`27. CSS 에서 ${w2.nm} 을 못 찾았다 — 검사의 가정이 근거를 잃었다`); return }
      const got = Number(m[1]);
      if (got !== w2.want) F(`27. ${w2.nm} 이 CSS 에서 ${got} 인데 검사는 ${w2.want} 로 가정한다. 검사가 실물과 다른 화면을 재고 있다`);
      else ok++;
    });
    console.log(`27. 카드 규칙       CSS 와 맞는 값 ${ok}/${want.length}개`);
    if (!ok) F('27. 하나도 못 맞췄다 — 검사가 아무것도 안 보고 있다');

    /* PC 에서 왼쪽 패널이 화면 세로를 넘치면 FAIL.
       8장을 다 펴면 2047px 이 돼 스크롤이 생긴다. 접기를 만든 이유가 그 스크롤이었다.
       jsdom 은 레이아웃을 안 해 높이를 못 잰다 — 그래서 코드의 규칙을 강제한다:
       decideRailOpen 이 한 장 펼 때마다 넘침을 보고 되돌리는가.
       실제 높이는 브라우저로 확인했다 (1440x900 → 1장, 1920x1080 → 2장, 둘 다 스크롤 없음). */
    const dr = html.match(/function decideRailOpen\(\)[\s\S]*?\n\}/);
    if (!dr) F('27. decideRailOpen 을 못 찾았다');
    else {
      const body = dr[0];
      if (!/scrollHeight\s*>\s*[\w.]*clientHeight/.test(body))
        F('27. PC 패널 — decideRailOpen 이 넘침을 안 본다. 다 펴면 스크롤이 생긴다');
      else if (!/\.open\s*=\s*false/.test(body))
        F('27. PC 패널 — 넘칠 때 되돌리지 않는다');
      else console.log('27. PC 패널 넘침    한 장 펼 때마다 넘침을 보고 되돌린다 — 확인');
    }
  }

  // 28. 로드 중에 화면을 만져도 첫 화면이 맞는가
  //     검사 26 은 12개 해상도에서 통과하는데 실기기는 왼쪽에 확대된 채로 떴다.
  //     갈라진 조건은 '손가락' 이었다 — camUser 가 1px 이동에도 켜져서
  //     로드 중 한 번만 만져도 첫 화면 맞춤이 영원히 취소됐다.
  //     탭도 미세한 이동을 만든다. 폰에서는 거의 항상 걸린다.
  //     검사가 손가락을 흉내 내지 않아 못 잡았다.
  {
    for (const [w, h] of [[412, 915], [344, 882]]) {
      const d28 = boot(w, h);
      await new Promise(r => setTimeout(r, 1000));
      const r = d28.window.eval(`(function(){
        var mid=function(){
          var on=[];
          A.forEach(function(n){var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
            if(sx>=0&&sx<=W&&sy>=0&&sy<=H)on.push([sx,sy])});
          if(!on.length)return null;
          var cx2=0,cy2=0; on.forEach(function(p){cx2+=p[0];cy2+=p[1]});
          return {off:Math.round(Math.hypot(cx2/on.length-viewCX(), cy2/on.length-H/2)), n:on.length};
        };
        /* 로드 직후 화면을 살짝 만진다 — 탭 한 번 (2px 흔들림) */
        if(typeof down!=='function'||typeof move!=='function'||typeof up!=='function')
          return {skip:'입력 함수를 못 찾음'};
        down(W/2, H/2, true);
        move(W/2+2, H/2+1);
        up();
        var touched = camUser;
        /* 그 뒤 물리가 가라앉고 첫 화면 맞춤이 돈다 */
        var t=0; while(alpha>=0.02&&t<900){tick();t++}
        if(!camUser){ size(); fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty }
        for(var i=0;i<30;i++)tick();
        var m=mid();
        return {touched:touched, off:m?m.off:null, on:m?m.n:0, tot:A.length,
                s:+cam.s.toFixed(2), diag:Math.round(Math.hypot(W,H))};
      })()`);
      d28.window.close();
      if (r && r.skip) { F(`28. ${w}×${h} — ${r.skip}`); continue }
      if (!r || r.off == null) { F(`28. ${w}×${h} — 만진 뒤 노드가 하나도 안 보인다`); continue }
      const pct = +(r.off / r.diag * 100).toFixed(1);
      console.log(`28. 만진 뒤 첫화면  ${w}×${h} · 탭으로 카메라 잡힘 ${r.touched} · 중심 ${r.off}px (${pct}%) · 화면안 ${r.on}/${r.tot} · 배율 ${r.s}`);
      if (r.touched) F(`28. ${w}×${h} — 탭 한 번에 camUser 가 켜졌다. 첫 화면 맞춤이 영영 안 돈다`);
      if (pct > 6) F(`28. ${w}×${h} — 만진 뒤 중심이 ${r.off}px (${pct}%) 어긋났다`);
      if (r.on < 20) F(`28. ${w}×${h} — 만진 뒤 화면에 노드가 ${r.on}/${r.tot}개뿐이다`);
    }
  }

  // 29. 노드를 누른 뒤 화면이 언제 멈추는가
  //     "눌러서 사건을 볼 때도 동그라미들이 지랄같이 움직여서 별로다" — 실제 사용자 말이다.
  //     매일 보는 우리는 익숙해져서 못 봤다.
  //     실측: 초점 중 alpha 바닥이 0.014 로 깔려 있어 물리가 영영 안 멈췄고,
  //     이어진 노드에 1.8~2.6px 궤도 애니메이션까지 돌고 있었다.
  //     5초가 지나도 0.25초마다 2.5px 씩 움직였다.
  //     "살아있는 느낌" 보다 "읽을 수 있는 것" 이 우선이다.
  {
    const d29 = boot(412, 915);
    await new Promise(r => setTimeout(r, 1100));
    const r = d29.window.eval(`(function(){
      var t=0; while(alpha>=0.02&&t<900){tick();t++}
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]});
      if(!c.length)return null;
      var tgt=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
      var prev={}; A.forEach(function(n){prev[n.id]=[n.x,n.y]});
      setFocus(tgt.id); if(typeof gatherFan==='function'){size();gatherFan()}
      var jump=0; A.forEach(function(n){jump=Math.max(jump,Math.hypot(n.x-prev[n.id][0],n.y-prev[n.id][1]))});
      A.forEach(function(n){prev[n.id]=[n.x,n.y]});
      var stop=null, worstAfter=0;
      for(var f=1;f<=300;f++){
        tick();
        if(f%15===0){
          var sum=0,mx=0;
          A.forEach(function(n){var d=Math.hypot(n.x-prev[n.id][0],n.y-prev[n.id][1]);
            sum+=d; if(d>mx)mx=d; prev[n.id]=[n.x,n.y]});
          var avg=sum/A.length;
          /* '멈췄다' 의 기준: 0.25초 동안 평균 1px 미만, 어느 노드도 10px 미만.
             10px/0.25초 = 40px/초 — 한 점이 그 정도 움직이는 건 눈에 안 띈다.
             고치기 전에는 평균 8~10px 에 최대 24~130px 이 5초 넘게 이어졌다.
             선을 여기 두면 그 상태는 확실히 잡고, 잔여 표류는 안 잡는다. */
          if(stop===null&&avg<1.0&&mx<10)stop=f/60;
          if(stop!==null&&f/60>stop+0.5&&mx>worstAfter)worstAfter=mx;
        }
      }
      return {jump:Math.round(jump), stop:stop, alpha:+alpha.toFixed(5),
              after:Math.round(worstAfter)};
    })()`);
    d29.window.close();
    if (!r) F('29. 움직임을 못 쟀다');
    else {
      console.log(`29. 누른 뒤 움직임  재배치 1회 최대 ${r.jump}px · 멈춤 ${r.stop === null ? '5초 안에 안 멈춤' : r.stop.toFixed(2) + '초'} · 이후 최대 ${r.after}px · 마지막 alpha ${r.alpha}`);
      if (r.stop === null) F('29. 5초가 지나도 안 멈춘다 — 화면이 계속 흔들린다');
      else if (r.stop > 2) F(`29. 멈추는 데 ${r.stop.toFixed(2)}초 걸린다. 2초를 넘으면 흔들리는 걸로 보인다`);
      /* 멈춘 뒤에도 계속 움직이면 영구 애니메이션이 남아 있다는 뜻이다 */
      if (r.after > 10) F(`29. 멈춘 뒤에도 ${r.after}px 씩 움직인다 — 영구 애니메이션이 남아 있다`);
      if (r.alpha > 0.01) F(`29. 마지막 alpha 가 ${r.alpha} 다 — 물리가 잠들지 않는다 (바닥이 깔려 있나)`);
    }
  }

  // 30. 설명문이 읽을 수 있게 쓰였는가
  //     "모르는 사람은 사건 설명이 어려워서 안 볼 것 같다" — 실제 사용자 말이다.
  //     정치·정책을 아는 사람만 읽을 수 있으면 이 사이트는 실패다.
  //     강제가 없으면 또 어려운 글이 들어온다. 특히 API 로 법안이 자동으로 들어오면
  //     "~에 관한 법률 일부개정법률안" 같은 게 그대로 쌓인다. 그때를 대비한 검사다.
  //
  //     본보기는 이미 데이터 안에 있다 — tip 은 쉽고 body 만 어렵다.
  //     새 기준을 만들 게 아니라 body 를 tip 의 말투로 옮기면 된다.
  {
    const d30 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1200));
    const r = d30.window.eval(`(function(){
      if(typeof N==='undefined')return null;
      /* 설명 없이 쓰면 안 되는 말. 법·행정 용어라 아는 사람만 안다. */
      var HARD=['일부개정법률안','전부개정','제정법률안','부칙','시행령','시행규칙',
        '소관위','의결','가결','부결','상정','계류','공포','재의','환부','위헌','합헌',
        '제청','인준','탄핵소추','직무정지','권한대행','대통령령','부령','훈령',
        '누진제','역진성','기저효과','실효세율','과표','공시가격','귀속','산정','추계',
        '유예','소급','경과규정','준용','의제','기속','재량','불기소','이관','환수',
        '상한제','민간택지','대표발의','자동 폐기','임기만료폐기','대안반영폐기'];
      /* 문장 경계는 마침표만이 아니다. 줄바꿈도 경계다 —
         '법원 판결이나 공식 처분으로 확정된 기록입니다' 같은 안내문이
         \n\n 로 덧붙는데, 그걸 앞 문장과 한 덩어리로 세면 없는 문제가 생긴다.
         실제로 60자 넘는 문장이 83개로 부풀어 있었다. */
      function sents(t){return String(t||'').split(/(?<=[.!?])\\s+|\\n+/).map(function(x){return x.trim()}).filter(Boolean)}
      var longs=[], hard=[], tone={seum:0, da:0, other:0}, toneBad=[];
      N.forEach(function(n){
        if(n.ghost)return;
        var b=String(n.body||'').trim();
        if(!b)return;
        /* (1) 긴 문장 */
        sents(b).forEach(function(x){ if(x.length>60)longs.push({lab:n.lab,len:x.length,s:x.slice(0,34)}) });
        /* (2) 어려운 말을 설명 없이 — 그 말이 든 문장에 괄호가 없으면 설명이 없는 것이다 */
        HARD.forEach(function(w){
          if(b.indexOf(w)<0)return;
          var has=sents(b).some(function(x){return x.indexOf(w)>=0 && /[（(][^)）]{2,}[)）]/.test(x)});
          if(!has)hard.push({lab:n.lab,w:w});
        });
        /* (3) 말투.
           존댓말은 '습니다' 만이 아니다 — 입니다·됩니다·아닙니다·다릅니다 도 존댓말이다.
           '습니다' 로만 재다가 42개를 반말로 잘못 셌다. 없는 문제를 볼 뻔했다.
           존댓말의 공통 꼬리는 '니다' 다. */
        /* 끝의 마침표와 괄호 설명을 걷어내고 본다 — '…넘어갔습니다(이관).' 같은 꼴 때문이다.
           그리고 인물 연표 항목은 문장이 아니라 명사구다 ('열린우리당 입당', '제19대 · 2014.06까지').
           그런 것까지 존댓말로 바꾸면 오히려 어색하다. 서술어가 없으면 판정에서 뺀다.
           27개를 말투 문제로 세다가 거짓 경보를 낼 뻔했다. */
        var nb=b.replace(/\s*[（(][^)）]*[)）]\s*$/,'').replace(/[.]$/,'').trim();
        if(!/(다|음|함)$/.test(nb)){tone.other++; return}     /* 명사구 — 연표 항목 */
        if(/니다$/.test(nb))tone.seum++;
        else {tone.da++; toneBad.push(n.lab)}
      });
      return {longs:longs, hard:hard, tone:tone, toneBad:toneBad,
              total:N.filter(function(n){return !n.ghost&&String(n.body||'').trim()}).length};
    })()`);
    d30.window.close();
    if (!r) F('30. 설명문을 못 읽었다');
    else {
      const uniqLong = new Set(r.longs.map(x => x.lab)).size;
      const uniqHard = new Set(r.hard.map(x => x.lab)).size;
      console.log(`30. 설명문 난이도   설명문 ${r.total}개 · 60자 넘는 문장 ${r.longs.length}개(${uniqLong}카드) · 설명 없는 어려운 말 ${r.hard.length}개(${uniqHard}카드) · 말투 존댓말 ${r.tone.seum} / 반말 ${r.tone.da} / 연표항목 ${r.tone.other}`);
      if (!r.total) F('30. 설명문이 0개다 — 검사가 아무것도 안 보고 있다');
      if (r.longs.length)
        W(`30. 60자 넘는 문장 ${r.longs.length}개 — 두 줄을 넘으면 자른다 (예: ${r.longs.slice(0,2).map(x => x.lab + ' ' + x.len + '자').join(', ')})`);
      if (r.hard.length)
        W(`30. 어려운 말을 설명 없이 쓴 곳 ${r.hard.length}개 — 괄호로 쉬운 말을 붙인다 (예: ${r.hard.slice(0,3).map(x => x.lab + '의 "' + x.w + '"').join(', ')})`);
      /* 명사구(연표 항목)는 세되 판정하지 않는다. 반말이 섞였을 때만 경고한다. */
      if (r.tone.da)
        W(`30. 말투가 섞여 있다 — 존댓말 ${r.tone.seum}개 · 반말 ${r.tone.da}개 (문장 아닌 연표 항목 ${r.tone.other}개는 뺌). 두 사람 글로 느껴진다 (예: ${r.toneBad.slice(0, 3).join(', ')})`);
    }
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
