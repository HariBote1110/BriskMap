import { programme } from './gl.mjs';
import { viewProjection } from './view.mjs';
import { colourFor } from './colour.mjs';
import { flatMaterials } from './materials.mjs';

const vertexSource = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in uvec3 position;
layout(location=1) in uint normalIndex;
layout(location=2) in uint ambientOcclusion;
layout(location=3) in uint textureLayer;
layout(location=4) in uint tintIndex;
layout(location=5) in uint materialFlags;
uniform mat4 viewProjectionMatrix;
uniform vec3 chunkOffset;
out vec2 vertexUv;
out float vertexLight;
flat out uint vertexLayer;
flat out uint vertexTint;
flat out uint vertexFlags;
flat out uint vertexNormal;
void main(){
  vec3 world=vec3(position)+chunkOffset;
  if(normalIndex==0u)vertexUv=vec2(world.z,-world.y);
  else if(normalIndex==1u)vertexUv=vec2(-world.z,-world.y);
  else if(normalIndex==2u)vertexUv=vec2(world.x,world.z);
  else if(normalIndex==3u)vertexUv=vec2(world.x,-world.z);
  else if(normalIndex==4u)vertexUv=vec2(-world.x,-world.y);
  else vertexUv=vec2(world.x,-world.y);
  const float faceLight[8]=float[8](0.6,0.6,0.5,1.0,0.8,0.8,0.85,0.85);
  const float aoLight[4]=float[4](0.5,0.7,0.85,1.0);
  vertexLight=faceLight[int(normalIndex)]*aoLight[int(ambientOcclusion)];
  vertexLayer=textureLayer;vertexTint=tintIndex;vertexFlags=materialFlags;vertexNormal=normalIndex;
  gl_Position=viewProjectionMatrix*vec4(world,1.0);
}`;
const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
in vec2 vertexUv;
in float vertexLight;
flat in uint vertexLayer;
flat in uint vertexTint;
flat in uint vertexFlags;
flat in uint vertexNormal;
uniform sampler2DArray tileArray;
uniform sampler2D flatColours;
uniform bool flatShading;
out vec4 outputColour;
void main(){
  vec4 colour=flatShading?texelFetch(flatColours,ivec2(int(vertexLayer),0),0):texture(tileArray,vec3(vertexUv,float(vertexLayer)));
  if((vertexFlags&1u)!=0u&&colour.a<0.5)discard;
  const vec3 tints[5]=vec3[5](vec3(1.0),vec3(145.0,189.0,89.0)/255.0,vec3(119.0,171.0,47.0)/255.0,vec3(63.0,118.0,228.0)/255.0,vec3(1.0));
  const vec3 normals[8]=vec3[8](vec3(-1,0,0),vec3(1,0,0),vec3(0,-1,0),vec3(0,1,0),vec3(0,0,-1),vec3(0,0,1),normalize(vec3(1,0,-1)),normalize(vec3(1,0,1)));
  float oldLight=0.55+0.45*max(dot(normals[int(vertexNormal)],normalize(vec3(0.3,1.0,0.5))),0.0);
  float light=flatShading?oldLight:vertexLight;
  outputColour=vec4(colour.rgb*(flatShading?vec3(1.0):tints[int(vertexTint)])*light,colour.a);
}`;

export class Renderer3D {
  constructor(gl) {
    this.gl = gl;
    this.program = programme(gl, vertexSource, fragmentSource);
    this.matrix = gl.getUniformLocation(this.program, 'viewProjectionMatrix');
    this.offset = gl.getUniformLocation(this.program, 'chunkOffset');
    this.flat = gl.getUniformLocation(this.program, 'flatShading');
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, 'tileArray'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'flatColours'), 1);
    this.meshes = new Map();
    this.flatLayers = new Map();
    this.flatPixels = [];
    this.atlas = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.of(255,255,255,255));
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.flatTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flatTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.of(255,255,255,255));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.textured = false;
    this.stateDirty = true;
  }

  invalidateState() { this.stateDirty = true; }

  useTextures(table, bitmap) {
    const gl = this.gl;
    if (table.format !== 1 || table.tile !== 16 || !Number.isInteger(table.layers) || table.layers < 1 || table.layers !== table.textures?.length || bitmap.width !== 16 || bitmap.height !== table.layers * 16 || table.layers > gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)) throw new Error('Invalid atlas dimensions');
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    try {
      const started = performance.now();
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 5, gl.RGBA8, 16, 16, table.layers);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 16, 16, table.layers, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      const uploadMs = performance.now() - started;
      gl.deleteTexture(this.atlas);
      this.atlas = texture;
      this.textured = true;
      this.invalidateState();
      return { bytes: table.layers * 1024, uploadMs };
    } catch (error) {
      gl.deleteTexture(texture);
      throw error;
    }
  }

  registerFlatPalette(palette) {
    const materials = flatMaterials(palette, state => {
      let layer = this.flatLayers.get(state);
      if (layer === undefined) {
        layer = this.flatLayers.size;
        if (layer >= this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) throw new Error('Flat colour table is too large');
        this.flatLayers.set(state, layer);
        const hash = colourFor(state);
        this.flatPixels.push(hash & 255, hash >>> 8 & 255, hash >>> 16 & 255, 255);
      }
      return layer;
    });
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flatTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, Math.max(1,this.flatLayers.size), 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.flatPixels.length ? Uint8Array.from(this.flatPixels) : Uint8Array.of(255,255,255,255));
    return materials;
  }

  uploadMesh(key, cx, cz, data) {
    const gl = this.gl;
    this.remove(key);
    if(data.indices.byteLength===0)return;
    const vao = gl.createVertexArray(), vertices = gl.createBuffer(), indices = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribIPointer(0,3,gl.UNSIGNED_SHORT,12,0);
    gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1,1,gl.UNSIGNED_BYTE,12,6);
    gl.enableVertexAttribArray(2); gl.vertexAttribIPointer(2,1,gl.UNSIGNED_BYTE,12,7);
    gl.enableVertexAttribArray(3); gl.vertexAttribIPointer(3,1,gl.UNSIGNED_SHORT,12,8);
    gl.enableVertexAttribArray(4); gl.vertexAttribIPointer(4,1,gl.UNSIGNED_BYTE,12,10);
    gl.enableVertexAttribArray(5); gl.vertexAttribIPointer(5,1,gl.UNSIGNED_BYTE,12,11);
    this.meshes.set(key,{vao,vertices,indices,cx,cz,count:data.indices.byteLength/4});
  }

  draw(view,width,height) {
    const gl = this.gl;
    if(this.stateDirty){
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clearColor(125/255,171/255,1,1);
      gl.useProgram(this.program);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D_ARRAY,this.atlas);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.flatTexture);
      this.stateDirty=false;
    }
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.matrix,false,new Float32Array(viewProjection(view,width/height)));
    gl.uniform1i(this.flat,this.textured?0:1);
    for (const item of this.meshes.values()) {
      gl.bindVertexArray(item.vao);
      gl.uniform3f(this.offset,item.cx*16,-64,item.cz*16);
      gl.drawElements(gl.TRIANGLES,item.count,gl.UNSIGNED_INT,0);
    }
  }

  remove(key) {
    const item = this.meshes.get(key);
    if (!item) return;
    const gl = this.gl;
    gl.deleteBuffer(item.vertices);
    gl.deleteBuffer(item.indices);
    gl.deleteVertexArray(item.vao);
    this.meshes.delete(key);
  }
  clear() { for (const key of this.meshes.keys()) this.remove(key); }
  dispose() { this.clear(); this.gl.deleteTexture(this.atlas); this.gl.deleteTexture(this.flatTexture); this.gl.deleteProgram(this.program); }
}
