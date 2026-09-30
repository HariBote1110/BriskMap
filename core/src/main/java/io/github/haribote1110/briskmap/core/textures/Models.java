package io.github.haribote1110.briskmap.core.textures;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/** Block model inheritance, face selection, rotations and tint rules. */
public final class Models {
    private static final String[] DIRECTIONS = {"west", "east", "down", "up", "north", "south"};
    private static final int[][] VECTORS = {{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}};
    private Models() { }

    public record Model(Map<String,Object> textures, List<Object> elements, boolean cross) {
        public String texture(Object reference) {
            Set<String> visited = new HashSet<>(); Object current = reference;
            while (current instanceof String string && string.startsWith("#")) {
                if (!visited.add(string)) return null;
                current = textures.get(string.substring(1));
            }
            return current instanceof String string ? normalise(string) : null;
        }
    }
    public record Face(String texture, boolean tinted) { }
    public record FaceData(boolean fullCube, List<Face> faces) { }

    public static Model resolveModel(String name, Function<String,byte[]> read) {
        return resolveModel(name, read, new HashMap<>(), new HashSet<>());
    }

    static Model resolveModel(String name, Function<String,byte[]> read, Map<String,Model> cache, Set<String> trail) {
        String key = normalise(name);
        if (cache.containsKey(key)) return cache.get(key);
        if (trail.size() >= 20 || trail.contains(key)) throw new IllegalArgumentException("Model parent depth or cycle: " + key);
        String[] parts = key.split(":", 2);
        byte[] bytes = read.apply("assets/" + parts[0] + "/models/" + parts[1] + ".json");
        if (bytes == null) return null;
        Map<String,Object> own = Json.object(Json.parse(new String(bytes, StandardCharsets.UTF_8)));
        trail.add(key);
        Model parent;
        try { parent = own.get("parent") instanceof String value ? resolveModel(value, read, cache, trail) : null; }
        finally { trail.remove(key); }
        Map<String,Object> textures = new LinkedHashMap<>();
        if (parent != null) textures.putAll(parent.textures());
        if (own.get("textures") instanceof Map<?, ?>) textures.putAll(Json.object(own.get("textures")));
        List<Object> elements = own.get("elements") instanceof List<?> list ? new ArrayList<>(list) : parent == null ? List.of() : parent.elements();
        boolean cross = key.equals("minecraft:block/cross") || key.equals("minecraft:block/tinted_cross")
                || key.equals("minecraft:block/crop") || parent != null && parent.cross();
        Model model = new Model(textures, elements, cross); cache.put(key, model); return model;
    }

    static FaceData faceData(Model model) {
        Map<String,Object> full = null;
        for (Object item : model.elements()) {
            Map<String,Object> element = Json.object(item);
            if (coordinates(element.get("from"), 0) && coordinates(element.get("to"), 16)) { full = element; break; }
        }
        List<Face> faces = new ArrayList<>();
        for (String direction : DIRECTIONS) {
            Map<String,Object> chosen = null;
            if (full != null) chosen = face(full, direction);
            else {
                double volume = -1;
                for (Object item : model.elements()) {
                    Map<String,Object> element = Json.object(item);
                    Map<String,Object> candidate = face(element, direction);
                    if (candidate == null) continue;
                    List<?> from = (List<?>) element.get("from"), to = (List<?>) element.get("to");
                    double size = 1;
                    for (int axis = 0; axis < 3; axis++) size *= Math.max(0, ((Number) to.get(axis)).doubleValue() - ((Number) from.get(axis)).doubleValue());
                    if (size > volume) { volume = size; chosen = candidate; }
                }
            }
            String fallback = model.texture("#particle");
            if (fallback == null && !model.textures().isEmpty()) fallback = model.texture(model.textures().values().iterator().next());
            String texture = chosen == null ? null : model.texture(chosen.get("texture"));
            faces.add(new Face(texture == null ? fallback : texture, chosen != null && chosen.containsKey("tintindex")));
        }
        return new FaceData(full != null, faces);
    }

    private static boolean coordinates(Object value, int wanted) {
        if (!(value instanceof List<?> list) || list.size() != 3) return false;
        for (Object number : list) if (!(number instanceof Number n) || n.doubleValue() != wanted) return false;
        return true;
    }
    private static Map<String,Object> face(Map<String,Object> element, String direction) {
        if (!(element.get("faces") instanceof Map<?, ?>)) return null;
        Object value = Json.object(element.get("faces")).get(direction);
        return value == null ? null : Json.object(value);
    }

    public static int rotateFace(int face, int x, int y) {
        int[] vector = VECTORS[face].clone();
        for (int i = 0; i < Math.floorMod(x, 360) / 90; i++) vector = new int[] {vector[0], -vector[2], vector[1]};
        for (int i = 0; i < Math.floorMod(y, 360) / 90; i++) vector = new int[] {vector[2], vector[1], -vector[0]};
        for (int i = 0; i < 6; i++) if (java.util.Arrays.equals(vector, VECTORS[i])) return i;
        return -1;
    }

    static int tintFor(String block) {
        if (block.contains("water")) return 3;
        if (block.equals("lily_pad") || block.equals("vine") || block.contains("leaves") && !block.matches(".*(cherry|azalea|flowering|pale).*") ) return 2;
        if (block.equals("grass_block") || block.equals("short_grass") || block.equals("tall_grass") || block.equals("fern") || block.equals("large_fern") || block.equals("sugar_cane") || block.contains("grass")) return 1;
        return 4;
    }

    static String normalise(String name) { return name.contains(":") ? name : "minecraft:" + name; }
}
