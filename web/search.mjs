// User-submitted queries only. Runtime endpoint allows switching providers/proxy.
export function searchURL(query,endpoint){
 const url=new URL(endpoint,globalThis.location?.href||'https://example.invalid');
 url.search=new URLSearchParams({q:query,format:'json',limit:'1',countrycodes:'kr',viewbox:'126.35,37.65,126.85,37.35',bounded:'1'});
 return url.href;
}
export function createSearch({endpoint,fetcher=fetch,now=Date.now,storage=globalThis.localStorage}={}){
 let pending=false,last=-Infinity;const memory=new Map();
 const prefix=`air-search-v1:${endpoint}:`;
 return async query=>{
  query=query.trim().replace(/\s+/g,' ');if(!query)return null;
  const key=prefix+query;
  let cached=memory.get(key);
  try{cached??=JSON.parse(storage?.getItem(key)||'null');}catch{}
  if(cached&&now()-cached.time<86400000)return cached.result;
  let sharedLast=last;try{sharedLast=Math.max(sharedLast,Number(storage?.getItem(prefix+'last'))||0);}catch{}
  if(pending||now()-sharedLast<1100)throw Error('잠시 뒤 다시 검색해 주세요. 검색은 1초에 한 번만 가능합니다.');
  pending=true;last=now();try{storage?.setItem(prefix+'last',String(last));}catch{}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetcher(searchURL(query,endpoint),{signal:controller.signal,referrerPolicy:'strict-origin-when-cross-origin'});
   if(!response.ok)throw Error('검색 서비스에 연결할 수 없습니다. 잠시 뒤 다시 시도해 주세요.');
   const rows=await response.json();if(!Array.isArray(rows))throw Error('검색 응답을 확인할 수 없습니다.');
   let result=null;
   if(rows.length){const p=[Number(rows[0].lon),Number(rows[0].lat)];if(!p.every(Number.isFinite)||Math.abs(p[0])>180||Math.abs(p[1])>90)throw Error('검색 위치를 확인할 수 없습니다.');result={point:p,name:String(rows[0].display_name||query)};}
   const entry={time:now(),result};memory.set(key,entry);try{storage?.setItem(key,JSON.stringify(entry));}catch{}
   return result;
  }finally{clearTimeout(timer);pending=false;}
 };
}
export async function mountSearch(form,{inside,onSelect}){
 const input=form.querySelector('input'),status=form.querySelector('[role=status]');
 let search;
 try{const response=await fetch('search-config.json');if(!response.ok)throw Error();const config=await response.json();search=createSearch({endpoint:config.endpoint});}
 catch{status.textContent='검색 설정을 불러오지 못했습니다. 지도에서 위치를 선택해 주세요.';return;}
 input.disabled=false;
 form.addEventListener('submit',async event=>{
  event.preventDefault();const query=input.value.trim();if(!query)return;
  input.disabled=true;status.textContent='장소를 찾고 있습니다…';
  try{const result=await search(query);
   if(!result){status.textContent='결과가 없습니다. 정식 이름이나 주소로 검색해 주세요.';return;}
   if(!inside(result.point)){status.textContent='CCTV가 없는 곳(영종·강화·섬)은 추정하지 않아요. 인천 내륙과 송도를 검색해 주세요.';return;}
   status.textContent=result.name;onSelect(result.point);
  }catch(error){status.textContent=error.name==='AbortError'?'검색 응답이 늦습니다. 잠시 뒤 다시 시도해 주세요.':error.message;}
  finally{input.disabled=false;input.focus();}
 });
}
