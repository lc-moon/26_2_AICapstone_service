// 원리 페이지 그림: 사진에는 글자를 넣지 않고, 글자·표시선·그래프는 여기서 사이트 글꼴과 색으로 그린다.
// 숫자와 사진은 about/data.json (캡스톤 저장소 Tools/s6_assets.py가 만든다). 화면에 들어오면 한 번 움직인다.
import {gradeOf} from './core.mjs';

const UNIT='㎍/㎥',REVEAL_MS=1100,ease=t=>1-(1-t)**3;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;};
const svg=(tag,attrs={})=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
const when=t=>{const [d,h]=t.split(' '),[,m,dd]=d.split('-');return `${+m}월 ${+dd}일 ${h.slice(0,5)}`;};
const fmt=(v,digits,sign)=>(sign&&v>0?'+':'')+v.toFixed(digits);
function count(tag,cls,value,digits=0,sign=false){const n=el(tag,cls,fmt(value,digits,sign));Object.assign(n.dataset,{to:value,digits,sign:sign?'1':''});return n;}
function head(title,sub){const h=el('div','viz-head');h.append(el('p','viz-title',title));if(sub)h.append(el('p','viz-sub',sub));return h;}
function value(label,v,digits=0){const s=el('span','shot-value');s.append(el('span',null,label),count('b',null,v,digits),el('small',null,UNIT));return s;}

function shot(p,day,{camera,roi=false,heat=false}){
  const card=el('div','shot'),top=el('div','shot-head'),photo=el('div','shot-photo'),foot=el('div','shot-foot');
  top.append(el('span','shot-day',day),el('span','shot-time',`${when(p.captured_at)} · 습도 ${p.humidity}%`));
  const img=el('img');img.src=p.photo;img.width=p.size[0];img.height=p.size[1];img.loading='lazy';img.alt=`${camera}번 카메라 ${day} 사진. 아래 40%는 모자이크로 가림`;
  photo.append(img);
  if(heat){const h=el('img','shot-heat');h.src=p.heat;h.alt='';h.loading='lazy';photo.append(h);}
  if(roi){const view=el('div','shot-view'),hide=el('div','shot-hide');view.append(el('span','chip on','모델이 보는 곳 · 위 60%'));hide.append(el('span','chip','보지 않는 곳 · 도로와 차'));photo.append(view,hide,el('i','shot-scan'));}
  const dot=el('i','grade-dot');dot.style.background=`var(${gradeOf(p.pm25).token})`;
  const measured=value('실측',p.pm25);measured.prepend(dot);
  foot.append(measured);if(heat)foot.append(value('모델 추정',p.pred,1));
  card.append(top,photo,foot);
  return card;
}

function roiFigure(d){
  const f=el('figure','viz viz-roi');
  const pair=el('div','pair');pair.append(shot(d.clear,'맑은 날',{camera:d.camera,roi:true}),shot(d.hazy,'탁한 날',{camera:d.camera,roi:true}));
  f.append(head('같은 카메라, 맑은 날과 탁한 날',`${d.camera}번 카메라 · 모델은 위쪽 60%만 봅니다`),pair);
  return f;
}

function gradcamFigure(d){
  const f=el('figure','viz viz-gradcam');
  const seg=el('div','viz-seg');seg.setAttribute('role','group');seg.setAttribute('aria-label','사진 보기');
  const show=on=>{f.classList.toggle('show-heat',on);for(const b of seg.children)b.setAttribute('aria-pressed',String((b.dataset.heat==='1')===on));};
  for(const [label,on] of [['원래 사진',false],['모델이 본 곳',true]]){const b=el('button',null,label);b.type='button';b.dataset.heat=on?'1':'';b.onclick=()=>{f.dataset.touched='1';show(on);};seg.append(b);}
  show(false);
  const pair=el('div','pair');pair.append(shot(d.clear,'맑은 날',{camera:d.camera,heat:true}),shot(d.hazy,'탁한 날',{camera:d.camera,heat:true}));
  const legend=el('div','heat-legend');legend.append(el('span',null,'적게 봄'),el('i','heat-scale'),el('span',null,'많이 봄'));
  const top=head('모델은 사진의 어디를 봤을까',`${d.camera}번 카메라 · 처음 보는 날의 사진`);top.append(seg);
  f.append(top,pair,legend);
  f.addEventListener('viz-in',()=>setTimeout(()=>{if(!f.dataset.touched)show(true);},900),{once:true});
  return f;
}

function errorFigure(rows,scored){
  const f=el('figure','viz viz-error'),bars=el('div','bars'),max=Math.max(...rows.map(r=>r.mae))*1.08;
  for(const r of rows){
    const row=el('div','bar-row'+(r.final?' final':'')+(r.first?' first':'')+(r.reference?' ref':''));
    const track=el('div','bar-track'),bar=el('i','bar');bar.style.setProperty('--w',`${r.mae/max*100}%`);
    const v=el('span','bar-value');v.append(count('b',null,r.mae,2),el('small',null,UNIT));
    track.append(bar,v);row.append(el('span','bar-name',r.name),track);bars.append(row);
  }
  f.append(head(`처음 보는 ${scored.days}일(${scored.from}~${scored.to}) 사진 ${scored.photos.toLocaleString('ko-KR')}장으로 채점`,'사진 한 장당 평균 오차 · 막대가 짧을수록 정확해요'),bars);
  return f;
}

function humidityFigure(h){
  const f=el('figure','viz viz-humidity'),legend=el('div','viz-legend');
  h.series.forEach((s,k)=>{const item=el('span',`s${k}`+(s.final?' final':''));item.append(el('i'),s.name);legend.append(item);});
  const W=680,H=300,top=34,bottom=58,left=8,right=8,all=h.series.flatMap(s=>s.values);
  const hi=Math.max(...all)+.9,lo=Math.min(0,...all)-.9,y=v=>top+(hi-v)/(hi-lo)*(H-top-bottom),y0=y(0);
  const chart=svg('svg',{viewBox:`0 0 ${W} ${H}`,class:'hum-chart',role:'img','aria-label':'습도 구간별 평균 치우침(예측 − 실측)'});
  chart.style.setProperty('--y0',`${y0}px`);
  chart.append(svg('line',{x1:left,x2:W-right,y1:y0,y2:y0,class:'zero'}));
  const band=(W-left-right)/h.bins.length,bw=26,gap=6,n=h.series.length;
  h.bins.forEach((b,i)=>{
    const cx=left+band*(i+.5);
    h.series.forEach((s,k)=>{
      const v=s.values[i],x=cx+(k-(n-1)/2)*(bw+gap)-bw/2,yv=y(v);
      chart.append(svg('rect',{x,y:Math.min(yv,y0),width:bw,height:Math.max(1,Math.abs(yv-y0)),rx:3,class:`bar s${k}`+(s.final?' final':''),style:`--d:${(i*n+k)*55}ms`}));
      const t=svg('text',{x:x+bw/2,y:v>=0?yv-7:yv+16,class:'val'+(s.final?' final':''),'text-anchor':'middle'});t.textContent=fmt(v,1,true);chart.append(t);
    });
    const label=svg('text',{x:cx,y:H-bottom+26,class:'bin','text-anchor':'middle'});label.textContent=`습도 ${b.label}`;
    const cnt=svg('text',{x:cx,y:H-bottom+44,class:'bin-n','text-anchor':'middle'});cnt.textContent=`${b.n.toLocaleString('ko-KR')}장`;
    chart.append(label,cnt);
  });
  f.append(head('습할수록 뿌연 화면을 먼지로 착각하던 버릇','습도 구간별 평균 치우침(예측 − 실측) · 0에 가까울수록 좋아요'),legend,chart);
  return f;
}

// 실측 대조(M7): 실제 서비스가 매일 낸 값과 측정소 실측. 위는 하루 평균 두 선, 아래는 날마다 오차와 그날 습도,
// 그리고 오차가 컸던 날이 어떤 날이었는지(그날 실측·습도). 색은 위 그래프와 같은 규칙(인천 ver 주황, 최종 파랑)
const md=d=>{const [,m,dd]=d.split('-');return `${+m}/${+dd}`;};
function dayAxis(days,W,left,right){const step=(W-left-right)/days.length;return {step,x:i=>left+(i+.5)*step};}
function bands(chart,c,days,x,step,top,bottom,H,tone,withName){
  let i0=0;
  days.forEach((d,i)=>{if(i===days.length-1||days[i+1].model!==d.model){const m=c.models.find(m=>m.model===d.model);
    chart.append(svg('rect',{x:x(i0)-step/2,y:top-22,width:(i-i0+1)*step,height:H-bottom-top+22,class:`band ${tone(m)}`}));
    if(withName&&(i-i0+1)*step>=90){const t=svg('text',{x:x(i0)-step/2+6,y:top-8,class:`band-name ${tone(m)}`});t.textContent=m.name.replace(/ \(.*\)/,'');chart.append(t);}
    i0=i+1;}});
}
function compareFigure(c){
  const f=el('figure','viz viz-compare'),tone=m=>`m${c.models.indexOf(m)+1}`,model=d=>c.models.find(m=>m.model===d.model),short=m=>m.name.replace(/ \(.*\)/,'');
  const cards=el('div','cmp-cards');
  for(const m of c.models){
    const card=el('div',`cmp-card ${tone(m)}`);card.append(el('span','cmp-card-name',m.name),el('span','cmp-card-days',`${md(m.first)}~${md(m.last)} · ${m.days}일 · ${m.n.toLocaleString('ko-KR')}장`));
    const v=el('span','cmp-card-mae');v.append(el('span',null,'평균 오차'),count('b',null,m.mae,2),el('small',null,UNIT));
    const bias=el('span','cmp-card-bias');bias.append(el('span',null,'치우침'),count('b',null,m.bias,1,true),el('small',null,`${UNIT} · CCTV 추정이 실측보다 평균 ${Math.abs(m.bias).toFixed(1)} ${m.bias>=0?'높았어요':'낮았어요'}`));
    card.append(v,bias);cards.append(card);
  }
  const days=c.days,W=720,left=40,right=40,{step,x}=dayAxis(days,W,left,right);
  const path=pts=>pts.map((p,k)=>`${k?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const dateLabels=(chart,yy)=>days.forEach((d,i)=>{if((i%3===0&&i<days.length-2)||i===days.length-1){const t=svg('text',{x:x(i),y:yy,'text-anchor':'middle',class:'axis'});t.textContent=md(d.day);chart.append(t);}});
  const axisTitle=(chart,text,xx,yy,anchor='start')=>{const t=svg('text',{x:xx,y:yy,'text-anchor':anchor,class:'axis-title'});t.textContent=text;chart.append(t);};
  const key=(cls,label)=>{const s=el('span',`key ${cls}`);s.append(el('i'),label);return s;};
  const timeline=()=>{const t=el('div','cmp-timeline');t.style.setProperty('--l',`${left/W*100}%`);t.style.setProperty('--r',`${right/W*100}%`);
    c.models.forEach((m,k)=>{const last=k===c.models.length-1,s=el('div',`tl-seg ${tone(m)}${last?' now':''}`);s.style.flexGrow=m.days;s.append(el('i','seg-bar'));
      const label=el('span','seg-label');if(last)label.append(el('b','live'));label.append(el('strong',null,short(m)),last?` · ${md(m.first)}부터 서비스 중`:` · ${md(m.first)}~${md(m.last)} 서비스`);s.append(label);t.append(s);});
    return t;};
  const panel=(n,title,desc,legend,chart,note)=>{const p=el('div','cmp-panel'),h=el('div','cmp-panel-head');h.append(el('span','cmp-panel-n',n),el('p','cmp-panel-title',title));p.append(h);if(desc)p.append(el('p','cmp-panel-desc',desc));p.append(legend,timeline(),chart);if(note)p.append(note);return p;};

  // ① 날짜별 농도: 실측(진한 실선)과 추정(그때 쓴 모델 색)
  const H=290,top=50,bottom=42,max=Math.ceil((Math.max(...days.flatMap(d=>[d.est,d.obs]))+4)/5)*5,y=v=>top+(1-v/max)*(H-top-bottom);
  const lines=svg('svg',{viewBox:`0 0 ${W} ${H}`,class:'cmp-chart',role:'img','aria-label':'날짜별 하루 평균 추정값과 측정소 실측'});
  for(let v=0;v<=max;v+=10){lines.append(svg('line',{x1:left,x2:W-right,y1:y(v),y2:y(v),class:'grid'}));const t=svg('text',{x:left-6,y:y(v)+4,'text-anchor':'end',class:'axis'});t.textContent=v;lines.append(t);}
  bands(lines,c,days,x,step,top,bottom,H,tone,false);
  lines.append(svg('path',{d:path(days.map((d,i)=>[x(i),y(d.obs)])),class:'line obs',pathLength:1}));
  for(const m of c.models){const idx=days.map((d,i)=>[d,i]).filter(([d])=>d.model===m.model);if(idx.length>1)lines.append(svg('path',{d:path(idx.map(([d,i])=>[x(i),y(d.est)])),class:`line est ${tone(m)}`,pathLength:1}));}
  days.forEach((d,i)=>{const o=svg('circle',{cx:x(i),cy:y(d.obs),r:3.2,class:'dot obs',style:`--d:${i*40}ms`}),e=svg('circle',{cx:x(i),cy:y(d.est),r:4,class:`dot est ${tone(model(d))}`,style:`--d:${i*40}ms`});
    const tip=svg('title');tip.textContent=`${md(d.day)} · 추정 ${d.est} / 실측 ${d.obs} ㎍/㎥ · 습도 ${d.hum}% · 평균 오차 ${d.mae} · ${d.n}장`;e.append(tip);lines.append(o,e);});
  const top1=days.reduce((a,b)=>b.mae>a.mae?b:a),i1=days.indexOf(top1);   // 가장 크게 빗나간 날에 짧은 설명
  lines.append(svg('line',{x1:x(i1),x2:x(i1)+26,y1:y(top1.est)-6,y2:y(top1.est)-26,class:'callout-line'}));
  const co=svg('text',{x:x(i1)+30,y:y(top1.est)-26,class:'callout'});co.textContent=`${md(top1.day)} 습도 ${top1.hum}% → ${top1.bias>=0?'높게':'낮게'} 부름 (2번 그래프)`;lines.append(co);
  dateLabels(lines,H-bottom+20);axisTitle(lines,'PM2.5 하루 평균 (㎍/㎥)',left-34,top-30);axisTitle(lines,'날짜',W-right,H-4,'end');
  const leg1=el('div','viz-legend');leg1.append(key('obs','측정소 실측'),...c.models.map(m=>key(`est ${tone(m)}`,`CCTV 추정 · ${short(m)}`)));
  const note1=el('p','cmp-note',`가장 크게 빗나간 ${md(top1.day)}은 하루 평균 습도가 ${top1.hum}%로 매우 습한 날이었어요. 실측은 ${top1.obs}인데 ${top1.est}로 불렀습니다. 날마다의 오차와 습도는 아래 2번 그래프에서 함께 볼 수 있어요.`);

  // ② 날마다 평균 오차(막대)와 그날 습도(선)
  const H2=250,t2=50,b2=42,em=Math.ceil(Math.max(...days.map(d=>d.mae))/2)*2,ye=v=>t2+(1-v/em)*(H2-t2-b2),yh=v=>t2+(1-v/100)*(H2-t2-b2),bw=Math.min(18,step*.6);
  const errs=svg('svg',{viewBox:`0 0 ${W} ${H2}`,class:'cmp-chart cmp-err',role:'img','aria-label':'날짜별 평균 오차와 그날 평균 습도'});
  for(let v=0;v<=em;v+=em/2){errs.append(svg('line',{x1:left,x2:W-right,y1:ye(v),y2:ye(v),class:'grid'}));const t=svg('text',{x:left-6,y:ye(v)+4,'text-anchor':'end',class:'axis'});t.textContent=v;errs.append(t);}
  for(const v of [0,50,100]){const t=svg('text',{x:W-right+6,y:yh(v)+4,class:'axis hum'});t.textContent=`${v}`;errs.append(t);}
  days.forEach((d,i)=>{const r=svg('rect',{x:x(i)-bw/2,y:ye(d.mae),width:bw,height:ye(0)-ye(d.mae),rx:2,class:`err-bar ${tone(model(d))}`+(c.worst.includes(d.day)?' worst':''),style:`--d:${i*35}ms`});
    const tip=svg('title');tip.textContent=`${md(d.day)} · 평균 오차 ${d.mae} · 습도 ${d.hum}%`;r.append(tip);errs.append(r);
    if(c.worst.includes(d.day)){const t=svg('text',{x:x(i),y:ye(d.mae)-5,'text-anchor':'middle',class:'worst-label'});t.textContent=md(d.day);errs.append(t);}});
  errs.append(svg('path',{d:path(days.map((d,i)=>[x(i),yh(d.hum)])),class:'line hum',pathLength:1}));
  days.forEach((d,i)=>errs.append(svg('circle',{cx:x(i),cy:yh(d.hum),r:2.5,class:'dot hum',style:`--d:${i*35}ms`})));
  dateLabels(errs,H2-b2+20);axisTitle(errs,'평균 오차 (㎍/㎥)',left-34,t2-30);axisTitle(errs,'습도 (%)',W-right+34,t2-30,'end');axisTitle(errs,'날짜',W-right,H2-4,'end');
  const leg2=el('div','viz-legend');leg2.append(...c.models.map(m=>key(`bar ${tone(m)}`,`그날 평균 오차 · ${short(m)} (왼쪽 눈금)`)),key('hum','그날 평균 습도 (오른쪽 눈금)'));

  // ③ 오차가 컸던 날
  const th=c.thresholds,worst=el('div','worst-days');
  for(const day of c.worst){const d=days.find(x=>x.day===day),card=el('div',`worst-day ${tone(model(d))}`),tags=el('div','worst-tags');
    if(d.hum>=75||d.humid>=.3)tags.append(el('span','tag humid','습한 날'));if(d.obs_max>=th.dusty)tags.append(el('span','tag dusty',`농도 높은 시간 있음 (${th.dusty} 이상)`));
    card.append(el('span','worst-date',`${md(d.day)} · ${short(model(d))}`),el('span','worst-mae',`오차 ${d.mae.toFixed(1)} · ${d.bias>=0?'높게':'낮게'} ${Math.abs(d.bias).toFixed(1)}`),
      el('span','worst-fact',`습도 평균 ${d.hum}%`),el('span','worst-fact',`습도 ${th.humid}% 넘은 사진 ${Math.round(d.humid*100)}%`),el('span','worst-fact',`실측 평균 ${d.obs} · 최고 ${d.obs_max} ㎍/㎥`),tags);
    worst.append(card);}
  const why=el('div','cmp-panel');const wh=el('div','cmp-panel-head');wh.append(el('span','cmp-panel-n','3'),el('p','cmp-panel-title','오차가 컸던 날은 어떤 날이었나'));
  why.append(wh,worst);
  f.append(head('실제 서비스가 매일 낸 값과 측정소 실측',`${md(c.range.from)}~${md(c.range.to)} ${c.range.last.slice(11)} · 사진 ${c.range.photos.toLocaleString('ko-KR')}장 · 비 거르기를 고친 10/19부터. 점이나 막대에 마우스를 올리면 그날 값이 보여요`),cards,
    panel('1','날짜별 농도 — 측정소 실측과 CCTV 추정의 하루 평균','두 선이 가까울수록 잘 맞힌 날이에요. 배경색은 위 띠와 같은 서비스 기간입니다',leg1,lines,note1),
    panel('2','날마다 평균 오차와 그날 습도','막대가 높을수록 그날 많이 빗나갔어요. 습도 선이 높은 날 막대도 높아지는지 보세요',leg2,errs),why);
  return f;
}

// 화면에 들어오면 한 번: .in을 붙이고 숫자를 0부터 올린다
function reveal(f){
  f.classList.add('in');f.dispatchEvent(new Event('viz-in'));
  const nums=[...f.querySelectorAll('[data-to]')].map(n=>({n,to:+n.dataset.to,d:+n.dataset.digits,s:!!n.dataset.sign}));
  const start=performance.now();
  const draw=now=>{const e=ease(Math.min(1,(now-start)/REVEAL_MS));for(const x of nums)x.n.textContent=fmt(x.to*e,x.d,x.s);if(e<1)requestAnimationFrame(draw);};
  draw(start);
}

export async function mountFigures(){
  const slots=document.querySelectorAll('[data-viz]');if(!slots.length)return;
  let data;try{data=await (await fetch('about/data.json',{cache:'no-cache'})).json();}catch{for(const s of slots)s.replaceWith(el('p','viz-error-msg','그림을 불러오지 못했어요. 새로고침해 주세요'));return;}
  const make={roi:()=>roiFigure(data.roi),error:()=>errorFigure(data.error,data.scored),humidity:()=>humidityFigure(data.humidity),gradcam:()=>gradcamFigure(data.gradcam),compare:()=>data.compare&&compareFigure(data.compare)};
  const io='IntersectionObserver' in window?new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting){io.unobserve(e.target);reveal(e.target);}},{threshold:.35}):null;
  for(const s of slots){
    const f=make[s.dataset.viz]?.();if(!f)continue;
    const cap=s.querySelector('figcaption');if(cap)f.append(cap);
    s.replaceWith(f);io?io.observe(f):reveal(f);
  }
}
