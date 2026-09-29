package io.github.haribote1110.briskmap.core;

import java.util.Objects;

public record ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
        boolean do2d, boolean do3d, BlockDefaults blockDefaults) {
    public ExtractOptions {
        if (compressionLevel < 0 || compressionLevel > 9 || (!do2d && !do3d))
            throw new IllegalArgumentException("Invalid extraction options");
        Objects.requireNonNull(blockDefaults);
    }

    public ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
            boolean do2d, boolean do3d) {
        this(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, BlockDefaults.empty());
    }

    public ExtractOptions withBlockDefaults(BlockDefaults defaults) {
        return new ExtractOptions(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, defaults);
    }

    /** Header flags: bit0 hides caves, bit1 draws fluid surfaces only, bit2 normalises bare block names. */
    public int flags() { return (hideCaves ? 1 : 0) | (surfaceFluids ? 2 : 0) | (blockDefaults.isEmpty() ? 0 : 4); }
}
