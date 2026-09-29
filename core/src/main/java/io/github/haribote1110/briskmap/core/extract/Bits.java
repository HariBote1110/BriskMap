package io.github.haribote1110.briskmap.core.extract;


public final class Bits {
    private Bits() {}
    public static int width(int size, int minimum) {
        return Math.max(minimum, size <= 1 ? 0 : 32 - Integer.numberOfLeadingZeros(size - 1));
    }
    public static int get(long[] data, int width, int index) {
        if (data == null || width == 0) return 0;
        int perLong = 64 / width;
        return (int)((data[index / perLong] >>> ((index % perLong) * width)) & ((1L << width) - 1));
    }
}
