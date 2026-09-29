package io.github.haribote1110.briskmap.core.textures;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Builds the atlas and block material table from a Minecraft client jar. */
public final class TextureBuilder {
    private TextureBuilder() { }
    public record Summary(int blocks, int entries, int unknown, int fallback, int layers, int atlasBytes, long ms) { }

    public static Summary build(Path clientJar, Path outDir) throws IOException {
        long start = System.nanoTime();
        try (ZipFile jar = new ZipFile(clientJar.toFile())) {
            Function<String,byte[]> read = path -> {
                ZipEntry entry = jar.getEntry(path);
                if (entry == null) return null;
                try (var stream = jar.getInputStream(entry)) { return stream.readAllBytes(); }
                catch (IOException exception) { throw new IllegalStateException("Cannot read jar entry " + path, exception); }
            };
            Worker worker = new Worker(read);
            List<String> paths = jar.stream().map(ZipEntry::getName)
                    .filter(path -> path.matches("assets/minecraft/blockstates/[^/]+\\.json"))
                    .sorted(Comparator.naturalOrder()).toList();
            Map<String,Object> blocks = new LinkedHashMap<>();
            for (String path : paths) {
                String name = "minecraft:" + path.substring(path.lastIndexOf('/') + 1, path.length() - 5);
                Map<String,Object> state = Json.object(Json.parse(new String(read.apply(path), StandardCharsets.UTF_8)));
                if (state.get("variants") instanceof Map<?, ?>) {
                    List<Object> entries = new ArrayList<>();
                    for (Map.Entry<String,Object> variant : Json.object(state.get("variants")).entrySet()) {
                        Map<String,Object> when = new LinkedHashMap<>();
                        if (!variant.getKey().isEmpty()) for (String pair : variant.getKey().split(",")) {
                            String[] values = pair.split("=", -1); when.put(values[0], values.length > 1 ? values[1] : null);
                        }
                        Object selected = variant.getValue() instanceof List<?> list ? list.get(0) : variant.getValue();
                        entries.add(worker.entry(name, when, Json.object(selected)));
                    }
                    blocks.put(name, entries);
                } else if (state.get("multipart") instanceof List<?> parts) {
                    Map<String,Object> part = Json.object(parts.get(0));
                    for (Object item : parts) { Map<String,Object> candidate = Json.object(item); if (!candidate.containsKey("when")) { part = candidate; break; } }
                    Object apply = part.get("apply");
                    Object selected = apply instanceof List<?> list ? list.get(0) : apply;
                    blocks.put(name, List.of(worker.entry(name, new LinkedHashMap<>(), Json.object(selected))));
                }
            }
            byte[] pixels = new byte[worker.layers.size() * 16 * 16 * 4];
            for (int i = 0; i < worker.layers.size(); i++) System.arraycopy(worker.layers.get(i), 0, pixels, i * 1024, 1024);
            byte[] atlas = Png.encode(16, worker.layers.size() * 16, pixels);
            Map<String,Object> document = new LinkedHashMap<>();
            document.put("format", 1); document.put("source", clientJar.getFileName().toString());
            document.put("tile", 16); document.put("layers", worker.layers.size()); document.put("textures", worker.textures);
            document.put("tints", List.of("none", "grass", "foliage", "water", "other")); document.put("blocks", blocks);
            Files.createDirectories(outDir);
            atomicWrite(outDir.resolve("atlas.png"), atlas);
            atomicWrite(outDir.resolve("blocks.json"), Json.stringify(document).getBytes(StandardCharsets.UTF_8));
            return new Summary(paths.size(), worker.entries, worker.unknown, worker.fallback, worker.layers.size(), atlas.length, Math.round((System.nanoTime() - start) / 1_000_000.0));
        }
    }

    static void atomicWrite(Path destination, byte[] bytes) throws IOException {
        Path temporary = Files.createTempFile(destination.getParent(), destination.getFileName().toString(), ".tmp");
        try {
            Files.write(temporary, bytes);
            Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
    }

    private static final class Worker {
        final Function<String,byte[]> read;
        final Map<String,Models.Model> models = new HashMap<>();
        final Map<String,byte[]> textureCache = new HashMap<>();
        final Map<String,Integer> layerIndex = new HashMap<>();
        final List<String> textures = new ArrayList<>();
        final List<byte[]> layers = new ArrayList<>();
        int unknown, fallback, entries;
        Worker(Function<String,byte[]> read) { this.read = read; textures.add("<missing>"); layers.add(missing()); }

        int useTexture(String name) {
            if (name == null) { unknown++; return 0; }
            Integer known = layerIndex.get(name); if (known != null) return known;
            String[] parts = name.split(":", 2);
            byte[] png = read.apply("assets/" + parts[0] + "/textures/" + parts[1] + ".png");
            if (png == null) { unknown++; return 0; }
            byte[] pixels = textureCache.get(name);
            if (pixels == null) {
                Png.Image image = Png.decode(png); pixels = new byte[1024];
                int square = Math.min(image.width(), image.height());
                for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
                    int sx = x * image.width() / 16, sy = y * square / 16;
                    System.arraycopy(image.pixels(), (sy * image.width() + sx) * 4, pixels, (y * 16 + x) * 4, 4);
                }
                textureCache.put(name, pixels);
            }
            int index = textures.size(); textures.add(name); layers.add(pixels); layerIndex.put(name, index); return index;
        }

        Map<String,Object> entry(String name, Map<String,Object> when, Map<String,Object> variant) {
            String block = name.substring(name.indexOf(':') + 1);
            Models.Model model = variant.get("model") instanceof String path ? Models.resolveModel(path, read, models, new java.util.HashSet<>()) : null;
            String special = block.equals("water") ? "minecraft:block/water_still" : block.equals("lava") ? "minecraft:block/lava_still" : null;
            if (model == null && special == null) fallback++;
            Models.FaceData data;
            if (model != null && (special == null || !model.elements().isEmpty())) data = Models.faceData(model);
            else data = new Models.FaceData(false, java.util.Collections.nCopies(6, new Models.Face(special, block.equals("water"))));
            Integer[] faces = new Integer[6], tints = new Integer[6]; Arrays.fill(faces, 0); Arrays.fill(tints, 0);
            int x = variant.get("x") instanceof Number n ? n.intValue() : 0;
            int y = variant.get("y") instanceof Number n ? n.intValue() : 0;
            for (int i = 0; i < 6; i++) {
                int target = Models.rotateFace(i, x, y);
                if (target < 0) throw new IllegalArgumentException("Invalid model rotation: " + name);
                Models.Face face = data.faces().get(i);
                faces[target] = useTexture(face.texture()); tints[target] = face.tinted() ? Models.tintFor(block) : 0;
            }
            boolean transparent = false;
            for (int layer : faces) {
                byte[] pixels = layers.get(layer);
                for (int i = 3; i < pixels.length; i += 4) if (Byte.toUnsignedInt(pixels[i]) < 255) { transparent = true; break; }
                if (transparent) break;
            }
            entries++;
            Map<String,Object> result = new LinkedHashMap<>();
            result.put("when", when); result.put("faces", Arrays.asList(faces)); result.put("tints", Arrays.asList(tints));
            result.put("fullCube", data.fullCube()); result.put("transparent", transparent); return result;
        }

        private static byte[] missing() {
            byte[] pixels = new byte[1024];
            for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
                int offset = (y * 16 + x) * 4;
                if ((x < 8) == (y < 8)) { pixels[offset] = (byte) 255; pixels[offset+2] = (byte) 255; }
                pixels[offset+3] = (byte) 255;
            }
            return pixels;
        }
    }
}
