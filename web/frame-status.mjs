import {element} from './evidence.mjs';
const paths={normal:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M5.6 18.4l1.4-1.4m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',night:'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10',rain:'M6 14a4 4 0 1 1 1-8 5 5 0 0 1 10 0 4 4 0 0 1 1 8M8 17l-1 3m5-3-1 3m5-3-1 3',humidity:'M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12',few_cameras:'M3 6h12v12H3zM15 10l6-3v10l-6-3',no_data:'M4 4l16 16M3 7h12v11H3M16 10l5-3v10'};
export function frameStatus(frame){
 const total=Number.isInteger(frame.cctv?.total)?frame.cctv.total:'?',valid=Number.isInteger(frame.cctv?.valid)?frame.cctv.valid:'?';
 const labels={normal:[`CCTV ${total}대 중 ${valid}대 사진으로 추정했어요`,`CCTV ${valid}/${total}대로 추정했어요`],night:['밤이라 측정소에서 잰 값을 보여 드려요','밤 · 측정소에서 잰 값'],rain:['비가 와서 측정소에서 잰 값을 보여 드려요','비 · 측정소에서 잰 값'],humidity:['습도가 높아서(95% 이상) 측정소에서 잰 값을 보여 드려요','습도 높음 · 측정소에서 잰 값'],few_cameras:[`쓸 수 있는 CCTV가 ${total}대 중 ${valid}대뿐이라 측정소에서 잰 값을 보여 드려요`,`CCTV 부족(${valid}/${total}) · 측정소에서 잰 값`],no_data:['CCTV 자료가 없어서 측정소에서 잰 값을 보여 드려요','CCTV 자료 없음 · 측정소에서 잰 값']};
 const pair=labels[frame.reason];return pair?{label:pair[0],short:pair[1],path:paths[frame.reason]}:null;
}
export function statusIcon(path){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),line=document.createElementNS(svg.namespaceURI,'path');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');line.setAttribute('d',path);svg.append(line);return svg;
}
export function renderFrameStatus(host,frame,fallback){
 const state=frameStatus(frame);if(!state){delete host.dataset.reason;host.textContent=fallback;return;}
 host.dataset.reason=frame.reason;
 host.replaceChildren(statusIcon(state.path),element('span',state.label,'source-full'),element('span',state.short,'source-short'));
}
// 측정소 지도일 때 접속하면 한 번 알리는 안내창. 이유는 원리 페이지의 "뺀 사진"과 같은 내용만 쓴다
const VALUE_NOTE='지금 지도는 측정소에서 잰 실제 값이에요.';
export function noticeFor(frame){
 const total=frame?.cctv?.total??'?',valid=frame?.cctv?.valid??'?';
 return {
  night:{title:'지금은 밤이라 CCTV로 추정하지 않아요',body:`어두운 사진은 AI가 배우지 않았어요. ${VALUE_NOTE} 해가 뜨면 다시 CCTV로 추정해요.`},
  rain:{title:'지금은 비가 와서 CCTV로 추정하지 않아요',body:`비 오는 사진은 AI 학습에서 뺐어요. ${VALUE_NOTE} 비가 그치면 다시 CCTV로 추정해요.`},
  humidity:{title:'지금은 습도가 너무 높아 CCTV로 추정하지 않아요',body:`습도 95% 이상인 사진은 짙은 안개와 물방울 때문에 AI 학습에서 뺐어요. ${VALUE_NOTE}`},
  few_cameras:{title:'지금은 쓸 수 있는 CCTV가 적어요',body:`CCTV ${total}대 중 ${valid}대만 값이 있어요. ${VALUE_NOTE}`},
  no_data:{title:'지금은 CCTV 자료가 없어요',body:VALUE_NOTE},
 }[frame?.reason]||null;
}
export function mountNotice(host){
 const KEY='incheon-air-notice-v1';let memory=null;
 const read=()=>{try{return sessionStorage.getItem(KEY);}catch{return memory;}};
 const write=value=>{memory=value;try{value?sessionStorage.setItem(KEY,value):sessionStorage.removeItem(KEY);}catch{}};
 const close=()=>{write(host.dataset.reason);host.hidden=true;};
 host.querySelectorAll('button').forEach(b=>b.onclick=close);
 host.onclick=event=>{if(event.target===host)close();};
 host.onkeydown=event=>{if(event.key==='Escape'){event.stopPropagation();close();}};
 return (frame,busy=false)=>{
  const notice=noticeFor(frame);
  if(!notice){write(null);host.hidden=true;return;}
  if(!host.hidden||busy||read()===frame.reason)return;   // 같은 상태는 탭에서 한 번만, 지점을 보는 중이면 미룬다
  host.dataset.reason=frame.reason;host.querySelector('h2').textContent=notice.title;host.querySelector('p').textContent=notice.body;host.querySelector('.notice-icon').replaceChildren(statusIcon(frameStatus(frame).path));
  host.hidden=false;host.querySelector('.notice-ok').focus();
 };
}
