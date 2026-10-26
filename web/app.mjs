import {GRADES,gradeOf,rgb,validValue,inside,gridLayout,cellAt,validateFrame,frameChanged,formatTime} from './core.mjs';
import {cloudImage,veilImage} from './render.mjs';
const $=id=>document.getElementById(id), params=new URLSearchParams(location.search);
const mock=params.get('mode')==='mock', scenario=params.get('scenario')||'day';
// API base is explicit; production defaults to same-origin and never silently uses mocks.
const base=(params.get('api')||'').replace(/\/$/,'');
let grid,layout,map,current,bounds,selection=null,pointRequest=0,busy=false,timer,toastTimer;
let loadIssue='',healthIssue='',mapIssue='',health=null;
const empty={type:'FeatureCollection',features:[]};
const motion=matchMedia('(prefers-reduced-motion: reduce)').matches?0:1000;
$('mode').textContent=mock?'MOCK · 예시 데이터':'';
$('grades').innerHTML=GRADES.map(g=>`<span><i style="background:${rgb(g.dark)}"></i>${g.name}<small>${g.range}</small></span>`).join('');
function notify(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4500);}
async function json(url,{allow404=false}={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});if(r.status===404&&allow404)return null;if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json();}
 finally{clearTimeout(timeout);}
}
const fixture=name=>json(`../shared/mock/${name}.json`);
async function frameData(){if(mock)return scenario==='empty'?null:fixture(scenario==='night'?'frames_latest_night':'frames_latest');return json(`${base}/api/frames/latest`,{allow404:true});}
function showStatus(){
 const messages=[loadIssue,healthIssue,mapIssue];
 if(health?.stale){const age=current?Math.max(0,Math.floor((Date.now()-Date.parse(current.slot))/60000)):null;messages.push(mock?'갱신 지연 예시 · 40분 이상 새 추정값이 없습니다.':`갱신 지연 · ${age===null?'40분 이상':age+'분 전'} 값입니다.`);}
 $('status').textContent=messages.filter(Boolean).join('\n');$('status').hidden=!$('status').textContent;
}
function updateHeader(){
 if(!current){$('time').textContent='아직 값 없음';$('source').textContent='첫 데이터가 들어오면 자동으로 표시합니다.';return;}
 $('time').textContent=`${formatTime(current.basis_time||current.slot)} 기준`;
 // source=station can also mean daytime missing-camera fallback; do not infer night.
 $('source').textContent=current.source==='station'?`${mock&&scenario==='night'?'밤 · ':'밤·결측 대체 · '}측정소 실측 기반 보간${mock?' · 예시값':''}`:'CCTV 영상 기반 추정 · 20분 회차 / 1분마다 확인';
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
  if(changed&&selection)void selectPoint(selection,false);
 }catch(error){loadIssue=`데이터를 확인할 수 없습니다: ${error.message}`;}
 finally{busy=false;showStatus();}
}
function text(tag,content,cls){const el=document.createElement(tag);el.textContent=content;if(cls)el.className=cls;return el;}
function displayPoint(data){
 const host=$('details');host.replaceChildren();
 host.append(text('div',`${data.gu||'선택한 위치'} 부근`,'place'));
 const e=data.estimate,v=e?.pm25,valid=validValue(v),g=valid?gradeOf(v):null;
 const number=text('div',valid?String(Math.round(v)):'—','value');number.append(text('small','㎍/㎥'));host.append(number);
 const badge=text('span',g?.name||'값 없음','badge');badge.style.background=g?rgb(g.light):'#e5eae9';host.append(badge);
 host.append(text('p',`${e?.source==='station'?'측정소 실측 기반 보간':'CCTV 기반 추정'} · ${formatTime(e?.slot)}`));
 host.append(document.createElement('hr'),text('p','가까운 측정소 실측'));
 const s=data.station;
 if(s){host.append(text('div',`${s.name} · ${validValue(s.pm25)?Math.round(s.pm25)+' ㎍/㎥':'값 없음'}`,'station'),text('p',`${formatTime(s.data_time)} · ${s.period||'평균 시간 정보 없음'}${Number.isFinite(s.distance_km)?' · '+s.distance_km.toFixed(1)+'km':''}`));}
 else host.append(text('p','측정소 실측값을 아직 제공하지 않습니다.'));
 host.append(text('p','추정 농도와 측정소 실측값은 위치와 평균 시간이 달라 차이가 날 수 있습니다.'));
 if(mock)host.append(text('p','MOCK: 격자 추정값을 사용합니다. 측정소 실측은 예시이며 클릭 위치의 실제 관측이 아닙니다.'));
}
async function getPoint(p){
 if(!mock)return json(`${base}/api/point?${new URLSearchParams({lon:p[0],lat:p[1]})}`,{allow404:true});
 const idx=cellAt(p,grid.cells,layout),cell=grid.cells[idx];
 // Only the supplied sample cell has a station comparison fixture. Never invent observations.
 const sample=await fixture('point_inside');
 return {inside:true,gu:cell?.gu,estimate:{pm25:idx<0?null:current?.values[idx]??null,slot:current?.slot,source:current?.source},station:cell?.grid_id===sample.grid_id?sample.station:null};
}
async function selectPoint(p,fly=true){
 if(!inside(p,grid.boundary)){notify('인천 내륙과 송도 안의 위치를 선택해 주세요.');return;}
 selection=p;const request=++pointRequest;$('panel').hidden=false;$('hint').hidden=true;
 $('details').replaceChildren(text('div','선택한 위치','place'),text('p','농도와 측정소 정보를 확인하고 있습니다…'));
 map.getSource('pick').setData({type:'Feature',properties:{},geometry:{type:'Point',coordinates:p}});
 if(fly)map.flyTo({center:p,zoom:15.4,pitch:60,duration:motion});
 try{const data=await getPoint(p);if(request!==pointRequest)return;
  if(!data){$('details').replaceChildren(text('div','상세 정보 준비 중','place'),text('p','지점 상세 API가 아직 제공되지 않습니다. 지도에서는 최신 격자 분포를 확인할 수 있습니다.'));return;}
  if(!data.inside){$('details').replaceChildren(text('p','서비스 범위 밖입니다.'));return;}displayPoint(data);
 }catch{if(request===pointRequest)$('details').replaceChildren(text('div','상세 조회 실패','place'),text('p','연결을 확인하고 지도에서 다시 선택해 주세요.'));}
}
function closePanel(){selection=null;pointRequest++;$('panel').hidden=true;$('hint').hidden=false;map?.getSource('pick')?.setData(empty);}
function home(){closePanel();map.fitBounds(bounds,{padding:matchMedia('(max-width:700px)').matches?{top:170,bottom:180,left:35,right:45}:{top:165,bottom:170,left:70,right:70},pitch:40,bearing:-12,duration:motion});$('view').textContent='2D 보기';$('view').setAttribute('aria-pressed','false');}
function wire(){
 $('reset').onclick=home;$('close').onclick=closePanel;document.addEventListener('keydown',e=>{if(e.key==='Escape')closePanel();});
 $('view').onclick=()=>{const flat=map.getPitch()>0;map.easeTo({pitch:flat?0:40,duration:motion});$('view').textContent=flat?'3D 보기':'2D 보기';$('view').setAttribute('aria-pressed',String(flat));};
 $('retry').onclick=()=>{if(mapIssue)location.reload();else void refresh();};
 $('location').onclick=()=>{if(!navigator.geolocation){notify('이 브라우저에서는 위치를 확인할 수 없습니다.');return;}navigator.geolocation.getCurrentPosition(pos=>void selectPoint([pos.coords.longitude,pos.coords.latitude]),()=>notify('위치를 확인하지 못했습니다. 위치 권한을 확인하거나 지도에서 선택해 주세요.'),{timeout:10000,maximumAge:60000});};
}
async function start(){
 try{
  [grid]=await Promise.all([mock?fixture('grid'):json(`${base}/api/grid`)]);layout=gridLayout(grid.cells);
  const boundary=await json('../shared/boundary.geojson'),simple=boundary.features.find(f=>f.properties.kind==='simple'),outline=boundary.features.find(f=>f.properties.kind==='outline');
  const coords=grid.boundary.coordinates.flat(2);bounds=[[Math.min(...coords.map(p=>p[0])),Math.min(...coords.map(p=>p[1]))],[Math.max(...coords.map(p=>p[0])),Math.max(...coords.map(p=>p[1]))]];
  if(!window.maplibregl)throw Error('지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
  map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',bounds,pitch:40,bearing:-12,maxBounds:[[bounds[0][0]-.25,bounds[0][1]-.15],[bounds[1][0]+.25,bounds[1][1]+.15]],attributionControl:{compact:true,customAttribution:'추정: 인천교통정보센터 CCTV · 실측: 에어코리아 · 행정경계: 통계청 SGIS (vuski/admdongkor, CC BY 4.0)'}});
  map.addControl(new maplibregl.NavigationControl(),'top-right');
  map.on('error',()=>{mapIssue='지도 일부를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.';showStatus();});
  map.on('load',()=>{
   for(const l of map.getStyle().layers.filter(l=>l.type==='symbol')){
    if(/shield/.test(l.id)){map.removeLayer(l.id);continue;}
    map.setFilter(l.id,l.filter?['all',l.filter,['within',simple.geometry]]:['within',simple.geometry]);
   }
   const layers=map.getStyle().layers,labels=layers.find((l,i)=>l.type==='symbol'&&layers.slice(i).every(m=>m.type==='symbol'))?.id;
   map.addSource('outside',{type:'image',...veilImage(grid.boundary,bounds)});
   map.addLayer({id:'outside',type:'raster',source:'outside',paint:{'raster-fade-duration':0}},labels);
   map.addSource('edge',{type:'geojson',data:outline});map.addLayer({id:'edge',type:'line',source:'edge',paint:{'line-color':'#7e9692','line-width':1,'line-opacity':.5}},labels);
   map.addSource('cloud',{type:'image',...cloudImage(grid,current?.values||grid.cells.map(()=>null),layout)});
   const building=layers.find(l=>l.type==='fill-extrusion')?.id;
   map.addLayer({id:'cloud',type:'raster',source:'cloud',paint:{'raster-opacity':['interpolate',['linear'],['zoom'],10,.9,15,.5,17,.25],'raster-fade-duration':0}},building||labels);
   map.addSource('pick',{type:'geojson',data:empty});map.addLayer({id:'pick',type:'circle',source:'pick',paint:{'circle-radius':7,'circle-color':'#235954','circle-stroke-color':'#fff','circle-stroke-width':3}});
   map.on('click',e=>void selectPoint([e.lngLat.lng,e.lngLat.lat]));wire();home();
  });
  await refresh();timer=setInterval(()=>void refresh(),60000);
 }catch(e){loadIssue=`화면을 불러올 수 없습니다. ${e.message}`;showStatus();$('retry').onclick=()=>location.reload();}
}
addEventListener('pagehide',()=>{clearInterval(timer);clearTimeout(toastTimer);});void start();
