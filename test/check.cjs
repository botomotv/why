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
       나중에 물어볼 수 없다. 그리는 순간에 받아 적어야 한다.
       좌표와 변환도 같이 적는다 — 겹침을 재려면 화면 어디에 그렸는지 알아야 한다.
       이름표만 따로 계산하면 선 라벨·연도 눈금·배지가 빠진다. 실제로 빠져 있었다. */
    fillText(t, x, y){
      if (!win.__drawn) return;
      win.__drawn.push(String(t));
      const m = this.__m || [1,0,0,1,0,0];
      const sx = m[0]*x + m[2]*y + m[4];
      const sy = m[1]*x + m[3]*y + m[5];
      const sc = Math.sqrt(Math.abs(m[0]*m[3] - m[1]*m[2])) || 1;
      const px = fontPxOf(this.font) * sc;
      win.__texts && win.__texts.push({
        t: String(t), x: sx, y: sy, px,
        w: textWidth(String(t), fontPxOf(this.font)) * sc,
        align: this.textAlign || 'start'
      });
    },
    strokeText(){},translate(){},scale(){},rotate(){},
    setTransform(a,b,c,d,e,f){ this.__m = [a,b,c,d,e,f] },
    setLineDash(){},drawImage(){},clip(){},ellipse(){},
    createLinearGradient:()=>({addColorStop(){}}),
    createRadialGradient:()=>({addColorStop(){}})
  };
  win.__drawn = [];
  win.__texts = [];
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

const TKN = { result:'결과', bill:'법·정책', person:'인물', party:'정당', org:'기관', post:'자리', event:'사건' };

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
  //    규칙 5 는 **우리가 골라 넣은 법안**에 대한 것이다 — 한 법을 소개하면서
  //    좋은 점만 쓰지 말라는 뜻이고, 한쪽 진영에만 비판을 붙이지 말라는 뜻이다.
  //    자동으로 들어온 것(auto)은 우리가 아무 주장도 하지 않는다. 이름·공포일·소관위가
  //    전부고 카드에도 "사람이 내용을 확인하지 않았습니다" 라고 적힌다.
  //    그래서 나눠 센다. 섞으면 손으로 넣은 것의 빈칸이 자동 더미에 묻힌다.
  const bills = N.filter(n => n.t === 'bill');
  const hand = bills.filter(n => !n.auto), autoB = bills.filter(n => n.auto);
  const noLimit = hand.filter(n => !n.limit || !n.limit.length);
  noLimit.forEach(n => W(`limit 칸 비어있음: ${n.id} (${n.lab})`));
  console.log(`6. 법안 남은문제    ${noLimit.length === 0 ? 'PASS' : 'WARN (' + noLimit.length + '/' + hand.length + ' 비어있음)'}   [자동 ${autoB.length}개는 주장을 안 해서 제외]`);

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
  /* ── **손으로 넣은 통계의 출처도 여기서 함께 연다** (검사 53) ──
     값을 사람이 옮겨 적은 노드(`hand:1`)는 우리가 만든 게 아니라 옮긴 것이다.
     그 말이 참이려면 **그 페이지가 실제로 열려야 한다.**
     안 열리면 "출처가 있다" 는 표시만 남고 확인할 방법이 없어진다 — 규칙 7 이 겉으로만 지켜진다.
     지표누리에서 810개 중 334개가 폐지된 통계표였던 것과 같은 종류의 사고다. */
  const linkTargets = [];
  N.forEach(n => { if (n.hand && n.url) linkTargets.push({ id: n.id, lab: n.lab, url: String(n.url), hand: 1 }) });
  /* ── **결과 카드의 근거 링크도 전부 연다** ──
     결과는 지도의 입구다. 거기 붙은 근거가 안 열리면 '출처 있는 척' 이 된다.
     판례·법처럼 형식이 같아 수천 개인 것은 아래 60번이 표본으로 본다 —
     여기서 다 열면 검사가 몇십 분이 된다. 결과는 33개뿐이라 전부 연다. */
  try {
    const RZ = w0.REZ || {};
    for (const id of Object.keys(RZ)) {
      const e = RZ[id];
      if (e && e.u && !linkTargets.some(t => t.url === e.u))
        linkTargets.push({ id: id, lab: (w0.map[id] || {}).lab || id, title: e.s || '원자료', url: String(e.u) });
    }
  } catch {}
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
  //     상한이 필요한 이유는 다시 쟀다 (docs/많이보기.md · 2026-08-25).
  //     선을 50개 붙여도 **이웃 이름표는 데스크톱 9개 · 폰 2개에서 멈춘다.**
  //     겹쳐서가 아니라 배율이 내려가면 labelOn() 이 아예 안 그리기 때문이다.
  //     (옛 근거 '8개에서 63%' 는 부채꼴로 노드를 끌어모으던 시절 측정이라 이제 안 맞는다)
  //     그러니 상한 자체는 못 없앤다. **없애야 하는 것은 거기서 길이 끊기는 것이다** — 검사 42.
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
      /* 앱은 초점을 잡은 뒤 카메라를 맞추고 나서 그린다(refitWhenSettled).
         그 순서를 안 밟고 바로 그리면 노드가 화면 밖에 있어 배지가 안 그려진다 —
         배치를 데이터가 정하게 바꾼 뒤 실제로 그렇게 됐다.
         검사는 사람이 보는 상태를 재야 한다. */
      try {
        we17.size(); if (typeof we17.gatherFan === 'function') we17.gatherFan();
        let t = 0; while (we17.alpha > we17.LAY_STOP && t < 400) { we17.tick(); t++ }
        we17.size();
        if (typeof we17.fitFocus === 'function') we17.fitFocus();
        we17.cam.s = we17.cam.ts; we17.cam.x = we17.cam.tx; we17.cam.y = we17.cam.ty;
      } catch (e) {}
      // 배지는 draw() 안에서 그려진다. 기다리는 대신 직접 부른다.
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
        /* 배지는 이제 "+29" 가 아니라 "+29 모두 보기" 다 — 잘렸다고만 하고 끝내지 않는다.
           앞부분만 맞춰 보고, **'모두 보기' 로 이어지는지**를 따로 본다. */
        const badgeTxt = we17.__drawn.map(String).find(t => t.indexOf('+' + hidden) === 0);
        const note = !!we17.document.querySelector('.cutnote');
        if (!badgeTxt) capProblems.push(`${n.lab}: ${hidden}개를 잘랐는데 지도에 '+${hidden}' 배지가 없다`);
        else if (!/모두 보기/.test(badgeTxt))
          capProblems.push(`${n.lab}: 배지가 '${badgeTxt}' 로 끝난다 — 잘렸다고만 하고 볼 길을 안 준다`);
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

  // 20. 노드를 눌렀을 때 — 카메라가 최선을 다하고, 못 담은 것은 카드에 있는가
  //     약속이 바뀌었다. 전에는 부채꼴로 노드를 끌어와 6/6 을 화면에 담았는데,
  //     그게 "누르면 화면이 통째로 바뀐다" 는 더 나쁜 문제를 만들어 뺐다.
  //     지금 약속은 **노드는 제자리, 카메라만 움직인다** 이다.
  //     폰에서 카드를 연 채로는 지도가 412×518 이라 6개를 다 담으면 배율이 0.30 이 되고
  //     이름표가 6개 중 0~1개만 남는다 — 실측이다. 둘을 동시에 만족할 수 없다.
  //     그래서 지도는 읽히는 쪽을 택하고, 못 담은 것은 카드의 관계 목록이 받는다.
  //     검사는 '몇 개 담겼나' 가 아니라 **'카메라가 할 수 있는 만큼 했나 ·
  //     못 담은 것이 카드에 있나'** 를 본다.
  {
    const SIZES20 = [[412,915,'폰'],[820,1180,'태블릿 세로'],[1440,900,'노트북']];
    for (const [w,h,nm] of SIZES20) {
      const d20 = boot(w,h);
      await new Promise(r => setTimeout(r, 1200));
      const r = d20.window.eval(`(function(){
        if(typeof setFocus!=='function'||!A.length)return null;
        var c=A.filter(function(n){return n.t==='result'&&adj[n.id]});
        if(!c.length)return null;
        var t=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
        /* 먼저 가라앉힌 뒤에 스냅샷을 찍는다. 안 그러면 원래 움직이던 것까지 센다. */
        var t0=0; while(alpha>LAY_STOP&&t0<600){tick();t0++}
        var before={}; A.forEach(function(n){before[n.id]=[n.x,n.y]});
        /* 대조 — 누르지 않고 그냥 200틱. 여기서도 움직이면 setFocus 탓이 아니다. */
        var ROUT0=(typeof ROUT!=='undefined')?ROUT:0;
        for(var iq=0;iq<200;iq++)tick();
        var idle=0; A.forEach(function(n){var b=before[n.id];if(!b)return;
          if(Math.hypot(n.x-b[0],n.y-b[1])>6)idle++});
        A.forEach(function(n){var b=before[n.id];if(b){n.x=b[0];n.y=b[1]}});
        setFocus(t.id);
        var ROUT1=(typeof ROUT!=='undefined')?ROUT:0;
        /* 카드는 이제 지도를 밀지 않는다 — W·H 는 그대로 두고,
           '카드가 안 가리는 자리' 만 따로 구해 거기 들어왔는지를 센다.
           jsdom 은 레이아웃을 안 해 페이지의 mapView() 가 화면 전체를 돌려준다.
           그래서 여기서는 CSS 값으로 그 자리를 만든다 — 그 값이 CSS 와 어긋나지
           않는다는 것은 검사 27번이 지킨다. */
        var pw=${w}, ph=${h}, VW, VH;
        if(ph<=520&&pw>=620){VW=pw-Math.min(380,pw*0.46); VH=ph-114}
        else if(pw>1000){VW=pw-448; VH=ph-104}
        else{VW=pw; VH=Math.round(ph*(pw<=620?0.68:0.62)-104)}
        /* jsdom 은 레이아웃을 안 해 mapView() 가 카드를 못 본다 — 늘 화면 전체를 돌려준다.
           그래서 **검사가 그 자리를 넣어준다.** 여기서 보는 것은
           'fitFocus 가 안 가리는 자리를 실제로 쓰는가' 다. 안 쓰면 아래 selfOff 가 어긋난다.
           mapView() 자체가 맞는지는 브라우저 실측으로 대조한다 (docs/화면점검.md). */
        var mvReal=(typeof mapView==='function')?mapView():null;
        var mvUsed=false;
        if(typeof mapView==='function'){
          mapView=function(){mvUsed=true;return {cx:VW/2,cy:VH/2,w:VW,h:VH}}}
        var t2=0; while(alpha>LAY_STOP&&t2<600){tick();t2++}
        if(typeof fitFocus==='function')fitFocus();
        cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        labelSet=null;labelKey='';draw();
        /* 노드가 제자리에 있나 — 초점 때문에 움직이면 안 된다.
           **약속이 바뀌었다:** 첫 화면은 지도에 100개만 그리고, 초점을 켜면
           그 이웃이 지도에 새로 올라온다. 그래서 A 의 구성원이 바뀐다.
           옛 검사는 A 전체를 before 와 대조해 새 노드에서 터졌다.
           재야 하는 것은 **이미 있던 노드가 움직였나** 다 — 새로 온 것은 새 것이다.
           새로 온 개수도 같이 낸다. 말없이 늘면 그것도 모르는 변화다. */
        /* ── **약속이 바뀌었다** ──
           전에는 "누르는 것만으로는 아무것도 안 움직인다" 였다. 지금은 이어진 것을
           보기 좋은 자리로 **부드럽게 모은다.** 그래서 이웃은 움직이는 게 맞다.
           그래도 **이어지지 않은 노드는 그대로여야 한다** — 그게 남는 보증이다.
           안 그러면 누를 때마다 지도 전체가 출렁여 무엇이 이어졌는지 못 읽는다.
           (부드러움과 반지름 고정은 검사 29·49 가 따로 잰다.) */
        var moved=0, added=0, movedNb=0, who=[];
        A.forEach(function(n){ if(!before[n.id]){added++;return}
          var dd=Math.hypot(n.x-before[n.id][0],n.y-before[n.id][1]);
          if(dd<=6)return;
          if(ring[n.id]!==undefined)movedNb++;
          else {moved++; who.push(n.id+':'+Math.round(dd)+'px')} });
        var nb=Object.keys(ring).filter(function(k){return ring[k]===1});
        var addedN=added;
        var inn=nb.filter(function(k){var n=map[k];if(!n)return false;
          var sx=n.x*cam.s+cam.x,sy=n.y*cam.s+cam.y;
          return sx>=0&&sx<=VW&&sy>=0&&sy<=VH}).length;
        /* 못 담은 것이 카드에 있나 */
        var card=(document.getElementById('detail')||{}).textContent||'';
        var inCard=nb.filter(function(k){return map[k]&&card.indexOf(map[k].lab)>=0}).length;
        var sf=map[focus];
        var selfOff=sf?Math.round(Math.hypot(sf.x*cam.s+cam.x-VW/2, sf.y*cam.s+cam.y-VH/2)):-1;
        return {who:who.slice(0,4).join(' '), idle:idle, rout:Math.round(ROUT1)-Math.round(ROUT0), nb:nb.length, inn:inn, inCard:inCard, moved:moved, movedNb:movedNb, added:addedN, selfOff:selfOff,
                s:+cam.s.toFixed(2), floor:(typeof FIT_MIN==='number')?FIT_MIN:null,
                lbl:nb.filter(function(k){return map[k]&&labelOn(map[k])}).length,
                mw:VW, mh:Math.round(VH), fullW:W, fullH:Math.round(H),
                mvW:mvReal?Math.round(mvReal.w):-1, mvUsed:mvUsed};
      })()`);
      d20.window.close();
      if (!r) { F(`20. ${nm} — 못 쟀다`); continue }
      console.log(`20. 누른 뒤 화면     ${nm} ${w}×${h} (지도 ${r.fullW}×${r.fullH} · 안 가려진 자리 ${r.mw}×${r.mh}) · 화면안 ${r.inn}/${r.nb} · 카드에 ${r.inCard}/${r.nb} · 배율 ${r.s}(바닥 ${r.floor}) · 이름표 ${r.lbl} · 이어진 것 중 움직인 ${r.movedNb} · 이어지지 않았는데 움직인 ${r.moved} · 새로 올라온 ${r.added} · 안 누르고 200틱에 움직인 ${r.idle} · 누른 것 중앙에서 ${r.selfOff}px`);
      /* (0) fitFocus 가 '안 가리는 자리' 를 쓰는가. 안 쓰면 카드 뒤를 겨눈다 */
      if (!r.mvUsed) F(`20. ${nm} — fitFocus 가 mapView() 를 안 쓴다. 카드 뒤를 겨누게 된다`);
      /* (1) **이어진 것만 모인다** — 이어지지 않은 노드는 제자리여야 한다.
             대조(누르지 않고 200틱)를 먼저 빼고 잰다. 안 그러면 아직 가라앉는 중인
             배치의 표류가 섞여 "누르지도 않았는데 52px 움직였다" 가 된다 — 실제로 그랬다.
             **대조값도 늘 출력한다.** 말없이 빼면 표류 자체를 못 보게 된다. */
      if (r.moved > 0)
        F(`20. ${nm} — 누르자 이어지지 않은 노드 ${r.moved}개가 움직였다 (${r.who}). 이어진 것만 모여야 한다`);
      if (r.idle > 0)
        W(`20. ${nm} — 누르지 않고 200틱만 돌려도 ${r.idle}개가 6px 넘게 움직인다. 배치가 아직 가라앉는 중이다`);
      /* (2) 못 담았으면 카메라가 바닥까지 갔어야 한다 */
      /* 다 못 담는 경우엔 누른 것이 화면 가운데 있어야 한다 — 그게 새 약속이다 */
      if (r.inn < r.nb && r.selfOff > 40)
        F(`20. ${nm} — 이어진 것을 다 못 담았는데 누른 것마저 화면 가운데가 아니다 (${r.selfOff}px)`);
      /* (3) 못 담은 것은 카드에 있어야 한다 — 말없이 사라지면 안 된다 */
      if (r.inCard < r.nb)
        F(`20. ${nm} — 이어진 것 ${r.nb}개 중 ${r.nb - r.inCard}개가 카드에도 없다. 지도에서 못 보면 카드에서는 보여야 한다`);
      if (r.inn < r.nb)
        W(`20. ${nm} — 이어진 것 ${r.nb - r.inn}개가 카드 뒤이거나 화면 밖이다 (카드 목록에는 있다). 안 가려진 자리가 ${r.mw}×${r.mh} 라서다`);
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
      var t=0; while(alpha>LAY_STOP&&t<900){tick();t++}
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      var before=mid();
      /* 주소창이 접혀 화면이 커졌다 — 물리가 다시 데워진다 */
      H=882; W=344; setAngles(); reheat(0.35);
      var t2=0; while(alpha>LAY_STOP&&t2<900){tick();t2++}    /* 가라앉음을 보고 기다린다 */
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      return {before:before, after:mid(), ticks:t2, pre:(window.__preTicks||0),
              has:typeof refitWhenSettled==='function'};
    })()`);
    d21.window.close();
    console.log(`21. 화면 커진 뒤    폴드 접힘 344 · 무리 중심 ${r.before}px → ${r.after}px (${r.ticks}틱 기다림)`);
    if (!r.has) F('21. refitWhenSettled 가 없다 — 화면이 커진 뒤 다시 맞추는 경로가 사라졌다');
    if (r.after == null) F('21. 화면이 커진 뒤 노드가 하나도 안 보인다');
    else if (r.after > 60) F(`21. 화면이 커진 뒤 무리 중심이 ${r.after}px 어긋났다`);
    /* 21번은 '화면이 커진 뒤' 를 잰다 — 그때는 reheat 로 다시 데워지므로 사전 틱과 무관하다.
       다만 사전 정착 덕에 시작이 이미 가라앉아 있으면 적게 돌 수 있다. 함께 본다. */
    if ((r.ticks + (r.pre || 0)) < 20) F(`21. 사전 ${r.pre || 0}틱 + ${r.ticks}틱 만에 가라앉았다 — 물리가 안 도는 것일 수 있다`);
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
        /* **화면이 쓰는 함수를 부른다.** 전에는 여기서 lw·lh 로 공식을 다시 썼다.
           흐린 점으로 그리는 노드가 생기자 화면은 4px 를 차지하는데 검사는
           100px 로 세어 '2020년대 140% 넘침' 이라는 없는 문제를 보고했다.
           공식을 두 벌 두면 갈라진다 — hw·hh 는 그리기·물리·검사가 같이 쓴다. */
        g[y].forEach(function(n){used+=(2*hw(n))*(2*hh(n))});
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
        /* 좁은 화면은 한 줄로 줄여 쓴다 ('고리 간격 ≠ 시간 간격') —
           지도 위에서 이름표와 겹쳐 둘 다 안 읽혔기 때문이다.
           검사는 '이 문장이 있는가' 가 아니라 **'간격이 다르다는 말을 하는가'** 를 봐야 한다.
           약속을 바꾸면 그 약속을 재던 검사도 같이 바꾼다. */
        const hit = drawn.some(t => /고리 간격[^가-힣]*(≠|은 실제)/.test(t));
        console.log(`25. 간격 안내       ${vw}px · ${hit ? '그려짐' : '없음'} (그린 글자 ${drawn.length}개)`);
        if (!drawn.length) F(`25. ${vw}px — fillText 를 하나도 못 잡았다. 검사가 화면을 안 보고 있다`);
        else if (!hit) F(`25. ${vw}px — 고리 간격이 실제 시간 간격과 다르다는 말이 화면에 없다. 시간 축이 비선형인데 밝히지 않으면 왜곡이다`);
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
    /* 중심 어긋남 한도.
       6% 였는데, 첫 화면 중심을 '모든 노드' 가 아니라 '결과 노드에 무게를 준 값' 으로
       바꾸면서 전체 무리중심은 조금 나빠졌다. 그게 맞는 맞바꿈이다 —
       눈은 큰 노란 원을 보기 때문이다.
       **한도를 풀기만 하면 아무것도 안 잡는 검사가 된다.**
       그래서 두 지표를 같이 본다: 전체 무리중심(느슨) + 결과 사분면(엄격).
       하나가 느슨해져도 다른 하나가 잡는다. */
    const OFF_MAX = 9;      // 중심 어긋남 한도 (화면 대각선의 %)
    const EMPTY_MAX = 45;   // 노드 상자 안 빈 칸 한도 (%)
    for (const [w, h] of VIEWPORTS) {
      const d26 = boot(w, h);
      await new Promise(r => setTimeout(r, 1100));
      const r = d26.window.eval(`(function(){
        if(typeof fit!=='function'||!A.length)return null;
        var t=0; while(alpha>LAY_STOP&&t<900){tick();t++}      /* 가라앉을 때까지 */
        fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        for(var i=0;i<30;i++)tick();
        labelSet=null;labelKey='';draw();
        var on=[];
        A.forEach(function(n){var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
          if(sx>=0&&sx<=W&&sy>=0&&sy<=H)on.push([sx,sy])});
        if(!on.length)return {ticks:t,on:0,tot:A.length};
        var cx2=0,cy2=0; on.forEach(function(p){cx2+=p[0];cy2+=p[1]});
        cx2/=on.length; cy2/=on.length;
        /* 왼쪽 패널을 없앤 뒤로 인셋이 없다 — 화면 가운데가 곧 지도 가운데다.
           그래도 페이지의 viewCX() 를 부른다. 검사가 W/2 를 직접 쓰면
           나중에 화면이 바뀌어도 검사는 모른다. */
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
        /* 빈 칸을 '노드 상자 안' 에서만 세면 아무것도 못 잡는다 —
           노드가 부채꼴로 몰리면 그 상자 자체가 부채꼴이라 빈 곳이 상자 밖으로 빠진다.
           실제로 화면 절반이 비었는데 검사는 0~25% 로 통과했다.
           그래서 **고리가 덮는 타원 안** 을 기준으로 센다.
           고리 배치라 화면 네 귀퉁이가 비는 건 정상이지만,
           고리 안쪽이 비는 건 정상이 아니다. */
        var cx0=0*cam.s+cam.x, cy0=0*cam.s+cam.y;      /* 고리 중심(월드 원점) */
        var RX=ROUT*cam.s, RY=ROUT*0.86*cam.s;
        var inBox=0, emptyIn=0;
        for(var yy=0;yy<gy;yy++)for(var xx=0;xx<gx;xx++){
          var l=xx*cell,rr=Math.min(W,l+cell),tp=yy*cell,bt=Math.min(H,tp+cell);
          if(l>=W||tp>=H)continue;
          /* 칸의 가운데가 고리 타원 안에 있고 화면 안이면 센다 */
          var mx2=(l+rr)/2, my2=(tp+bt)/2;
          var u=(mx2-cx0)/Math.max(1,RX), v=(my2-cy0)/Math.max(1,RY);
          if(u*u+v*v>1)continue;
          inBox++; if(!g[yy*gx+xx])emptyIn++;
        }
        /* 큰 노란 원(결과 노드)이 한쪽에만 몰리면 '쏠려 보인다'.
           작은 점이 고루 퍼져 있어도 눈은 큰 원을 본다 — 실제로 갈라졌다. */
        var R=[]; A.forEach(function(n){ if(n.t!=='result')return;
          var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
          if(sx>=0&&sx<=W&&sy>=0&&sy<=H)R.push([sx,sy])});
        var q=[0,0,0,0];
        R.forEach(function(p){q[(p[1]>H/2?2:0)+(p[0]>CX?1:0)]++});
        var rOff=-1;
        if(R.length){var rx=0,ry=0;R.forEach(function(p){rx+=p[0];ry+=p[1]});
          rOff=Math.round(Math.hypot(rx/R.length-CX, ry/R.length-H/2))}
        var empties=q.filter(function(v){return v===0}).length;
        return {resN:R.length, quad:q.join('/'), rOff:rOff, emptyQuad:empties,
                ticks:t, pre:(window.__preTicks||0), off:Math.round(off), pct:+(off/diag*100).toFixed(1),
                on:on.length, tot:A.length, lbl:labelStat?labelStat.shown:0,
                emptyIn:emptyIn, inBox:inBox, cells:g.length,
                emptyAll:g.filter(function(v){return v===0}).length,
                s:+cam.s.toFixed(2)};
      })()`);
      d26.window.close();
      if (!r) { F(`26. ${w}×${h} — 첫 화면을 못 쟀다`); continue }
      if (!r.on) { F(`26. ${w}×${h} — 첫 화면에 노드가 하나도 없다 (전체 ${r.tot}개)`); continue }
      const ep = Math.round(100 * r.emptyIn / Math.max(1, r.inBox));
      console.log(`26. 첫 화면        ${String(w + '×' + h).padEnd(10)} 가라앉기 ${String(r.ticks).padStart(3)}틱 · 중심어긋남 ${String(r.off + 'px').padStart(6)} (${r.pct}%) · 화면안 ${r.on}/${r.tot} · 이름표 ${String(r.lbl).padStart(2)} · 고리 안 빈칸 ${r.emptyIn}/${r.inBox} (${ep}%) · 배율 ${r.s} · 결과 ${r.resN}개 사분면 ${r.quad} 중심에서 ${r.rOff}px`);

      /* **약속이 바뀌었다:** 첫 화면은 그리기 전에 자리를 잡는다(사전 틱).
         그래서 검사가 다시 돌릴 때는 이미 가라앉아 0틱이 나온다 —
         물리가 안 도는 게 아니라 **먼저 돌았다.** 둘을 합쳐서 본다. */
      if ((r.ticks + (r.pre || 0)) < 20)
        F(`26. ${w}×${h} — 사전 ${r.pre || 0}틱 + ${r.ticks}틱 만에 가라앉았다. 물리가 안 도는 것일 수 있다`);
      if (r.pct > OFF_MAX) F(`26. ${w}×${h} — 노드 무리 중심이 화면 중심에서 ${r.off}px 어긋났다 (대각선의 ${r.pct}%, 한도 ${OFF_MAX}%)`);
      if (r.on < 20) F(`26. ${w}×${h} — 첫 화면에 노드가 ${r.on}/${r.tot}개뿐이다. 빈 화면으로 보인다`);
      if (!r.lbl) F(`26. ${w}×${h} — 첫 화면에 이름표가 하나도 없다. 색깔 점만 보인다`);
      if (ep > EMPTY_MAX) F(`26. ${w}×${h} — 고리가 덮는 영역 안에서 ${ep}% 가 비어 있다 (${r.emptyIn}/${r.inBox}칸). 노드가 한쪽에 뭉쳤다`);
      /* 결과 노드가 세 사분면 이상 비면 큰 원이 한쪽에 몰린 것이다.
         '무리중심' 만 보면 이걸 못 잡는다 — 실제로 못 잡았다. */
      if (r.resN >= 4 && r.emptyQuad >= 3)
        F(`26. ${w}×${h} — 결과 노드 ${r.resN}개가 사분면 ${r.quad} 로 한쪽에 몰렸다. 큰 원이 쏠려 보인다`);
    }
  }

  // 27. 카드 규칙이 CSS 와 검사에서 같은 값인가
  //     검사 20·26 은 지도 크기를 근사한다 — jsdom 이 레이아웃을 안 하기 때문이다.
  //     그 근사값이 CSS 와 어긋나면 검사가 실물보다 넓은 화면을 가정하고 통과한다.
  //     실제로 카드를 62dvh → 38dvh 로 바꿨을 때 검사는 62dvh 로 재고 있었다.
  //     그래서 CSS 원문에서 값을 읽어 검사의 가정과 맞는지 본다.
  {
    const want = [
      /* 전에는 body.panelon #stage 의 bottom/right 에서 읽었다. 카드가 지도를 밀지
         않게 되면서 그 규칙이 사라졌다 — 이제 .pop 자신이 유일한 출처다. */
      { re: /@media \(max-width:620px\)[\s\S]{0,6000}?\.pop\{[^}]*height:(\d+)vh/, want: 32, nm: '≤620 카드 높이(dvh)' },
      { re: /@media \(max-width:1000px\)[\s\S]{0,4000}?\.pop\{[^}]*height:(\d+)vh/, want: 38, nm: '621~1000 카드 높이(dvh)' },
      { re: /@media \(max-height:520px\)[\s\S]*?\.pop\{width:min\((\d+)px/, want: 380, nm: '낮은 가로 카드 폭(px)' },
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

    /* 옛 27번은 'PC 왼쪽 패널이 넘치면 되돌리는가' 를 쟀다. **그 패널이 이제 없다.**
       약속이 바뀌면 그 약속을 재던 검사도 바꾼다. 통째로 지우지는 않는다 —
       지금 지킬 약속을 여기서 재고, 낡은 판정만 걷어낸다.

       새 약속: '보는 법' 은 어느 화면에서나 아래 서랍이다.
         ① 화면 크기·포인터로 갈리는 경로가 없다
         ② 서랍이 지도를 옆에서 가리지 않는다 (인셋이 없다)
         ③ 서랍 항목은 접힌 채 시작한다 */
    const gone = ['decideRailOpen', 'mapInsetLeft'];
    const left = gone.filter(fn => new RegExp('function\\s+' + fn + '\\s*\\(').test(html));
    if (left.length) F(`27. 서랍 통일 — ${left.join(', ')} 가 아직 있다. 왼쪽 패널 경로가 남아 있다는 뜻이다`);

    /* .rail 에 폭이나 왼쪽/위 자리를 주는 규칙이 하나라도 있으면 옆 패널로 되돌아간 것이다.
       서랍은 left:0/right:0/bottom:0 이라 폭을 안 준다. */
    const railRules = [...html.matchAll(/(^|[}{;\n])\s*([^{}\n@]*\.rail)\s*\{([^}]*)\}/g)]
      .map(m => ({ sel: m[2].trim(), body: m[3] }))
      .filter(r => /(^|,|\s)\.rail$/.test(r.sel));
    const bad = railRules.filter(r => /(^|;)\s*(width|left|top)\s*:\s*(?!0|auto)/.test(r.body));
    if (bad.length) F(`27. 서랍 통일 — .rail 에 자리·폭을 주는 규칙이 ${bad.length}건 남았다 (${bad[0].body.slice(0,40)}…)`);

    /* ③ 은 HTML 에서 바로 본다 — <details> 에 open 이 없으면 접힌 채 뜬다 */
    const openCards = (html.match(/<details class="railcard[^>]*\sopen[\s>]/g) || []).length;
    if (openCards) F(`27. 서랍 항목 ${openCards}개가 펼쳐진 채 시작한다. 모든 화면에서 접혀야 한다`);
    console.log(`27. 서랍 통일       왼쪽 패널 경로 ${left.length}개 · .rail 자리규칙 ${bad.length}건 · 펼쳐진 채 시작 ${openCards}개 (모두 0이어야 한다)`);

    /* ②를 jsdom 으로 재지 않는다. **재는 척이 되기 때문이다.**
       jsdom 은 레이아웃을 안 해 모든 요소가 창 전체 크기로 나온다 —
       그래서 인셋은 왼쪽 패널이 있든 없든 늘 0 이었다. 여기서 viewCX()===W/2 를
       확인해봐야 옛 코드에서도 통과한다. 아무것도 안 잡는 검사가 가장 오래 산다.
       위의 'mapInsetLeft 가 없는가' 가 이 약속을 실제로 강제하는 부분이고,
       지도가 230px 넓어졌다는 것은 브라우저 실측으로 확인했다 (docs/화면점검.md). */
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
        var t=0; while(alpha>LAY_STOP&&t<900){tick();t++}
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
      console.log(`28. 만진 뒤 첫화면  ${w}×${h} · 탭으로 카메라 잡힘 ${r.touched} · 중심 ${r.off}px (${pct}%) · 화면안 ${r.on}/${r.tot} · 배율 ${r.s} · 결과 ${r.resN}개 사분면 ${r.quad} 중심에서 ${r.rOff}px`);
      if (r.touched) F(`28. ${w}×${h} — 탭 한 번에 camUser 가 켜졌다. 첫 화면 맞춤이 영영 안 돈다`);
      if (pct > 6) F(`28. ${w}×${h} — 만진 뒤 중심이 ${r.off}px (${pct}%) 어긋났다`);
      if (r.on < 20) F(`28. ${w}×${h} — 만진 뒤 화면에 노드가 ${r.on}/${r.tot}개뿐이다`);
    }
  }

  // 29. 노드를 누른 뒤 — 튀지 않는가, 그리고 언제 멈추는가
  //     "빨리 멈추는가" 만 재면 순간이동이 통과한다. 실제로 통과했다 —
  //     한 프레임에 1,600px 뛰어 노드가 사라졌다가 다른 자리에 나타났는데
  //     "멈춤 0.75초" 로 합격이었다. 빠른 것과 안 끊기는 것은 다른 문제다.
  //     그래서 **한 프레임에 화면에서 몇 px 움직이는가** 를 같이 잰다.
  //     사람 눈이 따라갈 수 있는 한 프레임 이동은 대략 화면 짧은 변의 1/6 이다.
  {
    const d29 = boot(412, 915);
    await new Promise(r => setTimeout(r, 1100));
    const r = d29.window.eval(`(function(){
      var t=0; while(alpha>LAY_STOP&&t<900){tick();t++}
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]});
      if(!c.length)return null;
      var tgt=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
      var prev={}; A.forEach(function(n){prev[n.id]=[n.x,n.y]});
      /* 초점을 켜면 이웃이 지도에 새로 올라온다 — 그건 '튄' 것이 아니라 '없다가 생긴' 것이다.
         전에 본 적 없는 노드는 이번 프레임 기준만 적어 두고 다음부터 잰다. */
      var snap=function(){var m=0,who=null;
        A.forEach(function(n){
          if(!prev[n.id]){prev[n.id]=[n.x,n.y];return}
          var d=Math.hypot(n.x-prev[n.id][0],n.y-prev[n.id][1])*cam.s;
          if(d>m){m=d;who=n.lab} prev[n.id]=[n.x,n.y]});
        return [m,who]};
      /* 누르는 순간 — setFocus + gatherFan 이 좌표를 대입하면 여기서 잡힌다 */
      setFocus(tgt.id);
      if(typeof gatherFan==='function'){size();gatherFan()}
      var s0=snap();
      /* 그 뒤 프레임마다 */
      var worst=0, worstWho=null, lastMove=0;
      for(var f=1;f<=240;f++){
        tick();
        cam.s+=(cam.ts-cam.s)*0.11; cam.x+=(cam.tx-cam.x)*0.11; cam.y+=(cam.ty-cam.y)*0.11;
        var m=snap();
        if(m[0]>worst){worst=m[0];worstWho=m[1]}
        if(m[0]>2)lastMove=f;
      }
      return {onTap:Math.round(s0[0]), onTapWho:s0[1],
              worst:Math.round(worst), worstWho:worstWho,
              endsAt:+(lastMove/60).toFixed(2), alpha:+alpha.toFixed(5),
              lim:Math.round(Math.min(W,H)/6), W:W, H:Math.round(H)};
    })()`);
    d29.window.close();
    if (!r) F('29. 움직임을 못 쟀다');
    else {
      console.log(`29. 누른 뒤 움직임  누른 순간 ${r.onTap}px · 한 프레임 최대 ${r.worst}px (${r.worstWho}) · 움직임 끝 ${r.endsAt}초 · 한도 ${r.lim}px (지도 ${r.W}×${r.H})`);
      /* 순간이동 — 화면 짧은 변의 1/6 을 한 프레임에 넘으면 눈이 못 따라간다 */
      if (r.onTap > r.lim)
        F(`29. 누르는 순간 노드가 ${r.onTap}px 튄다 (한도 ${r.lim}px). 사라졌다가 다른 자리에 나타난다`);
      if (r.worst > r.lim)
        F(`29. 한 프레임에 ${r.worst}px 튄다 — ${r.worstWho} (한도 ${r.lim}px)`);
      /* **약속이 바뀌었다.** 전에는 부채꼴로 모았으므로 "안 움직이면 부채꼴이 고장" 이었다.
         지금은 **안 움직이는 것이 약속**이다 — 누르면 이어진 것만 밝아진다.
         이 검사는 그래서 '움직임이 있나' 가 아니라 **'튀지 않나'** 만 본다.
         움직임이 0 인 것은 정상이고, 그것을 재는 것은 검사 53 이다. */
      else if (r.endsAt > 2) F(`29. 움직임이 ${r.endsAt}초까지 이어진다. 2초를 넘으면 흔들리는 걸로 보인다`);
      if (r.alpha > 0.01) F(`29. 마지막 alpha 가 ${r.alpha} 다 — 물리가 잠들지 않는다`);
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
      var rawCnt=0, byKind={};
      N.forEach(function(n){
        if(n.ghost)return;
        /* **plain(쉬운 말로 옮긴 것)도 함께 본다.** 자동으로 들어온 법에서
           사람이 실제로 읽는 것은 body 가 아니라 plain 쪽이다.
           body 만 재면 정작 읽히는 글이 검사를 안 받는다.
           easy 는 다른 것이다 — 손으로 넣은 사건의 [[질문,답],…] 배열이라
           문자열로 이으면 없는 긴 문장이 만들어진다. 이름을 나눠 뒀다. */
        /* **tip(무슨 법인지)도 함께 본다.** 카드에서 제목 바로 아래 노란 글씨로
           제일 먼저 읽히는 문장이다. 여기가 어려우면 나머지를 읽을 이유가 없다.
           원문(reason)은 안 본다 — 법제처가 쓴 글이라 어려운 게 당연하고,
           우리가 옮긴 말만 재야 '우리 글이 쉬운가' 를 재는 것이 된다. */
        /* ── **모든 종류를 본다.** 법만 재면 사건·판례·헌재결정이 검사를 안 받는다 ──
           다만 raw 가 붙은 글(재판부가 쓴 판시사항 원문)은 난이도에서 뺀다.
           원문이 어려운 것은 우리 잘못이 아니고, 재면 고칠 수 없는 FAIL 만 쌓인다.
           **대신 쉬운 말이 없는 것을 센다** — 그게 남은 일이고, 아래에서 출력한다. */
        if(n.raw&&n.gist)rawCnt++;
        var b=[String(n.body||''), (typeof n.plain==='string'?n.plain:''),
               (typeof n.tip==='string'?n.tip:''),
               (n.raw?'':(typeof n.gist==='string'?n.gist:''))].filter(Boolean).join('\\n').trim();
        if(b)byKind[n.t]=(byKind[n.t]||0)+1;
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
              raw:rawCnt, byKind:byKind,
              total:N.filter(function(n){return !n.ghost&&String(n.body||'').trim()}).length};
    })()`);
    d30.window.close();
    if (!r) F('30. 설명문을 못 읽었다');
    else {
      const uniqLong = new Set(r.longs.map(x => x.lab)).size;
      const uniqHard = new Set(r.hard.map(x => x.lab)).size;
      console.log(`30. 설명문 난이도   설명문 ${r.total}개 · 60자 넘는 문장 ${r.longs.length}개(${uniqLong}카드) · 설명 없는 어려운 말 ${r.hard.length}개(${uniqHard}카드) · 말투 존댓말 ${r.tone.seum} / 반말 ${r.tone.da} / 연표항목 ${r.tone.other}`);
      /* **쉬운 말이 없는 것을 센다.** 0 은 "다 옮겼다" 와 "안 보고 있다" 를 구별하지 않는다 —
         분모와 함께 낸다. 이 수가 남은 일이다. */
      console.log(`30. 종류별 설명문    ${Object.keys(r.byKind).sort().map(k => k + ' ' + r.byKind[k]).join(' · ')}`);
      console.log(`30. 원문 그대로      ${r.raw}개 — 재판부가 쓴 판시사항. 쉬운 말로 아직 못 옮겼다`);
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

  // 31. 한 줄 설명(tip)이 제목(lab)과 같은가 · 화면에 두 번 나오는가
  //     인물 연표 23개가 tip 과 lab 이 글자까지 똑같았다.
  //     카드에 같은 말이 두 줄로 나오는 건 그냥 버그다.
  //     데이터는 그대로 두고 렌더에서 거른다 — 원본을 지우면 나중에 왜 비었는지 모른다.
  //     자동 수집이 들어오면 이런 게 또 생긴다. 그래서 검사로 남긴다.
  {
    const d31 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1200));
    const r = d31.window.eval(`(function(){
      if(typeof N==='undefined')return null;
      var norm=function(x){return String(x||'').replace(/[\\s·,.()]/g,'')};
      var live=N.filter(function(n){return !n.ghost&&n.tip});
      var same=live.filter(function(n){return norm(n.tip)===norm(n.lab)});
      /* 렌더가 실제로 거르는가 — tipOf 가 있어야 하고 빈 문자열을 돌려줘야 한다 */
      var filtered = (typeof tipOf==='function')
        ? same.filter(function(n){return tipOf(n)===''}).length : -1;
      /* 화면에도 두 번 안 나오는지 — 카드를 열어 본문에서 센다 */
      var dup=[];
      same.slice(0,4).forEach(function(n){
        try{
          setFocus(n.id);
          var d=document.getElementById('detail');
          var txt=(d&&d.textContent)||'';
          var c=txt.split(n.lab).length-1;
          if(c>1)dup.push(n.lab+' ('+c+'번)');
        }catch(e){}
      });
      try{setFocus(null)}catch(e){}
      return {live:live.length, same:same.length, filtered:filtered,
              has:typeof tipOf==='function', dup:dup,
              ex:same.slice(0,3).map(function(n){return n.lab})};
    })()`);
    d31.window.close();
    if (!r) F('31. tip 을 못 읽었다');
    else {
      console.log(`31. 같은 말 두 줄    tip 있는 노드 ${r.live}개 · 제목과 같은 것 ${r.same}개 · 렌더가 거른 것 ${r.filtered}개${r.dup.length ? ' · 카드에 두 번 나온 것 ' + r.dup.length + '개' : ''}`);
      if (!r.has) F('31. tipOf() 가 없다 — 제목과 같은 한 줄 설명을 거르는 경로가 사라졌다');
      else if (r.same && r.filtered !== r.same)
        F(`31. 제목과 같은 tip ${r.same}개 중 ${r.filtered}개만 걸러진다`);
      if (r.dup.length)
        F(`31. 카드에 같은 말이 두 번 나온다 (${r.dup.join(', ')})`);
      /* 0 은 의심한다 — tip 이 하나도 없으면 검사가 빈손이다 */
      if (!r.live) F('31. tip 이 있는 노드가 0개다 — 검사가 아무것도 안 보고 있다');
      if (r.same) W(`31. tip 이 제목과 같은 노드 ${r.same}개 — 화면에선 걸러지지만 데이터로는 중복이다 (예: ${r.ex.join(', ')})`);
    }
  }

  // 32. 자동 수집이 못 채우는 시기를 화면에 밝히는가
  //     실측: 열린국회 발의법률안은 제1~9대(1948~1979)가 전부 0건이고,
  //     법제처는 현행법령만 준다 (사회보호법·반공법 둘 다 0건).
  //     그 시기는 손으로 넣은 것이다. 밝히지 않으면 자동으로 모은 것처럼 보인다.
  //     "말없이 바꾸면 아무도 모른다" 와 같은 종류다.
  {
    const d32 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1200));
    const r = d32.window.eval(`(function(){
      if(typeof N==='undefined')return null;
      var old=N.filter(function(n){return !n.ghost&&typeof yr==='function'&&yr(n)&&yr(n)<1980});
      var recent=N.filter(function(n){return !n.ghost&&yr(n)&&yr(n)>=2000});
      var say=function(id){
        try{setFocus(id)}catch(e){return null}
        var d=document.getElementById('detail');
        return ((d&&d.textContent)||'').indexOf('손으로 넣었습니다')>=0;
      };
      var hitOld=old.slice(0,5).map(function(n){return say(n.id)});
      var hitNew=recent.slice(0,3).map(function(n){return say(n.id)});
      try{setFocus(null)}catch(e){}
      /* 왼쪽 설명 카드에도 있어야 한다 */
      var rail=(document.getElementById('rail')||{}).textContent||'';
      return {old:old.length, recent:recent.length,
              onOld:hitOld.filter(Boolean).length, oldN:hitOld.length,
              onNew:hitNew.filter(Boolean).length,
              inRail:rail.indexOf('1980년 이전은 손으로 넣었습니다')>=0};
    })()`);
    d32.window.close();
    if (!r) F('32. 못 쟀다');
    else {
      console.log(`32. 옛 시기 안내     1980년 이전 노드 ${r.old}개 · 카드에 뜬 것 ${r.onOld}/${r.oldN} · 최근 노드에 잘못 뜬 것 ${r.onNew} · 설명 카드 ${r.inRail ? '○' : '×'}`);
      /* 0 은 의심한다 — 옛 노드가 없으면 검사가 빈손이다 */
      if (!r.old) F('32. 1980년 이전 노드가 0개다 — 검사가 아무것도 안 보고 있다');
      else if (r.onOld !== r.oldN) F(`32. 1980년 이전 노드 카드에 안내가 ${r.onOld}/${r.oldN}만 뜬다 — 손으로 넣은 시기를 안 밝히면 자동으로 모은 것처럼 보인다`);
      if (r.onNew) F(`32. 1980년 이후 노드에도 옛 시기 안내가 ${r.onNew}개 떴다 — 틀린 자리에 붙었다`);
    }

    /* ── 표결: '표결까지 안 갔다' 와 '자료가 없다' 를 구별하는가 ──
       둘이 섞이면 거짓말이 된다. 앞은 국회가 표결에 안 부친 것이고,
       뒤는 우리가 못 받는 것이다 (개인별 표결은 제20대·2016년부터만 공개된다).
       법안 카드가 연도에 따라 **다른 말**을 하는지 본다. 같은 말이면 구별을 못 한 것이다. */
    const d32b = boot(1440, 900);
    await new Promise(r2 => setTimeout(r2, 1200));
    const v = d32b.window.eval(`(function(){
      if(typeof N==='undefined'||typeof voteNote!=='function')return null;
      var bills=N.filter(function(n){return n.t==='bill'&&!n.ghost&&yr(n)});
      var oldB=bills.filter(function(n){return yr(n)<2016});
      var newB=bills.filter(function(n){return yr(n)>=2016});
      var txt=function(list){return list.slice(0,4).map(function(n){
        try{setFocus(n.id)}catch(e){return ''}
        var d=document.getElementById('detail');
        var m=((d&&d.textContent)||'').match(/(개인별 표결 자료가 없습니다|표결 기록은 아직 붙이지 않았습니다)/);
        return m?m[1]:''})};
      var a=txt(oldB), b=txt(newB);
      try{setFocus(null)}catch(e){}
      return {oldN:oldB.length, newN:newB.length, oldSay:a, newSay:b,
              hasYear: typeof VOTE_OPEN_YEAR==='number' ? VOTE_OPEN_YEAR : null};
    })()`);
    d32b.window.close();
    if (!v) F('32. 표결 안내를 못 쟀다 — voteNote 가 없다');
    else {
      const oldOk = v.oldN === 0 || v.oldSay.every(x => x === '개인별 표결 자료가 없습니다');
      const newOk = v.newN === 0 || v.newSay.every(x => x === '표결 기록은 아직 붙이지 않았습니다');
      console.log(`32. 표결 안내       2016년 이전 법안 ${v.oldN}개 ${oldOk ? '○' : '×'} · 이후 ${v.newN}개 ${newOk ? '○' : '×'} · 기준연도 ${v.hasYear}`);
      if (v.hasYear !== 2016) F(`32. 개인별 표결 공개 기준연도가 ${v.hasYear} 다. 제20대 개원(2016)이어야 한다`);
      if (!v.oldN && !v.newN) F('32. 연도가 있는 법안 노드가 0개다 — 검사가 아무것도 안 보고 있다');
      if (!oldOk) F(`32. 2016년 이전 법안에 '자료가 없다' 안내가 안 붙는다 (${JSON.stringify(v.oldSay)}). '표결까지 안 갔다' 와 섞이면 거짓말이 된다`);
      if (!newOk) F(`32. 2016년 이후 법안에 '표결까지 안 갔다' 안내가 안 붙는다 (${JSON.stringify(v.newSay)})`);
      if (v.oldN && v.newN && v.oldSay[0] === v.newSay[0])
        F('32. 두 경우가 같은 말을 한다. 표결까지 안 간 것과 자료가 없는 것은 다르다');
      if (!r.inRail) F('32. 왼쪽 설명 카드에 1980년 이전 안내가 없다');
    }
  }

  // 33. 지금 이 코드가 배포본과 같은가
  //     "고쳤다" 고 보고했는데 push 를 안 해서, 나는 로컬을 보고 사용자는 배포본을 봤다.
  //     화면이 다른 게 당연했는데 원인을 화면 코드에서 찾느라 시간을 버렸다.
  //     사용자가 확인하는 것은 배포본이다. 로컬에서 고친 것은 볼 방법이 없다.
  //     FAIL 은 아니다 — 작업 중에는 당연히 어긋난다. 다만 눈에 띄어야 한다.
  {
    const { execSync } = require('child_process');
    const run = (c) => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim() } catch (e) { return null } };
    const dirty = run('git status --porcelain');
    const ahead = run('git rev-list --count @{u}..HEAD');
    const behind = run('git rev-list --count HEAD..@{u}');
    if (dirty === null) console.log('33. 배포 상태        git 을 못 읽었다 (저장소가 아닐 수 있다)');
    else {
      const nDirty = dirty ? dirty.split('\n').length : 0;
      const nAhead = Number(ahead || 0), nBehind = Number(behind || 0);
      const ok = !nDirty && !nAhead;
      console.log(`33. 배포 상태        ${ok ? '올린 것과 같음' : '다름'} · 커밋 안 된 파일 ${nDirty}개 · push 안 된 커밋 ${nAhead}개${nBehind ? ' · 원격이 앞선 것 ' + nBehind + '개' : ''}`);
      if (nDirty || nAhead) {
        const files = dirty ? dirty.split('\n').slice(0, 5).map(l => l.replace(/^.{2}\s+/, '')).join(', ') : '';
        W(`33. **지금 화면은 배포본과 다르다** — 커밋 안 된 파일 ${nDirty}개${files ? ' (' + files + ')' : ''} · push 안 된 커밋 ${nAhead}개. ` +
          `사용자가 보는 것은 배포본이다. 고쳤다고 말하기 전에 push 하거나 "로컬에만 있음" 이라고 밝혀야 한다`);
      }
    }
  }

  // 34. 화면에 그려진 글자끼리 겹치는가 — 실제로 그린 것 전부
  //     이름표만 재던 검사는 '겹침 0쌍' 이라고 했는데 화면에서는 겹쳤다.
  //     선 위 관계 라벨('같은 주제', '6년 뒤 2020 → 2026'), 고리 연도 눈금,
  //     역할 배지, 잘림 배지, 워터마크, 상단 안내가 전부 빠져 있었다.
  //     그래서 상자를 따로 계산하지 않고 **fillText 를 가로채** 실제로 그린 것을 잰다.
  //     좌표와 변환까지 받아 적으므로 월드 좌표(이름표)와 화면 좌표(배지)가 섞여도 맞다.
  {
    for (const [w, h, nm] of [[412, 915, '폰'], [1440, 900, '노트북']]) {
      const d34 = boot(w, h);
      await new Promise(r => setTimeout(r, 1200));
      const win = d34.window;
      const r = win.eval(`(function(){
        var t=0; while(alpha>LAY_STOP&&t<600){tick()}
        fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        /* 초점을 잡은 상태도 본다 — 관계 라벨과 배지는 그때만 그려진다 */
        var c=A.filter(function(n){return n.t==='result'&&adj[n.id]});
        if(c.length){
          var tg=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
          setFocus(tg.id);
          if(typeof gatherFan==='function'){size();gatherFan()}
          var t2=0; while(alpha>LAY_STOP&&t2<600){tick()}
          size(); if(typeof fitFocus==='function')fitFocus();
          cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        }
        labelSet=null;labelKey='';
        window.__texts.length=0;
        draw();
        return window.__texts.slice();
      })()`);
      d34.window.close();
      if (!r || !r.length) { F(`34. ${nm} — 그려진 글자를 하나도 못 받았다. 검사가 화면을 안 보고 있다`); continue }

      /* 글자 상자를 만든다. align 에 따라 x 기준이 다르다. */
      const box = r.map(o => {
        const half = o.w / 2;
        const cx0 = o.align === 'center' ? o.x : (o.align === 'right' || o.align === 'end' ? o.x - half : o.x + half);
        /* 한 줄 글자가 실제로 차지하는 세로는 글꼴 크기의 약 0.75 배다.
           절반(h)은 0.38. 1.24 배로 잡았더니 같은 노드의 이름과 숫자가
           서로 겹친 것으로 나왔다 — 그건 원래 위아래로 쌓는 것이다. */
        return { t: o.t, x: cx0, y: o.y - o.px * 0.30, w: half, h: o.px * 0.38 };
      }).filter(b => b.t.trim() && b.x + b.w > 0 && b.x - b.w < w && b.y + b.h > 0 && b.y - b.h < h);

      let over = 0; const ex = [];
      for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
        const a = box[i], b = box[j];
        if (Math.abs(a.x - b.x) < (a.w + b.w) * 0.92 && Math.abs(a.y - b.y) < (a.h + b.h) * 0.92) {
          over++; if (ex.length < 3) ex.push(`"${a.t.slice(0,12)}" × "${b.t.slice(0,12)}"`);
        }
      }
      console.log(`34. 그려진 글자 겹침 ${nm} ${w}×${h} · 화면 안 글자 ${box.length}개 · 겹친 쌍 ${over}`);
      if (over) W(`34. ${nm} — 화면에 그려진 글자 ${over}쌍이 겹친다 (${ex.join(', ')})`);
    }
  }

  // 35. 누른 뒤 화면이 비는 순간이 있는가
  //     "사건을 누르면 화면이 꺼졌다가 켜진다" — 실제 사용자 말이다.
  //     원인: 캔버스 크기를 대입하면 **같은 값이어도** 비트맵이 지워진다.
  //     size() 가 누를 때마다 여러 번 도는데 그때마다 한 프레임이 비었다.
  //     f4b2e0f(부채꼴) 에서 setFocus 가 size() 를 부르기 시작하면서 생겼다.
  //     '무엇을 그렸나' 를 세면 빈 프레임이 안 잡힌다 — '지운 뒤 안 그린 적이 있나' 를 봐야 한다.
  {
    const d35 = boot(412, 915);
    await new Promise(r => setTimeout(r, 1200));
    const r = d35.window.eval(`(function(){
      var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
      fit(); cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      /* 캔버스가 지워진 횟수와, 지운 뒤 다시 그렸는지를 센다 */
      var wipes=0, blanks=0, drawnSince=true;
      var d=Object.getOwnPropertyDescriptor(cv,'width');
      var realW=cv.width, realH=cv.height;
      /* 브라우저는 **같은 값을 대입해도** 비트맵을 지운다 (실측 확인).
         값이 바뀔 때만 세면 검사가 버그와 똑같은 맹점을 갖는다 —
         실제로 옛 코드를 주입했는데 통과했다. 대입 자체를 센다. */
      Object.defineProperty(cv,'width',{configurable:true,
        get:function(){return realW},
        set:function(v){ wipes++; drawnSince=false; realW=v }});
      Object.defineProperty(cv,'height',{configurable:true,
        get:function(){return realH}, set:function(v){realH=v}});
      var realDraw=window.draw;
      window.draw=function(){drawnSince=true; return realDraw.apply(null,arguments)};
      var step=function(){ if(!drawnSince)blanks++; };
      /* 실제 순서: 누른다 → 70ms size+gatherFan → 물리 → size+fitFocus */
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]});
      var tg=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
      setFocus(tg.id); step();
      size(); step();
      if(typeof gatherFan==='function')gatherFan(); step();
      for(var f=0;f<40;f++){tick(); draw(); step()}
      size(); step();
      if(typeof fitFocus==='function')fitFocus(); step();
      draw(); step();
      window.draw=realDraw;
      return {wipes:wipes, blanks:blanks};
    })()`);
    d35.window.close();
    if (!r) F('35. 못 쟀다');
    else {
      console.log(`35. 빈 프레임        누른 뒤 캔버스 지움 ${r.wipes}회 · 지우고 안 그린 순간 ${r.blanks}회`);
      if (r.blanks) F(`35. 누른 뒤 화면이 ${r.blanks}번 비었다 — 캔버스를 지우고 다시 안 그렸다. 꺼졌다 켜지는 것처럼 보인다`);
    }
  }

  // 36. 카드 '펼치기' 가 모든 화면에서 살아 있는가
  //     폴드를 펼치면(884px) 카드가 아래 38dvh 인데 펼칠 방법이 없었다.
  //     .pexp{display:none} 뒤에 620px 에서만 다시 켰기 때문이다.
  //     문법 오류가 아니고, 폰과 PC 에서는 멀쩡했다. 가운데 폭만 기능이 사라졌다.
  //     jsdom 은 레이아웃을 안 하니 CSS 원문으로 계약을 강제한다 (검사 19 와 같은 방식).
  {
    /* 주석을 먼저 걷어낸다. 안 걷으면 셀렉터 앞에 주석이 통째로 붙어 온다 —
       이 검사도 처음에 그것 때문에 '전에는' 이라는 셀렉터가 버튼을 끈다고 보고했다.
       규칙을 설명하려고 주석에 써 둔 .pexp{display:none} 을 진짜 규칙으로 읽은 것이다. */
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');

    /* ① 어느 화면에서도 버튼을 끄지 않는다 */
    const off = [...css.matchAll(/([^{}]*\.pexp[^{}]*)\{([^}]*)\}/g)]
      .filter(m => /display\s*:\s*none/.test(m[2]))
      .map(m => m[1].trim().split('\n').pop().trim());
    if (off.length) F(`36. 카드 펼치기 — ${off.join(', ')} 가 버튼을 끈다. 그 화면에서는 카드를 펼 수 없다`);

    /* ② 버튼이 실제로 무언가를 바꾸는가. 카드는 모양이 둘이다 —
       아래 카드는 높이가 늘고, 옆 패널은 폭이 는다. 아무 일도 안 하는 버튼은 없는 것만 못하다. */
    const regimes = [
      { nm: '아래 카드(≤1000)', re: /@media \(max-width:1000px\)\{[\s\S]*?\n\}/, prop: 'height' },
      { nm: '옆 패널(>1000)', re: /@media \(min-width:1001px\)\{[\s\S]*?\n\}/, prop: 'width' },
    ];
    let acts = 0;
    regimes.forEach(rg => {
      const blk = css.match(rg.re);
      if (!blk) { F(`36. ${rg.nm} 구간을 CSS 에서 못 찾았다 — 검사가 근거를 잃었다`); return }
      const re = new RegExp('body\\.popfull[^{}]*\\.pop\\s*\\{[^}]*' + rg.prop + '\\s*:');
      if (!re.test(blk[0])) F(`36. ${rg.nm} — 펼쳐도 ${rg.prop} 가 안 바뀐다. 버튼이 아무 일도 안 한다`);
      else acts++;
    });

    /* ③ 손잡이가 그림이 아니라 진짜인가.
       전에는 .pop:before 로 손잡이 **모양만** 그려두고 아무 동작이 없었다.
       끌 수 있어 보이는데 안 끌린다 — 없는 것보다 나쁘다. */
    /* 처음에는 '다른 데서 display:none 으로 껐으면 봐준다' 로 썼다.
       그런데 낮은 가로 화면 블록에 이미 .pop:before{display:none} 이 하나 있어서,
       손잡이 그림을 되살려 주입해도 **이 검사가 통과했다.** 봐주는 조건이
       검사를 무력화한 것이다. 그림 손잡이는 어디에도 두지 않는다 — 예외를 없앤다. */
    const fake = /\.pop:before\s*\{[^}]*(height:4px|width:40px)/.test(css);
    if (fake) F('36. 손잡이 모양만 그려 놓은 .pop:before 가 있다. 끌리는 줄 알고 끌면 아무 일도 안 난다');

    console.log(`36. 카드 펼치기     끄는 규칙 ${off.length}개(0이어야) · 실제로 바뀌는 구간 ${acts}/2 · 가짜 손잡이 ${fake ? '있음' : '없음'}`);
  }

  // 37. 분야 탭이 화면 밖으로 나가는데 표시가 없으면 FAIL
  //     분야는 19개인데 한 줄에 안 들어간다. 브라우저 실측 1440px:
  //     전체 2,401px 중 1,404px 만 보이고 11개만 보인 채 997px 이 잘렸다.
  //     가로 스크롤은 되는데 스크롤바를 숨겨 놔서 더 있다는 걸 알 방법이 없었다.
  //
  //     **jsdom 은 레이아웃을 안 해 offsetWidth 가 전부 0 이다.**
  //     그래서 '몇 개가 잘렸나' 를 여기서 잴 수 없다. 재는 척하지 않는다 —
  //     대신 '세는 코드가 있고, 화면이 바뀔 때 다시 세고, 아무도 그 표시를 끄지 않는다'
  //     를 강제한다. 픽셀 실측은 docs/화면점검.md 에 남긴다.
  {
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    let ok = 0;

    /* ① 표시가 HTML 에 있다 */
    const btn = html.match(/<button[^>]*id="catMore"[^>]*>/);
    if (!btn) F('37. 분야 탭 — 잘린 개수를 알리는 표시(#catMore)가 없다');
    else {
      if (!/aria-expanded/.test(btn[0]) || !/aria-controls/.test(btn[0]))
        F('37. 분야 탭 — 표시에 aria-expanded/aria-controls 가 없다. 읽어주는 기기에서 안 열린다');
      else ok++;
    }

    /* ② 개수를 실제로 센다. 하드코딩이면 화면 폭이 바뀔 때 거짓말이 된다 */
    const fn = html.match(/function syncCatMore\(\)[\s\S]*?\n\}/);
    if (!fn) F('37. 분야 탭 — syncCatMore 를 못 찾았다');
    else {
      const b = fn[0];
      if (!/clientWidth/.test(b) || !/offsetWidth/.test(b))
        F('37. 분야 탭 — 개수를 화면 폭으로 세지 않는다. 하드코딩된 숫자는 화면이 바뀌면 거짓말이 된다');
      else if (!/hid\s*\+\+|hid\s*\+=/.test(b))
        F('37. 분야 탭 — 잘린 개수를 세는 곳이 없다');
      else ok++;
    }

    /* ③ 화면 크기가 바뀌면 다시 센다 — 폰을 돌리거나 폴드를 펴면 들어가는 개수가 달라진다 */
    const sz = html.match(/function size\(\)[\s\S]*?\n\}/);
    if (!sz || !/syncCatMore/.test(sz[0]))
      F('37. 분야 탭 — size() 가 다시 세지 않는다. 화면을 돌리면 옛 개수가 남는다');
    else ok++;

    /* ④ 아무도 그 표시를 끄지 않는다. 화면 크기로 기능을 없애지 않는다 */
    const off = [...css.matchAll(/([^{}]*\.catmore[^{}]*)\{([^}]*)\}/g)]
      .filter(m => /display\s*:\s*none/.test(m[2]))
      .map(m => m[1].trim().split('\n').pop().trim());
    if (off.length) F(`37. 분야 탭 — ${off.join(', ')} 가 표시를 끈다. 그 화면에서는 잘린 걸 알 수 없다`);
    else ok++;

    /* 요약 줄이 실패한 항목까지 '있음' 이라고 찍으면 사람이 FAIL 을 안 읽고 넘어간다.
       무엇이 통과했는지를 그대로 쓴다. */
    console.log(`37. 분야 탭 잘림    표시 ${btn ? 'O' : 'X'} · 폭으로 셈 ${fn && /clientWidth/.test(fn[0]) ? 'O' : 'X'} · 크기 바뀌면 다시 셈 ${sz && /syncCatMore/.test(sz[0]) ? 'O' : 'X'} · 끄는 규칙 ${off.length}개 — ${ok}/4 (픽셀은 jsdom 이 못 잰다)`);
  }

  // 38. '누르는 자리' 덧판이 다른 버튼을 덮지 않는가
  //     카드 머리 줄을 52px → 40px 로 줄이면서, 보이는 크기는 줄이고 누르는 자리는
  //     :after 로 넓혔다. 그런데 그 :after 는 **가장 가까운 positioned 조상**을 기준으로 잡힌다.
  //     버튼 자신이 positioned 가 아니면 .pophead 를 기준으로 잡혀 머리 줄 전체를 덮는다.
  //     실제로 두 번 냈다 — .pclose 가 덮어서 펼치기·손잡이가 안 눌렸고,
  //     고친 뒤 .pexp 가 덮어서 손잡이가 안 눌렸다. **두 번 다 화면은 멀쩡했다.**
  //     스크린샷으로도 못 잡는다. 눌러 봐야 안다.
  //
  //     jsdom 은 레이아웃을 안 하니 겹침을 픽셀로 못 잰다. CSS 원문으로 조건을 강제한다:
  //     덧판을 가진 셀렉터는 **마지막에 이기는 position 이 relative/absolute/fixed** 여야 한다.
  {
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');

    /* 덧판(::after / ::before 로 만든 누르는 자리)을 가진 셀렉터를 찾는다 */
    const pads = [...css.matchAll(/([^{}]+)\{([^}]*position\s*:\s*absolute[^}]*)\}/g)]
      .filter(m => /::?(after|before)/.test(m[1]))
      .filter(m => /(top|bottom|left|right)\s*:\s*-\d/.test(m[2]))   /* 음수 = 밖으로 넓힌 것 */
      .flatMap(m => m[1].split(',').map(x => x.trim()))
      .filter(x => /::?(after|before)$/.test(x))
      .map(x => x.replace(/::?(after|before)$/, '').trim())
      .filter(Boolean);

    const uniq = [...new Set(pads)];
    let bad = [];
    uniq.forEach(sel => {
      /* 그 셀렉터에 걸리는 position 선언을 **파일 순서대로** 모은다. 뒤엣것이 이긴다.
         (특정도까지 따지지는 않는다 — 여기 셀렉터들은 다 같은 모양이다) */
      const key = sel.split(/\s+/).pop();          /* .pclose, .pexp … */
      const re = new RegExp('(^|[},])\\s*([^{},]*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')\\s*\\{([^}]*)\\}', 'g');
      let last = null;
      for (const m of css.matchAll(re)) {
        if (/::?(after|before)/.test(m[2])) continue;
        const p = m[3].match(/(?:^|;)\s*position\s*:\s*([a-z]+)/);
        if (p) last = p[1];
      }
      if (!last) bad.push(`${sel} (position 선언이 아예 없다)`);
      else if (!/^(relative|absolute|fixed)$/.test(last)) bad.push(`${sel} → ${last}`);
    });

    if (!uniq.length) F('38. 누르는 자리 — 덧판을 하나도 못 찾았다. 검사가 아무것도 안 보고 있다');
    if (bad.length) F(`38. 누르는 자리 — ${bad.join(', ')} 가 positioned 가 아니다. 덧판이 조상 기준으로 잡혀 옆 버튼을 덮는다`);
    console.log(`38. 누르는 자리     덧판 ${uniq.length}개 (${uniq.join(' ')}) · 기준 잘못된 것 ${bad.length}개`);
  }

  // 39. 카드가 열려도 지도 크기가 안 바뀌는가
  //     전에는 카드가 열리면 #stage 의 right/bottom 을 줄여 지도를 밀었다. 그러면
  //       지도 크기가 바뀐다 → size() 가 돈다 → 캔버스가 지워진다 → 카메라를 다시 잡는다
  //     이 사슬에서 여러 문제가 나왔다 — 누르면 화면이 꺼졌다 켜지고(35번), 원이 옆으로
  //     밀리고, 첫 화면 맞춤이 취소됐다. 카드를 겹치게 해서 사슬을 끊었다.
  //
  //     jsdom 은 레이아웃을 안 해 '지도가 실제로 줄었는지' 를 못 잰다
  //     (getBoundingClientRect 가 늘 창 전체를 돌려주므로 W·H 는 언제나 그대로다).
  //     그러니 그걸 재는 척하지 않는다 — **줄이는 규칙이 CSS 에 없다**를 강제한다.
  {
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const GEO = /(^|;)\s*(top|right|bottom|left|width|height|inset|transform)\s*:/;
    const bad = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(m => /#stage|\.stage\b/.test(m[1]))
      .filter(m => /\.(panelon|popfull)\b/.test(m[1]))
      .filter(m => GEO.test(m[2]))
      .map(m => m[1].trim().split('\n').pop().trim());
    if (bad.length)
      F(`39. 카드가 지도를 민다 — ${bad.join(', ')} 가 #stage 의 자리·크기를 바꾼다. 크기가 바뀌면 size() 가 돌고 캔버스가 지워진다`);

    /* 전환이 끝나면 다시 재던 고리도 없어야 한다 — 없는 전환을 기다리는 죽은 코드다 */
    const dead = /addEventListener\(\s*['"]transitionend['"][\s\S]{0,240}?propertyName\s*!==\s*['"](right|bottom)['"]/.test(html);
    if (dead) F("39. #stage 의 right/bottom 전환을 기다리는 코드가 남아 있다. 그 전환은 이제 없다");

    /* 카드는 여전히 화면에 나타나야 한다 — 겹치기로 바꾸면서 통째로 지우지 않았는지 */
    const shows = /\.pop\.on\{[^}]*transform:\s*translate/.test(css);
    if (!shows) F('39. .pop.on 이 카드를 나타나게 하지 않는다. 겹치기로 바꾸면서 카드가 안 열리게 됐다');

    console.log(`39. 카드는 겹친다    #stage 를 건드리는 규칙 ${bad.length}개(0이어야) · 죽은 전환 대기 ${dead ? '있음' : '없음'} · 카드 열림 ${shows ? 'O' : 'X'}`);
  }

  // 40. '숨기기' 가 설명만 감추고 선택은 그대로 두는가
  //     닫기(✕)와 뜻이 다르다. 닫기는 고른 것을 풀고, 숨기기는 설명만 감춘다.
  //     헷갈리면 "선만 보려고 눌렀는데 강조까지 사라졌다" 가 된다.
  //     이건 레이아웃이 필요 없다 — 클래스와 상태만 보면 되므로 jsdom 으로 진짜 동작을 잰다.
  {
    const d = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = d.window.eval(`(function(){
      var doc=document, B=doc.body;
      var hide=doc.getElementById('popHide'), show=doc.getElementById('popShow');
      if(!hide||!show)return {missing:!hide?'popHide':'popShow'};
      var res=[], snap=function(tag){res.push({at:tag,
        focus:focus||null, on:pop.classList.contains('on'),
        chip:!show.hidden, panelon:B.classList.contains('panelon'),
        /* '선택이 그대로인가' 는 빛(gl)이 아니라 **선택 자체**로 잰다.
           gl 은 프레임마다 차오르는 값이라 몇 틱을 돌렸느냐에 따라 달라진다 —
           검사가 실행마다 흔들리게 된다. ring 은 선택이 만드는 구조 그 자체다. */
        ringN:Object.keys(ring).length })};
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]&&adj[n.id].length});
      if(c.length<2)return {few:c.length};
      setFocus(c[0].id); for(var i=0;i<40;i++)tick(); snap('누름');
      hide.onclick(); snap('숨김');
      setFocus(c[1].id); for(var j=0;j<40;j++)tick(); snap('다른 사건');
      show.onclick(); snap('다시 보기');
      closePop(); snap('닫기');
      return {steps:res,
        hideLabel:(hide.textContent||'').trim(),
        closeLabel:(doc.getElementById('pclose').getAttribute('aria-label')||''),
        hideAria:(hide.getAttribute('aria-label')||'')};
    })()`);
    d.window.close();

    if (!r || r.missing) F(`40. 숨기기 — ${r && r.missing ? r.missing + ' 가 없다' : '못 쟀다'}`);
    else if (r.few !== undefined) F(`40. 숨기기 — 이어진 결과 노드가 ${r.few}개뿐이라 못 쟀다`);
    else {
      const S = Object.fromEntries(r.steps.map(x => [x.at, x]));
      const S0 = S['누름'] ? S['누름'].ringN : -1;   /* 숨기기 전의 선택 구조 */
      const want = [
        ['누름',      s2 => s2.on && !s2.chip && s2.focus,            '눌렀는데 카드가 안 열리거나 칩이 떠 있다'],
        ['숨김',      s2 => !s2.on && s2.chip && s2.focus && s2.ringN === S0,
          '숨겼는데 고른 것이 풀렸거나(이어진 것이 바뀜) 되돌릴 칩이 없다'],
        ['다른 사건', s2 => !s2.on && s2.chip && s2.focus,            '다른 사건을 눌렀더니 감춘 상태를 잊었다'],
        ['다시 보기', s2 => s2.on && !s2.chip,                        '되돌렸는데 카드가 안 나오거나 칩이 남았다'],
        ['닫기',      s2 => !s2.on && !s2.chip && !s2.focus,          '닫았는데 고른 것이 남았거나 칩이 남았다'],
      ];
      want.forEach(([k, ok, msg]) => { if (!S[k] || !ok(S[k])) F(`40. 숨기기 — ${k}: ${msg}`) });
      /* 이름으로 차이가 드러나야 한다 — 둘 다 '닫기' 면 사람이 구별할 수 없다 */
      if (!/숨기/.test(r.hideLabel)) F(`40. 숨기기 버튼 글자가 '${r.hideLabel}' 다. 무엇을 하는지 안 드러난다`);
      if (!/닫기/.test(r.closeLabel) || !/푼|풉|풀/.test(r.closeLabel))
        F(`40. 닫기 버튼 설명이 '${r.closeLabel}' 다. 숨기기와 어떻게 다른지 안 드러난다`);
      console.log(`40. 숨기기          ${r.steps.map(x => x.at + (x.on ? '·카드' : '') + (x.chip ? '·칩' : '') + (x.focus ? '·선택' + x.ringN : '')).join(' → ')}`);
    }
  }

  // 41. 카드가 조작 UI 를 밀지도, 덮지도 않는가
  //     약속: **카드를 여는 것만으로는 아무것도 안 움직인다.
  //           그리고 카드는 지도를 덮되 조작 UI 는 덮지 않는다.**
  //     지도와 조작 UI 는 다르다 — 지도는 가려도 카드의 관계 목록이 받아주지만,
  //     조작 UI 는 가리면 쓸 수 없다.
  //     두 번 났다. (1) body.panelon .search{left:calc(50% - 224px)} 가 검색창을 밀었다.
  //     (2) .pop{top:58px} 이 박혀 있어 1280x960 에서 카드 머리가 분야 탭 뒤로 들어가고
  //         펼치면 검색창을 16,000px² 덮었다.
  //
  //     jsdom 은 레이아웃을 안 해 겹침을 픽셀로 못 잰다. 재는 척하지 않는다.
  //     대신 (a) 미는 규칙이 없다 (b) 카드 높이가 --topsafe 에 묶여 있다
  //     (c) --topsafe 를 숫자가 아니라 요소에게 물어서 정하고, 상태가 바뀔 때마다 다시 잰다
  //     — 셋을 강제하고, (d) 그 계산식은 가짜 기하를 넣어 직접 돌려 본다.
  //     픽셀 실측은 docs/화면점검.md 에 남긴다.
  {
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const TOPSEL = ['.search', '.catbar', '.topbar', '.undo', '.ub', '.rolebar', '.legendbtn', '.cats', '.catmore'];
    const MOVE = /(^|;)\s*(top|right|bottom|left|margin|transform|inset)\s*:/;

    /* (a) 카드가 열렸다고 조작 UI 를 옮기는 규칙이 있으면 FAIL */
    const push = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(m => /\.(panelon|popfull)\b/.test(m[1]))
      .filter(m => TOPSEL.some(t => new RegExp('\\' + t + '(?![\\w-])').test(m[1])))
      .filter(m => MOVE.test(m[2]))
      .map(m => m[1].trim().split('\n').pop().trim());
    if (push.length) F(`41. 카드가 조작 UI 를 민다 — ${push.join(', ')}. 카드를 여는 것만으로는 아무것도 안 움직여야 한다`);

    /* (b) 카드가 위로 자랄 수 있는 한계가 --topsafe 에 묶여 있는가.
           옆 패널은 top, 아래 카드는 max-height 로 묶인다. 둘 다 있어야 한다. */
    /* **기본** .pop 규칙(position:fixed 를 가진 그것)을 봐야 한다.
       그냥 '.pop 어딘가에 --topsafe 가 있나' 로 재면, 낮은 가로 화면 블록의
       .pop 규칙이 대신 매칭돼서 기본에 top:58px 을 박아도 통과한다 — 실제로 그랬다. */
    const sideTop = /\.pop\{[^}]*position:\s*fixed[^}]*top:\s*var\(--topsafe/.test(css);
    const sheetCap = /@media \(max-width:1000px\)\{[\s\S]*?\.pop\{[^}]*max-height:\s*calc\([^}]*--topsafe/.test(css);
    if (!sideTop) F('41. 옆 카드의 top 이 --topsafe 에 안 묶여 있다. 위쪽 UI 위로 올라갈 수 있다');
    if (!sheetCap) F('41. 아래 카드에 max-height 상한이 없다. 펼치면 위쪽 UI 를 덮는다');

    /* (c) --topsafe 를 요소에게 물어서 정하는가 · 상태가 바뀔 때마다 다시 재는가 */
    /* 인자를 받게 바뀌었다(force). **약속은 그대로**다 — 요소에게 물어서 정한다.
       시그니처를 박아 두면 이런 변화에 검사가 엉뚱하게 FAIL 한다. */
    const fn = html.match(/function updateTopSafe\([^)]*\)[\s\S]*?\n\}/);
    if (!fn) F('41. updateTopSafe 를 못 찾았다');
    else {
      const b = fn[0];
      if (!/offsetTop/.test(b) || !/offsetHeight/.test(b))
        F('41. --topsafe 를 요소에게 안 묻는다. 숫자로 박으면 상단 구성이 바뀔 때 조용히 어긋난다');
      if (/getBoundingClientRect/.test(b))
        F('41. --topsafe 가 getBoundingClientRect 를 쓴다. transform 잔상을 읽는다 — offset* 을 써야 한다');
    }
    const callers = ['function size()', 'function applyPopVisible()', 'function setPopFull('];
    const missing = callers.filter(c => {
      const i = html.indexOf(c); if (i < 0) return true;
      return !/updateTopSafe/.test(html.slice(i, i + 1400));
    });
    if (missing.length) F(`41. --topsafe 를 다시 재지 않는 곳: ${missing.join(', ')}. 상태가 바뀌면 낡은 값이 남는다`);

    /* (d) 계산식을 직접 돌려 본다 — 가짜 기하를 넣고 '가장 아래 UI 의 아래끝 + 8' 이 나오는가.
           위쪽 UI 만 세야 한다: 화면 아래쪽에 사는 것(폰의 '보는 법' 버튼)은 빼야 한다. */
    {
      const d41 = boot(1000, 800);
      await new Promise(r => setTimeout(r, 1200));
      const got = d41.window.eval(`(function(){
        var W=window, D=document;
        var fake={'.topbar':[0,60],'.catbar':[62,52],'.search':[128,110],
                  '.undo':[0,0],'.rolebar':[0,0],'.legendbtn':[700,50]};
        TOP_UI.forEach(function(sel){
          var e=D.querySelector(sel); if(!e)return;
          var v=fake[sel]||[0,0];
          Object.defineProperty(e,'offsetTop',{value:v[0],configurable:true});
          Object.defineProperty(e,'offsetHeight',{value:v[1],configurable:true});
        });
        /* **강제로 다시 잰다.** 이 함수는 상태가 그대로면 건너뛴다(리플로가 비싸다).
           여기서 보는 것은 '계산식이 맞나' 이지 '언제 재나' 가 아니다. */
        updateTopSafe(1);
        return D.documentElement.style.getPropertyValue('--topsafe');
      })()`);
      d41.window.close();
      /* 검색창 아래끝 238 이 가장 아래다. '보는 법' 은 700 이라 아래쪽 — 빼야 한다.
         빼지 않으면 758 이 나온다. */
      if (got !== '246px')
        F(`41. --topsafe 계산이 246px 이 아니라 '${got}' 다 (검색창 128+110=238, +8). ` +
          (got === '758px' ? '아래쪽에 있는 보는 법 버튼까지 세고 있다' : '가장 아래 위쪽-UI 를 못 고른다'));
      else console.log(`41. 카드 vs 조작UI  미는 규칙 ${push.length}개 · 옆카드 top ${sideTop ? 'O' : 'X'} · 아래카드 상한 ${sheetCap ? 'O' : 'X'} · 다시 재는 곳 ${callers.length - missing.length}/${callers.length} · 계산 ${got} (픽셀 겹침은 jsdom 이 못 잰다)`);
    }
  }

  // 42. 잘린 것이 '모두 보기' 로 이어지는가 · 그 목록이 시간순인가
  //     지도는 이름표를 데스크톱 9개 · 폰 2개까지만 그린다 (docs/많이보기.md 실측).
  //     그래서 잘리는 것 자체는 막을 수 없다. **막아야 하는 것은 거기서 길이 끊기는 것이다.**
  //     "+234" 로 끝내면 사용자는 나머지를 볼 방법이 없다.
  //
  //     정렬은 **시간순 하나**다. 중요도로 정렬하면 우리가 '뭐가 중요한지' 를 판단하는 게 되고,
  //     사건이 구조적으로 뒤로 밀린다 — 사건은 대부분 '같은 주제' 로만 이어지기 때문이다.
  //     사건은 이 지도에서 가장 많은 노드고 판례를 받으면 훨씬 늘어난다.
  {
    const d42 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = d42.window.eval(`(function(){
      if(typeof chainOf!=='function')return {no:'chainOf'};
      if(typeof openAllList!=='function')return {no:'openAllList'};
      /* 이어진 것이 많은 결과 노드를 고른다. 적으면 잘릴 일이 없어 검사가 빈손이 된다. */
      var cands=N.filter(function(n){return n.t==='result'&&!n.ghost})
        .map(function(n){return {n:n,c:chainOf(n.id).length}}).sort(function(a,b){return b.c-a.c});
      if(!cands.length)return {no:'result'};
      /* 실제 데이터가 적을 수 있으므로 선을 주입해 '많을 때' 를 만든다 */
      var tgt=cands[0].n;
      var pool=N.filter(function(x){return (x.t==='bill'||x.t==='event')&&x.id!==tgt.id&&yr(x)}).slice(0,40);
      pool.forEach(function(b){L.push([b.id,tgt.id,'주입','result','검사용',1,'검사'])});
      rebuildLinks();refilter();
      for(var i=0;i<200&&alpha>ALPHA_MIN;i++)tick();
      var cam0=[cam.s,cam.x,cam.y,W,H].join();
      setFocus(tgt.id);
      for(var j=0;j<200&&alpha>ALPHA_MIN;j++)tick();
      var chain=chainOf(tgt.id);
      var drawn=Object.keys(ring).filter(function(k){return ring[k]===1}).length;
      var cardBtn=document.querySelector('#detail .allbtn');
      openAllList(tgt.id);
      var items=[].slice.call(document.querySelectorAll('#allChain li'));
      var cam1=[cam.s,cam.x,cam.y,W,H].join();
      /* 목록에 찍힌 연도를 그대로 읽어 오름차순인지 본다 —
         chainOf 가 정렬했다고 믿지 않는다. 화면에 나온 것을 잰다. */
      var years=items.map(function(li){
        var t=(li.querySelector('.ch-y')||{}).textContent||'';
        /* 템플릿 리터럴 안에서는 \\d 로 써야 한다. \\ 를 하나만 쓰면 JS 가 먹어서
           정규식이 /(d{4})/ 가 되고 연도를 하나도 못 찾는다 — 실제로 그랬다. */
        var m=t.match(/(\\d{4})/); return m?+m[1]:null}).filter(function(v){return v});
      /* ── 약속이 바뀌었다: '시간순 하나' → '층 → 시간순' ──
         근거가 어떻게 만들어졌는지로 세 층을 나누고, **같은 층 안에서만** 시간순이다.
         옛 검사는 전체가 오름차순인지 봤다. 그대로 두면 새 화면이 FAIL 인데
         화면이 틀린 게 아니라 검사가 낡은 것이다.
         **한도를 풀어 통과시키지 않고, 무엇을 재는지를 바꾼다.**
         층은 화면의 '왜 이어졌나' 줄에서 읽는다 — 검사가 층을 다시 계산하지 않는다. */
      var TL=['손으로 확인해 이었습니다','재판부가 적은 조문으로 이었습니다','이름이 맞아 자동으로 이었습니다'];
      var tiers=items.map(function(li){
        var t=(li.querySelector('.ch-why')||{}).textContent||'';
        for(var i=0;i<TL.length;i++)if(t.indexOf(TL[i])===0)return i+1;
        return 9});
      var tierSorted=tiers.every(function(v,i){return i===0||tiers[i-1]<=v});
      var inTier=true;
      for(var i2=1;i2<years.length;i2++)
        if(tiers[i2]===tiers[i2-1]&&years[i2-1]>years[i2])inTier=false;
      var sorted=tierSorted&&inTier;
      var hidden=hiddenEdges;
      closeAllList();
      return {chain:chain.length, drawn:drawn, hidden:hidden, items:items.length,
              years:years.length, sorted:sorted, tierSorted:tierSorted, inTier:inTier,
              tierSeen:tiers.filter(function(v,i,a){return a.indexOf(v)===i}).sort(),
              camSame:cam0===cam1,
              btn:!!cardBtn, btnAll:cardBtn?cardBtn.getAttribute('data-all'):null,
              note:(document.getElementById('allNote')||{}).textContent||''};
    })()`);
    d42.window.close();

    if (!r || r.no) { F(`42. 모두 보기 — 못 쟀다 (${r && r.no || '실패'})`); }
    else {
      console.log(`42. 모두 보기       이어진 것 ${r.chain} · 지도에 ${r.drawn} · 숨긴 선 ${r.hidden} · 목록 ${r.items} · 층 ${JSON.stringify(r.tierSeen)} 순서 ${r.tierSorted ? 'O' : 'X'} · 층 안 시간순 ${r.inTier ? 'O' : 'X'} · 카메라 그대로 ${r.camSame ? 'O' : 'X'}`);
      /* (1) 잘린 것이 있으면 반드시 이어주는 길이 있어야 한다 */
      if (r.hidden > 0 && !r.btn)
        F(`42. 지도에서 ${r.hidden}개가 잘렸는데 '모두 보기' 버튼이 없다. "+N" 으로 끝내면 거기서 길이 막힌다`);
      /* (2) 목록은 이어진 것을 전부 담아야 한다 — 여기서 또 자르면 같은 문제다 */
      if (r.items < r.chain)
        F(`42. 모두 보기에 ${r.items}/${r.chain}개만 있다. 여기서도 자르면 다 볼 길이 없다`);
      /* (3) 시간순 */
      if (!r.years) F('42. 목록에 연도가 하나도 안 보인다. 연도가 안 보이면 그냥 목록이다');
      else if (!r.tierSorted) F(`42. 근거의 층이 뒤섞였다 (본 층 ${JSON.stringify(r.tierSeen)}). 손으로 이은 것 → 조문 → 이름 순이어야 한다`);
      else if (!r.inTier) F('42. 같은 층 안에서 시간순이 아니다. 층 말고 다른 것으로 정렬하면 우리가 판단하는 게 된다');
      if (r.tierSeen && r.tierSeen.indexOf(9) >= 0) F('42. 층을 알 수 없는 항목이 있다 — 화면에 근거를 안 적었다는 뜻이다');
      /* (4) 카메라를 건드리면 안 된다 — 닫으면 원래 자리로 돌아와야 한다 */
      if (!r.camSame) F('42. 모두 보기를 열자 카메라가 움직였다. 닫으면 원래 자리여야 한다');
      /* (5) 몇 개를 지도에 그리고 몇 개가 목록에 있는지 밝혀야 한다 */
      if (!/지도에는/.test(r.note))
        F('42. 지도에 몇 개만 그리는지 화면에 안 밝힌다. 말없이 자르면 "이게 전부" 가 된다');
      if (r.chain < 10) W(`42. 이어진 것이 ${r.chain}개뿐이라 잘림을 충분히 못 쟀다`);
    }
  }

  /* ── 45. 자동으로 만든 관계에 '자동' 표시가 있나 ──
     전에는 표시가 선에 없고 **붙은 노드가 auto 인지로 유추**했다.
     그러면 표시가 빠져도 화면이 그대로라 아무도 모른다 —
     실제로 자동 선 266개가 자기 표시 없이 들어가 있었다.
     지금은 8번째 칸이 'auto' 다. 없으면 실선으로 그려져 손으로 넣은 선처럼 보인다.
     **자동/수동이 화면에서 안 갈리면 그건 우리가 주장을 사실처럼 내보내는 것이다.** */
  {
    const autoIds = new Set(N.filter(n => n.auto).map(n => n.id));
    const touch = L.filter(l => autoIds.has(l[0]) || autoIds.has(l[1]));
    const marked = L.filter(l => l[7] === 'auto');
    const missing = touch.filter(l => l[7] !== 'auto');
    /* ── **자동 선 = 자동 블록에서 나온 선**. 노드가 auto 인지와 별개다 ──
       전에는 "양쪽 노드가 다 손으로 넣은 것이면 그 선도 손으로 넣은 것" 이라고 봤다.
       그런데 사건의 '그때 정권'(TERM_L)은 **손으로 넣은 대통령과 손으로 넣은 사건 사이에
       계산으로 만든 선**이다. 옛 판정은 그걸 "손으로 넣은 선에 자동 표시가 붙었다" 고 했다.
       표시의 뜻은 **"이 선을 우리가 계산으로 만들었다"** 이지 "붙은 노드가 자동" 이 아니다.
       그래서 도구가 쓰는 블록 안에 실제로 있는지로 판정한다. */
    const autoBlocks = ['AUTO-L', 'AUTO-TERM', 'AUTO-CASE-L'].map(k => {
      const a = html.indexOf(`/*${k}-START*/`), b = html.indexOf(`/*${k}-END*/`);
      return (a >= 0 && b > a) ? html.slice(a, b) : '';
    }).join('\n');
    const fromBlock = l => autoBlocks.includes(`'${l[0]}','${l[1]}'`);
    const stray = marked.filter(l => !autoIds.has(l[0]) && !autoIds.has(l[1]) && !fromBlock(l));
    console.log(`45. 자동표시        자동 노드 ${autoIds.size} · 그에 닿는 선 ${touch.length} · 표시된 선 ${marked.length}`);
    if (!autoIds.size) F('45. 자동 노드가 하나도 없다. 자동 연결이 안 들어갔거나 auto 표시가 빠졌다');
    if (missing.length)
      F(`45. 자동으로 만든 선 ${missing.length}/${touch.length}개에 '자동' 표시가 없다. ` +
        `첫 번째: ${missing[0][0]} → ${missing[0][1]}. 표시가 없으면 손으로 확인해 넣은 선과 안 갈린다`);
    if (stray.length)
      F(`45. 손으로 넣은 선 ${stray.length}개에 '자동' 표시가 붙어 있다 (어느 자동 블록에도 없다): ${stray[0][0]} → ${stray[0][1]}`);
    /* 화면에도 실제로 나오는지 — 있다고 쓰기만 하고 안 그리면 같은 거짓말이다 */
    const dash = /var isAuto=\(l\[7\]==='auto'\)/.test(html);
    if (!dash) F("45. 그리기가 선의 표시(l[7])를 안 본다. 노드에서 유추하면 표시가 빠져도 화면이 그대로다");
    if (!/c\.auto\|\|o\.auto/.test(html)) F("45. 카드 관계 목록이 선의 자동 표시를 안 쓴다");
  }

  /* ── 46. 또렷하게 고른 것이 한쪽으로 기울지 않았나 ──
     첫 화면에서 결과 말고도 일부를 또렷하게 그린다. **무엇을 고르느냐가 편집이다.**
     기준은 판단이 아닌 것뿐이다 — 이어진 선의 수(사실) · 종류별 몫 · id 순.
     진영(side)은 기준에 **안 넣는다.** 넣으면 그 순간 우리가 균형을 연출한 것이 된다.
     대신 매번 분포를 띄운다. 기울면 손으로 고치지 않고 **그 사실을 밝힌다.** */
  {
    const d46 = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1200));
    const r = d46.window.eval(`(function(){
      if(typeof planBright!=='function')return null;
      var pool=A.filter(function(n){return n.t!=='result'});
      var B=planBright(), sel=pool.filter(function(n){return B[n.id]});
      var cnt=function(a,f){return a.reduce(function(o,n){var k=f(n)||'없음';o[k]=(o[k]||0)+1;return o},{})};
      return {K:BRIGHT_K, 뽑힘:sel.length, 모집단:pool.length,
        선택진영:cnt(sel,function(n){return n.side}), 기준진영:cnt(pool,function(n){return n.side}),
        선택종류:cnt(sel,function(n){return n.t}), 기준종류:cnt(pool,function(n){return n.t}),
        /* **캐시를 비우고 다시 부른다.** 그냥 두 번 부르면 같은 캐시가 돌아와
           언제나 '같다' 가 된다 — 실제로 무작위를 주입해도 통과했다.
           아무것도 안 잡는 검사는 언제나 PASS 라서 가장 오래 산다. */
        고정:(function(){var a=Object.keys(B).sort().join(',');
          brightSet=null;brightKey='';
          var b=Object.keys(planBright()).sort().join(',');
          brightSet=null;brightKey='';
          return a===b})()};
    })()`);
    d46.window.close();
    if (!r) { F('46. planBright 가 없다 — 또렷하게 고르는 경로가 사라졌다'); }
    else {
      const pc = (o, t) => Object.keys(o).sort().map(k => `${k} ${(o[k] / t * 100).toFixed(0)}%`).join(' · ');
      console.log(`46. 또렷 고르기    K=${r.K} · 뽑힘 ${r.뽑힘}/${r.모집단}`);
      console.log(`     진영 뽑힌 것  ${pc(r.선택진영, r.뽑힘)}`);
      console.log(`     진영 기준선   ${pc(r.기준진영, r.모집단)}`);
      console.log(`     종류 뽑힌 것  ${Object.keys(r.선택종류).sort().map(k => k + ' ' + r.선택종류[k]).join(' · ')}`);
      if (!r.뽑힘) F('46. 결과 말고 또렷한 것이 하나도 없다 — 화면이 노란 원만 남는다');
      if (!r.고정) F('46. 두 번 부르면 다른 것을 고른다 — 흔들리면 그것도 우리가 고른 것이다');
      /* 기준선보다 8%p 넘게 벌어진 진영이 있으면 밝힌다. FAIL 은 아니다 —
         데이터 자체가 기울어 있고(gov 74%), 손으로 맞추면 연출이 된다. */
      for (const k of Object.keys(r.기준진영)) {
        const a = (r.선택진영[k] || 0) / r.뽑힘 * 100, b = r.기준진영[k] / r.모집단 * 100;
        if (Math.abs(a - b) > 8)
          W(`46. 진영 ${k} 가 뽑힌 것 ${a.toFixed(0)}% · 기준선 ${b.toFixed(0)}% 로 ${Math.abs(a-b).toFixed(0)}%p 벌어졌다`);
      }
      /* 한 종류가 다 먹으면 몫이 안 도는 것이다 */
      const kinds = Object.keys(r.기준종류);
      const zero = kinds.filter(k => !r.선택종류[k]);
      if (zero.length) F(`46. 종류 ${zero.join(', ')} 가 한 개도 안 뽑혔다 — 종류별 몫이 안 돌고 있다`);
    }
  }

  /* ── 47. 자동으로 들어온 글에 사람 이름이 있나 (규칙 8) ──
     판례 본문에는 `담당변호사 ○○○` 이 그대로 있다. 당사자·증인도 있을 수 있다.
     **법원이 공개한 자료라도 우리가 다시 모아 올리는 것은 다른 일이다** —
     흩어져 있던 이름이 한 곳에 모이면 그 순간 명단이 된다.
     그리고 이 사이트는 JSON 을 통째로 내보내므로 화면에 안 그려도 파일에 있으면
     배포한 것이다. 그래서 '화면에 안 그린다' 로는 못 막는다.

     **대상은 자동으로 들어온 노드(auto:1)뿐이다.** 손으로 넣은 인물 노드는
     공적 인물이고 근거를 확인해 넣은 것이라 대상이 아니다.
     못 잡는 것은 docs/규칙.md 규칙 8 에 적어 두었다. */
  {
    /* **처음엔 너무 넓었다.** 역할어만 보고 뒤 2~4자를 이름으로 쳤더니
       현재 데이터에서 29곳이 걸렸는데 **전부 오탐**이었다 —
       「특별검사」(법 이름) · 「유전자검사」 · 「증인에게」 · 「피해자 보호에」.
       거짓 경보는 거짓 통과만큼 나쁘다. 없는 문제를 고치느라 있는 문제를 못 본다.

       그래서 두 가지를 요구한다.
         ① **띄어쓰기** — '유전자검사' 처럼 붙은 말은 역할어가 아니다
         ② **성씨 목록으로 시작하는 2~3자** — '등의' '보호에' 는 이름이 아니다 */
    const SUR = '김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|유|진|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|소|석|선|설|마|길|연|위|표|명|기|반|왕|금|육|맹|모|사|구|탁|국|어|은|편|용';
    /* **역할어를 골라야 한다.** '원고'·'피고' 는 판례에서 당사자를 가리키는 말로
       늘 익명으로 쓰인다 — 「원고 주장의」·「피고 소속」 이 35곳 걸렸는데 전부 오탐이었다.
       그리고 뒤에 조사가 붙으면 이름이 아니다 (주장의 · 명의의 · 조합이).
       실측으로 남긴 것만 쓴다. 놓치는 것은 규칙 8 에 적어 두었다. */
    const JOSA = '의|은|는|이|가|을|를|와|과|도|만|에|서|로|나|랑';
    const ROLE = '담당변호사|변호인|변호사|피고인|증인|참고인|고소인|고발인|신청인|청구인|대리인';
    const HARD = [
      /* **띄어쓰기를 반드시 요구한다.** \s* 로 뒀더니 죄명 「증인도피」 를
         '증인' + '도피' 로 읽어 오탐이 났다. 실제 이름은 늘 띄어져 있다. */
      new RegExp(`(?:${ROLE})\\s+(?:${SUR})[가-힣]{0,2}(?![가-힣])(?<!${JOSA})`, 'g'),
      /* **이름 앞에도 경계를 요구한다.** 안 그러면 '금지하는 검사' 의 꼬리 '지하는' 을
         이름으로 읽는다 — 실제로 그렇게 한 곳이 걸렸다. */
      new RegExp(`(?:^|[\\s"'(\\[\u00b7,])(?:${SUR})[가-힣]{1,2}(?<!${JOSA})\\s+(?:변호사|판사|재판장)(?![가-힣])`, 'g'),
    ];
    /* 넓은 그물. 법 이름·기관명도 걸리니 WARN 이고, 눈으로 본다 */
    const SOFT = new RegExp(`(?:^|[\\s"'(\\[\u00b7,])(?:${SUR})[가-힣]{2}(?=[\\s"'),.\\]]|$)`, 'g');
    const fields = ['lab', 'title', 'tip', 'body', 'off', 'plain', 'reason', 'ekind', 'gist'];
    const autoN = N.filter(n => n.auto);
    let hard = [], soft = 0, scanned = 0;
    for (const n of autoN) for (const f of fields) {
      const v = n[f]; if (typeof v !== 'string' || !v) continue;
      scanned++;
      /* **한 칸에 여러 곳이 있을 수 있다.** 처음엔 m[0] 만 담아서
         '담당변호사 ○○○' 과 '피고인 ○○○' 이 같이 있는 칸을 1곳으로 셌다.
         분모·분자를 줄여 말하면 그것도 말없이 자르는 것이다. */
      for (const re of HARD) { const m = v.match(re); if (m) m.forEach(x => hard.push(`${n.id}.${f}: "${x.trim()}"`)) }
      if (SOFT.test(v)) soft++; SOFT.lastIndex = 0;
    }
    console.log(`47. 사람 이름       자동 노드 ${autoN.length}개 · 살펴본 칸 ${scanned}개 · 명백 ${hard.length} · 의심 ${soft}`);
    if (!autoN.length) W('47. 자동 노드가 없어 아무것도 못 봤다 — 0건은 "문제 없음" 이 아니다');
    if (hard.length)
      F(`47. 자동으로 들어온 글에 사람 이름이 ${hard.length}곳 있다 (규칙 8). ` +
        hard.slice(0, 3).join(' / ') + (hard.length > 3 ? ` 외 ${hard.length - 3}곳` : ''));
    if (soft) W(`47. 이름일 수 있는 것 ${soft}곳 — 성씨+2자 패턴이다. 법 이름·기관명도 걸리니 눈으로 볼 것`);
  }

  /* ── 48. 첫 화면이 확대됐다가 줄어들지 않나 ──
     cam 은 배율 1(확대)에서 시작해 목표로 다가간다. 그 과정이 그대로 보이면
     **들어오자마자 확대된 채 떴다가 동그랗게 줄어든다.** 우리가 보여주려던 움직임이 아니다.
     그리기 전에 자리를 잡고(사전 틱) 첫 배율을 즉시 붙인다.
     화면이 뜨는 동안 배율이 얼마나 오갔는지를 페이지가 __camTrace 에 적고, 여기서 읽는다.
     **계산으로 다시 만들지 않는다** — 화면이 실제로 쓴 값이다. */
  {
    const d48 = boot(1280, 800);
    await new Promise(r => setTimeout(r, 1800));
    const r = d48.window.eval(`(function(){
      var t=window.__camTrace||[];
      if(!t.length)return null;
      return {n:t.length, min:Math.min.apply(null,t), max:Math.max.apply(null,t),
              first:t[0], pre:window.__preTicks||0, preMs:Math.round(window.__preMs||0),
              onScreen:A.filter(function(x){var sx=x.x*cam.s+cam.x,sy=x.y*cam.s+cam.y;
                return sx>0&&sx<W&&sy>0&&sy<H}).length, total:A.length};
    })()`);
    d48.window.close();
    if (!r) F('48. __camTrace 가 없다 — 첫 배율을 재는 길이 사라졌다');
    else {
      const wob = +(r.max - r.min).toFixed(3);
      console.log(`48. 첫 배율        ${r.first} 고정 · 흔들림 ${wob} · 표본 ${r.n} · 사전 정착 ${r.pre}틱 ${r.preMs}ms · 화면안 ${r.onScreen}/${r.total}`);
      if (wob > 0.05)
        F(`48. 첫 화면 배율이 ${r.min}~${r.max} 로 흔들린다 (허용 0.05). 확대됐다가 줄어드는 것으로 보인다`);
      if (!r.pre) F('48. 사전 정착을 안 했다 — 물리 전 좌표로 맞추면 배율이 틀린다');
      if (r.preMs > 400) W(`48. 사전 정착이 ${r.preMs}ms 걸린다 — 첫 그림이 그만큼 늦는다`);
      if (r.onScreen < r.total) W(`48. 첫 화면에 ${r.total - r.onScreen}개가 화면 밖이다 (${r.onScreen}/${r.total})`);
    }
  }

  /* ── 49. 상단 UI 뒤의 노드는 누를 수 없다 · 모으는 동안 반지름은 안 흔들린다 ──
     검색창·범례·'처음으로' 알약은 캔버스 **위에** 떠 있다. 그 뒤에 노드가 있으면
     클릭이 UI 에 먹혀 **누를 방법이 아예 없다.** 안 보이는 것보다 나쁘다 —
     보이는데 안 눌린다.
     그리고 이어진 것을 모을 때 **각도만** 움직여야 한다. 반지름은 연도이고,
     그게 흔들리면 시간이 거짓말이 된다. 한 프레임에 튀는 양도 함께 잰다. */
  {
    const d49 = boot(1280, 800);
    await new Promise(r => setTimeout(r, 1400));
    const r = d49.window.eval(`(function(){
      var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
      /* ── **검사가 상단 높이를 넣어준다** ──
         전에는 top=topSafePx() 로 페이지가 주는 값을 그대로 받아 쟀다.
         jsdom 은 레이아웃을 안 해서 그 값이 0 이고, **0 아래에 있는 노드는 없으므로
         언제나 "가려진 노드 0" 이었다.** var top=0 을 주입해도 통과했다 —
         검사가 버그와 똑같은 맹점을 갖고 있었던 것이다.
         그래서 검사가 값(114px)을 넣고, **페이지가 그것을 실제로 쓰는지**를 본다.
         이 114 가 CSS 와 맞는지는 검사 27 이 따로 지킨다. */
      if(typeof topSafePx!=='function')return {no:'topSafePx 가 없다'};
      var top=114, used=0;
      topSafePx=function(){used++;return top};
      if(typeof fit==='function')fit();
      cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      if(!used)return {no:'fit() 이 topSafePx() 를 안 부른다 — 상단 UI 를 피하지 않는다'};
      /* 첫 화면도 한 프레임 흘려보낸 뒤에 잰다 — clampY 가 덮어쓰는지 보려면 필요하다 */
      for(var fq=0;fq<30;fq++){if(typeof fade==='function')fade();
        cam.x+=(cam.tx-cam.x)*0.11; cam.y+=(cam.ty-cam.y)*0.11}
      /* (1) 상단 UI 뒤에 있는 노드 — 화면 안인데 UI 아래(=위쪽)에 깔린 것 */
      var hidden=A.filter(function(n){
        var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
        return sx>=0&&sx<=W&&sy>=0&&sy<top;
      }).length;
      /* (2) 모으는 동안 반지름이 바뀌나 · 한 프레임에 얼마나 튀나 */
      var res=A.filter(function(n){return n.t==='result'&&(adj[n.id]||[]).length>3});
      if(!res.length)return {no:'결과 노드가 없다'};
      var tgt=res.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
      var r0={}; A.forEach(function(n){r0[n.id]=Math.hypot(n.x,n.y/0.86)});
      var p0={}; A.forEach(function(n){p0[n.id]=[n.x,n.y]});
      setFocus(tgt.id);
      /* **초점 카메라도 불러야 한다.** 전에는 setFocus 만 부르고 카메라를 이징만 했다.
         그래서 fitFocus() 가 상단 UI 를 안 피하는 것을 못 잡았다 —
         브라우저에서는 누른 노드가 y=182, 상단 UI 가 234px 이었다(실측).
         검사가 화면이 실제로 하는 일을 다 하지 않으면 그 사이가 사각지대가 된다. */
      if(typeof fitFocus==='function')fitFocus();
      var worst=0, worstWho=null, dR=0, dRwho=null;
      for(var f=0;f<200;f++){
        tick();
        /* **fade() 도 돌린다.** 그 안에서 clampY() 가 매 프레임 cam.ty 를 다시 정한다.
           tick() 만 돌리면 그걸 안 보게 되고, fit 직후만 재게 된다 —
           브라우저는 그 다음 프레임을 보여준다. 실제로 clampY 가 상단 UI 를 무시하고
           화면 정중앙에 맞추고 있었는데 **검사만 통과했다.** */
        if(typeof fade==='function')fade();
        cam.s+=(cam.ts-cam.s)*0.11; cam.x+=(cam.tx-cam.x)*0.11; cam.y+=(cam.ty-cam.y)*0.11;
        A.forEach(function(n){
          if(p0[n.id]){
            var d=Math.hypot(n.x-p0[n.id][0],n.y-p0[n.id][1])*cam.s;
            if(d>worst){worst=d;worstWho=n.lab}
          }
          p0[n.id]=[n.x,n.y];
          /* ── **둘레로 모으는 노드는 여기서 빼고 본다** ──
             약속이 바뀌었다. 원으로 모으면 반지름(=연도)이 깨지므로,
             그동안은 **각도가 시간을 맡는다** — 12시부터 시계 방향으로 시간순이다.
             그게 실제로 시간순인지는 검사 62 가 잰다.
             49 가 계속 지키는 것은 **모으지 않는 노드의 반지름**과,
             **닫으면 반지름이 돌아오는지**다. 낡은 검사를 지우지 않고 할 수 있는 것을 남긴다. */
          if(n.orb)return;
          if(r0[n.id]!==undefined){
            var rr=Math.abs(Math.hypot(n.x,n.y/0.86)-r0[n.id]);
            if(rr>dR){dR=rr;dRwho=n.lab}
          }
        });
      }
      /* 닫으면 반지름이 돌아오나 — 모으기가 켜져 있을 때 이것이 마지막 보증이다 */
      var back=0, backWho=null;
      if(typeof closePop==='function'){
        closePop();
        for(var f2=0;f2<300;f2++){ tick(); if(typeof fade==='function')fade() }
        A.forEach(function(n){
          if(r0[n.id]===undefined)return;
          var rr=Math.abs(Math.hypot(n.x,n.y/0.86)-r0[n.id]);
          if(rr>back){back=rr;backWho=n.lab}
        });
      }
      /* ── 무엇을 FAIL 로 볼지 ──
         초점 무리는 화면보다 크다 (실측 1,177px vs 자리 686px). 그러면 **어디든 잘린다** —
         "이웃이 하나도 UI 뒤에 없다" 는 이룰 수 없는 요구다. 그걸 FAIL 로 두면
         검사가 영원히 빨간불이거나, 통과시키려고 화면을 이상하게 만들게 된다.
         **누른 것 자신**이 UI 뒤면 FAIL 이다 — 그건 "눌렀는데 그게 안 눌리는" 화면이다.
         이웃이 몇 개 가려졌는지는 **늘 출력한다.** 말없이 빼면 안 보는 것과 같다.
         이웃이 화면에 몇 개 들어왔는지는 검사 20 이 따로 센다(카드 목록도 함께 본다). */
      var sf2=map[focus];
      var selfHid=0;
      if(sf2){var ssx=sf2.x*cam.s+cam.x, ssy=sf2.y*cam.s+cam.y;
        if(ssx>=0&&ssx<=W&&ssy>=0&&ssy<top)selfHid=1}
      var hidden2=A.filter(function(n){
        var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
        return sx>=0&&sx<=W&&sy>=0&&sy<top;
      }).length;
      return {selfHid:selfHid, top:Math.round(top), hidden:hidden, hidden2:hidden2,
              worst:Math.round(worst), worstWho:worstWho,
              dR:Math.round(dR), dRwho:dRwho, back:Math.round(back), backWho:backWho,
              orbit:(typeof ORBIT!=='undefined'&&ORBIT)?1:0,
              lim:Math.round(Math.min(W,H)/6), n:A.length};
    })()`);
    d49.window.close();
    if (!r || r.no) F(`49. 못 쟀다 (${r && r.no || '실패'})`);
    else {
      console.log(`49. 가려짐·모으기   상단 UI ${r.top}px · 그 뒤 노드 첫화면 ${r.hidden} · 초점 뒤 누른 것 ${r.selfHid?'가려짐':'안 가려짐'} · 한 프레임 최대 ${r.worst}px(${r.worstWho}) · 반지름 흔들림 ${r.dR}px(${r.dRwho})` +
        ` · 닫은 뒤 반지름 ${r.back}px(${r.backWho})` + (r.orbit ? ' · 둘레로 모으는 노드는 빼고 잼(검사 62)' : '') +
        (r.hidden2?` · 이웃 ${r.hidden2}개는 UI 뒤(카드 목록에 있다 — 검사 20)`:''));
      if (r.hidden) F(`49. 첫 화면에서 ${r.hidden}개가 상단 UI 뒤에 있다 — 보이는데 누를 수 없다`);
      if (r.selfHid) F(`49. 누른 노드 자신이 상단 UI 뒤에 있다 — 눌렀는데 그게 안 눌린다`);
      if (r.dR > 3) F(`49. 모으지 않는 노드의 반지름이 ${r.dR}px 바뀌었다 — ${r.dRwho}. 반지름은 연도다, 흔들면 시간이 거짓말이 된다`);
      /* **닫으면 돌아와야 한다.** 모으는 동안 연도를 잠시 접어 두는 것은 약속이지만,
         돌아오지 않으면 그건 접은 게 아니라 잃은 것이다. */
      if (r.back > 30) F(`49. 닫은 뒤에도 반지름이 ${r.back}px 어긋나 있다 — ${r.backWho}. ` +
        `모으는 동안 연도를 접어 두는 것은 약속이지만, 돌아오지 않으면 잃은 것이다`);
      if (r.worst > r.lim) F(`49. 한 프레임에 ${r.worst}px 튄다 — ${r.worstWho} (한도 ${r.lim}px)`);
      if (!r.top) W('49. 상단 UI 높이가 0 이다 — --topsafe 를 못 읽었을 수 있다');
    }
  }

  /* ── 50. 사건에 '그때 정권' 이 붙었나 ──
     법 카드에는 "법이 확정된 때의 정부" 가 있는데 사건에는 없었다.
     「의약분업」(2000년)을 열어도 그때가 김대중 정부라는 표시가 어디에도 없었다.

     **규칙 3 그대로다.** 연도 × 재임표로만 만들고 역할은 term 이다 —
     lead 로 분류되면 "그 정부가 밀어붙였다" 가 된다. 그건 아래에서 FAIL 로 막는다.

     **판례·헌재결정(auto)에는 안 붙인다.** 법원은 정권이 아니고,
     선고연도가 사건 발생과 28.7% 에서 2년 이상 벌어진다(실측 15,269건).
     그래서 여기서도 손으로 넣은 사건만 센다. */
  {
    /* **인물에 딸린 노드(ghost·owner)는 뺀다.** 「IMF 조기 상환」(owner=k1) 은 김대중 카드의
       업적 항목이지 독립 사건이 아니다 — 거기에 "그때 정권 김대중" 을 붙이면 중복이다.
       그리고 index.html 이 이 노드로 가는 링크를 걸러내므로, 만들어도 화면에 안 들어간다.
       **검사와 도구가 같은 것을 세야 숫자가 갈라지지 않는다** — 153 vs 87 로 갈라져 있었다. */
    const hand = N.filter(n => n.t === 'event' && !n.auto && !n.ghost && !n.owner && /^\d{4}$/.test(String(n.yr || '')));
    const prezIds = new Set(N.filter(n => n.prez).map(n => n.id));
    const termOf = {};
    L.forEach(l => { if (l[3] !== 'term') return;
      if (prezIds.has(l[0])) (termOf[l[1]] = termOf[l[1]] || []).push(l[0]);
      if (prezIds.has(l[1])) (termOf[l[0]] = termOf[l[0]] || []).push(l[1]); });
    const withT = hand.filter(n => termOf[n.id]);
    /* 재임표가 담는 시기인지 — 그보다 이르면 붙일 수 없는 게 맞다. 그건 WARN 이 아니다. */
    const FIRST = 1998;
    const missing = hand.filter(n => !termOf[n.id] && Number(n.yr) >= FIRST);
    const tooOld = hand.filter(n => !termOf[n.id] && Number(n.yr) < FIRST);
    console.log(`50. 사건의 그때정권  손으로 넣은 사건 ${hand.length}개 중 ${withT.length}개에 붙었다 · ` +
      `재임표(${FIRST}~) 보다 이른 시기 ${tooOld.length}개 · 자동 사건 ${N.filter(n=>n.t==='event'&&n.auto).length}개는 대상이 아니다`);
    if (missing.length)
      W(`50. 연도가 있는데 '그때 정권' 이 없는 사건 ${missing.length}개: ${missing.slice(0,3).map(n=>n.id+'('+n.yr+')').join(' ')}`);
    /* ── **자동으로 만든 lead 만 막는다** ──
     규칙 3 이 막으려는 것은 "재임 중이었다는 이유로 밀어붙였다고 쓰는 것" 이다.
     손으로 넣은 lead 는 **공식 기록**이다 — 실제로 p4→q1 이 걸렸는데
     "{a} 대통령이 국회에 국정조사를 요청했습니다" 로, 실제 행위 기록이었다.
     그것까지 FAIL 로 잡으면 검사가 사실을 지우게 한다.
     계산으로 만든 선(l[7]==='auto')만 본다 — 계산은 행위를 알 수 없다. */
    const leaked = L.filter(l => l[3] === 'lead' && l[7] === 'auto' &&
      (prezIds.has(l[0]) || prezIds.has(l[1])) &&
      N.some(n => n.t === 'event' && (n.id === l[0] || n.id === l[1])));
    if (leaked.length)
      F(`50. 대통령과 사건이 'lead'(밀어붙임) 로 이어져 있다 ${leaked.length}건: ${leaked[0][0]} → ${leaked[0][1]}. ` +
        `재임 중이었다는 것과 그가 했다는 것은 다르다 — term 이어야 한다`);
    /* 문장에도 그 구별이 있어야 한다. 선만 term 이고 글이 단정하면 화면은 단정한 것이다 */
    const bad = L.filter(l => l[3] === 'term' && prezIds.has(l[0]) &&
      /* **"다릅니다" 에는 "다르" 가 없다.** `것과는 다르` 로 뒀다가 멀쩡한 문장 57건을
         FAIL 로 띄웠다 — 없는 문제였다. 거짓 경보는 거짓 통과만큼 나쁘다. */
      String(l[4] || '').length && !/뜻이 아니|다릅니다|다른 것|아닙니다/.test(String(l[4])));
    if (bad.length)
      F(`50. 'term' 인데 문장이 그 구별을 안 한다 ${bad.length}건: "${String(bad[0][4]).slice(0,40)}…"`);
  }

  /* ── 51. 같은 이름의 노드가 둘 이상 있나 ──
     **id 가 달라도 이름이 같으면 보는 사람에게는 같은 것이다.**
     목록에 같은 줄이 두 번 뜨면 "새로 늘었나" 와 "중복인가" 를 구별할 수 없다.

     다만 **사건은 다르다.** 판례·헌재결정은 같은 사건명이 여러 건인 것이 정상이다 —
     「공직선거법 위반」은 실제로 사건이 11건이고 각각 다른 판결이다.
     그건 우리가 만든 중복이 아니라 사실이라 WARN 으로만 밝힌다.
     대신 그 사건들은 사건번호(off)가 서로 달라야 한다 — 그것까지 같으면 진짜 중복이다. */
  {
    const HARD = ['result', 'bill', 'person', 'party', 'org', 'post'];
    let bad = 0;
    for (const t of HARD) {
      const m = {};
      N.filter(n => n.t === t).forEach(n => { (m[n.lab] = m[n.lab] || []).push(n.id) });
      const dup = Object.entries(m).filter(([, v]) => v.length > 1);
      dup.forEach(([lab, ids]) => { bad++;
        F(`51. ${TKN[t] || t} 에 같은 이름이 ${ids.length}개 있다: 「${String(lab).slice(0, 30)}」 → ${ids.join(' ')}`) });
    }
    /* 사건 — 이름이 같아도 사건번호가 다르면 다른 사건이다 */
    /* **누구의 것인지(owner)까지 같아야 중복이다.** 「퇴임」은 김대중·노무현·이명박·문재인
       카드에 각각 있고 그건 서로 다른 일이다. 「국회의원 첫 당선」·「특별사면」도 마찬가지다.
       owner 를 안 보고 세면 **없는 중복 6건**을 FAIL 로 띄운다 — 실제로 그랬다. */
    const em = {};
    N.filter(n => n.t === 'event').forEach(n => {
      const k = (n.lab || '') + '|' + (n.off || '') + '|' + (n.owner || '');
      (em[k] = em[k] || []).push(n.id) });
    const eDup = Object.entries(em).filter(([, v]) => v.length > 1);
    eDup.forEach(([k, ids]) => { bad++;
      F(`51. 사건에 이름·사건번호·주인이 모두 같은 것이 ${ids.length}개 있다: 「${k.split('|')[0].slice(0, 30)}」 → ${ids.join(' ')}`) });
    /* 같은 실제 사건이 사람마다 따로 노드가 된 경우 — 중복은 아니지만 화면에서는 같아 보인다 */
    const crossOwner = {};
    N.filter(n => n.t === 'event' && n.owner).forEach(n => { (crossOwner[n.lab] = crossOwner[n.lab] || []).push(n) });
    const shared = Object.entries(crossOwner).filter(([lab, v]) =>
      v.length > 1 && N.some(x => x.t === 'event' && !x.owner && x.lab === lab));
    shared.forEach(([lab, v]) =>
      W(`51. 「${lab.slice(0, 24)}」이 사람 카드(${v.map(x => x.owner).join(',')})에도 있고 독립 사건으로도 있다. 같은 일이 여러 노드다`));
    const nameOnly = {};
    N.filter(n => n.t === 'event').forEach(n => { (nameOnly[n.lab] = nameOnly[n.lab] || []).push(n.id) });
    const nDup = Object.entries(nameOnly).filter(([, v]) => v.length > 1);
    const nExtra = nDup.reduce((a, [, v]) => a + v.length - 1, 0);
    console.log(`51. 같은 이름 노드    ${HARD.map(t => t + ' ' + N.filter(n => n.t === t).length).join(' · ')} — 중복 ${bad}건` +
      ` · 사건은 이름만 같은 것 ${nDup.length}가지(${nExtra}개)로 사건번호는 다르다`);
    if (nExtra > 0)
      W(`51. 사건 ${nExtra}개가 이름만 같다 (사건번호는 다르다). 목록에서 같은 줄로 보인다 — 「${nDup[0][0].slice(0, 24)}」 ×${nDup[0][1].length}`);
  }

  /* ── 52. 첫 화면 배율은 한 곳이 정하고 아무도 안 바꾼다 ──
     같은 버그(첫 화면이 확대된 채로 뜬다)가 **일곱 번** 났다. 원인이 매번 달랐다:
     자동 포커스 · W/H 어긋남 · 가라앉기 전 fit() · camUser 가 1px 에 켜짐 ·
     clampY 가 매 프레임 덮어씀(두 번) · 하한(LABEL_FAR) 강제.

     **cam.ts 를 건드리는 곳이 다섯 군데라서 하나를 고치면 다른 데서 덮어썼다.**
     지금은 firstFit() 이 값을 정하고 __firstFit 에 남긴다.
     이 검사는 세 가지를 본다:
       ① 실제 카메라가 그 값과 같나 (다른 데서 덮어쓰지 않았나)
       ② 그 값으로 **결과 노드가 다 보이나** — 결과는 이 지도의 입구다
       ③ 노드 수가 바뀌어도 같은 규칙으로 정해지나 (분야를 좁혀 노드를 줄여 본다) */
  {
    const SZ = [[1440,900,'PC'],[412,915,'폰'],[840,1000,'폴드'],[820,1180,'태블릿']];
    for (const [w,h,nm] of SZ) {
      const dm = boot(w,h);
      await new Promise(r => setTimeout(r, 1500));
      const r = dm.window.eval(`(function(){
        if(typeof firstFit!=='function')return {no:'firstFit() 이 없다 — 첫 화면을 정하는 곳이 하나가 아니다'};
        var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
        if(typeof fit==='function')fit();
        cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        var f=__firstFit;
        if(!f)return {no:'__firstFit 이 비었다 — fit() 이 firstFit() 을 안 쓴다'};
        /* ① 실제 카메라 = 정해진 값 */
        var same=Math.abs(cam.s-f.s)<0.001;
        /* ② 결과 노드가 다 보이나 — 상단 UI 아래 자리 기준 */
        var res=A.filter(function(n){return n.t==='result'});
        var out=res.filter(function(n){
          var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
          return sx<0||sx>W||sy<f.top||sy>H}).map(function(n){return n.lab});
        /* ③ 노드를 줄여도 같은 규칙인가 — 분야 하나로 좁혀 본다 */
        var before=f.s, beforeN=A.length;
        var oldCat=cat; cat='med'; if(typeof refilter==='function')refilter();
        var t2=0; while(alpha>LAY_STOP&&t2<400){tick();t2++}
        fit(); var f2=__firstFit;
        var narrowOK=!!(f2&&f2.s>0);
        var narrowRes=A.filter(function(n){return n.t==='result'});
        var narrowOut=narrowRes.filter(function(n){
          var sx=n.x*f2.s+(viewCX()-f2.cx*f2.s), sy=n.y*f2.s+(f2.top+f2.vh/2-f2.cy*f2.s);
          return sx<0||sx>W||sy<f2.top||sy>H}).length;
        cat=oldCat; if(typeof refilter==='function')refilter();
        return {s:+cam.s.toFixed(3), fs:+f.s.toFixed(3), same:same,
                res:res.length, out:out.length, outLabs:out.slice(0,3).join(' · '),
                top:Math.round(f.top), mapN:beforeN,
                narrowS:f2?+f2.s.toFixed(3):null, narrowRes:narrowRes.length, narrowOut:narrowOut, narrowOK:narrowOK};
      })()`);
      dm.window.close();
      if (!r || r.no) { F(`52. ${nm} — ${(r && r.no) || '못 쟀다'}`); continue }
      console.log(`52. 첫 화면 배율     ${nm} ${w}×${h} · 배율 ${r.s} (firstFit ${r.fs}) · 상단 ${r.top}px · ` +
        `결과 ${r.res - r.out}/${r.res} 보임 · 지도 ${r.mapN}개 · 분야 좁힌 뒤 배율 ${r.narrowS} (결과 ${r.narrowRes}개 중 ${r.narrowOut} 밖)`);
      if (!r.same)
        F(`52. ${nm} — 첫 배율이 firstFit 이 정한 ${r.fs} 가 아니라 ${r.s} 다. 다른 곳에서 카메라를 덮어쓴다`);
      if (r.out)
        F(`52. ${nm} — 첫 화면에서 결과 노드 ${r.out}/${r.res}개가 화면 밖이다 (${r.outLabs}). 결과는 이 지도의 입구다`);
      if (!r.narrowOK)
        F(`52. ${nm} — 분야를 좁혀 노드가 줄면 첫 배율을 못 정한다. 노드 수가 바뀌어도 같은 규칙이어야 한다`);
      if (r.narrowOut)
        W(`52. ${nm} — 분야를 좁힌 뒤 결과 ${r.narrowOut}개가 화면 밖이다`);
    }
  }

  /* ── 53. 누르면 **아무것도 안 움직인다** ──
     "클릭하면 이어진 것들이 한두 개씩 움직이고 그다음 화면이 확대된다" 는 것이
     산만하다는 지적을 받았다. 누르는 것은 **무엇이 이어졌는지 보는 일**이지
     지도를 바꾸는 일이 아니다.

     전에 있던 두 가지를 뺐다:
       · setFocus 의 부채꼴 모으기(angT) — 이웃을 안 가려진 쪽으로 옮겼다
       · setFocus 끝의 refitWhenSettled(true) — 카메라를 다시 맞췄다 (= 화면 확대)

     이 검사는 **노드 좌표와 카메라를 동시에** 본다. 하나만 재면 다른 쪽으로 샌다 —
     실제로 첫 화면 버그가 일곱 번 났고 매번 다른 곳이 카메라를 건드렸다.
     움직여도 되는 것은 **끌 때**뿐이고, 그건 아래에서 따로 확인한다. */
  {
    for (const [w, h, nm] of [[1440,900,'PC'],[412,915,'폰']]) {
      const dm = boot(w, h);
      await new Promise(r => setTimeout(r, 1400));
      const r = dm.window.eval(`(function(){
        /* ── **되돌린 상태(ORBIT=false)를 잰다** ──
           둘레로 모으기가 들어오면서 '누르면 아무것도 안 움직인다' 는 약속이
           **그 방식일 때만** 유지된다. 이 검사는 그 방식이 아직 살아 있는지 지킨다 —
           스위치를 끄면 예전 화면으로 정확히 돌아가야 한다.
           모으기가 켜진 상태는 검사 62 가 따로 잰다. */
        if(typeof ORBIT!=='undefined'){ ORBIT=false; if(typeof orbClear==='function')orbClear() }
        var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
        if(typeof fade==='function')fade();
        cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        var c=A.filter(function(n){return n.t==='result'&&adj[n.id]&&adj[n.id].length>2});
        if(!c.length)return {no:'누를 결과 노드가 없다'};
        var t0=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
        /* **지도에 이미 올라와 있던 노드**만 기준으로 삼는다.
           누르면 이웃이 새로 올라오는데, 그건 **나타나는 것**이지 움직이는 것이 아니다.
           (자리는 데이터가 정하므로 올라오는 순간 제자리에 놓인다 — refilter 의 __onmap)
           그걸 같이 세면 332px 이 나오고, 그 숫자로는 진짜 움직임을 못 가린다.
           새로 올라온 개수는 아래에서 따로 출력한다 — 말없이 빼지 않는다. */
        var onMapBefore={}; A.forEach(function(n){onMapBefore[n.id]=1});
        var before={}; A.forEach(function(n){before[n.id]=[n.x,n.y]});
        var cam0={s:cam.s,x:cam.x,y:cam.y,ts:cam.ts,tx:cam.tx,ty:cam.ty};
        setFocus(t0.id);
        /* 누른 **직후**만 보면 안 된다 — 전에는 tick 이 도는 동안 이징이 옮겼다.
           사람이 보는 시간(약 2초)만큼 돌려 놓고 잰다. */
        for(var f=0;f<120;f++){ tick(); if(typeof fade==='function')fade();
          cam.s+=(cam.ts-cam.s)*0.11; cam.x+=(cam.tx-cam.x)*0.11; cam.y+=(cam.ty-cam.y)*0.11 }
        var movedN=[], mx=0, appeared=0;
        A.forEach(function(n){ if(!onMapBefore[n.id])appeared++ });
        N.forEach(function(n){ var b=before[n.id]; if(!b)return;
          var d=Math.hypot(n.x-b[0],n.y-b[1]);
          if(d>1){ if(d>mx)mx=d; if(movedN.length<4)movedN.push(n.lab+':'+Math.round(d)+'px') } });
        var camMove={ s:Math.abs(cam.s-cam0.s), x:Math.abs(cam.x-cam0.x), y:Math.abs(cam.y-cam0.y),
                      ts:Math.abs(cam.ts-cam0.ts), tx:Math.abs(cam.tx-cam0.tx), ty:Math.abs(cam.ty-cam0.ty) };
        /* 끌면 따라오나 — 여기서는 **따라와야 한다** (안 따라오면 그것도 FAIL) */
        var pullOK=null, pullN=0;
        if(typeof beginPull==='function'&&typeof pullNeighbors==='function'){
          var nb=(adj[t0.id]||[]).map(function(l){return map[l[0]===t0.id?l[1]:l[0]]}).filter(Boolean);
          var p0={}; nb.forEach(function(o){p0[o.id]=[o.x,o.y]});
          drag=t0; beginPull(t0);
          t0.x+=300; t0.y+=200;
          for(var q=0;q<40;q++)pullNeighbors();
          nb.forEach(function(o){ var b=p0[o.id]; if(b&&Math.hypot(o.x-b[0],o.y-b[1])>10)pullN++ });
          if(typeof endPull==='function')endPull();
          drag=null;
          pullOK=pullN>0;
        }
        return {moved:movedN.length, max:Math.round(mx), who:movedN.join(' '), appeared:appeared,
                cam:camMove, pullOK:pullOK, pullN:pullN, nb:(adj[t0.id]||[]).length, lab:t0.lab};
      })()`);
      dm.window.close();
      if (!r || r.no) { F(`53. ${nm} — ${(r && r.no) || '못 쟀다'}`); continue }
      const camMoved = ['s','x','y','ts','tx','ty'].filter(k => r.cam[k] > 0.001);
      console.log(`53. 눌러도 안 움직임  ${nm} ${w}×${h} · 「${r.lab}」(이웃 ${r.nb}) 누름 → ` +
        `움직인 노드 ${r.moved}개(최대 ${r.max}px) · 카메라 ${camMoved.length ? '움직임 ' + camMoved.join(',') : '그대로'} · ` +
        `새로 올라온 노드 ${r.appeared}개 · 끌면 따라오는 이웃 ${r.pullN}개`);
      if (r.moved)
        F(`53. ${nm} — 누르자 노드 ${r.moved}개가 움직였다 (최대 ${r.max}px: ${r.who}). 누르면 한 픽셀도 안 움직여야 한다`);
      if (camMoved.length)
        F(`53. ${nm} — 누르자 카메라가 움직였다 (${camMoved.map(k => k + ' ' + r.cam[k].toFixed(3)).join(' · ')}). 배율도 위치도 그대로여야 한다`);
      if (r.pullOK === false)
        F(`53. ${nm} — 끌었는데 이어진 것이 안 따라온다. 누를 때는 가만히, 끌 때는 따라와야 한다`);
      if (r.pullOK === null)
        F('53. beginPull/pullNeighbors 가 없다 — 끌어도 이어진 것이 안 따라온다');
    }
  }

  /* ── 54. 뒤로 — 한 칸씩 되돌아간다 ──
     결과 → 법 → 판례 로 파고들면 되돌아올 길이 있어야 한다.
     '처음으로' 는 전부 초기화라서 파고든 길을 한 칸씩 되짚을 수 없다.

     두 가지를 본다. 둘 다 **사람이 실제로 하는 짓**이다:
       ① 세 번 누르고 세 번 뒤로 → 처음 상태로 돌아오나
       ② 뒤로 갈 게 없을 때 **자리는 지키되 못 누르나**

     ②의 약속이 바뀌었다. 전에는 '숨는다' 였다 — 그런데 숨으면 처음 들어온 사람이
     그런 버튼이 있는 줄 모르고, 나타났다 사라지며 화면이 흔들린다.
     지금은 **늘 보이고 흐려지고 disabled 로 막힌다.**
     약속이 바뀌었으니 재는 것도 바꾼다. 다만 '눌러도 아무 일 없으면 안 된다' 는
     그대로라서, 흐린 상태에서 실제로 눌러 보고 아무 일도 안 일어나는지 확인한다. */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
      var b=document.getElementById('backBtn');
      if(!b)return {no:'뒤로 버튼(#backBtn)이 없다'};
      if(typeof navHist==='undefined')return {no:'이력(navHist)이 없다'};
      var vis=function(el){ var cs=window.getComputedStyle(el);
        return {disabled:!!el.disabled, hidden:!!el.hidden,
                display:cs.display, opacity:cs.opacity, vis:cs.visibility} };
      var st=[Object.assign({hist:navHist.length,focus:focus},vis(b))];
      /* 파고드는 길을 흉내 낸다 — 결과 → 그 이웃 → 또 그 이웃 */
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]&&adj[n.id].length>1});
      if(c.length<1)return {no:'누를 결과 노드가 없다'};
      var chain=[c[0].id], seen={}; seen[c[0].id]=1;
      for(var k=0;k<2;k++){
        var cur=chain[chain.length-1], nx=null;
        (adj[cur]||[]).forEach(function(l){ var o=l[0]===cur?l[1]:l[0];
          if(!nx&&!seen[o]&&map[o]){nx=o} });
        if(!nx)break; seen[nx]=1; chain.push(nx);
      }
      if(chain.length<3)return {no:'세 칸 파고들 길이 없다 (이웃이 모자란다)'};
      var clicked=[];
      chain.forEach(function(id){ setFocus(id); clicked.push({focus:focus,hist:navHist.length,disabled:!!b.disabled}) });
      /* 버튼을 **실제로 누른다.** goBack() 을 직접 부르면 버튼이 안 걸려 있어도 통과한다. */
      var backs=[];
      for(var i=0;i<3;i++){ b.click(); backs.push({focus:focus,hist:navHist.length,disabled:!!b.disabled}) }
      /* ── 흐릴 때 실제로 눌러 본다 ──
         goBack() 을 직접 부르면 막혔는지 알 수 없고, onclick() 을 직접 부르면
         disabled 를 건너뛴다. **버튼을 누른다** — 그래야 사람이 하는 짓과 같다. */
      var beforeIdle={focus:focus,hist:navHist.length};
      b.click();
      var afterIdle={focus:focus,hist:navHist.length};
      return {st0:st[0], clicked:clicked, backs:backs, endFocus:focus, endHist:navHist.length,
              end:vis(b), idleSame:(beforeIdle.focus===afterIdle.focus&&beforeIdle.hist===afterIdle.hist),
              chain:chain.length};
    })()`);
    dm.window.close();
    if (!r || r.no) F(`54. ${(r && r.no) || '못 쟀다'}`);
    else {
      console.log(`54. 뒤로  처음 [막힘 ${r.st0.disabled} · 보임 ${r.st0.display !== 'none' && !r.st0.hidden} ` +
        `· 흐리기 ${r.st0.opacity} · 이력 ${r.st0.hist}] → ` +
        `세 번 누름 [이력 ${r.clicked.map(c => c.hist).join('→')}] → ` +
        `세 번 뒤로 [이력 ${r.backs.map(c => c.hist).join('→')}] · 끝 초점 ${r.endFocus === null ? '없음' : r.endFocus}`);
      /* ── 홈 화면부터 자리를 지킨다 ── */
      const gone = v => v.hidden || v.display === 'none' || v.vis === 'hidden';
      if (gone(r.st0))
        F(`54. 홈 화면에서 뒤로 버튼이 자리를 안 잡고 있다 (hidden=${r.st0.hidden} · display=${r.st0.display} · visibility=${r.st0.vis}). ` +
          `있는 줄 모르고, 나타날 때 화면이 흔들린다`);
      if (gone(r.end))
        F(`54. 이력이 빈 뒤 버튼이 사라졌다 (display=${r.end.display} · visibility=${r.end.vis}). 자리는 지켜야 한다`);
      /* ── 그런데 못 눌러야 한다 ── */
      if (!r.st0.disabled)
        F('54. 홈 화면에서 뒤로 갈 게 없는데 버튼이 안 막혀 있다. 눌러도 아무 일 없는 버튼을 두지 않는다');
      if (!r.end.disabled)
        F('54. 이력이 빈 뒤에도 버튼이 안 막혀 있다');
      if (!r.idleSame)
        F('54. 막힌 버튼을 눌렀는데 상태가 바뀌었다. disabled 가 클릭을 못 막고 있다');
      if (r.st0.focus !== null) W('54. 처음부터 초점이 켜져 있다 — 검사 기준이 흔들린다');
      if (r.clicked[r.clicked.length - 1].hist !== 3)
        F(`54. 세 번 눌렀는데 이력이 ${r.clicked[r.clicked.length - 1].hist}칸이다. 한 번 누를 때마다 한 칸이어야 한다`);
      if (r.clicked.some(c => c.disabled))
        F('54. 눌러서 파고들었는데 뒤로 버튼이 막혀 있다');
      if (r.endFocus !== null)
        F(`54. 세 번 누르고 세 번 뒤로 했는데 처음 상태가 아니다 (초점 ${r.endFocus} 가 남았다)`);
      if (r.endHist !== 0)
        F(`54. 세 번 뒤로 했는데 이력이 ${r.endHist}칸 남았다`);
    }
  }

  /* ── 55. 끌기 — 벽이 없고, 따라오는 것이 안 튄다 ──
     두 가지가 **같은 검사**여야 한다. 하나만 재면 다른 쪽으로 샌다 —
     실제로 벽을 넓히자 이웃이 42px 씩 튀는 것이 드러났고, 튐을 고치자
     벽이 다시 보였다. 끄는 동안의 일이라 한 번의 끌기로 둘 다 잰다.

     ① **벽** — 손가락이 간 만큼 노드가 가야 한다.
        고치기 전 실측: 손가락 2,687px · 노드 1,374px. 멈춘 자리가 (-1179,-1021) 로
        `BX=ROUT+340` 과 정확히 같았다. 사람이 원해서 끄는 것을 막을 이유가 없다.
     ② **튐** — 이웃은 **끈 노드보다 빨리 갈 수 없다.** 고무줄은 늦게 따라오지
        앞지르지 않는다. 절대 px 로 재면 손가락 속도가 바뀔 때마다 기준이 흔들린다 —
        끈 노드의 걸음을 기준으로 삼으면 속도와 무관하게 옳다.

     rAF 가 아니라 tick() 을 직접 프레임처럼 돌린다. jsdom 에 rAF 가 없고,
     **끊김이 나는 곳은 rAF 가 아니라 tick 안**이기 때문이다. */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]&&adj[n.id].length>3});
      if(!c.length)return {no:'이웃이 넷 넘는 결과 노드가 없다'};
      var n=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
      var nbs=(adj[n.id]||[]).map(function(l){return map[l[0]===n.id?l[1]:l[0]]}).filter(Boolean);
      var sx=n.x*cam.s+cam.x, sy=n.y*cam.s+cam.y;
      var start={x:n.x,y:n.y};
      var d0=nbs.map(function(o){return Math.hypot(o.x-n.x,o.y-n.y)});
      down(sx,sy);
      var dmax=0,nmax=0,zero=0,cnt=0,ahead=0;
      var prev={x:n.x,y:n.y}, pnb=nbs.map(function(o){return {x:o.x,y:o.y}});
      var px=sx,py=sy,last=null;
      var steps=[];
      for(var f=0;f<160;f++){
        px-=7; py-=3.5;
        move(px,py); tick();
        last=[(px-cam.x)/cam.s,(py-cam.y)/cam.s];
        var d=Math.hypot(n.x-prev.x,n.y-prev.y); if(d>dmax)dmax=d; prev={x:n.x,y:n.y};
        steps.push(d);
        for(var i=0;i<nbs.length;i++){
          var q=Math.hypot(nbs[i].x-pnb[i].x,nbs[i].y-pnb[i].y);
          cnt++; if(q<0.05)zero++; if(q>nmax)nmax=q;
          pnb[i]={x:nbs[i].x,y:nbs[i].y};
        }
      }
      for(var i=0;i<nbs.length;i++){} /* (거리 유지는 아래에서 본다) */
      var d1=nbs.map(function(o){return Math.hypot(o.x-n.x,o.y-n.y)});
      var want=Math.hypot(last[0]-start.x,last[1]-start.y);
      var got=Math.hypot(n.x-start.x,n.y-start.y);
      var gap=Math.hypot(n.x-last[0],n.y-last[1]);
      /* 끈 노드의 걸음보다 큰 이웃 걸음이 몇 번인가 */
      var lim=dmax*1.2;
      pnb=nbs.map(function(o){return {x:o.x,y:o.y}});
      up();
      /* 놓은 뒤 화면 안으로 들어왔나 — 벽 대신 이것으로 되찾는다 */
      var vx=n.x*cam.ts+cam.tx, vy=n.y*cam.ts+cam.ty;
      var tp=(typeof topSafePx==='function')?topSafePx():0;
      return {want:Math.round(want), got:Math.round(got), gap:Math.round(gap),
        dmax:+dmax.toFixed(1), nmax:+nmax.toFixed(1), lim:+lim.toFixed(1),
        zero:zero, cnt:cnt, nb:nbs.length, lab:n.lab,
        keep:d1.map(function(v,i){return Math.round(v-d0[i])}),
        wall:Math.round(ROUT+340),
        vis:(vx>=-1&&vx<=W+1&&vy>=tp-1&&vy<=H+1), vxy:[Math.round(vx),Math.round(vy)], WH:[W,H]};
    })()`);
    dm.window.close();
    if (!r || r.no) F(`55. ${(r && r.no) || '못 쟀다'}`);
    else {
      console.log(`55. 끌기  「${r.lab}」(이웃 ${r.nb}) 를 160프레임 끌었다 → ` +
        `손가락 ${r.want}px · 노드 ${r.got}px (어긋남 ${r.gap}px, 벽은 ${r.wall}px) · ` +
        `프레임당 끈노드 최대 ${r.dmax}px · 이웃 최대 ${r.nmax}px · ` +
        `안 움직인 프레임 ${r.zero}/${r.cnt} · 놓은 뒤 화면 안 ${r.vis ? '예' : '아니오'}`);
      /* ① 벽 — 손가락과 5% 넘게 벌어지면 무언가가 막고 있는 것이다 */
      if (r.want > 200 && r.gap > r.want * 0.05)
        F(`55. 끌기에 한계가 걸렸다 — 손가락은 ${r.want}px 갔는데 노드는 ${r.got}px 에서 멈췄다 ` +
          `(어긋남 ${r.gap}px). 사람이 원해서 끄는 것을 막지 않는다`);
      /* ② 튐 — 이웃이 끈 노드보다 빠르면 그건 따라오는 게 아니라 튀는 것이다 */
      if (r.nmax > r.lim)
        F(`55. 따라오는 것이 튄다 — 이웃이 한 프레임에 ${r.nmax}px 갔다. ` +
          `끈 노드는 ${r.dmax}px 이었다(한도 ${r.lim}px). 고무줄은 늦게 따라오지 앞지르지 않는다`);
      /* ③ 끊김 — 끄는 내내 매 프레임 따라와야 한다 */
      if (r.zero > r.cnt * 0.02)
        F(`55. 따라오는 것이 끊긴다 — ${r.cnt}프레임 중 ${r.zero}번 한 픽셀도 안 움직였다`);
      if (!r.vis)
        F(`55. 놓았는데 화면 밖이다 (화면 ${r.vxy} · 창 ${r.WH}). 되찾을 방법이 없다`);
    }
  }

  /* ── 56. 빈 곳을 잡고 화면을 끈다 — 네 방향 다 ──
     노드를 끄는 것(검사 55)과 **다른 일이다.** 이건 카메라가 움직인다.

     고치기 전 실측(1440×900, 손가락 320px):
       아래로 16px(5%) · 위로 83px(26%) · 좌·우 320px(100%)
     **세로만 막혀 있었다.** `clampY()` 가 fade() 안에서 매 프레임 돌며
     첫 화면 규칙(상단 UI 아래에 무리를 앉힌다)으로 되돌리고 있었다.
     자동 배치에는 맞는 규칙인데 사람 손까지 되돌린 것이다 —
     검사 55 의 벽과 같은 종류다.

     한 방향이라도 손가락의 80% 를 못 따라가면 FAIL.
     그리고 아주 멀리 끌어도 **지도가 화면에서 완전히 사라지면 안 된다** —
     사라지면 되찾을 방법이 없다. 그것도 같이 잰다. */
  {
    for (const [w, h, nm] of [[1440,900,'PC'],[412,915,'폰']]) {
      const dm = boot(w, h);
      await new Promise(r => setTimeout(r, 1400));
      const r = dm.window.eval(`(function(){
        var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
        if(typeof fade!=='function')return {no:'fade 가 없다'};
        cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
        /* 노드가 없는 자리를 찾는다 — 노드를 잡으면 카메라가 아니라 노드가 움직인다 */
        var ex=null;
        for(var y=H-60;y>60&&!ex;y-=20)for(var x=40;x<W-40;x+=20){ if(!at(x,y)){ex=[x,y];break} }
        if(!ex)return {no:'빈 자리를 못 찾았다'};
        var out={ex:ex};
        function pull(dx,dy,name,n){
          var t0={tx:cam.tx,ty:cam.ty};
          down(ex[0],ex[1]);
          var px=ex[0],py=ex[1];
          for(var i=0;i<n;i++){ px+=dx;py+=dy; move(px,py); tick(); fade() }
          up();
          for(var i=0;i<30;i++){ tick(); fade();
            cam.x+=(cam.tx-cam.x)*0.11; cam.y+=(cam.ty-cam.y)*0.11 }
          var want=(dx?dx:dy)*n, got=dx?(cam.tx-t0.tx):(cam.ty-t0.ty);
          out[name]={want:Math.round(want), got:Math.round(got),
                     pct:Math.round(100*Math.abs(got)/Math.abs(want))};
        }
        /* ── **반대쪽으로 먼저 밀어 놓고 잰다** ──
           폰에서 오른쪽이 89% 로 나왔다. 막힌 게 아니라 **느슨한 가둠에 닿은 것**이다 —
           화면이 좁아 한 번(320px) 끄는 것으로 지도 반대쪽 끝이 와 버린다.
           한도를 80% 로 풀면 검사가 약해지고, 그대로 두면 없는 문제를 FAIL 로 띄운다.
           **재는 자리를 옮긴다** — 반대로 한 번 밀어 여유를 만든 뒤 그 자리에서 잰다.
           그러면 가둠과 무관하게 '막는 코드가 있나' 만 재게 된다. */
        function probe(dx,dy,name,n){ pull(-dx,-dy,'_pre_'+name,n); pull(dx,dy,name,n) }
        probe(0,8,'down',40); probe(0,-8,'up',40); probe(8,0,'right',40); probe(-8,0,'left',40);
        /* 아주 멀리 — 지도를 잃어버리나 */
        pull(0,26,'far',300);
        var pool=A.length?A:N, mnx=1e9,mxx=-1e9,mny=1e9,mxy=-1e9;
        pool.forEach(function(n){mnx=Math.min(mnx,n.x-n.r);mxx=Math.max(mxx,n.x+n.r);
          mny=Math.min(mny,n.y-n.r);mxy=Math.max(mxy,n.y+n.r)});
        var box=[mnx*cam.s+cam.x, mny*cam.s+cam.y, mxx*cam.s+cam.x, mxy*cam.s+cam.y];
        var ov=Math.max(0,Math.min(box[2],W)-Math.max(box[0],0))*
               Math.max(0,Math.min(box[3],H)-Math.max(box[1],0));
        return {out:out, box:box.map(Math.round), overlap:Math.round(ov), WH:[W,H]};
      })()`);
      dm.window.close();
      if (!r || r.no) { F(`56. ${nm} — ${(r && r.no) || '못 쟀다'}`); continue }
      const o = r.out;
      const dirs = [['down','아래'],['up','위'],['right','오른쪽'],['left','왼쪽']];
      console.log(`56. 화면 끌기  ${nm} ${w}×${h} · 빈 곳 ${JSON.stringify(o.ex)} → ` +
        dirs.map(([k, ko]) => `${ko} ${o[k].got}/${o[k].want}px(${o[k].pct}%)`).join(' · ') +
        ` · 아주 멀리 끈 뒤 지도가 화면과 겹치는 넓이 ${r.overlap}px²`);
      for (const [k, ko] of dirs)
        if (o[k].pct < 90)
          F(`56. ${nm} — ${ko}로 끌면 막힌다 (손가락 ${o[k].want}px · 카메라 ${o[k].got}px = ${o[k].pct}%). ` +
            `빈 곳을 잡고 끄는 것은 네 방향 다 자유로워야 한다`);
      if (!r.overlap)
        F(`56. ${nm} — 아주 멀리 끌었더니 지도가 화면에서 완전히 사라졌다 ` +
          `(지도 상자 ${JSON.stringify(r.box)} · 창 ${JSON.stringify(r.WH)}). 되찾을 방법이 없다`);
    }
  }

  /* ── 57. 검색이 판례·헌재를 찾나 ──
     「살인」을 쳐도 아무것도 안 나왔다. 원인은 한 줄이었다 —
     `qSearch` 안의 `if(n.t==='event')return false`.
     판례 1,775 · 헌재 2,076 이 전부 t:'event' 라 3,851개가 통째로 빠졌다.

     실측(고치기 전): 이름에 그 말이 있는 노드 / 검색 결과
       살인 3/0 · 뇌물 15/0 · 절도 2/0 · 사기 46/2

     **지도에 안 그리는 것과 검색에서 빼는 것은 다른 일이다.**
     '지우는 게 아니라 옮기는 것' 이라고 적어 놓고 검색에서도 지우고 있었다.

     그래서 이 검사는 **이름에 그 말이 있는 노드 수를 분모로 놓고** 잰다.
     검색 결과 수만 보면 0 이 '없어서' 인지 '안 보고 있어서' 인지 구별이 안 된다. */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      if(typeof qSearch!=='function')return {no:'qSearch 가 없다'};
      var words=['살인','뇌물','사기','절도','최저임금','간첩'];
      var out=[], kinds={};
      N.forEach(function(n){
        var k=(typeof qKind==='function')?qKind(n):n.t;
        kinds[k]=(kinds[k]||0)+1});
      for(var i=0;i<words.length;i++){
        var w=words[i], lw=w.toLowerCase();
        var inLab=N.filter(function(n){return (n.lab||'').toLowerCase().indexOf(lw)>=0}).length;
        qSearch(w);
        out.push({w:w, inLab:inLab, hit:qHits.length, more:(typeof qMore==='number')?qMore:0,
          kinds:qHits.map(function(n){return (typeof qKind==='function')?qKind(n):n.t})});
      }
      qSearch('');
      /* 판례·헌재가 검색에 **하나라도** 걸리나 — 종류별로 따로 본다 */
      var prec=N.filter(function(n){return n.id.lastIndexOf('case_prec_',0)===0}).length;
      var detc=N.filter(function(n){return n.id.lastIndexOf('case_detc_',0)===0}).length;
      var precHit=0, detcHit=0;
      out.forEach(function(o){ o.kinds.forEach(function(k){
        if(k==='판례')precHit++; if(k==='헌재 결정')detcHit++ })});
      /* 속도 */
      var t0=Date.now(); for(var j=0;j<50;j++){qSearch('살인');qSearch('')}
      var ms=(Date.now()-t0)/100;
      return {out:out, prec:prec, detc:detc, precHit:precHit, detcHit:detcHit,
              nodes:N.length, ms:+ms.toFixed(2)};
    })()`);
    dm.window.close();
    if (!r || r.no) F(`57. ${(r && r.no) || '못 쟀다'}`);
    else {
      console.log(`57. 검색  노드 ${r.nodes}개(판례 ${r.prec} · 헌재 ${r.detc}) · 한 번 ${r.ms}ms · ` +
        r.out.map(o => `${o.w} ${o.hit}${o.more ? '+' + o.more : ''}/${o.inLab}`).join(' · '));
      for (const o of r.out)
        if (o.inLab > 0 && o.hit === 0)
          F(`57. 「${o.w}」 — 이름에 그 말이 든 노드가 ${o.inLab}개인데 검색 결과가 0이다. ` +
            `검색이 무언가를 통째로 빼고 있다`);
      if (r.prec > 0 && r.precHit === 0)
        F(`57. 판례 ${r.prec}개가 검색에 하나도 안 걸린다. 지도에 안 그리는 것과 검색에서 빼는 것은 다른 일이다`);
      if (r.detc > 0 && r.detcHit === 0)
        F(`57. 헌재 결정 ${r.detc}개가 검색에 하나도 안 걸린다`);
      if (r.ms > 30) F(`57. 검색 한 번에 ${r.ms}ms 걸린다 — 글자를 칠 때마다 도는 일이라 30ms 를 넘으면 안 된다`);
    }
  }

  /* ── 58. 결과 카드에 '이게 무슨 숫자인가' 가 있나 ──
     결과는 지도의 **입구**다. 눌렀는데 숫자만 있으면 들어올 이유가 없다.
     법에 '무슨 법인지'(tip)를 넣은 것과 같은 자리다.

     세 가지를 본다:
       ① 결과 노드 전부에 w(한 줄 뜻)가 있나 — 분모와 함께 낸다
       ② 그 말이 **화면에 실제로 그려지나** — 데이터에만 있고 안 그리면 없는 것과 같다
       ③ 같은 말을 두 번 하지 않나 — w 와 tip 이 겹치면 카드가 같은 말을 반복한다 */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      if(typeof REZ==='undefined')return {no:'REZ(결과 쉬운 설명)가 없다'};
      var res=N.filter(function(n){return n.t==='result'});
      var miss=res.filter(function(n){return !(REZ[n.id]&&REZ[n.id].w)}).map(function(n){return n.id});
      var noMean=res.filter(function(n){return !(REZ[n.id]&&REZ[n.id].m)}).map(function(n){return n.id});
      /* 시계열이 있는데 c(예전엔 이랬는데)가 없으면 반쪽이다 */
      var noChg=res.filter(function(n){return n.series&&n.series.length>1&&!(REZ[n.id]&&REZ[n.id].c)})
        .map(function(n){return n.id});
      /* 화면에 실제로 그려지나 — 한 장 열어 본다 */
      var drawn=0, dup=0, sample=null;
      for(var i=0;i<res.length;i++){
        setFocus(res[i].id);
        var p=document.getElementById('pop');
        var el=p?p.querySelector('.rez-what'):null;
        var e=REZ[res[i].id]||{};
        if(el&&el.textContent.trim()===String(e.w||'').trim())drawn++;
        else if(!sample)sample={id:res[i].id,got:el?el.textContent.trim().slice(0,30):'(없음)'};
        /* 같은 말이 두 번 — 한 줄 설명(oneline)이 w 와 함께 그려지면 안 된다 */
        if(el&&p.querySelector('.oneline'))dup++;
      }
      closePop();
      /* 한자어 그물 — 쉬운 말로 옮긴 자리에 이런 말이 남아 있으면 옮긴 것이 아니다 */
      var JARGON=['상대적 빈곤율','합계출산율','실업률','소진 시점','누적 상승률',
        '보험료율','고령화율','조혼인율','경제활동참가율','증가율','감소율'];
      var hard=[];
      res.forEach(function(n){ var e=REZ[n.id]; if(!e)return;
        var t=[e.w||'',e.m||'',e.c||''].join(' ');
        JARGON.forEach(function(w){ if(t.indexOf(w)>=0)hard.push(n.id+':'+w) }) });
      return {total:res.length, miss:miss, noMean:noMean, noChg:noChg,
              drawn:drawn, dup:dup, sample:sample, hard:hard};
    })()`);
    dm.window.close();
    if (!r || r.no) F(`58. ${(r && r.no) || '못 쟀다'}`);
    else {
      console.log(`58. 결과 카드 뜻   한 줄 뜻 ${r.total - r.miss.length}/${r.total} · ` +
        `무엇을 센 숫자인가 ${r.total - r.noMean.length}/${r.total} · ` +
        `시계열 있는데 변화 설명 없음 ${r.noChg.length}개 · 화면에 그려진 것 ${r.drawn}/${r.total}`);
      if (r.miss.length)
        F(`58. 쉬운 설명이 없는 결과 ${r.miss.length}/${r.total}개: ${r.miss.slice(0,6).join(', ')}. ` +
          `db/result_easy.json 에 넣고 node tools/result-easy.mjs 를 돌려라`);
      if (r.noMean.length)
        W(`58. '무엇을 센 숫자인가'(m)가 없는 결과 ${r.noMean.length}개: ${r.noMean.slice(0,5).join(', ')}`);
      if (r.noChg.length)
        W(`58. 시계열이 있는데 '예전엔 이랬는데'(c)가 없는 결과 ${r.noChg.length}개: ${r.noChg.slice(0,5).join(', ')}`);
      if (r.drawn < r.total)
        F(`58. 한 줄 뜻이 화면에 안 그려지는 결과 ${r.total - r.drawn}개 ` +
          `(예: ${r.sample ? r.sample.id + ' → ' + r.sample.got : '?'}). 데이터에만 있으면 없는 것과 같다`);
      if (r.dup)
        F(`58. 결과 카드 ${r.dup}개에서 한 줄 뜻과 한 줄 설명(tip)이 함께 그려진다. 같은 말이 두 번 나온다`);
      if (r.hard.length)
        W(`58. 쉬운 말 자리에 한자어가 남아 있다 ${r.hard.length}개: ${r.hard.slice(0,4).join(', ')}`);
    }
  }

  /* ── 59. 검색이 지도에 있는 것을 다 찾나 · 창고와의 격차를 밝히나 ──
     "「살인」을 치면 3개만 나온다. 판례가 2,116개인데 살인이 3건일 리가 없다."
     세 숫자를 나란히 놓으면 어디서 빠지는지 보인다:

       낱말    창고 사건명   지도 노드   검색
       살인        504         2        3
       사기      2,849        57       59
       절도      1,067         3        3

     **검색은 지도에 있는 것을 다 찾고 있었다.** 빠지는 곳은 창고 → 지도다.
     판례는 법을 통해서만 올라오는데(결과 → 법 → 판례) 살인 판례가 붙을 「형법」이
     지도에 없다. 형법을 억지로 올리면 어느 결과에도 안 이어져 고립되고,
     r11(검찰청 폐지)의 keys 에 '형법' 을 넣는 것은
     **글자가 같은 것과 주제가 같은 것을 섞는 일**이다. 그래서 안 올린다.

     그러면 이 검사가 지킬 수 있는 약속은 둘이다:
       ① **지도에 있는 것이 검색에서 빠지면 FAIL** — 이건 우리가 고칠 수 있다
       ② **격차를 화면에 밝히는가** — 말없이 두면 '우리 지도에 2건' 이
          '세상에 2건' 으로 읽힌다

     창고 건수는 여기서 실제로 세어 함께 출력한다. 못 고치더라도 크기는 알고 있어야 한다. */
  {
    let wc = null;
    try {
      const { DatabaseSync } = require('node:sqlite');
      const wdb = new DatabaseSync(path.join(ROOT, 'db', 'warehouse.db'), { readOnly: true });
      wc = {};
      for (const q of ['살인', '음주운전', '사기', '절도', '뇌물'])
        wc[q] = wdb.prepare('SELECT COUNT(*) c FROM court_case WHERE case_nm LIKE ?').get('%' + q + '%').c;
      wdb.close();
    } catch { wc = null }

    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      if(typeof qSearch!=='function')return {no:'qSearch 가 없다'};
      var words=['살인','음주운전','사기','절도','뇌물'];
      var out=[];
      for(var i=0;i<words.length;i++){
        var q=words[i], lq=q.toLowerCase();
        /* 지도에 있는 것 — 이름·판시사항 어디든 그 말이 있으면 찾혀야 한다 */
        var inMap=N.filter(function(n){
          return ((n.lab||'')+' '+(n.title||'')+' '+(n.gist||'')).toLowerCase().indexOf(lq)>=0}).length;
        qSearch(q);
        var found=qHits.length+(typeof qMore==='number'?qMore:0);
        /* 지도 밖이 더 있다는 것을 화면에 밝히나 */
        var outLink=!!document.querySelector('#sres .srout');
        out.push({q:q, inMap:inMap, found:found, outLink:outLink,
          grouped:N.filter(function(n){return n.grouped&&((n.title||'')+(n.lab||'')).indexOf(q)>=0})
            .reduce(function(a,n){return a+n.grouped},0)});
      }
      qSearch('');
      return {out:out, cases:N.filter(function(n){return n.id.lastIndexOf('case_',0)===0}).length};
    })()`);
    dm.window.close();
    if (!r || r.no) F(`59. ${(r && r.no) || '못 쟀다'}`);
    else {
      console.log(`59. 검색 vs 창고  사건 노드 ${r.cases}개 · ` +
        r.out.map(o => `${o.q} ${wc ? wc[o.q] + '창고/' : ''}${o.inMap}지도/${o.found}검색`).join(' · '));
      for (const o of r.out) {
        if (o.found < o.inMap)
          F(`59. 「${o.q}」 — 지도에 ${o.inMap}개가 있는데 검색은 ${o.found}개만 찾는다. ` +
            `검색이 지도에 있는 것을 못 찾고 있다`);
        if (o.inMap && !o.outLink)
          F(`59. 「${o.q}」 — 검색 결과에 지도 밖으로 가는 길이 없다. ` +
            `창고에는 ${wc ? wc[o.q] + '건' : '더 많이'} 있는데 말없이 두면 "이게 전부" 로 읽힌다`);
      }
      if (wc) {
        const gap = r.out.filter(o => wc[o.q] > o.inMap * 3);
        if (gap.length)
          W(`59. 창고와 지도의 격차가 큰 낱말 ${gap.length}개: ` +
            gap.map(o => `${o.q} ${wc[o.q]}→${o.inMap}`).join(', ') +
            `. 판례는 법을 통해서만 올라온다 — 그 법이 지도에 없으면 판례도 없다`);
      } else notes.push('59. 창고를 못 열어 창고 건수는 못 쟀다 (db/warehouse.db)');
    }
  }

  /* ── 60. 근거 링크가 없는 노드가 몇 개인가 · 그 링크가 진짜 열리나 ──
     규칙 7은 "모든 노드에 출처" 인데, **글자로 적은 출처는 출처가 아니다.**
     눌러서 확인할 수 있어야 한다. 「1인 가구 35.5%」를 눌러도 근거 자료 자리에
     "확인 중입니다" 가 떴다 — 노드에 `url` 이 있는데 카드가 그걸 안 읽고 있었다.

     ── 왜 종류별로 나누나 ──
     법·판례·헌재·결과는 우리가 링크를 만들 수 있다 (법제처·통계표).
     인물·정당·기관·사건은 공식 페이지를 하나씩 찾아야 한다 — 아직 못 했다.
     **못 한 것을 0 으로 덮지 않는다.** 개수를 늘 출력하고, 채운 종류는 FAIL 로 지킨다.

     ── 그리고 200 이 곧 살아있음은 아니다 ──
     법제처는 없는 법 이름에도 **200 과 함께 오류 페이지**를 준다.
     status 만 보면 죽은 링크를 통째로 놓친다. 그래서 표본을 열어 **제목까지** 본다. */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      var RZ=(typeof REZ!=='undefined')?REZ:{};
      function kindOf(n){
        return n.id.lastIndexOf('case_prec_',0)===0?'판례':n.id.lastIndexOf('case_detc_',0)===0?'헌재':
          n.t==='bill'?'법':n.t==='result'?'결과':
          n.t==='event'?(n.owner?'인물연표':'사건'):n.t}
      function has(n){
        if(n.url&&/^https?:\\/\\//.test(n.url))return true;
        if(n.official2&&n.official2.length)return true;
        if(n.t==='result'&&RZ[n.id]&&RZ[n.id].u)return true;
        /* **연표 항목은 그 사람의 기록이다.** 「음주운전 · 벌금 150만원」은 독립된 사건이
           아니라 인물에 딸린 줄이다. 따로 출처를 찾을 것이 아니라 그 사람의 근거를
           물려받는 것이 맞다 — 화면도 그렇게 그리고, 물려받은 것이라고 밝힌다. */
        if(n.owner&&map[n.owner]&&map[n.owner].url)return true;
        return false}
      var st={}, lawUrls=[];
      N.forEach(function(n){ if(n.ghost)return;
        var k=kindOf(n); st[k]=st[k]||{n:0,ok:0,none:[],silent:[]};
        st[k].n++;
        if(has(n))st[k].ok++;
        else{
          /* **왜 없는지 적혀 있나.** 빈 것 자체는 잘못이 아니다 —
             '아직 안 찾았다' 와 '찾아봤지만 없다' 를 구별할 수 없게 두는 것이 잘못이다. */
          var why=n.noUrl||(n.t==='result'&&RZ[n.id]&&RZ[n.id].n);
          if(st[k].none.length<8)st[k].none.push(n.lab||n.id);
          if(!why&&st[k].silent.length<8)st[k].silent.push(n.lab||n.id);
        }
        if(k==='법'&&n.url)lawUrls.push(n.url); });
      /* 카드에 실제로 그려지나 — 결과 하나를 열어 본다 */
      var res=N.filter(function(n){return n.t==='result'&&has(n)});
      var drawn=0;
      for(var i=0;i<res.length;i++){
        setFocus(res[i].id);
        var p=document.getElementById('pop');
        if(p&&p.querySelector('.srcsec .reflist.off a'))drawn++;
      }
      closePop();
      return {st:st, lawUrls:lawUrls, resWithSrc:res.length, drawn:drawn};
    })()`);
    dm.window.close();
    if (!r) F('60. 근거 링크를 못 쟀다');
    else {
      const rows = Object.entries(r.st).sort((a, b) => b[1].n - a[1].n);
      const silentAll = rows.reduce((a, [, v]) => a + (v.silent || []).length, 0);
      console.log('60. 근거 링크   ' + rows.map(([k, v]) => `${k} ${v.ok}/${v.n}`).join(' · ') +
        ` · 결과 카드에 실제로 그려진 것 ${r.drawn}/${r.resWithSrc}` +
        ` · 이유 없이 빈 것 ${silentAll}개`);
      /* ── **말없이 비운 것만 FAIL 이다** ──
         근거를 못 찾는 일은 실제로 있다 — 국군방첩사령부령은 법제처 검색 API 로도 0건이고,
         기자간담회 발언은 원문 페이지가 없다. 그때 가짜 링크를 넣는 것이 더 나쁘다.
         그래서 **비운 것**이 아니라 **이유 없이 비운 것**을 잡는다.
         (r3·q5 의 핵심어를 비우고 이유를 적은 것과 같은 처리다 — 창고 검사 F.) */
      /* **예외를 두지 않는다.** 인물·정당·기관·사건도 근거가 있어야 한다 (규칙 7).
         못 찾는 것은 있을 수 있다 — 그때는 **왜 못 찾았는지 적는다.**
         적혀 있으면 WARN, 말없이 비었으면 FAIL 이다. */
      const MUST = Object.keys(r.st);
      for (const [k, v] of rows) {
        const miss = v.n - v.ok;
        if (!miss) continue;
        const silent = (v.silent || []).length;
        if (MUST.includes(k) && silent)
          F(`60. ${k} ${silent}개가 근거 링크도 없고 **왜 없는지도 안 적혀 있다** ` +
            `(${v.silent.slice(0, 4).join(', ')}). 말없이 비우면 '아직 안 찾았다' 와 ` +
            `'찾아봤지만 없다' 가 구별되지 않는다`);
        else if (MUST.includes(k))
          W(`60. ${k} ${miss}개는 근거를 못 찾아 비웠다 (${v.none.slice(0, 4).join(', ')}). ` +
            `이유는 화면에 밝힌다`);
        else
          W(`60. ${k} ${miss}개에 근거 링크가 없다 (${v.none.slice(0, 4).join(', ')}). ` +
            `공식 페이지를 하나씩 찾아야 하는 종류라 아직 못 채웠다`);
      }
      if (r.drawn < r.resWithSrc)
        F(`60. 근거가 있는 결과 ${r.resWithSrc}개 중 ${r.resWithSrc - r.drawn}개가 카드에 안 그려진다. ` +
          `데이터에만 있으면 없는 것과 같다`);

      /* ── **전수 결과를 읽는다** ──
         근거 링크가 2,300개다. 매 검사마다 다 열면 40분이 걸려 아무도 안 돌리게 된다.
         그래서 `node tools/link-check.mjs` 가 전부 열어 db/link_check.json 에 남기고,
         여기서는 그 결과를 읽는다. **오래된 결과는 결과가 아니다** — 잰 날짜를 함께 본다.
         그리고 아래에서 표본을 직접 열어 그 파일이 거짓말하고 있지 않은지 확인한다. */
      try {
        const lc = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'link_check.json'), 'utf8'));
        const days = Math.round((Date.now() - Date.parse(lc.at)) / 86400000);
        console.log(`60. 전수 링크   ${lc.ok}/${lc.total}개 열림 · 잰 날 ${lc.at} (${days}일 전)` +
          (lc.sample ? ` · 표본 ${lc.sample}` : ''));
        if (lc.bad && lc.bad.length)
          for (const b of lc.bad.slice(0, 8))
            F(`60. 근거 링크가 안 열린다 (${b.status} ${b.title}) ${b.kind} ${b.id}: ` +
              `${decodeURIComponent(b.url).slice(0, 70)}`);
        if (lc.sample) W(`60. 전수가 아니라 표본 ${lc.sample}개만 열어 본 결과다 — node tools/link-check.mjs 로 전부 확인할 것`);
        if (days > 30) W(`60. 링크를 전부 열어 본 지 ${days}일 됐다 — 링크는 조용히 죽는다. 다시 돌릴 것`);
        /* **파일이 지금 지도와 같은 것을 잰 것인가.** 노드가 늘었는데 옛 결과를 그대로 믿으면
           새로 넣은 링크는 한 번도 안 열어 본 채 통과한다. */
        const now = Object.values(r.st).reduce((a, v) => a + v.ok, 0);
        if (!lc.sample && lc.total < now * 0.9)
          F(`60. 전수 결과가 ${lc.total}개인데 지금 근거가 있는 노드는 ${now}개다. ` +
            `그 뒤에 링크가 늘었다 — node tools/link-check.mjs 를 다시 돌려야 한다`);
      } catch { F('60. db/link_check.json 이 없다 — node tools/link-check.mjs 로 근거 링크를 전부 열어 봐야 한다') }

      /* 법제처 링크 표본 — **200 이 곧 살아있음은 아니다.** 제목까지 본다. */
      const sample = r.lawUrls.filter((u, i) => i % Math.max(1, Math.ceil(r.lawUrls.length / 10)) === 0).slice(0, 10);
      if (!sample.length) console.log('60. 법제처 링크 표본 없음');
      else if (!(await online(sample.map(u => ({ url: u }))))) {
        console.log('60.  ★ SKIP — 오프라인이라 법제처 링크를 못 열었다');
        notes.push('60. 법제처 링크 검증 SKIP (오프라인)');
      } else {
        let bad = [];
        for (const u of sample) {
          let txt = '';
          try {
            const res2 = await fetch(u, { headers: { 'User-Agent': 'why-map/1.0 (+https://why-map.com)' },
              signal: AbortSignal.timeout(20000), redirect: 'follow' });
            txt = await res2.text();
          } catch { bad.push([u, '못 열었다']); continue }
          const m = /<title[^>]*>([\s\S]*?)<\/title>/.exec(txt);
          const ti = m ? m[1].trim() : '';
          if (/오류|error|없습니다/i.test(ti)) bad.push([u, `오류 페이지 (${ti.slice(0, 24)})`]);
        }
        console.log(`60. 법제처 링크   표본 ${sample.length}개 열어 봄 · 오류 페이지 ${bad.length}개`);
        for (const [u, why] of bad)
          F(`60. 법제처 링크가 오류 페이지다 — ${why}: ${decodeURIComponent(u).slice(0, 70)}. ` +
            `200 을 돌려주므로 status 만 보면 못 잡는다`);
      }
    }
  }

  /* ── 61. 결과 노드가 조용히 사라지지 않았나 ──
     결과는 지도의 **입구**다. 하나가 없어지면 그 입구가 통째로 사라진다.
     실제로 사교육비가 조용히 사라진 적이 있다 — 그때는 아무 검사도 울지 않았다.

     **개수가 아니라 목록으로 잰다.** 하나가 빠지고 하나가 늘면 개수는 같은데
     사라진 것이다. 개수만 보면 그걸 못 잡는다.

     일부러 뺀 것은 `db/result_roster.json` 의 `removed` 에 이유를 적으면 통과다 —
     빈 것 자체는 잘못이 아니고, **말없이 비우는 것**이 잘못이다. */
  {
    let roster = null;
    try { roster = JSON.parse(fs.readFileSync(path.join(ROOT, 'db', 'result_roster.json'), 'utf8')) } catch {}
    if (!roster) F('61. db/result_roster.json 이 없다 — node tools/result-roster.mjs 로 결과 명부를 만들어야 한다');
    else {
      const html61 = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
      const now = [...new Set([...html61.matchAll(/\{id:'([^']+)',t:'result'/g)].map(m => m[1]))];
      const removed = roster.removed || {};
      const gone = (roster.ids || []).filter(id => !now.includes(id) && !removed[id]);
      const added = now.filter(id => !(roster.ids || []).includes(id));
      const silent = Object.keys(removed).filter(id => !removed[id]);
      console.log(`61. 결과 명부   지금 ${now.length}개 · 명부 ${(roster.ids || []).length}개 (적은 날 ${roster.at})` +
        (added.length ? ` · 새로 들어온 것 ${added.length}개` : '') +
        (gone.length ? ` · **사라진 것 ${gone.length}개**` : '') +
        (Object.keys(removed).length ? ` · 일부러 뺀 것 ${Object.keys(removed).length}개` : ''));
      for (const id of gone)
        F(`61. 결과 「${(roster.labs || {})[id] || id}」(${id})가 사라졌다. ` +
          `결과는 지도의 입구다 — 일부러 뺀 것이면 db/result_roster.json 의 removed 에 이유를 적어라`);
      if (silent.length)
        F(`61. removed 에 이유가 안 적힌 것 ${silent.length}개: ${silent.join(', ')}`);
      if (added.length)
        W(`61. 결과 ${added.length}개가 명부에 없다 (${added.slice(0, 4).join(', ')}) — ` +
          `node tools/result-roster.mjs 로 명부를 갱신할 것`);
      /* 명부가 지도보다 훨씬 적으면 옛날 것을 그대로 믿고 있는 것이다 */
      if ((roster.ids || []).length && now.length < (roster.ids || []).length)
        W(`61. 결과가 ${(roster.ids || []).length} → ${now.length}개로 줄었다`);
    }
  }

  /* ── 62. 누르면 이어진 것이 둘레로 모인다 (ORBIT) ──
     "이어진 게 화면 여기저기 흩어져 있어서 한눈에 안 들어온다" 는 지적에서 나왔다.

     **반지름은 연도를 뜻한다.** 원으로 모으면 그 뜻이 깨지므로,
     원 안에서 **시계 방향으로 시간순**으로 놓는다 — 12시가 가장 오래된 것이다.
     반지름이 하던 일(시간)을 각도가 대신 맡는다. 그래서 이 검사가 제일 먼저 보는 것은
     '모이나' 가 아니라 **'시간순인가'** 다.

     지킬 것 다섯:
       ① 시계 방향 시간순인가 (12시가 가장 오래된 것)
       ② 이어지지 않은 것은 안 움직이나
       ③ 한 프레임에 튀지 않나 (순간이동 금지)
       ④ 닫으면 원래 자리로 돌아오나
       ⑤ 배율은 그대로인가 ("누르면 화면이 확대된다" 가 예전에 지적받은 그 문제다) */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      if(typeof ORBIT==='undefined')return {no:'ORBIT 스위치가 없다'};
      if(!ORBIT)return {off:1};
      var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
      if(typeof fade==='function')fade();
      cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
      var c=A.filter(function(n){return n.t==='result'&&adj[n.id]&&adj[n.id].length>4});
      if(!c.length)return {no:'이웃이 넷 넘는 결과 노드가 없다'};
      var self=c.reduce(function(a,b){return (adj[b.id]||[]).length>(adj[a.id]||[]).length?b:a});
      var before={}; A.forEach(function(n){before[n.id]=[n.x,n.y]});
      var s0=cam.ts;
      /* ── **새로 올라온 노드의 상황을 만든다** ──
         누르면 이웃이 지도에 새로 올라오는데, 그 노드는 __hw(그리는 상자)가 없다.
         __hw 는 tick() 안에서 채우는데 **초점 중에는 tick 이 그 줄 전에 돌아간다.**
         그러면 planLabels 의 첫 거름망에서 빠져 이름표가 안 그려진다 —
         브라우저에서 이웃 6개 중 4개가 이름 없는 점으로 떴다.

         jsdom 에서는 이웃이 이미 지도에 다 있어서 **저절로는 이 상황이 안 난다.**
         실제로 그 줄을 빼고 돌려 봤더니 검사가 5/5 로 통과했다 —
         **실패를 주입해도 통과하는 검사는 아무것도 보증하지 않는다.**
         그래서 값을 지워 상황을 그대로 재현한다. setFocus 가 다시 채우면 통과다. */
      A.forEach(function(n){ delete n.__hw; delete n.__hh });
      setFocus(self.id);
      /* 모이는 동안 한 프레임에 얼마나 뛰나 — **화면 기준**으로 잰다 */
      var prev=A.filter(function(n){return n.orb&&!n.__orbOut}).map(function(o){return [o.x,o.y]});
      var maxStep=0, arrive=-1;
      for(var f=0;f<200;f++){
        tick(); if(typeof fade==='function')fade();
        cam.s+=(cam.ts-cam.s)*0.11; cam.x+=(cam.tx-cam.x)*0.11; cam.y+=(cam.ty-cam.y)*0.11;
        var nb=A.filter(function(n){return n.orb&&!n.__orbOut});
        for(var i=0;i<nb.length;i++) if(prev[i]){
          var d=Math.hypot(nb[i].x-prev[i][0],nb[i].y-prev[i][1])*cam.s;
          if(d>maxStep)maxStep=d }
        if(arrive<0&&nb.length&&nb.every(function(o){return Math.hypot(o.x-o.orb[0],o.y-o.orb[1])<1}))arrive=f;
        prev=nb.map(function(o){return [o.x,o.y]});
      }
      var nb=A.filter(function(n){return n.orb&&!n.__orbOut});
      var home={}; nb.forEach(function(o){ if(o.orb0)home[o.id]=o.orb0.slice() });
      /* ① 시계 방향 시간순 — 12시(0°)부터 각도가 커질수록 최근이어야 한다 */
      var ang=function(o){var a=Math.atan2((o.y-self.y)/0.86,o.x-self.x)+Math.PI/2;
        while(a<0)a+=Math.PI*2; return a*180/Math.PI};
      var byAng=nb.slice().sort(function(a,b){return ang(a)-ang(b)});
      var yr=function(o){var y=parseInt(String(o.yr||''),10);return isFinite(y)?y:9999};
      var bad=0;
      for(var i=1;i<byAng.length;i++) if(yr(byAng[i])<yr(byAng[i-1]))bad++;
      /* ── **지금 값을 지금 적어 둔다** ──
         전에는 이 줄들을 return 문 안에서 계산했다. 그런데 return 은 closePop() 과
         260프레임 **뒤에** 평가된다 — 그때 노드는 이미 제자리로 돌아가 있다.
         그래서 "67° 15° 79°" 처럼 원이 아닌 값이 나왔고, 없는 문제를 FAIL 로 띄웠다.
         **재는 시점과 적는 시점이 갈리면 검사가 다른 것을 잰다.** */
      var order=byAng.map(function(o){return Math.round(ang(o))+'°'+o.yr});
      var ring1=Object.keys(ring).filter(function(k){return ring[k]===1}).length;
      var nCount=nb.length;
      /* ② 이어지지 않은 것 */
      var others=0;
      A.forEach(function(n){ var b=before[n.id]; if(!b)return;
        if((n.orb&&!n.__orbOut)||n===self)return;
        if(Math.hypot(n.x-b[0],n.y-b[1])>1)others++ });
      var selfMove=Math.hypot(self.x-before[self.id][0],self.y-before[self.id][1]);
      /* ⑤ 배율 */
      var zoom=Math.abs(cam.ts-s0);
      /* ── 이름표가 겹치나 — **화면이 쓰는 함수를 그대로 부른다** ──
         전에는 labelBox(o,1) 로 월드 값을 재고 "0쌍" 이라고 했다. 그런데 화면은
         labelFontScale()(실측 2.698)을 곱해 그린다 — **검사와 화면이 다른 것을 재고 있었다.**
         사람 눈에는 겹치는데 검사는 초록불이었다. 공식을 베껴 쓰면 언제나 이렇게 갈라진다.
         페이지의 orbLabelBox()·orbOverlap() 을 부른다. 화면이 그 함수로 판단해 반지름을 정한다.
         **모여 있는 동안** 재야 한다 — 닫은 뒤에 재면 다른 것을 잰다. */
      var ov=0, rows=(typeof orbZig==='number')?(orbZig?2:1):1, rr=(typeof orbR==='number')?Math.round(orbR*cam.s):0;
      if(typeof orbLabelBox==='function'&&typeof orbOverlap==='function')
        ov=orbOverlap(nb.concat([self]).map(function(o){return orbLabelBox(o)}));
      /* ── **겹치지 않는 것과 그려지는 것은 다르다** ──
         겹침 0 인데 이름표가 6개 중 2개만 그려진 적이 있다.
         새로 올라온 노드는 __hw(그리는 상자)가 없어서 planLabels 의 첫 거름망에서 빠졌다 —
         **모아 놓고도 이름을 못 읽으면 모으는 뜻이 없다.** 화면이 쓰는 함수로 직접 센다. */
      var drew=-1;
      if(typeof planLabels==='function'){
        var ls=planLabels();
        drew=nb.filter(function(o){return ls[o.id]}).length;
      }
      var cut=(typeof orbCut==='number')?orbCut:0;
      var room=(typeof orbRoom==='function')?orbRoom():null;
      /* ④ 닫으면 돌아오나 */
      closePop();
      /* ── **다 돌아올 때까지 기다렸다가 잰다** ──
         프레임 수를 고정해 두면 반지름이 커질 때 "덜 돌아온 것" 을 "안 돌아온 것" 으로 읽는다.
         실제로 반지름이 141→174px 이 되자 53px 어긋난 것으로 나왔다 — 아직 오는 중이었다.
         **끝난 것을 재야 한다.** 몇 프레임 걸렸는지도 함께 낸다 — 너무 오래 걸리면 그것도 문제다. */
      var backF=-1;
      for(var f=0;f<600;f++){
        tick(); if(typeof fade==='function')fade();
        if(!A.some(function(n){return n.orb})){ backF=f; break }
      }
      var backMax=0;
      Object.keys(home).forEach(function(k){ var o=map[k]; if(!o)return;
        var d=Math.hypot(o.x-home[k][0],o.y-home[k][1]); if(d>backMax)backMax=d });
      var left=A.filter(function(n){return n.orb}).length;
      return {n:nCount, ring1:ring1, order:order, bad:bad,
        others:others, selfMove:Math.round(selfMove), maxStep:+maxStep.toFixed(1),
        arrive:arrive, zoom:+zoom.toFixed(4), backMax:Math.round(backMax), left:left, ov:ov,
        rows:rows, rr:rr, backF:backF, drew:drew, cut:cut, room:room, lab:self.lab};
    })()`);
    dm.window.close();
    if (!r) F('62. 못 쟀다');
    else if (r.off) console.log('62. 둘레로 모으기  꺼져 있다 (ORBIT=false) — 예전 방식이다');
    else if (r.no) F(`62. ${r.no}`);
    else {
      console.log(`62. 둘레로 모으기  「${r.lab}」 · 원에 ${r.n}개(선 ${r.ring1}개) · ` +
        `${r.order.join(' ')} · ${r.rows}겹 반지름 ${r.rr}px · 모이는 데 ${r.arrive}프레임 · 프레임당 최대 ${r.maxStep}px · ` +
        `이어지지 않았는데 움직인 것 ${r.others}개 · 누른 것 ${r.selfMove}px · 배율 ${r.zoom} · ` +
        `닫은 뒤 원래 자리와 ${r.backMax}px(${r.backF}프레임) · 이름표겹침 ${r.ov}쌍 · ` +
        `이름표 ${r.drew}/${r.n}개 그려짐` + (r.cut ? ` · 자리가 좁아 ${r.cut}개는 제자리` : ''));
      /* **겹침 0 만으로는 모자란다.** 안 그려진 이름표는 겹칠 일도 없다 —
         "아무것도 안 잡는 검사는 언제나 PASS" 가 이 자리에서도 성립한다. */
      if (r.drew >= 0 && r.drew < r.n)
        F(`62. 원에 ${r.n}개를 모았는데 이름표는 ${r.drew}개만 그려진다. ` +
          `모아 놓고도 못 읽으면 모으는 뜻이 없다 (새로 올라온 노드에 __hw 가 없는지 본다)`);
      if (r.bad)
        F(`62. 시계 방향 시간순이 아니다 — ${r.bad}곳에서 뒤집힌다 (${r.order.join(' ')}). ` +
          `반지름이 연도를 뜻하는데 원으로 모으면 그 뜻이 깨진다. 각도가 그 일을 대신 맡아야 한다`);
      if (r.others)
        F(`62. 이어지지 않은 노드 ${r.others}개가 움직였다. 모으는 것은 이어진 것만이다`);
      if (r.selfMove > 1)
        F(`62. 누른 노드가 ${r.selfMove}px 움직였다. 그것은 원의 중심이라 제자리에 있어야 한다`);
      if (r.maxStep > 40)
        F(`62. 한 프레임에 ${r.maxStep}px 뛴다 (상한 ${34}px). 순간이동으로 보인다`);
      if (r.zoom > 0.001)
        F(`62. 누르자 배율이 ${r.zoom} 바뀌었다. "누르면 화면이 확대된다" 가 예전에 지적받은 그 문제다`);
      if (r.left)
        F(`62. 닫았는데 아직 모으는 중인 노드가 ${r.left}개 남았다`);
      if (r.backF < 0)
        F('62. 닫았는데 600프레임 안에 다 안 돌아왔다');
      else if (r.backF > 200)
        W(`62. 돌아오는 데 ${r.backF}프레임 걸린다 — 3초가 넘으면 되돌아가는 게 안 보인다`);
      if (r.backMax > 30)
        F(`62. 닫은 뒤 원래 자리에서 ${r.backMax}px 어긋났다. 닫으면 있던 자리로 돌아가야 한다`);
      /* **겹치면 FAIL 이다.** 모으는 목적이 '한눈에 읽히게' 인데 겹치면 그 목적이 사라진다.
         화면이 반지름을 넓히고 두 겹으로 나눠서라도 0 을 만들어야 한다. */
      if (r.ov)
        F(`62. 원 안에서 이름표가 ${r.ov}쌍 겹친다 — 모아 놓고도 못 읽는다. ` +
          `반지름을 넓히거나 겹을 나눠야 한다 (지금 ${r.rows}겹 ${r.rr}px)`);
      if (r.arrive < 0)
        W('62. 200프레임 안에 다 못 모였다');
    }
  }

  /* ── 63. '처음으로' 는 **자리도** 되돌린다 ──
     전에는 초점만 풀고 끌어서 옮긴 노드는 그대로 있었다. '전부 초기화' 라는 말과 어긋난다.

     **무엇과 견주느냐가 이 검사의 핵심이다.**
     처음에 '누르기 직전 자리' 와 견줬더니 하나가 1149px 어긋난 것으로 나왔다.
     그런데 그 노드는 데이터가 정한 자리(반지름=연도, 각도=흩뿌린 값)에 **정확히** 있었다 —
     '누르기 직전 자리' 쪽이 충돌 해소로 밀려 있던 자리였다.
     **검사가 틀린 것을 재고 있었다.** 약속은 "데이터가 정한 자리로 돌아간다" 이지
     "직전 자리로 돌아간다" 가 아니다.

     그리고 `resetAllView()` 를 직접 부르지 않고 **버튼을 실제로 누른다** —
     직접 부르면 버튼이 안 걸려 있어도 통과한다 (54번과 같은 이유). */
  {
    const dm = boot(1440, 900);
    await new Promise(r => setTimeout(r, 1400));
    const r = dm.window.eval(`(function(){
      var t=0; while(alpha>LAY_STOP&&t<600){tick();t++}
      if(typeof fade==='function')fade();
      var T=A.filter(function(n){return n.t==='result'}).slice(0,6);
      if(T.length<3)return {no:'결과 노드가 셋도 안 된다'};
      var home=function(n){var R=ringR(n);
        return [Math.cos(n.ang)*R, Math.sin(n.ang)*R*0.86]};
      var off=function(n){var h=home(n);return Math.hypot(n.x-h[0],n.y-h[1])};
      /* 사람이 하는 짓 — 끌어다 옮기고, 초점도 켜고, 필터도 건드린다 */
      T.forEach(function(n,i){ n.fixed=1;
        n.x+=(i%2?1:-1)*900; n.y+=(i<3?-1:1)*700; n.vx=0; n.vy=0 });
      setFocus(T[0].id);
      for(var f=0;f<120;f++){ tick(); if(typeof fade==='function')fade() }
      var pulled=T.map(off).map(Math.round);
      var btn=null;
      var all=document.querySelectorAll('button,.ub');
      for(var i=0;i<all.length;i++) if(/처음으로/.test(all[i].textContent||'')){btn=all[i];break}
      if(!btn)return {no:'처음으로 버튼을 못 찾았다'};
      btn.click();
      for(var f2=0;f2<900;f2++){ tick(); if(typeof fade==='function')fade() }
      var back=T.map(off).map(Math.round);
      return {pulled:pulled, back:back, worst:Math.max.apply(null,back),
        fixed:T.filter(function(n){return n.fixed}).length,
        focus:focus, cat:cat, hist:(typeof navHist!=='undefined')?navHist.length:0,
        orb:A.filter(function(n){return n.orb}).length,
        labs:T.map(function(n){return (n.lab||'').slice(0,10)})};
    })()`);
    dm.window.close();
    if (!r) F('63. 못 쟀다');
    else if (r.no) F(`63. ${r.no}`);
    else {
      console.log(`63. '처음으로' 가 자리도 되돌리나  ${r.pulled.length}개를 평균 ` +
        `${Math.round(r.pulled.reduce((a,b)=>a+b,0)/r.pulled.length)}px 끌어다 놓고 눌렀다 → ` +
        `데이터가 정한 자리와 최대 ${r.worst}px (${r.back.join('/')})`);
      if (r.worst > 30)
        F(`63. '처음으로' 를 눌렀는데 노드가 데이터가 정한 자리에서 ${r.worst}px 어긋나 있다 ` +
          `(${r.labs.join(' ')} → ${r.back.join('/')}). '처음으로' 는 전부 초기화다`);
      if (r.fixed) F(`63. '처음으로' 뒤에도 고정(fixed)된 노드가 ${r.fixed}개 남았다`);
      if (r.focus) F(`63. '처음으로' 뒤에도 초점이 「${r.focus}」 에 남았다`);
      if (r.cat !== 'all') F(`63. '처음으로' 뒤에도 분야가 「${r.cat}」 이다`);
      if (r.hist) F(`63. '처음으로' 뒤에도 되돌리기 이력이 ${r.hist}칸 남았다`);
      if (r.orb) F(`63. '처음으로' 뒤에도 둘레로 모으는 노드가 ${r.orb}개 남았다`);
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
