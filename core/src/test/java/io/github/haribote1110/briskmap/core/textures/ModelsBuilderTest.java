package io.github.haribote1110.briskmap.core.textures;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ModelsBuilderTest {
    @TempDir Path temporary;

    @Test void parentTexturesReferencesAndCycles() {
        Map<String,byte[]> files = new HashMap<>();
        files.put("assets/minecraft/models/block/base.json", "{\"textures\":{\"all\":\"block/stone\",\"side\":\"#all\"},\"elements\":[{\"from\":[0,0,0],\"to\":[16,16,16]}]}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        files.put("assets/minecraft/models/block/child.json", "{\"parent\":\"block/base\",\"textures\":{\"all\":\"block/dirt\"}}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        Models.Model model = Models.resolveModel("block/child", files::get);
        assertEquals("minecraft:block/dirt", model.texture("#side")); assertEquals(1, model.elements().size());
        files.put("assets/minecraft/models/block/a.json", "{\"parent\":\"block/b\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        files.put("assets/minecraft/models/block/b.json", "{\"parent\":\"block/a\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThrows(IllegalArgumentException.class, () -> Models.resolveModel("block/a", files::get));
        files.put("assets/minecraft/models/block/ref.json", "{\"textures\":{\"a\":\"#b\",\"b\":\"#a\"}}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertNull(Models.resolveModel("block/ref", files::get).texture("#a"));
    }

    @Test void rotationMappings() {
        assertEquals(0, Models.rotateFace(2, 90, 90)); assertEquals(1, Models.rotateFace(3, 90, 90));
        assertEquals(3, Models.rotateFace(4, 90, 0)); assertEquals(0, Models.rotateFace(4, 0, 90));
    }

    @Test void orientableModelTurnsNorthFaceWest() throws Exception {
        Path jar = temporary.resolve("orientable.jar");
        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(Files.newOutputStream(jar))) {
            add(zip, "assets/minecraft/blockstates/orientable.json", "{\"variants\":{\"\":{\"model\":\"block/orientable\",\"y\":90}}}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            add(zip, "assets/minecraft/models/block/orientable.json", "{\"textures\":{\"front\":\"block/front\",\"side\":\"block/side\"},\"elements\":[{\"from\":[0,0,0],\"to\":[16,16,16],\"faces\":{\"north\":{\"texture\":\"#front\"},\"south\":{\"texture\":\"#side\"}}}]}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] pixels = new byte[1024]; java.util.Arrays.fill(pixels, (byte)255);
            add(zip, "assets/minecraft/textures/block/front.png", Png.encode(16,16,pixels));
            add(zip, "assets/minecraft/textures/block/side.png", Png.encode(16,16,pixels));
        }
        Path out = temporary.resolve("orientable-out"); TextureBuilder.build(jar,out);
        Map<String,Object> document = Json.object(Json.parse(Files.readString(out.resolve("blocks.json"))));
        Map<String,Object> entry = entry(Json.object(document.get("blocks")),"minecraft:orientable",0);
        java.util.List<?> textures = (java.util.List<?>) document.get("textures");
        assertEquals("minecraft:block/front", textures.get(((Number)((java.util.List<?>)entry.get("faces")).get(0)).intValue()));
    }

    @Test void realJarOraclesAndSpotChecks() throws Exception {
        for (String version : new String[] {"26.3", "1.21.11"}) {
            Path jar = Path.of("feasibility_research/output/client/minecraft-client-" + version + ".jar");
            Path oracle = Path.of("feasibility_research/output/textures", version);
            assertTrue(Files.isRegularFile(jar), "Missing jar: " + jar);
            assertTrue(Files.isRegularFile(oracle.resolve("blocks.json")), "Missing JSON oracle: " + oracle);
            assertTrue(Files.isRegularFile(oracle.resolve("atlas.png")), "Missing PNG oracle: " + oracle);
            Path out = temporary.resolve(version); TextureBuilder.Summary summary = TextureBuilder.build(jar, out);
            assertArrayEquals(Files.readAllBytes(oracle.resolve("blocks.json")), Files.readAllBytes(out.resolve("blocks.json")), version);
            Png.Image expected = Png.decode(Files.readAllBytes(oracle.resolve("atlas.png")));
            Png.Image actual = Png.decode(Files.readAllBytes(out.resolve("atlas.png")));
            assertEquals(expected.width(), actual.width()); assertEquals(expected.height(), actual.height()); assertArrayEquals(expected.pixels(), actual.pixels(), version);
            Map<String,Object> document = Json.object(Json.parse(Files.readString(out.resolve("blocks.json"))));
            Map<String,Object> blocks = Json.object(document.get("blocks"));
            Map<String,Object> stone = entry(blocks,"minecraft:stone",0);
            assertEquals(true, stone.get("fullCube")); assertEquals(false, stone.get("transparent"));
            Map<String,Object> leaves = entry(blocks,"minecraft:oak_leaves",0);
            assertEquals(true, leaves.get("transparent")); assertTrue(((java.util.List<?>)leaves.get("tints")).contains(2L));
            Map<String,Object> water = entry(blocks,"minecraft:water",0);
            assertEquals(java.util.List.of(3L,3L,3L,3L,3L,3L), water.get("tints"));
            Map<String,Object> grass = entries(blocks,"minecraft:grass_block").stream().filter(e -> "false".equals(Json.object(e.get("when")).get("snowy"))).findFirst().orElseThrow();
            assertEquals(1L, ((java.util.List<?>) grass.get("tints")).get(3));
            java.util.List<?> textures = (java.util.List<?>) document.get("textures");
            assertEquals("minecraft:block/water_still", textures.get(((Number)((java.util.List<?>)water.get("faces")).get(0)).intValue()));
            assertEquals("minecraft:block/dirt", textures.get(((Number)((java.util.List<?>)grass.get("faces")).get(2)).intValue()));
            for (String axis : new String[] {"x","y","z"}) {
                Map<String,Object> log = entries(blocks,"minecraft:oak_log").stream().filter(e -> axis.equals(Json.object(e.get("when")).get("axis"))).findFirst().orElseThrow();
                int[] ends = axis.equals("x") ? new int[]{0,1} : axis.equals("y") ? new int[]{2,3} : new int[]{4,5};
                for (int face : ends) assertEquals("minecraft:block/oak_log_top", textures.get(((Number)((java.util.List<?>)log.get("faces")).get(face)).intValue()));
            }
            assertTrue(summary.layers() > 1000);
        }
    }

    private static Map<String,Object> entry(Map<String,Object> blocks,String name,int index) { return entries(blocks,name).get(index); }
    private static void add(java.util.zip.ZipOutputStream zip, String name, byte[] data) throws java.io.IOException {
        zip.putNextEntry(new java.util.zip.ZipEntry(name)); zip.write(data); zip.closeEntry();
    }
    private static java.util.List<Map<String,Object>> entries(Map<String,Object> blocks,String name) {
        return ((java.util.List<?>) blocks.get(name)).stream().map(Json::object).toList();
    }
}
