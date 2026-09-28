export function cameraPosition({ x, y, z, distance, rotation, angle }) {
  return { x: x - Math.sin(rotation) * distance * Math.sin(angle), y: y + distance * Math.cos(angle), z: z + Math.cos(rotation) * distance * Math.sin(angle) };
}

function multiply(a, b) {
  const result = new Float64Array(16);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 4; k++) result[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
  }
  return result;
}

export function viewProjection(camera, aspect) {
  const eye = cameraPosition(camera);
  const forward = [camera.x - eye.x, camera.y - eye.y, camera.z - eye.z];
  const fl = Math.hypot(...forward); for (let i = 0; i < 3; i++) forward[i] /= fl;
  let right = [-forward[2], 0, forward[0]];
  let rl = Math.hypot(...right);
  if (rl < 1e-12) { right = [1, 0, 0]; rl = 1; }
  for (let i = 0; i < 3; i++) right[i] /= rl;
  const up = [right[1]*forward[2]-right[2]*forward[1], right[2]*forward[0]-right[0]*forward[2], right[0]*forward[1]-right[1]*forward[0]];
  const view = new Float64Array([
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -(right[0]*eye.x+right[1]*eye.y+right[2]*eye.z), -(up[0]*eye.x+up[1]*eye.y+up[2]*eye.z), forward[0]*eye.x+forward[1]*eye.y+forward[2]*eye.z, 1
  ]);
  const f = 1 / Math.tan(75 * Math.PI / 360), near = 0.12, far = 2000;
  const projection = new Float64Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0]);
  return multiply(projection, view);
}

export function projectPoint(matrix, [x,y,z]) {
  const w = matrix[3]*x + matrix[7]*y + matrix[11]*z + matrix[15];
  return [(matrix[0]*x+matrix[4]*y+matrix[8]*z+matrix[12])/w, (matrix[1]*x+matrix[5]*y+matrix[9]*z+matrix[13])/w, (matrix[2]*x+matrix[6]*y+matrix[10]*z+matrix[14])/w];
}
