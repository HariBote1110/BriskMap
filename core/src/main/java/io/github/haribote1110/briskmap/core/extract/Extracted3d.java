package io.github.haribote1110.briskmap.core.extract;


import java.util.Arrays;

public final class Extracted3d {
    public long nonair;
    public long faces, shellFluidBlocks;
    public final int[][] positions = new int[24][];
    public final int[][] blocks = new int[24][];
    public final byte[][] masks = new byte[24][];
    public Extracted3d() {
        for (int i = 0; i < 24; i++) { positions[i] = new int[0]; blocks[i] = new int[0]; masks[i] = new byte[0]; }
    }
    public int count() { int n = 0; for (int[] section : positions) n += section.length; return n; }
    public boolean same(Extracted3d other) {
        for (int i = 0; i < 24; i++) if (!Arrays.equals(positions[i], other.positions[i]) || !Arrays.equals(blocks[i], other.blocks[i])) return false;
        return true;
    }
}
