package io.github.haribote1110.briskmap.paper.config;

import io.github.haribote1110.briskmap.core.ExtractOptions;
import java.util.List;

public record BriskMapConfig(boolean webEnabled, String webBind, int webPort, int webThreads,
        int extractThreads, String caves, String fluids, int compressionLevel, int scanIntervalSeconds,
        List<String> excludedWorlds, boolean acceptMojangDownload) {
    public BriskMapConfig { excludedWorlds = List.copyOf(excludedWorlds); }
    public ExtractOptions options() {
        return new ExtractOptions(caves.equals("hide"), fluids.equals("surface"), compressionLevel, true, true);
    }
}
