package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.*;

import io.github.haribote1110.briskmap.core.extract.Extracted2d;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import io.github.haribote1110.briskmap.core.extract.Palette;
import io.github.haribote1110.briskmap.core.format.Format;
import io.github.haribote1110.briskmap.core.format.Reader;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;

class IncrementalTest {
    private static final ExtractOptions OPTIONS = new ExtractOptions(false, true, 6, true, true);

    @Test void adjacentRegionEdgesOpenFacesAndTrackNeighbourChanges() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "region-seams-");
        Path west = dir.resolve("r.0.0.mca"), east = dir.resolve("r.1.0.mca");
        Path updated = dir.resolve("updated"), fresh = dir.resolve("fresh");
        byte[][] westChunks = new byte[1024][], eastChunks = new byte[1024][];
        int[] westStamps = new int[1024], eastStamps = new int[1024];
        westChunks[31] = chunk("minecraft:full", "minecraft:stone", -1); westStamps[31] = 1;
        eastChunks[0] = chunk("minecraft:full", "minecraft:stone", 0); eastStamps[0] = 1;
        writeRegion(west, westChunks, westStamps);
        writeRegion(east, eastChunks, eastStamps);
        RegionExtractor.extract(west, updated, OPTIONS);
        RegionExtractor.extract(east, updated, OPTIONS);
        Reader first = new Reader(updated.resolve("r.0.0.b3d"));
        assertTrue((mask(first.read3d(31), 8, 8, 15) & 2) != 0, "East face borders air in the adjacent region");
        assertEquals(1, first.adjacentTimestamps[32 + 0]);

        eastChunks[0] = chunk("minecraft:full", "minecraft:stone", -1); eastStamps[0] = 2;
        writeRegion(east, eastChunks, eastStamps);
        RegionResult changed = RegionExtractor.update(west, updated, OPTIONS);
        assertTrue(changed.written());
        assertEquals(1, changed.chunksExtracted(), "Only the touching own chunk is extracted");
        Reader second = new Reader(updated.resolve("r.0.0.b3d"));
        assertEquals(0, mask(second.read3d(31), 8, 8, 15) & 2);
        assertEquals(2, second.adjacentTimestamps[32]);
        RegionExtractor.extract(west, fresh, OPTIONS);
        compare3d(second, new Reader(fresh.resolve("r.0.0.b3d")), 31);
        assertFalse(RegionExtractor.update(west, updated, OPTIONS).written());

        Files.delete(east);
        assertTrue(RegionExtractor.update(west, updated, OPTIONS).written());
        Reader missing = new Reader(updated.resolve("r.0.0.b3d"));
        assertTrue((mask(missing.read3d(31), 8, 8, 15) & 2) != 0);
        assertEquals(0, missing.adjacentTimestamps[32]);
    }

    @Test void reverseSeamFluidAndHeightCutUseTheSameNeighbourRules() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "reverse-seam-");
        Path west = dir.resolve("r.0.0.mca"), east = dir.resolve("r.1.0.mca"), out = dir.resolve("out");
        byte[][] westChunks = new byte[1024][], eastChunks = new byte[1024][];
        int[] westStamps = new int[1024], eastStamps = new int[1024];
        westChunks[31] = chunk("minecraft:full", "minecraft:stone", 15); westStamps[31] = 1;
        eastChunks[0] = chunk("minecraft:full", "minecraft:stone", -1); eastStamps[0] = 1;
        writeRegion(west, westChunks, westStamps);
        writeRegion(east, eastChunks, eastStamps);
        RegionExtractor.extract(east, out, OPTIONS.withMaxY(8));
        Reader cut = new Reader(out.resolve("r.1.0.b3d"));
        assertTrue((mask(cut.read3d(0), 8, 8, 0) & 1) != 0);

        westChunks[31] = chunk("minecraft:full", "minecraft:water", -1); westStamps[31] = 2;
        eastChunks[0] = chunk("minecraft:full", "minecraft:water", -1); eastStamps[0] = 2;
        writeRegion(west, westChunks, westStamps);
        writeRegion(east, eastChunks, eastStamps);
        RegionExtractor.extract(east, out, OPTIONS);
        Reader fluid = new Reader(out.resolve("r.1.0.b3d"));
        assertEquals(0, mask(fluid.read3d(0), 8, 8, 0) & 1);
        Files.delete(west);
        assertTrue(RegionExtractor.update(east, out, OPTIONS).written());
        assertTrue((mask(new Reader(out.resolve("r.1.0.b3d")).read3d(0), 8, 8, 0) & 1) != 0);
    }

    @Test void v4OutputForcesFullRebuild() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "old-format-");
        Path input = dir.resolve("r.0.0.mca"), out = dir.resolve("out");
        byte[][] chunks = new byte[1024][]; int[] stamps = new int[1024];
        chunks[0] = chunk("minecraft:full", "minecraft:stone", -1); stamps[0] = 1;
        writeRegion(input, chunks, stamps);
        RegionExtractor.extract(input, out, OPTIONS);
        for (String extension : List.of("b2d", "b3d")) {
            Path path = out.resolve("r.0.0." + extension);
            byte[] old = Files.readAllBytes(path);
            old[4] = 4;
            Files.write(path, old);
        }
        RegionResult rebuilt = RegionExtractor.update(input, out, OPTIONS);
        assertTrue(rebuilt.written());
        assertEquals(1, rebuilt.chunksExtracted());
        assertEquals(5, new Reader(out.resolve("r.0.0.b2d")).version);
        assertEquals(5, new Reader(out.resolve("r.0.0.b3d")).version);
    }

    private static int mask(Extracted3d shell, int y, int z, int x) {
        int section = (y + 64) >>> 4;
        int position = ((y + 64) & 15) * 256 + z * 16 + x;
        int at = Arrays.binarySearch(shell.positions[section], position);
        return at < 0 ? 0 : shell.masks[section][at] & 255;
    }

    @Test void nonFullAndUnsupportedChunksDoNotRewriteUnchangedRegion() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "unchanged-edge-");
        Path input = dir.resolve("r.0.0.mca"), out = dir.resolve("out");
        byte[][] chunks = new byte[1024][];
        int[] stamps = new int[1024];
        chunks[1] = chunk("minecraft:full", "minecraft:stone", false); stamps[1] = 11;
        chunks[32] = chunk("minecraft:full", "minecraft:stone", false); stamps[32] = 12;
        chunks[33] = chunk("minecraft:carved", "minecraft:stone", false); stamps[33] = 13;
        chunks[34] = chunk("minecraft:full", "minecraft:stone", false); stamps[34] = 14;
        chunks[65] = chunk("minecraft:full", "minecraft:stone", false); stamps[65] = 15;
        chunks[70] = chunk("minecraft:full", "minecraft:stone", false); stamps[70] = 16;
        chunks[100] = chunk("minecraft:full", "minecraft:stone", false); stamps[100] = 17;
        writeRegion(input, chunks, stamps, 70);
        RegionExtractor.extract(input, out, OPTIONS);
        Path twoPath = out.resolve("r.0.0.b2d"), threePath = out.resolve("r.0.0.b3d");
        byte[] firstTwo = Files.readAllBytes(twoPath), firstThree = Files.readAllBytes(threePath);
        for (Path path : List.of(twoPath, threePath)) {
            Reader reader = new Reader(path);
            assertEquals(13, reader.timestamps[33]);
            assertEquals(16, reader.timestamps[70]);
            assertEquals(0, reader.timestamps[71]);
        }
        FileTime fixedTime = FileTime.fromMillis(1_700_000_000_000L);
        Files.setLastModifiedTime(twoPath, fixedTime);
        Files.setLastModifiedTime(threePath, fixedTime);

        RegionResult unchanged = RegionExtractor.update(input, out, OPTIONS);
        assertFalse(unchanged.written());
        assertEquals(0, unchanged.outputFiles());
        assertEquals(0, unchanged.chunksExtracted());
        assertArrayEquals(firstTwo, Files.readAllBytes(twoPath));
        assertArrayEquals(firstThree, Files.readAllBytes(threePath));
        assertEquals(fixedTime, Files.getLastModifiedTime(twoPath));
        assertEquals(fixedTime, Files.getLastModifiedTime(threePath));

        chunks[33] = chunk("minecraft:full", "minecraft:diamond_block", false); stamps[33] = 18;
        writeRegion(input, chunks, stamps, 70);
        RegionResult changed = RegionExtractor.update(input, out, OPTIONS);
        assertTrue(changed.written());
        assertEquals(5, changed.chunksExtracted());
        Path fresh = dir.resolve("fresh");
        RegionExtractor.extract(input, fresh, OPTIONS);
        Reader actualTwo = new Reader(twoPath), actualThree = new Reader(threePath);
        Reader freshTwo = new Reader(fresh.resolve("r.0.0.b2d"));
        Reader freshThree = new Reader(fresh.resolve("r.0.0.b3d"));
        for (int i = 0; i < 1024; i++) {
            compare2d(actualTwo, freshTwo, i);
            compare3d(actualThree, freshThree, i);
            assertEquals(stamps[i], actualTwo.timestamps[i]);
            assertEquals(stamps[i], actualThree.timestamps[i]);
        }
    }

    @Test void identicalOutputBytesDoNotReplaceExistingFile() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "identical-");
        Path file = dir.resolve("r.0.0.b3d");
        byte[][] payloads = new byte[1024][];
        long[] timestamps = new long[1024];
        payloads[0] = new byte[]{1, 2, 3};
        timestamps[0] = 7;
        Palette blocks = new Palette();
        blocks.index("minecraft:stone");
        assertTrue(Format.writeV5IfChanged(file, 2, 0, 0, 0, Short.MAX_VALUE, blocks, null, payloads, timestamps, new long[128]).written());
        byte[] before = Files.readAllBytes(file);
        FileTime fixedTime = FileTime.fromMillis(1_700_000_000_000L);
        Files.setLastModifiedTime(file, fixedTime);
        Format.WriteResult unchanged = Format.writeV5IfChanged(file, 2, 0, 0, 0, Short.MAX_VALUE, blocks, null, payloads, timestamps, new long[128]);
        assertFalse(unchanged.written());
        assertEquals(before.length, unchanged.bytes());
        assertArrayEquals(before, Files.readAllBytes(file));
        assertEquals(fixedTime, Files.getLastModifiedTime(file));
    }

    @Test void changedEdgesAndChunkMembershipMatchFreshExtraction() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "changes-");
        Path input = dir.resolve("r.0.0.mca"), updated = dir.resolve("updated"), fresh = dir.resolve("fresh");
        byte[][] chunks = new byte[1024][];
        int[] stamps = new int[1024];
        chunks[33] = chunk("minecraft:full", "minecraft:stone", false); stamps[33] = 1;
        chunks[34] = chunk("minecraft:full", "minecraft:stone", false); stamps[34] = 1;
        chunks[35] = chunk("minecraft:carved", "minecraft:stone", false); stamps[35] = 1;
        chunks[37] = chunk("minecraft:full", "minecraft:stone", false); stamps[37] = 1;
        writeRegion(input, chunks, stamps);
        RegionExtractor.extract(input, updated, OPTIONS);
        Reader first = new Reader(updated.resolve("r.0.0.b3d"));
        assertTrue(Arrays.binarySearch(first.read3d(33).positions[4], 8 * 256 + 8 * 16 + 15) < 0);
        chunks[34] = chunk("minecraft:full", "minecraft:stone", true); stamps[34] = 2;
        chunks[35] = chunk("minecraft:full", "minecraft:diamond_block", false); stamps[35] = 2;
        chunks[36] = chunk("minecraft:full", "minecraft:stone", false); stamps[36] = 2;
        chunks[37] = null; stamps[37] = 0;
        writeRegion(input, chunks, stamps);
        assertTrue(RegionExtractor.update(input, updated, OPTIONS).written());
        RegionExtractor.extract(input, fresh, OPTIONS);
        Reader changed2 = new Reader(updated.resolve("r.0.0.b2d"));
        Reader changed3 = new Reader(updated.resolve("r.0.0.b3d"));
        Reader fresh2 = new Reader(fresh.resolve("r.0.0.b2d"));
        Reader fresh3 = new Reader(fresh.resolve("r.0.0.b3d"));
        assertTrue(changed3.blocks.contains("minecraft:diamond_block"));
        for (int i = 0; i < 1024; i++) {
            compare2d(changed2, fresh2, i);
            compare3d(changed3, fresh3, i);
        }
        int position = 8 * 256 + 8 * 16 + 15;
        Extracted3d left = changed3.read3d(33);
        assertTrue((left.masks[4][Arrays.binarySearch(left.positions[4], position)] & 2) != 0);
        assertNull(changed2.read2d(37));
    }

    @Test void flagsAndDamagedOutputForceFullExtraction() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "fallback-");
        Path input = dir.resolve("r.0.0.mca"), out = dir.resolve("out");
        byte[][] chunks = new byte[1024][]; int[] stamps = new int[1024];
        chunks[0] = chunk("minecraft:full", "minecraft:stone", false); stamps[0] = 42;
        writeRegion(input, chunks, stamps);
        RegionExtractor.extract(input, out, OPTIONS);
        ExtractOptions changed = new ExtractOptions(false, false, 6, true, true);
        assertTrue(RegionExtractor.update(input, out, changed).written());
        assertEquals(0, new Reader(out.resolve("r.0.0.b3d")).flags);
        Path file = out.resolve("r.0.0.b2d");
        byte[] damaged = Files.readAllBytes(file); damaged[4] = 3; Files.write(file, damaged);
        assertThrows(java.io.IOException.class, () -> new Reader(file));
        assertTrue(RegionExtractor.update(input, out, changed).written());
        assertEquals(5, new Reader(file).version);
        damaged = Files.readAllBytes(file); damaged[damaged.length - 1] = 0; Files.write(file, damaged);
        assertTrue(RegionExtractor.update(input, out, changed).written());
        assertEquals(1, new Reader(file).chunkCount());
    }

    @Test void heightCutChangeForcesFullExtraction() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "height-cut-");
        Path input = dir.resolve("r.0.0.mca"), out = dir.resolve("out");
        byte[][] chunks = new byte[1024][]; int[] stamps = new int[1024];
        chunks[0] = chunk("minecraft:full", "minecraft:stone", false); stamps[0] = 42;
        writeRegion(input, chunks, stamps);
        ExtractOptions cut = OPTIONS.withMaxY(100);
        assertTrue(RegionExtractor.extract(input, out, cut).written());
        assertEquals(100, new Reader(out.resolve("r.0.0.b2d")).maxY);
        assertEquals(100, new Reader(out.resolve("r.0.0.b3d")).maxY);
        assertFalse(RegionExtractor.update(input, out, cut).written());
        assertTrue(RegionExtractor.update(input, out, cut.withMaxY(90)).written());
        assertEquals(90, new Reader(out.resolve("r.0.0.b2d")).maxY);
        assertEquals(90, new Reader(out.resolve("r.0.0.b3d")).maxY);
    }

    @Test void blockDefaultsFlagForcesFullExtractionWhenItChanges() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "defaults-flag-");
        Path input = dir.resolve("r.0.0.mca"), out = dir.resolve("out");
        byte[][] chunks = new byte[1024][]; int[] stamps = new int[1024];
        chunks[0] = chunk("minecraft:full", "minecraft:grass_block", false); stamps[0] = 42;
        writeRegion(input, chunks, stamps);
        ExtractOptions normalised = new ExtractOptions(false, true, 6, true, true, BlockDefaults.of(
                java.util.Map.of("minecraft:grass_block", "minecraft:grass_block[snowy=false]")));
        RegionExtractor.extract(input, out, OPTIONS);
        for (String file : List.of("r.0.0.b2d", "r.0.0.b3d")) {
            Reader reader = new Reader(out.resolve(file));
            assertEquals(2, reader.flags);
            assertTrue(reader.blocks.contains("minecraft:grass_block"));
        }

        RegionResult upgraded = RegionExtractor.update(input, out, normalised);
        assertTrue(upgraded.written());
        assertEquals(1, upgraded.chunksExtracted());
        for (String file : List.of("r.0.0.b2d", "r.0.0.b3d")) {
            Reader reader = new Reader(out.resolve(file));
            assertEquals(6, reader.flags);
            assertTrue(reader.blocks.contains("minecraft:grass_block[snowy=false]"));
            assertFalse(reader.blocks.contains("minecraft:grass_block"));
        }
        assertFalse(RegionExtractor.update(input, out, normalised).written());

        assertTrue(RegionExtractor.update(input, out, OPTIONS).written());
        assertEquals(2, new Reader(out.resolve("r.0.0.b3d")).flags);
    }

    @Test void worldDeletionCancellationAndProgress() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "world-");
        Path input = dir.resolve("in"), out = dir.resolve("out");
        Files.createDirectories(input);
        byte[][] chunks = new byte[1024][]; int[] stamps = new int[1024];
        chunks[0] = chunk("minecraft:full", "minecraft:stone", false); stamps[0] = 1;
        writeRegion(input.resolve("r.0.0.mca"), chunks, stamps);
        writeRegion(input.resolve("r.1.0.mca"), chunks, stamps);
        List<Integer> progress = new ArrayList<>();
        AtomicBoolean stop = new AtomicBoolean();
        var partial = WorldExtractor.extract(input, out, OPTIONS, 1, (done, total) -> {
            progress.add(done); stop.set(true); assertEquals(2, total);
        }, stop::get);
        assertEquals(1, partial.regions()); assertEquals(List.of(1), progress);
        assertEquals(0, Files.list(out).filter(path -> path.toString().endsWith(".tmp")).count());
        stop.set(false);
        var complete = WorldExtractor.extract(input, out, OPTIONS, 2, null, stop::get);
        assertEquals(2, complete.regions());
        Files.delete(input.resolve("r.1.0.mca"));
        var reduced = WorldExtractor.update(input, out, OPTIONS, 1, null, stop::get);
        assertEquals(1, reduced.regionsDeleted());
        assertFalse(Files.exists(out.resolve("r.1.0.b2d")));
    }

    @Test void cliPrintsDocumentedSummary() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "cli-");
        Path input = Path.of("feasibility_research/fixtures");
        Assumptions.assumeTrue(Files.isRegularFile(input.resolve("r.0.0.mca"))
                && Files.isRegularFile(input.resolve("r.-1.-1.mca")), "1.21.11 fixtures are absent");
        PrintStream original = System.out;
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        try {
            System.setOut(new PrintStream(captured, true, StandardCharsets.UTF_8));
            io.github.haribote1110.briskmap.core.cli.Main.main(new String[]{"--in", input.toString(), "--out", dir.resolve("out").toString(), "--threads", "1"});
        } finally { System.setOut(original); }
        String json = captured.toString(StandardCharsets.UTF_8).trim();
        assertTrue(json.startsWith("{\"caves\":\"hide\""));
        for (String field : List.of("chunks_extracted", "chunks_reused", "regions_written", "regions_unchanged",
                "regions_deleted", "data_version_min", "data_version_max")) assertTrue(json.contains("\"" + field + "\":"), field);
        assertTrue(json.contains("\"chunks_extracted\":2048"));
    }

    private static void compare2d(Reader actual, Reader expected, int index) throws IOException {
        Extracted2d a = actual.read2d(index), b = expected.read2d(index);
        if (a == null || b == null) { assertNull(a); assertNull(b); return; }
        for (int i = 0; i < 256; i++) {
            assertEquals(b.y[i], a.y[i]); assertEquals(b.depth[i], a.depth[i]);
            assertEquals(expected.blocks.get(b.block[i]), actual.blocks.get(a.block[i]));
            assertEquals(expected.biomes.get(b.biome[i]), actual.biomes.get(a.biome[i]));
        }
    }

    private static void compare3d(Reader actual, Reader expected, int index) throws IOException {
        Extracted3d a = actual.read3d(index), b = expected.read3d(index);
        if (a == null || b == null) { assertNull(a); assertNull(b); return; }
        for (int section = 0; section < 24; section++) {
            assertArrayEquals(b.positions[section], a.positions[section]);
            assertArrayEquals(b.masks[section], a.masks[section]);
            for (int i = 0; i < a.blocks[section].length; i++)
                assertEquals(expected.blocks.get(b.blocks[section][i]), actual.blocks.get(a.blocks[section][i]));
        }
    }

    private static void writeRegion(Path path, byte[][] chunks, int[] stamps) throws IOException {
        writeRegion(path, chunks, stamps, -1);
    }

    private static void writeRegion(Path path, byte[][] chunks, int[] stamps, int unsupportedIndex) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] header = new byte[8192];
        int sector = 2;
        for (int i = 0; i < 1024; i++) if (chunks[i] != null) {
            int sectors = (chunks[i].length + 5 + 4095) / 4096;
            header[i * 4] = (byte) (sector >>> 16); header[i * 4 + 1] = (byte) (sector >>> 8);
            header[i * 4 + 2] = (byte) sector; header[i * 4 + 3] = (byte) sectors;
            sector += sectors;
        }
        for (int i = 0; i < 1024; i++) {
            int at = 4096 + i * 4; header[at] = (byte) (stamps[i] >>> 24);
            header[at + 1] = (byte) (stamps[i] >>> 16); header[at + 2] = (byte) (stamps[i] >>> 8);
            header[at + 3] = (byte) stamps[i];
        }
        bytes.write(header);
        for (int i = 0; i < chunks.length; i++) if (chunks[i] != null) {
            byte[] chunk = chunks[i];
            DataOutputStream out = new DataOutputStream(bytes);
            out.writeInt(chunk.length + 1); out.writeByte(i == unsupportedIndex ? 4 : 3); out.write(chunk);
            int padding = (4096 - (chunk.length + 5) % 4096) % 4096;
            bytes.write(new byte[padding]);
        }
        Files.write(path, bytes.toByteArray());
    }

    private static byte[] chunk(String status, String state, boolean edgeAir) throws IOException {
        return chunk(status, state, edgeAir ? 0 : -1);
    }

    private static byte[] chunk(String status, String state, int airX) throws IOException {
        boolean edgeAir = airX >= 0;
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeByte(10); out.writeUTF("");
        out.writeByte(3); out.writeUTF("DataVersion"); out.writeInt(5023);
        out.writeByte(8); out.writeUTF("Status"); out.writeUTF(status);
        out.writeByte(10); out.writeUTF("Heightmaps");
        long[] heights = new long[37];
        for (int col = 0; col < 256; col++) heights[col / 7] |= 80L << (col % 7 * 9);
        for (String name : List.of("WORLD_SURFACE", "OCEAN_FLOOR")) {
            out.writeByte(12); out.writeUTF(name); out.writeInt(heights.length);
            for (long value : heights) out.writeLong(value);
        }
        out.writeByte(0);
        out.writeByte(9); out.writeUTF("sections"); out.writeByte(10); out.writeInt(1);
        out.writeByte(1); out.writeUTF("Y"); out.writeByte(0);
        out.writeByte(10); out.writeUTF("block_states");
        out.writeByte(9); out.writeUTF("palette"); out.writeByte(8); out.writeInt(edgeAir ? 2 : 1);
        out.writeUTF(state); if (edgeAir) out.writeUTF("minecraft:air");
        if (edgeAir) {
            out.writeByte(12); out.writeUTF("data"); out.writeInt(256);
            int affected = 8 * 256 + 8 * 16 + airX;
            for (int i = 0; i < 256; i++) out.writeLong(i == affected / 16 ? 1L << (affected % 16 * 4) : 0);
        }
        out.writeByte(0);
        out.writeByte(10); out.writeUTF("biomes");
        out.writeByte(9); out.writeUTF("palette"); out.writeByte(8); out.writeInt(1);
        out.writeUTF("minecraft:plains"); out.writeByte(0); out.writeByte(0);
        out.writeByte(0); out.writeByte(0);
        return bytes.toByteArray();
    }
}
