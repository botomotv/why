const fs=require('fs'),path=require('path'),{JSDOM,VirtualConsole}=require('jsdom');
const ROOT='/Users/yongsuk/why', html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const vc=new VirtualConsole(); const LABEL_FONT_PX=12;
const chk=fs.readFileSync(path.join(ROOT,'test/check.cjs'),'utf8');
eval(chk.slice(chk.indexOf('function textWidth('),chk.indexOf('function visibleText(')));
function boot(w,h){return new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
 beforeParse(win){
  try{Object.defineProperty(win,'innerWidth',{value:w,configurable:true})}catch(e){}
  try{Object.defineProperty(win,'innerHeight',{value:h,configurable:true})}catch(e){}
  try{Object.defineProperty(win,'devicePixelRatio',{value:2,configurable:true})}catch(e){}
  stubCanvas(win);
  win.Element.prototype.getBoundingClientRect=function(){return {x:0,y:0,top:0,left:0,right:w,bottom:h,width:w,height:h,toJSON(){}}};
  let raf=0; win.requestAnimationFrame=cb=>{if(raf++<900)return setTimeout(()=>cb(raf*16),0);return 0};
  win.cancelAnimationFrame=()=>{}}})}
const M=`(function(){
  for(var t=0;t<900&&alpha>ALPHA_MIN;t++)tick();
  var lens=[],ln=(typeof LK!=='undefined'?LK:null);
  var arr=(typeof drawLinks!=='undefined')?null:null;
  var seen={},tot=0,sum=0,mx=0;
  L.forEach(function(l){
    var a=map[l[0]],b=map[l[1]];
    if(!a||!b||!isFinite(a.x)||!isFinite(b.x))return;
    if(a.hid||b.hid)return;
    var d=Math.hypot(a.x-b.x,a.y-b.y); lens.push(d); sum+=d; tot++; if(d>mx)mx=d});
  lens.sort(function(p,q){return p-q});
  return {선수:tot, 평균:Math.round(sum/tot), 중앙값:Math.round(lens[Math.floor(tot/2)]),
    상위10퍼센트:Math.round(lens[Math.floor(tot*0.9)]), 최대:Math.round(mx),
    고리반지름:[Math.round(RIN||0),Math.round(ROUT)]};
})()`;
(async()=>{
 const d=boot(1440,900); await new Promise(r=>setTimeout(r,1600));
 const now=d.window.eval(M);
 d.window.eval('toggleTimeDir()');
 await new Promise(r=>setTimeout(r,300));
 const flip=d.window.eval(M);
 d.window.close();
 console.log('선 길이 (월드 좌표, 필터 없이 전체)');
 console.log('                  가운데=최근(새 기본)   가운데=과거(옛 기본)   변화');
 const keys=['선수','평균','중앙값','상위10퍼센트','최대'];
 keys.forEach(k=>{
   const a=now[k],b=flip[k];
   const chg=(k==='선수')?'':((a-b)/b*100).toFixed(1)+'%';
   console.log(String(k).padEnd(16)+String(a).padStart(12)+String(b).padStart(22)+String(chg).padStart(10));
 });
 console.log('고리 반지름', JSON.stringify(now.고리반지름));
})();
