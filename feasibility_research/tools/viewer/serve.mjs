import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';

const args=process.argv.slice(2);
function option(name,fallback){const index=args.indexOf(`--${name}`);if(index<0)return fallback;if(index+1>=args.length)throw new Error(`Missing --${name} value`);return args[index+1];}
const root=await realpath(option('root',new URL('../',import.meta.url).pathname));
const data=await realpath(option('data',process.cwd()));
const texturesOption=option('textures',null),textures=texturesOption?await realpath(texturesOption):null;
const port=Number(option('port','8200')),host=option('host','0.0.0.0');
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wasm':'application/wasm','.b3d':'application/octet-stream','.png':'image/png'};

createServer(async(req,res)=>{
  const headers={'Cache-Control':'no-store','Accept-Ranges':'bytes'};
  try{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,headers).end();return;}
    const pathname=req.url.split('?')[0];
    let decoded;
    try{decoded=decodeURIComponent(pathname);}catch{res.writeHead(404,headers).end();return;}
    if(!decoded.startsWith('/')||decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').includes('..')){res.writeHead(404,headers).end();return;}
    const isData=decoded==='/data'||decoded.startsWith('/data/');
    const isTexture=decoded==='/textures'||decoded.startsWith('/textures/');
    if(isTexture&&!textures){res.writeHead(404,headers).end();return;}
    const base=isData?data:isTexture?textures:root;
    const local=isData?decoded.slice(6):isTexture?decoded.slice(10):decoded.slice(1);
    const candidate=resolve(base,local);
    const rel=relative(base,candidate);
    if(rel==='..'||rel.startsWith(`..${sep}`)){res.writeHead(404,headers).end();return;}
    let filename,info;
    try{filename=await realpath(candidate);const actual=relative(base,filename);if(actual==='..'||actual.startsWith(`..${sep}`)){res.writeHead(404,headers).end();return;}info=await stat(filename);if(!info.isFile())throw new Error('Not a file');}
    catch{res.writeHead(404,headers).end();return;}
    headers['Content-Type']=types[extname(filename)]??'application/octet-stream';
    const size=info.size,range=req.headers.range;
    let start=0,end=size-1,status=200;
    if(range!==undefined){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||!match[1]&&!match[2]){res.writeHead(416,{...headers,'Content-Range':`bytes */${size}`}).end();return;}
      if(match[1]){start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
      else {const suffix=Number(match[2]);start=Math.max(0,size-suffix);end=size-1;}
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||start>end||size===0){res.writeHead(416,{...headers,'Content-Range':`bytes */${size}`}).end();return;}
      end=Math.min(end,size-1);status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length']=status===206?end-start+1:size;
    res.writeHead(status,headers);
    if(req.method==='HEAD'||size===0){res.end();return;}
    createReadStream(filename,{start,end}).on('error',()=>res.destroy()).pipe(res);
  }catch(error){if(!res.headersSent)res.writeHead(500,headers).end();else res.destroy();console.error(error);}
}).listen(port,host,()=>console.log(`Serving on http://${host}:${port}`));
