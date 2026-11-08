import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestInference,inferFailure,validateInference} from './infer.mjs';
const sample=JSON.parse(readFileSync(new URL('../shared/mock/infer_ok.json',import.meta.url)));
test('live inference sends one POST with correct camera',async()=>{
 let count=0;const result=await requestInference('10042',{base:'https://example.test',signal:new AbortController().signal,fetcher:async(url,options)=>{count++;assert.equal(url,'https://example.test/api/infer?camera_id=10042');assert.equal(options.method,'POST');return {ok:true,json:async()=>sample};}});
 assert.equal(count,1);assert.equal(result.pm25,14.1);
});
test('busy and unavailable messages differ',()=>{assert.match(inferFailure(409),/다른 분/);assert.match(inferFailure(503),/기존 회차/);});
test('mock rain preserves null and explanatory status',async()=>{
 const rain={...sample,pm25:null,status:'비 — 추정 안 함'};
 const result=await requestInference('10042',{mock:true,scenario:'infer_rain',mockDelay:0,signal:new AbortController().signal,fetcher:async()=>({ok:true,json:async()=>rain})});assert.equal(result.pm25,null);assert.equal(result.status,rain.status);
});
test('mismatched camera and invalid concentration rejected',()=>{assert.throws(()=>validateInference(sample,'other'));assert.throws(()=>validateInference({...sample,pm25:-1},'10042'));});
test('mock busy returns 409 without POST',async()=>{await assert.rejects(requestInference('10042',{mock:true,scenario:'infer_busy',mockDelay:0,signal:new AbortController().signal,fetcher:async()=>({ok:true})}),e=>e.status===409);});
test('F10 night answer without photo is accepted, value with no photo is not',()=>{
 const night={camera_id:'10042',requested_at:'2026-11-08T18:30:00+09:00',captured_at:null,pm25:null,status:'밤 — 추정 안 함',photo_url:null};
 assert.equal(validateInference(night,'10042').status,'밤 — 추정 안 함');
 assert.throws(()=>validateInference({...night,pm25:3},'10042'));
});
