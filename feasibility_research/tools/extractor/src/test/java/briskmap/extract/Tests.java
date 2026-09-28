package briskmap.extract;

import java.util.Arrays;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.Deflater;
import java.util.zip.Inflater;
import java.util.zip.GZIPOutputStream;
import java.util.zip.DeflaterOutputStream;
import briskmap.extract.format.Reader;

public final class Tests {
    private static int failed;

    public static void main(String[] args) throws Exception {
        run("block bits 4", () -> bits(4, 4096));
        run("block bits 5", () -> bits(5, 4096));
        run("block bits 7", () -> bits(7, 4096));
        run("height bits 9", () -> bits(9, 256));
        run("NBT selective read", Tests::nbt);
        run("region compression types", Tests::regionCompression);
        run("shell matches brute force", Tests::shell);
        run("2d and 3d round trip", Tests::roundTrip);
        run("fixture invariants", Tests::fixtures);
        if (failed != 0) System.exit(1);
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
        for (int type : new int[]{1, 2, 3, 4, 130}) {
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
            Path path = Files.createTempFile(Path.of("feasibility_research/tools/extractor/build"), "region-", ".mca");
            Files.write(path, file);
            Region region = new Region(path);
            if (type == 4 || type == 130) {
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
        Extracted3d actual = Extractor.extract3d(chunk, palette);
        int[][] all = Extractor.decodeBlocks(chunk, palette);
        int expected = 0;
        int stone = palette.index("minecraft:stone");
        for (int y = 0; y < 384; y++) for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            int at = (y % 16 * 16 + z) * 16 + x;
            if (all[y / 16][at] != stone) continue;
            boolean edge = y == 0 || y == 383 || x == 0 || x == 15 || z == 0 || z == 15;
            boolean adjacentAir = false;
            if (y > 0) adjacentAir |= all[(y - 1) / 16][((y - 1) % 16 * 16 + z) * 16 + x] != stone;
            if (y < 383) adjacentAir |= all[(y + 1) / 16][((y + 1) % 16 * 16 + z) * 16 + x] != stone;
            if (x > 0) adjacentAir |= all[y / 16][at - 1] != stone;
            if (x < 15) adjacentAir |= all[y / 16][at + 1] != stone;
            if (z > 0) adjacentAir |= all[y / 16][at - 16] != stone;
            if (z < 15) adjacentAir |= all[y / 16][at + 16] != stone;
            if (edge || adjacentAir) expected++;
        }
        check(actual.count() == expected, "shell count " + actual.count() + " != " + expected);
        check(actual.same(referenceShell(chunk, palette)), "synthetic shell positions differ");
    }

    private static void roundTrip() throws Exception {
        Path dir = Files.createTempDirectory(Path.of("feasibility_research/tools/extractor/build"), "roundtrip-");
        Palette blocks = new Palette(); for (int i = 0; i < 300; i++) blocks.index("minecraft:test_" + i);
        Palette biomes = new Palette(); biomes.index("minecraft:plains");
        Extracted2d surface = new Extracted2d();
        for (int i = 0; i < 256; i++) { surface.y[i] = (short)(i - 64); surface.block[i] = i; surface.biome[i] = 0; surface.depth[i] = (byte)(i % 17); }
        Extracted3d shell = new Extracted3d();
        shell.positions[0] = new int[]{0, 15, 4000}; shell.blocks[0] = new int[]{0, 128, 299};
        byte[][] two = new byte[1024][], three = new byte[1024][];
        two[32] = Format.encode2d(surface); three[32] = Format.encode3d(shell);
        Path a = dir.resolve("r.0.0.b2d"), b = dir.resolve("r.0.0.b3d");
        Format.write(a, 1, 0, 0, blocks, biomes, two, new Deflater(6, true));
        Format.write(b, 2, 0, 0, blocks, null, three, new Deflater(6, true));
        Reader r2 = new Reader(a), r3 = new Reader(b);
        Extracted2d got2 = r2.read2d(32); Extracted3d got3 = r3.read3d(32);
        check(Arrays.equals(surface.y, got2.y) && Arrays.equals(surface.block, got2.block) && Arrays.equals(surface.biome, got2.biome) && Arrays.equals(surface.depth, got2.depth), "2d differs");
        check(Arrays.equals(shell.positions[0], got3.positions[0]) && Arrays.equals(shell.blocks[0], got3.blocks[0]), "3d differs");
        check(r2.chunkCount() == 1 && r3.chunkCount() == 1 && r2.blocks.size() == 300, "header differs");
    }

    private static void fixtures() throws Exception {
        for (String name : new String[]{"r.0.0", "r.-1.-1"}) {
            Region region = new Region(Path.of("feasibility_research/fixtures/" + name + ".mca"));
            Inflater inflater = new Inflater();
            int full = 0, sampled = 0;
            long shellTotal = 0, nonairTotal = 0;
            for (int i = 0; i < 1024; i++) {
                Chunk chunk = region.read(i, inflater);
                check(chunk != null && "minecraft:full".equals(chunk.status), name + " missing/full " + i);
                check(region.compressionType(i) == 2, name + " non-zlib chunk " + i);
                check(chunk.dataVersion == 4671 && chunk.sectionCount == 25 && chunk.sectionMinY == -5 && chunk.sectionMaxY == 19, name + " NBT layout mismatch " + i);
                full++;
                Palette blocks = new Palette(), biomes = new Palette();
                Extracted2d surface = Extractor.extract2d(chunk, blocks, biomes);
                Extracted3d shell = Extractor.extract3d(chunk, blocks);
                shellTotal += shell.count(); nonairTotal += shell.nonair;
                for (int col = 0; col < 256; col++) {
                    int y = surface.y[col], x = col & 15, z = col >>> 4;
                    check(y == Extractor.EMPTY_Y || y >= -64 && y <= 319, "surface height");
                    if (y == Extractor.EMPTY_Y) continue;
                    check(!Extractor.isAir(blocks.get(surface.block[col])), "air surface");
                    int sy = (y + 64) / 16, p = (((y + 64) % 16) * 16 + z) * 16 + x;
                    int at = Arrays.binarySearch(shell.positions[sy], p);
                    check(at >= 0 && shell.blocks[sy][at] == surface.block[col], "surface absent from shell");
                }
                if (i % 256 == 0) { sampled++; check(referenceShell(chunk, blocks).same(shell), "fast shell differs"); }
            }
            check(full == 1024 && sampled >= 4, name + " counts");
            check(shellTotal < nonairTotal, name + " shell not smaller");
        }
    }

    private static Extracted3d referenceShell(Chunk chunk, Palette palette) {
        int[][] all = Extractor.decodeBlocks(chunk, palette);
        int[][] positions = new int[24][4096], blocks = new int[24][4096];
        int[] counts = new int[24];
        int[] dx = {-1, 1, 0, 0, 0, 0}, dy = {0, 0, -1, 1, 0, 0}, dz = {0, 0, 0, 0, -1, 1};
        for (int y = 0; y < 384; y++) for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            int sy = y / 16, p = ((y % 16) * 16 + z) * 16 + x, id = all[sy][p];
            if (Extractor.isAir(palette.get(id))) continue;
            for (int d = 0; d < 6; d++) {
                int nx = x + dx[d], ny = y + dy[d], nz = z + dz[d];
                if (nx < 0 || nx > 15 || ny < 0 || ny > 383 || nz < 0 || nz > 15 ||
                    !Extractor.isOccluding(palette.get(all[ny / 16][((ny % 16) * 16 + nz) * 16 + nx]))) {
                    int at = counts[sy]++;
                    positions[sy][at] = p; blocks[sy][at] = id;
                    break;
                }
            }
        }
        Extracted3d result = new Extracted3d();
        for (int sy = 0; sy < 24; sy++) {
            result.positions[sy] = Arrays.copyOf(positions[sy], counts[sy]);
            result.blocks[sy] = Arrays.copyOf(blocks[sy], counts[sy]);
        }
        return result;
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

    private static void run(String name, Test test) {
        try {
            test.run();
            System.out.println("PASS " + name);
        } catch (Throwable ex) {
            failed++;
            System.out.println("FAIL " + name + ": " + ex);
        }
    }

    private interface Test { void run() throws Exception; }
}
