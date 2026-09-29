package io.github.haribote1110.briskmap.paper.world;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

public final class RegionFolderResolver {
    public enum Environment { NORMAL, NETHER, THE_END, CUSTOM }
    private static final Pattern REGION_FILE = Pattern.compile("r\\.-?\\d+\\.-?\\d+\\.mca");
    private RegionFolderResolver() { }

    public static Optional<Path> resolve(Path worldFolder, String namespace, String path, Environment environment) {
        List<Path> candidates = new ArrayList<>();
        candidates.add(worldFolder.resolve("region"));
        Path legacy = switch (environment) {
            case NORMAL, CUSTOM -> null;
            case NETHER -> worldFolder.resolve("DIM-1/region");
            case THE_END -> worldFolder.resolve("DIM1/region");
        };
        if (legacy != null) candidates.add(legacy);
        candidates.add(worldFolder.resolve("dimensions").resolve(namespace).resolve(path).resolve("region"));
        return candidates.stream().filter(Files::isDirectory).filter(RegionFolderResolver::hasRegionFile).findFirst()
                .or(() -> candidates.stream().filter(Files::isDirectory).findFirst());
    }

    private static boolean hasRegionFile(Path directory) {
        try (var files = Files.list(directory)) {
            return files.anyMatch(file -> Files.isRegularFile(file)
                    && REGION_FILE.matcher(file.getFileName().toString()).matches());
        } catch (IOException exception) {
            return false;
        }
    }
}
