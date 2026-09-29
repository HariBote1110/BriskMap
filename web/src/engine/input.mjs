import { dragView, keyView, pinchView, wheelScale } from './view.mjs';

export function attachInput(canvas,getView,setView) {
  const pointers=new Map();
  const previousTouchAction=canvas.style.touchAction;
  canvas.style.touchAction='none';
  if(!canvas.hasAttribute('tabindex'))canvas.tabIndex=0;
  const size=()=>[Math.max(1,canvas.clientWidth),Math.max(1,canvas.clientHeight)];
  const pointerDown=event=>{
    canvas.focus({preventScroll:true});
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY,button:event.button});
    event.preventDefault();
  };
  const pointerMove=event=>{
    const old=pointers.get(event.pointerId);
    if(!old)return;
    const before=[...pointers.values()];
    const dx=event.clientX-old.x,dy=event.clientY-old.y;
    pointers.set(event.pointerId,{...old,x:event.clientX,y:event.clientY});
    const current=[...pointers.values()];
    const [width,height]=size();
    let view=getView();
    if(current.length>=2){
      const oldDistance=Math.hypot(before[0].x-before[1].x,before[0].y-before[1].y);
      const newDistance=Math.hypot(current[0].x-current[1].x,current[0].y-current[1].y);
      const midX=((current[0].x+current[1].x)-(before[0].x+before[1].x))/2;
      const midY=((current[0].y+current[1].y)-(before[0].y+before[1].y))/2;
      view=dragView(view,midX,midY,'pan',width,height);
      if(oldDistance>0&&newDistance>0)view=pinchView(view,newDistance/oldDistance);
    }else view=dragView(view,dx,dy,old.button===2?'pan':'orbit',width,height);
    setView(view);
    event.preventDefault();
  };
  const pointerUp=event=>{pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);};
  const wheel=event=>{
    const multiplier=event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1;
    setView(wheelScale(getView(),event.deltaY*multiplier));
    event.preventDefault();
  };
  const keyDown=event=>{
    const view=getView(),next=keyView(view,event.code);
    if(next!==view){setView(next);event.preventDefault();}
  };
  const contextMenu=event=>event.preventDefault();
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('pointercancel',pointerUp);
  canvas.addEventListener('wheel',wheel,{passive:false});
  canvas.addEventListener('keydown',keyDown);
  canvas.addEventListener('contextmenu',contextMenu);
  return ()=>{
    canvas.removeEventListener('pointerdown',pointerDown);
    canvas.removeEventListener('pointermove',pointerMove);
    canvas.removeEventListener('pointerup',pointerUp);
    canvas.removeEventListener('pointercancel',pointerUp);
    canvas.removeEventListener('wheel',wheel);
    canvas.removeEventListener('keydown',keyDown);
    canvas.removeEventListener('contextmenu',contextMenu);
    canvas.style.touchAction=previousTouchAction;
  };
}
