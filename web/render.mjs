import {colorOf,validValue} from './core.mjs';
const my = lat => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));   // 메르카토르 y
const iy = y => Math.atan(Math.sinh(y)) * 180 / Math.PI;
function frame(L0, L1, B0, B1, W) {
  const H = Math.round(W * (my(B1) - my(B0)) / ((L1 - L0) * Math.PI / 180));
  return {
    W, H, coordinates: [[L0, B1], [L1, B1], [L1, B0], [L0, B0]],
    canvas() { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; },
    lon: i => L0 + (i + .5) / W * (L1 - L0),
    lat: j => iy(my(B1) - (j + .5) / H * (my(B1) - my(B0))),
    px: ([lon, lat]) => [(lon - L0) / (L1 - L0) * W, (my(B1) - my(lat)) / (my(B1) - my(B0)) * H],
  };
}

export function mask(f,geometry) {
  const c=f.canvas(),ctx=c.getContext('2d');
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  for(const rings of polygons){
    ctx.beginPath();
    for(const ring of rings){ring.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](...f.px(p)));ctx.closePath();}
    ctx.fill('evenodd');
  }
  return c;
}
export function cloudImage(grid,values,layout) {
  const {west,east,south,north,rows,cols}=layout;
  // row/col define the data matrix. Paint each API value at its geographic cell;
  // project the row edges to Mercator before blurring (north is at canvas top).
  const matrix=Array.from({length:rows},()=>Array(cols).fill(null));
  grid.cells.forEach((cell,i)=>matrix[cell.row][cell.col]=values[i]);
  const f=frame(west,east,south,north,512), raw=f.canvas(),ctx=raw.getContext('2d');
  const coverage=f.canvas(),cc=coverage.getContext('2d');
  for(const cell of grid.cells){
    const value=matrix[cell.row][cell.col]; if(!validValue(value))continue;
    const [x,y]=f.px([west+cell.col*layout.dx,south+(cell.row+1)*layout.dy]);
    const [xx,yy]=f.px([west+(cell.col+1)*layout.dx,south+cell.row*layout.dy]);
    ctx.fillStyle=`rgba(${colorOf(value).join(',')},.8)`;
    ctx.fillRect(x,y,xx-x+.5,yy-y+.5); cc.fillRect(x,y,xx-x+.5,yy-y+.5);
  }
  const out=f.canvas(),oc=out.getContext('2d');oc.filter='blur(9px)';oc.drawImage(raw,0,0);oc.filter='none';
  oc.globalCompositeOperation='destination-in';oc.drawImage(coverage,0,0);oc.drawImage(mask(f,grid.boundary),0,0);
  return {url:out.toDataURL(),coordinates:f.coordinates};
}
export function veilImage(geometry,bounds) {
  const [[x0,y0],[x1,y1]]=bounds,f=frame(x0-1,x1+1,y0-.8,y1+.8,2400);
  const c=f.canvas(),ctx=c.getContext('2d');ctx.fillStyle='rgba(242,243,245,.9)';ctx.fillRect(0,0,f.W,f.H);
  ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask(f,geometry),0,0);
  return {url:c.toDataURL(),coordinates:f.coordinates};
}
