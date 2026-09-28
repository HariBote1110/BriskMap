package briskmap.extract;

public final class Section {
    public final int y;
    public final String[] blocks;
    public long[] blockData;
    public final String[] biomes;
    public final long[] biomeData;

    public Section(int y, String[] blocks, long[] blockData, String[] biomes, long[] biomeData) {
        this.y = y;
        this.blocks = blocks;
        this.blockData = blockData;
        this.biomes = biomes;
        this.biomeData = biomeData;
    }
}
