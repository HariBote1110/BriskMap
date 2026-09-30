package io.github.haribote1110.briskmap.core.extract;

import java.util.BitSet;

/** Bounded reachability for a region and its one-chunk halo. Coordinates include that halo. */
public final class Reachability {
    private static final int WIDTH = 544, PLANE = WIDTH * WIDTH, HEIGHT = 384;
    private final BitSet solid = new BitSet(PLANE * HEIGHT);
    private final BitSet reached = new BitSet(PLANE * HEIGHT);
    private final short[] floor = new short[PLANE];
    private final int maxY;

    public Reachability(int maxY) { this.maxY = maxY; }

    public void put(int chunkX, int chunkZ, Chunk chunk) {
        if (chunk == null || !"minecraft:full".equals(chunk.status)) return;
        int startX = (chunkX + 1) * 16, startZ = (chunkZ + 1) * 16;
        int[] floors = Extractor.floors(chunk, maxY);
        for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            int value = floors[z * 16 + x] - 1;
            floor[(startZ + z) * WIDTH + startX + x] = (short)Math.max(0, Math.min(383, value));
        }
        for (int sy = 0; sy < 24; sy++) {
            Section section = chunk.sections[sy];
            if (section == null || section.blocks == null || section.blocks.length == 0) continue;
            boolean[] opaque = new boolean[section.blocks.length];
            int opaqueCount = 0;
            for (int i = 0; i < opaque.length; i++) {
                opaque[i] = Extractor.isOccluding(section.blocks[i]);
                if (opaque[i]) opaqueCount++;
            }
            if (opaqueCount == 0) continue;
            int width = Bits.width(section.blocks.length, 4);
            for (int y = 0; y < 16 && sy * 16 + y - 64 <= maxY; y++) {
                int row = (sy * 16 + y) * PLANE + startZ * WIDTH + startX;
                for (int z = 0; z < 16; z++) {
                    int at = row + z * WIDTH;
                    if (opaque.length == 1) { solid.set(at, at + 16); continue; }
                    int local = y * 256 + z * 16;
                    for (int x = 0; x < 16; x++) if (opaque[Bits.get(section.blockData, width, local + x)]) solid.set(at + x);
                }
            }
        }
    }

    public void flood(int depth) {
        if (depth == 0) return;
        BitSet active = new BitSet(PLANE * HEIGHT), next = new BitSet(PLANE * HEIGHT);
        for (int z = 0; z < WIDTH; z++) for (int x = 0; x < WIDTH; x++) {
            int column = z * WIDTH + x, level = floor[column];
            if (level == 0) continue;
            int top = (level - 1) * PLANE + column;
            if (!solid.get(top) && !solid.get(top + PLANE)) seed(top, active);
            if (x > 0) edge(column, column - 1, level, floor[column - 1], active);
            if (x + 1 < WIDTH) edge(column, column + 1, level, floor[column + 1], active);
            if (z > 0) edge(column, column - WIDTH, level, floor[column - WIDTH], active);
            if (z + 1 < WIDTH) edge(column, column + WIDTH, level, floor[column + WIDTH], active);
        }
        for (int step = 1; step < depth && !active.isEmpty(); step++) {
            for (int cell = active.nextSetBit(0); cell >= 0; cell = active.nextSetBit(cell + 1)) {
                int column = cell % PLANE, y = cell / PLANE;
                if (column % WIDTH > 0) spread(cell - 1, y, column - 1, next);
                if (column % WIDTH + 1 < WIDTH) spread(cell + 1, y, column + 1, next);
                if (column >= WIDTH) spread(cell - WIDTH, y, column - WIDTH, next);
                if (column < PLANE - WIDTH) spread(cell + WIDTH, y, column + WIDTH, next);
                if (y > 0) spread(cell - PLANE, y - 1, column, next);
                if (y + 1 < HEIGHT) spread(cell + PLANE, y + 1, column, next);
            }
            active.clear();
            BitSet previous = active; active = next; next = previous;
        }
    }

    private void edge(int column, int neighbourColumn, int level, int neighbourLevel, BitSet active) {
        for (int y = Math.max(0, neighbourLevel); y < level; y++) {
            int cell = y * PLANE + column;
            if (!solid.get(cell) && !solid.get(y * PLANE + neighbourColumn)) seed(cell, active);
        }
    }

    private void seed(int cell, BitSet active) {
        if (reached.get(cell)) return;
        reached.set(cell);
        active.set(cell);
    }

    private void spread(int cell, int y, int column, BitSet next) {
        if (y >= floor[column] || solid.get(cell) || reached.get(cell)) return;
        seed(cell, next);
    }

    public boolean reached(int chunkX, int chunkZ, int x, int z, int y) {
        if (y < 0 || y >= HEIGHT) return true;
        int column = ((chunkZ + 1) * 16 + z) * WIDTH + (chunkX + 1) * 16 + x;
        int cell = y * PLANE + column;
        return !solid.get(cell) && (y >= 119 || y >= floor[column] || reached.get(cell));
    }
}
