const GRADES = [
  { max: 15, name: "좋음",     range: "0–15",  light: [200, 226, 252], dark: [128, 176, 236] },
  { max: 35, name: "보통",     range: "16–35", light: [196, 234, 196], dark: [118, 196, 140] },
  { max: 75, name: "나쁨",     range: "36–75", light: [255, 226, 165], dark: [244, 176, 100] },
  { max: 150, name: "매우나쁨", range: "76~",   light: [246, 170, 170], dark: [214, 100, 112] },
];
const gradeOf = v => GRADES.find(g => Math.round(v) <= g.max) || GRADES[3];
function colorOf(v) {
  const i = GRADES.indexOf(gradeOf(v)), g = GRADES[i];
  const lo = i ? GRADES[i - 1].max : 0, t = Math.min(1, Math.max(0, (v - lo) / (g.max - lo)));
  return g.light.map((x, k) => Math.round(x + (g.dark[k] - x) * t));
}
const rgb = c => `rgb(${c.join(",")})`;


export { GRADES, gradeOf, colorOf, rgb };
export const validValue = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function inRing(p, r) {
  let inside = false;
  for (let i=0,j=r.length-1;i<r.length;j=i++) {
    const [x,y]=r[i], [xx,yy]=r[j];
    if ((y>p[1]) !== (yy>p[1]) && p[0]<(xx-x)*(p[1]-y)/(yy-y)+x) inside=!inside;
  }
  return inside;
}
export function inside(p, geometry) {
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(rings=>inRing(p,rings[0])&&!rings.slice(1).some(r=>inRing(p,r)));
}
export function gridLayout(cells) {
  const cols=Math.max(...cells.map(c=>c.col))+1, rows=Math.max(...cells.map(c=>c.row))+1;
  const a=cells[0], horizontal=cells.find(c=>c.row===a.row&&c.col!==a.col);
  const vertical=cells.find(c=>c.col===a.col&&c.row!==a.row);
  if(!horizontal||!vertical) throw Error('격자 좌표를 확인해 주세요.');
  const dx=(horizontal.center[0]-a.center[0])/(horizontal.col-a.col);
  const dy=(vertical.center[1]-a.center[1])/(vertical.row-a.row);
  const west=a.center[0]-(a.col+.5)*dx, south=a.center[1]-(a.row+.5)*dy;
  return {cols,rows,dx,dy,west,south,east:west+cols*dx,north:south+rows*dy};
}
export function cellAt(point,cells,layout) {
  const col=Math.floor((point[0]-layout.west)/layout.dx),row=Math.floor((point[1]-layout.south)/layout.dy);
  return cells.findIndex(c=>c.col===col&&c.row===row);
}
export function validateFrame(data,count) {
  if(!data || !Array.isArray(data.values) || data.values.length!==count ||
     !data.values.every(v=>v===null||validValue(v)) || !['cctv','station'].includes(data.source) ||
     !Number.isFinite(Date.parse(data.slot)) || !Number.isFinite(Date.parse(data.updated_at)))
    throw Error('농도 응답 형식이 올바르지 않습니다.');
  return data;
}
export function frameChanged(a,b) { return !a||a.slot!==b.slot||a.updated_at!==b.updated_at; }
export function formatTime(t) {
  if(!t||!Number.isFinite(Date.parse(t)))return '기준 시각 없음';
  return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
}
