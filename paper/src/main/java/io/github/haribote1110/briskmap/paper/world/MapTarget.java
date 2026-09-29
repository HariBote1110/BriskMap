package io.github.haribote1110.briskmap.paper.world;

import java.nio.file.Path;

public record MapTarget(String id, String name, String dimension, Path regionDir, Path outDir, int[] spawn) {
    public MapTarget { spawn = spawn.clone(); }
    @Override public int[] spawn() { return spawn.clone(); }
}
