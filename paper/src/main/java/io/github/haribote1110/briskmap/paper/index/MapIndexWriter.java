package io.github.haribote1110.briskmap.paper.index;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class MapIndexWriter {
    private static final Pattern REGION = Pattern.compile("r\\.(-?\\d+)\\.(-?\\d+)\\.b[23]d");
    private static final Pattern VERSION = Pattern.compile("\"dataVersion\":\\{\"min\":(\\d+),\"max\":(\\d+)\\}");
    private final Path index;
    private String content;
    private final Map<String, int[]> knownVersions = new HashMap<>();
    public MapIndexWriter(Path index) { this.index = index; }

    public record MapEntry(String id, String name, String dimension, int[] spawn, String caves,
            String fluids, int maxY, int dataVersionMin, int dataVersionMax, Path outDir, long updated) {
        public MapEntry { spawn = spawn.clone(); }
        public MapEntry(String id, String name, String dimension, int[] spawn, String caves,
                String fluids, int dataVersionMin, int dataVersionMax, Path outDir, long updated) {
            this(id, name, dimension, spawn, caves, fluids, Integer.MAX_VALUE,
                    dataVersionMin, dataVersionMax, outDir, updated);
        }
        @Override public int[] spawn() { return spawn.clone(); }
    }

    public synchronized boolean write(List<MapEntry> maps) throws IOException { return write(maps, null); }

    public synchronized boolean write(List<MapEntry> maps, String textures) throws IOException {
        if (content == null && Files.exists(index)) {
            content = Files.readString(index).replaceFirst("\\\"generated\\\":\\d+", "\"generated\":0");
            knownVersions.putAll(previousVersions(content));
        }
        String body = body(maps, knownVersions, textures);
        if (body.equals(content)) return false;
        Files.createDirectories(index.getParent());
        Path temporary = index.resolveSibling(index.getFileName() + ".tmp");
        try {
            try (var stream = Files.newOutputStream(temporary, StandardOpenOption.CREATE,
                    StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
                stream.write(body.replace("\"generated\":0", "\"generated\":" + System.currentTimeMillis())
                        .getBytes(StandardCharsets.UTF_8));
            }
            Files.move(temporary, index, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temporary); }
        content = body;
        knownVersions.putAll(previousVersions(body));
        return true;
    }

    private static String body(List<MapEntry> maps, Map<String, int[]> previous, String textures) throws IOException {
        StringBuilder json = new StringBuilder("{\"format\":1,\"generated\":0,\"textures\":")
                .append(textures == null ? "null" : quote(textures)).append(",\"maps\":[");
        boolean first = true;
        for (MapEntry map : maps.stream().sorted(Comparator.comparing(MapEntry::id)).toList()) {
            if (!first) json.append(',');
            first = false;
            int[] spawn = map.spawn();
            json.append("{\"id\":").append(quote(map.id())).append(",\"name\":").append(quote(map.name()))
                    .append(",\"dimension\":").append(quote(map.dimension())).append(",\"spawn\":[")
                    .append(spawn[0]).append(',').append(spawn[1]).append(',').append(spawn[2])
                    .append("],\"extract\":{\"caves\":").append(quote(map.caves()))
                    .append(",\"fluids\":").append(quote(map.fluids())).append(",\"format\":4,\"maxY\":")
                    .append(map.maxY() == Integer.MAX_VALUE ? "null" : map.maxY()).append('}');
            List<int[]> regions = new ArrayList<>();
            long latestOutput = 0;
            if (Files.isDirectory(map.outDir())) try (var files = Files.list(map.outDir())) {
                for (Path file : files.toList()) {
                    Matcher match = REGION.matcher(file.getFileName().toString());
                    if (match.matches() && Files.isRegularFile(file)) {
                        latestOutput = Math.max(latestOutput, Files.getLastModifiedTime(file).toMillis());
                        int x = Integer.parseInt(match.group(1)), z = Integer.parseInt(match.group(2));
                        if (regions.stream().noneMatch(pair -> pair[0] == x && pair[1] == z)) regions.add(new int[]{x, z});
                    }
                }
            }
            int[] earlier = previous.get(quote(map.id()));
            int min = map.dataVersionMin(), max = map.dataVersionMax();
            if (!regions.isEmpty() && min == 0 && max == 0 && earlier != null) {
                min = earlier[0];
                max = earlier[1];
            }
            json.append(",\"dataVersion\":{\"min\":").append(min).append(",\"max\":").append(max)
                    .append("},\"regions\":[");
            regions.sort(Comparator.<int[]>comparingInt(pair -> pair[0]).thenComparingInt(pair -> pair[1]));
            for (int i = 0; i < regions.size(); i++) {
                if (i > 0) json.append(',');
                json.append('[').append(regions.get(i)[0]).append(',').append(regions.get(i)[1]).append(']');
            }
            json.append("],\"updated\":").append(Math.max(map.updated(), latestOutput)).append('}');
        }
        return json.append("]}").toString();
    }

    private static Map<String, int[]> previousVersions(String content) {
        Map<String, int[]> versions = new HashMap<>();
        if (content == null) return versions;
        int cursor = 0;
        while (true) {
            int id = content.indexOf("\"id\":", cursor);
            if (id < 0) break;
            int beginning = id + 5;
            int end = beginning + 1;
            boolean escaped = false;
            for (; end < content.length(); end++) {
                char character = content.charAt(end);
                if (!escaped && character == '"') break;
                if (!escaped && character == '\\') escaped = true;
                else escaped = false;
            }
            if (end >= content.length()) break;
            int next = content.indexOf("\"id\":", end + 1);
            Matcher version = VERSION.matcher(content.substring(end + 1, next < 0 ? content.length() : next));
            if (version.find()) {
                try { versions.put(content.substring(beginning, end + 1),
                        new int[]{Integer.parseInt(version.group(1)), Integer.parseInt(version.group(2))}); }
                catch (NumberFormatException ignored) { /* Invalid previous index. */ }
            }
            cursor = end + 1;
        }
        return versions;
    }

    private static String quote(String value) {
        StringBuilder result = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char character = value.charAt(i);
            if (character == '"' || character == '\\') result.append('\\').append(character);
            else if (character < 32) result.append(String.format("\\u%04x", (int) character));
            else result.append(character);
        }
        return result.append('"').toString();
    }
}
