package io.github.haribote1110.briskmap.core.textures;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.zip.CRC32;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.InflaterInputStream;

/** PNG decoding for client textures and RGBA encoding for the texture atlas. */
public final class Png {
    private static final byte[] SIGNATURE = {(byte) 137, 80, 78, 71, 13, 10, 26, 10};
    private Png() { }
    public record Image(int width, int height, byte[] pixels) { }

    public static byte[] encode(int width, int height, byte[] pixels) {
        if (width < 1 || height < 1 || (long) width * height * 4 != pixels.length) throw new IllegalArgumentException("Invalid RGBA length");
        try {
            byte[] head = ByteBuffer.allocate(13).order(ByteOrder.BIG_ENDIAN).putInt(width).putInt(height).put((byte) 8).put((byte) 6).put(new byte[3]).array();
            ByteArrayOutputStream raw = new ByteArrayOutputStream();
            for (int y = 0; y < height; y++) { raw.write(0); raw.write(pixels, y * width * 4, width * 4); }
            ByteArrayOutputStream packed = new ByteArrayOutputStream();
            try (DeflaterOutputStream deflater = new DeflaterOutputStream(packed)) { deflater.write(raw.toByteArray()); }
            ByteArrayOutputStream result = new ByteArrayOutputStream(); result.write(SIGNATURE);
            chunk(result, "IHDR", head); chunk(result, "IDAT", packed.toByteArray()); chunk(result, "IEND", new byte[0]);
            return result.toByteArray();
        } catch (IOException exception) { throw new IllegalStateException(exception); }
    }

    public static Image decode(byte[] data) {
        if (data.length < 8 || !Arrays.equals(Arrays.copyOf(data, 8), SIGNATURE)) throw new IllegalArgumentException("Invalid PNG signature");
        int width = 0, height = 0, depth = 0, type = -1;
        byte[] palette = null, transparency = null;
        ByteArrayOutputStream packed = new ByteArrayOutputStream();
        for (int at = 8; at < data.length;) {
            if (data.length - at < 12) throw new IllegalArgumentException("Invalid PNG chunk");
            int size = integer(data, at);
            if (size < 0 || (long) at + size + 12 > data.length) throw new IllegalArgumentException("Invalid PNG chunk");
            String name = new String(data, at + 4, 4, StandardCharsets.US_ASCII);
            if (crc32(data, at + 4, size + 4) != Integer.toUnsignedLong(integer(data, at + 8 + size))) throw new IllegalArgumentException("Invalid PNG chunk");
            byte[] body = Arrays.copyOfRange(data, at + 8, at + 8 + size);
            if (name.equals("IHDR")) {
                if (body.length != 13) throw new IllegalArgumentException("Invalid PNG header");
                width = integer(body, 0); height = integer(body, 4); depth = Byte.toUnsignedInt(body[8]); type = Byte.toUnsignedInt(body[9]);
                if (body[12] != 0 || body[10] != 0 || body[11] != 0 || !(depth == 8 || (type == 0 || type == 3) && (depth == 1 || depth == 2 || depth == 4)))
                    throw new IllegalArgumentException("Unsupported PNG depth or interlace");
            }
            if (name.equals("PLTE")) palette = body;
            if (name.equals("tRNS")) transparency = body;
            if (name.equals("IDAT")) packed.writeBytes(body);
            at += size + 12;
            if (name.equals("IEND")) break;
        }
        int channels = switch (type) { case 0, 3 -> 1; case 2 -> 3; case 4 -> 2; case 6 -> 4; default -> 0; };
        if (channels == 0 || width < 1 || height < 1 || (long) width * height * 4 > Integer.MAX_VALUE) throw new IllegalArgumentException("Unsupported PNG colour type");
        int stride = (int) (((long) width * channels * depth + 7) / 8);
        int bpp = Math.max(1, (channels * depth + 7) / 8);
        byte[] raw;
        try (InflaterInputStream inflater = new InflaterInputStream(new java.io.ByteArrayInputStream(packed.toByteArray()))) { raw = inflater.readAllBytes(); }
        catch (IOException exception) { throw new IllegalArgumentException("Invalid PNG compressed data", exception); }
        byte[] pixels = new byte[width * height * 4], prior = new byte[stride];
        int position = 0;
        for (int y = 0; y < height; y++) {
            if (position >= raw.length) throw new IllegalArgumentException("Invalid PNG data");
            int filter = Byte.toUnsignedInt(raw[position++]);
            if (filter > 4 || (long) position + stride > raw.length) throw new IllegalArgumentException("Invalid PNG filter or data");
            byte[] row = new byte[stride];
            for (int i = 0; i < stride; i++) {
                int left = i >= bpp ? Byte.toUnsignedInt(row[i-bpp]) : 0;
                int up = Byte.toUnsignedInt(prior[i]); int corner = i >= bpp ? Byte.toUnsignedInt(prior[i-bpp]) : 0;
                int p = left + up - corner;
                int predictor = switch (filter) {
                    case 0 -> 0; case 1 -> left; case 2 -> up; case 3 -> (left + up) / 2;
                    default -> Math.abs(p-left) <= Math.abs(p-up) && Math.abs(p-left) <= Math.abs(p-corner) ? left : Math.abs(p-up) <= Math.abs(p-corner) ? up : corner;
                };
                row[i] = (byte) (Byte.toUnsignedInt(raw[position++]) + predictor);
            }
            for (int x = 0; x < width; x++) {
                int source = x * channels, target = (y * width + x) * 4;
                if (type == 0) {
                    int value = depth == 8 ? Byte.toUnsignedInt(row[source]) : packedValue(row, x, depth) * 255 / ((1 << depth) - 1);
                    pixels[target] = pixels[target+1] = pixels[target+2] = (byte) value; pixels[target+3] = (byte) 255;
                } else if (type == 2) {
                    System.arraycopy(row, source, pixels, target, 3); pixels[target+3] = (byte) 255;
                } else if (type == 3) {
                    int index = depth == 8 ? Byte.toUnsignedInt(row[source]) : packedValue(row, x, depth);
                    int colour = index * 3;
                    if (palette == null || colour + 2 >= palette.length) throw new IllegalArgumentException("Invalid PNG palette");
                    System.arraycopy(palette, colour, pixels, target, 3);
                    pixels[target+3] = transparency != null && index < transparency.length ? transparency[index] : (byte) 255;
                } else if (type == 4) {
                    pixels[target] = pixels[target+1] = pixels[target+2] = row[source]; pixels[target+3] = row[source+1];
                } else System.arraycopy(row, source, pixels, target, 4);
            }
            prior = row;
        }
        return new Image(width, height, pixels);
    }

    private static int packedValue(byte[] row, int x, int depth) { return (Byte.toUnsignedInt(row[x * depth / 8]) >>> (8 - depth - x * depth % 8)) & ((1 << depth) - 1); }
    private static int integer(byte[] data, int offset) { return ByteBuffer.wrap(data, offset, 4).order(ByteOrder.BIG_ENDIAN).getInt(); }
    static long crc32(byte[] data) { return crc32(data, 0, data.length); }
    private static long crc32(byte[] data, int offset, int length) { CRC32 crc = new CRC32(); crc.update(data, offset, length); return crc.getValue(); }
    private static void chunk(ByteArrayOutputStream out, String name, byte[] body) throws IOException {
        byte[] tag = name.getBytes(StandardCharsets.US_ASCII);
        byte[] checked = new byte[tag.length + body.length]; System.arraycopy(tag, 0, checked, 0, tag.length); System.arraycopy(body, 0, checked, tag.length, body.length);
        out.write(ByteBuffer.allocate(4).putInt(body.length).array()); out.write(tag); out.write(body); out.write(ByteBuffer.allocate(4).putInt((int) crc32(checked)).array());
    }
}
