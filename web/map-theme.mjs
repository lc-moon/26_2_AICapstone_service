// 밤에는 바탕 지도(OpenFreeMap liberty)를 무채색으로 덮어 칠하고, 낮에는 원래 색 그대로 둔다(글자만 칠한다). 색 값은 style.css의 --map-* 변수에만 있다
import {token} from './theme.mjs';
const MAJOR=/motorway|trunk_primary/;

function paints(layer,c){
 const {id,type}=layer;
 if(type==='background')return {'background-color':c.area};
 if(type==='raster')return {'raster-opacity':0};
 if(type==='fill-extrusion')return {'fill-extrusion-color':c.building};
 if(type==='fill'){
  if(id==='water')return {'fill-color':c.water};
  if(id==='building')return {'fill-color':c.building,'fill-outline-color':c.building};
  if(layer.paint?.['fill-pattern'])return {'fill-opacity':0};   // 무늬 칠하기는 색을 바꿀 수 없다
  return {'fill-color':c.area,'fill-opacity':1};
 }
 if(type==='line'){
  if(/^waterway/.test(id))return {'line-color':c.water};
  if(/hatching|park_outline/.test(id))return {'line-opacity':0};
  if(/^boundary/.test(id))return {'line-color':c.road};
  if(/casing/.test(id))return {'line-color':c.area};
  return {'line-color':MAJOR.test(id)?c.major:c.road};
 }
 if(type==='symbol')return {'text-color':c.label,'text-halo-color':c.halo,...(/^poi|airport/.test(id)?{'icon-opacity':.45}:{})};
 return {};
}

const original=(layer,props)=>Object.fromEntries(Object.keys(props).map(k=>[k,layer.paint?.[k]]));   // 밤에서 낮으로 돌아올 때 원래 값으로 되돌린다

export function applyMapTheme(map,baseLayers){
 const night=document.documentElement.dataset.theme==='dark';
 const c={area:token('--map-area'),water:token('--map-water'),road:token('--map-road'),major:token('--map-road-major'),building:token('--map-building'),label:token('--map-label'),halo:token('--map-label-halo')};
 for(const layer of baseLayers){if(!map.getLayer(layer.id))continue;const p=paints(layer,c);for(const [property,value] of Object.entries(night||layer.type==='symbol'?p:original(layer,p)))map.setPaintProperty(layer.id,property,value);}
 if(map.getLayer('pick')){map.setPaintProperty('pick','circle-color',token('--ink'));map.setPaintProperty('pick','circle-stroke-color',token('--surf'));}
}
