export const VIEW_KEY='incheon-air-return-view-v1';
export function validView(state){
 const point=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
 return !!state&&point(state.center)&&Number.isFinite(state.zoom)&&state.zoom>=0&&state.zoom<=24&&Number.isFinite(state.pitch)&&state.pitch>=0&&state.pitch<=85&&Number.isFinite(state.bearing)&&(state.selection===null||point(state.selection))&&(state.name===null||typeof state.name==='string');
}
export function saveView(storage,state){try{if(validView(state))storage.setItem(VIEW_KEY,JSON.stringify(state));}catch{}}
export function takeView(storage){try{const raw=storage.getItem(VIEW_KEY);storage.removeItem(VIEW_KEY);const state=JSON.parse(raw);return validView(state)?state:null;}catch{return null;}}
