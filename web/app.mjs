import {saveView,takeView} from './view-state.mjs';
import {initEvidencePins,showEvidencePins,clearEvidencePins,restoreEvidenceView} from './evidence-pins.mjs';
import {renderFrameStatus,mountNotice,frameStatus,noticeFor,statusIcon} from './frame-status.mjs';
import {apiPath,expoLabel} from './expo.mjs';
import {mountSearch} from './search.mjs';
import {mountInference} from './infer.mjs';
import {renderEvidence} from './evidence.mjs';
import {GRADES,gradeOf,validValue,inside,gridLayout,cellAt,validateFrame,frameChanged,formatTime} from './core.mjs';
import {cloudImage,veilImage} from './render.mjs';
import {applyTheme,token} from './theme.mjs';
import {applyMapTheme} from './map-theme.mjs';
applyTheme();
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
let restored=null;
if(params.get('restore')==='1'||performance.getEntriesByType('navigation')[0]?.type==='back_forward'){try{restored=takeView(sessionStorage);}catch{}params.delete('restore');history.replaceState(null,'',location.pathname+(params.size?'?'+params:'')+location.hash);}
document.querySelectorAll('.about-link').forEach(a=>a.href=`about.html${location.search}`);
const expo=params.get('expo')==='1';
const syncNotice=mountNotice($('notice'));
const mock=params.get('mode')==='mock', scenario=params.get('scenario')||'day';
// API base is explicit; production defaults to same-origin and never silently uses mocks.
const base=(params.get('api')||'').replace(/\/$/,'');
let grid,layout,map,current,bounds,selection=null,selectionName=null,pointRequest=0,busy=false,timer,toastTimer;
let disposeInference=()=>{},inferenceBusy=false,liveNight=false;   // 전시 주소는 지도가 낮 회차라, 지금이 밤인지는 일반 응답으로 따로 본다
let mapLoaded,mapOk=false;const mapReady=new Promise(r=>mapLoaded=r);   // F16: 클릭·검색은 바로 받고, 지도 그리기만 load를 기다린다
let loadIssue='',healthIssue='',mapIssue='',health=null;
let baseLayers=[],veilArea=null,cameraDots=[],homeZoom=null;
// 크게 확대하면 도로·건물 위에 큰 제목이 겹치므로 물러난다
function syncClose(){document.body.classList.toggle('map-close',homeZoom!=null&&map.getZoom()>homeZoom+1.2);}
const empty={type:'FeatureCollection',features:[]};
const motion=1000;
$('mode').textContent=mock?'MOCK · 예시 데이터':'';
$('grades').innerHTML=`<div class="grade-bars">${GRADES.map(g=>`<i style="background:var(${g.token})"></i>`).join('')}</div><div class="grade-names">${GRADES.map(g=>`<span>${g.name} <small>${g.range}</small></span>`).join('')}</div>`;
function notify(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
async function json(url,{allow404=false}={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(r.status===404&&allow404)return null;if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json();}
 finally{clearTimeout(timeout);}
}
const fixture=name=>json(`../shared/mock/${name}.json`);
async function frameData(){
 if(!mock)return json(`${base}${apiPath('/api/frames/latest',{expo})}`,{allow404:true});
 if(scenario==='empty')return null;
 if(scenario==='legacy')return fixture('frames_latest');
 const names={night:'frames_latest_night',rain:'frames_latest_rain',few:'frames_latest_few',few_cameras:'frames_latest_few'};
 const frame=await fixture(`next/${expo?'frames_latest':names[scenario]||'frames_latest'}`);
 if(['humidity','no_data'].includes(scenario)&&!expo){const station=await fixture('next/frames_latest_rain');return {...station,reason:scenario};}
 return frame;
}
function showStatus(){
 const messages=[loadIssue,healthIssue,mapIssue];
 if(health?.stale){const age=current?Math.max(0,Math.floor((Date.now()-Date.parse(current.slot))/60000)):null;messages.push(mock?'갱신 지연 예시 · 40분 이상 새 추정값이 없습니다.':`갱신 지연 · ${age===null?'40분 이상':age+'분 전'} 값입니다.`);}
 $('status').textContent=messages.filter(Boolean).join('\n');$('status').hidden=!$('status').textContent;
}
function ago(t){const m=Math.round((Date.now()-Date.parse(t))/60000);return m<1?' · 방금':m<60?` · ${m}분 전`:m<1440?` · ${Math.floor(m/60)}시간 전`:` · ${Math.floor(m/1440)}일 전`;}function updateHeader(){
 if(!current){$('time').textContent=expo?expoLabel(null):'아직 값 없음';$('source').textContent='첫 데이터가 들어오면 바로 보여 드려요';return;}
 $('time').textContent=expo?expoLabel(current):`${formatTime(current.basis_time||current.slot)} 기준${ago(current.basis_time||current.slot)}`;
 // source=station can also mean daytime missing-camera fallback; do not infer night.
 if(!expo)syncNotice(current,!!selection);
 const short=frameStatus(current)?.short;$('top-status').textContent=short?`${short} · ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(current.basis_time||current.slot))}`:'';
 renderFrameStatus($('source'),current,current.source==='station'?`${mock&&scenario==='night'?'밤 · ':'밤·결측 대체 · '}측정소에서 잰 값을 이어 그렸어요${mock?' · 예시값':''}`:'CCTV 영상 기반 추정 · 20분 회차 / 1분마다 확인');
}
const cloud=()=>cloudImage(grid,current?.values||grid.cells.map(()=>null),layout,GRADES.map(g=>token(g.token)));
function draw(){if(map.getSource('cloud'))map.getSource('cloud').updateImage(cloud());}
// 첫 화면 카메라 점: 그 회차에 값이 있으면 깜빡이고, 없으면 흐리게 멈춘다. 예전 서버 응답(camera_ids 없음)은 지도 출처로 판단
function syncCameras(){
 const ids=current?.camera_ids,live=id=>Array.isArray(ids)?ids.includes(id):current?.source==='cctv';
 for(const c of cameraDots)c.element.classList.toggle('off',!live(c.id));
 const off=!current||current.source==='station',note=$('legend-cam');
 note.textContent=!off?'CCTV 위치':current?.reason==='night'?'CCTV 위치 · 밤에는 값이 없어 흐리게 멈춰요':'CCTV 위치 · 지금은 값이 없어 흐리게 멈춰요';note.parentElement.classList.toggle('off',off);
}
// 일몰을 지나면 화면과 지도 색을 함께 바꾼다
function syncTheme(){if(applyTheme()&&mapOk){applyMapTheme(map,baseLayers);map.getSource('outside')?.updateImage(veilImage(veilArea,bounds,token('--map-outside')));draw();}}
async function refresh(){
 if(busy||!grid)return;busy=true;syncTheme();
 try{
  const [f,h,l]=await Promise.allSettled([frameData(),mock?fixture(scenario==='stale'?'health_stale':'health'):json(`${base}/api/health`,{allow404:true}),expo&&!mock?json(`${base}/api/frames/latest`,{allow404:true}):null]);
  liveNight=mock?scenario==='night':l.value?.reason==='night';
  let changed=false;
  if(f.status==='fulfilled'){
   const next=f.value===null?null:validateFrame(f.value,grid.cells.length);
   changed=next===null?current!==null:frameChanged(current,next);current=next;loadIssue='';updateHeader();syncCameras();if(map?.getSource('cloud')&&changed)draw();
  }else{loadIssue='새 값을 가져오지 못했어요. 마지막 값을 보여 드려요';if(!current)$('time').textContent='데이터 연결 실패';}
  if(h.status==='fulfilled'&&h.value&&typeof h.value.stale==='boolean'){health=h.value;healthIssue='';}
  else{health=null;healthIssue='갱신 상태 확인 불가 · 상태 API 연결을 기다리고 있습니다.';}
  if(changed&&selection&&!inferenceBusy&&mapOk)void selectPoint(selection,false,selectionName);   // 지도가 뜨기 전 고른 곳은 그 요청이 끝까지 간다
 }catch(error){loadIssue=`데이터를 확인할 수 없습니다: ${error.message}`;}
 finally{busy=false;showStatus();}
}
function text(tag,content,cls){const el=document.createElement(tag);el.textContent=content;if(cls)el.className=cls;return el;}
function displayPoint(data){
 if(!expo&&data.estimate?.source==='station')data={...data,camera:null};   // 측정소 지도(밤·비·습도·카메라 부족)의 농도에는 CCTV 사진이 쓰이지 않는다
 const e=data.estimate?.pm25;$('panel').style.setProperty('--glow',validValue(e)?`var(${gradeOf(e).token})`:'transparent');
 const n=!data.camera&&data.estimate?.source==='station'?noticeFor(current):null,state=n&&frameStatus(current);
 renderEvidence($('details'),data,{mock,base,placeName:selectionName?.name,placeGu:selectionName?.gu,notice:n&&{...n,icon:state?statusIcon(state.path):null}});
 showEvidencePins(map,selection,data);
 if(expo&&data.estimate?.source!=='cctv')$('details').querySelector('.num-foot')?.prepend(text('p','전시용 CCTV 상세 미지원 · 응답에 표시된 기준 시각과 출처를 확인해 주세요.','expo-note'));
 if(data.camera)disposeInference=mountInference($('details').querySelector('.evidence-camera'),data.camera,{mock,base,scenario,expo,night:expo&&liveNight},value=>{inferenceBusy=value;});
}
async function getPoint(p){
 if(!mock)return json(`${base}${apiPath('/api/point',{expo,query:{lon:p[0],lat:p[1]}})}`,{allow404:true});
 const idx=cellAt(p,grid.cells,layout),cell=grid.cells[idx];
 // Only the supplied sample cell has a station comparison fixture. Never invent observations.
 const sample=await fixture(scenario==='fallback'?'next/point_fallback':scenario==='legacy'?'point_inside':'next/point_inside');
 return {inside:true,gu:cell?.gu,estimate:{pm25:idx<0?null:current?.values[idx]??null,slot:current?.slot,source:current?.source},station:cell?.grid_id===sample.grid_id?sample.station:null,camera:cell?.grid_id===sample.grid_id?sample.camera:null};
}
async function selectPoint(p,fly=true,placeName=null){
 if(!inside(p,grid.boundary)){notify('CCTV가 없는 곳(영종·강화·섬)은 추정하지 않아요. 인천 내륙과 송도를 눌러 주세요.');return;}
 disposeInference();if(!fly)restoreEvidenceView();clearEvidencePins();selection=p;selectionName=placeName;const request=++pointRequest;$('panel').hidden=false;$('hint').hidden=true;document.body.classList.add('has-selection');
 $('details').replaceChildren(text('div','선택한 위치','place'),text('p','농도를 확인하고 있어요'));
 const pending=getPoint(p);pending.catch(()=>{});await mapReady;if(request!==pointRequest)return;
 map.getSource('pick').setData({type:'Feature',properties:{},geometry:{type:'Point',coordinates:p}});
 document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');if(fly)map.flyTo({center:p,zoom:15.4,pitch:60,duration:motion,essential:true,padding:panelPad(true)});
 try{const data=await pending;if(request!==pointRequest)return;
  if(!data){$('details').replaceChildren(text('div','상세 정보 준비 중','place'),text('p','지점 상세 API가 아직 제공되지 않습니다. 지도에서는 최신 격자 분포를 확인할 수 있습니다.'));return;}
  if(!data.inside){$('details').replaceChildren(text('p','CCTV가 없는 곳(영종·강화·섬)은 추정하지 않아요. 인천 내륙과 송도를 눌러 주세요.'));return;}displayPoint(data);if(fly)settle();
 }catch{if(request===pointRequest)$('details').replaceChildren(text('div','상세 조회 실패','place'),text('p','연결을 확인하고 지도를 다시 눌러 주세요'));}
}
function closePanel(){disposeInference();clearEvidencePins();selection=null;selectionName=null;pointRequest++;$('panel').hidden=true;$('hint').hidden=false;document.body.classList.remove('has-selection');map?.getSource('pick')?.setData(empty);}
function fitZoom(center,pad){const save={center:map.getCenter(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing(),padding:map.getPadding()},pts=grid.boundary.coordinates.flat(2),c=map.getCanvas(),W=c.clientWidth,H=c.clientHeight;let lo=8,hi=15;for(let i=0;i<18;i++){const z=(lo+hi)/2;map.jumpTo({center,zoom:z,pitch:40,bearing:-12,padding:pad});pts.every(p=>{const q=map.project(p);return q.x>=pad.left&&q.x<=W-pad.right&&q.y>=pad.top&&q.y<=H-pad.bottom})?lo=z:hi=z;}map.jumpTo(save);return lo;}function panelPad(){
 const p=$('panel'),top=$('topbar').offsetHeight;   // 아래 판을 뺀 지도 칸의 가운데로 (올라오는 움직임 중에도 offsetHeight는 그대로다)
 return {top,bottom:Math.min(p.offsetHeight,innerHeight-top-100),left:0,right:0};
}
function settle(){const go=()=>{if(selection)map.easeTo({center:selection,padding:panelPad(),duration:300,essential:true});};map.isMoving()?map.once('moveend',go):go();}
function closeAndCenter(){const p=selection;closePanel();if(p)map.easeTo({center:p,padding:{top:0,bottom:0,left:0,right:0},duration:motion,essential:true});}
// 첫 화면: 왼쪽 제목·범례를 비켜 오른쪽 칸에 인천 전체를 넣는다
function homePad(){const c=map.getCanvas(),left=c.clientWidth>=1000?Math.min(620,c.clientWidth*.38):16;return {top:80,bottom:104,left,right:70};}
function home(){closePanel();const mobile=matchMedia('(max-width:700px)').matches,center=[126.69, 37.475],m=mobile?mobileHome():null,pad=mobile?{top:0,bottom:0,left:0,right:0}:homePad(),zoom=m?m.zoom:fitZoom(center,pad);homeZoom=zoom;map.easeTo({center:m?m.center:center,zoom,pitch:40,bearing:-12,padding:pad,duration:motion,essential:true});showView(false);}
function showView(flat){$('view-2d').setAttribute('aria-pressed',String(flat));$('view-3d').setAttribute('aria-pressed',String(!flat));}
function setView(flat){map.easeTo({pitch:flat?0:40,duration:motion,essential:true});showView(flat);}
// 휴대폰 첫 화면(F26): 구도(pitch 40, bearing -12)는 그대로, 본체가 다 들어가는 줌보다 조금(+0.25) 크게,
// 바탕 지도의 "인천광역시" 글자 자리를 지도가 보이는 칸(위 카드 아래 ~ 출처 줄 위)의 가운데로. 송도 끝은 조금 잘린다
const INCHEON_LABEL=[126.7052,37.4563];
function mobileHome(){
  const c=map.getCanvas(),W=c.clientWidth,H=c.clientHeight;
  const pad={top:$('title').getBoundingClientRect().bottom+8,bottom:H-$('legend').getBoundingClientRect().top+8,left:8,right:8};   // 위 제목과 아래 범례 사이
  const pts=grid.boundary.coordinates.filter(p=>p[0].length>100).flat(2);   // 방파제 같은 가는 조각은 빼고 본체만
  const save={center:map.getCenter(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing()};
  const at=(center,zoom)=>map.jumpTo({center,zoom,pitch:40,bearing:-12,padding:{top:0,bottom:0,left:0,right:0}});
  const fits=()=>pts.every(p=>{const q=map.project(p);return q.x>=pad.left&&q.x<=W-pad.right&&q.y>=pad.top&&q.y<=H-pad.bottom;});
  const fitZ=center=>{let lo=8,hi=15;for(let i=0;i<18;i++){const z=(lo+hi)/2;at(center,z);fits()?lo=z:hi=z;}return lo;};
  const cx=(pad.left+W-pad.right)/2,cy=(pad.top+H-pad.bottom)/2;
  let center=[126.684,37.491];
  for(let k=0;k<4;k++){   // 본체가 칸 가운데 오게 맞춰 가며 들어가는 가장 큰 줌
    at(center,fitZ(center));const q=pts.map(p=>map.project(p)),xs=q.map(v=>v.x),ys=q.map(v=>v.y);
    const m=map.unproject([W/2+(Math.min(...xs)+Math.max(...xs))/2-cx,H/2+(Math.min(...ys)+Math.max(...ys))/2-cy]);center=[m.lng,m.lat];
  }
  const zoom=fitZ(center)+0.25;
  at(INCHEON_LABEL,zoom);const m=map.unproject([W-cx,H-cy]);   // 글자 자리가 칸 가운데 오는 중심
  map.jumpTo(save);
  return {center:[m.lng,m.lat],zoom};
}
function toggleSearch(open){
 document.body.classList.toggle('search-open',open);$('search-toggle').setAttribute('aria-expanded',String(open));$('search-toggle').setAttribute('aria-label',open?'장소 검색 닫기':'장소 검색 열기');
 if(open)$('place-query').focus();else $('search-toggle').focus();
}
function wire(){
 $('search-toggle').onclick=()=>toggleSearch(!document.body.classList.contains('search-open'));
 $('place-search').addEventListener('keydown',event=>{if(event.key==='Escape'&&matchMedia('(max-width:700px)').matches){event.stopPropagation();toggleSearch(false);}});
 document.addEventListener('click',event=>{const a=event.target.closest('a');if(!a||!mapOk)return;const u=new URL(a.href,location.href);if(u.origin===location.origin&&u.pathname.endsWith('/about.html')){const c=map.getCenter();try{saveView(sessionStorage,{center:[c.lng,c.lat],zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing(),padding:map.getPadding(),selection,name:null});}catch{}}});
 void mountSearch($('place-search'),{base,mock,scenario,inside:p=>inside(p,grid.boundary),onSelect:(p,name,gu)=>{void selectPoint(p,true,{name,gu});if(matchMedia('(max-width:700px)').matches)toggleSearch(false);}});
 $('reset').onclick=home;$('close').onclick=closeAndCenter;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selection)closeAndCenter();});
 $('view-2d').onclick=()=>setView(true);$('view-3d').onclick=()=>setView(false);
 $('zoom-in').onclick=()=>map.zoomIn({duration:300,essential:true});$('zoom-out').onclick=()=>map.zoomOut({duration:300,essential:true});
 $('location').onclick=()=>{if(!navigator.geolocation){notify('이 브라우저에서는 위치를 확인할 수 없어요');return;}navigator.geolocation.getCurrentPosition(pos=>{void selectPoint([pos.coords.longitude,pos.coords.latitude]);const a=pos.coords.accuracy;if(a>500)notify(`PC에서는 위치가 부정확할 수 있어요 (오차 약 ${a>=1000?(a/1000).toFixed(1)+'km':Math.round(a)+'m'})`);},()=>notify('위치를 확인하지 못했어요. 위치 권한을 확인하거나 지도를 눌러 주세요'),{timeout:10000,maximumAge:60000});};
}
async function start(){
 try{
  [grid]=await Promise.all([mock?fixture('grid'):json(`${base}/api/grid`)]);layout=gridLayout(grid.cells);
  const boundary=await json('../shared/boundary.geojson'),cameras=await json('../shared/cameras.json').then(d=>d.cameras).catch(()=>[]),simple=boundary.features.find(f=>f.properties.kind==='simple'),outline=boundary.features.find(f=>f.properties.kind==='outline'),display=boundary.features.find(f=>f.properties.kind==='display');
  const coords=grid.boundary.coordinates.flat(2);bounds=[[Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1]))],[Math.max(...coords.map(p=>p[0])),Math.max(...coords.map(p=>p[1]))]];
  if(!window.maplibregl)throw Error('지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  const phone=matchMedia('(max-width:700px)').matches,dx=phone?.6:.25,dy=phone?.45:.15;   // F26: 좁은 세로 화면은 범위를 넓혀야 인천 전체가 들어갈 만큼 축소된다
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',bounds,pitch:40,bearing:-12,maxBounds:[[bounds[0][0]-dx,bounds[0][1]-dy],[bounds[1][0]+dx,bounds[1][1]+dy]],locale:{'NavigationControl.ZoomIn':'확대','NavigationControl.ZoomOut':'축소','NavigationControl.ResetBearing':'북쪽을 위로','AttributionControl.ToggleAttribution':'출처 보기','Map.Title':'인천 초미세먼지 지도'},attributionControl:{compact:phone,customAttribution:'추정: 인천교통정보센터 CCTV · 실측: 에어코리아(인증 전 실시간 자료) · 행정경계: 통계청 SGIS (vuski/admdongkor, CC BY 4.0)'}});
  const foldAttrib=()=>{if(phone)document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');};foldAttrib();   // F25: 휴대폰은 출처를 (i) 안에 접어 둔다
  map.on('click',e=>void selectPoint([e.lngLat.lng,e.lngLat.lat]));wire();
  map.on('error',()=>{mapIssue='지도 일부를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.';showStatus();});
  // 클릭 확대 중 지나간 화면의 조각이 실패해도 지금 보이는 조각이 다 받아졌으면 경고를 지운다. 보이는 조각이 실패했으면 남긴다
  // (sourceCaches._tiles는 MapLibre 내부 값이라 버전을 올리면 확인할 것. 지금 4.7.1)
  map.on('idle',()=>{if(mapIssue&&!Object.values(map.style?.sourceCaches||{}).some(c=>Object.values(c._tiles||{}).some(t=>t.state==='errored'))){mapIssue='';showStatus();}});
  map.once('style.load',()=>{baseLayers=map.getStyle().layers.slice();applyMapTheme(map,baseLayers);});   // 바탕 지도의 원래 색이 비치지 않게 그리기 전에 칠한다
  map.on('load',()=>{
   foldAttrib();
   for(const l of map.getStyle().layers.filter(l=>l.type==='symbol')){
    if(/shield/.test(l.id)){map.removeLayer(l.id);continue;}
    map.setFilter(l.id,l.filter?['all',l.filter,['within',simple.geometry]]:['within',simple.geometry]);
   }
   for(const [id,z] of [['highway-name-major',11],['highway-name-minor',12],['poi_transit',11],['poi_r1',12],['poi_r7',12],['poi_r20',12]])if(map.getLayer(id))map.setLayerZoomRange(id,z,24);const layers=map.getStyle().layers,labels=layers.find((l,i)=>l.type==='symbol'&&layers.slice(i).every(m=>m.type==='symbol'))?.id;
   veilArea=display?.geometry||grid.boundary;
   map.addSource('outside',{type:'image',...veilImage(veilArea,bounds,token('--map-outside'))});
   map.addLayer({id:'outside',type:'raster',source:'outside',paint:{'raster-fade-duration':0}},labels);
   
   map.addSource('cloud',{type:'image',...cloud()});
   const building=layers.find(l=>l.type==='fill-extrusion')?.id;
   map.addLayer({id:'cloud',type:'raster',source:'cloud',paint:{'raster-opacity':['interpolate',['linear'],['zoom'],10,.9,15,.5,17,.25],'raster-fade-duration':0}},building||labels);
   initEvidencePins(map,{mock,base});
   map.addSource('pick',{type:'geojson',data:empty});map.addLayer({id:'pick',type:'circle',source:'pick',paint:{'circle-radius':7,'circle-color':token('--ink'),'circle-stroke-color':token('--surf'),'circle-stroke-width':3}});
   cameraDots=cameras.filter(c=>c.grid_id!=null&&Number.isFinite(c.lon)&&Number.isFinite(c.lat)).map((c,i)=>{const element=document.createElement('div');element.className='cam';element.style.setProperty('--d',`${(i*7)%19*.13}s`);new maplibregl.Marker({element,anchor:'center'}).setLngLat([c.lon,c.lat]).addTo(map);return {id:c.camera_id,element};});syncCameras();
   map.on('zoom',syncClose);
   const hadRestored=!!restored;
   $('hint').textContent='궁금한 곳을 눌러 보세요';if(restored){map.jumpTo({center:restored.center,zoom:restored.zoom,pitch:restored.pitch,bearing:restored.bearing,padding:restored.padding||{top:0,bottom:0,left:0,right:0}});showView(restored.pitch===0);}else if(selection)showView(false);else home();mapOk=true;mapLoaded();document.body.classList.add('map-ready');   // 칠하기 전 바탕 지도가 비치지 않게 이때 보여 준다
  
   if(restored?.selection)void selectPoint(restored.selection,false,restored.name);restored=null;   // 지도가 뜨기 전에 이미 고른 곳이 있으면 첫 화면으로 되돌리지 않는다
   if(mock&&params.has('sample')&&!hadRestored&&!selection){void fixture('point_inside').then(sample=>{const cell=grid.cells.find(c=>c.grid_id===sample.grid_id);if(cell)void selectPoint(cell.center);});}
  });
  await refresh();timer=setInterval(()=>void refresh(),60000);
 }catch(e){loadIssue=`화면을 불러오지 못했어요. ${e.message}`;showStatus();}
}
addEventListener('pagehide',()=>{disposeInference();clearInterval(timer);clearTimeout(toastTimer);});void start();

addEventListener('pageshow',event=>{if(event.persisted){clearInterval(timer);timer=setInterval(()=>void refresh(),60000);if(selection)void selectPoint(selection,false,selectionName);}});
