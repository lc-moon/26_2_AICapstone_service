const GRADES = [
  { max: 15, name: "좋음",     range: "0–15",  token: "--g-good" },
  { max: 35, name: "보통",     range: "16–35", token: "--g-mod" },
  { max: 75, name: "나쁨",     range: "36–75", token: "--g-bad" },
  { max: 150, name: "매우나쁨", range: "76~",   token: "--g-vbad" },
];
const gradeOf = v => GRADES.find(g => Math.round(v) <= g.max) || GRADES[3];
// 등급 눈금 위 위치(%). 낮은 농도가 몰려 있어 등급마다 같은 폭(4분의 1)으로 그린다
function gaugePos(v) {
  const x = Math.min(150, Math.max(0, Math.round(v)));
  const i = GRADES.findIndex(g => x <= g.max), lo = i ? GRADES[i - 1].max : 0;
  return (i + (x - lo) / (GRADES[i].max - lo)) * 25;
}

export { GRADES, gradeOf, gaugePos };
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

// F27 등급별 행동 요령 한 줄(실외 활동 + 마스크). 근거: 환경부 예보 등급별 행동요령(지자체 게시본: 나쁨 "장시간 또는 무리한 실외활동 제한",
// 매우나쁨 민감군 "가급적 실내활동"), 식약처 보건용 마스크 안내(KF80·94·99, 숫자가 클수록 잘 거르지만 숨쉬기 어려움 — 농도와 호흡에 맞춰 고름).
// 하루 평균 예보 기준 문구라 화면에는 "참고"로 둔다. 민감군 = 어린이·노인·호흡기·심혈관 질환자·임산부
export const ADVICE = {
  '좋음': '실외 활동에 제약 없음',
  '보통': '민감군만 몸 상태에 따라 유의',
  '나쁨': '오래·무리한 실외 활동 줄이기 · 외출 시 KF80 이상 마스크',
  '매우나쁨': '실외 활동 최소화, 민감군은 실내 · 외출 시 KF94 마스크',
};
export const adviceFor = v => validValue(v) ? ADVICE[gradeOf(v).name] || '' : '';
