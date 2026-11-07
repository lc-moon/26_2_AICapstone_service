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
