const km=value=>Number.isFinite(value)?`(${value.toFixed(1)}km)`:'';
export function nearestMessage(item,type){
 const n=item?.nearest;if(!n)return '';
 const from=`가까운 ${n.name||'이름 미상'} ${type==='camera'?'CCTV':'측정소'}${km(n.distance_km)}`,to=`다음으로 가까운 ${item.name||'이름 미상'}${km(item.distance_km)}`;
 if(type==='station')return `${from}는 에어코리아에 ${n.reason?`'${n.reason}'로 표시되어`:'이 시각 값이 올라오지 않아'}, ${to} 측정소에서 잰 값이에요`;
 const since=n.since&&Number.isFinite(Date.parse(n.since))?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(n.since)):'지금';
 const reasons={no_feed:`인천교통정보센터 영상을 ${since}부터 받지 못해`,rain:'비가 와서 이번 회차는 추정을 쉬어',humidity:'습도가 95% 이상이라 이번 회차는 추정을 쉬어',weather_missing:'기상청 습도 자료가 오지 않아 이번 회차는 추정을 쉬어',photo_error:'이번 회차 사진을 처리하지 못해'};
 return reasons[n.reason]?`${from}는 ${reasons[n.reason]}, ${to} 사진이에요`:`${from} 대신 ${to} 사진이에요`;
}
