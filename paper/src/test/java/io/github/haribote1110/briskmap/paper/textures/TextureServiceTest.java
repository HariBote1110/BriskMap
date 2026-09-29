package io.github.haribote1110.briskmap.paper.textures;

import io.github.haribote1110.briskmap.core.textures.Json;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Handler;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class TextureServiceTest {
    @TempDir Path temporary;
    private final List<String> warnings = new ArrayList<>();
    private final AtomicInteger downloads = new AtomicInteger();
    private final AtomicInteger changes = new AtomicInteger();

    @Test void alreadyReadyNeedsNoJarOrConsent() throws Exception {
        Path folder = Files.createDirectories(temporary.resolve("textures/26.3"));
        Files.write(folder.resolve("atlas.png"), new byte[]{1});
        Files.writeString(folder.resolve("blocks.json"), "{\"source\":\"minecraft-client-26.3.jar\"}");
        TextureService service = service(false, (version, cache) -> { fail("Download attempted"); return cache; });
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertEquals("textures/26.3/", service.state().relativeUrl());
        assertEquals(2, changes.get());
        assertTrue(warnings.isEmpty());
    }

    @Test void staleSourceIsRebuiltFromManualJar() throws Exception {
        Path folder = Files.createDirectories(temporary.resolve("textures/26.3"));
        Files.write(folder.resolve("atlas.png"), new byte[]{1});
        Files.writeString(folder.resolve("blocks.json"), "{\"source\":\"minecraft-client-old.jar\"}");
        Path cache = Files.createDirectories(temporary.resolve("cache"));
        syntheticJar(cache.resolve("minecraft-client-26.3.jar"));
        TextureService service = service(false, (version, destination) -> { fail("Download attempted"); return destination; });
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertTrue(Files.size(folder.resolve("atlas.png")) > 1);
    }

    @Test void buildingStateIsVisibleBeforeBackgroundTaskRuns() {
        List<Runnable> queued = new ArrayList<>();
        TextureService service = new TextureService("26.3", temporary.resolve("cache"), temporary.resolve("textures"),
                false, (version, cache) -> { fail("Download attempted"); return cache; }, Logger.getAnonymousLogger(),
                queued::add, changes::incrementAndGet);
        var result = service.ensure();
        assertEquals(TextureService.Status.BUILDING, service.state().status());
        assertFalse(result.isDone());
        queued.remove(0).run();
        assertEquals(TextureService.Status.NOT_READY, result.join().status());
        assertEquals(2, changes.get());
    }

    @Test void manualJarBuildsWithoutConsentAndCleansOnlyOtherVersions() throws Exception {
        Path cache = Files.createDirectories(temporary.resolve("cache"));
        syntheticJar(cache.resolve("minecraft-client-26.3.jar"));
        Path textures = Files.createDirectories(temporary.resolve("textures"));
        Files.createDirectories(textures.resolve("old"));
        Files.writeString(textures.resolve("old/marker"), "old");
        Files.createDirectories(temporary.resolve("outside"));
        Files.writeString(temporary.resolve("outside/marker"), "safe");
        TextureService service = service(false, (version, destination) -> { fail("Download attempted"); return destination; });
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertTrue(Files.isRegularFile(textures.resolve("26.3/atlas.png")));
        assertEquals("minecraft-client-26.3.jar", Json.object(Json.parse(Files.readString(textures.resolve("26.3/blocks.json")))).get("source"));
        assertFalse(Files.exists(textures.resolve("old")));
        assertTrue(Files.exists(temporary.resolve("outside/marker")));
    }

    @Test void consentObtainsJar() throws Exception {
        TextureService service = service(true, (version, cache) -> {
            downloads.incrementAndGet();
            Files.createDirectories(cache);
            Path jar = cache.resolve("minecraft-client-" + version + ".jar");
            syntheticJar(jar);
            return jar;
        });
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertEquals(1, downloads.get());
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertEquals(1, downloads.get());
    }

    @Test void noConsentWarnsOnceAndCanBeEnabled() throws Exception {
        TextureService service = service(false, (version, cache) -> {
            downloads.incrementAndGet();
            Path jar = cache.resolve("minecraft-client-" + version + ".jar");
            Files.createDirectories(cache); syntheticJar(jar); return jar;
        });
        assertEquals(TextureService.Status.NOT_READY, service.ensure().join().status());
        assertEquals(TextureService.Status.NOT_READY, service.ensure().join().status());
        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).contains("textures.accept-mojang-download: true"));
        assertTrue(warnings.get(0).contains("https://www.minecraft.net/en-us/eula"));
        assertTrue(warnings.get(0).contains(temporary.resolve("cache/minecraft-client-26.3.jar").toString()));
        assertTrue(warnings.get(0).contains("plain colours"));
        assertEquals(0, downloads.get());
        service.setConsent(true);
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertEquals(1, downloads.get());
    }

    @Test void failureIsLoggedOnceAndRetryIsExplicit() throws Exception {
        TextureService service = service(true, (version, cache) -> {
            downloads.incrementAndGet(); throw new IOException("download failed");
        });
        assertEquals(TextureService.Status.FAILED, service.ensure().join().status());
        assertTrue(service.state().message().contains("download failed"));
        assertEquals(TextureService.Status.FAILED, service.ensure().join().status());
        assertEquals(1, downloads.get());
        assertEquals(1, warnings.size());
        assertEquals(TextureService.Status.FAILED, service.rebuild().join().status());
        assertEquals(2, downloads.get());
        assertEquals(2, warnings.size());
    }

    @Test void forcedRebuildReplacesOutputs() throws Exception {
        Path cache = Files.createDirectories(temporary.resolve("cache"));
        syntheticJar(cache.resolve("minecraft-client-26.3.jar"));
        TextureService service = service(false, (version, destination) -> { fail("Download attempted"); return destination; });
        service.ensure().join();
        Path atlas = temporary.resolve("textures/26.3/atlas.png");
        Files.write(atlas, new byte[]{1});
        assertEquals(TextureService.Status.READY, service.rebuild().join().status());
        assertTrue(Files.size(atlas) > 1);
    }

    @Test void realManualJarBuildsWhenPresent() throws Exception {
        Path jar = Path.of("../feasibility_research/output/client/minecraft-client-26.3.jar");
        assumeTrue(Files.isRegularFile(jar));
        Files.createDirectories(temporary.resolve("cache"));
        Files.copy(jar, temporary.resolve("cache/minecraft-client-26.3.jar"));
        TextureService service = service(false, (version, destination) -> { fail("Download attempted"); return destination; });
        assertEquals(TextureService.Status.READY, service.ensure().join().status());
        assertTrue(Files.size(temporary.resolve("textures/26.3/atlas.png")) > 1000);
    }

    private TextureService service(boolean consent, TextureService.JarProvider provider) {
        Logger logger = Logger.getAnonymousLogger();
        logger.setUseParentHandlers(false);
        logger.addHandler(new Handler() {
            @Override public void publish(LogRecord record) { if (record.getLevel().intValue() >= java.util.logging.Level.WARNING.intValue()) warnings.add(record.getMessage()); }
            @Override public void flush() { }
            @Override public void close() { }
        });
        return new TextureService("26.3", temporary.resolve("cache"), temporary.resolve("textures"), consent,
                provider, logger, Runnable::run, changes::incrementAndGet);
    }

    private static void syntheticJar(Path jar) throws IOException {
        try (ZipOutputStream zip = new ZipOutputStream(Files.newOutputStream(jar))) {
            zip.putNextEntry(new ZipEntry("assets/minecraft/blockstates/stone.json"));
            zip.write("{\"variants\":{\"\":{\"model\":\"block/stone\"}}}".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("assets/minecraft/models/block/stone.json"));
            zip.write("{\"textures\":{\"all\":\"block/stone\"}}".getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        }
    }
}
