package io.github.haribote1110.briskmap.paper.world;

import java.util.HashSet;
import java.util.Set;

public final class MissingRegionWarnings {
    private final Set<String> warnedWorlds = new HashSet<>();

    public boolean shouldWarn(String world) { return warnedWorlds.add(world); }

    public void reset() { warnedWorlds.clear(); }
}
