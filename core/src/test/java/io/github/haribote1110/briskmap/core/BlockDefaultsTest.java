package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.*;

import io.github.haribote1110.briskmap.core.nbt.NbtReader;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;

class BlockDefaultsTest {
    private static final BlockDefaults DEFAULTS = BlockDefaults.of(Map.of(
            "minecraft:grass_block", "minecraft:grass_block[snowy=false]",
            "minecraft:oak_log", "minecraft:oak_log[axis=y]",
            "minecraft:stone", "minecraft:stone"));

    @Test void propertiesAreSortedIntoCoreCanonicalOrder() throws Exception {
        BlockDefaults defaults = BlockDefaults.of(Map.of(
                "minecraft:oak_stairs", "minecraft:oak_stairs[waterlogged=false,shape=straight,half=bottom,facing=north]"));
        assertEquals("minecraft:oak_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]",
                defaults.state("minecraft:oak_stairs"));
        Path json = Files.createTempFile(Path.of("core/build"), "defaults-", ".json");
        Files.writeString(json, "{\"minecraft:tall_grass\":\"minecraft:tall_grass[half=lower]\","
                + "\"minecraft:chest\":\"minecraft:chest[waterlogged=false,type=single,facing=north]\"}");
        BlockDefaults read = BlockDefaults.readJson(json);
        assertEquals("minecraft:chest[facing=north,type=single,waterlogged=false]", read.state("minecraft:chest"));
        assertEquals("minecraft:tall_grass[half=lower]", read.state("minecraft:tall_grass"));
        assertTrue(BlockDefaults.empty().isEmpty());
        assertFalse(read.isEmpty());
    }

    @Test void bareModernStringEntriesUseDefaults() throws Exception {
        assertArrayEquals(new String[]{"minecraft:grass_block[snowy=false]", "minecraft:oak_log[axis=y]", "minecraft:stone"},
                blocks(stringPalette("minecraft:grass_block", "minecraft:oak_log", "minecraft:stone"), DEFAULTS));
    }

    @Test void bareModernCompoundEntriesUseDefaults() throws Exception {
        assertArrayEquals(new String[]{"minecraft:grass_block[snowy=false]", "minecraft:oak_log[axis=x]",
                "minecraft:oak_log[axis=y]"},
                blocks(compoundPalette(
                        new Entry("", "minecraft:grass_block", null),
                        new Entry("id", "minecraft:oak_log", "x"),
                        new Entry("id", "minecraft:oak_log", null)), DEFAULTS));
    }

    @Test void unknownBareNamesStayBare() throws Exception {
        assertArrayEquals(new String[]{"minecraft:unknown"}, blocks(stringPalette("minecraft:unknown"), DEFAULTS));
        assertArrayEquals(new String[]{"minecraft:unknown"},
                blocks(compoundPalette(new Entry("", "minecraft:unknown", null)), DEFAULTS));
    }

    @Test void legacyEntriesAreNeverTouched() throws Exception {
        assertArrayEquals(new String[]{"minecraft:grass_block", "minecraft:oak_log[axis=z]"},
                blocks(compoundPalette(
                        new Entry("Name", "minecraft:grass_block", null),
                        new Entry("Name", "minecraft:oak_log", "z")), DEFAULTS));
    }

    @Test void withoutDefaultsBareNamesStayBare() throws Exception {
        assertArrayEquals(new String[]{"minecraft:grass_block"}, blocks(stringPalette("minecraft:grass_block"), BlockDefaults.empty()));
        assertArrayEquals(new String[]{"minecraft:grass_block"}, NbtReader.read(stringPalette("minecraft:grass_block")).sections[4].blocks);
    }

    @Test void flagBitTwoIsSetOnlyWithANonEmptyTable() {
        assertEquals(0, new ExtractOptions(false, false, 6, true, true).flags());
        assertEquals(0, new ExtractOptions(false, false, 6, true, true, BlockDefaults.empty()).flags());
        assertEquals(4, new ExtractOptions(false, false, 6, true, true, DEFAULTS).flags());
        assertEquals(7, new ExtractOptions(true, true, 6, true, true, DEFAULTS).flags());
    }

    private record Entry(String key, String name, String axis) {}

    private static String[] blocks(byte[] nbt, BlockDefaults defaults) throws IOException {
        return NbtReader.read(nbt, defaults).sections[4].blocks;
    }

    private static byte[] stringPalette(String... names) throws IOException {
        return section(names.length, out -> {
            out.writeByte(8); out.writeInt(names.length);
            for (String name : names) out.writeUTF(name);
        });
    }

    private static byte[] compoundPalette(Entry... entries) throws IOException {
        return section(entries.length, out -> {
            out.writeByte(10); out.writeInt(entries.length);
            for (Entry entry : entries) {
                out.writeByte(8); out.writeUTF(entry.key()); out.writeUTF(entry.name());
                if (entry.axis() != null) {
                    out.writeByte(10); out.writeUTF(entry.key().equals("Name") ? "Properties" : "properties");
                    out.writeByte(8); out.writeUTF("axis"); out.writeUTF(entry.axis()); out.writeByte(0);
                }
                out.writeByte(0);
            }
        });
    }

    private interface PaletteWriter { void write(DataOutputStream out) throws IOException; }

    private static byte[] section(int count, PaletteWriter palette) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeByte(10); out.writeUTF("");
        out.writeByte(9); out.writeUTF("sections"); out.writeByte(10); out.writeInt(1);
        out.writeByte(1); out.writeUTF("Y"); out.writeByte(0);
        out.writeByte(10); out.writeUTF("block_states");
        out.writeByte(9); out.writeUTF("palette");
        palette.write(out);
        if (count > 1) { out.writeByte(12); out.writeUTF("data"); out.writeInt(256); for (int i = 0; i < 256; i++) out.writeLong(0); }
        out.writeByte(0); out.writeByte(0); out.writeByte(0);
        return bytes.toByteArray();
    }
}
