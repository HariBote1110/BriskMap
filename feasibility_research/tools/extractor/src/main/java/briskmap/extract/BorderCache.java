package briskmap.extract;

public final class BorderCache {
    static final int WEST = 0, EAST = 1, NORTH = 2, SOUTH = 3;
    private final long[][][] masks = new long[1024][][];

    public void put(int index, Chunk chunk, Palette palette, boolean hideCaves) {
        if (chunk == null || !"minecraft:full".equals(chunk.status)) { masks[index] = null; return; }
        int[][] all = Extractor.decodeBlocks(chunk, palette);
        boolean[] occluding = new boolean[palette.size()];
        for (int i = 0; i < occluding.length; i++) occluding[i] = Extractor.isOccluding(palette.get(i));
        long[][] sides = new long[4][96];
        for (int y = 0; y < 384; y++) {
            int section = y >>> 4, localY = y & 15, worldY = y - 64;
            for (int t = 0; t < 16; t++) {
                int west = all[section][localY * 256 + t * 16];
                int east = all[section][localY * 256 + t * 16 + 15];
                int north = all[section][localY * 256 + t];
                int south = all[section][localY * 256 + 240 + t];
                int bit = y * 16 + t, word = bit >>> 6;
                long flag = 1L << (bit & 63);
                if (Extractor.occludes(west, occluding, chunk.oceanFloor, 0, t, worldY, hideCaves)) sides[WEST][word] |= flag;
                if (Extractor.occludes(east, occluding, chunk.oceanFloor, 15, t, worldY, hideCaves)) sides[EAST][word] |= flag;
                if (Extractor.occludes(north, occluding, chunk.oceanFloor, t, 0, worldY, hideCaves)) sides[NORTH][word] |= flag;
                if (Extractor.occludes(south, occluding, chunk.oceanFloor, t, 15, worldY, hideCaves)) sides[SOUTH][word] |= flag;
            }
        }
        masks[index] = sides;
    }

    public boolean neighbourOccludes(int index, int direction, int y, int coordinate) {
        int neighbour;
        int opposite;
        switch (direction) {
            // Region seams are occluding because the adjacent region is not read.
            case WEST -> { if ((index & 31) == 0) return true; neighbour = index - 1; opposite = EAST; }
            case EAST -> { if ((index & 31) == 31) return true; neighbour = index + 1; opposite = WEST; }
            case NORTH -> { if (index < 32) return true; neighbour = index - 32; opposite = SOUTH; }
            case SOUTH -> { if (index >= 992) return true; neighbour = index + 32; opposite = NORTH; }
            default -> throw new IllegalArgumentException("Unknown border direction");
        }
        long[][] sides = masks[neighbour];
        // An absent or non-full chunk is open space within the region.
        if (sides == null) return false;
        int bit = y * 16 + coordinate;
        return (sides[opposite][bit >>> 6] & (1L << (bit & 63))) != 0;
    }
}
