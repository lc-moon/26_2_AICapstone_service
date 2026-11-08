import test from 'node:test';
import assert from 'node:assert/strict';
import {photoURL,concentration} from './evidence.mjs';
test('redacted photos preserve cache keys for production, API and mock',()=>{
 const path='/cam/live/10042.jpg?v=20261016133305';
 assert.equal(photoURL(path),path);
 assert.equal(photoURL(path,{base:'http://localhost:8000/'}),'http://localhost:8000'+path);
 assert.equal(photoURL(path,{mock:true}),'../shared/mock'+path);
});
test('original, external and traversal photo paths are not shown',()=>{
 for(const path of [null,'https://example.com/a.jpg','//example.com/a.jpg','/cam/../raw.jpg','/cam/%2e%2e/raw.jpg','/original/10042.jpg','javascript:alert(1)'])assert.equal(photoURL(path),null);
});
test('zero is valid but null is not zero',()=>{assert.equal(concentration(0),'0 ㎍/㎥');assert.equal(concentration(null),'값 없음');});

test('panel title does not repeat the district',async()=>{const {panelTitle}=await import('./evidence.mjs');assert.equal(panelTitle('인천 미추홀구 용현동 88-16','미추홀구'),'인천 미추홀구 용현동 88-16');assert.equal(panelTitle('인하대학교','미추홀구'),'인하대학교 · 미추홀구');assert.equal(panelTitle(null,'미추홀구'),'미추홀구 부근');});

test('compare sentence only when the two values are from about the same time',async()=>{const {compareSentence:c}=await import('./evidence.mjs');
 const e={source:'cctv',pm25:13.2,slot:'2026-10-16T13:20:00+09:00'},s={name:'아암',pm25:11,data_time:'2026-10-16T13:00:00+09:00'};
 assert.equal(c(e,s),'가까운 아암 측정소 실측보다 2㎍/㎥ 높아요');
 assert.equal(c({...e,pm25:9},s),'가까운 아암 측정소 실측보다 2㎍/㎥ 낮아요');
 assert.equal(c({...e,pm25:10.6},s),'가까운 아암 측정소 실측과 차이 0㎍/㎥');
 assert.notEqual(c(e,{...s,data_time:'2026-10-16T11:50:00+09:00'}),null);
 assert.equal(c(e,{...s,data_time:'2026-10-16T11:49:00+09:00'}),null);
 assert.equal(c({...e,source:'station'},s),null);assert.equal(c(e,{...s,pm25:null}),null);assert.equal(c(e,null),null);assert.equal(c({...e,pm25:null},s),null);
});
test('value labels add the date only when the day differs',async()=>{const {clockOf}=await import('./evidence.mjs');
 assert.equal(clockOf('2026-10-16T13:00:00+09:00','2026-10-16T13:20:00+09:00'),'13:00');
 assert.match(clockOf('2026-10-15T23:00:00+09:00','2026-10-16T13:20:00+09:00'),/10월 15일/);
 assert.equal(clockOf(null,'2026-10-16T13:20:00+09:00'),'시각 없음');
});
