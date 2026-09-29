export class WorkerPool {
  constructor(count) {
    this.url=new URL('./worker.mjs',import.meta.url);
    this.workers=[];
    this.queue=[];
    this.sequence=0;
    this.disposed=false;
    for(let index=0;index<count;index++)this.addWorker(index);
  }
  addWorker(index) {
    const worker=new Worker(this.url,{type:'module'});
    const item={worker,busy:null,palettes:new Set(),paletteOrder:[]};
    this.workers[index]=item;
    worker.onmessage=({data})=>{
      const task=item.busy;
      if(!task||data.id!==task.id)return;
      item.busy=null;
      if(data.type==='error')task.reject(new Error(data.message));
      else task.resolve(data);
      this.pump();
    };
    worker.onerror=event=>{
      const task=item.busy;
      item.busy=null;
      if(task)task.reject(new Error(event.message??'Worker failed'));
      worker.terminate();
      if(!this.disposed)this.addWorker(index);
      this.pump();
    };
  }
  run(type,data,{palette,transfer=[],tag}={}) {
    if(this.disposed)return Promise.reject(new Error('Worker pool disposed'));
    return new Promise((resolve,reject)=>{
      this.queue.push({id:++this.sequence,type,data,palette,transfer,tag,resolve,reject});
      this.pump();
    });
  }
  cancelQueued(predicate){
    const remaining=[];
    for(const task of this.queue){
      if(predicate(task))task.reject(Object.assign(new Error('Worker task cancelled'),{code:'cancelled'}));
      else remaining.push(task);
    }
    this.queue=remaining;
  }
  clearPalettes(){for(const item of this.workers){item.palettes.clear();item.paletteOrder=[];item.worker.postMessage({type:'clearPalettes'});}}
  pump() {
    for(const item of this.workers){
      if(item.busy||!this.queue.length)continue;
      const task=this.queue.shift();
      item.busy=task;
      try{
        if(task.palette&&!item.palettes.has(task.palette.key)){
          if(item.paletteOrder.length>=64){
            const oldest=item.paletteOrder.shift();
            item.palettes.delete(oldest);
            item.worker.postMessage({type:'dropPalette',key:oldest});
          }
          item.worker.postMessage({type:'palette',...task.palette});
          item.palettes.add(task.palette.key);
          item.paletteOrder.push(task.palette.key);
        }
        item.worker.postMessage({id:task.id,type:task.type,...task.data},task.transfer);
      }catch(error){item.busy=null;task.reject(error);queueMicrotask(()=>this.pump());}
    }
  }
  dispose() {
    this.disposed=true;
    this.cancelQueued(()=>true);
    for(const item of this.workers){
      item.busy?.reject(new Error('Worker pool disposed'));
      item.worker.terminate();
    }
    this.workers=[];
  }
}
