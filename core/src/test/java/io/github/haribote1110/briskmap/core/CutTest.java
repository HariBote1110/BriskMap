package io.github.haribote1110.briskmap.core;

import io.github.haribote1110.briskmap.core.extract.BorderCache;
import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Extracted2d;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import io.github.haribote1110.briskmap.core.extract.Extractor;
import io.github.haribote1110.briskmap.core.extract.Palette;
import io.github.haribote1110.briskmap.core.extract.Section;
import java.util.Arrays;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CutTest {
    private static final String[] STATES = {"minecraft:air", "minecraft:stone", "minecraft:water[level=0]"};

    @Test void cutMatchesIndependentVolumeScan() {
        int[][] cells = new int[24][4096];
        for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            for (int y = 120; y <= 127; y++) set(cells, x, y, z, 1);
            set(cells, x, 80, z, 1);
        }
        for (int y = 91; y <= 100; y++) set(cells, 1, y, 1, 2);
        set(cells, 1, 90, 1, 1);
        for (int z = 4; z <= 6; z++) for (int x = 4; x <= 6; x++) set(cells, x, 100, z, 1);
        set(cells, 8, 40, 8, 1);
        Chunk chunk = new Chunk(); chunk.status = "minecraft:full";
        chunk.worldSurface = new int[256]; chunk.oceanFloor = new int[256];
        Arrays.fill(chunk.worldSurface, 193); Arrays.fill(chunk.oceanFloor, 193);
        for (int sy = 0; sy < 24; sy++) {
            if (Arrays.stream(cells[sy]).allMatch(id -> id == 0)) continue;
            long[] packed = new long[256];
            for (int p = 0; p < 4096; p++) packed[p / 16] |= (long)cells[sy][p] << ((p % 16) * 4);
            chunk.sections[sy] = new Section(sy - 4, STATES, packed, new String[]{"minecraft:plains"}, null);
        }
        Palette palette = new Palette(), biomes = new Palette();
        BorderCache borders = new BorderCache();
        borders.put(33, chunk, palette, true, 100);
        Extracted2d surface = Extractor.extract2d(chunk, palette, biomes, 100);
        Extracted3d shell = Extractor.extract3d(chunk, palette, borders, 33, true, true, 100);
        for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
            int col = z * 16 + x;
            int top = -65, floor = -64;
            for (int y = 100; y >= -64; y--) {
                int id = get(cells, x, y, z);
                if (top == -65 && id != 0) top = y;
                if (floor == -64 && id == 1) floor = y + 1;
            }
            assertEquals(top == -65 ? Extractor.EMPTY_Y : top, surface.y[col]);
            if (top >= -64) assertEquals(STATES[get(cells, x, top, z)], palette.get(surface.block[col]));
            assertEquals(get(cells, x, top, z) == 2 ? top - floor + 1 : 0, Byte.toUnsignedInt(surface.depth[col]));
            assertEquals(floor + 64, Extractor.floor(chunk, x, z, 100));
        }
        for (int sy = 0; sy < 24; sy++) {
            int cursor = 0;
            for (int p = 0; p < 4096; p++) {
                int y = sy * 16 + (p >>> 8) - 64, z = (p >>> 4) & 15, x = p & 15;
                int id = cells[sy][p];
                if (id == 0 || y > 100) continue;
                int floor = -64;
                for (int below = 100; below >= -64; below--) if (get(cells, x, below, z) == 1) { floor = below + 1; break; }
                int mask = 0;
                int[][] neighbours = {{x-1,y,z},{x+1,y,z},{x,y-1,z},{x,y+1,z},{x,y,z-1},{x,y,z+1}};
                for (int side = 0; side < 6; side++) {
                    int nx = neighbours[side][0], ny = neighbours[side][1], nz = neighbours[side][2];
                    int neighbour = ny < -64 || ny > 100 || nx < 0 || nx > 15 || nz < 0 || nz > 15 ? 0 : get(cells,nx,ny,nz);
                    boolean outside = nx < 0 || nx > 15 || nz < 0 || nz > 15;
                    int neighbourFloor = -64;
                    if (!outside && ny >= -64 && ny <= 100) for (int below = 100; below >= -64; below--)
                        if (get(cells,Math.max(0,Math.min(15,nx)),below,Math.max(0,Math.min(15,nz))) == 1) { neighbourFloor = below + 1; break; }
                    boolean hidden = neighbour == 1 || (ny < 55 && ny < neighbourFloor) || (id == 2 && neighbour == 2);
                    if (!hidden) mask |= 1 << side;
                }
                if (mask != 0) {
                    assertEquals(p, shell.positions[sy][cursor], "position " + sy + "/" + p);
                    assertEquals(STATES[id], palette.get(shell.blocks[sy][cursor]));
                    assertEquals(mask, Byte.toUnsignedInt(shell.masks[sy][cursor]));
                    cursor++;
                }
            }
            assertEquals(cursor, shell.positions[sy].length, "section " + sy);
        }
        int plane = ((100 + 64) & 15) * 256 + 5 * 16 + 5;
        int sy = (100 + 64) >>> 4;
        int index = Arrays.binarySearch(shell.positions[sy], plane);
        assertTrue(index >= 0);
        assertTrue((shell.masks[sy][index] & 8) != 0);
    }

    private static void set(int[][] cells, int x, int y, int z, int state) {
        cells[(y + 64) >>> 4][((y + 64) & 15) * 256 + z * 16 + x] = state;
    }
    private static int get(int[][] cells, int x, int y, int z) {
        if (y < -64) return 0;
        return cells[(y + 64) >>> 4][((y + 64) & 15) * 256 + z * 16 + x];
    }
}
