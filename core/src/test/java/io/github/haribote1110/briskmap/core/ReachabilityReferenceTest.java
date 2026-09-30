package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Reachability;
import io.github.haribote1110.briskmap.core.extract.Section;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class ReachabilityReferenceTest {
    private static final int WIDTH = 48, PLANE = WIDTH * WIDTH, HEIGHT = 384;
    private static final String[] STATES = {"minecraft:stone", "minecraft:air", "minecraft:glass", "minecraft:water"};

    @Test void geometryMatchesAnIndependentMultiSourceSearchAtChunkRegionAndCornerSeams() {
        for (int centreX : new int[]{0, 31}) for (int centreZ : new int[]{0, 31})
            for (int cut : new int[]{Integer.MAX_VALUE, 10}) compare(centreX, centreZ, cut);
    }

    private static void compare(int centreX, int centreZ, int cut) {
        byte[] blocks = new byte[PLANE * HEIGHT];
        int[] floors = new int[PLANE];
        Reachability actual = new Reachability(cut);
        for (int cz = 0; cz < 3; cz++) for (int cx = 0; cx < 3; cx++) {
            Chunk chunk = new Chunk();
            chunk.status = "minecraft:full";
            chunk.oceanFloor = new int[256];
            long[] packed = new long[256];
            for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
                int gx = cx * 16 + x, gz = cz * 16 + z, column = gz * WIDTH + gx;
                chunk.oceanFloor[z * 16 + x] = gx < 20 ? 76 : 80;
                for (int y = 0; y < 16; y++) {
                    byte type = block(gx, gz, y);
                    blocks[(y + 64) * PLANE + column] = type;
                    int position = y * 256 + z * 16 + x;
                    packed[position >>> 4] |= (long)type << ((position & 15) * 4);
                }
                if (cut == Integer.MAX_VALUE) floors[column] = chunk.oceanFloor[z * 16 + x] - 1;
                else {
                    int highest = -65;
                    for (int y = Math.min(15, cut); y >= 0; y--)
                        if (blocks[(y + 64) * PLANE + column] == 0) { highest = y; break; }
                    floors[column] = highest == -65 ? 0 : highest + 64;
                }
            }
            chunk.sections[4] = new Section(0, STATES, packed, new String[]{"minecraft:plains"}, null);
            actual.put(centreX + cx - 1, centreZ + cz - 1, chunk);
        }
        actual.flood(16);
        boolean[] expected = reference(blocks, floors, cut);
        for (int y = 0; y < HEIGHT; y++) for (int z = 16; z < 32; z++) for (int x = 16; x < 32; x++) {
            int cell = y * PLANE + z * WIDTH + x;
            assertEquals(expected[cell], actual.reached(centreX, centreZ, x - 16, z - 16, y),
                    "chunk=" + centreX + "," + centreZ + " cut=" + cut + " cell=" + x + "," + y + "," + z);
        }
    }

    private static byte block(int x, int z, int y) {
        if (y == 5 && z == 24) return 1; // A tunnel longer than the bound.
        if (x >= 19 && x <= 29 && z >= 19 && z <= 29 && y >= 9 && y <= 14) return 1;
        if (y == 15 && x >= 19 && x <= 29 && z >= 19 && z <= 29)
            return (byte)(x == 23 ? 2 : x == 24 ? 3 : x == 25 ? 1 : 0);
        if (y == 8 && x == z) return 1;
        return 0;
    }

    private static boolean[] reference(byte[] blocks, int[] floors, int cut) {
        boolean[] open = new boolean[PLANE * HEIGHT], reached = new boolean[open.length];
        byte[] distance = new byte[open.length];
        Arrays.fill(distance, (byte)-1);
        int[] queue = new int[open.length];
        int end = 0;
        for (int y = 0; y < HEIGHT; y++) for (int column = 0; column < PLANE; column++) {
            int cell = y * PLANE + column;
            open[cell] = y < 64 || y >= 80 || y - 64 > cut || blocks[cell] != 0;
            if (open[cell] && y >= floors[column]) {
                reached[cell] = true; distance[cell] = 0; queue[end++] = cell;
            }
        }
        int begin = 0;
        while (begin < end) {
            int cell = queue[begin++], y = cell / PLANE, column = cell % PLANE;
            if (distance[cell] >= 16) continue;
            int x = column % WIDTH, z = column / WIDTH;
            for (int direction = 0; direction < 6; direction++) {
                int nx = x + new int[]{-1, 1, 0, 0, 0, 0}[direction];
                int nz = z + new int[]{0, 0, -1, 1, 0, 0}[direction];
                int ny = y + new int[]{0, 0, 0, 0, -1, 1}[direction];
                if (nx < 0 || nx >= WIDTH || nz < 0 || nz >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
                int neighbour = ny * PLANE + nz * WIDTH + nx;
                if (!open[neighbour] || reached[neighbour]) continue;
                reached[neighbour] = true;
                distance[neighbour] = (byte)(distance[cell] + 1);
                queue[end++] = neighbour;
            }
        }
        for (int y = 119; y < HEIGHT; y++) for (int column = 0; column < PLANE; column++) {
            int cell = y * PLANE + column;
            reached[cell] |= open[cell];
        }
        return reached;
    }
}
