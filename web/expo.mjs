import {formatTime} from './core.mjs';
export function apiPath(path,{expo=false,query={}}={}){
 const params=new URLSearchParams(query);
 if(expo&&['/api/frames/latest','/api/point'].includes(path))params.set('source','cctv');
 return path+(params.size?'?'+params:'');
}
export function expoLabel(frame){
 if(!frame)return '전시용 · CCTV 회차 없음';
 if(frame.source!=='cctv')return '전시용 CCTV 회차 미지원 · 측정소 기반으로 표시 중';
 return `전시용 · ${formatTime(frame.slot)} CCTV 회차`;
}
