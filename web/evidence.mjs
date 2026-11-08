import {nearestMessage} from './nearest.mjs';
import {formatTime,gradeOf,gaugePos,validValue,adviceFor} from './core.mjs';

export function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

// Only the server's redacted camera files are eligible. Preserve cache-busting queries.
export function photoURL(path, {mock=false, base=''}={}) {
  if (typeof path !== 'string' || !/^\/cam\/(?:live\/)?[\w-]+\.jpg(?:\?[^#]*)?$/.test(path)) return null;
  return mock ? '../shared/mock'+path : base.replace(/\/$/,'')+path;
}

export function concentration(value) {
  return validValue(value) ? `${Math.round(value)} ㎍/㎥` : '값 없음';
}

export function cameraFigure(camera, options, chip='아래 40%는 서버에서 가려서 받아요') {
  const figure = element('figure', null, 'camera-figure');
  const url = photoURL(camera.photo_url, options);
  if (!url) { figure.append(element('p','보여 드릴 수 있는 사진이 없어요','photo-empty')); return figure; }
  const wrap = element('div', null, 'camera-photo');
  const image = element('img');
  image.alt = `${camera.name || '가까운 CCTV'} · ${formatTime(camera.captured_at)} 촬영, 아래쪽 모자이크 사진`;
  image.width = 640; image.height = 360;
  const roi = element('div', null, 'camera-roi');
  roi.setAttribute('aria-label','모델 입력 영역: 사진 위쪽 60%');
  image.addEventListener('error',()=>wrap.replaceChildren(element('p','사진을 불러오지 못했어요. 촬영 시각과 추정값은 아래에서 볼 수 있어요','photo-empty')),{once:true});
  image.src = url;
  wrap.append(image,roi,element('span','모델이 보는 곳 · 위 60%','photo-roi-label'),element('span',chip,'photo-chip')); figure.append(wrap);
  return figure;
}

export function panelTitle(place,gu) {
  if(!place)return `${gu || '선택한 위치'} 부근`;
  return gu&&place.includes(gu)?place:`${place} · ${gu || '선택한 위치'}`;   // 지번 검색은 이름에 구가 이미 들어 있다
}

export function gradePill(value) {
  const g=gradeOf(value),pill=element('span',null,'grade-pill'),dot=element('i');
  dot.style.background=`var(${g.token})`;pill.append(dot,g.name);return pill;
}

// 두 값이 거의 같은 때의 값일 때만 비교한다. 측정소 값은 1시간 단위라 평소 1시간 안쪽으로 벌어진다
export const COMPARE_GAP_MIN=90;
export function compareSentence(estimate,station) {
  if(estimate?.source!=='cctv'||!validValue(estimate.pm25)||!validValue(station?.pm25))return null;
  const gap=Math.abs(Date.parse(estimate.slot)-Date.parse(station.data_time))/60000;
  if(!Number.isFinite(gap)||gap>COMPARE_GAP_MIN)return null;
  const diff=Math.round(estimate.pm25)-Math.round(station.pm25),who=`가까운 ${station.name} 측정소 실측`;
  return diff===0?`${who}과 차이 0㎍/㎥`:`${who}보다 ${Math.abs(diff)}㎍/㎥ ${diff>0?'높아요':'낮아요'}`;
}

const seoulDay=t=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short'}).format(new Date(t));
// 같은 날이면 시각만, 날짜가 다르면 날짜까지 쓴다(하루 지난 값이 같은 날 값처럼 보이지 않게)
export function clockOf(time,reference) {
  if(!Number.isFinite(Date.parse(time)))return '시각 없음';
  if(!Number.isFinite(Date.parse(reference))||seoulDay(time)!==seoulDay(reference))return formatTime(time);
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(time));
}

function numberCard(data,options) {
  const e=data.estimate,card=element('section',null,'dock-card num-card evidence-section'),head=element('div',null,'num-head');
  head.append(element('h2',panelTitle(options.placeName,options.placeGu||data.gu),'place'));
  if(validValue(e?.pm25))head.append(gradePill(e.pm25));
  const value=element('div',null,'value');
  if(validValue(e?.pm25))value.append(String(Math.round(e.pm25)),element('small','㎍/㎥'));else{value.textContent='값 없음';value.classList.add('empty');}
  const foot=element('div',null,'num-foot'),source=element('p');
  source.append(element('b',e?.source==='station'?'측정소 실측':'CCTV 추정'),` · ${formatTime(e?.slot)} 기준`);
  foot.append(source,element('p',e?.source==='station'?'측정소에서 잰 값을 이어 그렸어요':'CCTV 사진들로 추정한 값을 이어 그렸어요'));
  if(e?.source==='cctv'){   // F21: 지도 값은 여러 사진을 보간한 것이라 같은 오차가 아니다 — "사진 한 장 기준"을 꼭 붙인다
    const note=element('p','사진 한 장 기준 평균 오차 2.9㎍/㎥ (처음 보는 13일) · ','error-note'),link=element('a','원리 보기');
    link.href=`about.html${typeof location==='undefined'?'':location.search}#section-5`;note.append(link);foot.append(note);
  }
  const advice=adviceFor(e?.pm25);
  if(advice){const a=element('p',null,'advice');a.append(element('b','참고'),` ${advice}`);a.title='행동 요령(참고). 민감군: 어린이·노인·호흡기·심혈관 질환자·임산부. 마스크를 쓰고 숨쉬기 불편하면 벗고 쉬세요. 하루 평균 예보 기준 문구입니다';foot.append(a);}   // F27
  card.append(head,element('p','선택한 곳의 추정 농도','num-label'),value,foot);
  return card;
}

function valueBlock(label,value) {
  const block=element('div',null,'cmp-value');
  block.append(element('span',label),element('b',validValue(value)?String(Math.round(value)):'값 없음',validValue(value)?null:'empty'));
  return block;
}

function gauge(estimate,station) {
  const box=element('div',null,'gauge'),hasE=validValue(estimate),hasS=validValue(station);
  box.setAttribute('role','img');
  box.setAttribute('aria-label',`등급 눈금: ${hasE?`추정 ${Math.round(estimate)}`:'추정 값 없음'}, ${hasS?`실측 ${Math.round(station)}`:'실측 값 없음'}`);
  const bars=element('div',null,'grade-bars');
  for(const token of ['--g-good','--g-mod','--g-bad','--g-vbad']){const bar=element('i');bar.style.background=`var(${token})`;bars.append(bar);}
  box.append(bars);
  const mark=(value,kind,label)=>{const dot=element('i',null,`gauge-dot ${kind}`),tag=element('span',label,`gauge-tag ${kind}`);for(const n of [dot,tag])n.style.left=`${gaugePos(value)}%`;box.append(dot,tag);};
  if(hasS)mark(station,'obs','▲ 실측');
  if(hasE)mark(estimate,'est','추정 ▼');
  return box;
}

function compareCard(data,options) {
  const e=data.estimate,s=data.station,stationMap=e?.source==='station',card=element('section',null,'dock-card compare-card evidence-section');
  const head=element('div',null,'cmp-head'),info=element('button','i','info');info.type='button';info.setAttribute('aria-label','비교할 때 알아 둘 점');info.setAttribute('aria-expanded','false');
  const tip=element('div',null,'info-tip');tip.hidden=true;tip.append(element('p','추정과 실측은 위치와 평균 시간이 달라서 차이가 날 수 있어요'));
  if(data.camera)tip.append(element('p','사진 칸의 값은 가까운 카메라 한 대의 값이에요. 여러 카메라로 그린 지도 값과 다를 수 있어요'));
  info.onclick=()=>{tip.hidden=!tip.hidden;info.setAttribute('aria-expanded',String(!tip.hidden));};
  head.append(element('h3','가까운 측정소 실측과 비교'),info,tip);
  const body=element('div',null,'cmp-body');
  if(s?.nearest){body.classList.add('has-note');body.append(element('p',nearestMessage(s,'station'),'nearest-note'));}
  if(!s){body.append(element('p','측정소 값이 아직 없어요','cmp-empty'));card.append(head,body);return card;}
  const values=element('div',null,'cmp-values');
  const estLabel=`● ${stationMap?'측정소 지도':'추정'} · ${clockOf(e?.slot,s.data_time)}`,obsLabel=`○ 실측 · ${s.name} ${clockOf(s.data_time,e?.slot)}`;
  const est=valueBlock(estLabel,e?.pm25),obs=valueBlock(obsLabel,s.pm25);
  if(stationMap){if(validValue(e?.pm25))est.append(gradePill(e.pm25));if(validValue(s.pm25))obs.append(gradePill(s.pm25));}
  values.append(est,obs);body.append(values);
  if(!stationMap){
    body.append(gauge(e?.pm25,s.pm25));
    const names=element('div',null,'gauge-names');for(const t of ['좋음 0–15','보통 16–35','나쁨 36–75','매우나쁨 76~'])names.append(element('span',t));body.append(names);
    const sentence=compareSentence(e,s);if(sentence)body.append(element('p',sentence,'cmp-sentence'));
  }
  const meta=[`${s.name} 측정소`];
  if(Number.isFinite(s.distance_km))meta.push(`선택한 곳에서 ${s.distance_km.toFixed(1)}km`);
  meta.push(`${formatTime(s.data_time)} 기준${s.period?` (${s.period})`:''}`);
  body.append(element('p',meta.join(' · '),'cmp-meta'));
  card.append(head,body);
  return card;
}

function mockNote(options) {
  return options.mock?element('p','MOCK · 사진과 측정소 값은 제공된 예시예요. 현재 실시간 자료가 아니에요.','evidence-note'):null;
}

function cameraStage(data,options) {
  const c=data.camera,stage=element('div',null,'stage evidence-camera'),row=element('div',null,'origin-row');
  const card=element('section',null,'dock-card photo-card evidence-section'),head=element('div',null,'card-head');
  head.append(element('h3','가까운 CCTV 사진'),element('span',`${c.name}${Number.isFinite(c.distance_km)?' · '+c.distance_km.toFixed(1)+'km':''}`));
  card.append(head);
  if(c.nearest)card.append(element('p',nearestMessage(c,'camera'),'nearest-note'));
  card.append(cameraFigure(c,options));
  const foot=element('div',null,'photo-foot'),result=element('span',null,'camera-result');
  if(validValue(c.pm25))result.append('이 사진의 추정값 ',element('b',String(Math.round(c.pm25))),' ㎍/㎥');else result.textContent=`이 사진의 추정값: ${c.status||'추정 안 함'}`;
  foot.append(element('span',`${formatTime(c.captured_at)} 촬영`),result);card.append(foot);
  if(data.estimate?.source==='station')card.append(element('p','이 사진은 마지막 낮 촬영본일 수 있어요. 지금 지도는 측정소 실측 기반이에요.','photo-note'));
  const actions=element('div',null,'actions'),note=mockNote(options);if(note)actions.append(note);
  row.append(card,actions);stage.append(element('div',null,'live'),row);
  return stage;
}

function noticeStage(options) {
  const stage=element('div',null,'stage'),row=element('div',null,'origin-row'),card=element('section',null,'dock-card notice-stage');
  if(options.notice.icon)card.append(options.notice.icon);
  card.append(element('h3',options.notice.title),element('p',options.notice.body));
  const actions=element('div',null,'actions'),note=mockNote(options);if(note)actions.append(note);
  row.append(card,actions);stage.append(row);
  return stage;
}

export function renderEvidence(host,data,options={}) {
  const grid=element('div',null,'dock-grid');
  grid.append(numberCard(data,options),compareCard(data,options));
  if(data.camera)grid.append(cameraStage(data,options));
  else if(options.notice)grid.append(noticeStage(options));
  else grid.classList.add('no-stage');
  host.replaceChildren(grid);
}
