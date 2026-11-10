// 일몰 후에는 다크 모드. 데이터 상태 "밤"(측정소 지도)과는 별개다 — 전시 주소는 일몰 뒤에도 낮 회차 지도를 다크로 보여 준다
// 태양고도 식은 서버(server/sun.py)·수집기와 같다. ?theme=light|dark 로 고정해 볼 수 있다
const INCHEON=[37.4563,126.7052];
const rad=d=>d*Math.PI/180,deg=r=>r*180/Math.PI,mod=(a,n)=>((a%n)+n)%n;

export function sunAltitude(when,lat=INCHEON[0],lon=INCHEON[1]){
 const d=(when.getTime()-Date.UTC(2000,0,1,12))/86400000;
 const g=rad(mod(357.529+0.98560028*d,360)),q=mod(280.459+0.98564736*d,360);
 const lam=rad(mod(q+1.915*Math.sin(g)+0.020*Math.sin(2*g),360)),eps=rad(23.439-0.00000036*d);
 const ra=Math.atan2(Math.cos(eps)*Math.sin(lam),Math.cos(lam)),dec=Math.asin(Math.sin(eps)*Math.sin(lam));
 const gmst=mod(18.697374558+24.06570982441908*d,24),ha=rad(mod(gmst*15+lon,360))-ra,phi=rad(lat);
 return deg(Math.asin(Math.sin(phi)*Math.sin(dec)+Math.cos(phi)*Math.cos(dec)*Math.cos(ha)));
}
export function themeAt(when,search=''){
 const forced=new URLSearchParams(search).get('theme');
 if(forced==='light'||forced==='dark')return forced;
 return sunAltitude(when)>=0?'light':'dark';
}
// 테마를 적용하고, 바뀌었으면 true
export function applyTheme(now=new Date()){
 const root=document.documentElement,next=themeAt(now,location.search);
 if(root.dataset.theme===next)return false;
 root.dataset.theme=next;return true;
}
export const token=name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();
