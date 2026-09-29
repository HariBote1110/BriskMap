package io.github.haribote1110.briskmap.paper.extract;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

public final class RegionScanner {
    public static final Pattern REGION = Pattern.compile("r\\.-?\\d+\\.-?\\d+\\.mca");
    public record Stamp(long size, FileTime modified) { }
    public record Scan(Map<String, Stamp> snapshot, List<String> changed, List<String> removed) { }
    private RegionScanner() { }

    public static Scan scan(Path directory, Map<String, Stamp> previous) throws IOException {
        Map<String, Stamp> next = new HashMap<>();
        try (var files = Files.list(directory)) {
            for (Path path : files.toList()) {
                String name = path.getFileName().toString();
                if (REGION.matcher(name).matches() && Files.isRegularFile(path))
                    next.put(name, new Stamp(Files.size(path), Files.getLastModifiedTime(path)));
            }
        }
        List<String> changed = new ArrayList<>(), removed = new ArrayList<>();
        for (var entry : next.entrySet()) if (!entry.getValue().equals(previous.get(entry.getKey()))) changed.add(entry.getKey());
        for (String name : previous.keySet()) if (!next.containsKey(name)) removed.add(name);
        changed.sort(String::compareTo);
        removed.sort(String::compareTo);
        return new Scan(Map.copyOf(next), List.copyOf(changed), List.copyOf(removed));
    }
}
