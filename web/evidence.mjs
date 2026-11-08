import {nearestMessage} from './nearest.mjs';
import {formatTime,gradeOf,validValue,rgb,adviceFor} from './core.mjs';

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

export function cameraFigure(camera, options) {
  const figure = element('figure', null, 'camera-figure');
  const url = photoURL(camera.photo_url, options);
  if (!url) { figure.append(element('p','공개 가능한 사진이 없습니다.','photo-empty')); return figure; }
  const wrap = element('div', null, 'camera-photo');
  const image = element('img');
  image.alt = `${camera.name || '가까운 CCTV'} · ${formatTime(camera.captured_at)} 촬영, 아래쪽 모자이크 사진`;
  image.width = 640; image.height = 360;
  const roi = element('div', null, 'camera-roi');
  roi.setAttribute('aria-label','모델 입력 영역: 사진 위쪽 60%');
  roi.append(element('span','ROI'));
  image.addEventListener('error',()=>wrap.replaceChildren(element('p','사진을 불러오지 못했습니다. 촬영 시각과 추정값은 아래에서 확인해 주세요.','photo-empty')),{once:true});
  image.src = url;
  wrap.append(image,roi); figure.append(wrap,element('figcaption','붉은 테두리: 모델이 보는 위쪽 60% · 아래쪽은 서버에서 가린 사진'));
  return figure;
}

export function renderEvidence(host,data,options={}) {
  host.replaceChildren(element('h2',options.placeName?`${options.placeName} · ${data.gu||'선택한 위치'}`:`${data.gu || '선택한 위치'} 부근`,'place'));
  const columns = element('div',null,'evidence-columns');
  const estimate = element('section',null,'evidence-section');
  estimate.append(element('h3','선택한 곳의 추정 농도'));
  const e=data.estimate;
  estimate.append(element('div',concentration(e?.pm25),'value'));
  if(validValue(e?.pm25)) {
    const g=gradeOf(e.pm25),badge=element('span',g.name,'badge');badge.style.background=rgb(g.light);estimate.append(badge);
    const advice=adviceFor(e.pm25);if(advice){const a=element('p',`행동 요령(참고): ${advice}`,'advice');a.title='민감군: 어린이·노인·호흡기·심혈관 질환자·임산부. 마스크를 쓰고 숨쉬기 불편하면 벗고 쉬세요. 하루 평균 예보 기준 문구입니다';estimate.append(a);}   // F27
  }
  estimate.append(element('p',e?.source==='station'?'측정소 실측 기반 보간':'CCTV 추정값 기반 공간 보간'),element('p',`${formatTime(e?.slot)} 기준`));
  if(e?.source==='cctv'){   // F21: 지도 값은 여러 사진을 보간한 것이라 같은 오차가 아니다 — "사진 한 장 기준"을 꼭 붙인다
    const note=element('p','사진 한 장 기준 평균 오차 2.9㎍/㎥ (처음 보는 13일) · ','error-note'),link=element('a','원리 보기');
    link.href=`about.html${typeof location==='undefined'?'':location.search}#section-5`;note.append(link);estimate.append(note);
  }
  const observation = element('section',null,'evidence-section');
  observation.append(element('h3','가까운 측정소 실측'));
  const s=data.station;
  if(s?.nearest)observation.append(element('p',nearestMessage(s,'station'),'nearest-note'));
  if(s) observation.append(element('h4',s.name),element('div',concentration(s.pm25),'value'));
  if(s&&validValue(s.pm25)){const g=gradeOf(s.pm25),badge=element('span',g.name,'badge');badge.style.background=rgb(g.light);observation.append(badge);}   // F4
  if(s) observation.append(element('p',`${formatTime(s.data_time)} 기준`),element('p',s.period || '평균 시간 정보 없음'),element('p',Number.isFinite(s.distance_km)?`선택한 곳에서 ${s.distance_km.toFixed(1)}km`:''));
  else observation.append(element('p','측정소 실측값을 아직 제공하지 않습니다.'));
  columns.append(estimate,observation);
  if(data.camera) {
    const c=data.camera,section=element('section',null,'evidence-section evidence-camera');
    section.append(element('h3','가까운 CCTV · 추정의 근거'));
    if(c.nearest)section.append(element('p',nearestMessage(c,'camera'),'nearest-note'));
    section.append(element('h4',`${c.name}${Number.isFinite(c.distance_km)?' · '+c.distance_km.toFixed(1)+'km':''}`),cameraFigure(c,options));
    section.append(element('p',`${formatTime(c.captured_at)} 촬영`),element('p',`사진의 추정값: ${validValue(c.pm25)?concentration(c.pm25):c.status || '추정 안 함'}`,'camera-result'));
    if(e?.source==='station') section.append(element('p','이 사진은 마지막 낮 촬영본일 수 있습니다. 밤·결측 시 지도는 측정소 실측 기반입니다.'));
    section.append(element('p','가까운 한 카메라의 값이며, 여러 카메라를 보간한 지도 농도와 다를 수 있습니다.'));
    columns.append(section);
  }
  host.append(columns,element('p','추정값과 실측값은 위치와 평균 시간이 달라 차이가 날 수 있습니다.','evidence-note'));
  if(options.mock) host.append(element('p','MOCK · 사진과 측정소 값은 제공된 예시입니다. 현재 실시간 자료가 아닙니다.','evidence-note'));
}
