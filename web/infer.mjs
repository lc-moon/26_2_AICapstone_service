import {element,cameraFigure,concentration} from './evidence.mjs';
import {formatTime,validValue,gradeOf} from './core.mjs';
export function inferFailure(status) {
  return status===409?'다른 분이 추정 중이에요. 잠시 뒤 다시 눌러 주세요.':'지금은 할 수 없어요. 기존 회차 사진과 값은 그대로 확인할 수 있습니다.';
}
export function validateInference(data,cameraId) {
  if(!data || String(data.camera_id)!==String(cameraId) || !(data.pm25===null||validValue(data.pm25)) || !Number.isFinite(Date.parse(data.captured_at))) throw Error('잘못된 추정 응답');
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
export async function requestInference(cameraId,{mock,scenario,base,signal,fetcher=fetch,mockDelay=10000}) {
  let response;
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
export function mountInference(host,camera,options,onBusy=()=>{}) {
  const section=element('section',null,'infer-section');
  const button=element('button','지금 찍어서 추정해 보기','infer-button');button.type='button';
  const status=element('p');status.setAttribute('role','status');
  const result=element('div',null,'infer-result');
  section.append(button,status,result);host.append(section);
  let disposed=false,controller=null,timers=[];
  function clear(){timers.forEach(clearTimeout);timers=[];}
  button.onclick=async()=>{
    if(controller||disposed)return;
    controller=new AbortController();onBusy(true);button.disabled=true;result.replaceChildren();
    status.textContent='① 사진 찍는 중 · 아래 단계는 대기 안내입니다.';
    timers.push(setTimeout(()=>status.textContent='② 위쪽 60%를 모델 입력으로 준비하는 중…',5000));
    timers.push(setTimeout(()=>status.textContent='③ 모델 계산 중 · 최대 30초 기다려 주세요.',8000));
    timers.push(setTimeout(()=>controller?.abort(),30000));
    try{
      const data=await requestInference(camera.camera_id,{...options,signal:controller.signal});
      if(disposed)return;
      status.textContent='④ 결과 확인';
      result.append(element('h4',data.cached?'방금 누른 결과':'지금 촬영한 사진의 추정 결과'));
      if(options.mock)result.append(element('p','MOCK · 현재 촬영이 아닌 예시 결과입니다.'));
      result.append(cameraFigure({...camera,...data},options),element('p',validValue(data.pm25)?`${concentration(data.pm25)} · ${gradeOf(data.pm25).name}`:data.status||'추정 안 함','camera-result'),element('p',`${formatTime(data.captured_at)} 촬영${Number.isFinite(data.elapsed_s)?' · 처리 '+data.elapsed_s.toFixed(1)+'초':''}`),element('p','이 즉석 결과는 위 지도와 정기 회차 값을 바꾸지 않습니다.'));
    }catch(error){if(!disposed)status.textContent=inferFailure(error?.status);}
    finally{clear();controller=null;if(!disposed){button.disabled=false;onBusy(false);}}
  };
  return ()=>{disposed=true;clear();controller?.abort();controller=null;onBusy(false);};
}
