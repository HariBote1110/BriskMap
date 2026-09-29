package io.github.haribote1110.briskmap.core.nbt;
import io.github.haribote1110.briskmap.core.extract.Bits;
import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Section;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;

public final class NbtReader {
    private final byte[] bytes;
    private final int limit;
    private int position;

    private NbtReader(byte[] bytes, int limit) { this.bytes = bytes; this.limit = limit; }

    public static Chunk read(byte[] bytes) throws IOException { return read(bytes, bytes.length); }

    public static Chunk read(byte[] bytes, int length) throws IOException {
        NbtReader reader = new NbtReader(bytes, length);
        if (reader.u8() != 10) throw new IOException("NBT root is not a compound");
        reader.string();
        Chunk chunk = new Chunk();
        while (true) {
            int type = reader.u8();
            if (type == 0) break;
            String name = reader.string();
            switch (name) {
                case "DataVersion" -> chunk.dataVersion = reader.i32();
                case "xPos" -> chunk.xPos = reader.i32();
                case "zPos" -> chunk.zPos = reader.i32();
                case "Status" -> chunk.status = reader.string();
                case "Heightmaps" -> reader.heightmaps(chunk);
                case "sections" -> reader.sections(chunk);
                default -> reader.skip(type);
            }
        }
        return chunk;
    }

    private void heightmaps(Chunk chunk) throws IOException {
        while (true) {
            int type = u8();
            if (type == 0) return;
            String name = string();
            if (type == 12 && (name.equals("WORLD_SURFACE") || name.equals("OCEAN_FLOOR"))) {
                long[] packed = longs();
                if (packed.length != 37) throw new IOException("Unexpected heightmap length " + packed.length);
                int[] values = new int[256];
                for (int i = 0; i < 256; i++) values[i] = Bits.get(packed, 9, i);
                if (name.equals("WORLD_SURFACE")) chunk.worldSurface = values;
                else chunk.oceanFloor = values;
            } else skip(type);
        }
    }

    private void sections(Chunk chunk) throws IOException {
        int type = u8(), count = i32();
        if (type != 10 || count < 0 || count > 1024) throw new IOException("Invalid sections list");
        chunk.sectionCount = count;
        for (int i = 0; i < count; i++) {
            int y = Integer.MIN_VALUE;
            String[] blocks = null, biomes = null;
            long[] blockData = null, biomeData = null;
            while (true) {
                int tag = u8();
                if (tag == 0) break;
                String name = string();
                switch (name) {
                    case "Y" -> y = (byte)u8();
                    case "block_states" -> {
                        StateSet states = states(true);
                        blocks = states.palette; blockData = states.data;
                    }
                    case "biomes" -> {
                        StateSet states = states(false);
                        biomes = states.palette; biomeData = states.data;
                    }
                    default -> skip(tag);
                }
            }
            chunk.sectionMinY = Math.min(chunk.sectionMinY, y);
            chunk.sectionMaxY = Math.max(chunk.sectionMaxY, y);
            if (y >= -4 && y <= 19) chunk.sections[y + 4] = new Section(y,
                    blocks == null ? new String[]{"minecraft:air"} : blocks, blockData,
                    biomes, biomeData);
        }
    }

    private StateSet states(boolean blocks) throws IOException {
        String[] palette = null;
        long[] data = null;
        while (true) {
            int tag = u8();
            if (tag == 0) {
                if (palette == null || palette.length == 0 || palette.length > 1 && data == null) throw new IOException("Incomplete palette data");
                return new StateSet(palette, data);
            }
            String name = string();
            if (name.equals("palette") && tag == 9) {
                int element = u8(), count = i32();
                if (count < 0 || count > 65536) throw new IOException("Invalid palette size");
                palette = new String[count];
                if (blocks && element == 10) for (int i = 0; i < count; i++) palette[i] = blockState();
                else if (blocks && element == 8) for (int i = 0; i < count; i++) palette[i] = string();
                else if (!blocks && element == 8) for (int i = 0; i < count; i++) palette[i] = string();
                else throw new IOException("Unexpected palette type");
            } else if (name.equals("data") && tag == 12) data = longs();
            else skip(tag);
        }
    }

    private String blockState() throws IOException {
        String name = null;
        ArrayList<String> properties = new ArrayList<>();
        while (true) {
            int tag = u8();
            if (tag == 0) break;
            String key = string();
            if ((key.equals("Name") || key.equals("id") || key.isEmpty()) && tag == 8) name = string();
            else if ((key.equals("Properties") || key.equals("properties")) && tag == 10) {
                while (true) {
                    int propertyTag = u8();
                    if (propertyTag == 0) break;
                    String property = string();
                    if (propertyTag == 8) properties.add(property + "=" + string());
                    else skip(propertyTag);
                }
            } else skip(tag);
        }
        if (name == null) throw new IOException("Block state without Name");
        if (properties.isEmpty()) return name;
        Collections.sort(properties);
        return name + "[" + String.join(",", properties) + "]";
    }

    private record StateSet(String[] palette, long[] data) {}

    private long[] longs() throws IOException {
        int count = i32();
        if (count < 0 || count > 1_000_000) throw new IOException("Invalid long array length");
        long[] values = new long[count];
        for (int i = 0; i < count; i++) values[i] = i64();
        return values;
    }

    private void skip(int type) throws IOException {
        switch (type) {
            case 1 -> advance(1);
            case 2 -> advance(2);
            case 3, 5 -> advance(4);
            case 4, 6 -> advance(8);
            case 7 -> advance(Math.multiplyExact(i32(), 1));
            case 8 -> { int length = u16(); advance(length); }
            case 9 -> {
                int element = u8(), count = i32();
                if (count < 0 || count > 1_000_000) throw new IOException("Invalid list length");
                for (int i = 0; i < count; i++) skip(element);
            }
            case 10 -> {
                while (true) {
                    int child = u8();
                    if (child == 0) break;
                    int length = u16(); advance(length); skip(child);
                }
            }
            case 11 -> advance(Math.multiplyExact(i32(), 4));
            case 12 -> advance(Math.multiplyExact(i32(), 8));
            default -> throw new IOException("Unknown NBT tag " + type);
        }
    }

    private void advance(int length) throws IOException {
        if (length < 0 || position + (long)length > limit) throw new IOException("Truncated NBT");
        position += length;
    }
    private int u8() throws IOException { if (position >= limit) throw new IOException("Truncated NBT"); return bytes[position++] & 255; }
    private int u16() throws IOException { return u8() << 8 | u8(); }
    private int i32() throws IOException { return u8() << 24 | u8() << 16 | u8() << 8 | u8(); }
    private long i64() throws IOException { return ((long)i32() << 32) | (i32() & 0xffffffffL); }
    private String string() throws IOException {
        int length = u16(), start = position;
        advance(length);
        boolean ascii = true;
        for (int i = start; i < position; i++) if ((bytes[i] & 128) != 0) { ascii = false; break; }
        if (ascii) return new String(bytes, start, length, StandardCharsets.US_ASCII);
        return new DataInputStream(new ByteArrayInputStream(bytes, start - 2, length + 2)).readUTF();
    }
}
