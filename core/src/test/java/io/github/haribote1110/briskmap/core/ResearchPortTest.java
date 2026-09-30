package io.github.haribote1110.briskmap.core;

import io.github.haribote1110.briskmap.core.extract.*;
import io.github.haribote1110.briskmap.core.nbt.NbtReader;
import io.github.haribote1110.briskmap.core.region.Region;
import io.github.haribote1110.briskmap.core.format.Format;
import io.github.haribote1110.briskmap.core.format.Reader;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;

import java.util.Arrays;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.Deflater;
import java.util.zip.Inflater;
import java.util.zip.GZIPOutputStream;
import java.util.zip.DeflaterOutputStream;


public final class ResearchPortTest {
    @Test void blockBitsFour() { bits(4, 4096); }
    @Test void blockBitsFive() { bits(5, 4096); }
    @Test void blockBitsSeven() { bits(7, 4096); }
    @Test void heightBits() { bits(9, 256); }
    @Test void selectiveNbt() throws Exception { nbt(); }
    @Test void compression() throws Exception { regionCompression(); }
    @Test void occlusion() { occlusionRules(); }
    @Test void bruteForceShell() { shell(); }
    @Test void neighbourEdges() { crossChunk(); }
    @Test void caveFloor() { caves(); }
    @Test void formats() throws Exception { roundTrip(); }
    @Test void fixtureChecks() throws Exception { assumeFixtures(); fixtures(); }
    @Test void fixtureMasks() throws Exception { assumeFixtures(); visibleMasks(); }
    @Test void fluidFaces() { waterCube(); }

    private static void assumeFixtures() {
        Assumptions.assumeTrue(Files.isRegularFile(Path.of("feasibility_research/fixtures/r.0.0.mca"))
            && Files.isRegularFile(Path.of("feasibility_research/fixtures/r.-1.-1.mca")),
            "1.21.11 region fixtures are absent");
    }

    private static void bits(int width, int count) {
        int[] expected = new int[count];
        int perLong = 64 / width;
        long[] packed = new long[(count + perLong - 1) / perLong];
        for (int i = 0; i < count; i++) {
            expected[i] = (i * 37 + 11) & ((1 << width) - 1);
            packed[i / perLong] |= (long) expected[i] << ((i % perLong) * width);
        }
        int[] actual = new int[count];
        for (int i = 0; i < count; i++) actual[i] = Bits.get(packed, width, i);
        check(Arrays.equals(expected, actual), "unpacked values differ");
    }

    private static void nbt() throws Exception {
        Chunk chunk = NbtReader.read(syntheticNbt());
        check(chunk.dataVersion == 4671 && chunk.xPos == 3 && chunk.zPos == -2, "coordinates or version");
        check("minecraft:full".equals(chunk.status), "status");
        check(chunk.worldSurface[0] == 129 && chunk.oceanFloor[0] == 128, "heightmaps");
        check("minecraft:stone[axis=y,waterlogged=false]".equals(chunk.sections[0].blocks[0]), "state properties");
        check("minecraft:plains".equals(chunk.sections[0].biomes[0]), "biome");
    }

    private static byte[] syntheticNbt() throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(bytes);
        out.writeByte(10); out.writeUTF("");
        integer(out, "DataVersion", 4671);
        integer(out, "xPos", 3);
        integer(out, "zPos", -2);
        string(out, "Status", "minecraft:full");
        out.writeByte(10); out.writeUTF("Heightmaps");
        long[] heights = new long[37]; heights[0] = 129;
        longs(out, "WORLD_SURFACE", heights);
        heights[0] = 128;
        longs(out, "OCEAN_FLOOR", heights);
        out.writeByte(0);
        out.writeByte(9); out.writeUTF("sections"); out.writeByte(10); out.writeInt(1);
        out.writeByte(1); out.writeUTF("Y"); out.writeByte(-4);
        out.writeByte(10); out.writeUTF("block_states");
        out.writeByte(9); out.writeUTF("palette"); out.writeByte(10); out.writeInt(1);
        string(out, "Name", "minecraft:stone");
        out.writeByte(10); out.writeUTF("Properties"); string(out, "waterlogged", "false"); string(out, "axis", "y"); out.writeByte(0);
        out.writeByte(0); out.writeByte(0);
        out.writeByte(10); out.writeUTF("biomes");
        out.writeByte(9); out.writeUTF("palette"); out.writeByte(8); out.writeInt(1); out.writeUTF("minecraft:plains");
        out.writeByte(0); out.writeByte(0);
        out.writeByte(9); out.writeUTF("unused"); out.writeByte(10); out.writeInt(1);
        string(out, "noise", "ignored"); out.writeByte(0);
        out.writeByte(0);
        return bytes.toByteArray();
    }

    private static void regionCompression() throws Exception {
        byte[] nbt = syntheticNbt();
        for (int type : new int[]{1, 2, 3, 4}) {
            ByteArrayOutputStream compressed = new ByteArrayOutputStream();
            if (type == 1) try (GZIPOutputStream zip = new GZIPOutputStream(compressed)) { zip.write(nbt); }
            else if (type == 2) try (DeflaterOutputStream zip = new DeflaterOutputStream(compressed)) { zip.write(nbt); }
            else compressed.write(nbt);
            byte[] body = compressed.toByteArray();
            byte[] file = new byte[12288];
            file[2] = 2; file[3] = 1;
            int start = 8192, length = body.length + 1;
            file[start] = (byte)(length >>> 24); file[start + 1] = (byte)(length >>> 16);
            file[start + 2] = (byte)(length >>> 8); file[start + 3] = (byte)length;
            file[start + 4] = (byte)type;
            System.arraycopy(body, 0, file, start + 5, body.length);
            Path dir = Files.createTempDirectory(Path.of("core/build"), "region-");
            Path path = dir.resolve("r.0.0.mca");
            Files.write(path, file);
            Region region = new Region(path);
            if (type == 4) {
                try { region.read(0, new Inflater()); throw new AssertionError("unsupported type accepted"); }
                catch (Region.UnsupportedChunkException expected) { check(region.compressionType(0) == type, "wrong compression type"); }
            } else check(region.read(0, new Inflater()).dataVersion == 4671, "compression " + type);
        }
    }

    private static void shell() {
        Chunk chunk = new Chunk();
        chunk.sections = new Section[24];
        for (int sy = 0; sy < 3; sy++) chunk.sections[sy] = new Section(sy - 4, new String[]{"minecraft:stone", "minecraft:air"}, new long[256], new String[]{"minecraft:plains"}, null);
        // Fill the middle section with stone, then carve one interior air pocket.
        Section middle = chunk.sections[1];
        int[] values = new int[4096];
        Arrays.fill(values, 0);
        values[(8 * 16 + 8) * 16 + 8] = 1;
        middle.blockData = pack(values, 4);
        Palette palette = new Palette();
        Chunk[] chunks = new Chunk[1024]; chunks[33] = chunk;
        BorderCache borders = new BorderCache(); borders.put(33, chunk, palette, false);
        Extracted3d actual = Extractor.extract3d(chunk, palette, borders, 33, false);
        check(actual.same(referenceShell(chunks, 33, palette, false)), "synthetic shell differs");
    }

    private static void occlusionRules() {
        String[] names = {"bedrock", "red_bed", "chain", "chain_command_block", "mushroom_stem", "red_mushroom", "red_mushroom_block", "poppy", "short_grass", "grass_block", "snow", "snow_block", "stone_brick_wall", "wall_torch", "flower_pot", "potted_poppy", "oak_fence_gate", "stone", "glass", "white_stained_glass_pane", "tube_coral", "tube_coral_block"};
        boolean[] occluding = {true, false, false, true, true, false, true, false, false, true, false, true, false, false, false, false, false, true, false, false, false, true};
        for (int i = 0; i < names.length; i++) check(Extractor.isOccluding("minecraft:" + names[i]) == occluding[i], "occlusion " + names[i]);
    }

    private static Chunk solidChunk() {
        Chunk chunk = new Chunk();
        chunk.status = "minecraft:full";
        chunk.sections[4] = new Section(0, new String[]{"minecraft:stone"}, null, new String[]{"minecraft:plains"}, null);
        chunk.oceanFloor = new int[256];
        return chunk;
    }

    private static void crossChunk() {
        Chunk[] chunks = new Chunk[1024];
        chunks[33] = solidChunk(); chunks[34] = solidChunk();
        Palette palette = new Palette();
        BorderCache borders = new BorderCache();
        borders.put(33, chunks[33], palette, false);
        borders.put(34, chunks[34], palette, false);
        Extracted3d shell = Extractor.extract3d(chunks[33], palette, borders, 33, false);
        int inside = (8 * 16 + 8) * 16 + 15;
        check(Arrays.binarySearch(shell.positions[4], inside) < 0, "shared face kept");
        check(shell.same(referenceShell(chunks, 33, palette, false)), "cross-chunk shell differs");
        chunks[0] = solidChunk(); borders.put(0, chunks[0], palette, false);
        shell = Extractor.extract3d(chunks[0], palette, borders, 0, false);
        int seam = (8 * 16 + 8) * 16;
        check(Arrays.binarySearch(shell.positions[4], seam) >= 0, "missing adjacent region must be open");
        check(shell.same(referenceShell(chunks, 0, palette, false)), "region edge shell differs");
    }

    private static void caves() {
        Chunk[] chunks = new Chunk[1024];
        chunks[33] = solidChunk(); chunks[34] = solidChunk();
        int[] values = new int[4096];
        values[(8 * 16 + 8) * 16] = 1;
        chunks[34].sections[4] = new Section(0, new String[]{"minecraft:stone", "minecraft:air"}, pack(values, 4), new String[]{"minecraft:plains"}, null);
        Arrays.fill(chunks[34].oceanFloor, 129);
        Palette palette = new Palette();
        int position = (8 * 16 + 8) * 16 + 15;
        BorderCache keep = new BorderCache(), hide = new BorderCache();
        for (int index : new int[]{33, 34}) { keep.put(index, chunks[index], palette, false); hide.put(index, chunks[index], palette, true); }
        Extracted3d visible = Extractor.extract3d(chunks[33], palette, keep, 33, false);
        Extracted3d hidden = Extractor.extract3d(chunks[33], palette, hide, 33, true);
        check(Arrays.binarySearch(visible.positions[4], position) >= 0, "cave face missing in keep");
        check(Arrays.binarySearch(hidden.positions[4], position) < 0, "cave face kept in hide");
        check(visible.same(referenceShell(chunks, 33, palette, false)), "keep cave reference differs");
        check(hidden.same(referenceShell(chunks, 33, palette, true)), "hide cave reference differs");
    }

    private static void roundTrip() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("core/build"), "roundtrip-");
        Palette blocks = new Palette(); for (int i = 0; i < 300; i++) blocks.index("minecraft:test_" + i);
        Palette biomes = new Palette(); biomes.index("minecraft:plains");
        Extracted2d surface = new Extracted2d();
        for (int i = 0; i < 256; i++) { surface.y[i] = (short)(i - 64); surface.block[i] = i; surface.biome[i] = 0; surface.depth[i] = (byte)(i % 17); }
        Extracted3d shell = new Extracted3d();
        shell.positions[0] = new int[]{0, 15, 4000}; shell.blocks[0] = new int[]{0, 128, 299}; shell.masks[0] = new byte[]{1, 42, 63};
        byte[][] two = new byte[1024][], three = new byte[1024][];
        Deflater compressor = new Deflater(6, true);
        two[32] = Format.compress(Format.encode2d(surface), compressor);
        three[32] = Format.compress(Format.encode3d(shell), compressor);
        long[] timestamps = new long[1024]; timestamps[32] = 1234;
        Path a = dir.resolve("r.0.0.b2d"), b = dir.resolve("r.0.0.b3d");
        Format.writeV5(a, 1, 0, 0, 3, Short.MAX_VALUE, blocks, biomes, two, timestamps, new long[128]);
        Format.writeV5(b, 2, 0, 0, 3, Short.MAX_VALUE, blocks, null, three, timestamps, new long[128]);
        Reader r2 = new Reader(a), r3 = new Reader(b);
        Extracted2d got2 = r2.read2d(32); Extracted3d got3 = r3.read3d(32);
        check(Arrays.equals(surface.y, got2.y) && Arrays.equals(surface.block, got2.block) && Arrays.equals(surface.biome, got2.biome) && Arrays.equals(surface.depth, got2.depth), "2d differs");
        checkMasks(shell, got3, "3d round trip");
        check(r2.chunkCount() == 1 && r3.chunkCount() == 1 && r2.blocks.size() == 300 && r2.timestamps[32] == 1234, "header differs");
    }

    private static void fixtures() throws Exception {
        for (String name : new String[]{"r.0.0", "r.-1.-1"}) {
            Region region = new Region(Path.of("feasibility_research/fixtures/" + name + ".mca"));
            Inflater inflater = new Inflater();
            long keepTotal = Long.MAX_VALUE;
            for (boolean hide : new boolean[]{false, true}) {
                BorderCache borders = new BorderCache();
                Palette borderPalette = new Palette();
                for (int i = 0; i < 1024; i++) borders.put(i, region.read(i, inflater), borderPalette, hide);
                int full = 0, edgeSamples = 0, interiorSamples = 0;
                long shellTotal = 0, nonairTotal = 0;
                for (int i = 0; i < 1024; i++) {
                    Chunk chunk = region.read(i, inflater);
                    check(chunk != null && "minecraft:full".equals(chunk.status), name + " missing/full " + i);
                    check(region.compressionType(i) == 2, name + " non-zlib chunk " + i);
                    check(chunk.dataVersion == 4671 && chunk.sectionCount == 25 && chunk.sectionMinY == -5 && chunk.sectionMaxY == 19, name + " NBT layout mismatch " + i);
                    full++;
                    Palette blocks = new Palette(), biomes = new Palette();
                    Extracted2d surface = Extractor.extract2d(chunk, blocks, biomes);
                    Extracted3d shell = Extractor.extract3d(chunk, blocks, borders, i, hide);
                    checkFaceTotals(shell, name + " " + i + " hide=" + hide + " volume");
                    checkFaceTotals(Extractor.extract3d(chunk, blocks, borders, i, hide, true), name + " " + i + " hide=" + hide + " surface");
                    shellTotal += shell.count(); nonairTotal += shell.nonair;
                    for (int col = 0; col < 256; col++) {
                        int y = surface.y[col], x = col & 15, z = col >>> 4;
                        check(y == Extractor.EMPTY_Y || y >= -64 && y <= 319, "surface height");
                        if (y == Extractor.EMPTY_Y) continue;
                        check(!Extractor.isAir(blocks.get(surface.block[col])), "air surface");
                        int sy = (y + 64) / 16, p = (((y + 64) % 16) * 16 + z) * 16 + x;
                        int at = Arrays.binarySearch(shell.positions[sy], p);
                        check(at >= 0 && shell.blocks[sy][at] == surface.block[col], "surface absent from shell " + name + " " + i + " " + col + " hide=" + hide);
                    }
                    if (i == 0 || i == 33 || i == 528 || i == 1023) {
                        Chunk[] around = new Chunk[1024]; around[i] = chunk;
                        int cx = i & 31, cz = i >>> 5;
                        if (cx > 0) around[i - 1] = region.read(i - 1, inflater);
                        if (cx < 31) around[i + 1] = region.read(i + 1, inflater);
                        if (cz > 0) around[i - 32] = region.read(i - 32, inflater);
                        if (cz < 31) around[i + 32] = region.read(i + 32, inflater);
                        check(referenceShell(around, i, blocks, hide).same(shell), "fast shell differs " + name + " " + i + " hide=" + hide);
                        if (cx == 0 || cx == 31 || cz == 0 || cz == 31) edgeSamples++; else interiorSamples++;
                    }
                }
                check(full == 1024 && edgeSamples >= 1 && interiorSamples >= 1, name + " counts hide=" + hide);
                check(shellTotal < nonairTotal, name + " shell not smaller hide=" + hide);
                if (hide) check(shellTotal < keepTotal, name + " cave mask did not reduce shell");
                else keepTotal = shellTotal;
            }
        }
    }

    private static Extracted3d referenceShell(Chunk[] chunks, int index, Palette palette, boolean hide) {
        return referenceShell(chunks, index, palette, hide, false);
    }

    private static Extracted3d referenceShell(Chunk[] chunks, int index, Palette palette, boolean hide, boolean surfaceFluids) {
        int[][][] decoded = new int[1024][][];
        for (int i = 0; i < chunks.length; i++) if (chunks[i] != null) decoded[i] = Extractor.decodeBlocks(chunks[i], palette);
        int[][] all = decoded[index];
        int[][] positions = new int[24][4096], blocks = new int[24][4096];
        byte[][] masks = new byte[24][4096];
        int[] counts = new int[24];
        int[] dx = {-1, 1, 0, 0, 0, 0}, dy = {0, 0, -1, 1, 0, 0}, dz = {0, 0, 0, 0, -1, 1};
        for (int y = 0; y < 384; y++) for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            int sy = y / 16, p = ((y % 16) * 16 + z) * 16 + x, id = all[sy][p];
            if (Extractor.isAir(palette.get(id))) continue;
            int mask = 0;
            for (int d = 0; d < 6; d++) {
                int nx = x + dx[d], ny = y + dy[d], nz = z + dz[d];
                boolean neighbourOccluding;
                if (ny < 0 || ny > 383) neighbourOccluding = false;
                else {
                    int neighbourIndex = index;
                    if (nx < 0) neighbourIndex = (index & 31) == 0 ? -1 : index - 1;
                    else if (nx > 15) neighbourIndex = (index & 31) == 31 ? -1 : index + 1;
                    else if (nz < 0) neighbourIndex = index < 32 ? -1 : index - 32;
                    else if (nz > 15) neighbourIndex = index >= 992 ? -1 : index + 32;
                    if (neighbourIndex < 0) neighbourOccluding = false;
                    else if (chunks[neighbourIndex] == null) neighbourOccluding = false;
                    else {
                        int localX = nx & 15, localZ = nz & 15;
                        int neighbour = decoded[neighbourIndex][ny / 16][((ny % 16) * 16 + localZ) * 16 + localX];
                        neighbourOccluding = Extractor.isOccluding(palette.get(neighbour));
                        if (surfaceFluids && fluid(palette.get(id)) != 0 && fluid(palette.get(id)) == fluid(palette.get(neighbour))) neighbourOccluding = true;
                        if (hide && !neighbourOccluding && ny - 64 < 55) {
                            int floor = chunks[neighbourIndex].oceanFloor[localZ * 16 + localX] - 65;
                            if (ny - 64 < floor) neighbourOccluding = true;
                        }
                    }
                }
                if (!neighbourOccluding) mask |= 1 << d;
            }
            if (mask != 0) { int at = counts[sy]++; positions[sy][at] = p; blocks[sy][at] = id; masks[sy][at] = (byte)mask; }
        }
        Extracted3d result = new Extracted3d();
        for (int sy = 0; sy < 24; sy++) {
            result.positions[sy] = Arrays.copyOf(positions[sy], counts[sy]);
            result.blocks[sy] = Arrays.copyOf(blocks[sy], counts[sy]);
            result.masks[sy] = Arrays.copyOf(masks[sy], counts[sy]);
        }
        return result;
    }

    private static int fluid(String state) {
        String name = state.split("\\[", 2)[0];
        return name.equals("minecraft:water") ? 1 : name.equals("minecraft:lava") ? 2 : 0;
    }

    private static void checkMasks(Extracted3d expected, Extracted3d actual, String label) {
        long faces = 0;
        for (int sy = 0; sy < 24; sy++) {
            check(Arrays.equals(expected.positions[sy], actual.positions[sy]), label + " positions " + sy);
            check(Arrays.equals(expected.blocks[sy], actual.blocks[sy]), label + " blocks " + sy);
            check(Arrays.equals(expected.masks[sy], actual.masks[sy]), label + " masks " + sy);
            for (int i = 0; i < actual.masks[sy].length; i++) {
                byte mask = actual.masks[sy][i];
                check(mask != 0, label + " zero mask");
                faces += Integer.bitCount(mask & 63);
            }
        }
        check(faces == actual.faces, label + " face total");
    }

    private static void checkFaceTotals(Extracted3d shell, String label) {
        long faces = 0;
        for (byte[] section : shell.masks) for (byte mask : section) {
            check(mask != 0 && (mask & 0xc0) == 0, label + " invalid mask");
            faces += Integer.bitCount(mask & 63);
        }
        check(faces == shell.faces, label + " face total");
    }

    private static void visibleMasks() throws Exception {
        for (String name : new String[]{"r.0.0", "r.-1.-1"}) {
            Region region = new Region(Path.of("feasibility_research/fixtures/" + name + ".mca"));
            Inflater inflater = new Inflater();
            for (boolean hide : new boolean[]{false, true}) {
                BorderCache borders = new BorderCache();
                Palette palette = new Palette();
                for (int i = 0; i < 1024; i++) borders.put(i, region.read(i, inflater), palette, hide);
                for (int index : new int[]{0, 33, 528, 1023}) {
                    Chunk[] around = new Chunk[1024];
                    around[index] = region.read(index, inflater);
                    if ((index & 31) > 0) around[index - 1] = region.read(index - 1, inflater);
                    if ((index & 31) < 31) around[index + 1] = region.read(index + 1, inflater);
                    if (index >= 32) around[index - 32] = region.read(index - 32, inflater);
                    if (index < 992) around[index + 32] = region.read(index + 32, inflater);
                    for (boolean surface : new boolean[]{false, true}) {
                        Extracted3d actual = Extractor.extract3d(around[index], palette, borders, index, hide, surface);
                        Extracted3d expected = referenceShell(around, index, palette, hide, surface);
                        checkMasks(expected, actual, name + " " + index + " hide=" + hide + " surface=" + surface);
                        if (!surface) check(actual.same(Extractor.extract3d(around[index], palette, borders, index, hide)), "v1 membership changed");
                    }
                }
            }
        }
    }

    private static void waterCube() {
        Chunk chunk = new Chunk(); chunk.status = "minecraft:full"; chunk.oceanFloor = new int[256];
        int[] values = new int[4096]; Arrays.fill(values, 1);
        for (int y = 7; y <= 9; y++) for (int z = 7; z <= 9; z++) for (int x = 7; x <= 9; x++) values[y * 256 + z * 16 + x] = 0;
        chunk.sections[4] = new Section(0, new String[]{"minecraft:water[level=0]", "minecraft:air"}, pack(values, 4), new String[]{"minecraft:plains"}, null);
        Chunk[] chunks = new Chunk[1024]; chunks[33] = chunk;
        Palette palette = new Palette(); BorderCache borders = new BorderCache(); borders.put(33, chunk, palette, false);
        Extracted3d volume = Extractor.extract3d(chunk, palette, borders, 33, false, false);
        Extracted3d surface = Extractor.extract3d(chunk, palette, borders, 33, false, true);
        checkMasks(referenceShell(chunks, 33, palette, false, false), volume, "cube volume");
        checkMasks(referenceShell(chunks, 33, palette, false, true), surface, "cube surface");
        int centre = 8 * 256 + 8 * 16 + 8;
        check(Arrays.binarySearch(volume.positions[4], centre) >= 0, "volume centre absent");
        check(Arrays.binarySearch(surface.positions[4], centre) < 0, "surface centre present");
        check(volume.count() == 27 && surface.count() == 26, "cube membership");
    }

    private static long[] pack(int[] values, int width) {
        int per = 64 / width; long[] data = new long[(values.length + per - 1) / per];
        for (int i = 0; i < values.length; i++) data[i / per] |= (long)values[i] << (i % per * width);
        return data;
    }

    private static void integer(DataOutputStream out, String name, int value) throws Exception { out.writeByte(3); out.writeUTF(name); out.writeInt(value); }
    private static void string(DataOutputStream out, String name, String value) throws Exception { out.writeByte(8); out.writeUTF(name); out.writeUTF(value); }
    private static void longs(DataOutputStream out, String name, long[] value) throws Exception { out.writeByte(12); out.writeUTF(name); out.writeInt(value.length); for (long v : value) out.writeLong(v); }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

}
