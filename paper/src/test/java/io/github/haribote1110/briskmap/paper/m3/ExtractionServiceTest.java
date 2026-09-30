package io.github.haribote1110.briskmap.paper.m3;

import io.github.haribote1110.briskmap.core.ExtractOptions;
import io.github.haribote1110.briskmap.core.RegionExtractor;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.FileTime;
import io.github.haribote1110.briskmap.paper.extract.ExtractionService;
import io.github.haribote1110.briskmap.paper.world.MapTarget;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class ExtractionServiceTest {
    @TempDir Path temp;

    @Test void changedRegionEnqueuesExistingSideAndCornerNeighbours() throws Exception {
        Path source = Files.createDirectories(temp.resolve("region"));
        for (String name : java.util.List.of("r.0.0.mca", "r.-1.0.mca", "r.1.0.mca", "r.0.-1.mca", "r.0.1.mca", "r.1.1.mca"))
            Files.write(source.resolve(name), new byte[]{1});
        MapTarget target = new MapTarget("world", "world", "minecraft:overworld", source, temp.resolve("out"), new int[]{0, 64, 0});
        java.util.Map<String, AtomicInteger> calls = new java.util.concurrent.ConcurrentHashMap<>();
        try (ExtractionService service = new ExtractionService(2, 3600, new ExtractOptions(true, true, 6, true, true),
                Logger.getLogger("test"), () -> { }, (input, output, options) -> {
                    calls.computeIfAbsent(input.getFileName().toString(), ignored -> new AtomicInteger()).incrementAndGet();
                    return null;
                })) {
            service.add(target);
            service.scanNow(null);
            assertTrue(service.awaitIdle(10, TimeUnit.SECONDS));
            calls.clear();
            Path centre = source.resolve("r.0.0.mca");
            Files.setLastModifiedTime(centre, FileTime.fromMillis(Files.getLastModifiedTime(centre).toMillis() + 2000));
            service.scanNow(null);
            assertTrue(service.awaitIdle(10, TimeUnit.SECONDS));
            assertEquals(java.util.Set.of("r.0.0.mca", "r.-1.0.mca", "r.1.0.mca", "r.0.-1.mca", "r.0.1.mca", "r.1.1.mca"), calls.keySet());
            assertEquals(1, calls.get("r.0.0.mca").get());
            assertEquals(1, calls.get("r.1.1.mca").get());
        }
    }

    @Test void passesEachWorldCutToTheExtractor() throws Exception {
        Path first = Files.createDirectories(temp.resolve("first/region"));
        Path second = Files.createDirectories(temp.resolve("second/region"));
        Files.write(first.resolve("r.0.0.mca"), new byte[]{1});
        Files.write(second.resolve("r.0.0.mca"), new byte[]{1});
        java.util.Set<Integer> cuts = java.util.concurrent.ConcurrentHashMap.newKeySet();
        try (ExtractionService service = new ExtractionService(2, 3600,
                new ExtractOptions(true, true, 6, true, true), Logger.getLogger("test"), () -> { },
                (input, output, options) -> { cuts.add(options.maxY()); return null; })) {
            service.add(new MapTarget("nether", "nether", "minecraft:the_nether", first,
                    temp.resolve("out-nether"), new int[]{0, 64, 0}, 100));
            service.add(new MapTarget("normal", "normal", "minecraft:overworld", second,
                    temp.resolve("out-normal"), new int[]{0, 64, 0}));
            service.scanNow(null);
            assertTrue(service.awaitIdle(10, TimeUnit.SECONDS));
            assertEquals(java.util.Set.of(100, Integer.MAX_VALUE), cuts);
        }
    }

    @Test void extractsAndSkipsUnchangedInput() throws Exception {
        Path fixture = Path.of("../feasibility_research/fixtures/r.0.0.mca");
        Assumptions.assumeTrue(Files.exists(fixture));
        Path source = Files.createDirectories(temp.resolve("region"));
        Files.copy(fixture, source.resolve("r.0.0.mca"));
        MapTarget target = new MapTarget("world", "world", "minecraft:overworld", source, temp.resolve("out"), new int[]{0, 64, 0});
        AtomicInteger calls = new AtomicInteger();
        try (ExtractionService service = new ExtractionService(2, 3600, new ExtractOptions(true, true, 6, true, true),
                Logger.getLogger("test"), () -> { }, (input, output, options) -> {
                    calls.incrementAndGet();
                    return RegionExtractor.update(input, output, options);
                })) {
            service.add(target);
            service.scanNow(null);
            assertTrue(service.awaitIdle(120, TimeUnit.SECONDS));
            assertTrue(Files.exists(target.outDir().resolve("r.0.0.b2d")));
            long modified = Files.getLastModifiedTime(target.outDir().resolve("r.0.0.b2d")).toMillis();
            service.scanNow(null);
            assertTrue(service.awaitIdle(30, TimeUnit.SECONDS));
            assertEquals(modified, Files.getLastModifiedTime(target.outDir().resolve("r.0.0.b2d")).toMillis());
            assertEquals(1, calls.get());
            Path region = source.resolve("r.0.0.mca");
            try (FileChannel channel = FileChannel.open(region, StandardOpenOption.WRITE, StandardOpenOption.READ)) {
                ByteBuffer timestamp = ByteBuffer.allocate(4);
                channel.read(timestamp, 4096);
                timestamp.flip();
                int old = timestamp.getInt();
                channel.write(ByteBuffer.allocate(4).putInt(old + 1).flip(), 4096);
            }
            Files.setLastModifiedTime(region, FileTime.fromMillis(Files.getLastModifiedTime(region).toMillis() + 2000));
            service.scanNow(null);
            assertTrue(service.awaitIdle(120, TimeUnit.SECONDS));
            assertEquals(2, calls.get());
            Files.delete(region);
            service.scanNow(null);
            assertTrue(service.awaitIdle(30, TimeUnit.SECONDS));
            assertFalse(Files.exists(target.outDir().resolve("r.0.0.b2d")));
            assertFalse(Files.exists(target.outDir().resolve("r.0.0.b3d")));
        }
    }

    @Test void serialisesOneRegionAndRetriesFailures() throws Exception {
        Path source = Files.createDirectories(temp.resolve("region"));
        Files.write(source.resolve("r.0.0.mca"), new byte[]{1});
        MapTarget target = new MapTarget("world", "world", "minecraft:overworld", source, temp.resolve("out"), new int[]{0, 64, 0});
        AtomicInteger active = new AtomicInteger(), max = new AtomicInteger(), calls = new AtomicInteger();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        ExtractionService.RegionUpdate update = (input, output, options) -> {
            int concurrent = active.incrementAndGet();
            max.accumulateAndGet(concurrent, Math::max);
            try {
                if (calls.incrementAndGet() == 1) {
                    entered.countDown();
                    try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException exception) { Thread.currentThread().interrupt(); }
                    throw new IOException("trial failure");
                }
                return null;
            } finally { active.decrementAndGet(); }
        };
        try (ExtractionService service = new ExtractionService(2, 3600, new ExtractOptions(true, true, 6, true, true),
                Logger.getLogger("test"), () -> { }, update)) {
            service.add(target);
            service.scanNow(null);
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            service.scanNow(null);
            release.countDown();
            assertTrue(service.awaitIdle(10, TimeUnit.SECONDS));
            service.scanNow(null);
            assertTrue(service.awaitIdle(10, TimeUnit.SECONDS));
            assertEquals(1, max.get());
            assertTrue(calls.get() >= 2);
        }
    }
    @Test void shutdownCancelsQueuedWorkWithoutTemporaryFiles() throws Exception {
        Path source = Files.createDirectories(temp.resolve("region"));
        Files.write(source.resolve("r.0.0.mca"), new byte[]{1});
        Files.write(source.resolve("r.1.0.mca"), new byte[]{1});
        MapTarget target = new MapTarget("world", "world", "minecraft:overworld", source, temp.resolve("out"), new int[]{0, 64, 0});
        CountDownLatch entered = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        ExtractionService service = new ExtractionService(1, 3600, new ExtractOptions(true, true, 6, true, true),
                Logger.getLogger("test"), () -> { }, (input, output, options) -> {
                    calls.incrementAndGet();
                    entered.countDown();
                    try { Thread.sleep(30_000); }
                    catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new IOException("Cancelled", exception); }
                    return null;
                });
        service.add(target);
        service.scanNow(null);
        assertTrue(entered.await(5, TimeUnit.SECONDS));
        service.close();
        assertEquals(1, calls.get());
        if (Files.isDirectory(target.outDir())) try (var files = Files.list(target.outDir())) {
            assertTrue(files.noneMatch(file -> file.getFileName().toString().endsWith(".tmp")));
        }
    }

}
