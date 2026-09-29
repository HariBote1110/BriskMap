package io.github.haribote1110.briskmap.core.cli;

import io.github.haribote1110.briskmap.core.ExtractOptions;
import io.github.haribote1110.briskmap.core.WorldExtractor;
import io.github.haribote1110.briskmap.core.textures.TextureBuilder;
import java.nio.file.Path;

public final class Main {
    private Main() { }

    public static void main(String[] args) throws Exception {
        if (args.length > 0 && args[0].equals("textures")) {
            Path jar = null, out = null;
            for (int i = 1; i < args.length; i++) {
                String option = args[i];
                if (++i >= args.length) throw new IllegalArgumentException("Missing value for " + option);
                switch (option) {
                    case "--jar" -> jar = Path.of(args[i]);
                    case "--out" -> out = Path.of(args[i]);
                    default -> throw new IllegalArgumentException("Unknown option " + option);
                }
            }
            if (jar == null || out == null) throw new IllegalArgumentException("Usage: textures --jar PATH --out DIR");
            TextureBuilder.Summary summary = TextureBuilder.build(jar, out);
            System.out.println("{\"blocks\":" + summary.blocks() + ",\"entries\":" + summary.entries()
                    + ",\"unknown\":" + summary.unknown() + ",\"fallback\":" + summary.fallback()
                    + ",\"layers\":" + summary.layers() + ",\"atlasBytes\":" + summary.atlasBytes()
                    + ",\"ms\":" + summary.ms() + "}");
            return;
        }
        Path input = null, output = null;
        String caves = "hide", fluids = "surface", mode = "both";
        int threads = Runtime.getRuntime().availableProcessors(), level = 6;
        boolean update = false;
        for (int i = 0; i < args.length; i++) {
            String option = args[i];
            if (option.equals("--update")) { update = true; continue; }
            if (++i >= args.length) throw new IllegalArgumentException("Missing value for " + option);
            String value = args[i];
            switch (option) {
                case "--in" -> input = Path.of(value);
                case "--out" -> output = Path.of(value);
                case "--caves" -> caves = value;
                case "--fluids" -> fluids = value;
                case "--mode" -> mode = value;
                case "--threads" -> threads = Integer.parseInt(value);
                case "--level" -> level = Integer.parseInt(value);
                default -> throw new IllegalArgumentException("Unknown option " + option);
            }
        }
        if (input == null || output == null || !(caves.equals("hide") || caves.equals("keep"))
                || !(fluids.equals("surface") || fluids.equals("volume"))
                || !(mode.equals("both") || mode.equals("2d") || mode.equals("3d")) || threads < 1)
            throw new IllegalArgumentException("Usage: --in DIR --out DIR [--caves keep|hide] [--fluids volume|surface] [--threads N] [--level 0-9] [--mode 2d|3d|both] [--update]");
        ExtractOptions options = new ExtractOptions(caves.equals("hide"), fluids.equals("surface"), level,
                !mode.equals("3d"), !mode.equals("2d"));
        long start = System.nanoTime();
        WorldExtractor.Summary summary = update
                ? WorldExtractor.update(input, output, options, threads, null, () -> false)
                : WorldExtractor.extract(input, output, options, threads, null, () -> false);
        long wall = (System.nanoTime() - start) / 1_000_000;
        System.out.println("{\"caves\":\"" + caves + "\",\"fluids\":\"" + fluids
                + "\",\"format_version\":3,\"regions\":" + summary.regions()
                + ",\"regions_written\":" + summary.regionsWritten()
                + ",\"regions_unchanged\":" + summary.regionsUnchanged()
                + ",\"regions_deleted\":" + summary.regionsDeleted()
                + ",\"chunks_total\":" + summary.chunksTotal()
                + ",\"chunks_extracted\":" + summary.chunksExtracted()
                + ",\"chunks_skipped_not_full\":" + summary.chunksSkippedNotFull()
                + ",\"chunks_skipped_unsupported\":" + summary.chunksSkippedUnsupported()
                + ",\"chunks_reused\":" + summary.chunksReused()
                + ",\"input_bytes\":" + summary.inputBytes()
                + ",\"output_bytes_2d\":" + summary.outputBytes2d()
                + ",\"output_bytes_3d\":" + summary.outputBytes3d()
                + ",\"output_files\":" + summary.outputFiles()
                + ",\"wall_ms\":" + wall
                + ",\"read_ms\":" + summary.readNs() / 1_000_000
                + ",\"border_pass_ms\":" + summary.borderPassNs() / 1_000_000
                + ",\"inflate_ms\":" + summary.inflateNs() / 1_000_000
                + ",\"parse_ms\":" + summary.parseNs() / 1_000_000
                + ",\"extract_2d_ms\":" + summary.extract2dNs() / 1_000_000
                + ",\"extract_3d_ms\":" + summary.extract3dNs() / 1_000_000
                + ",\"compress_ms\":" + summary.compressNs() / 1_000_000
                + ",\"write_ms\":" + summary.writeNs() / 1_000_000
                + ",\"shell_blocks_total\":" + summary.shellBlocks()
                + ",\"blocks_nonair_total\":" + summary.blocksNonair()
                + ",\"shell_fluid_blocks_total\":" + summary.shellFluidBlocks()
                + ",\"faces_total\":" + summary.faces()
                + ",\"data_version_min\":" + summary.dataVersionMin()
                + ",\"data_version_max\":" + summary.dataVersionMax() + "}");
    }
}
