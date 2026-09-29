package io.github.haribote1110.briskmap.paper.world;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

public final class RegionFolderResolver {
    public enum Environment { NORMAL, NETHER, THE_END, CUSTOM }
    private RegionFolderResolver() { }

    public static Optional<Path> resolve(Path worldFolder, String namespace, String path, Environment environment) {
        Path modern = worldFolder.resolve("dimensions").resolve(namespace).resolve(path).resolve("region");
        if (Files.isDirectory(modern)) return Optional.of(modern);
        Path legacy = switch (environment) {
            case NORMAL -> worldFolder.resolve("region");
            case NETHER -> worldFolder.resolve("DIM-1/region");
            case THE_END -> worldFolder.resolve("DIM1/region");
            case CUSTOM -> null;
        };
        return legacy != null && Files.isDirectory(legacy) ? Optional.of(legacy) : Optional.empty();
    }
}
