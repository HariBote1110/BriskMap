package io.github.haribote1110.briskmap.core.format;

import io.github.haribote1110.briskmap.core.extract.Extracted2d;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

public final class Reader {
    private final byte[] bytes;
    private final int[] offsets = new int[1024], lengths = new int[1024];
    public final long[] timestamps = new long[1024];
    public final int flags;
    public final int version, kind, regionX, regionZ;
    public final List<String> blocks, biomes;

    public Reader(Path path) throws IOException {
        bytes = Files.readAllBytes(path);
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(bytes));
        if (in.readByte() != 'B' || in.readByte() != 'R' || in.readByte() != 'S' || in.readByte() != 'K') throw new IOException("Invalid magic");
        version = in.readUnsignedByte();
        if (version != 3) throw new IOException("Unsupported format version " + version);
        kind = in.readUnsignedByte();
        if (kind != 1 && kind != 2) throw new IOException("Invalid kind");
        regionX = in.readInt(); regionZ = in.readInt();
        flags = in.readUnsignedByte();
        if ((flags & ~7) != 0 || in.readUnsignedByte() != 0) throw new IOException("Invalid flags");
        blocks = table(in);
        biomes = kind == 1 ? table(in) : List.of();
        int expectedOffset = bytes.length - in.available() + 8192;
        for (int i = 0; i < 1024; i++) {
            offsets[i] = in.readInt(); lengths[i] = in.readInt();
            if (offsets[i] == 0 && lengths[i] == 0) continue;
            if (offsets[i] != expectedOffset || lengths[i] <= 0
                    || offsets[i] + (long) lengths[i] > bytes.length - 4100L)
                throw new IOException("Invalid chunk index");
            expectedOffset += lengths[i];
        }
        if (expectedOffset != bytes.length - 4100) throw new IOException("Invalid payload length");
        if (bytes.length < 4100 || bytes[bytes.length - 4] != 'B' || bytes[bytes.length - 3] != 'R'
                || bytes[bytes.length - 2] != 'S' || bytes[bytes.length - 1] != 'T') throw new IOException("Invalid trailer");
        DataInputStream trailer = new DataInputStream(new ByteArrayInputStream(bytes, bytes.length - 4100, 4096));
        for (int i = 0; i < 1024; i++) timestamps[i] = Integer.toUnsignedLong(trailer.readInt());
    }

    public int chunkCount() { int count = 0; for (int length : lengths) if (length != 0) count++; return count; }
    public byte[] compressed(int index) {
        return lengths[index] == 0 ? null : java.util.Arrays.copyOfRange(bytes, offsets[index], offsets[index] + lengths[index]);
    }

    public Extracted2d read2d(int index) throws IOException {
        if (kind != 1) throw new IOException("Not a 2d file");
        byte[] raw = inflate(index);
        if (raw == null) return null;
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(raw));
        Extracted2d result = new Extracted2d();
        for (int i = 0; i < 256; i++) {
            result.y[i] = in.readShort(); result.block[i] = varint(in); result.biome[i] = varint(in); result.depth[i] = in.readByte();
        }
        if (in.available() != 0) throw new IOException("Trailing 2d data");
        return result;
    }

    public Extracted3d read3d(int index) throws IOException {
        if (kind != 2) throw new IOException("Not a 3d file");
        byte[] raw = inflate(index);
        if (raw == null) return null;
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(raw));
        Extracted3d result = new Extracted3d();
        for (int sy = 0; sy < 24; sy++) {
            int count = varint(in);
            if (count < 0 || count > 4096) throw new IOException("Invalid shell count");
            int[] positions = new int[count], blocks = new int[count];
            byte[] masks = new byte[count];
            int previous = 0;
            for (int i = 0; i < count; i++) { previous += varint(in); if (previous > 4095 || i > 0 && previous <= positions[i - 1]) throw new IOException("Invalid shell position"); positions[i] = previous; }
            for (int i = 0; i < count; i++) blocks[i] = varint(in);
            for (int i = 0; i < count; i++) {
                masks[i] = in.readByte();
                if (masks[i] == 0 || (masks[i] & 0xc0) != 0) throw new IOException("Invalid face mask");
                result.faces += Integer.bitCount(masks[i] & 63);
            }
            result.positions[sy] = positions; result.blocks[sy] = blocks; result.masks[sy] = masks;
        }
        if (in.available() != 0) throw new IOException("Trailing 3d data");
        return result;
    }

    private byte[] inflate(int index) throws IOException {
        if (lengths[index] == 0) return null;
        Inflater inflater = new Inflater(true);
        inflater.setInput(bytes, offsets[index], lengths[index]);
        byte[] buffer = new byte[65536];
        var output = new java.io.ByteArrayOutputStream();
        try {
            while (!inflater.finished()) {
                int amount = inflater.inflate(buffer);
                if (amount == 0 && (inflater.needsInput() || inflater.needsDictionary())) throw new IOException("Incomplete chunk payload");
                output.write(buffer, 0, amount);
            }
        } catch (DataFormatException ex) { throw new IOException("Invalid payload", ex); }
        finally { inflater.end(); }
        return output.toByteArray();
    }

    private static List<String> table(DataInputStream in) throws IOException {
        int count = varint(in);
        if (count < 0 || count > 1_000_000) throw new IOException("Invalid palette count");
        List<String> values = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            int length = varint(in);
            if (length < 0 || length > 1_000_000) throw new IOException("Invalid string length");
            values.add(new String(in.readNBytes(length), StandardCharsets.UTF_8));
        }
        return values;
    }

    private static int varint(DataInputStream in) throws IOException {
        int value = 0;
        for (int shift = 0; shift < 35; shift += 7) {
            int next = in.readUnsignedByte(); value |= (next & 127) << shift;
            if ((next & 128) == 0) return value;
        }
        throw new IOException("Oversized varint");
    }
}
