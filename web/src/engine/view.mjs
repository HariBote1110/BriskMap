const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
export function normaliseView(spawn,mapId,mode,partial={}){const v={mode,mapId,x:spawn.x??spawn[0],y:spawn.y??spawn[1],z:spawn.z??spawn[2],yaw:0,pitch:45,distance:120,zoom:1,...partial,mode,mapId};for(const key of ['x','y','z','yaw','pitch','distance','zoom'])if(!Number.isFinite(v[key]))throw new Error(`Invalid ${key}`);v.pitch=clamp(v.pitch,10,89);v.distance=clamp(v.distance,8,1024);v.zoom=clamp(v.zoom,1/16,16);return v;}
export function cameraPosition({x,y,z,yaw,pitch,distance}){const a=yaw*Math.PI/180,b=pitch*Math.PI/180;return{x:x-Math.sin(a)*distance*Math.cos(b),y:y+distance*Math.sin(b),z:z+Math.cos(a)*distance*Math.cos(b)};}
function multiply(a,b){const out=new Float64Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out;}
export function viewProjection(v,aspect){const e=cameraPosition(v),f=[v.x-e.x,v.y-e.y,v.z-e.z],fl=Math.hypot(...f);for(let i=0;i<3;i++)f[i]/=fl;let r=[-f[2],0,f[0]],rl=Math.hypot(...r);if(rl<1e-12){r=[1,0,0];rl=1;}for(let i=0;i<3;i++)r[i]/=rl;const u=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]],m=new Float64Array([r[0],u[0],-f[0],0,r[1],u[1],-f[1],0,r[2],u[2],-f[2],0,-(r[0]*e.x+r[1]*e.y+r[2]*e.z),-(u[0]*e.x+u[1]*e.y+u[2]*e.z),f[0]*e.x+f[1]*e.y+f[2]*e.z,1]),s=FOV_SCALE,n=.12,far=2000;return multiply(new Float64Array([s/aspect,0,0,0,0,s,0,0,0,0,(far+n)/(n-far),-1,0,0,2*far*n/(n-far),0]),m);}
export function projectPoint(m,[x,y,z]){const w=m[3]*x+m[7]*y+m[11]*z+m[15];return[(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w];}

// ---- camera controls ---------------------------------------------------------------------------
// Pure view maths behind input.mjs. Screen points are CSS pixels relative to the canvas, [x, y]
// with y down. The ground is the horizontal plane through the focus (y = view.y). `pixelRatio` is
// device pixels per CSS pixel: the 2D renderer draws one block as `zoom` device pixels.

const RAD=Math.PI/180;
const FOV_SCALE=1/Math.tan(75*Math.PI/360);
// Rays that would reach the ground further than this many orbit distances from the eye (near and
// above the horizon) are replaced by a straight-line continuation, so a drag there cannot fling
// the map.
const GROUND_REACH=2.5;
const ORBIT_YAW=.35,ORBIT_PITCH=.25;             // degrees per CSS pixel of a rotate drag
const TOUCH_TILT=.3;                             // degrees per CSS pixel of a two-finger tilt
const WHEEL_GAIN=.0012,WHEEL_LIMIT=150;          // one 100 px mouse notch is about 13 %
const PINCH_WHEEL_GAIN=.01,PINCH_WHEEL_LIMIT=40; // Ctrl + wheel: a trackpad pinch
const LINE_PIXELS=100/3;                         // deltaMode 1: three lines are one notch
const KEY_PAN=1,KEY_PAN_PIXELS=600,KEY_TURN=90,KEY_TILT=60,KEY_ZOOM=1.5,KEY_FAST=3; // per second
const TILT_START=8,PAN_START=14,PINCH_START=12,TWIST_START=10*RAD;

const clampPitch=pitch=>clamp(pitch,10,89);
const verticalTangent=(height,py)=>(1-2*py/height)/FOV_SCALE;

/** True when the cursor row looks at the ground, false on or above the horizon (always true in 2D). */
export function hitsGround(v,height,py){return v.mode==='2d'||verticalTangent(height,py)<Math.tan(v.pitch*RAD);}

/** Offset [dx, dz] in blocks from the focus to the ground point under a screen point. */
export function groundOffset(v,width,height,[px,py],pixelRatio=1){
  if(v.mode==='2d'){const scale=pixelRatio/v.zoom;return[(px-width/2)*scale,(py-height/2)*scale];}
  const a=v.yaw*RAD,b=v.pitch*RAD,sa=Math.sin(a),ca=Math.cos(a),sb=Math.sin(b),cb=Math.cos(b),d=v.distance;
  // The ray is forward + tx·right + ty·up; it meets the ground at t = d·sin(pitch) / -ray.y.
  const tx=(2*px/width-1)*width/height/FOV_SCALE,tyRaw=verticalTangent(height,py);
  const tyLimit=sb/cb*(1-1/GROUND_REACH),ty=Math.min(tyRaw,tyLimit);
  const t=d*sb/(sb-cb*ty);
  let ahead=t*(cb+ty*sb)-d*cb,aside=t*tx;
  if(tyRaw>tyLimit){
    // Above the limit row: continue with the slope the exact solution has on that row.
    const slope=t*t*cb/(d*sb),extra=tyRaw-tyLimit;
    ahead+=extra*(slope*(cb+ty*sb)+t*sb);
    aside+=extra*slope*tx;
  }
  return[ahead*sa+aside*ca,aside*sa-ahead*ca];
}

/** Grab the ground: moves the focus so that the ground under `from` ends up under `to`. */
export function panView(v,width,height,from,to,pixelRatio=1){
  const a=groundOffset(v,width,height,from,pixelRatio),b=groundOffset(v,width,height,to,pixelRatio);
  return{...v,x:v.x+a[0]-b[0],z:v.z+a[1]-b[1]};
}

/** Rotate drag around the focus: right turns the near world to the right, down tilts towards top-down. */
export function orbitView(v,dx,dy){return v.mode==='2d'?v:{...v,yaw:v.yaw+dx*ORBIT_YAW,pitch:clampPitch(v.pitch+dy*ORBIT_PITCH)};}

/** Zooms by `scale` (> 1 is closer) keeping the ground under `point` in place; the screen centre
 *  when `point` is null or above the horizon. */
export function zoomView(v,width,height,point,scale,pixelRatio=1){
  const flat=v.mode==='2d';
  const zoom=flat?clamp(v.zoom*scale,1/16,16):v.zoom,distance=flat?v.distance:clamp(v.distance/scale,8,1024);
  // Offsets from the focus shrink with 1/zoom in 2D and grow with the distance in 3D.
  const keep=flat?v.zoom/zoom:distance/v.distance;
  const [dx,dz]=point&&hitsGround(v,height,point[1])?groundOffset(v,width,height,point,pixelRatio):[0,0];
  return{...v,x:v.x+dx*(1-keep),z:v.z+dz*(1-keep),zoom,distance};
}

/** Turns the view by `degrees` (clockwise seen from above) around the ground under `point`. */
export function rotateView(v,width,height,point,degrees){
  if(v.mode==='2d')return v;
  const [dx,dz]=groundOffset(v,width,height,point),c=Math.cos(degrees*RAD),s=Math.sin(degrees*RAD);
  return{...v,x:v.x+dx-(dx*c-dz*s),z:v.z+dz-(dx*s+dz*c),yaw:v.yaw+degrees};
}

/** Zoom factor for a wheel event: proportional for small (trackpad) deltas, bounded per event. */
export function wheelFactor({deltaY,deltaMode,ctrlKey},pageHeight){
  if(!Number.isFinite(deltaY))return 1;
  const pixels=deltaY*(deltaMode===1?LINE_PIXELS:deltaMode===2?pageHeight:1);
  return ctrlKey?Math.exp(-clamp(pixels,-PINCH_WHEEL_LIMIT,PINCH_WHEEL_LIMIT)*PINCH_WHEEL_GAIN)
    :Math.exp(-clamp(pixels,-WHEEL_LIMIT,WHEEL_LIMIT)*WHEEL_GAIN);
}

const KEY_ACTIONS={
  ArrowUp:'forward',KeyW:'forward',ArrowDown:'back',KeyS:'back',ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',
  KeyQ:'turnLeft',KeyE:'turnRight',KeyR:'tiltUp',PageUp:'tiltUp',KeyF:'tiltDown',PageDown:'tiltDown',
  NumpadAdd:'zoomIn',NumpadSubtract:'zoomOut',
};
/** The action of a key, or null. Letters go by position (code); + and − by the character typed,
 *  because they sit on different keys on different layouts. */
export function keyAction(code,key){
  if(key==='+'||key==='=')return'zoomIn';
  if(key==='-'||key==='_')return'zoomOut';
  return KEY_ACTIONS[code]??null;
}

/** The view after holding `actions` for `seconds`. Returns `v` itself when nothing applies. */
export function keyMotion(v,actions,seconds,{fast=false,pixelRatio=1}={}){
  const held=new Set(actions),axis=(positive,negative)=>(held.has(positive)?1:0)-(held.has(negative)?1:0);
  const flat=v.mode==='2d',forward=axis('forward','back'),right=axis('right','left'),zoom=axis('zoomIn','zoomOut');
  const turn=flat?0:axis('turnRight','turnLeft'),tilt=flat?0:axis('tiltDown','tiltUp');
  if(!forward&&!right&&!zoom&&!turn&&!tilt)return v;
  const time=seconds*(fast?KEY_FAST:1),length=Math.hypot(forward,right)||1;
  let next=v;
  if(flat){
    const step=KEY_PAN_PIXELS*pixelRatio/v.zoom*time/length;
    next={...v,x:v.x+right*step,z:v.z-forward*step};
  }else{
    const a=v.yaw*RAD,sa=Math.sin(a),ca=Math.cos(a),step=v.distance*KEY_PAN*time/length;
    next={...v,x:v.x+(sa*forward+ca*right)*step,z:v.z+(sa*right-ca*forward)*step,yaw:v.yaw+turn*KEY_TURN*time,pitch:clampPitch(v.pitch+tilt*KEY_TILT*time)};
  }
  return zoom?zoomView(next,1,1,null,Math.exp(zoom*KEY_ZOOM*seconds)):next;
}

const separation=([a,b])=>Math.hypot(b[0]-a[0],b[1]-a[1]);
const middle=([a,b])=>[(a[0]+b[0])/2,(a[1]+b[1])/2];
// Signed change of the direction from the first finger to the second, in radians (clockwise on
// screen is positive), wrapped to -π..π.
function twist(before,after){
  const angle=pair=>Math.atan2(pair[1][1]-pair[0][1],pair[1][0]-pair[0][0]);
  const change=angle(after)-angle(before);
  return change-2*Math.PI*Math.round(change/(2*Math.PI));
}

/**
 * Decides what two fingers are doing. `start` and `now` are [[ax, ay], [bx, by]]; `state` is
 * { kind: 'pending' | 'tilt' | 'transform', zoom, twist }, starting as pending / false / false.
 * A gesture becomes a tilt (3D only: fingers side by side, both moving the same way vertically) or
 * a transform (pan, plus zoom once the fingers spread, plus twist once they turn) and then keeps
 * its kind until a finger lifts, so a pinch never tilts and a two-finger drag never zooms.
 */
export function twoFingerGesture(state,start,now,mode){
  if(state.kind==='tilt')return state;
  const spread=Math.abs(separation(now)-separation(start)),turned=Math.abs(twist(start,now));
  let kind=state.kind;
  if(kind==='pending'){
    const moves=[0,1].map(i=>[now[i][0]-start[i][0],now[i][1]-start[i][1]]);
    const vertical=moves.every(([dx,dy])=>Math.abs(dy)>=TILT_START&&Math.abs(dy)>=1.5*Math.abs(dx));
    const sideBySide=Math.abs(start[0][1]-start[1][1])<=Math.abs(start[0][0]-start[1][0]);
    const [m0,m1]=[middle(start),middle(now)];
    if(mode==='3d'&&sideBySide&&vertical&&moves[0][1]*moves[1][1]>0&&spread<PINCH_START)return{kind:'tilt',zoom:false,twist:false};
    if(spread>=PINCH_START||turned>=TWIST_START||Math.hypot(m1[0]-m0[0],m1[1]-m0[1])>=PAN_START)kind='transform';
    else return state;
  }
  const zoom=state.zoom||spread>=PINCH_START,twisting=state.twist||(mode==='3d'&&turned>=TWIST_START);
  return kind===state.kind&&zoom===state.zoom&&twisting===state.twist?state:{kind,zoom,twist:twisting};
}

/** Applies the movement of two fingers from `before` to `after` for a gesture state. */
export function twoFingerStep(v,width,height,before,after,state,pixelRatio=1){
  if(state.kind==='tilt'){
    const dy=middle(after)[1]-middle(before)[1];
    return v.mode==='2d'?v:{...v,pitch:clampPitch(v.pitch+dy*TOUCH_TILT)};
  }
  if(state.kind!=='transform')return v;
  const centre=middle(after),from=separation(before),to=separation(after);
  let next=panView(v,width,height,middle(before),centre,pixelRatio);
  if(state.zoom&&from>0&&to>0)next=zoomView(next,width,height,centre,to/from,pixelRatio);
  // Fingers turning clockwise turn the world clockwise, which is the view turning anticlockwise.
  if(state.twist)next=rotateView(next,width,height,centre,-twist(before,after)/RAD);
  return next;
}
