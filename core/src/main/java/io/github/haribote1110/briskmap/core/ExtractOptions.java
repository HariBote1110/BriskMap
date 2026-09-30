package io.github.haribote1110.briskmap.core;

import java.util.Objects;

public record ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
        boolean do2d, boolean do3d, BlockDefaults blockDefaults, int maxY) {
    public ExtractOptions {
        if (compressionLevel < 0 || compressionLevel > 9 || (!do2d && !do3d))
            throw new IllegalArgumentException("Invalid extraction options");
        Objects.requireNonNull(blockDefaults);
        if (maxY != Integer.MAX_VALUE && (maxY < Short.MIN_VALUE || maxY >= Short.MAX_VALUE))
            throw new IllegalArgumentException("Invalid max-y");
    }

    public ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
            boolean do2d, boolean do3d, BlockDefaults blockDefaults) {
        this(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, blockDefaults, Integer.MAX_VALUE);
    }

    public ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
            boolean do2d, boolean do3d) {
        this(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, BlockDefaults.empty());
    }

    public ExtractOptions withBlockDefaults(BlockDefaults defaults) {
        return new ExtractOptions(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, defaults, maxY);
    }

    public ExtractOptions withMaxY(int cut) {
        return new ExtractOptions(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, blockDefaults, cut);
    }

    public int headerMaxY() { return maxY == Integer.MAX_VALUE ? Short.MAX_VALUE : maxY; }

    /** Header flags: bit0 hides caves, bit1 draws fluid surfaces only, bit2 normalises bare block names. */
    public int flags() { return (hideCaves ? 1 : 0) | (surfaceFluids ? 2 : 0) | (blockDefaults.isEmpty() ? 0 : 4); }
}
