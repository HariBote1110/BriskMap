package io.github.haribote1110.briskmap.core;

import io.github.haribote1110.briskmap.core.extract.BorderCache;
import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Clock;
import io.github.haribote1110.briskmap.core.extract.Extractor;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import io.github.haribote1110.briskmap.core.extract.Palette;
import io.github.haribote1110.briskmap.core.format.Format;
import io.github.haribote1110.briskmap.core.format.Reader;
import io.github.haribote1110.briskmap.core.region.Region;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/** Extracts one region. Concurrent calls for the same region require caller synchronisation. */
public final class RegionExtractor {
    private static final ThreadLocal<Inflater> INFLATER = ThreadLocal.withInitial(Inflater::new);
    private static final ThreadLocal<Deflater> DEFLATER = ThreadLocal.withInitial(() -> new Deflater(6, true));

    private RegionExtractor() { }

    public static RegionResult extract(Path mca, Path outDir, ExtractOptions options) throws IOException {
        return process(mca, outDir, options, false);
    }

    public static RegionResult update(Path mca, Path outDir, ExtractOptions options) throws IOException {
        return process(mca, outDir, options, true);
    }

    private static RegionResult process(Path mca, Path outDir, ExtractOptions options, boolean incremental) throws IOException {
        long tick = Clock.now();
        Region region = new Region(mca);
        long readNs = Clock.now() - tick;
        String name = mca.getFileName().toString();
        String[] parts = name.split("\\.");
        int regionX = Integer.parseInt(parts[1]), regionZ = Integer.parseInt(parts[2]);
        Path twoPath = outDir.resolve(name.replace(".mca", ".b2d"));
        Path threePath = outDir.resolve(name.replace(".mca", ".b3d"));
        Reader oldTwo = options.do2d() && incremental ? valid(twoPath, 1, regionX, regionZ, options.flags()) : null;
        Reader oldThree = options.do3d() && incremental ? valid(threePath, 2, regionX, regionZ, options.flags()) : null;
        if (oldTwo != null && oldThree != null && !oldTwo.blocks.equals(oldThree.blocks)) oldThree = null;
        boolean[] changedTwo = new boolean[1024], changedThree = new boolean[1024];
        for (int i = 0; i < 1024; i++) {
            changedTwo[i] = options.do2d() && (oldTwo == null || region.timestamp(i) != oldTwo.timestamps[i]);
            changedThree[i] = options.do3d() && (oldThree == null || region.timestamp(i) != oldThree.timestamps[i]);
        }
        boolean[] affectedThree = Arrays.copyOf(changedThree, 1024);
        for (int i = 0; i < 1024; i++) if (changedThree[i]) {
            if ((i & 31) > 0) affectedThree[i - 1] = true;
            if ((i & 31) < 31) affectedThree[i + 1] = true;
            if (i >= 32) affectedThree[i - 32] = true;
            if (i < 992) affectedThree[i + 32] = true;
        }
        boolean writeTwo = options.do2d() && any(changedTwo);
        boolean writeThree = options.do3d() && any(changedThree);
        if (!writeTwo && !writeThree) return new RegionResult(0, 0, 0, 0,
                Math.max(oldTwo == null ? 0 : oldTwo.chunkCount(), oldThree == null ? 0 : oldThree.chunkCount()),
                options.do2d() ? Files.size(twoPath) : 0, options.do3d() ? Files.size(threePath) : 0,
                0, false, 0, 0, readNs, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

        Palette blocks = new Palette(), biomes = new Palette();
        if (oldTwo != null) { for (String state : oldTwo.blocks) blocks.index(state); for (String biome : oldTwo.biomes) biomes.index(biome); }
        else if (oldThree != null) for (String state : oldThree.blocks) blocks.index(state);
        byte[][] two = options.do2d() ? new byte[1024][] : null;
        byte[][] three = options.do3d() ? new byte[1024][] : null;
        long[] twoTimes = new long[1024], threeTimes = new long[1024];
        if (oldTwo != null) for (int i = 0; i < 1024; i++) { two[i] = oldTwo.compressed(i); twoTimes[i] = oldTwo.timestamps[i]; }
        if (oldThree != null) for (int i = 0; i < 1024; i++) { three[i] = oldThree.compressed(i); threeTimes[i] = oldThree.timestamps[i]; }
        BorderCache borders = null;
        Inflater inflater = INFLATER.get();
        long borderNs = 0;
        if (writeThree) {
            tick = Clock.now();
            borders = new BorderCache();
            Palette borderPalette = new Palette();
            for (int i = 0; i < 1024; i++) {
                try { borders.put(i, region.read(i, inflater), borderPalette, options.hideCaves()); }
                catch (Region.UnsupportedChunkException ignored) { /* Counted during extraction. */ }
            }
            borderNs = Clock.now() - tick;
        }
        Deflater deflater = DEFLATER.get();
        deflater.setLevel(options.compressionLevel());
        long total = 0, extracted = 0, notFull = 0, unsupported = 0, reused = 0;
        long inflateNs = 0, parseNs = 0, extract2dNs = 0, extract3dNs = 0, compressNs = 0;
        long shellBlocks = 0, blocksNonair = 0, shellFluidBlocks = 0, faces = 0;
        int minVersion = Integer.MAX_VALUE, maxVersion = Integer.MIN_VALUE;
        for (int i = 0; i < 1024; i++) {
            if (!changedTwo[i] && !affectedThree[i]) { if (region.timestamp(i) != 0) reused++; continue; }
            Chunk chunk;
            try { chunk = region.read(i, inflater); }
            catch (Region.UnsupportedChunkException ex) {
                total++; unsupported++;
                if (changedTwo[i]) { two[i] = null; twoTimes[i] = 0; }
                if (affectedThree[i]) { three[i] = null; threeTimes[i] = 0; }
                continue;
            }
            if (chunk == null) {
                if (changedTwo[i]) { two[i] = null; twoTimes[i] = 0; }
                if (affectedThree[i]) { three[i] = null; threeTimes[i] = 0; }
                continue;
            }
            total++;
            inflateNs += region.inflateNs;
            parseNs += region.parseNs;
            minVersion = Math.min(minVersion, chunk.dataVersion);
            maxVersion = Math.max(maxVersion, chunk.dataVersion);
            if (!"minecraft:full".equals(chunk.status)) {
                notFull++;
                if (changedTwo[i]) { two[i] = null; twoTimes[i] = 0; }
                if (affectedThree[i]) { three[i] = null; threeTimes[i] = 0; }
                continue;
            }
            extracted++;
            if (changedTwo[i]) {
                tick = Clock.now();
                byte[] payload = Format.encode2d(Extractor.extract2d(chunk, blocks, biomes));
                extract2dNs += Clock.now() - tick;
                tick = Clock.now();
                two[i] = Format.compress(payload, deflater);
                compressNs += Clock.now() - tick;
                twoTimes[i] = region.timestamp(i);
            }
            if (affectedThree[i]) {
                tick = Clock.now();
                Extracted3d shell = Extractor.extract3d(chunk, blocks, borders, i,
                        options.hideCaves(), options.surfaceFluids());
                byte[] payload = Format.encode3d(shell);
                extract3dNs += Clock.now() - tick;
                shellBlocks += shell.count(); blocksNonair += shell.nonair;
                shellFluidBlocks += shell.shellFluidBlocks; faces += shell.faces;
                tick = Clock.now();
                three[i] = Format.compress(payload, deflater);
                compressNs += Clock.now() - tick;
                threeTimes[i] = region.timestamp(i);
            }
        }
        tick = Clock.now();
        long twoBytes = options.do2d() ? writeTwo ? Format.writeV3(twoPath, 1, regionX, regionZ, options.flags(), blocks, biomes, two, twoTimes) : Files.size(twoPath) : 0;
        long threeBytes = options.do3d() ? writeThree ? Format.writeV3(threePath, 2, regionX, regionZ, options.flags(), blocks, null, three, threeTimes) : Files.size(threePath) : 0;
        long writeNs = Clock.now() - tick;
        return new RegionResult(total, extracted, notFull, unsupported, reused, twoBytes, threeBytes,
                (writeTwo ? 1 : 0) + (writeThree ? 1 : 0), true,
                minVersion == Integer.MAX_VALUE ? 0 : minVersion, maxVersion == Integer.MIN_VALUE ? 0 : maxVersion,
                readNs, borderNs, inflateNs, parseNs, extract2dNs, extract3dNs, compressNs, writeNs,
                shellBlocks, blocksNonair, shellFluidBlocks, faces);
    }

    private static Reader valid(Path path, int kind, int x, int z, int flags) {
        try {
            Reader reader = new Reader(path);
            return reader.kind == kind && reader.regionX == x && reader.regionZ == z && reader.flags == flags ? reader : null;
        } catch (IOException ex) { return null; }
    }

    private static boolean any(boolean[] values) {
        for (boolean value : values) if (value) return true;
        return false;
    }
}
