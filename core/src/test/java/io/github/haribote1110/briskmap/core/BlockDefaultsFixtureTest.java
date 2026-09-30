package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.*;

import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Section;
import io.github.haribote1110.briskmap.core.format.Reader;
import io.github.haribote1110.briskmap.core.region.Region;
import io.github.haribote1110.briskmap.core.textures.Json;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Stream;
import java.util.zip.Inflater;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Real 26.3 and 1.21.11 regions extracted with the default states dumped from real servers. */
class BlockDefaultsFixtureTest {
    private static final Path MODERN = Path.of("feasibility_research/fixtures/26.3/overworld");
    private static final Path LEGACY = Path.of("feasibility_research/fixtures");
    private static final Path DEFAULTS = Path.of("feasibility_research/output/block-defaults");
    private static final Path BLOCKS = Path.of("feasibility_research/output/textures/26.3/blocks.json");

    @Test void modernRegionsResolveEveryStateOnceNormalised() throws Exception {
        assume(MODERN, DEFAULTS.resolve("26.3.json"), BLOCKS);
        BlockDefaults defaults = BlockDefaults.readJson(DEFAULTS.resolve("26.3.json"));
        Map<String, Object> blocks = Json.object(Json.object(Json.parse(Files.readString(BLOCKS))).get("blocks"));
        List<Path> regions = regions(MODERN);
        assertEquals(4, regions.size());

        Inflater inflater = new Inflater();
        int bareWithProperties = 0, chunks = 0;
        for (Path file : regions) {
            Region region = new Region(file);
            for (int index = 0; index < 1024; index++) {
                if (!region.present(index)) continue;
                Chunk chunk;
                try { chunk = region.read(index, inflater, defaults); }
                catch (Region.UnsupportedChunkException ignored) { continue; }
                chunks++;
                for (Section section : chunk.sections) {
                    if (section == null || section.blocks == null) continue;
                    for (String state : section.blocks)
                        if (state.indexOf('[') < 0 && defaults.state(state).indexOf('[') >= 0) bareWithProperties++;
                }
            }
        }
        assertTrue(chunks > 0);
        assertEquals(0, bareWithProperties, "bare palette entries whose default state has properties");

        TreeSet<String> before = outputStates(regions, new ExtractOptions(false, true, 6, true, true), "before-");
        TreeSet<String> after = outputStates(regions,
                new ExtractOptions(false, true, 6, true, true, defaults), "after-");
        long unresolvedBefore = before.stream().filter(state -> !resolves(blocks, state)).count();
        List<String> unresolvedAfter = after.stream().filter(state -> !resolves(blocks, state)).toList();
        long absentNames = after.stream().filter(state -> !blocks.containsKey(name(state))).count();
        System.out.println("26.3 overworld output states: before=" + before.size() + " unresolvedBefore=" + unresolvedBefore
                + " after=" + after.size() + " unresolvedAfter=" + unresolvedAfter.size()
                + " absentNames=" + absentNames + " unresolved=" + unresolvedAfter);
        assertTrue(unresolvedBefore > unresolvedAfter.size(), "normalisation must resolve more states");
        assertEquals(absentNames, unresolvedAfter.size(), "only names absent from blocks.json may stay unresolved");
        assertTrue(after.stream().noneMatch(state -> state.indexOf('[') < 0 && defaults.state(state).indexOf('[') >= 0));
    }

    @Test void legacyRegionsAreIdenticalWithOrWithoutDefaults() throws Exception {
        assume(LEGACY.resolve("r.0.0.mca"), DEFAULTS.resolve("1.21.11.json"));
        BlockDefaults defaults = BlockDefaults.readJson(DEFAULTS.resolve("1.21.11.json"));
        for (String name : List.of("r.0.0", "r.-1.-1")) {
            Path input = LEGACY.resolve(name + ".mca");
            Path plain = Files.createTempDirectory(Path.of("core/build"), "legacy-plain-");
            Path normalised = Files.createTempDirectory(Path.of("core/build"), "legacy-defaults-");
            RegionExtractor.extract(input, plain, new ExtractOptions(false, true, 6, true, true));
            RegionExtractor.extract(input, normalised, new ExtractOptions(false, true, 6, true, true, defaults));
            for (String suffix : List.of(".b2d", ".b3d")) {
                Reader a = new Reader(plain.resolve(name + suffix)), b = new Reader(normalised.resolve(name + suffix));
                assertEquals(2, a.flags);
                assertEquals(6, b.flags);
                assertEquals(a.blocks, b.blocks, name + suffix);
                assertEquals(a.biomes, b.biomes, name + suffix);
                assertTrue(a.chunkCount() > 0);
                for (int index = 0; index < 1024; index++)
                    assertArrayEquals(a.compressed(index), b.compressed(index), name + suffix + " chunk " + index);
            }
        }
    }

    @Test void netherCutLeavesVisibleTerrainBelowRoof() throws Exception {
        Path input = Path.of("feasibility_research/fixtures/26.3/nether/r.0.0.mca");
        assume(input);
        Path out = Files.createTempDirectory(Path.of("core/build"), "nether-cut-");
        RegionResult result = RegionExtractor.extract(input, out,
                new ExtractOptions(true, true, 6, true, true).withMaxY(100));
        Reader shell = new Reader(out.resolve("r.0.0.b3d"));
        Reader surface = new Reader(out.resolve("r.0.0.b2d"));
        int upperFaces = 0;
        for (int chunk = 0; chunk < 1024; chunk++) {
            var three = shell.read3d(chunk);
            if (three != null) for (int sy = 0; sy < 24; sy++)
                for (int index = 0; index < three.positions[sy].length; index++) {
                    int y = sy * 16 + (three.positions[sy][index] >>> 8) - 64;
                    assertTrue(y <= 100, "Shell block above cut: " + y);
                    if ((three.masks[sy][index] & 8) != 0) upperFaces++;
                }
            var two = surface.read2d(chunk);
            if (two != null) for (short y : two.y) assertTrue(y <= 100);
        }
        assertTrue(upperFaces > 0, "No shell blocks visible from above");
        System.out.println("Nether maxY=100 shell=" + result.shellBlocks() + " topFaces=" + upperFaces
                + " bytes2d=" + result.outputBytes2d() + " bytes3d=" + result.outputBytes3d());
    }

    private static TreeSet<String> outputStates(List<Path> regions, ExtractOptions options, String prefix) throws IOException {
        Path out = Files.createTempDirectory(Path.of("core/build"), "fixture-" + prefix);
        TreeSet<String> states = new TreeSet<>();
        for (Path region : regions) {
            RegionExtractor.extract(region, out, options);
            String base = region.getFileName().toString().replace(".mca", "");
            for (String suffix : List.of(".b2d", ".b3d")) {
                Reader reader = new Reader(out.resolve(base + suffix));
                assertEquals(options.flags(), reader.flags);
                states.addAll(reader.blocks);
            }
        }
        return states;
    }

    /** blocks.json contract: the first entry whose every `when` pair matches; an empty `when` matches. */
    private static boolean resolves(Map<String, Object> blocks, String state) {
        Object entries = blocks.get(name(state));
        if (entries == null) return false;
        Map<String, String> properties = properties(state);
        for (Object item : (List<?>) entries) {
            Map<String, Object> when = Json.object(Json.object(item).get("when"));
            if (when.entrySet().stream().allMatch(pair -> pair.getValue().equals(properties.get(pair.getKey())))) return true;
        }
        return false;
    }

    private static String name(String state) {
        int opening = state.indexOf('[');
        return opening < 0 ? state : state.substring(0, opening);
    }

    private static Map<String, String> properties(String state) {
        Map<String, String> properties = new HashMap<>();
        int opening = state.indexOf('[');
        if (opening < 0) return properties;
        for (String pair : state.substring(opening + 1, state.length() - 1).split(",")) {
            int equals = pair.indexOf('=');
            properties.put(pair.substring(0, equals), pair.substring(equals + 1));
        }
        return properties;
    }

    private static List<Path> regions(Path directory) throws IOException {
        try (Stream<Path> files = Files.list(directory)) {
            return new ArrayList<>(files.filter(path -> path.toString().endsWith(".mca")).sorted().toList());
        }
    }

    private static void assume(Path... paths) {
        for (Path path : paths) Assumptions.assumeTrue(Files.exists(path), "Fixture is absent: " + path);
    }
}
