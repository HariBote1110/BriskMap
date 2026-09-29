package io.github.haribote1110.briskmap.core;

public record ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
        boolean do2d, boolean do3d) {
    public ExtractOptions {
        if (compressionLevel < 0 || compressionLevel > 9 || (!do2d && !do3d))
            throw new IllegalArgumentException("Invalid extraction options");
    }

    public int flags() { return (hideCaves ? 1 : 0) | (surfaceFluids ? 2 : 0); }
}
