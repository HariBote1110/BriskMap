package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.*;

import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Section;
import io.github.haribote1110.briskmap.core.format.Reader;
import io.github.haribote1110.briskmap.core.nbt.NbtReader;
import io.github.haribote1110.briskmap.core.region.Region;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.Inflater;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

class FeatureTest {
    private static final Path FIXTURES = Path.of("feasibility_research/fixtures");
    private static final ExtractOptions DEFAULT = new ExtractOptions(true, true, 6, true, true);

    @Test void modernPalettesMatchLegacy() throws Exception {
        Chunk legacy = NbtReader.read(nbt(0));
        Chunk strings = NbtReader.read(nbt(1));
        Chunk mixed = NbtReader.read(nbt(2));
        assertArrayEquals(legacy.sections[4].blocks, mixed.sections[4].blocks);
        assertEquals("minecraft:stone", strings.sections[4].blocks[0]);
        assertEquals(5023, mixed.dataVersion);
    }

    @Test void externalChunkAndTimestamp() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "external-");
        byte[] nbt = nbt(1);
        ByteArrayOutputStream zipped = new ByteArrayOutputStream();
        try (DeflaterOutputStream stream = new DeflaterOutputStream(zipped)) { stream.write(nbt); }
        Path regionPath = dir.resolve("r.-1.2.mca");
        byte[] region = new byte[12288];
        region[2] = 2; region[3] = 1;
        region[4099] = 77;
        region[8195] = 1; region[8196] = (byte) 130;
        Files.write(regionPath, region);
        Files.write(dir.resolve("c.-32.64.mcc"), zipped.toByteArray());
        Region input = new Region(regionPath);
        assertEquals(77, input.timestamp(0));
        assertEquals(5023, input.read(0, new Inflater()).dataVersion);
    }

    @Test void oraclePayloadsAndTrailer() throws Exception {
        Path in = Path.of("feasibility_research/output/oracle/in-1.21.11");
        Path oracle = Path.of("feasibility_research/output/oracle");
        Assumptions.assumeTrue(Files.isRegularFile(in.resolve("r.0.0.mca")), "Oracle inputs are absent");
        for (boolean hide : new boolean[]{false, true}) for (boolean surface : new boolean[]{false, true}) {
            String flavour = (hide ? "hide" : "keep") + "-" + (surface ? "surface" : "volume");
            Path out = Files.createTempDirectory(Path.of("core/build"), "oracle-");
            WorldExtractor.extract(in, out, new ExtractOptions(hide, surface, 6, true, true), 2, null, () -> false);
            for (String base : List.of("r.0.0", "r.-1.-1")) for (String extension : List.of("b2d", "b3d")) {
                Path oldPath = oracle.resolve(flavour).resolve(base + "." + extension);
                Assumptions.assumeTrue(Files.isRegularFile(oldPath), "Oracle file is absent: " + oldPath);
                byte[] old = Files.readAllBytes(oldPath), current = Files.readAllBytes(out.resolve(base + "." + extension));
                assertArrayEquals(Arrays.copyOfRange(old, 0, 4), Arrays.copyOfRange(current, 0, 4));
                assertEquals(extension.equals("b2d") ? 1 : 2, old[4]); assertEquals(3, current[4]);
                assertArrayEquals(Arrays.copyOfRange(old, 5, 14), Arrays.copyOfRange(current, 5, 14));
                assertEquals((hide ? 1 : 0) | (surface ? 2 : 0), current[14]); assertEquals(0, current[15]);
                int oldTable = tableEnd(old, tableEnd(old, 14));
                int newTable = tableEnd(current, tableEnd(current, 16));
                if (extension.equals("b3d")) { oldTable = tableEnd(old, 14); newTable = tableEnd(current, 16); }
                assertArrayEquals(Arrays.copyOfRange(old, 14, oldTable), Arrays.copyOfRange(current, 16, newTable), flavour + " " + base + "." + extension);
                for (int i = 0; i < 1024; i++) {
                    int oldOffset = integer(old, oldTable + i * 8), newOffset = integer(current, newTable + i * 8);
                    assertEquals(oldOffset == 0 ? 0 : oldOffset + 2, newOffset);
                    assertEquals(integer(old, oldTable + i * 8 + 4), integer(current, newTable + i * 8 + 4));
                }
                assertArrayEquals(Arrays.copyOfRange(old, oldTable + 8192, old.length),
                        Arrays.copyOfRange(current, newTable + 8192, current.length - 4100));
                Reader reader = new Reader(out.resolve(base + "." + extension));
                Region source = new Region(in.resolve(base + ".mca"));
                for (int i = 0; i < 1024; i++)
                    assertEquals(source.present(i) ? source.timestamp(i) : 0, reader.timestamps[i]);
            }
        }
    }

    @Test void realModernRegionCounts() throws Exception {
        Path world = FIXTURES.resolve("26.3/overworld");
        Path nether = FIXTURES.resolve("26.3/nether");
        Assumptions.assumeTrue(Files.isRegularFile(world.resolve("r.0.0.mca"))
                && Files.isRegularFile(nether.resolve("r.0.0.mca")), "26.3 fixtures are absent");
        var over = WorldExtractor.extract(world, Files.createTempDirectory(Path.of("core/build"), "over-"), DEFAULT, 4, null, () -> false);
        var under = WorldExtractor.extract(nether, Files.createTempDirectory(Path.of("core/build"), "nether-"), DEFAULT, 4, null, () -> false);
        assertEquals(4096, over.chunksExtracted()); assertEquals(0, over.chunksSkippedUnsupported());
        assertEquals(1089, under.chunksExtracted()); assertEquals(0, under.chunksSkippedUnsupported());
    }

    @Test void unchangedUpdatePreservesBytesAndModificationTime() throws Exception {
        Path input = FIXTURES.resolve("r.0.0.mca");
        Assumptions.assumeTrue(Files.isRegularFile(input), "1.21.11 fixture is absent");
        Path out = Files.createTempDirectory(Path.of("core/build"), "incremental-");
        RegionExtractor.extract(input, out, DEFAULT);
        Path file = out.resolve("r.0.0.b3d");
        byte[] before = Files.readAllBytes(file);
        var modified = Files.getLastModifiedTime(file);
        RegionResult result = RegionExtractor.update(input, out, DEFAULT);
        assertFalse(result.written()); assertArrayEquals(before, Files.readAllBytes(file));
        assertEquals(modified, Files.getLastModifiedTime(file));
    }

    @Test void timestampOnlyUpdateChangesOnlyTrailer() throws Exception {
        Path source = FIXTURES.resolve("r.0.0.mca");
        Assumptions.assumeTrue(Files.isRegularFile(source), "1.21.11 fixture is absent");
        Path dir = Files.createTempDirectory(Path.of("core/build"), "timestamps-");
        Path input = dir.resolve("r.0.0.mca");
        Files.copy(source, input);
        Path out = dir.resolve("out");
        RegionExtractor.extract(input, out, DEFAULT);
        byte[] before2 = Files.readAllBytes(out.resolve("r.0.0.b2d"));
        byte[] before3 = Files.readAllBytes(out.resolve("r.0.0.b3d"));
        byte[] region = Files.readAllBytes(input);
        for (int index : new int[]{0, 33, 1023}) region[4096 + index * 4 + 3]++;
        Files.write(input, region);
        assertTrue(RegionExtractor.update(input, out, DEFAULT).written());
        byte[] after2 = Files.readAllBytes(out.resolve("r.0.0.b2d"));
        byte[] after3 = Files.readAllBytes(out.resolve("r.0.0.b3d"));
        assertArrayEquals(Arrays.copyOf(before2, before2.length - 4100), Arrays.copyOf(after2, after2.length - 4100));
        assertArrayEquals(Arrays.copyOf(before3, before3.length - 4100), Arrays.copyOf(after3, after3.length - 4100));
    }

    private static int tableEnd(byte[] bytes, int at) {
        int[] position = {at};
        int count = varint(bytes, position);
        for (int i = 0; i < count; i++) {
            int length = varint(bytes, position);
            position[0] += length;
        }
        return position[0];
    }

    private static int varint(byte[] bytes, int[] position) {
        int value = 0, shift = 0;
        while (true) {
            int next = bytes[position[0]++] & 255;
            value |= (next & 127) << shift;
            if ((next & 128) == 0) return value;
            shift += 7;
        }
    }

    private static int integer(byte[] bytes, int at) {
        return (bytes[at] & 255) << 24 | (bytes[at + 1] & 255) << 16 | (bytes[at + 2] & 255) << 8 | bytes[at + 3] & 255;
    }

    private static byte[] nbt(int style) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeByte(10); out.writeUTF("");
        out.writeByte(3); out.writeUTF("DataVersion"); out.writeInt(style == 0 ? 4671 : 5023);
        out.writeByte(8); out.writeUTF("Status"); out.writeUTF("minecraft:full");
        out.writeByte(9); out.writeUTF("sections"); out.writeByte(10); out.writeInt(1);
        out.writeByte(1); out.writeUTF("Y"); out.writeByte(0);
        out.writeByte(10); out.writeUTF("block_states");
        out.writeByte(9); out.writeUTF("palette"); out.writeByte(style == 1 ? 8 : 10);
        out.writeInt(style == 1 ? 1 : 2);
        if (style == 1) out.writeUTF("minecraft:stone");
        else {
            out.writeByte(8); out.writeUTF(style == 0 ? "Name" : ""); out.writeUTF("minecraft:stone"); out.writeByte(0);
            out.writeByte(8); out.writeUTF(style == 0 ? "Name" : "id"); out.writeUTF("minecraft:oak_log");
            out.writeByte(10); out.writeUTF(style == 0 ? "Properties" : "properties");
            out.writeByte(8); out.writeUTF("axis"); out.writeUTF("y"); out.writeByte(0); out.writeByte(0);
            out.writeByte(12); out.writeUTF("data"); out.writeInt(256);
            for (int i = 0; i < 256; i++) out.writeLong(0);
        }
        out.writeByte(0); out.writeByte(0); out.writeByte(0);
        return bytes.toByteArray();
    }
}
