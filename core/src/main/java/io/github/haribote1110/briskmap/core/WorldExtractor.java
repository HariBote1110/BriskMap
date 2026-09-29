package io.github.haribote1110.briskmap.core;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;

public final class WorldExtractor {
    private static final Pattern REGION = Pattern.compile("r\\.-?\\d+\\.-?\\d+\\.mca");

    private WorldExtractor() { }

    public interface Progress { void onProgress(int done, int total); }

    public record Summary(int regions, int regionsWritten, int regionsUnchanged, int regionsDeleted,
            long chunksTotal, long chunksExtracted, long chunksSkippedNotFull, long chunksSkippedUnsupported,
            long chunksReused, long inputBytes, long outputBytes2d, long outputBytes3d, long outputFiles,
            int dataVersionMin, int dataVersionMax, long readNs, long borderPassNs, long inflateNs,
            long parseNs, long extract2dNs, long extract3dNs, long compressNs, long writeNs,
            long shellBlocks, long blocksNonair, long shellFluidBlocks, long faces) { }

    public static Summary extract(Path inDir, Path outDir, ExtractOptions options, int threads,
            Progress progress, BooleanSupplier cancelled) throws IOException {
        if (threads < 1) throw new IllegalArgumentException("Invalid thread count");
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        try { return run(inDir, outDir, options, false, executor, threads, progress, cancelled); }
        finally { executor.shutdownNow(); }
    }

    public static Summary update(Path inDir, Path outDir, ExtractOptions options, int threads,
            Progress progress, BooleanSupplier cancelled) throws IOException {
        if (threads < 1) throw new IllegalArgumentException("Invalid thread count");
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        try { return run(inDir, outDir, options, true, executor, threads, progress, cancelled); }
        finally { executor.shutdownNow(); }
    }

    public static Summary extract(Path inDir, Path outDir, ExtractOptions options, ExecutorService executor,
            Progress progress, BooleanSupplier cancelled) throws IOException {
        return run(inDir, outDir, options, false, executor, Runtime.getRuntime().availableProcessors(), progress, cancelled);
    }

    public static Summary update(Path inDir, Path outDir, ExtractOptions options, ExecutorService executor,
            Progress progress, BooleanSupplier cancelled) throws IOException {
        return run(inDir, outDir, options, true, executor, Runtime.getRuntime().availableProcessors(), progress, cancelled);
    }

    private static Summary run(Path inDir, Path outDir, ExtractOptions options, boolean incremental,
            ExecutorService executor, int workers, Progress progress, BooleanSupplier cancelled) throws IOException {
        List<Path> paths;
        try (var stream = Files.list(inDir)) {
            paths = stream.filter(path -> REGION.matcher(path.getFileName().toString()).matches())
                    .sorted(Comparator.comparing(path -> path.getFileName().toString())).toList();
        }
        RegionResult[] results = new RegionResult[paths.size()];
        AtomicInteger next = new AtomicInteger(), done = new AtomicInteger();
        List<Future<?>> tasks = new ArrayList<>();
        for (int worker = 0; worker < Math.min(workers, paths.size()); worker++) tasks.add(executor.submit(() -> {
            while (!cancelled.getAsBoolean()) {
                int index = next.getAndIncrement();
                if (index >= paths.size() || cancelled.getAsBoolean()) break;
                try {
                    results[index] = incremental ? RegionExtractor.update(paths.get(index), outDir, options)
                            : RegionExtractor.extract(paths.get(index), outDir, options);
                } catch (IOException ex) { throw new java.io.UncheckedIOException(ex); }
                if (progress == null) done.incrementAndGet();
                else synchronized (progress) { progress.onProgress(done.incrementAndGet(), paths.size()); }
            }
        }));
        for (Future<?> task : tasks) try { task.get(); }
        catch (InterruptedException ex) { Thread.currentThread().interrupt(); throw new IOException("Extraction interrupted", ex); }
        catch (ExecutionException ex) {
            if (ex.getCause() instanceof java.io.UncheckedIOException io) throw io.getCause();
            throw new IOException("Extraction failed", ex.getCause());
        }
        Set<String> deletedBases = new HashSet<>();
        if (!cancelled.getAsBoolean() && Files.isDirectory(outDir)) {
            Set<String> bases = new HashSet<>();
            for (Path path : paths) bases.add(path.getFileName().toString().replace(".mca", ""));
            try (var stream = Files.list(outDir)) {
                for (Path path : stream.toList()) {
                    String name = path.getFileName().toString();
                    if ((name.endsWith(".b2d") || name.endsWith(".b3d"))
                            && REGION.matcher(name.substring(0, name.length() - 4) + ".mca").matches()
                            && !bases.contains(name.substring(0, name.length() - 4))) {
                        Files.delete(path);
                        deletedBases.add(name.substring(0, name.length() - 4));
                    }
                }
            }
        }
        int regions = 0, written = 0, unchanged = 0, min = Integer.MAX_VALUE, max = Integer.MIN_VALUE;
        long total = 0, extracted = 0, notFull = 0, unsupported = 0, reused = 0, input = 0, two = 0, three = 0, files = 0;
        long readNs = 0, borderNs = 0, inflateNs = 0, parseNs = 0, extract2dNs = 0, extract3dNs = 0;
        long compressNs = 0, writeNs = 0, shellBlocks = 0, blocksNonair = 0, shellFluidBlocks = 0, faces = 0;
        for (int i = 0; i < results.length; i++) {
            RegionResult result = results[i];
            if (result == null) continue;
            regions++;
            if (result.written()) written++; else unchanged++;
            total += result.chunksTotal(); extracted += result.chunksExtracted();
            notFull += result.chunksSkippedNotFull(); unsupported += result.chunksSkippedUnsupported();
            reused += result.chunksReused(); input += Files.size(paths.get(i));
            two += result.outputBytes2d(); three += result.outputBytes3d(); files += result.outputFiles();
            if (result.dataVersionMin() != 0) min = Math.min(min, result.dataVersionMin());
            if (result.dataVersionMax() != 0) max = Math.max(max, result.dataVersionMax());
            readNs += result.readNs(); borderNs += result.borderPassNs(); inflateNs += result.inflateNs();
            parseNs += result.parseNs(); extract2dNs += result.extract2dNs(); extract3dNs += result.extract3dNs();
            compressNs += result.compressNs(); writeNs += result.writeNs(); shellBlocks += result.shellBlocks();
            blocksNonair += result.blocksNonair(); shellFluidBlocks += result.shellFluidBlocks(); faces += result.faces();
        }
        return new Summary(regions, written, unchanged, deletedBases.size(), total, extracted, notFull, unsupported,
                reused, input, two, three, files, min == Integer.MAX_VALUE ? 0 : min,
                max == Integer.MIN_VALUE ? 0 : max, readNs, borderNs, inflateNs, parseNs,
                extract2dNs, extract3dNs, compressNs, writeNs, shellBlocks, blocksNonair, shellFluidBlocks, faces);
    }
}
