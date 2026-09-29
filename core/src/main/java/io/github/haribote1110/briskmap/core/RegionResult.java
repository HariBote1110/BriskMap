package io.github.haribote1110.briskmap.core;

public record RegionResult(long chunksTotal, long chunksExtracted, long chunksSkippedNotFull,
        long chunksSkippedUnsupported, long chunksReused, long outputBytes2d, long outputBytes3d,
        int outputFiles, boolean written, int dataVersionMin, int dataVersionMax,
        long readNs, long borderPassNs, long inflateNs, long parseNs, long extract2dNs,
        long extract3dNs, long compressNs, long writeNs, long shellBlocks, long blocksNonair,
        long shellFluidBlocks, long faces) { }
