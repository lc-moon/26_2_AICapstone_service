import test from 'node:test';
import assert from 'node:assert/strict';
import {createSearch,searchURL} from './search.mjs';
const endpoint='https://nominatim.openstreetmap.org/search';
const response=rows=>({ok:true,json:async()=>rows});
test('search limits results to Korea and Incheon viewbox',()=>{
 const u=new URL(searchURL('인천시청',endpoint));assert.equal(u.searchParams.get('q'),'인천시청');assert.equal(u.searchParams.get('bounded'),'1');assert.equal(u.searchParams.get('countrycodes'),'kr');assert.equal(u.searchParams.get('limit'),'1');assert.equal(u.searchParams.get('viewbox'),'126.35,37.65,126.85,37.35');
});
test('cache including empty results avoids repeat requests; new query is throttled',async()=>{
 let calls=0,time=5000;const search=createSearch({endpoint,storage:null,now:()=>time,fetcher:async()=>{calls++;return response([]);}});
 assert.equal(await search('없는 이름'),null);assert.equal(await search(' 없는  이름 '),null);assert.equal(calls,1);
 await assert.rejects(search('인천시청'),/1초/);time+=1100;await search('인천시청');assert.equal(calls,2);
});
test('coordinates parsed and malformed responses rejected',async()=>{
 const search=createSearch({endpoint,storage:null,fetcher:async()=>response([{lon:'126.7',lat:'37.4',display_name:'송도'}])});assert.deepEqual((await search('송도')).point,[126.7,37.4]);
 const bad=createSearch({endpoint,storage:null,fetcher:async()=>response([{lon:'oops',lat:'37.4'}])});await assert.rejects(bad('a'),/위치/);
});
test('failed search does not cache an empty result',async()=>{
 let time=5000,calls=0;const search=createSearch({endpoint,storage:null,now:()=>time,fetcher:async()=>{calls++;if(calls===1)throw Error('offline');return response([]);}});
 await assert.rejects(search('부평역'),/offline/);time+=1100;assert.equal(await search('부평역'),null);assert.equal(calls,2);
});
