// Raw DEFLATE (RFC 1951). All bit reads and output growth are checked before use.
const MAX_BITS: usize = 15;
const ROOT_BITS: usize = 9;
const ROOT_SIZE: usize = 1 << ROOT_BITS;
const LENGTH_BASE: [usize; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE: [usize; 30] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

struct Bits<'a> { input: &'a [u8], at: usize, value: u32, count: usize }
impl Bits<'_> {
    #[inline]
    fn fill(&mut self, needed: usize) {
        while self.count < needed && self.at < self.input.len() {
            self.value |= (self.input[self.at] as u32) << self.count;
            self.at += 1;
            self.count += 8;
        }
    }
    #[inline]
    fn take(&mut self, count: usize) -> Result<usize, u32> {
        self.fill(count);
        if self.count < count { return Err(1); }
        let result = (self.value & ((1 << count) - 1)) as usize;
        self.value >>= count;
        self.count -= count;
        Ok(result)
    }
}

// A direct nine-bit lookup with small subtables for longer codes.
struct Huffman { root: [u32; ROOT_SIZE], tails: Vec<u32> }
impl Huffman {
    fn new(lengths: &[u8], allow_single: bool, allow_empty: bool) -> Result<Self, u32> {
        let mut counts = [0usize; MAX_BITS + 1];
        for &length in lengths {
            if length as usize > MAX_BITS { return Err(2); }
            counts[length as usize] += usize::from(length != 0);
        }
        let symbols = counts.iter().sum::<usize>();
        if symbols == 0 && allow_empty { return Ok(Self { root: [0; ROOT_SIZE], tails: Vec::new() }); }
        let mut left = 1i32;
        for &count in counts.iter().skip(1) {
            left = left * 2 - count as i32;
            if left < 0 { return Err(2); }
        }
        if left != 0 && !(allow_single && symbols == 1 && counts[1] == 1) { return Err(2); }
        let mut next = [0usize; MAX_BITS + 1];
        let mut code = 0;
        for bits in 1..=MAX_BITS { code = (code + counts[bits - 1]) << 1; next[bits] = code; }
        let mut root = [0u32; ROOT_SIZE];
        let mut max_tail = [0usize; ROOT_SIZE];
        let mut codes = Vec::with_capacity(symbols);
        for (symbol, &length) in lengths.iter().enumerate() {
            if length == 0 { continue; }
            let bits = length as usize;
            let canonical = next[bits]; next[bits] += 1;
            let reversed = canonical.reverse_bits() >> (usize::BITS as usize - bits);
            codes.push((reversed, bits, symbol));
            if bits > ROOT_BITS { max_tail[reversed & (ROOT_SIZE - 1)] = max_tail[reversed & (ROOT_SIZE - 1)].max(bits - ROOT_BITS); }
        }
        let mut tails = Vec::new();
        for (prefix, &tail_bits) in max_tail.iter().enumerate() {
            if tail_bits != 0 {
                let offset = tails.len();
                tails.resize(offset + (1 << tail_bits), 0);
                root[prefix] = 0x8000_0000 | ((offset as u32) << 5) | tail_bits as u32;
            }
        }
        for (reversed, bits, symbol) in codes {
            let entry = ((symbol as u32) << 5) | bits as u32;
            if bits <= ROOT_BITS {
                for index in (reversed..ROOT_SIZE).step_by(1 << bits) { root[index] = entry; }
            } else {
                let prefix = reversed & (ROOT_SIZE - 1);
                let tail_bits = (root[prefix] & 31) as usize;
                let offset = ((root[prefix] & !0x8000_001f) >> 5) as usize;
                let short = bits - ROOT_BITS;
                let start = reversed >> ROOT_BITS;
                for index in (start..1 << tail_bits).step_by(1 << short) { tails[offset + index] = entry; }
            }
        }
        Ok(Self { root, tails })
    }
    #[inline]
    fn decode(&self, bits: &mut Bits<'_>) -> Result<usize, u32> {
        bits.fill(ROOT_BITS);
        let mut entry = self.root[(bits.value as usize) & (ROOT_SIZE - 1)];
        if entry & 0x8000_0000 != 0 {
            let tail_bits = (entry & 31) as usize;
            bits.fill(ROOT_BITS + tail_bits);
            let offset = ((entry & !0x8000_001f) >> 5) as usize;
            let index = ((bits.value as usize) >> ROOT_BITS) & ((1 << tail_bits) - 1);
            entry = self.tails[offset + index];
        }
        let count = (entry & 31) as usize;
        if count == 0 || bits.count < count { return Err(2); }
        bits.value >>= count;
        bits.count -= count;
        Ok((entry >> 5) as usize)
    }
}

fn grow(output: &mut Vec<u8>, extra: usize) -> Result<(), u32> {
    let needed = output.len().checked_add(extra).ok_or(3u32)?;
    if needed > output.capacity() {
        output.try_reserve(needed - output.len()).map_err(|_| 3u32)?;
    }
    Ok(())
}

fn dynamic(bits: &mut Bits<'_>) -> Result<(Huffman, Huffman), u32> {
    let literals = bits.take(5)? + 257;
    let distances = bits.take(5)? + 1;
    let codes = bits.take(4)? + 4;
    let mut code_lengths = [0u8; 19];
    for &index in CODE_ORDER.iter().take(codes) { code_lengths[index] = bits.take(3)? as u8; }
    let code_tree = Huffman::new(&code_lengths, false, false)?;
    let mut lengths = Vec::with_capacity(literals + distances);
    while lengths.len() < literals + distances {
        let symbol = code_tree.decode(bits)?;
        match symbol {
            0..=15 => lengths.push(symbol as u8),
            16 => {
                let previous = *lengths.last().ok_or(2u32)?;
                let repeat = bits.take(2)? + 3;
                if lengths.len() + repeat > literals + distances { return Err(2); }
                lengths.resize(lengths.len() + repeat, previous);
            }
            17 | 18 => {
                let repeat = if symbol == 17 { bits.take(3)? + 3 } else { bits.take(7)? + 11 };
                if lengths.len() + repeat > literals + distances { return Err(2); }
                lengths.resize(lengths.len() + repeat, 0);
            }
            _ => return Err(2),
        }
    }
    if lengths[256] == 0 { return Err(2); }
    let literal_tree = Huffman::new(&lengths[..literals], true, false)?;
    let distance_tree = Huffman::new(&lengths[literals..], true, true)?;
    Ok((literal_tree, distance_tree))
}

fn fixed() -> Result<(Huffman, Huffman), u32> {
    let mut lengths = [8u8; 288];
    lengths[144..256].fill(9);
    lengths[256..280].fill(7);
    lengths[280..].fill(8);
    Ok((Huffman::new(&lengths, false, false)?, Huffman::new(&[5u8; 32], false, false)?))
}

pub fn inflate(input: &[u8]) -> Result<Vec<u8>, u32> {
    let mut bits = Bits { input, at: 0, value: 0, count: 0 };
    let mut output = Vec::new();
    output.try_reserve(input.len().saturating_mul(4).min(1 << 20)).map_err(|_| 3u32)?;
    loop {
        let final_block = bits.take(1)? != 0;
        match bits.take(2)? {
            0 => {
                let discard = bits.count & 7;
                bits.take(discard)?;
                let length = bits.take(16)?;
                if bits.take(16)? != (length ^ 0xffff) { return Err(2); }
                grow(&mut output, length)?;
                for _ in 0..length { output.push(bits.take(8)? as u8); }
            }
            kind @ (1 | 2) => {
                let (literals, distances) = if kind == 1 { fixed()? } else { dynamic(&mut bits)? };
                loop {
                    let symbol = literals.decode(&mut bits)?;
                    match symbol {
                        0..=255 => {
                            if output.len() == output.capacity() { grow(&mut output, 1)?; }
                            output.push(symbol as u8);
                        }
                        256 => break,
                        257..=285 => {
                            let index = symbol - 257;
                            let length = LENGTH_BASE[index] + bits.take(LENGTH_EXTRA[index] as usize)?;
                            let distance_symbol = distances.decode(&mut bits)?;
                            if distance_symbol >= DIST_BASE.len() { return Err(2); }
                            let distance = DIST_BASE[distance_symbol] + bits.take(DIST_EXTRA[distance_symbol] as usize)?;
                            if distance > output.len() { return Err(2); }
                            grow(&mut output, length)?;
                            for _ in 0..length {
                                let byte = output[output.len() - distance];
                                output.push(byte);
                            }
                        }
                        _ => return Err(2),
                    }
                }
            }
            _ => return Err(2),
        }
        if final_block { break; }
    }
    // The last byte may contain unused padding bits, but no following bytes.
    if bits.at != input.len() { return Err(2); }
    Ok(output)
}
