package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.haribote1110.briskmap.core.extract.BorderCache;
import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Palette;
import io.github.haribote1110.briskmap.core.extract.Section;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class BorderCacheTest {
    @Test void adjacentEdgeMatchesInRegionOcclusionForEveryCell() {
        Chunk chunk = new Chunk();
        chunk.status = "minecraft:full";
        chunk.oceanFloor = new int[256];
        Arrays.fill(chunk.oceanFloor, 80);
        long[] data = new long[256];
        set(data, 8, 8, 15, 1);
        set(data, 8, 8, 0, 2);
        set(data, 8, 0, 8, 3);
        chunk.sections[4] = new Section(0, new String[]{"minecraft:stone", "minecraft:air", "minecraft:water", "minecraft:lava"},
                data, new String[]{"minecraft:plains"}, null);
        for (boolean hide : new boolean[]{false, true}) for (int maxY : new int[]{Integer.MAX_VALUE, 8})
            for (int side = 0; side < 4; side++) {
                int neighbour = side == BorderCache.WEST || side == BorderCache.NORTH ? 0 : side == BorderCache.EAST ? 1 : 32;
                int own = side == BorderCache.WEST ? 1 : side == BorderCache.EAST ? 0 : side == BorderCache.NORTH ? 32 : 0;
                BorderCache interior = new BorderCache(), adjacent = new BorderCache();
                interior.put(neighbour, chunk, new Palette(), hide, maxY);
                adjacent.putAdjacent(side, 8, chunk, hide, maxY);
                for (int y = 0; y < 384; y++) for (int coordinate = 0; coordinate < 16; coordinate++)
                    for (byte fluid = 0; fluid <= 2; fluid++)
                        assertEquals(interior.neighbourOccludes(own, side, y, coordinate, fluid),
                                adjacent.neighbourOccludes(side == BorderCache.WEST ? 8 * 32
                                        : side == BorderCache.EAST ? 8 * 32 + 31
                                        : side == BorderCache.NORTH ? 8 : 992 + 8,
                                        side, y, coordinate, fluid),
                                "side=" + side + " y=" + y + " coordinate=" + coordinate + " fluid=" + fluid);
            }
    }

    private static void set(long[] data, int y, int z, int x, int block) {
        int position = y * 256 + z * 16 + x;
        data[position / 16] |= (long)block << (position % 16 * 4);
    }
}
