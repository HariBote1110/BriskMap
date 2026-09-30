package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Reachability;
import io.github.haribote1110.briskmap.core.extract.Section;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class ReachabilityTest {
    @Test void aTunnelStopsAtTheDepthAcrossAChunkBorder() {
        Reachability reach = new Reachability(Integer.MAX_VALUE);
        reach.put(0, 0, tunnel());
        reach.put(1, 0, tunnel());
        reach.put(2, 0, tunnel());
        reach.flood(16);
        assertTrue(reach.reached(0, 0, 15, 8, 64 + 5));
        assertFalse(reach.reached(1, 0, 0, 8, 64 + 5));
    }

    private static Chunk tunnel() {
        Chunk chunk = new Chunk();
        chunk.status = "minecraft:full";
        chunk.oceanFloor = new int[256];
        Arrays.fill(chunk.oceanFloor, 80);
        long[] packed = new long[256];
        for (int y = 0; y < 16; y++) for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            if (y == 5 && z == 8) {
                int at = y * 256 + z * 16 + x;
                packed[at >>> 4] |= 1L << ((at & 15) * 4);
            }
        }
        chunk.sections[4] = new Section(0, new String[]{"minecraft:stone", "minecraft:air"}, packed,
                new String[]{"minecraft:plains"}, null);
        return chunk;
    }
}
