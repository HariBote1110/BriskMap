package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.*;

import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Section;
import io.github.haribote1110.briskmap.core.region.Region;
import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import java.util.zip.Inflater;
import java.util.zip.InflaterInputStream;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

class IndependentNbtTest {
    @Test void everyModernBlockMatchesIndependentTreeParser() throws Exception {
        for (String dimension : List.of("overworld", "nether")) {
            Path file = Path.of("feasibility_research/fixtures/26.3", dimension, "r.0.0.mca");
            Assumptions.assumeTrue(Files.isRegularFile(file), "26.3 fixture is absent: " + file);
            byte[] regionBytes = Files.readAllBytes(file);
            Region region = new Region(file);
            Inflater inflater = new Inflater();
            int full = 0;
            for (int index = 0; index < 1024; index++) {
                int entry = integer(regionBytes, index * 4);
                int sector = entry >>> 8;
                if (sector == 0) continue;
                int at = sector * 4096;
                int length = integer(regionBytes, at);
                int type = regionBytes[at + 4] & 255;
                if ((type & 128) != 0) throw new IOException("Unexpected external fixture chunk");
                InputStream source = new ByteArrayInputStream(regionBytes, at + 5, length - 1);
                if (type == 1) source = new GZIPInputStream(source);
                else if (type == 2) source = new InflaterInputStream(source);
                else if (type != 3) throw new IOException("Unexpected fixture compression " + type);
                Map<String, Object> root;
                try (DataInputStream input = new DataInputStream(source)) {
                    assertEquals(10, input.readUnsignedByte()); input.readUTF();
                    root = compound(input);
                }
                if (!"minecraft:full".equals(root.get("Status"))) continue;
                full++;
                Chunk actual = region.read(index, inflater);
                assertEquals(root.get("DataVersion"), actual.dataVersion);
                @SuppressWarnings("unchecked")
                List<Map<String, Object>> sections = (List<Map<String, Object>>) root.get("sections");
                for (Map<String, Object> section : sections) {
                    int y = (Byte) section.get("Y");
                    if (y < -4 || y > 19) continue;
                    Section production = actual.sections[y + 4];
                    @SuppressWarnings("unchecked")
                    Map<String, Object> states = (Map<String, Object>) section.get("block_states");
                    if (states == null) continue;
                    @SuppressWarnings("unchecked")
                    List<Object> palette = (List<Object>) states.get("palette");
                    String[] expected = palette.stream().map(IndependentNbtTest::state).toArray(String[]::new);
                    long[] data = (long[]) states.get("data");
                    int width = Math.max(4, 32 - Integer.numberOfLeadingZeros(expected.length - 1));
                    for (int block = 0; block < 4096; block++) {
                        int paletteIndex = data == null ? 0 : (int) ((data[block / (64 / width)]
                                >>> ((block % (64 / width)) * width)) & ((1L << width) - 1));
                        int actualIndex = production.blockData == null ? 0 : (int) ((production.blockData[block / (64 / width)]
                                >>> ((block % (64 / width)) * width)) & ((1L << width) - 1));
                        assertEquals(expected[paletteIndex], production.blocks[actualIndex],
                                dimension + " chunk=" + index + " section=" + y + " block=" + block);
                    }
                }
            }
            assertTrue(full > 0, "No full chunks in " + dimension);
        }
    }

    private static String state(Object entry) {
        if (entry instanceof String name) return name;
        @SuppressWarnings("unchecked")
        Map<String, Object> compound = (Map<String, Object>) entry;
        String name = (String) (compound.containsKey("Name") ? compound.get("Name")
                : compound.containsKey("id") ? compound.get("id") : compound.get(""));
        @SuppressWarnings("unchecked")
        Map<String, Object> properties = (Map<String, Object>) (compound.containsKey("Properties")
                ? compound.get("Properties") : compound.get("properties"));
        if (properties == null || properties.isEmpty()) return name;
        String[] pairs = properties.entrySet().stream().map(entryValue -> entryValue.getKey() + "=" + entryValue.getValue()).toArray(String[]::new);
        Arrays.sort(pairs);
        return name + "[" + String.join(",", pairs) + "]";
    }

    private static Map<String, Object> compound(DataInputStream input) throws IOException {
        Map<String, Object> values = new HashMap<>();
        while (true) {
            int type = input.readUnsignedByte();
            if (type == 0) return values;
            values.put(input.readUTF(), value(input, type));
        }
    }

    private static Object value(DataInputStream input, int type) throws IOException {
        return switch (type) {
            case 1 -> input.readByte();
            case 2 -> input.readShort();
            case 3 -> input.readInt();
            case 4 -> input.readLong();
            case 5 -> input.readFloat();
            case 6 -> input.readDouble();
            case 7 -> input.readNBytes(input.readInt());
            case 8 -> input.readUTF();
            case 9 -> {
                int child = input.readUnsignedByte(), count = input.readInt();
                List<Object> values = new ArrayList<>(count);
                for (int i = 0; i < count; i++) values.add(value(input, child));
                yield values;
            }
            case 10 -> compound(input);
            case 11 -> { int count = input.readInt(); int[] values = new int[count]; for (int i = 0; i < count; i++) values[i] = input.readInt(); yield values; }
            case 12 -> { int count = input.readInt(); long[] values = new long[count]; for (int i = 0; i < count; i++) values[i] = input.readLong(); yield values; }
            default -> throw new IOException("Unsupported NBT tag " + type);
        };
    }

    private static int integer(byte[] bytes, int at) {
        return (bytes[at] & 255) << 24 | (bytes[at + 1] & 255) << 16 | (bytes[at + 2] & 255) << 8 | bytes[at + 3] & 255;
    }
}
