import {element} from './evidence.mjs';
const paths={normal:'M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 1.4 1.4m10 10 1.4 1.4M5.6 18.4 1.4-1.4m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',night:'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10',rain:'M6 14a4 4 0 1 1 1-8 5 5 0 0 1 10 0 4 4 0 0 1 1 8M8 17l-1 3m5-3-1 3m5-3-1 3',humidity:'M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12',few_cameras:'M3 6h12v12H3zM15 10l6-3v10l-6-3',no_data:'M4 4l16 16M3 7h12v11H3M16 10l5-3v10'};
export function frameStatus(frame){
 const total=Number.isInteger(frame.cctv?.total)?frame.cctv.total:'?',valid=Number.isInteger(frame.cctv?.valid)?frame.cctv.valid:'?';
 const labels={normal:[`정상 · CCTV ${total}대 중 ${valid}대로 추정`,`정상 · CCTV ${valid}/${total}대`],night:['밤 · 어두운 사진은 추정하지 않아 측정소 실측으로 표시','밤 · 측정소 실측'],rain:['비 · CCTV 추정을 쉬고 측정소 실측으로 표시','비 · 측정소 실측'],humidity:['습도 높음(95% 이상) · CCTV 추정을 쉬고 측정소 실측으로 표시','습도 높음 · 측정소 실측'],few_cameras:[`카메라 부족 · CCTV ${total}대 중 ${valid}대만 값이 있어 측정소 실측으로 표시`,`카메라 부족(${valid}/${total}) · 측정소 실측`],no_data:['CCTV 자료 없음 · 측정소 실측으로 표시','CCTV 자료 없음 · 측정소 실측']};
 const pair=labels[frame.reason];return pair?{label:pair[0],short:pair[1],path:paths[frame.reason]}:null;
}
export function renderFrameStatus(host,frame,fallback){
 const state=frameStatus(frame);if(!state){host.textContent=fallback;return;}
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS(svg.namespaceURI,'path');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');path.setAttribute('d',state.path);svg.append(path);
 host.replaceChildren(svg,element('span',state.label,'source-full'),element('span',state.short,'source-short'));
}
