const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const ROOT='/Users/yongsuk/why', html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const vc=new (require('jsdom').VirtualConsole)();
const LABEL_FONT_PX=12;
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

function boot(w,h){return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
 beforeParse(win){
  try{Object.defineProperty(win,'innerWidth',{value:w,configurable:true})}catch(e){}
  try{Object.defineProperty(win,'innerHeight',{value:h,configurable:true})}catch(e){}
  try{Object.defineProperty(win,'devicePixelRatio',{value:2,configurable:true})}catch(e){}
  stubCanvas(win);
  win.Element.prototype.getBoundingClientRect=function(){return {x:0,y:0,top:0,left:0,right:w,bottom:h,width:w,height:h,toJSON(){}}};
  let raf=0; win.requestAnimationFrame=cb=>{if(raf++<900)return setTimeout(()=>cb(raf*16),0);return 0};
  win.cancelAnimationFrame=()=>{}}})}
const VP=[[412,915],[344,882],[402,874],[884,1104],[1440,900]];
const MEAS=`(function(mode,flip){
  var pool=A.length?A:N;
  if(flip)toggleTimeDir();
  for(var t=0;t<900&&alpha>ALPHA_MIN;t++)tick();
  if(mode==='wide'||mode==='fitall'){
    var minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
    pool.forEach(function(n){minx=Math.min(minx,n.x-n.r-60);maxx=Math.max(maxx,n.x+n.r+60);
      miny=Math.min(miny,n.y-n.r-40);maxy=Math.max(maxy,n.y+n.r+60)});
    var pad=70,gw=maxx-minx+pad*2,gh=maxy-miny+pad*2;
    var s=Math.max(0.25,Math.min(2.2,Math.min(W/gw,H/gh)));
    if(mode==='wide')s=Math.max(s,LABEL_FAR);
    cam.ts=s;cam.tx=W/2-((minx+maxx)/2)*s;cam.ty=H/2-((miny+maxy)/2)*s;
  } else { fit() }
  cam.s=cam.ts;cam.x=cam.tx;cam.y=cam.ty;
  labelSet=null;labelKey='';draw();
  var on=[],rq=[0,0,0,0],rcx=0,rcy=0,rn=0,cx=0,cy=0;
  A.forEach(function(n){var sx=n.x*cam.s+cam.x,sy=n.y*cam.s+cam.y;
    if(sx<0||sx>W||sy<0||sy>H)return;
    on.push([sx,sy]);cx+=sx;cy+=sy;
    if(n.t==='result'){rcx+=sx;rcy+=sy;rn++;rq[(sx<W/2?0:1)+(sy<H/2?0:2)]++}});
  if(!on.length)return{on:0};
  var cell=Math.max(80,Math.min(W,H)/4),gx=Math.ceil(W/cell),gy=Math.ceil(H/cell);
  var g=new Array(gx*gy).fill(0);
  on.forEach(function(p){g[Math.min(gy-1,Math.floor(p[1]/cell))*gx+Math.min(gx-1,Math.floor(p[0]/cell))]++});
  var RO=ROUT*cam.s,RI=0;
  var inBox=0,emptyIn=0;
  for(var yy=0;yy<gy;yy++)for(var xx=0;xx<gx;xx++){
    var mx=(xx+0.5)*cell-(W/2+0), my=(yy+0.5)*cell-H/2;
    var ex=(mx-cam.x+W/2-W/2)/1;
    var wx=((xx+0.5)*cell-cam.x)/cam.s, wy=((yy+0.5)*cell-cam.y)/cam.s;
    if(Math.hypot(wx,wy/0.86)<=ROUT){inBox++;if(!g[yy*gx+xx])emptyIn++}
  }
  return {on:on.length,tot:A.length,s:+cam.s.toFixed(2),
    무리:Math.round(Math.hypot(cx/on.length-W/2,cy/on.length-H/2)),
    무리pct:+(100*Math.hypot(cx/on.length-W/2,cy/on.length-H/2)/Math.hypot(W,H)).toFixed(1),
    결과n:rn,사분면:rq.join('/'),빈사분면:rq.filter(function(v){return !v}).length,
    결과off:rn?Math.round(Math.hypot(rcx/rn-W/2,rcy/rn-H/2)):-1,
    빈칸:emptyIn+'/'+inBox,빈칸pct:Math.round(100*emptyIn/Math.max(1,inBox)),
    이름표:labelStat?labelStat.shown:0};
})`;
const MODES=(process.env.MODES||'now,wide,fitall').split(',');
const FLIP=process.env.FLIP==='1';
(async()=>{
 console.log('시간방향: '+(FLIP?'뒤집음 (가운데=최근)':'현재 (가운데=과거)'));
 console.log('해상도      경로   배율  화면안   무리중심     결과 사분면(좌상/우상/좌하/우하) 빈사분면 결과off  고리빈칸  이름표');
 for(const [w,h] of VP){
  const row=[];
  for(const mode of ['now','wide']){
   const d=boot(w,h); await new Promise(r=>setTimeout(r,1500));
   let r; try{ r=d.window.eval(MEAS+`('${mode}',${FLIP})`) }catch(e){ r={err:String(e).slice(0,60)} }
   d.window.close(); row.push([mode,r]);
  }
  for(const [mode,r] of row){
   if(!r||r.on===0||r.err){console.log(`${(w+'x'+h).padEnd(11)} ${mode.padEnd(5)} ERR ${r&&r.err||''}`);continue}
   console.log(`${(w+'x'+h).padEnd(11)} ${mode.padEnd(5)} ${String(r.s).padEnd(5)} ${String(r.on+'/'+r.tot).padEnd(8)} ${String(r.무리+'px('+r.무리pct+'%)').padEnd(12)} ${String(r.결과n+'개 '+r.사분면).padEnd(16)} ${String(r.빈사분면).padEnd(8)} ${String(r.결과off+'px').padEnd(8)} ${String(r.빈칸+'('+r.빈칸pct+'%)').padEnd(10)} ${r.이름표}`);
  }
  console.log('');
 }
})();
