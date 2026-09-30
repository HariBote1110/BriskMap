package io.github.haribote1110.briskmap.paper.world;

import java.nio.file.Path;

public record MapTarget(String id, String name, String dimension, Path regionDir, Path outDir, int[] spawn, int maxY) {
    public MapTarget { spawn = spawn.clone(); }
    public MapTarget(String id, String name, String dimension, Path regionDir, Path outDir, int[] spawn) {
        this(id, name, dimension, regionDir, outDir, spawn, Integer.MAX_VALUE);
    }
    @Override public int[] spawn() { return spawn.clone(); }
}
