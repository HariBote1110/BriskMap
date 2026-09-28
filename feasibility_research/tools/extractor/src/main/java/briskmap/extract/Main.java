package briskmap.extract;

import briskmap.extract.format.Reader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

public final class Main {
    private static final Pattern REGION_NAME = Pattern.compile("r\\.(-?\\d+)\\.(-?\\d+)\\.mca");
    private static final ThreadLocal<Inflater> INFLATER = ThreadLocal.withInitial(Inflater::new);
    private static final ThreadLocal<Deflater> DEFLATER = new ThreadLocal<>();

    public static void main(String[] args) throws Exception {
        if (args.length == 2 && args[0].equals("verify")) {
            Reader reader = new Reader(Path.of(args[1]));
            System.out.println("{\"chunks\":" + reader.chunkCount() + ",\"palette_size\":" + reader.blocks.size() + ",\"kind\":" + reader.kind + "}");
            return;
        }
        Path input = null, output = null;
        String mode = "both", caves = "keep";
        int threads = Runtime.getRuntime().availableProcessors(), level = 6, limit = Integer.MAX_VALUE;
        for (int i = 0; i < args.length; i++) {
            if (i + 1 >= args.length) throw new IllegalArgumentException("Missing value for " + args[i]);
            String value = args[++i];
            switch (args[i - 1]) {
                case "--in" -> input = Path.of(value);
                case "--out" -> output = Path.of(value);
                case "--mode" -> mode = value;
                case "--caves" -> caves = value;
                case "--threads" -> threads = Integer.parseInt(value);
                case "--level" -> level = Integer.parseInt(value);
                case "--limit-regions" -> limit = Integer.parseInt(value);
                default -> throw new IllegalArgumentException("Unknown option " + args[i - 1]);
            }
        }
        if (input == null || output == null || !(mode.equals("both") || mode.equals("2d") || mode.equals("3d")) || !(caves.equals("keep") || caves.equals("hide")) || threads < 1 || level < 0 || level > 9 || limit < 1) throw new IllegalArgumentException("Usage: --in DIR --out DIR [--mode 2d|3d|both] [--caves keep|hide] [--threads N] [--level 0-9] [--limit-regions N]");
        final boolean do2d = !mode.equals("3d"), do3d = !mode.equals("2d");
        final boolean hideCaves = caves.equals("hide");
        final Path outDir = output;
        final int compressionLevel = level;
        List<Path> paths = new ArrayList<>();
        try (var stream = Files.list(input)) { stream.filter(p -> REGION_NAME.matcher(p.getFileName().toString()).matches()).sorted(Comparator.comparing(p -> p.getFileName().toString())).limit(limit).forEach(paths::add); }
        long start = System.nanoTime();
        var pool = Executors.newFixedThreadPool(threads);
        List<Future<Metrics>> results = new ArrayList<>();
        try {
            for (Path path : paths) results.add(pool.submit((Callable<Metrics>)() -> process(path, outDir, do2d, do3d, hideCaves, compressionLevel)));
            Metrics sum = new Metrics();
            for (Future<Metrics> result : results) sum.add(result.get());
            sum.wallMs = (System.nanoTime() - start) / 1_000_000;
            sum.caves = caves;
            System.out.println(sum.json());
        } finally { pool.shutdownNow(); }
    }

    private static Metrics process(Path path, Path outDir, boolean do2d, boolean do3d, boolean hideCaves, int level) throws Exception {
        Metrics metrics = new Metrics(); metrics.regions = 1;
        long tick = Clock.now();
        Region region = new Region(path);
        metrics.readNs += Clock.now() - tick;
        metrics.inputBytes = region.size();
        Matcher matcher = REGION_NAME.matcher(path.getFileName().toString());
        if (!matcher.matches()) throw new IllegalArgumentException(path.toString());
        int regionX = Integer.parseInt(matcher.group(1)), regionZ = Integer.parseInt(matcher.group(2));
        Palette blocks = new Palette(), biomes = new Palette();
        byte[][] two = do2d ? new byte[1024][] : null, three = do3d ? new byte[1024][] : null;
        Inflater inflater = INFLATER.get();
        BorderCache borders = null;
        if (do3d) {
            tick = Clock.now();
            borders = new BorderCache();
            Palette borderPalette = new Palette();
            for (int i = 0; i < 1024; i++) {
                try { borders.put(i, region.read(i, inflater), borderPalette, hideCaves); }
                catch (Region.UnsupportedChunkException ex) { /* The second pass counts unsupported chunks. */ }
            }
            metrics.borderPassNs = Clock.now() - tick;
        }
        for (int i = 0; i < 1024; i++) {
            Chunk chunk;
            try { chunk = region.read(i, inflater); }
            catch (Region.UnsupportedChunkException ex) { metrics.chunksTotal++; metrics.skippedUnsupported++; continue; }
            if (chunk == null) continue;
            metrics.chunksTotal++;
            metrics.inflateNs += region.inflateNs;
            metrics.parseNs += region.parseNs;
            if (!"minecraft:full".equals(chunk.status)) { metrics.skippedNotFull++; continue; }
            metrics.chunksExtracted++;
            if (do2d) {
                tick = Clock.now();
                two[i] = Format.encode2d(Extractor.extract2d(chunk, blocks, biomes));
                metrics.extract2dNs += Clock.now() - tick;
            }
            if (do3d) {
                tick = Clock.now();
                Extracted3d shell = Extractor.extract3d(chunk, blocks, borders, i, hideCaves);
                three[i] = Format.encode3d(shell);
                metrics.extract3dNs += Clock.now() - tick;
                metrics.shellBlocks += shell.count(); metrics.blocksNonair += shell.nonair;
            }
        }
        Deflater deflater = DEFLATER.get();
        if (deflater == null) { deflater = new Deflater(level, true); DEFLATER.set(deflater); }
        if (do2d) {
            Format.WriteResult result = Format.write(outDir.resolve(path.getFileName().toString().replace(".mca", ".b2d")), 1, regionX, regionZ, blocks, biomes, two, deflater);
            metrics.compressNs += result.compressNs; metrics.writeNs += result.writeNs; metrics.outputBytes2d += result.bytes; metrics.outputFiles++;
        }
        if (do3d) {
            Format.WriteResult result = Format.write(outDir.resolve(path.getFileName().toString().replace(".mca", ".b3d")), 2, regionX, regionZ, blocks, null, three, deflater);
            metrics.compressNs += result.compressNs; metrics.writeNs += result.writeNs; metrics.outputBytes3d += result.bytes; metrics.outputFiles++;
        }
        return metrics;
    }

    private static final class Metrics {
        String caves = "keep";
        long regions, chunksTotal, chunksExtracted, skippedNotFull, skippedUnsupported, inputBytes, outputBytes2d, outputBytes3d, outputFiles, wallMs;
        long readNs, borderPassNs, inflateNs, parseNs, extract2dNs, extract3dNs, compressNs, writeNs, shellBlocks, blocksNonair;
        void add(Metrics m) {
            regions += m.regions; chunksTotal += m.chunksTotal; chunksExtracted += m.chunksExtracted; skippedNotFull += m.skippedNotFull; skippedUnsupported += m.skippedUnsupported;
            inputBytes += m.inputBytes; outputBytes2d += m.outputBytes2d; outputBytes3d += m.outputBytes3d; outputFiles += m.outputFiles;
            readNs += m.readNs; borderPassNs += m.borderPassNs; inflateNs += m.inflateNs; parseNs += m.parseNs; extract2dNs += m.extract2dNs; extract3dNs += m.extract3dNs; compressNs += m.compressNs; writeNs += m.writeNs; shellBlocks += m.shellBlocks; blocksNonair += m.blocksNonair;
        }
        String json() {
            return "{\"caves\":\"" + caves + "\",\"regions\":" + regions + ",\"chunks_total\":" + chunksTotal + ",\"chunks_extracted\":" + chunksExtracted +
                ",\"chunks_skipped_not_full\":" + skippedNotFull + ",\"chunks_skipped_unsupported\":" + skippedUnsupported +
                ",\"input_bytes\":" + inputBytes + ",\"output_bytes_2d\":" + outputBytes2d + ",\"output_bytes_3d\":" + outputBytes3d +
                ",\"output_files\":" + outputFiles + ",\"wall_ms\":" + wallMs + ",\"read_ms\":" + readNs / 1_000_000 + ",\"border_pass_ms\":" + borderPassNs / 1_000_000 +
                ",\"inflate_ms\":" + inflateNs / 1_000_000 + ",\"parse_ms\":" + parseNs / 1_000_000 +
                ",\"extract_2d_ms\":" + extract2dNs / 1_000_000 + ",\"extract_3d_ms\":" + extract3dNs / 1_000_000 +
                ",\"compress_ms\":" + compressNs / 1_000_000 + ",\"write_ms\":" + writeNs / 1_000_000 +
                ",\"shell_blocks_total\":" + shellBlocks + ",\"blocks_nonair_total\":" + blocksNonair + "}";
        }
    }
}
