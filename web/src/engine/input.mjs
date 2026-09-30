// Camera input on the canvas: pointer, wheel and keyboard events become view changes. All the
// geometry lives in view.mjs; this file only tracks which pointers and keys are down.
import { keyAction, keyMotion, orbitView, panView, twoFingerGesture, twoFingerStep, wheelFactor, zoomView } from './view.mjs';

const DOUBLE_CLICK_ZOOM=2;
const LONGEST_KEY_STEP=.05; // seconds; a stalled frame must not turn into a leap
const UNDECIDED={kind:'pending',zoom:false,twist:false};
const FLAT_ONLY_IN_3D=new Set(['turnLeft','turnRight','tiltUp','tiltDown']);

export function attachInput(canvas,getView,setView) {
  // pointerId -> {x, y, drag}; x and y are CSS pixels relative to the canvas.
  const pointers=new Map();
  // Two-finger gesture: where the first two pointers were when the second one landed, and what
  // the gesture has been classified as since.
  let gesture=null;
  // event.code -> action, for every key currently held.
  const held=new Map();
  let fast=false,frame=null,lastStep=0;

  const previousStyle={touchAction:canvas.style.touchAction,userSelect:canvas.style.userSelect,webkitUserSelect:canvas.style.webkitUserSelect,cursor:canvas.style.cursor};
  canvas.style.touchAction='none';
  canvas.style.userSelect='none';
  canvas.style.webkitUserSelect='none';
  canvas.style.cursor='grab';
  if(!canvas.hasAttribute('tabindex'))canvas.tabIndex=0;

  const metrics=()=>{
    const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight);
    return{width,height,pixelRatio:canvas.width>0?canvas.width/width:1};
  };
  const position=event=>{const box=canvas.getBoundingClientRect();return[event.clientX-box.left,event.clientY-box.top];};
  const firstTwo=()=>[...pointers.values()].slice(0,2).map(pointer=>[pointer.x,pointer.y]);
  const restartGesture=()=>{gesture=pointers.size>=2?{start:firstTwo(),state:UNDECIDED}:null;};
  const apply=(view,next)=>{if(next!==view)setView(next);};

  const pointerDown=event=>{
    canvas.focus({preventScroll:true});
    try{canvas.setPointerCapture(event.pointerId);}catch{/* the pointer is already gone */}
    const [x,y]=position(event);
    const modified=event.ctrlKey||event.shiftKey||event.altKey||event.metaKey;
    const drag=event.pointerType!=='touch'&&(event.button!==0||modified)?'rotate':'pan';
    pointers.set(event.pointerId,{x,y,drag});
    restartGesture();
    canvas.style.cursor='grabbing';
    event.preventDefault();
  };
  const release=event=>{
    if(!pointers.delete(event.pointerId))return;
    try{if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);}catch{/* already released */}
    // The remaining pointers carry on from where they are, so lifting a finger never jumps.
    restartGesture();
    if(pointers.size===0)canvas.style.cursor='grab';
  };
  const pointerMove=event=>{
    const pointer=pointers.get(event.pointerId);
    if(!pointer)return;
    // A mouse button released outside the window never sends pointerup.
    if(event.pointerType==='mouse'&&event.buttons===0){release(event);return;}
    const {width,height,pixelRatio}=metrics();
    const view=getView(),from=[pointer.x,pointer.y],to=position(event);
    event.preventDefault();
    if(gesture){
      const before=firstTwo();
      [pointer.x,pointer.y]=to;
      const after=firstTwo();
      gesture.state=twoFingerGesture(gesture.state,gesture.start,after,view.mode);
      apply(view,twoFingerStep(view,width,height,before,after,gesture.state,pixelRatio));
      return;
    }
    [pointer.x,pointer.y]=to;
    if(pointer.drag==='rotate'&&view.mode==='3d')apply(view,orbitView(view,to[0]-from[0],to[1]-from[1]));
    else apply(view,panView(view,width,height,from,to,pixelRatio));
  };

  const wheel=event=>{
    event.preventDefault();
    const {width,height,pixelRatio}=metrics(),view=getView();
    apply(view,zoomView(view,width,height,position(event),wheelFactor(event,height),pixelRatio));
  };
  const doubleClick=event=>{
    if(event.button!==0)return;
    event.preventDefault();
    const {width,height,pixelRatio}=metrics(),view=getView();
    apply(view,zoomView(view,width,height,position(event),DOUBLE_CLICK_ZOOM,pixelRatio));
  };

  // Held keys move the view once per animation frame, scaled by the real time that passed, so the
  // speed does not depend on the OS key-repeat rate. The loop runs only while a key is held.
  const step=seconds=>{
    const view=getView();
    apply(view,keyMotion(view,held.values(),seconds,{fast,pixelRatio:metrics().pixelRatio}));
  };
  const tick=time=>{
    frame=null;
    if(held.size===0)return;
    step(Math.min(LONGEST_KEY_STEP,Math.max(0,(time-lastStep)/1000)));
    lastStep=time;
    frame=requestAnimationFrame(tick);
  };
  const keyDown=event=>{
    fast=event.shiftKey;
    if(event.ctrlKey||event.metaKey||event.altKey)return;
    const action=keyAction(event.code,event.key);
    if(!action||(getView().mode==='2d'&&FLAT_ONLY_IN_3D.has(action)))return;
    event.preventDefault();
    if(held.has(event.code))return;
    held.set(event.code,action);
    if(frame!==null)return;
    // Move at once, so that even the shortest tap does something.
    step(1/60);
    lastStep=performance.now();
    frame=requestAnimationFrame(tick);
  };
  const keyUp=event=>{fast=event.shiftKey;held.delete(event.code);};
  const releaseKeys=()=>{held.clear();fast=false;};
  // Losing the window (Alt+Tab, a system dialog) swallows pointerup and keyup.
  const releaseAll=()=>{
    releaseKeys();
    for(const pointerId of [...pointers.keys()])release({pointerId});
  };

  const preventDefault=event=>event.preventDefault();
  // Middle-button autoscroll starts on mousedown.
  const mouseDown=event=>{if(event.button===1)event.preventDefault();};

  const listeners=[
    ['pointerdown',pointerDown],['pointermove',pointerMove],['pointerup',release],['pointercancel',release],
    ['lostpointercapture',release],['wheel',wheel,{passive:false}],['dblclick',doubleClick],['mousedown',mouseDown],
    ['keydown',keyDown],['keyup',keyUp],['blur',releaseKeys],['contextmenu',preventDefault],['selectstart',preventDefault],
  ];
  for(const [type,listener,options] of listeners)canvas.addEventListener(type,listener,options);
  globalThis.window?.addEventListener?.('blur',releaseAll);
  return ()=>{
    for(const [type,listener] of listeners)canvas.removeEventListener(type,listener);
    globalThis.window?.removeEventListener?.('blur',releaseAll);
    if(frame!==null)cancelAnimationFrame(frame);
    frame=null;
    held.clear();
    pointers.clear();
    Object.assign(canvas.style,previousStyle);
  };
}
