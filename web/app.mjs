import {renderFrameStatus} from './frame-status.mjs';
import {apiPath,expoLabel} from './expo.mjs';
import {mountSearch} from './search.mjs';
import {mountInference} from './infer.mjs';
import {renderEvidence} from './evidence.mjs';
import {GRADES,gradeOf,rgb,validValue,inside,gridLayout,cellAt,validateFrame,frameChanged,formatTime} from './core.mjs';
import {cloudImage,veilImage} from './render.mjs';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
$('about-link').href=`about.html${location.search}`;
const expo=params.get('expo')==='1';
const mock=params.get('mode')==='mock', scenario=params.get('scenario')||'day';
// API base is explicit; production defaults to same-origin and never silently uses mocks.
const base=(params.get('api')||'').replace(/\/$/,'');
let grid,layout,map,current,bounds,selection=null,selectionName=null,pointRequest=0,busy=false,timer,toastTimer;
let disposeInference=()=>{},inferenceBusy=false;
let mapLoaded,mapOk=false;const mapReady=new Promise(r=>mapLoaded=r);   // F16: 클릭·검색은 바로 받고, 지도 그리기만 load를 기다린다
let loadIssue='',healthIssue='',mapIssue='',health=null;
const empty={type:'FeatureCollection',features:[]};
const motion=1000;
$('mode').textContent=mock?'MOCK · 예시 데이터':'';
$('grades').innerHTML=GRADES.map(g=>`<span><i style="background:${rgb(g.dark)}"></i>${g.name}<small>${g.range}</small></span>`).join('');
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
 if(!current){$('time').textContent=expo?expoLabel(null):'아직 값 없음';$('source').textContent='첫 데이터가 들어오면 자동으로 표시합니다.';return;}
 $('time').textContent=expo?expoLabel(current):`${formatTime(current.basis_time||current.slot)} 기준${ago(current.basis_time||current.slot)}`;
 // source=station can also mean daytime missing-camera fallback; do not infer night.
 renderFrameStatus($('source'),current,current.source==='station'?`${mock&&scenario==='night'?'밤 · ':'밤·결측 대체 · '}측정소 실측 기반 보간${mock?' · 예시값':''}`:'CCTV 영상 기반 추정 · 20분 회차 / 1분마다 확인');
}
function draw(){const image=cloudImage(grid,current?.values||grid.cells.map(()=>null),layout);if(map.getSource('cloud'))map.getSource('cloud').updateImage(image);}
async function refresh(){
 if(busy||!grid)return;busy=true;
 try{
  const [f,h]=await Promise.allSettled([frameData(),mock?fixture(scenario==='stale'?'health_stale':'health'):json(`${base}/api/health`,{allow404:true})]);
  let changed=false;
  if(f.status==='fulfilled'){
   const next=f.value===null?null:validateFrame(f.value,grid.cells.length);
   changed=next===null?current!==null:frameChanged(current,next);current=next;loadIssue='';updateHeader();if(map?.getSource('cloud')&&changed)draw();
  }else{loadIssue='데이터 갱신 실패 · 마지막 정상값을 표시합니다. 새로고침으로 다시 시도하세요.';if(!current)$('time').textContent='데이터 연결 실패';}
  if(h.status==='fulfilled'&&h.value&&typeof h.value.stale==='boolean'){health=h.value;healthIssue='';}
  else{health=null;healthIssue='갱신 상태 확인 불가 · 상태 API 연결을 기다리고 있습니다.';}
  if(changed&&selection&&!inferenceBusy&&mapOk)void selectPoint(selection,false,selectionName);   // 지도가 뜨기 전 고른 곳은 그 요청이 끝까지 간다
 }catch(error){loadIssue=`데이터를 확인할 수 없습니다: ${error.message}`;}
 finally{busy=false;showStatus();}
}
function text(tag,content,cls){const el=document.createElement(tag);el.textContent=content;if(cls)el.className=cls;return el;}
function displayPoint(data){
 renderEvidence($('details'),data,{mock,base,placeName:selectionName});
 if(expo&&data.estimate?.source!=='cctv')$('details').prepend(text('p','전시용 CCTV 상세 미지원 · 응답에 표시된 기준 시각과 출처를 확인해 주세요.','expo-note'));
 if(data.camera)disposeInference=mountInference($('details').querySelector('.evidence-camera'),data.camera,{mock,base,scenario},value=>{inferenceBusy=value;});
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
 disposeInference();selection=p;selectionName=placeName;const request=++pointRequest;$('panel').hidden=false;$('hint').hidden=true;
 $('details').replaceChildren(text('div','선택한 위치','place'),text('p','농도와 측정소 정보를 확인하고 있습니다…'));
 const pending=getPoint(p);pending.catch(()=>{});await mapReady;if(request!==pointRequest)return;
 map.getSource('pick').setData({type:'Feature',properties:{},geometry:{type:'Point',coordinates:p}});
 document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');if(fly)map.flyTo({center:p,zoom:15.4,pitch:60,duration:motion,essential:true,padding:panelPad(true)});
 try{const data=await pending;if(request!==pointRequest)return;
  if(!data){$('details').replaceChildren(text('div','상세 정보 준비 중','place'),text('p','지점 상세 API가 아직 제공되지 않습니다. 지도에서는 최신 격자 분포를 확인할 수 있습니다.'));return;}
  if(!data.inside){$('details').replaceChildren(text('p','CCTV가 없는 곳(영종·강화·섬)은 추정하지 않아요. 인천 내륙과 송도를 눌러 주세요.'));return;}displayPoint(data);if(fly)settle();
 }catch{if(request===pointRequest)$('details').replaceChildren(text('div','상세 조회 실패','place'),text('p','연결을 확인하고 지도에서 다시 선택해 주세요.'));}
}
function closePanel(){disposeInference();selection=null;selectionName=null;pointRequest++;$('panel').hidden=true;$('hint').hidden=false;map?.getSource('pick')?.setData(empty);}
function fitZoom(center,pad){const save={center:map.getCenter(),zoom:map.getZoom(),pitch:map.getPitch(),bearing:map.getBearing(),padding:map.getPadding()},pts=grid.boundary.coordinates.flat(2),c=map.getCanvas(),W=c.clientWidth,H=c.clientHeight;let lo=8,hi=15;for(let i=0;i<18;i++){const z=(lo+hi)/2;map.jumpTo({center,zoom:z,pitch:40,bearing:-12,padding:{top:0,bottom:0,left:0,right:0}});pts.every(p=>{const q=map.project(p);return q.x>=pad.left&&q.x<=W-pad.right&&q.y>=pad.top&&q.y<=H-pad.bottom})?lo=z:hi=z;}map.jumpTo(save);return lo;}function panelPad(estimate){const p=$('panel');return matchMedia('(max-width:700px)').matches?{top:$('legend').getBoundingClientRect().bottom,left:0,right:0,bottom:(estimate?Math.max(p.offsetHeight,innerHeight*.42):p.offsetHeight)+parseFloat(getComputedStyle(p).bottom)}:{top:0,bottom:(estimate?Math.max(p.offsetHeight,innerHeight*.35):p.offsetHeight)+parseFloat(getComputedStyle(p).bottom),left:0,right:0};}function settle(){const go=()=>{if(selection)map.easeTo({padding:panelPad(false),duration:300,essential:true});};map.isMoving()?map.once('moveend',go):go();}function closeAndCenter(){const p=selection;closePanel();if(p)map.easeTo({center:p,padding:{top:0,bottom:0,left:0,right:0},duration:motion,essential:true});}function home(){closePanel();const mobile=matchMedia('(max-width:700px)').matches,center=[126.69, 37.475],m=mobile?mobileHome():null;map.easeTo({center:m?m.center:center,zoom:m?m.zoom:fitZoom(center,{top:16,bottom:40,left:16,right:70}),pitch:40,bearing:-12,padding:{top:0,bottom:0,left:0,right:0},duration:motion,essential:true});showView(false);}
function showView(flat){$('view-2d').setAttribute('aria-pressed',String(flat));$('view-3d').setAttribute('aria-pressed',String(!flat));}
function setView(flat){map.easeTo({pitch:flat?0:40,duration:motion,essential:true});showView(flat);}
// 휴대폰 첫 화면(F26): 구도(pitch 40, bearing -12)는 그대로, 본체가 다 들어가는 줌보다 조금(+0.25) 크게,
// 바탕 지도의 "인천광역시" 글자 자리를 지도가 보이는 칸(위 카드 아래 ~ 출처 줄 위)의 가운데로. 송도 끝은 조금 잘린다
const INCHEON_LABEL=[126.7052,37.4563];
function mobileHome(){
  const c=map.getCanvas(),W=c.clientWidth,H=c.clientHeight;
  const cards=['title','legend','place-search'].map(id=>$(id)).filter(e=>e&&e.getClientRects().length);
  const pad={top:Math.max(...cards.map(e=>e.getBoundingClientRect().bottom))+8,bottom:48,left:8,right:8};   // 오른쪽 버튼 밑까지 허용
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
function wire(){
 void mountSearch($('place-search'),{base,mock,scenario,inside:p=>inside(p,grid.boundary),onSelect:(p,name)=>void selectPoint(p,true,name)});
 $('reset').onclick=home;$('close').onclick=closeAndCenter;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&selection)closeAndCenter();});
 $('view-2d').onclick=()=>setView(true);$('view-3d').onclick=()=>setView(false);
 $('retry').onclick=()=>{if(mapIssue)location.reload();else void refresh();};
 $('location').onclick=()=>{if(!navigator.geolocation){notify('이 브라우저에서는 위치를 확인할 수 없습니다.');return;}navigator.geolocation.getCurrentPosition(pos=>{void selectPoint([pos.coords.longitude,pos.coords.latitude]);const a=pos.coords.accuracy;if(a>500)notify(`PC에서는 위치가 부정확할 수 있어요 (오차 약 ${a>=1000?(a/1000).toFixed(1)+'km':Math.round(a)+'m'})`);},()=>notify('위치를 확인하지 못했습니다. 위치 권한을 확인하거나 지도에서 선택해 주세요.'),{timeout:10000,maximumAge:60000});};
}
async function start(){
 try{
  [grid]=await Promise.all([mock?fixture('grid'):json(`${base}/api/grid`)]);layout=gridLayout(grid.cells);
  const boundary=await json('../shared/boundary.geojson'),simple=boundary.features.find(f=>f.properties.kind==='simple'),outline=boundary.features.find(f=>f.properties.kind==='outline'),display=boundary.features.find(f=>f.properties.kind==='display');
  const coords=grid.boundary.coordinates.flat(2);bounds=[[Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1]))],[Math.max(...coords.map(p=>p[0])),Math.max(...coords.map(p=>p[1]))]];
  if(!window.maplibregl)throw Error('지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  const phone=matchMedia('(max-width:700px)').matches,dx=phone?.6:.25,dy=phone?.45:.15;   // F26: 좁은 세로 화면은 범위를 넓혀야 인천 전체가 들어갈 만큼 축소된다
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',bounds,pitch:40,bearing:-12,maxBounds:[[bounds[0][0]-dx,bounds[0][1]-dy],[bounds[1][0]+dx,bounds[1][1]+dy]],locale:{'NavigationControl.ZoomIn':'확대','NavigationControl.ZoomOut':'축소','NavigationControl.ResetBearing':'북쪽을 위로','AttributionControl.ToggleAttribution':'출처 보기','Map.Title':'인천 초미세먼지 지도'},attributionControl:{compact:true,customAttribution:'추정: 인천교통정보센터 CCTV · 실측: 에어코리아(인증 전 실시간 자료) · 행정경계: 통계청 SGIS (vuski/admdongkor, CC BY 4.0)'}});
  const foldAttrib=()=>{if(phone)document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');};foldAttrib();   // F25: 휴대폰은 출처를 (i) 안에 접어 둔다
  map.on('click',e=>void selectPoint([e.lngLat.lng,e.lngLat.lat]));wire();
  map.addControl(new maplibregl.NavigationControl(),'top-right');{const ab=document.querySelector('.maplibregl-ctrl-bottom-right');if(ab)new ResizeObserver(()=>document.documentElement.style.setProperty('--attrib-h',ab.offsetHeight+'px')).observe(ab);}
  map.on('error',()=>{mapIssue='지도 일부를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.';showStatus();});
  // 클릭 확대 중 지나간 화면의 조각이 실패해도 지금 보이는 조각이 다 받아졌으면 경고를 지운다. 보이는 조각이 실패했으면 남긴다
  // (sourceCaches._tiles는 MapLibre 내부 값이라 버전을 올리면 확인할 것. 지금 4.7.1)
  map.on('idle',()=>{if(mapIssue&&!Object.values(map.style?.sourceCaches||{}).some(c=>Object.values(c._tiles||{}).some(t=>t.state==='errored'))){mapIssue='';showStatus();}});
  map.on('load',()=>{
   foldAttrib();
   for(const l of map.getStyle().layers.filter(l=>l.type==='symbol')){
    if(/shield/.test(l.id)){map.removeLayer(l.id);continue;}
    map.setFilter(l.id,l.filter?['all',l.filter,['within',simple.geometry]]:['within',simple.geometry]);
   }
   for(const [id,z] of [['highway-name-major',11],['highway-name-minor',12],['poi_transit',11],['poi_r1',12],['poi_r7',12],['poi_r20',12]])if(map.getLayer(id))map.setLayerZoomRange(id,z,24);const layers=map.getStyle().layers,labels=layers.find((l,i)=>l.type==='symbol'&&layers.slice(i).every(m=>m.type==='symbol'))?.id;
   map.addSource('outside',{type:'image',...veilImage(display?.geometry||grid.boundary,bounds)});
   map.addLayer({id:'outside',type:'raster',source:'outside',paint:{'raster-fade-duration':0}},labels);
   
   map.addSource('cloud',{type:'image',...cloudImage(grid,current?.values||grid.cells.map(()=>null),layout)});
   const building=layers.find(l=>l.type==='fill-extrusion')?.id;
   map.addLayer({id:'cloud',type:'raster',source:'cloud',paint:{'raster-opacity':['interpolate',['linear'],['zoom'],10,.9,15,.5,17,.25],'raster-fade-duration':0}},building||labels);
   map.addSource('pick',{type:'geojson',data:empty});map.addLayer({id:'pick',type:'circle',source:'pick',paint:{'circle-radius':7,'circle-color':'#235954','circle-stroke-color':'#fff','circle-stroke-width':3}});
   $('hint').textContent='궁금한 곳을 눌러 농도를 확인하세요';if(selection)showView(false);else home();mapOk=true;mapLoaded();   // 지도가 뜨기 전에 이미 고른 곳이 있으면 첫 화면으로 되돌리지 않는다
   if(mock&&params.has('sample')){void fixture('point_inside').then(sample=>{const cell=grid.cells.find(c=>c.grid_id===sample.grid_id);if(cell)void selectPoint(cell.center);});}
  });
  await refresh();timer=setInterval(()=>void refresh(),60000);
 }catch(e){loadIssue=`화면을 불러올 수 없습니다. ${e.message}`;showStatus();$('retry').onclick=()=>location.reload();}
}
addEventListener('pagehide',()=>{disposeInference();clearInterval(timer);clearTimeout(toastTimer);});void start();
