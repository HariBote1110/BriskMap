package io.github.haribote1110.briskmap.core;

public record ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
        boolean do2d, boolean do3d, BlockDefaults blockDefaults) {
    public ExtractOptions {
        if (compressionLevel < 0 || compressionLevel > 9 || (!do2d && !do3d))
            throw new IllegalArgumentException("Invalid extraction options");
        java.util.Objects.requireNonNull(blockDefaults);
    }

    public ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
            boolean do2d, boolean do3d) {
        this(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, BlockDefaults.empty());
    }

    public int flags() { return (hideCaves ? 1 : 0) | (surfaceFluids ? 2 : 0) | (blockDefaults.isEmpty() ? 0 : 4); }
}
