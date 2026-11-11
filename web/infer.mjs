import {element,cameraFigure,gradePill,enlargeable} from './evidence.mjs';
import {formatTime,validValue} from './core.mjs';
export function inferFailure(status) {
  return status===409?'다른 분이 추정 중이에요. 잠시 뒤 다시 눌러 주세요.':'지금은 할 수 없어요. 마지막 회차 사진과 값은 그대로 볼 수 있어요';
}
export function validateInference(data,cameraId) {
  const night=data?.captured_at==null&&data?.pm25===null;   // F10: 밤에는 사진을 안 찍고 사유만 온다
  if(!data || String(data.camera_id)!==String(cameraId) || !(data.pm25===null||validValue(data.pm25)) || !(night||Number.isFinite(Date.parse(data.captured_at)))) throw Error('잘못된 추정 응답');
  return data;
}
function wait(ms,signal) {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return;}
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
export async function requestInference(cameraId,{mock,scenario,base,signal,expo,fetcher=fetch,mockDelay=10000}) {
  let response;
  if(mock&&expo&&scenario==='night')return {camera_id:cameraId,captured_at:null,pm25:null,status:'밤 — 추정 안 함'};
  if(mock){
    const filename=scenario==='infer_rain'?'infer_rain':scenario==='infer_busy'?'infer_busy':'infer_ok';
    response=await fetcher(`../shared/mock/${filename}.json`,{signal});
    await wait(mockDelay,signal);
    if(scenario==='infer_busy')throw Object.assign(Error('busy'),{status:409});
    if(scenario==='infer_error')throw Object.assign(Error('unavailable'),{status:503});
  }else response=await fetcher(`${base}/api/infer?${new URLSearchParams({camera_id:cameraId})}`,{method:'POST',signal,cache:'no-store'});
  if(!response.ok)throw Object.assign(Error('infer failed'),{status:response.status});
  const result=validateInference(await response.json(),cameraId);
  return mock&&scenario==='infer_cached'?{...result,cached:true}:result;
}

// Presentation timers are separate from the single POST request. Never poll/retry a POST.
const SCAN_MS=1600,COUNT_MS=55,COUNT_STEPS=18;
export function mountInference(host,camera,options,onBusy=()=>{}) {
  const live=host.querySelector('.live'),actions=host.querySelector('.actions');
  const button=element('button',options.night?'마지막 낮 사진으로 과정 보기':'지금 찍어서 추정해 보기','infer-button');button.type='button';actions.append(button);
  let disposed=false,controller=null,timers=[],effects=[];
  function clear(){timers.forEach(clearTimeout);timers=[];}
  function clearEffects(){effects.forEach(clearTimeout);effects.forEach(clearInterval);effects=[];}
  let photo,side,status,steps,title;
  function frame(){
    const inner=element('div',null,'live-inner'),card=element('section',null,'live-card'),head=element('div',null,'card-head');
    title=element('h3','지금 찍어서 추정해 보기');head.append(title,element('span',camera.name));
    photo=element('div',null,'live-photo');card.append(head,photo);
    side=element('section',null,'live-side');steps=element('div',null,'steps');steps.setAttribute('aria-hidden','true');
    for(let i=0;i<4;i++)steps.append(element('i'));
    status=element('p',null,'live-status');status.setAttribute('role','status');side.append(steps,status);
    inner.append(card,side);live.replaceChildren(inner);live.classList.add('open');host.scrollTop=0;
  }
  function step(n){[...steps.children].forEach((dot,i)=>{dot.classList.toggle('on',i<n);dot.classList.toggle('step-now',i===n-1&&n<4);});}
  function waiting(text,n){
    status.textContent=text;step(n);
    if(!photo.querySelector('.shimmer')){const box=element('div',null,'shimmer');box.append(element('div',null,'spin'),element('span',null,'shimmer-text'));photo.replaceChildren(box);}
    photo.querySelector('.shimmer-text').textContent=text;
  }
  function message(text){clear();status.textContent=text;step(0);photo.replaceChildren(element('p',text,'live-msg'));}
  function scanThen(figure,finish){
    const wrap=figure.querySelector('.camera-photo');figure.classList.add('reveal');photo.replaceChildren(figure);
    if(!wrap){finish();return;}
    wrap.append(element('i',null,'scan'));
    effects.push(setTimeout(()=>{wrap.querySelector('.scan')?.remove();finish();},SCAN_MS));
  }
  function showNumber(value,foot){
    const big=element('div',validValue(value)?'0':'','live-value'),unit=element('div',null,'live-unit'),note=element('div',null,'live-foot');
    if(!validValue(value)){big.textContent=foot.status||'추정 안 함';big.classList.add('text');side.append(big,note);}
    else{
      const target=Math.round(value),pill=gradePill(value);unit.append('㎍/㎥',pill);side.append(big,unit,note);
      const done=()=>{big.textContent=String(target);pill.classList.remove('waiting');};
      pill.classList.add('waiting');let n=0;const total=Math.max(1,Math.min(target,COUNT_STEPS));const id=setInterval(()=>{n++;big.textContent=String(Math.round(target*n/total));if(n>=total){clearInterval(id);done();}},COUNT_MS);effects.push(id);
    }
    foot.lines.forEach(line=>note.append(element('span',line.text,line.strong?'strong':null)));
  }
  button.onclick=async()=>{
    if(controller||disposed)return;
    clearEffects();frame();
    controller=new AbortController();onBusy(true);button.disabled=true;
    waiting(options.expo?'사진을 준비하고 있어요':'사진을 찍고 있어요',1);   // 전시 주소의 밤에는 새로 찍지 않는다
    timers.push(setTimeout(()=>waiting('사진 위쪽만 남기고 있어요',2),5000));
    timers.push(setTimeout(()=>waiting('농도를 계산하고 있어요 (최대 30초)',3),8000));
    timers.push(setTimeout(()=>controller?.abort(),30000));
    try{
      const data=await requestInference(camera.camera_id,{...options,signal:controller.signal});
      if(disposed)return;
      if(options.expo&&data.captured_at==null&&/밤/.test(data.status||'')){   // 전시 주소의 밤: 사진을 새로 찍지 않으므로 마지막 낮 회차 사진으로 같은 단계를 보여 준다
        clear();waiting('결과를 불러오고 있어요',3);
        await wait(2500,controller.signal);if(disposed)return;
        status.textContent='다 됐어요';step(4);title.textContent='마지막 낮 사진의 추정 결과';
        const when=formatTime(camera.captured_at);
        const lastFigure=cameraFigure(camera,options,`${when} 촬영`);
        scanThen(lastFigure,()=>{enlargeable(lastFigure,camera,'마지막 낮에 찍은 사진이에요');showNumber(camera.pm25,{status:camera.status,lines:[{text:`${when}에 찍은 마지막 낮 사진이에요. 밤에는 새로 찍어 추정하지 않아요.`}]});});
        return;
      }
      if(data.captured_at==null){clear();title.textContent='지금은 추정하지 않아요';message(/밤/.test(data.status||'')?'밤에는 어두운 사진을 학습하지 않아 추정하지 않아요. 지도는 측정소 실측으로 채워져 있어요.':(data.status||'추정 안 함'));return;}
      clear();status.textContent='다 됐어요';step(4);if(data.cached)title.textContent='방금 누른 결과';
      const lines=[];if(Number.isFinite(data.elapsed_s))lines.push({text:`처리 ${data.elapsed_s.toFixed(1)}초`});lines.push({text:'이 결과는 지도 값을 바꾸지 않아요',strong:true});
      const figure=cameraFigure({...camera,...data},options,`${formatTime(data.captured_at)} 촬영`);
      scanThen(figure,()=>{enlargeable(figure,{...camera,...data},'방금 가져온 사진이에요');showNumber(data.pm25,{status:data.status,lines});});
    }catch(error){if(!disposed)message(inferFailure(error?.status));}
    finally{clear();controller=null;if(!disposed){button.disabled=false;onBusy(false);}}
  };
  return ()=>{disposed=true;clear();clearEffects();controller?.abort();controller=null;onBusy(false);};
}
