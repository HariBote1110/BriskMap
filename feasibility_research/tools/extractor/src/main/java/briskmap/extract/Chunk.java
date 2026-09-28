package briskmap.extract;

public final class Chunk {
    public int dataVersion, xPos, zPos;
    public String status;
    public int sectionCount, sectionMinY = Integer.MAX_VALUE, sectionMaxY = Integer.MIN_VALUE;
    public int[] worldSurface, oceanFloor;
    public Section[] sections = new Section[24];
}
