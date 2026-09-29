package io.github.haribote1110.briskmap.paper.m3;

import io.github.haribote1110.briskmap.paper.config.BriskMapConfig;
import io.github.haribote1110.briskmap.paper.config.ConfigLoader;
import io.github.haribote1110.briskmap.paper.extract.RegionScanner;
import io.github.haribote1110.briskmap.paper.index.MapIndexWriter;
import io.github.haribote1110.briskmap.paper.world.RegionFolderResolver;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class MilestoneTest {
    @TempDir Path temp;

    @Test void configuration() {
        AtomicInteger warnings = new AtomicInteger();
        BriskMapConfig defaults = ConfigLoader.load(Map.of(), message -> warnings.incrementAndGet());
        assertEquals(8123, defaults.webPort());
        assertEquals(Math.max(1, Runtime.getRuntime().availableProcessors() / 2), defaults.extractThreads());
        BriskMapConfig changed = ConfigLoader.load(Map.of("web.port", 9000, "extract.threads", 2,
                "extract.caves", "show", "worlds.exclude", List.of("other")), message -> warnings.incrementAndGet());
        assertEquals(9000, changed.webPort());
        assertEquals(2, changed.extractThreads());
        assertFalse(changed.options().hideCaves());
        assertEquals(List.of("other"), changed.excludedWorlds());
        assertEquals(8123, ConfigLoader.load(Map.of("web.port", -1), message -> warnings.incrementAndGet()).webPort());
        assertEquals(1, warnings.get());
    }

    @Test void regionFolders() throws Exception {
        Path modernRoot = temp.resolve("modern/world");
        Path modernNormal = Files.createDirectories(modernRoot.resolve("dimensions/minecraft/overworld/region"));
        Path modernNether = Files.createDirectories(modernRoot.resolve("dimensions/minecraft/the_nether/region"));
        Path modernEnd = Files.createDirectories(modernRoot.resolve("dimensions/minecraft/the_end/region"));
        for (Path region : List.of(modernNormal, modernNether, modernEnd)) Files.createFile(region.resolve("r.0.0.mca"));
        assertEquals(modernNormal, RegionFolderResolver.resolve(modernNormal.getParent(), "minecraft", "overworld", RegionFolderResolver.Environment.NORMAL).orElseThrow());
        assertEquals(modernNether, RegionFolderResolver.resolve(modernNether.getParent(), "minecraft", "the_nether", RegionFolderResolver.Environment.NETHER).orElseThrow());
        assertEquals(modernEnd, RegionFolderResolver.resolve(modernEnd.getParent(), "minecraft", "the_end", RegionFolderResolver.Environment.THE_END).orElseThrow());

        Path legacyRoot = temp.resolve("legacy");
        Path old = Files.createDirectories(legacyRoot.resolve("world/region"));
        Path nether = Files.createDirectories(legacyRoot.resolve("world_nether/DIM-1/region"));
        Path end = Files.createDirectories(legacyRoot.resolve("world_the_end/DIM1/region"));
        Files.createFile(old.resolve("r.0.0.mca"));
        Files.createFile(nether.resolve("r.-1.2.mca"));
        Files.createFile(end.resolve("r.0.0.mca"));
        Files.createDirectories(legacyRoot.resolve("world_nether/region"));
        assertEquals(old, RegionFolderResolver.resolve(old.getParent(), "minecraft", "overworld", RegionFolderResolver.Environment.NORMAL).orElseThrow());
        assertEquals(nether, RegionFolderResolver.resolve(legacyRoot.resolve("world_nether"), "minecraft", "the_nether", RegionFolderResolver.Environment.NETHER).orElseThrow());
        assertEquals(end, RegionFolderResolver.resolve(legacyRoot.resolve("world_the_end"), "minecraft", "the_end", RegionFolderResolver.Environment.THE_END).orElseThrow());
        assertEquals(modernNether, RegionFolderResolver.resolve(modernRoot, "minecraft", "the_nether", RegionFolderResolver.Environment.NETHER).orElseThrow());
        Files.delete(nether.resolve("r.-1.2.mca"));
        assertEquals(legacyRoot.resolve("world_nether/region"), RegionFolderResolver.resolve(legacyRoot.resolve("world_nether"), "minecraft", "the_nether", RegionFolderResolver.Environment.NETHER).orElseThrow());
        assertTrue(RegionFolderResolver.resolve(temp.resolve("missing"), "minecraft", "overworld", RegionFolderResolver.Environment.NORMAL).isEmpty());
    }

    @Test void scanning() throws Exception {
        Path a = Files.write(temp.resolve("r.0.0.mca"), new byte[]{1});
        Files.write(temp.resolve("ignore.txt"), new byte[]{1});
        RegionScanner.Scan first = RegionScanner.scan(temp, Map.of());
        assertEquals(List.of("r.0.0.mca"), first.changed());
        assertTrue(RegionScanner.scan(temp, first.snapshot()).changed().isEmpty());
        Files.setLastModifiedTime(a, FileTime.fromMillis(Files.getLastModifiedTime(a).toMillis() + 2000));
        assertEquals(List.of("r.0.0.mca"), RegionScanner.scan(temp, first.snapshot()).changed());
        Files.delete(a);
        assertEquals(List.of("r.0.0.mca"), RegionScanner.scan(temp, first.snapshot()).removed());
    }

    @Test void index() throws Exception {
        Path output = Files.createDirectories(temp.resolve("maps/world"));
        Files.write(output.resolve("r.2.-1.b3d"), new byte[]{1});
        Files.write(output.resolve("r.-1.2.b2d"), new byte[]{1});
        MapIndexWriter writer = new MapIndexWriter(temp.resolve("maps/index.json"));
        MapIndexWriter.MapEntry map = new MapIndexWriter.MapEntry("world", "world", "minecraft:overworld",
                new int[]{0, 64, 0}, "hide", "surface", 5023, 5023, output, 123L);
        assertTrue(writer.write(List.of(map)));
        String json = Files.readString(temp.resolve("maps/index.json"));
        assertTrue(json.contains("\"textures\":null"));
        assertTrue(json.contains("\"dimension\":\"minecraft:overworld\""));
        assertTrue(json.contains("\"dataVersion\":{\"min\":5023,\"max\":5023}"));
        assertTrue(json.contains("\"extract\":{\"caves\":\"hide\",\"fluids\":\"surface\",\"format\":3}"));
        assertTrue(json.indexOf("[-1,2]") < json.indexOf("[2,-1]"));
        FileTime modified = Files.getLastModifiedTime(temp.resolve("maps/index.json"));
        assertFalse(writer.write(List.of(map)));
        MapIndexWriter.MapEntry restarted = new MapIndexWriter.MapEntry("world", "world", "minecraft:overworld",
                new int[]{0, 64, 0}, "hide", "surface", 0, 0, output, 123L);
        assertFalse(new MapIndexWriter(temp.resolve("maps/index.json")).write(List.of(restarted)));
        assertEquals(modified, Files.getLastModifiedTime(temp.resolve("maps/index.json")));
        MapIndexWriter duringStartup = new MapIndexWriter(temp.resolve("maps/index.json"));
        assertTrue(duringStartup.write(List.of()));
        assertTrue(duringStartup.write(List.of(restarted)));
        assertTrue(Files.readString(temp.resolve("maps/index.json")).contains("\"min\":5023,\"max\":5023"));
    }
}
