package briskmap.extract;

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

    public static Extracted2d extract2d(Chunk chunk, Palette blocks, Palette biomes) {
        if (chunk.worldSurface == null || chunk.oceanFloor == null) throw new IllegalArgumentException("Missing heightmap");
        Extracted2d result = new Extracted2d();
        for (int col = 0; col < 256; col++) {
            int value = chunk.worldSurface[col];
            if (value == 0) { result.y[col] = EMPTY_Y; result.block[col] = blocks.index("minecraft:air"); result.biome[col] = biomes.index("minecraft:plains"); continue; }
            int y = value - 65;
            if (y < -64 || y > 319) throw new IllegalArgumentException("Invalid surface height " + y);
            int x = col & 15, z = col >>> 4, sy = (y + 64) >>> 4;
            Section section = chunk.sections[sy];
            String state = block(section, ((y + 64) & 15) * 256 + z * 16 + x);
            if (isAir(state)) throw new IllegalArgumentException("Heightmap points to air at " + col + "," + y);
            result.y[col] = (short)y;
            result.block[col] = blocks.index(state);
            int depth = name(state).equals("minecraft:water") ? y - (chunk.oceanFloor[col] - 65) : 0;
            result.depth[col] = (byte)Math.max(0, Math.min(255, depth));
            int biomeIndex = (((y + 64) & 15) >>> 2) * 16 + (z >>> 2) * 4 + (x >>> 2);
            result.biome[col] = biomes.index(biome(section, biomeIndex));
        }
        return result;
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
        int[][] all = decodeBlocks(chunk, palette);
        boolean[] occluding = new boolean[palette.size()];
        boolean[] air = new boolean[palette.size()];
        for (int i = 0; i < palette.size(); i++) { String state = palette.get(i); occluding[i] = isOccluding(state); air[i] = isAir(state); }
        Extracted3d result = new Extracted3d();
        for (int sy = 0; sy < 24; sy++) {
            Section section = chunk.sections[sy];
            if (section == null || section.blocks == null || section.blocks.length == 1 && air[all[sy][0]]) continue;
            int[] positions = new int[4096], blocks = new int[4096];
            int count = 0;
            boolean solidSingle = section.blocks.length == 1 && occluding[all[sy][0]];
            for (int p = 0; p < 4096; p++) {
                int block = all[sy][p];
                if (air[block]) continue;
                result.nonair++;
                int y = p >>> 8, z = (p >>> 4) & 15, x = p & 15;
                if (solidSingle && x > 0 && x < 15 && z > 0 && z < 15 && y > 0 && y < 15) continue;
                int worldY = sy * 16 + y - 64;
                int fullY = sy * 16 + y;
                boolean west = x == 0 ? borders.neighbourOccludes(index, BorderCache.WEST, fullY, z) : occludes(all[sy][p - 1], occluding, chunk.oceanFloor, x - 1, z, worldY, hideCaves);
                boolean east = x == 15 ? borders.neighbourOccludes(index, BorderCache.EAST, fullY, z) : occludes(all[sy][p + 1], occluding, chunk.oceanFloor, x + 1, z, worldY, hideCaves);
                boolean north = z == 0 ? borders.neighbourOccludes(index, BorderCache.NORTH, fullY, x) : occludes(all[sy][p - 16], occluding, chunk.oceanFloor, x, z - 1, worldY, hideCaves);
                boolean south = z == 15 ? borders.neighbourOccludes(index, BorderCache.SOUTH, fullY, x) : occludes(all[sy][p + 16], occluding, chunk.oceanFloor, x, z + 1, worldY, hideCaves);
                boolean below = fullY == 0 ? false : y == 0 ? occludes(all[sy - 1][p + 3840], occluding, chunk.oceanFloor, x, z, worldY - 1, hideCaves) : occludes(all[sy][p - 256], occluding, chunk.oceanFloor, x, z, worldY - 1, hideCaves);
                boolean above = fullY == 383 ? false : y == 15 ? occludes(all[sy + 1][p - 3840], occluding, chunk.oceanFloor, x, z, worldY + 1, hideCaves) : occludes(all[sy][p + 256], occluding, chunk.oceanFloor, x, z, worldY + 1, hideCaves);
                if (!west || !east || !north || !south || !below || !above) {
                    positions[count] = p; blocks[count] = block; count++;
                }
            }
            result.positions[sy] = Arrays.copyOf(positions, count);
            result.blocks[sy] = Arrays.copyOf(blocks, count);
        }
        return result;
    }

}
