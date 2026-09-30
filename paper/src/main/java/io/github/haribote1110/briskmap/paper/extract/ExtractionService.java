package io.github.haribote1110.briskmap.paper.extract;

import io.github.haribote1110.briskmap.core.ExtractOptions;
import io.github.haribote1110.briskmap.core.RegionExtractor;
import io.github.haribote1110.briskmap.core.RegionResult;
import io.github.haribote1110.briskmap.paper.world.MapTarget;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;

public final class ExtractionService implements AutoCloseable {
    @FunctionalInterface public interface RegionUpdate {
        RegionResult update(Path input, Path output, ExtractOptions options) throws IOException;
    }
    public record Status(String id, int done, int total, int failed, boolean running,
            long lastScan, String lastError, int dataVersionMin, int dataVersionMax, long updated) { }
    private static final Map<Path, Object> REGION_LOCKS = new ConcurrentHashMap<>();
    private final ExecutorService workers;
    private final ScheduledExecutorService scanner;
    private final Map<String, MapState> maps = new ConcurrentHashMap<>();
    private final ExtractOptions options;
    private final Logger logger;
    private final Runnable changed;
    private final RegionUpdate update;
    private volatile boolean stopped;

    public ExtractionService(int threads, int interval, ExtractOptions options, Logger logger, Runnable changed) {
        this(threads, interval, options, logger, changed, RegionExtractor::update);
    }

    public ExtractionService(int threads, int interval, ExtractOptions options, Logger logger,
            Runnable changed, RegionUpdate update) {
        this.options = options;
        this.logger = logger;
        this.changed = changed;
        this.update = update;
        AtomicInteger next = new AtomicInteger();
        workers = Executors.newFixedThreadPool(threads, task -> {
            Thread thread = new Thread(task, "BriskMap-extract-" + next.incrementAndGet());
            thread.setDaemon(true);
            thread.setPriority(Thread.NORM_PRIORITY - 1);
            return thread;
        });
        scanner = Executors.newSingleThreadScheduledExecutor(task -> {
            Thread thread = new Thread(task, "BriskMap-scan");
            thread.setDaemon(true);
            return thread;
        });
        scanner.scheduleWithFixedDelay(() -> scan(null, false), interval, interval, TimeUnit.SECONDS);
    }

    public void add(MapTarget target) { maps.put(target.id(), new MapState(target)); }
    public void remove(String id) { maps.remove(id); changed.run(); }
    public void seed(String id, Status previous) {
        MapState state = maps.get(id);
        if (state == null || previous == null) return;
        synchronized (state) {
            if (previous.dataVersionMin() > 0) state.min = Math.min(state.min, previous.dataVersionMin());
            state.max = Math.max(state.max, previous.dataVersionMax());
            state.updated = Math.max(state.updated, previous.updated());
        }
    }
    public List<MapTarget> targets() { return maps.values().stream().map(state -> state.target).toList(); }
    public List<Status> statuses() { return maps.values().stream().map(MapState::status).toList(); }
    public void scanNow(String id) { if (!stopped) scanner.execute(() -> scan(id, false)); }
    public void rebuild(String id) { if (!stopped) scanner.execute(() -> scan(id, true)); }

    private void scan(String id, boolean rebuild) {
        if (stopped) return;
        for (MapState state : maps.values()) {
            if (id != null && !id.equals(state.target.id())) continue;
            try {
                RegionScanner.Scan result = RegionScanner.scan(state.target.regionDir(), state.snapshot);
                state.lastScan = System.currentTimeMillis();
                state.snapshot = result.snapshot();
                state.total = result.snapshot().size();
                for (String name : result.removed()) {
                    state.regions.remove(name);
                    Object lock = REGION_LOCKS.computeIfAbsent(state.target.regionDir().resolve(name).toAbsolutePath().normalize(), ignored -> new Object());
                    synchronized (lock) { deleteOutputs(state.target.outDir(), name); }
                }
                removeOrphanedOutputs(state.target, result.snapshot().keySet());
                if (rebuild) {
                    state.done.clear();
                    state.failed.clear();
                    for (String name : result.snapshot().keySet()) enqueue(state, name, true);
                } else {
                    Set<String> pending = new java.util.HashSet<>(result.changed());
                    for (String name : result.changed()) addNeighbours(name, result.snapshot().keySet(), pending);
                    for (String name : result.removed()) addNeighbours(name, result.snapshot().keySet(), pending);
                    for (String name : state.failed) if (result.snapshot().containsKey(name)) pending.add(name);
                    for (String name : pending) enqueue(state, name, false);
                }
                if (!result.removed().isEmpty() || state.regions.isEmpty()) changed.run();
            } catch (IOException exception) {
                state.lastError = exception.getMessage();
                logger.warning("Region scan failed for " + state.target.id() + ": " + exception.getMessage());
            }
        }
    }

    private static void addNeighbours(String name, Set<String> present, Set<String> pending) {
        String[] parts = name.split("\\.");
        int x = Integer.parseInt(parts[1]), z = Integer.parseInt(parts[2]);
        for (String neighbour : List.of("r." + (x - 1) + "." + z + ".mca", "r." + (x + 1) + "." + z + ".mca",
                "r." + x + "." + (z - 1) + ".mca", "r." + x + "." + (z + 1) + ".mca"))
            if (present.contains(neighbour)) pending.add(neighbour);
    }

    private static void removeOrphanedOutputs(MapTarget target, Set<String> present) throws IOException {
        Path directory = target.outDir();
        if (!Files.isDirectory(directory)) return;
        try (var files = Files.list(directory)) {
            for (Path file : files.toList()) {
                String name = file.getFileName().toString();
                if ((name.endsWith(".b2d") || name.endsWith(".b3d"))
                        && RegionScanner.REGION.matcher(name.substring(0, name.length() - 4) + ".mca").matches()
                        && !present.contains(name.substring(0, name.length() - 4) + ".mca")) {
                    Path source = target.regionDir().resolve(name.substring(0, name.length() - 4) + ".mca");
                    Object lock = REGION_LOCKS.computeIfAbsent(source.toAbsolutePath().normalize(), ignored -> new Object());
                    synchronized (lock) { Files.deleteIfExists(file); }
                }
            }
        }
    }

    private static void deleteOutputs(Path directory, String name) throws IOException {
        String base = name.substring(0, name.length() - 4);
        Files.deleteIfExists(directory.resolve(base + ".b2d"));
        Files.deleteIfExists(directory.resolve(base + ".b3d"));
    }

    private void enqueue(MapState state, String name, boolean rebuild) {
        RegionWork work = state.regions.computeIfAbsent(name, ignored -> new RegionWork());
        synchronized (work) {
            if (work.running) { work.dirty = true; work.rebuild |= rebuild; return; }
            work.running = true;
            work.rebuild = rebuild;
        }
        workers.execute(() -> run(state, name, work));
    }

    private void run(MapState state, String name, RegionWork work) {
        while (!stopped) {
            boolean rebuild;
            synchronized (work) { rebuild = work.rebuild; work.rebuild = false; work.dirty = false; }
            try {
                Files.createDirectories(state.target.outDir());
                Path input = state.target.regionDir().resolve(name);
                RegionResult result;
                Object lock = REGION_LOCKS.computeIfAbsent(input.toAbsolutePath().normalize(), ignored -> new Object());
                synchronized (lock) {
                    if (rebuild) deleteOutputs(state.target.outDir(), name);
                    result = update.update(input, state.target.outDir(), options.withMaxY(state.target.maxY()));
                }
                synchronized (state) {
                    state.done.add(name);
                    state.failed.remove(name);
                    state.lastError = null;
                    if (result != null) {
                        if (result.written()) { state.written++; state.updated = System.currentTimeMillis(); }
                        else state.unchanged++;
                        if (result.dataVersionMin() > 0) state.min = Math.min(state.min, result.dataVersionMin());
                        if (result.dataVersionMax() > 0) state.max = Math.max(state.max, result.dataVersionMax());
                    }
                    if (state.done.size() + state.failed.size() == state.total && !state.initialLogged) {
                        state.initialLogged = true;
                        logger.info("Initial map pass " + state.target.id() + ": regions=" + state.total
                                + " written=" + state.written + " unchanged=" + state.unchanged
                                + " failed=" + state.failed.size() + " seconds="
                                + String.format(java.util.Locale.ROOT, "%.1f", (System.nanoTime() - state.started) / 1e9));
                    }
                }
                changed.run();
            } catch (IOException | RuntimeException exception) {
                synchronized (state) {
                    state.failed.add(name);
                    state.lastError = exception.getMessage();
                }
                if (!java.util.Objects.equals(exception.getMessage(), work.lastFailure)) {
                    work.lastFailure = exception.getMessage();
                    logger.warning("Region update failed " + state.target.id() + "/" + name + ": " + exception.getMessage());
                }
                changed.run();
            }
            synchronized (work) {
                if (!work.dirty || stopped) { work.running = false; break; }
            }
                    }
    }

    public boolean awaitIdle(long timeout, TimeUnit unit) throws InterruptedException {
        long deadline = System.nanoTime() + unit.toNanos(timeout);
        while (System.nanoTime() < deadline) {
            try { scanner.submit(() -> { }).get(Math.max(1, deadline - System.nanoTime()), TimeUnit.NANOSECONDS); }
            catch (java.util.concurrent.ExecutionException | java.util.concurrent.TimeoutException exception) { return false; }
            boolean idle = true;
            for (MapState state : maps.values()) for (RegionWork work : state.regions.values()) if (work.running) idle = false;
            if (idle) return true;
            Thread.sleep(20);
        }
        return false;
    }

    @Override public void close() {
        stopped = true;
        scanner.shutdownNow();
        workers.shutdownNow();
        try { if (!workers.awaitTermination(10, TimeUnit.SECONDS)) logger.warning("Extraction workers did not stop within 10 seconds"); }
        catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
    }

    private static final class RegionWork {
        private volatile boolean running;
        private boolean dirty, rebuild;
        private String lastFailure;
    }
    private static final class MapState {
        private final MapTarget target;
        private volatile Map<String, RegionScanner.Stamp> snapshot = Map.of();
        private final Map<String, RegionWork> regions = new ConcurrentHashMap<>();
        private final Set<String> done = ConcurrentHashMap.newKeySet(), failed = ConcurrentHashMap.newKeySet();
        private final long started = System.nanoTime();
        private volatile int total, written, unchanged, min = Integer.MAX_VALUE, max = Integer.MIN_VALUE;
        private volatile long lastScan, updated;
        private volatile String lastError;
        private volatile boolean initialLogged;
        private MapState(MapTarget target) { this.target = target; }
        private Status status() {
            boolean running = regions.values().stream().anyMatch(work -> work.running);
            return new Status(target.id(), done.size(), total, failed.size(), running,
                    lastScan, lastError, min == Integer.MAX_VALUE ? 0 : min,
                    max == Integer.MIN_VALUE ? 0 : max, updated);
        }
    }
}
