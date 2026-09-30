package io.github.haribote1110.briskmap.paper.config;

import io.github.haribote1110.briskmap.core.ExtractOptions;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import io.github.haribote1110.briskmap.paper.world.RegionFolderResolver;

public record BriskMapConfig(boolean webEnabled, String webBind, int webPort, int webThreads,
        int extractThreads, String caves, String fluids, int compressionLevel, int caveDepth, int scanIntervalSeconds,
        List<String> excludedWorlds, boolean acceptMojangDownload, Map<String, ?> mapCuts) {
    public BriskMapConfig { excludedWorlds = List.copyOf(excludedWorlds); mapCuts = Map.copyOf(mapCuts); }
    public ExtractOptions options() {
        return new ExtractOptions(caves.equals("hide"), fluids.equals("surface"), compressionLevel, true, true).withCaveDepth(caveDepth);
    }

    public int maxY(String name, RegionFolderResolver.Environment environment, Consumer<String> warning) {
        int fallback = environment == RegionFolderResolver.Environment.NETHER ? 100 : Integer.MAX_VALUE;
        Object value = mapCuts.get(name);
        if (value == null) return fallback;
        if ("none".equals(value)) return Integer.MAX_VALUE;
        if (value instanceof Number number) {
            double candidate = number.doubleValue();
            if (candidate >= Short.MIN_VALUE && candidate < Short.MAX_VALUE && candidate == Math.rint(candidate)) return number.intValue();
        }
        warning.accept("Invalid maps." + name + ".max-y; using default");
        return fallback;
    }
}
