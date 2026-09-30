package io.github.haribote1110.briskmap.core;

import java.util.Objects;

public record ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
        boolean do2d, boolean do3d, BlockDefaults blockDefaults, int maxY, int caveDepth) {
    public ExtractOptions {
        if (compressionLevel < 0 || compressionLevel > 9 || (!do2d && !do3d))
            throw new IllegalArgumentException("Invalid extraction options");
        Objects.requireNonNull(blockDefaults);
        if (maxY != Integer.MAX_VALUE && (maxY < Short.MIN_VALUE || maxY >= Short.MAX_VALUE))
            throw new IllegalArgumentException("Invalid max-y");
        if (caveDepth < 0 || caveDepth > 16) throw new IllegalArgumentException("Invalid cave depth");
    }

    public ExtractOptions(boolean hideCaves, boolean surfaceFluids, int compressionLevel,
            boolean do2d, boolean do3d, BlockDefaults blockDefaults, int maxY) {
        this(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, blockDefaults, maxY, 16);
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
        return new ExtractOptions(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, defaults, maxY, caveDepth);
    }

    public ExtractOptions withMaxY(int cut) {
        return new ExtractOptions(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, blockDefaults, cut, caveDepth);
    }

    public ExtractOptions withCaveDepth(int depth) {
        return new ExtractOptions(hideCaves, surfaceFluids, compressionLevel, do2d, do3d, blockDefaults, maxY, depth);
    }

    public int headerMaxY() { return maxY == Integer.MAX_VALUE ? Short.MAX_VALUE : maxY; }

    /** Header flags: bit0 hides caves, bit1 draws fluid surfaces only, bit2 normalises bare block names. */
    public int flags() { return (hideCaves ? 1 : 0) | (surfaceFluids ? 2 : 0) | (blockDefaults.isEmpty() ? 0 : 4); }
}
