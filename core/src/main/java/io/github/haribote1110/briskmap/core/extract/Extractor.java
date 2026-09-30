package io.github.haribote1110.briskmap.core.extract;


import java.util.Arrays;

public final class Extractor {
    public static final short EMPTY_Y = Short.MIN_VALUE;
    private static final String[] NON_OCCLUDING = {
        "water", "lava", "glass", "leaves", "slab", "stairs", "fence", "wall", "pane", "door", "trapdoor", "torch", "sign", "carpet", "rail", "button", "pressure_plate", "flower", "sapling", "grass", "fern", "vine", "kelp", "seagrass", "sugar_cane", "bamboo", "mushroom", "snow", "lantern", "chain", "ladder", "banner", "bed", "candle", "azalea", "dripleaf", "lichen", "roots", "sprouts", "coral", "wheat", "carrots", "potatoes", "beetroots", "cactus", "cobweb", "bars", "scaffolding", "pointed_dripstone", "amethyst_cluster", "bud", "head", "skull", "pot", "anvil", "bell", "lectern", "grindstone", "stonecutter", "campfire", "chest", "hopper", "brewing_stand", "cauldron", "composter", "end_rod", "lightning_rod", "powder_snow",
        "dandelion", "poppy", "orchid", "allium", "azure_bluet", "tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley", "wither_rose", "sunflower", "lilac", "rose_bush", "peony", "torchflower", "pitcher_plant", "pitcher_crop", "pink_petals", "bush", "leaf_litter", "wildflowers", "lily_pad", "hanging_roots", "spore_blossom", "cave_vines", "cave_vines_plant", "twisting_vines", "weeping_vines", "fungus", "pickle", "frogspawn", "eyeblossom", "dry_grass", "cactus_flower", "potted", "sweet_berry_bush", "nether_wart", "cocoa", "melon_stem", "pumpkin_stem", "attached_melon_stem", "attached_pumpkin_stem", "tripwire", "redstone_wire", "repeater", "comparator", "lever", "conduit", "heavy_core", "decorated_pot", "sniffer_egg", "turtle_egg", "sea_pickle", "big_dripleaf", "small_dripleaf", "bubble_column", "structure_void", "light", "barrier"
    };

    private Extractor() {}

    public static boolean isAir(String state) {
        String name = name(state);
        return name.equals("minecraft:air") || name.equals("minecraft:cave_air") || name.equals("minecraft:void_air");
    }
    private static String name(String state) { int end = state.indexOf('['); return end < 0 ? state : state.substring(0, end); }
    static byte fluid(String state) {
        String block = name(state);
        return (byte)(block.equals("minecraft:water") ? 1 : block.equals("minecraft:lava") ? 2 : 0);
    }
    public static boolean isOccluding(String state) {
        if (isAir(state)) return false;
        String block = name(state);
        if (!block.startsWith("minecraft:")) return true;
        String path = block.substring(10);
        if (path.equals("grass_block") || path.equals("snow_block") || path.endsWith("mushroom_block") || path.equals("mushroom_stem") || path.endsWith("coral_block") || path.endsWith("command_block") || path.equals("bedrock")) return true;
        for (String part : NON_OCCLUDING) {
            if (part.equals("potted") ? path.startsWith("potted_") : matchesToken(path, part)) return false;
        }
        return true;
    }

    private static boolean matchesToken(String path, String word) {
        return path.equals(word) || path.startsWith(word + "_") || path.endsWith("_" + word) || path.contains("_" + word + "_");
    }

    static boolean occludes(int block, boolean[] occluding, int[] floor, int x, int z, int y, boolean hideCaves) {
        return occluding[block] || hideCaves && y < 55 && y < floor[z * 16 + x] - 65;
    }

    private static boolean occludes(int block, boolean[] occluding, byte[] fluids, byte fluid, int[] floor, int x, int z, int y, boolean hideCaves) {
        return occludes(block, occluding, floor, x, z, y, hideCaves) || fluid != 0 && fluids[block] == fluid;
    }

    public static Extracted2d extract2d(Chunk chunk, Palette blocks, Palette biomes) {
        return extract2d(chunk, blocks, biomes, Integer.MAX_VALUE);
    }

    public static Extracted2d extract2d(Chunk chunk, Palette blocks, Palette biomes, int maxY) {
        if (maxY == Integer.MAX_VALUE && (chunk.worldSurface == null || chunk.oceanFloor == null)) throw new IllegalArgumentException("Missing heightmap");
        Extracted2d result = new Extracted2d();
        for (int col = 0; col < 256; col++) {
            int x = col & 15, z = col >>> 4;
            int value = maxY == Integer.MAX_VALUE ? chunk.worldSurface[col] : top(chunk, x, z, maxY) + 65;
            if (value == 0) { result.y[col] = EMPTY_Y; result.block[col] = blocks.index("minecraft:air"); result.biome[col] = biomes.index("minecraft:plains"); continue; }
            int y = value - 65;
            if (y < -64 || y > 319) throw new IllegalArgumentException("Invalid surface height " + y);
            int sy = (y + 64) >>> 4;
            Section section = chunk.sections[sy];
            String state = block(section, ((y + 64) & 15) * 256 + z * 16 + x);
            while (isAir(state) && y > -64) {
                y--;
                sy = (y + 64) >>> 4;
                section = chunk.sections[sy];
                state = block(section, ((y + 64) & 15) * 256 + z * 16 + x);
            }
            if (isAir(state)) { result.y[col] = EMPTY_Y; result.block[col] = blocks.index("minecraft:air"); result.biome[col] = biomes.index("minecraft:plains"); continue; }
            result.y[col] = (short)y;
            result.block[col] = blocks.index(state);
            int depth = name(state).equals("minecraft:water") ? y - ((maxY == Integer.MAX_VALUE ? chunk.oceanFloor[col] : floor(chunk, x, z, maxY)) - 65) : 0;
            result.depth[col] = (byte)Math.max(0, Math.min(255, depth));
            int biomeIndex = (((y + 64) & 15) >>> 2) * 16 + (z >>> 2) * 4 + (x >>> 2);
            result.biome[col] = biomes.index(biome(section, biomeIndex));
        }
        return result;
    }

    private static int top(Chunk chunk, int x, int z, int maxY) {
        for (int y = Math.min(319, maxY); y >= -64; y--)
            if (!isAir(block(chunk.sections[(y + 64) >>> 4], ((y + 64) & 15) * 256 + z * 16 + x))) return y;
        return -65;
    }

    public static int floor(Chunk chunk, int x, int z, int maxY) {
        for (int y = Math.min(319, maxY); y >= -64; y--)
            if (isOccluding(block(chunk.sections[(y + 64) >>> 4], ((y + 64) & 15) * 256 + z * 16 + x))) return y + 65;
        return 0;
    }

    public static int[] floors(Chunk chunk, int maxY) {
        if (maxY == Integer.MAX_VALUE) return chunk.oceanFloor;
        int[] values = new int[256];
        for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) values[z * 16 + x] = floor(chunk, x, z, maxY);
        return values;
    }

    private static String block(Section section, int index) {
        if (section == null || section.blocks == null || section.blocks.length == 0) return "minecraft:air";
        return section.blocks[Bits.get(section.blockData, Bits.width(section.blocks.length, 4), index)];
    }
    private static String biome(Section section, int index) {
        if (section == null || section.biomes == null || section.biomes.length == 0) throw new IllegalArgumentException("Missing surface biome");
        return section.biomes[Bits.get(section.biomeData, Bits.width(section.biomes.length, 0), index)];
    }

    public static int[][] decodeBlocks(Chunk chunk, Palette palette) {
        int[][] all = new int[24][4096];
        int air = palette.index("minecraft:air");
        for (int sy = 0; sy < 24; sy++) {
            Section section = chunk.sections[sy];
            if (section == null || section.blocks == null || section.blocks.length == 0) { Arrays.fill(all[sy], air); continue; }
            int[] local = new int[section.blocks.length];
            for (int i = 0; i < local.length; i++) local[i] = palette.index(section.blocks[i]);
            if (local.length == 1) Arrays.fill(all[sy], local[0]);
            else {
                int width = Bits.width(local.length, 4);
                for (int i = 0; i < 4096; i++) all[sy][i] = local[Bits.get(section.blockData, width, i)];
            }
        }
        return all;
    }

    public static Extracted3d extract3d(Chunk chunk, Palette palette, BorderCache borders, int index, boolean hideCaves) {
        return extract3d(chunk, palette, borders, index, hideCaves, false);
    }

    public static Extracted3d extract3d(Chunk chunk, Palette palette, BorderCache borders, int index, boolean hideCaves, boolean surfaceFluids) {
        return extract3d(chunk, palette, borders, index, hideCaves, surfaceFluids, Integer.MAX_VALUE);
    }

    public static Extracted3d extract3d(Chunk chunk, Palette palette, BorderCache borders, int index, boolean hideCaves, boolean surfaceFluids, int maxY) {
        return extract3d(chunk, palette, borders, index, hideCaves, surfaceFluids, maxY, null);
    }

    public static Extracted3d extract3d(Chunk chunk, Palette palette, BorderCache borders, int index, boolean hideCaves, boolean surfaceFluids, int maxY, Reachability reach) {
        int[][] all = decodeBlocks(chunk, palette);
        int[] floor = reach == null ? floors(chunk, maxY) : null;
        boolean[] occluding = new boolean[palette.size()];
        boolean[] air = new boolean[palette.size()];
        byte[] fluids = new byte[palette.size()];
        for (int i = 0; i < palette.size(); i++) { String state = palette.get(i); occluding[i] = isOccluding(state); air[i] = isAir(state); fluids[i] = fluid(state); }
        Extracted3d result = new Extracted3d();
        for (int sy = 0; sy < 24; sy++) {
            Section section = chunk.sections[sy];
            if (section == null || section.blocks == null || section.blocks.length == 1 && air[all[sy][0]]) continue;
            int[] positions = new int[4096], blocks = new int[4096];
            byte[] masks = new byte[4096];
            int count = 0;
            boolean solidSingle = section.blocks.length == 1 && occluding[all[sy][0]];
            for (int p = 0; p < 4096; p++) {
                int block = all[sy][p];
                int y = p >>> 8, z = (p >>> 4) & 15, x = p & 15;
                int worldY = sy * 16 + y - 64;
                if (air[block] || worldY > maxY) continue;
                result.nonair++;
                if (solidSingle && x > 0 && x < 15 && z > 0 && z < 15 && y > 0 && y < 15 && worldY != maxY) continue;
                int fullY = sy * 16 + y;
                byte currentFluid = surfaceFluids ? fluids[block] : 0;
                int cx = index & 31, cz = index >>> 5;
                boolean west = reach != null ? !reach.reached(cx, cz, x - 1, z, fullY) || (x == 0
                        ? borders.neighbourSameFluid(index, BorderCache.WEST, fullY, z, currentFluid)
                        : currentFluid != 0 && fluids[all[sy][p - 1]] == currentFluid)
                        : x == 0 ? borders.neighbourOccludes(index, BorderCache.WEST, fullY, z, currentFluid) : occludes(all[sy][p - 1], occluding, fluids, currentFluid, floor, x - 1, z, worldY, hideCaves);
                boolean east = reach != null ? !reach.reached(cx, cz, x + 1, z, fullY) || (x == 15
                        ? borders.neighbourSameFluid(index, BorderCache.EAST, fullY, z, currentFluid)
                        : currentFluid != 0 && fluids[all[sy][p + 1]] == currentFluid)
                        : x == 15 ? borders.neighbourOccludes(index, BorderCache.EAST, fullY, z, currentFluid) : occludes(all[sy][p + 1], occluding, fluids, currentFluid, floor, x + 1, z, worldY, hideCaves);
                boolean north = reach != null ? !reach.reached(cx, cz, x, z - 1, fullY) || (z == 0
                        ? borders.neighbourSameFluid(index, BorderCache.NORTH, fullY, x, currentFluid)
                        : currentFluid != 0 && fluids[all[sy][p - 16]] == currentFluid)
                        : z == 0 ? borders.neighbourOccludes(index, BorderCache.NORTH, fullY, x, currentFluid) : occludes(all[sy][p - 16], occluding, fluids, currentFluid, floor, x, z - 1, worldY, hideCaves);
                boolean south = reach != null ? !reach.reached(cx, cz, x, z + 1, fullY) || (z == 15
                        ? borders.neighbourSameFluid(index, BorderCache.SOUTH, fullY, x, currentFluid)
                        : currentFluid != 0 && fluids[all[sy][p + 16]] == currentFluid)
                        : z == 15 ? borders.neighbourOccludes(index, BorderCache.SOUTH, fullY, x, currentFluid) : occludes(all[sy][p + 16], occluding, fluids, currentFluid, floor, x, z + 1, worldY, hideCaves);
                boolean below = fullY == 0 ? false : reach != null ? !reach.reached(cx, cz, x, z, fullY - 1)
                        || currentFluid != 0 && fluids[y == 0 ? all[sy - 1][p + 3840] : all[sy][p - 256]] == currentFluid
                        : y == 0 ? occludes(all[sy - 1][p + 3840], occluding, fluids, currentFluid, floor, x, z, worldY - 1, hideCaves) : occludes(all[sy][p - 256], occluding, fluids, currentFluid, floor, x, z, worldY - 1, hideCaves);
                boolean above = fullY == 383 || worldY == maxY ? false : reach != null ? !reach.reached(cx, cz, x, z, fullY + 1)
                        || currentFluid != 0 && fluids[y == 15 ? all[sy + 1][p - 3840] : all[sy][p + 256]] == currentFluid
                        : y == 15 ? occludes(all[sy + 1][p - 3840], occluding, fluids, currentFluid, floor, x, z, worldY + 1, hideCaves) : occludes(all[sy][p + 256], occluding, fluids, currentFluid, floor, x, z, worldY + 1, hideCaves);
                int mask = (west ? 0 : 1) | (east ? 0 : 2) | (below ? 0 : 4) | (above ? 0 : 8) | (north ? 0 : 16) | (south ? 0 : 32);
                if (mask != 0) {
                    positions[count] = p; blocks[count] = block; masks[count] = (byte)mask; count++;
                    result.faces += Integer.bitCount(mask);
                    if (fluids[block] != 0) result.shellFluidBlocks++;
                }
            }
            result.positions[sy] = Arrays.copyOf(positions, count);
            result.blocks[sy] = Arrays.copyOf(blocks, count);
            result.masks[sy] = Arrays.copyOf(masks, count);
        }
        return result;
    }

}
