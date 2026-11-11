// 원리 페이지(11/12 요약과 합침). 글은 about.html에 그대로 두고, 여기서는 움직임과 그림(about-viz.mjs)만 붙인다
import {applyTheme} from './theme.mjs';
import {mountFigures} from './about-viz.mjs';
// 이 페이지는 다크가 기본. 주소에 ?theme=light를 붙이면 밝게
if(new URLSearchParams(location.search).get('theme'))applyTheme();else document.documentElement.dataset.theme='dark';
const backParams=new URLSearchParams(location.search);backParams.set('restore','1');
for(const id of ['back-map','back-map-end'])document.getElementById(id).href=`index.html?${backParams}`;
void mountFigures();

// 숫자가 0부터 올라간다(data-count 목표값, data-dec 소수 자리, data-sep 천 단위 쉼표)
function count(el,delay=0){
  if(el.dataset.done)return;el.dataset.done='1';
  const to=Number(el.dataset.count),dec=Number(el.dataset.dec||0),dur=1300,fmt=v=>el.dataset.sep?Math.round(v).toLocaleString('ko-KR'):v.toFixed(dec);
  setTimeout(()=>{
    const t0=performance.now();
    const step=now=>{const p=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-p,4);el.textContent=fmt(to*e);if(p<1)requestAnimationFrame(step);};
    requestAnimationFrame(step);
  },delay);
}

// 모델 그림의 특징 768개를 점 32개로
const dots=document.querySelector('.feat-dots');
if(dots)for(let i=0;i<32;i++){const d=document.createElement('i');d.style.animationDelay=`${(i*37%32)/32*2.4}s`;dots.append(d);}

const start=()=>{
  document.body.classList.add('ready');
  document.querySelectorAll('.hero [data-count]').forEach((el,i)=>count(el,700+i*100));
  const io=new IntersectionObserver(entries=>entries.forEach(e=>{
    if(!e.isIntersecting)return;
    e.target.classList.add('in');io.unobserve(e.target);
    e.target.querySelectorAll('[data-count]').forEach((el,i)=>count(el,300+i*250));
  }),{rootMargin:'0px 0px -12% 0px'});   // 그림이 많아 아주 긴 섹션도 위쪽이 보이면 움직인다
  document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
};
(document.fonts?.ready||Promise.resolve()).then(()=>requestAnimationFrame(start));
