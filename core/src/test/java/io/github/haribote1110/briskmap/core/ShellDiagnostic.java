package io.github.haribote1110.briskmap.core;

import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import io.github.haribote1110.briskmap.core.extract.Extractor;
import io.github.haribote1110.briskmap.core.extract.Palette;
import io.github.haribote1110.briskmap.core.format.Reader;
import io.github.haribote1110.briskmap.core.region.Region;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.List;
import java.util.zip.Inflater;

/** Test-side flood-fill diagnostic for the four adjacent overworld fixtures. */
public final class ShellDiagnostic {
    private static final int WIDTH = 1024, PLANE = WIDTH * WIDTH, HEIGHT = 384;
    private static final int[] DX = {-1, 1, 0, 0, 0, 0};
    private static final int[] DY = {0, 0, -1, 1, 0, 0};
    private static final int[] DZ = {0, 0, 0, 0, -1, 1};
    private static final String[] DIRECTION = {"west", "east", "down", "up", "north", "south"};

    private ShellDiagnostic() { }

    public static void main(String[] arguments) throws Exception {
        Path input = Path.of(arguments[0]);
        BlockDefaults defaults = BlockDefaults.readJson(Path.of(arguments[1]));
        Source source = readSource(input, defaults);
        BitSet reached = flood(source);
        for (int i = 2; i < arguments.length; i += 2)
            report(arguments[i], Path.of(arguments[i + 1]), input, defaults, source, reached);
    }

    private record Source(BitSet nonair, BitSet solid, BitSet water, BitSet lava, int[] top, int[] floor) { }

    private static Source readSource(Path input, BlockDefaults defaults) throws Exception {
        Source source = new Source(new BitSet(PLANE * HEIGHT), new BitSet(PLANE * HEIGHT),
                new BitSet(PLANE * HEIGHT), new BitSet(PLANE * HEIGHT), new int[PLANE], new int[PLANE]);
        Arrays.fill(source.top, -1);
        Inflater inflater = new Inflater();
        Palette palette = new Palette();
        for (int rz = -1; rz <= 0; rz++) for (int rx = -1; rx <= 0; rx++) {
            Region region = new Region(input.resolve("r." + rx + "." + rz + ".mca"));
            for (int index = 0; index < 1024; index++) {
                Chunk chunk = region.read(index, inflater, defaults);
                if (chunk == null || !"minecraft:full".equals(chunk.status)) continue;
                int originX = (rx + 1) * 512 + (index & 31) * 16;
                int originZ = (rz + 1) * 512 + (index >>> 5) * 16;
                for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++)
                    source.floor[(originZ + z) * WIDTH + originX + x] = chunk.oceanFloor[z * 16 + x];
                int[][] decoded = Extractor.decodeBlocks(chunk, palette);
                boolean[] air = new boolean[palette.size()], solid = new boolean[palette.size()];
                byte[] fluid = new byte[palette.size()];
                for (int p = 0; p < palette.size(); p++) {
                    String state = palette.get(p);
                    air[p] = Extractor.isAir(state);
                    solid[p] = Extractor.isOccluding(state);
                    fluid[p] = (byte)(state.startsWith("minecraft:water") ? 1 : state.startsWith("minecraft:lava") ? 2 : 0);
                }
                for (int y = 0; y < HEIGHT; y++) {
                    int[] section = decoded[y >>> 4];
                    int local = (y & 15) * 256;
                    int plane = y * PLANE;
                    for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
                        int block = section[local + z * 16 + x];
                        if (air[block]) continue;
                        int column = (originZ + z) * WIDTH + originX + x;
                        int cell = plane + column;
                        source.nonair.set(cell);
                        source.top[column] = y;
                        if (solid[block]) source.solid.set(cell);
                        if (fluid[block] == 1) source.water.set(cell);
                        if (fluid[block] == 2) source.lava.set(cell);
                    }
                }
            }
        }
        inflater.end();
        return source;
    }

    private static BitSet flood(Source source) {
        BitSet reached = new BitSet(PLANE * HEIGHT);
        int[] frontier = new int[PLANE];
        int count = 0;
        for (int column = 0; column < PLANE; column++) {
            int x = column % WIDTH, z = column / WIDTH;
            for (int y = 0; y <= source.top[column]; y++) {
                int cell = y * PLANE + column;
                if (source.solid.get(cell)) continue;
                if (y == source.top[column] || x > 0 && y > source.top[column - 1]
                        || x + 1 < WIDTH && y > source.top[column + 1]
                        || z > 0 && y > source.top[column - WIDTH]
                        || z + 1 < WIDTH && y > source.top[column + WIDTH]) {
                    reached.set(cell);
                    if (count == frontier.length) frontier = Arrays.copyOf(frontier, count * 2);
                    frontier[count++] = cell;
                }
            }
        }
        for (int step = 2; step <= 32 && count > 0; step++) {
            int[] next = new int[Math.max(1024, count)];
            int nextCount = 0;
            for (int i = 0; i < count; i++) {
                int cell = frontier[i], y = cell / PLANE, column = cell % PLANE;
                int x = column % WIDTH, z = column / WIDTH;
                for (int direction = 0; direction < 6; direction++) {
                    int nx = x + DX[direction], ny = y + DY[direction], nz = z + DZ[direction];
                    if (nx < 0 || nx >= WIDTH || nz < 0 || nz >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
                    int neighbourColumn = nz * WIDTH + nx;
                    if (ny > source.top[neighbourColumn]) continue;
                    int neighbour = ny * PLANE + neighbourColumn;
                    if (source.solid.get(neighbour) || reached.get(neighbour)) continue;
                    reached.set(neighbour);
                    if (nextCount == next.length) next = Arrays.copyOf(next, nextCount * 2);
                    next[nextCount++] = neighbour;
                }
            }
            frontier = next;
            count = nextCount;
        }
        return reached;
    }

    private static void report(String label, Path output, Path input, BlockDefaults defaults,
            Source source, BitSet reached) throws Exception {
        long present = 0, missing = 0, seam = 0, seamWithoutHeuristic = 0, chunk = 0, canopy = 0;
        List<String> seamExamples = new ArrayList<>(), chunkExamples = new ArrayList<>(), canopyExamples = new ArrayList<>();
        Inflater inflater = new Inflater();
        for (int rz = -1; rz <= 0; rz++) for (int rx = -1; rx <= 0; rx++) {
            String base = "r." + rx + "." + rz;
            Region region = new Region(input.resolve(base + ".mca"));
            Reader reader = new Reader(output.resolve(base + ".b3d"));
            for (int index = 0; index < 1024; index++) {
                Chunk current = region.read(index, inflater, defaults);
                if (current == null || !"minecraft:full".equals(current.status)) continue;
                Extracted3d shell = reader.read3d(index);
                if (shell == null) continue;
                present += shell.faces;
                int originX = (rx + 1) * 512 + (index & 31) * 16;
                int originZ = (rz + 1) * 512 + (index >>> 5) * 16;
                for (int sy = 0; sy < 24; sy++) {
                    byte[] masks = new byte[4096];
                    for (int i = 0; i < shell.positions[sy].length; i++) masks[shell.positions[sy][i]] = shell.masks[sy][i];
                    for (int position = 0; position < 4096; position++) {
                        int y = sy * 16 + (position >>> 8), z = originZ + (position >>> 4 & 15), x = originX + (position & 15);
                        int cell = y * PLANE + z * WIDTH + x;
                        if (!source.nonair.get(cell)) continue;
                        for (int direction = 0; direction < 6; direction++) {
                            if ((masks[position] & 1 << direction) != 0) continue;
                            int nx = x + DX[direction], ny = y + DY[direction], nz = z + DZ[direction];
                            if (nx < 0 || nx >= WIDTH || nz < 0 || nz >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
                            int neighbourColumn = nz * WIDTH + nx, neighbour = ny * PLANE + neighbourColumn;
                            if (source.solid.get(neighbour) || source.water.get(cell) && source.water.get(neighbour)
                                    || source.lava.get(cell) && source.lava.get(neighbour)) continue;
                            if (ny <= source.top[neighbourColumn] && !reached.get(neighbour)) continue;
                            missing++;
                            String example = "(" + (x - 512) + "," + (y - 64) + "," + (z - 512) + "," + DIRECTION[direction] + ")";
                            boolean regionSeam = direction == 0 && x == 512 || direction == 1 && x == 511
                                    || direction == 4 && z == 512 || direction == 5 && z == 511;
                            boolean chunkSeam = direction == 0 && (x & 15) == 0 || direction == 1 && (x & 15) == 15
                                    || direction == 4 && (z & 15) == 0 || direction == 5 && (z & 15) == 15;
                            boolean hiddenByHeuristic = ny - 64 < 55 && ny - 64 < source.floor[neighbourColumn] - 65;
                            if (regionSeam) {
                                seam++; add(seamExamples, example);
                                if (!hiddenByHeuristic) seamWithoutHeuristic++;
                            }
                            else if (chunkSeam) { chunk++; add(chunkExamples, example); }
                            if (hiddenByHeuristic) {
                                canopy++; add(canopyExamples, example);
                            }
                        }
                    }
                }
            }
        }
        inflater.end();
        System.out.println(label + " present=" + present + " sky_visible_missing=" + missing
                + " region_seam=" + seam + " region_seam_without_heuristic=" + seamWithoutHeuristic
                + " chunk_seam=" + chunk + " under_canopy=" + canopy);
        System.out.println(label + " region_seam_examples=" + seamExamples);
        System.out.println(label + " chunk_seam_examples=" + chunkExamples);
        System.out.println(label + " under_canopy_examples=" + canopyExamples);
        if (seamWithoutHeuristic != 0) throw new AssertionError("Unexpected region seam faces are missing: " + seamWithoutHeuristic);
    }

    private static void add(List<String> examples, String example) {
        if (examples.size() < 10) examples.add(example);
    }
}
