export class WorkerPool {
  constructor(count) {
    this.url=new URL('./worker.mjs',import.meta.url);
    this.workers=[];
    this.queue=[];
    this.sequence=0;
    this.disposed=false;
    this.spawnedAt=performance.now();
    this.firstReadyAt=null;
    this.allReadyAt=null;
    this.readyCount=0;
    this.stats=null;
    this.fetchStartedAt=null;
    for(let index=0;index<count;index++)this.addWorker(index);
  }
  addWorker(index) {
    const worker=new Worker(this.url,{type:'module'});
    const item={worker,busy:null,ready:false,idleSince:null,palettes:new Set(),paletteOrder:[]};
    this.workers[index]=item;
    worker.onmessage=({data})=>{
      if(data.type==='ready'){
        if(!item.ready){
          item.ready=true;
          const now=performance.now();
          this.firstReadyAt??=now;
          this.readyCount++;
          if(this.readyCount===this.workers.length)this.allReadyAt=now;
          if(this.stats){
            this.stats.t_first_worker_ready_ms=this.firstReadyAt;
            this.stats.t_all_workers_ready_ms=this.allReadyAt;
          }
          if(this.fetchStartedAt!==null&&!item.busy)item.idleSince=now;
        }
        return;
      }
      const task=item.busy;
      if(!task||data.id!==task.id)return;
      item.busy=null;
      if(this.fetchStartedAt!==null)item.idleSince=performance.now();
      if(task.stats){
        task.stats.worker_inflate_ms_total+=data.inflateMs??0;
        task.stats.worker_mesh_ms_total+=data.meshMs??0;
      }
      if(data.type==='error')task.reject(new Error(data.message));
      else task.resolve(data);
      this.pump();
    };
    worker.onerror=event=>{
      const task=item.busy;
      item.busy=null;
      if(task)task.reject(new Error(event.message??'Worker failed'));
      worker.terminate();
      if(item.ready)this.readyCount--;
      this.allReadyAt=null;
      if(!this.disposed)this.addWorker(index);
      this.pump();
    };
  }
  track(stats){
    this.stats=stats;
    this.fetchStartedAt=performance.now();
    stats.t_workers_spawned_ms=this.spawnedAt;
    stats.t_first_worker_ready_ms=this.firstReadyAt;
    stats.t_all_workers_ready_ms=this.allReadyAt;
    stats.workers=this.workers.length;
    for(const item of this.workers)item.idleSince=item.ready&&!item.busy?this.fetchStartedAt:null;
  }
  finishTracking(){
    if(this.fetchStartedAt===null)return;
    const now=performance.now();
    for(const item of this.workers){
      if(item.idleSince!==null)this.stats.worker_idle_gaps+=now-item.idleSince;
      item.idleSince=null;
    }
    this.fetchStartedAt=null;
  }
  run(type,data,{palette,transfer=[],tag}={}) {
    if(this.disposed)return Promise.reject(new Error('Worker pool disposed'));
    return new Promise((resolve,reject)=>{
      this.queue.push({id:++this.sequence,type,data,palette,transfer,tag,stats:this.stats,resolve,reject});
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
      if(item.idleSince!==null){this.stats.worker_idle_gaps+=performance.now()-item.idleSince;item.idleSince=null;}
      item.busy=task;
      try{
        if(task.palette&&!item.palettes.has(task.palette.key)){
          if(item.paletteOrder.length>=64){
            const oldest=item.paletteOrder.shift();
            item.palettes.delete(oldest);
            item.worker.postMessage({type:'dropPalette',key:oldest});
          }
          const materials=Object.fromEntries(Object.entries(task.palette.materials).map(([key,value])=>[key,value.slice()]));
          item.worker.postMessage({type:'palette',...task.palette,materials},Object.values(materials).map(value=>value.buffer));
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
