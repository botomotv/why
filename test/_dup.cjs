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
(async()=>{
 const d=boot(1440,900); await new Promise(r=>setTimeout(r,1800));
 const N=d.window.N;
 const byType={};
 N.forEach(n=>{ (byType[n.t]=byType[n.t]||[]).push(n) });
 console.log('=== 종류별 노드 수 (페이지의 N 배열)');
 Object.keys(byType).sort().forEach(t=>console.log('  '+t.padEnd(8), byType[t].length));
 console.log('\n=== 같은 lab 이 둘 이상인 것');
 let total=0;
 for(const t of Object.keys(byType).sort()){
   const m={}; byType[t].forEach(n=>{ (m[n.lab]=m[n.lab]||[]).push(n.id) });
   const dup=Object.entries(m).filter(([k,v])=>v.length>1);
   const cnt=dup.reduce((a,[k,v])=>a+v.length-1,0);
   total+=cnt;
   console.log('  '+t.padEnd(8), '중복 이름 '+dup.length+'가지 · 여분 '+cnt+'개');
   dup.slice(0,6).forEach(([k,v])=>console.log('      「'+String(k).slice(0,40)+'」 ×'+v.length+' → '+v.join(' ')));
   if(dup.length>6)console.log('      … 외 '+(dup.length-6)+'가지');
 }
 console.log('\n  전체 여분 노드', total, '개');
 d.window.close();
})();
