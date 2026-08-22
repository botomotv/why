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
