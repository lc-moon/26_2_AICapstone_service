import test from 'node:test';
import assert from 'node:assert/strict';
import {sunAltitude,themeAt} from './theme.mjs';
test('sun altitude matches server/sun.py',()=>{
 for(const [iso,want] of [['2026-11-09T12:00:00+09:00',35.568],['2026-11-09T17:20:00+09:00',0.582439],['2026-11-09T17:40:00+09:00',-3.138527],['2026-06-21T05:00:00+09:00',-2.926024],['2026-01-01T07:50:00+09:00',-0.426399]])
  assert.ok(Math.abs(sunAltitude(new Date(iso))-want)<1e-4,iso);
});
test('dark only after sunset, and the query can force a theme',()=>{
 assert.equal(themeAt(new Date('2026-11-09T17:20:00+09:00')),'light');
 assert.equal(themeAt(new Date('2026-11-09T17:40:00+09:00')),'dark');
 assert.equal(themeAt(new Date('2026-11-09T17:40:00+09:00'),'?theme=light'),'light');
 assert.equal(themeAt(new Date('2026-11-09T12:00:00+09:00'),'?theme=dark&expo=1'),'dark');
 assert.equal(themeAt(new Date('2026-11-09T12:00:00+09:00'),'?theme=x'),'light');
});
