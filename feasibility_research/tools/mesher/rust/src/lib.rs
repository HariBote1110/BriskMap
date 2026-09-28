const VOLUME: usize = 16 * 384 * 16;
const DIMENSIONS: [usize; 3] = [16, 384, 16];
const STEPS: [usize; 3] = [1, 256, 16];

pub fn colour_for(value: &str) -> u32 {
    let mut hash = 0x811c9dc5u32;
    for byte in value.bytes() {
        hash = (hash ^ u32::from(byte)).wrapping_mul(0x01000193);
    }
    (hash & 0x00ff_ffff) | 0xff00_0000
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
    fn vertex(&mut self, x: usize, y: usize, z: usize, normal: u8, colour: u32) {
        self.vertices.extend_from_slice(&(x as u16).to_le_bytes());
        self.vertices.extend_from_slice(&(y as u16).to_le_bytes());
        self.vertices.extend_from_slice(&(z as u16).to_le_bytes());
        self.vertices.push(normal);
        self.vertices.push(0);
        self.vertices.extend_from_slice(&colour.to_le_bytes());
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
        colour: u32,
    ) {
        let normal = (axis * 2 + direction) as u8;
        let u1 = u0 + width;
        let v1 = v0 + height;
        let plane = slice + direction;
        let base = (self.vertices.len() / 12) as u32;
        if axis == 0 {
            self.vertex(plane, u0, v0, normal, colour);
            if direction == 1 {
                self.vertex(plane, u1, v0, normal, colour);
                self.vertex(plane, u1, v1, normal, colour);
                self.vertex(plane, u0, v1, normal, colour);
            } else {
                self.vertex(plane, u0, v1, normal, colour);
                self.vertex(plane, u1, v1, normal, colour);
                self.vertex(plane, u1, v0, normal, colour);
            }
        } else if axis == 1 {
            self.vertex(v0, plane, u0, normal, colour);
            if direction == 1 {
                self.vertex(v0, plane, u1, normal, colour);
                self.vertex(v1, plane, u1, normal, colour);
                self.vertex(v1, plane, u0, normal, colour);
            } else {
                self.vertex(v1, plane, u0, normal, colour);
                self.vertex(v1, plane, u1, normal, colour);
                self.vertex(v0, plane, u1, normal, colour);
            }
        } else {
            self.vertex(u0, v0, plane, normal, colour);
            if direction == 1 {
                self.vertex(u1, v0, plane, normal, colour);
                self.vertex(u1, v1, plane, normal, colour);
                self.vertex(u0, v1, plane, normal, colour);
            } else {
                self.vertex(u0, v1, plane, normal, colour);
                self.vertex(u1, v1, plane, normal, colour);
                self.vertex(u1, v0, plane, normal, colour);
            }
        }
        for index in [base, base + 1, base + 2, base, base + 2, base + 3] {
            self.indices.extend_from_slice(&index.to_le_bytes());
        }
        self.quads += 1;
    }
}

unsafe fn mesh_raw(
    positions_ptr: *const u8,
    palettes_ptr: *const u8,
    masks: &[u8],
    count: usize,
    colours_ptr: *const u8,
    colour_count: usize,
    greedy: bool,
) -> Result<Output, u32> {
    let mut grid = vec![0u32; 6 * VOLUME];
    let mut present = vec![0u8; 6 * VOLUME];
    for i in 0..count {
        let p = positions_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        let palette_index = palettes_ptr.add(i * 4).cast::<u32>().read_unaligned() as usize;
        if palette_index >= colour_count {
            return Err(2);
        }
        let colour = colours_ptr
            .add(palette_index * 4)
            .cast::<u32>()
            .read_unaligned();
        let mask = masks[i];
        if p >= VOLUME || mask == 0 || mask & 0xc0 != 0 {
            return Err(2);
        }
        for normal in 0..6 {
            if mask & (1 << normal) != 0 {
                grid[normal * VOLUME + p] = colour;
                present[normal * VOLUME + p] = 1;
            }
        }
    }
    let mut output = Output::new();
    for axis in 0..3 {
        for direction in 0..2 {
            let base = (axis * 2 + direction) * VOLUME;
            let u_axis = (axis + 1) % 3;
            let v_axis = (axis + 2) % 3;
            let u_limit = DIMENSIONS[u_axis];
            let v_limit = DIMENSIONS[v_axis];
            let u_step = STEPS[u_axis];
            let v_step = STEPS[v_axis];
            let slice_step = STEPS[axis];
            for slice in 0..DIMENSIONS[axis] {
                for v in 0..v_limit {
                    for u in 0..u_limit {
                        let at = base + slice * slice_step + v * v_step + u * u_step;
                        let colour = grid[at];
                        if present[at] == 0 {
                            continue;
                        }
                        let mut width = 1;
                        let mut height = 1;
                        if greedy {
                            while u + width < u_limit
                                && present[at + width * u_step] != 0
                                && grid[at + width * u_step] == colour
                            {
                                width += 1;
                            }
                            'height: while v + height < v_limit {
                                for w in 0..width {
                                    if present[at + height * v_step + w * u_step] == 0
                                        || grid[at + height * v_step + w * u_step] != colour
                                    {
                                        break 'height;
                                    }
                                }
                                height += 1;
                            }
                        }
                        for h in 0..height {
                            for w in 0..width {
                                present[at + h * v_step + w * u_step] = 0;
                            }
                        }
                        output.quad(axis, direction, slice, u, v, width, height, colour);
                    }
                }
            }
        }
    }
    Ok(output)
}

#[cfg(test)]
fn mesh(
    positions: &[u32],
    palette_indices: &[u32],
    masks: &[u8],
    colours: &[u32],
    greedy: bool,
) -> Result<Output, u32> {
    if positions.len() != palette_indices.len() || positions.len() != masks.len() {
        return Err(1);
    }
    unsafe {
        mesh_raw(
            positions.as_ptr().cast(),
            palette_indices.as_ptr().cast(),
            masks,
            positions.len(),
            colours.as_ptr().cast(),
            colours.len(),
            greedy,
        )
    }
}

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let bytes = vec![0u8; len].into_boxed_slice();
    Box::into_raw(bytes) as *mut u8
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
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
    colours_ptr: *const u8,
    colour_count: usize,
    mode: u32,
) -> *mut u8 {
    let masks = std::slice::from_raw_parts(masks_ptr, count);
    match mesh_raw(
        positions_ptr,
        palettes_ptr,
        masks,
        count,
        colours_ptr,
        colour_count,
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
        let output = mesh(&[0], &[0], &[63], &[colour_for("minecraft:stone")], false).unwrap();
        assert_eq!(output.quads, 6);
        assert_eq!(output.vertices.len(), 6 * 4 * 12);
        assert_eq!(output.indices.len(), 6 * 6 * 4);
    }
    #[test]
    fn unaligned_input_bytes_are_accepted() {
        let mut positions = vec![0u8];
        positions.extend_from_slice(&0u32.to_le_bytes());
        let mut palettes = vec![0u8];
        palettes.extend_from_slice(&0u32.to_le_bytes());
        let mut colours = vec![0u8];
        colours.extend_from_slice(&0xff00_0001u32.to_le_bytes());
        let output = unsafe {
            mesh_raw(
                positions.as_ptr().add(1),
                palettes.as_ptr().add(1),
                &[8],
                1,
                colours.as_ptr().add(1),
                1,
                false,
            )
        }
        .unwrap();
        assert_eq!(output.quads, 1);
    }
    #[test]
    fn transparent_black_is_a_face() {
        assert_eq!(mesh(&[0], &[0], &[8], &[0], true).unwrap().quads, 1);
    }
    #[test]
    fn greedy_merges_adjacent_top_faces() {
        let colour = colour_for("minecraft:stone");
        let culled = mesh(&[0, 1], &[0, 0], &[8, 8], &[colour], false).unwrap();
        let greedy = mesh(&[0, 1], &[0, 0], &[8, 8], &[colour], true).unwrap();
        assert_eq!(culled.quads, 2);
        assert_eq!(greedy.quads, 1);
    }
}
