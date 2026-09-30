package io.github.haribote1110.briskmap.core.extract;


public final class BorderCache {
    public static final int WEST = 0, EAST = 1, NORTH = 2, SOUTH = 3;
    private final long[][][] masks = new long[1152][][];
    private final long[][][] water = new long[1152][][], lava = new long[1152][][];

    public void putAdjacent(int direction, int coordinate, Chunk chunk, boolean hideCaves, int maxY) {
        int index = 1024 + direction * 32 + coordinate;
        if (chunk == null || !"minecraft:full".equals(chunk.status)) {
            masks[index] = null; water[index] = null; lava[index] = null;
            return;
        }
        int opposite = switch (direction) {
            case WEST -> EAST;
            case EAST -> WEST;
            case NORTH -> SOUTH;
            case SOUTH -> NORTH;
            default -> throw new IllegalArgumentException("Unknown border direction");
        };
        long[][] sides = new long[4][], waterSides = new long[4][], lavaSides = new long[4][];
        sides[opposite] = new long[96];
        waterSides[opposite] = new long[96];
        lavaSides[opposite] = new long[96];
        int[] floors = new int[16];
        for (int t = 0; t < 16; t++) {
            int x = direction == WEST ? 15 : direction == EAST ? 0 : t;
            int z = direction == NORTH ? 15 : direction == SOUTH ? 0 : t;
            floors[t] = maxY == Integer.MAX_VALUE ? chunk.oceanFloor[z * 16 + x] : Extractor.floor(chunk, x, z, maxY);
        }
        for (int sy = 0; sy < 24; sy++) {
            Section section = chunk.sections[sy];
            String[] states = section == null || section.blocks == null || section.blocks.length == 0
                    ? new String[]{"minecraft:air"} : section.blocks;
            boolean[] opaque = new boolean[states.length];
            byte[] fluids = new byte[states.length];
            for (int i = 0; i < states.length; i++) {
                opaque[i] = Extractor.isOccluding(states[i]);
                fluids[i] = Extractor.fluid(states[i]);
            }
            int width = Bits.width(states.length, 4);
            for (int localY = 0; localY < 16; localY++) {
                int worldY = sy * 16 + localY - 64;
                if (worldY > maxY) continue;
                for (int t = 0; t < 16; t++) {
                    int x = direction == WEST ? 15 : direction == EAST ? 0 : t;
                    int z = direction == NORTH ? 15 : direction == SOUTH ? 0 : t;
                    int block = states.length == 1 ? 0 : Bits.get(section.blockData, width, localY * 256 + z * 16 + x);
                    int bit = (sy * 16 + localY) * 16 + t, word = bit >>> 6;
                    long flag = 1L << (bit & 63);
                    if (opaque[block] || hideCaves && worldY < 55 && worldY < floors[t] - 65) sides[opposite][word] |= flag;
                    if (fluids[block] == 1) waterSides[opposite][word] |= flag;
                    if (fluids[block] == 2) lavaSides[opposite][word] |= flag;
                }
            }
        }
        masks[index] = sides; water[index] = waterSides; lava[index] = lavaSides;
    }

    public void put(int index, Chunk chunk, Palette palette, boolean hideCaves) {
        put(index, chunk, palette, hideCaves, Integer.MAX_VALUE);
    }

    public void put(int index, Chunk chunk, Palette palette, boolean hideCaves, int maxY) {
        if (chunk == null || !"minecraft:full".equals(chunk.status)) { masks[index] = null; water[index] = null; lava[index] = null; return; }
        int[][] all = Extractor.decodeBlocks(chunk, palette);
        int[] floor = Extractor.floors(chunk, maxY);
        boolean[] occluding = new boolean[palette.size()];
        byte[] fluids = new byte[palette.size()];
        for (int i = 0; i < occluding.length; i++) { occluding[i] = Extractor.isOccluding(palette.get(i)); fluids[i] = Extractor.fluid(palette.get(i)); }
        long[][] sides = new long[4][96];
        long[][] waterSides = new long[4][96], lavaSides = new long[4][96];
        for (int y = 0; y < 384; y++) {
            int section = y >>> 4, localY = y & 15, worldY = y - 64;
            if (worldY > maxY) continue;
            for (int t = 0; t < 16; t++) {
                int west = all[section][localY * 256 + t * 16];
                int east = all[section][localY * 256 + t * 16 + 15];
                int north = all[section][localY * 256 + t];
                int south = all[section][localY * 256 + 240 + t];
                int bit = y * 16 + t, word = bit >>> 6;
                long flag = 1L << (bit & 63);
                if (Extractor.occludes(west, occluding, floor, 0, t, worldY, hideCaves)) sides[WEST][word] |= flag;
                if (Extractor.occludes(east, occluding, floor, 15, t, worldY, hideCaves)) sides[EAST][word] |= flag;
                if (Extractor.occludes(north, occluding, floor, t, 0, worldY, hideCaves)) sides[NORTH][word] |= flag;
                if (Extractor.occludes(south, occluding, floor, t, 15, worldY, hideCaves)) sides[SOUTH][word] |= flag;
                if (fluids[west] == 1) waterSides[WEST][word] |= flag;
                if (fluids[east] == 1) waterSides[EAST][word] |= flag;
                if (fluids[north] == 1) waterSides[NORTH][word] |= flag;
                if (fluids[south] == 1) waterSides[SOUTH][word] |= flag;
                if (fluids[west] == 2) lavaSides[WEST][word] |= flag;
                if (fluids[east] == 2) lavaSides[EAST][word] |= flag;
                if (fluids[north] == 2) lavaSides[NORTH][word] |= flag;
                if (fluids[south] == 2) lavaSides[SOUTH][word] |= flag;
            }
        }
        masks[index] = sides;
        water[index] = waterSides; lava[index] = lavaSides;
    }

    public boolean neighbourOccludes(int index, int direction, int y, int coordinate) {
        return neighbourOccludes(index, direction, y, coordinate, (byte)0);
    }

    public boolean neighbourOccludes(int index, int direction, int y, int coordinate, byte fluid) {
        int neighbour;
        int opposite;
        switch (direction) {
            case WEST -> { neighbour = (index & 31) == 0 ? 1024 + WEST * 32 + (index >>> 5) : index - 1; opposite = EAST; }
            case EAST -> { neighbour = (index & 31) == 31 ? 1024 + EAST * 32 + (index >>> 5) : index + 1; opposite = WEST; }
            case NORTH -> { neighbour = index < 32 ? 1024 + NORTH * 32 + (index & 31) : index - 32; opposite = SOUTH; }
            case SOUTH -> { neighbour = index >= 992 ? 1024 + SOUTH * 32 + (index & 31) : index + 32; opposite = NORTH; }
            default -> throw new IllegalArgumentException("Unknown border direction");
        }
        long[][] sides = masks[neighbour];
        // An absent or non-full chunk is open space.
        if (sides == null) return false;
        int bit = y * 16 + coordinate;
        long flag = 1L << (bit & 63);
        return (sides[opposite][bit >>> 6] & flag) != 0 ||
            (fluid == 1 && (water[neighbour][opposite][bit >>> 6] & flag) != 0) ||
            (fluid == 2 && (lava[neighbour][opposite][bit >>> 6] & flag) != 0);
    }
}
