/* 브라우저에서 실제로 재는 것. javascript_tool 로 붙여 넣어 돌린다.
   **전환을 끄고 잰다** — 멈춰 있던 전환의 잔상을 최종값으로 읽은 적이 있다. */
(function(){
  var st=document.createElement('style');
  st.textContent='*{transition:none !important;animation:none !important}';
  document.head.appendChild(st); document.body.getBoundingClientRect();
  var o={};
  o.노드=N.length; o.선=L.length;
  o.자동노드=N.filter(function(n){return n.auto}).length;
  o.종류={}; N.forEach(function(n){o.종류[n.t]=(o.종류[n.t]||0)+1});
  var t=performance.timing||{};
  o.로딩_ms=Math.round(performance.now());
  var nav=performance.getEntriesByType('navigation')[0];
  if(nav){o.문서로딩_ms=Math.round(nav.domContentLoadedEventEnd);o.전체로딩_ms=Math.round(nav.loadEventEnd)}
  var a=performance.now(); for(var i=0;i<10;i++)tick(); o.틱_ms=+((performance.now()-a)/10).toFixed(2);
  a=performance.now(); for(i=0;i<5;i++)draw(); o.그리기_ms=+((performance.now()-a)/5).toFixed(2);
  var res=N.filter(function(n){return n.t==='result'});
  a=performance.now(); setFocus(res[0].id); o.결과누름_ms=+(performance.now()-a).toFixed(1);
  a=performance.now(); setFocus(null); o.해제_ms=+(performance.now()-a).toFixed(1);
  var bl=N.filter(function(n){return n.t==='bill'});
  if(bl.length){a=performance.now(); setFocus(bl[0].id); o.법안누름_ms=+(performance.now()-a).toFixed(1); setFocus(null)}
  a=performance.now(); cam.s*=1.2; draw(); o.확대_ms=+(performance.now()-a).toFixed(1); cam.s/=1.2;
  o.이름표=(typeof labelDrawn!=='undefined')?labelDrawn:null;
  o.메모리_MB=performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null;
  st.remove(); return o;
})()
