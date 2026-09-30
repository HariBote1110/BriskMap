package io.github.haribote1110.briskmap.core;

import io.github.haribote1110.briskmap.core.extract.BorderCache;
import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Clock;
import io.github.haribote1110.briskmap.core.extract.Extractor;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import io.github.haribote1110.briskmap.core.extract.Palette;
import io.github.haribote1110.briskmap.core.extract.Reachability;
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
        Region[] adjacent = new Region[8];
        int[] xOffset = {-1, 1, 0, 0, -1, 1, -1, 1}, zOffset = {0, 0, -1, 1, -1, -1, 1, 1};
        for (int side = 0; side < 8; side++) {
            Path path = mca.resolveSibling("r." + (regionX + xOffset[side]) + "." + (regionZ + zOffset[side]) + ".mca");
            if (Files.isRegularFile(path)) adjacent[side] = new Region(path);
        }
        long[] adjacentTimes = new long[132];
        for (int side = 0; side < 4; side++) for (int coordinate = 0; coordinate < 32; coordinate++) {
            Region neighbour = adjacent[side];
            int index = adjacentIndex(side, coordinate);
            adjacentTimes[side * 32 + coordinate] = neighbour != null && neighbour.present(index) ? neighbour.timestamp(index) : 0;
        }
        int[] cornerIndex = {1023, 992, 31, 0};
        for (int corner = 0; corner < 4; corner++) {
            Region neighbour = adjacent[corner + 4];
            adjacentTimes[128 + corner] = neighbour != null && neighbour.present(cornerIndex[corner])
                    ? neighbour.timestamp(cornerIndex[corner]) : 0;
        }
        Path twoPath = outDir.resolve(name.replace(".mca", ".b2d"));
        Path threePath = outDir.resolve(name.replace(".mca", ".b3d"));
        Reader oldTwo = options.do2d() && incremental ? valid(twoPath, 1, regionX, regionZ, options.flags(), options.headerMaxY(), options.caveDepth()) : null;
        Reader oldThree = options.do3d() && incremental ? valid(threePath, 2, regionX, regionZ, options.flags(), options.headerMaxY(), options.caveDepth()) : null;
        if (oldTwo != null && oldThree != null && !oldTwo.blocks.equals(oldThree.blocks)) oldThree = null;
        boolean[] changedTwo = new boolean[1024], changedThree = new boolean[1024];
        long[] currentTimes = new long[1024];
        for (int i = 0; i < 1024; i++) {
            currentTimes[i] = region.present(i) ? region.timestamp(i) : 0;
            changedTwo[i] = options.do2d() && (oldTwo == null || currentTimes[i] != oldTwo.timestamps[i]);
            changedThree[i] = options.do3d() && (oldThree == null || currentTimes[i] != oldThree.timestamps[i]);
        }
        boolean[] affectedThree = Arrays.copyOf(changedThree, 1024);
        boolean bounded = options.hideCaves() && options.caveDepth() > 0;
        if (oldThree != null) for (int side = 0; side < 4; side++) for (int coordinate = 0; coordinate < 32; coordinate++) {
            int at = side * 32 + coordinate;
            if (adjacentTimes[at] != oldThree.adjacentTimestamps[at]) {
                int own = ownIndex(side, coordinate);
                affectedThree[own] = true;
                if (bounded && side < 2) {
                    if (coordinate > 0) affectedThree[own - 32] = true;
                    if (coordinate < 31) affectedThree[own + 32] = true;
                } else if (bounded) {
                    if (coordinate > 0) affectedThree[own - 1] = true;
                    if (coordinate < 31) affectedThree[own + 1] = true;
                }
            }
        }
        if (bounded && oldThree != null) for (int corner = 0; corner < 4; corner++)
            if (adjacentTimes[128 + corner] != oldThree.adjacentTimestamps[128 + corner])
                affectedThree[new int[]{0, 31, 992, 1023}[corner]] = true;
        for (int i = 0; i < 1024; i++) if (changedThree[i]) {
            for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
                if (!bounded && dx != 0 && dz != 0) continue;
                int x = (i & 31) + dx, z = (i >>> 5) + dz;
                if (x >= 0 && x < 32 && z >= 0 && z < 32) affectedThree[z * 32 + x] = true;
            }
        }
        boolean writeTwo = options.do2d() && (any(changedTwo) || oldTwo != null && !Arrays.equals(adjacentTimes, oldTwo.adjacentTimestamps));
        boolean writeThree = options.do3d() && (any(affectedThree)
                || oldThree != null && !Arrays.equals(adjacentTimes, oldThree.adjacentTimestamps));
        if (!writeTwo && !writeThree) return new RegionResult(0, 0, 0, 0,
                Math.max(oldTwo == null ? 0 : oldTwo.chunkCount(), oldThree == null ? 0 : oldThree.chunkCount()),
                options.do2d() ? Files.size(twoPath) : 0, options.do3d() ? Files.size(threePath) : 0,
                0, false, 0, 0, readNs, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

        Palette blocks = new Palette(), biomes = new Palette();
        if (oldTwo != null) { for (String state : oldTwo.blocks) blocks.index(state); for (String biome : oldTwo.biomes) biomes.index(biome); }
        else if (oldThree != null) for (String state : oldThree.blocks) blocks.index(state);
        byte[][] two = options.do2d() ? new byte[1024][] : null;
        byte[][] three = options.do3d() ? new byte[1024][] : null;
        if (oldTwo != null) for (int i = 0; i < 1024; i++) two[i] = oldTwo.compressed(i);
        if (oldThree != null) for (int i = 0; i < 1024; i++) three[i] = oldThree.compressed(i);
        BorderCache borders = null;
        Reachability reach = null;
        Inflater inflater = INFLATER.get();
        long borderNs = 0;
        if (any(affectedThree)) {
            tick = Clock.now();
            borders = new BorderCache();
            if (options.hideCaves() && options.caveDepth() > 0) reach = new Reachability(options.maxY());
            Palette borderPalette = new Palette();
            for (int i = 0; i < 1024; i++) {
                try {
                    Chunk candidate = region.read(i, inflater, options.blockDefaults());
                    if (reach == null) borders.put(i, candidate, borderPalette, options.hideCaves(), options.maxY());
                    else borders.putFluids(i, candidate, options.maxY());
                    if (reach != null) reach.put(i & 31, i >>> 5, candidate);
                }
                catch (Region.UnsupportedChunkException ignored) { /* Counted during extraction. */ }
            }
            for (int side = 0; side < 4; side++) for (int coordinate = 0; coordinate < 32; coordinate++) {
                Region neighbour = adjacent[side];
                if (neighbour == null) continue;
                try {
                    Chunk candidate = neighbour.read(adjacentIndex(side, coordinate), inflater, options.blockDefaults());
                    if (reach == null) borders.putAdjacent(side, coordinate, candidate, options.hideCaves(), options.maxY());
                    else borders.putAdjacentFluids(side, coordinate, candidate, options.maxY());
                    if (reach != null) reach.put(side == 0 ? -1 : side == 1 ? 32 : coordinate,
                            side == 2 ? -1 : side == 3 ? 32 : coordinate, candidate);
                }
                catch (Region.UnsupportedChunkException ignored) { /* An unsupported neighbour is open space. */ }
            }
            if (reach != null) {
                for (int corner = 0; corner < 4; corner++) {
                    Region neighbour = adjacent[corner + 4];
                    if (neighbour == null) continue;
                    try { reach.put(corner % 2 == 0 ? -1 : 32, corner < 2 ? -1 : 32,
                            neighbour.read(cornerIndex[corner], inflater, options.blockDefaults())); }
                    catch (Region.UnsupportedChunkException ignored) { /* An unsupported neighbour is open space. */ }
                }
                reach.flood(options.caveDepth());
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
            if (!changedTwo[i] && !affectedThree[i]) { if (region.present(i)) reused++; continue; }
            Chunk chunk;
            try { chunk = region.read(i, inflater, options.blockDefaults()); }
            catch (Region.UnsupportedChunkException ex) {
                total++; unsupported++;
                if (changedTwo[i]) two[i] = null;
                if (affectedThree[i]) three[i] = null;
                continue;
            }
            if (chunk == null) {
                if (changedTwo[i]) two[i] = null;
                if (affectedThree[i]) three[i] = null;
                continue;
            }
            total++;
            inflateNs += region.inflateNs;
            parseNs += region.parseNs;
            minVersion = Math.min(minVersion, chunk.dataVersion);
            maxVersion = Math.max(maxVersion, chunk.dataVersion);
            if (!"minecraft:full".equals(chunk.status)) {
                notFull++;
                if (changedTwo[i]) two[i] = null;
                if (affectedThree[i]) three[i] = null;
                continue;
            }
            extracted++;
            if (changedTwo[i]) {
                tick = Clock.now();
                byte[] payload = Format.encode2d(Extractor.extract2d(chunk, blocks, biomes, options.maxY()));
                extract2dNs += Clock.now() - tick;
                tick = Clock.now();
                two[i] = Format.compress(payload, deflater);
                compressNs += Clock.now() - tick;
            }
            if (affectedThree[i]) {
                tick = Clock.now();
                Extracted3d shell = Extractor.extract3d(chunk, blocks, borders, i,
                        options.hideCaves(), options.surfaceFluids(), options.maxY(), reach);
                byte[] payload = Format.encode3d(shell);
                extract3dNs += Clock.now() - tick;
                shellBlocks += shell.count(); blocksNonair += shell.nonair;
                shellFluidBlocks += shell.shellFluidBlocks; faces += shell.faces;
                tick = Clock.now();
                three[i] = Format.compress(payload, deflater);
                compressNs += Clock.now() - tick;
            }
        }
        tick = Clock.now();
        Format.WriteResult twoResult = writeTwo ? Format.writeV6IfChanged(twoPath, 1, regionX, regionZ, options.flags(), options.caveDepth(), options.headerMaxY(), blocks, biomes, two, currentTimes, adjacentTimes) : null;
        Format.WriteResult threeResult = writeThree ? Format.writeV6IfChanged(threePath, 2, regionX, regionZ, options.flags(), options.caveDepth(), options.headerMaxY(), blocks, null, three, currentTimes, adjacentTimes) : null;
        long twoBytes = options.do2d() ? writeTwo ? twoResult.bytes() : Files.size(twoPath) : 0;
        long threeBytes = options.do3d() ? writeThree ? threeResult.bytes() : Files.size(threePath) : 0;
        int outputFiles = (twoResult != null && twoResult.written() ? 1 : 0)
                + (threeResult != null && threeResult.written() ? 1 : 0);
        long writeNs = Clock.now() - tick;
        return new RegionResult(total, extracted, notFull, unsupported, reused, twoBytes, threeBytes,
                outputFiles, outputFiles > 0,
                minVersion == Integer.MAX_VALUE ? 0 : minVersion, maxVersion == Integer.MIN_VALUE ? 0 : maxVersion,
                readNs, borderNs, inflateNs, parseNs, extract2dNs, extract3dNs, compressNs, writeNs,
                shellBlocks, blocksNonair, shellFluidBlocks, faces);
    }

    private static Reader valid(Path path, int kind, int x, int z, int flags, int maxY, int caveDepth) {
        try {
            Reader reader = new Reader(path);
            return reader.kind == kind && reader.regionX == x && reader.regionZ == z && reader.flags == flags && reader.maxY == maxY && reader.caveDepth == caveDepth ? reader : null;
        } catch (IOException ex) { return null; }
    }

    private static boolean any(boolean[] values) {
        for (boolean value : values) if (value) return true;
        return false;
    }

    private static int adjacentIndex(int side, int coordinate) {
        return switch (side) {
            case BorderCache.WEST -> 31 + coordinate * 32;
            case BorderCache.EAST -> coordinate * 32;
            case BorderCache.NORTH -> coordinate + 992;
            case BorderCache.SOUTH -> coordinate;
            default -> throw new IllegalArgumentException("Unknown border direction");
        };
    }

    private static int ownIndex(int side, int coordinate) {
        return switch (side) {
            case BorderCache.WEST -> coordinate * 32;
            case BorderCache.EAST -> 31 + coordinate * 32;
            case BorderCache.NORTH -> coordinate;
            case BorderCache.SOUTH -> coordinate + 992;
            default -> throw new IllegalArgumentException("Unknown border direction");
        };
    }
}
