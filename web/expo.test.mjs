import test from 'node:test';
import assert from 'node:assert/strict';
import {apiPath,expoLabel} from './expo.mjs';
test('expo filter only on latest and point, keeps coordinates',()=>{
 assert.equal(apiPath('/api/frames/latest',{expo:true}),'/api/frames/latest?source=cctv');
 assert.equal(apiPath('/api/point',{expo:true,query:{lon:126.7,lat:37.4}}),'/api/point?lon=126.7&lat=37.4&source=cctv');
 assert.equal(apiPath('/api/health',{expo:true}),'/api/health');assert.equal(apiPath('/api/frames/latest'),'/api/frames/latest');
});
test('expo uses actual frame time and identifies unsupported fallback',()=>{
 const label=expoLabel({source:'cctv',slot:'2026-10-16T13:20:00+09:00'});assert.match(label,/10/);assert.match(label,/16/);assert.match(label,/13:20/);assert.doesNotMatch(label,/오늘/);
 assert.match(expoLabel({source:'station'}),/미지원/);assert.match(expoLabel(null),/없음/);
});
test('older Safari without URLSearchParams.size keeps the query',()=>{
 const desc=Object.getOwnPropertyDescriptor(URLSearchParams.prototype,'size');
 Object.defineProperty(URLSearchParams.prototype,'size',{configurable:true,get:()=>undefined});
 try{assert.equal(apiPath('/api/point',{query:{lon:126.7,lat:37.4}}),'/api/point?lon=126.7&lat=37.4');}
 finally{if(desc)Object.defineProperty(URLSearchParams.prototype,'size',desc);else delete URLSearchParams.prototype.size;}
});
