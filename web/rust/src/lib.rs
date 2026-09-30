use std::sync::{Mutex, OnceLock};
mod inflate;

const VOLUME: usize = 16 * 384 * 16;
const WORDS_PER_FACE: usize = VOLUME / 32;
static SCRATCH: OnceLock<Mutex<Scratch>> = OnceLock::new();
const DIMENSIONS: [usize; 3] = [16, 384, 16];
// Anticlockwise from outside: negative faces 00,01,11,10; positive faces 00,10,11,01.
const CORNER_U: [[usize; 4]; 2] = [[0, 0, 1, 1], [0, 1, 1, 0]];
const CORNER_V: [[usize; 4]; 2] = [[0, 1, 1, 0], [0, 0, 1, 1]];

struct Scratch {
    cells: Vec<u32>,
    keys: Vec<u32>,
    ao_grid: Vec<u8>,
    present: Vec<u32>,
}
impl Scratch {
    fn new() -> Self {
        Self {
            cells: vec![0; VOLUME],
            keys: vec![0; 6 * VOLUME],
            ao_grid: vec![0; 6 * VOLUME],
            present: vec![0; 6 * WORDS_PER_FACE],
        }
    }
}

struct Materials<'a> {
    face_layers: &'a [u8],
    face_tints: &'a [u8],
    opaque: &'a [u8],
    alpha_test: &'a [u8],
    shape: &'a [u8],
}
struct Output {
    vertices: Vec<u8>,
    indices: Vec<u8>,
    quads: u32,
}
impl Output {
    fn new() -> Self {
        Self {
            vertices: Vec::with_capacity(4096),
            indices: Vec::with_capacity(4096),
            quads: 0,
        }
    }
    fn vertex(&mut self, x: usize, y: usize, z: usize, normal: u8, ao: u8, key: u32) {
        self.vertices.extend_from_slice(&(x as u16).to_le_bytes());
        self.vertices.extend_from_slice(&(y as u16).to_le_bytes());
        self.vertices.extend_from_slice(&(z as u16).to_le_bytes());
        self.vertices.push(normal);
        self.vertices.push(ao);
        self.vertices.extend_from_slice(&(key as u16).to_le_bytes());
        self.vertices.push((key >> 16) as u8);
        self.vertices.push((key >> 24) as u8);
    }
    fn quad(
        &mut self,
        axis: usize,
        direction: usize,
        slice: usize,
        u0: usize,
        v0: usize,
        width: usize,
        height: usize,
        key: u32,
        packed_ao: u8,
    ) {
        let normal = (axis * 2 + direction) as u8;
        let plane = slice + direction;
        let u1 = u0 + width;
        let v1 = v0 + height;
        let base = (self.vertices.len() / 12) as u32;
        for corner in 0..4 {
            let u = if CORNER_U[direction][corner] != 0 {
                u1
            } else {
                u0
            };
            let v = if CORNER_V[direction][corner] != 0 {
                v1
            } else {
                v0
            };
            let ao = (packed_ao >> (corner * 2)) & 3;
            match axis {
                0 => self.vertex(plane, u, v, normal, ao, key),
                1 => self.vertex(v, plane, u, normal, ao, key),
                _ => self.vertex(u, v, plane, normal, ao, key),
            }
        }
        let flipped = ((packed_ao & 3) + ((packed_ao >> 4) & 3))
            < (((packed_ao >> 2) & 3) + ((packed_ao >> 6) & 3));
        let pattern = if flipped {
            [0, 1, 3, 1, 2, 3]
        } else {
            [0, 1, 2, 0, 2, 3]
        };
        for index in pattern {
            self.indices
                .extend_from_slice(&(base + index).to_le_bytes());
        }
        self.quads += 1;
    }
    fn cross_quad(&mut self, x0: usize, z0: usize, x1: usize, z1: usize, y: usize, normal: u8, reverse: bool, key: u32) {
        let base = (self.vertices.len() / 12) as u32;
        let corners = if reverse {
            [(x1, y, z1), (x1, y + 1, z1), (x0, y + 1, z0), (x0, y, z0)]
        } else {
            [(x0, y, z0), (x0, y + 1, z0), (x1, y + 1, z1), (x1, y, z1)]
        };
        for (x, y, z) in corners { self.vertex(x, y, z, normal, 3, key); }
        for index in [0, 1, 2, 0, 2, 3] { self.indices.extend_from_slice(&(base + index).to_le_bytes()); }
        self.quads += 1;
    }
}
fn solid(cells: &[u32], opaque: &[u8], x: i32, y: i32, z: i32) -> u8 {
    if !(0..16).contains(&x) || !(0..384).contains(&y) || !(0..16).contains(&z) {
        return 0;
    }
    let entry = cells[x as usize + y as usize * 256 + z as usize * 16];
    if entry != 0 && opaque[(entry - 1) as usize] != 0 {
        1
    } else {
        0
    }
}
unsafe fn mesh_raw(
    positions_ptr: *const u8,
    palettes_ptr: *const u8,
    masks: &[u8],
    count: usize,
    materials: Materials<'_>,
    greedy: bool,
) -> Result<Output, u32> {
    let palette_count = materials.opaque.len();
    if materials.face_layers.len() != palette_count * 12
        || materials.face_tints.len() != palette_count * 6
        || materials.alpha_test.len() != palette_count
        || materials.shape.len() != palette_count
    {
        return Err(1);
    }
    let mut scratch = SCRATCH
        .get_or_init(|| Mutex::new(Scratch::new()))
        .lock()
        .unwrap();
    let Scratch {
        cells,
        keys,
        ao_grid,
        present,
    } = &mut *scratch;
    cells.fill(0);
    present.fill(0);
    for i in 0..count {
        let p = positions_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        let palette = palettes_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        let mask = masks[i];
        if p >= VOLUME || palette >= palette_count || mask == 0 || mask & 0xc0 != 0 {
            return Err(2);
        }
        cells[p] = palette as u32 + 1;
    }
    for i in 0..count {
        let p = positions_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        let palette = palettes_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        let mask = masks[i];
        if materials.shape[palette] == 1 { continue; }
        let xyz = [(p & 15) as i32, (p >> 8) as i32, ((p >> 4) & 15) as i32];
        for normal in 0..6 {
            if mask & (1 << normal) == 0 {
                continue;
            }
            let axis = normal / 2;
            let direction = normal & 1;
            let u_axis = (axis + 1) % 3;
            let v_axis = (axis + 2) % 3;
            let mut coords = xyz;
            coords[axis] += if direction != 0 { 1 } else { -1 };
            let mut packed_ao = 0u8;
            for corner in 0..4 {
                let du = if CORNER_U[direction][corner] != 0 {
                    1
                } else {
                    -1
                };
                let dv = if CORNER_V[direction][corner] != 0 {
                    1
                } else {
                    -1
                };
                let mut point = coords;
                point[u_axis] += du;
                let s1 = solid(&cells, materials.opaque, point[0], point[1], point[2]);
                point = coords;
                point[v_axis] += dv;
                let s2 = solid(&cells, materials.opaque, point[0], point[1], point[2]);
                point[u_axis] += du;
                let diagonal = solid(&cells, materials.opaque, point[0], point[1], point[2]);
                let ao = if s1 != 0 && s2 != 0 {
                    0
                } else {
                    3 - s1 - s2 - diagonal
                };
                packed_ao |= ao << (corner * 2);
            }
            let x = xyz[0] as usize;
            let y = xyz[1] as usize;
            let z = xyz[2] as usize;
            let rank = match axis {
                0 => (x * 16 + z) * 384 + y,
                1 => (y * 16 + x) * 16 + z,
                _ => (z * 384 + y) * 16 + x,
            };
            let at = normal * VOLUME + rank;
            let face = palette * 6 + normal;
            let layer = u16::from_le_bytes([
                materials.face_layers[face * 2],
                materials.face_layers[face * 2 + 1],
            ]) as u32;
            keys[at] = layer
                | (materials.face_tints[face] as u32) << 16
                | (materials.alpha_test[palette] as u32) << 24;
            ao_grid[at] = packed_ao;
            present[normal * WORDS_PER_FACE + rank / 32] |= 1 << (rank % 32);
        }
    }
    let mut output = Output::new();
    for axis in 0..3 {
        for direction in 0..2 {
            let normal = axis * 2 + direction;
            let base = normal * VOLUME;
            let word_base = normal * WORDS_PER_FACE;
            let u_axis = (axis + 1) % 3;
            let v_axis = (axis + 2) % 3;
            let u_limit = DIMENSIONS[u_axis];
            let v_limit = DIMENSIONS[v_axis];
            let slice_size = u_limit * v_limit;
            for word in 0..WORDS_PER_FACE {
                while present[word_base + word] != 0 {
                    let rank = word * 32 + present[word_base + word].trailing_zeros() as usize;
                    let slice = rank / slice_size;
                    let remainder = rank - slice * slice_size;
                    let v = remainder / u_limit;
                    let u = remainder - v * u_limit;
                    let at = base + rank;
                    let key = keys[at];
                    let packed_ao = ao_grid[at];
                    let mut width = 1;
                    let mut height = 1;
                    if greedy {
                        while u + width < u_limit
                            && (present[word_base + (rank + width) / 32]
                                & (1 << ((rank + width) % 32)))
                                != 0
                            && keys[at + width] == key
                            && ao_grid[at + width] == packed_ao
                        {
                            width += 1;
                        }
                        'height: while v + height < v_limit {
                            for w in 0..width {
                                let next_rank = rank + height * u_limit + w;
                                let next = base + next_rank;
                                if (present[word_base + next_rank / 32] & (1 << (next_rank % 32)))
                                    == 0
                                    || keys[next] != key
                                    || ao_grid[next] != packed_ao
                                {
                                    break 'height;
                                }
                            }
                            height += 1;
                        }
                    }
                    for h in 0..height {
                        for w in 0..width {
                            let next_rank = rank + h * u_limit + w;
                            present[word_base + next_rank / 32] &= !(1 << (next_rank % 32));
                        }
                    }
                    output.quad(axis, direction, slice, u, v, width, height, key, packed_ao);
                }
            }
        }
    }
    for i in 0..count {
        let p = positions_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        let palette = palettes_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        if materials.shape[palette] != 1 { continue; }
        let x = p & 15;
        let y = p >> 8;
        let z = (p >> 4) & 15;
        let face = palette * 6 + 4;
        let layer = u16::from_le_bytes([materials.face_layers[face * 2], materials.face_layers[face * 2 + 1]]) as u32;
        let key = layer | (materials.face_tints[face] as u32) << 16 | 1 << 24;
        output.cross_quad(x, z, x + 1, z + 1, y, 6, false, key);
        output.cross_quad(x, z, x + 1, z + 1, y, 6, true, key);
        output.cross_quad(x + 1, z, x, z + 1, y, 7, false, key);
        output.cross_quad(x + 1, z, x, z + 1, y, 7, true, key);
    }
    Ok(output)
}
#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}
#[no_mangle]
pub unsafe extern "C" fn inflate_raw(input_ptr: *const u8, input_len: usize, output_ptr: *mut u32, output_len: *mut u32) -> u32 {
    if input_ptr.is_null() || output_ptr.is_null() || output_len.is_null() { return 1; }
    let input = std::slice::from_raw_parts(input_ptr, input_len);
    match inflate::inflate(input) {
        Ok(bytes) => {
            *output_len = bytes.len() as u32;
            *output_ptr = Box::into_raw(bytes.into_boxed_slice()) as *mut u8 as u32;
            0
        }
        Err(code) => code,
    }
}
fn descriptor(vertices: Vec<u8>, indices: Vec<u8>, quads: u32, error: u32) -> *mut u8 {
    let vertex_len = vertices.len() as u32;
    let index_len = (indices.len() / 4) as u32;
    let vertex_ptr = Box::into_raw(vertices.into_boxed_slice()) as *mut u8 as u32;
    let index_ptr = Box::into_raw(indices.into_boxed_slice()) as *mut u8 as u32;
    let mut bytes = [0u8; 24];
    for (i, value) in [vertex_ptr, vertex_len, index_ptr, index_len, quads, error]
        .iter()
        .enumerate()
    {
        bytes[i * 4..i * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    Box::into_raw(Box::new(bytes)) as *mut u8
}
#[no_mangle]
pub unsafe extern "C" fn mesh_chunk(
    positions_ptr: *const u8,
    palettes_ptr: *const u8,
    masks_ptr: *const u8,
    count: usize,
    layers_ptr: *const u8,
    tints_ptr: *const u8,
    opaque_ptr: *const u8,
    alpha_ptr: *const u8,
    shape_ptr: *const u8,
    palette_count: usize,
    mode: u32,
) -> *mut u8 {
    let masks = std::slice::from_raw_parts(masks_ptr, count);
    let materials = Materials {
        face_layers: std::slice::from_raw_parts(layers_ptr, palette_count * 12),
        face_tints: std::slice::from_raw_parts(tints_ptr, palette_count * 6),
        opaque: std::slice::from_raw_parts(opaque_ptr, palette_count),
        alpha_test: std::slice::from_raw_parts(alpha_ptr, palette_count),
        shape: std::slice::from_raw_parts(shape_ptr, palette_count),
    };
    match mesh_raw(
        positions_ptr,
        palettes_ptr,
        masks,
        count,
        materials,
        mode == 1,
    ) {
        Ok(output) => descriptor(output.vertices, output.indices, output.quads, 0),
        Err(error) => descriptor(Vec::new(), Vec::new(), 0, error),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn culled_counts_mask_bits() {
        let layers = [1u8, 0].repeat(6);
        let tints = [0u8; 6];
        let opaque = [1u8];
        let alpha = [0u8];
        let shape = [0u8];
        let materials = Materials {
            face_layers: &layers,
            face_tints: &tints,
            opaque: &opaque,
            alpha_test: &alpha,
            shape: &shape,
        };
        let positions = 0u32.to_le_bytes();
        let palettes = 0u32.to_le_bytes();
        let output = unsafe {
            mesh_raw(
                positions.as_ptr(),
                palettes.as_ptr(),
                &[63],
                1,
                materials,
                false,
            )
        }
        .unwrap();
        assert_eq!(output.quads, 6);
        assert_eq!(output.vertices.len(), 6 * 4 * 12);
        assert_eq!(output.indices.len(), 6 * 6 * 4);
    }
}
