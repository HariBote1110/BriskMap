import { programme } from './gl.mjs';

const vertexSource = `#version 300 es
precision highp float;
uniform vec2 focus;
uniform vec2 viewport;
uniform vec2 regionOrigin;
uniform float zoom;
out vec2 uv;
void main(){
  vec2 corner=vec2(float(gl_VertexID&1),float(gl_VertexID>>1));
  vec2 world=regionOrigin+corner*512.0;
  vec2 screen=(world-focus)*zoom*2.0/viewport;
  gl_Position=vec4(screen.x,-screen.y,0.0,1.0);
  uv=corner;
}`;
const fragmentSource = `#version 300 es
precision highp float;
uniform sampler2D regionTexture;
in vec2 uv;
out vec4 outputColour;
void main(){
  outputColour=texture(regionTexture,uv);
  if(outputColour.a<0.5)discard;
}`;

export class Renderer2D {
  constructor(gl) {
    this.gl=gl;
    this.program=programme(gl,vertexSource,fragmentSource);
    this.vao=gl.createVertexArray();
    this.focus=gl.getUniformLocation(this.program,'focus');
    this.viewport=gl.getUniformLocation(this.program,'viewport');
    this.origin=gl.getUniformLocation(this.program,'regionOrigin');
    this.zoom=gl.getUniformLocation(this.program,'zoom');
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program,'regionTexture'),0);
    this.regions=new Map();
  }
  uploadRegion(key,rx,rz,pixels) {
    const gl=this.gl;
    this.remove(key);
    const texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,512,512,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.regions.set(key,{texture,rx,rz,lastUsed:performance.now()});
  }
  updateNorthRow(key,pixels){
    const item=this.regions.get(key);
    if(!item)return;
    const gl=this.gl;
    gl.bindTexture(gl.TEXTURE_2D,item.texture);
    gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  draw(view,width,height,visible) {
    const gl=this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(125/255,171/255,1,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.focus,view.x,view.z);
    gl.uniform2f(this.viewport,width,height);
    gl.uniform1f(this.zoom,view.zoom);
    for(const key of visible){
      const item=this.regions.get(key);
      if(!item)continue;
      item.lastUsed=performance.now();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,item.texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,view.zoom>=1?gl.NEAREST:gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,view.zoom>=1?gl.NEAREST:gl.LINEAR);
      gl.uniform2f(this.origin,item.rx*512,item.rz*512);
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    }
  }
  remove(key){const item=this.regions.get(key);if(item){this.gl.deleteTexture(item.texture);this.regions.delete(key);}}
  trim(keep,limit=64){if(this.regions.size<=limit)return;const candidates=[...this.regions].filter(([key])=>!keep.has(key)).sort((a,b)=>a[1].lastUsed-b[1].lastUsed);for(const [key] of candidates){if(this.regions.size<=limit)break;this.remove(key);}if(this.regions.size>limit){for(const [key] of [...this.regions].sort((a,b)=>a[1].lastUsed-b[1].lastUsed)){if(this.regions.size<=limit)break;this.remove(key);}}}
  clear(){for(const key of this.regions.keys())this.remove(key);}
  dispose(){this.clear();this.gl.deleteVertexArray(this.vao);this.gl.deleteProgram(this.program);}
}
