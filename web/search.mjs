import {element} from './evidence.mjs';
export const SEARCH_MESSAGES={empty:'결과가 없습니다. 장소 이름이나 주소로 검색해 주세요.',outside_incheon:'인천 밖의 장소예요. 인천 안의 장소로 검색해 주세요.',outside_area:'CCTV가 없는 곳(영종·강화·섬)은 추정하지 않아요. 인천 내륙과 송도를 검색해 주세요.',error:'검색을 잠시 쓸 수 없어요. 지도를 직접 눌러 주세요.'};
const SUGGEST_MIN=2,SUGGEST_WAIT=300;
// 패널의 구 이름은 1km 격자 기준이라 구 경계에서 틀릴 수 있어, 검색으로 고른 곳은 카카오 주소의 구를 쓴다
export const guOf=address=>address.match(/(?:^|\s)(\S+구)(?=\s)/)?.[1]||null;
export function validateSearch(data){
 if(!data||!['ok','empty','outside_incheon','outside_area'].includes(data.status)||!Array.isArray(data.results))throw Error('search response');
 if(data.results.some(r=>typeof r.name!=='string'||typeof r.address!=='string'||typeof r.inside!=='boolean'||!Number.isFinite(r.lon)||!Number.isFinite(r.lat)||Math.abs(r.lon)>180||Math.abs(r.lat)>90))throw Error('search coordinates');
 return {...data,results:data.results.slice(0,5)};
}
// Never persist Kakao search results in memory caches or browser storage.
export function createSearch({base='',mock=false,scenario='',fetcher=fetch}={}){
 return async (query,{signal}={})=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  signal?.addEventListener('abort',()=>controller.abort(),{once:true});
  try{
   if(mock&&scenario==='search_error')throw Error('mock 503');
   const fixtures=['search_ok','search_address_ok','search_empty','search_outside_area','search_outside_incheon'];
   const name=fixtures.includes(scenario)?scenario:/\d/.test(query)?'search_address_ok':'search_ok';
   const url=mock?`../shared/mock/next/${name}.json`:`${base}/api/search?${new URLSearchParams({q:query.trim()})}`;
   const response=await fetcher(url,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('search unavailable');
   return validateSearch(await response.json());
  }finally{clearTimeout(timer);}
 };
}
export function mountSearch(form,{inside,onSelect,base='',mock=false,scenario=''}){
 const input=form.querySelector('input'),status=form.querySelector('[role=status]'),list=element('ul',null,'search-results');form.append(list);
 const search=createSearch({base,mock,scenario});let pending=false,timer=0,live=null,turn=0;
 const stop=()=>{clearTimeout(timer);live?.abort();live=null;turn++;};
 const show=results=>list.replaceChildren(...results.map(result=>{const li=element('li'),button=element('button');button.type='button';button.append(element('strong',result.name),element('span',result.address));button.onclick=()=>choose(result);li.append(button);return li;}));
 const choose=result=>{stop();if(!result.inside||!inside([result.lon,result.lat])){status.textContent=SEARCH_MESSAGES.outside_area;return;}list.replaceChildren();input.value=result.name;status.textContent='';onSelect([result.lon,result.lat],result.name,guOf(result.address));};
 input.disabled=false;
 // 자동완성: 입력이 멈추면 후보만 띄운다. 이동은 고르거나 Enter일 때만, 상태 안내도 Enter일 때만. 결과는 저장하지 않는다
 input.addEventListener('input',()=>{
  stop();status.textContent='';const query=input.value.trim(),mine=turn;
  if(query.length<SUGGEST_MIN){list.replaceChildren();return;}
  timer=setTimeout(async()=>{
   live=new AbortController();
   try{const data=await search(query,{signal:live.signal});if(mine===turn)show(data.status==='ok'?data.results:[]);}
   catch{if(mine===turn)list.replaceChildren();}
  },SUGGEST_WAIT);
 });
 form.addEventListener('keydown',event=>{if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;const items=[input,...list.querySelectorAll('button')];if(items.length<2)return;event.preventDefault();const i=items.indexOf(document.activeElement);items[(i+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();});
 document.addEventListener('pointerdown',event=>{if(!form.contains(event.target)){stop();list.replaceChildren();}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();const query=input.value.trim();if(!query||pending)return;
  stop();pending=true;input.disabled=true;list.replaceChildren();status.textContent='찾고 있어요';
  try{
   const data=await search(query);
   if(data.status!=='ok'||!data.results.length){status.textContent=SEARCH_MESSAGES[data.status]||SEARCH_MESSAGES.empty;return;}
   if(data.results.length===1){choose(data.results[0]);return;}
   status.textContent='장소를 선택해 주세요.';
   show(data.results);
  }catch{status.textContent=SEARCH_MESSAGES.error;}
  finally{pending=false;input.disabled=false;input.focus();}
 });
}
