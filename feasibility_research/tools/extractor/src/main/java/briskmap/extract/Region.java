package briskmap.extract;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.zip.DataFormatException;
import java.util.zip.GZIPInputStream;
import java.util.zip.Inflater;

public final class Region {
    private final byte[] bytes;
    private static final ThreadLocal<byte[]> BUFFER = ThreadLocal.withInitial(() -> new byte[131072]);
    public long inflateNs, parseNs;

    public Region(Path path) throws IOException { bytes = Files.readAllBytes(path); if (bytes.length < 8192) throw new IOException("Short region header"); }
    public long size() { return bytes.length; }

    public int compressionType(int index) throws IOException {
        int offset = index * 4;
        int sector = (bytes[offset] & 255) << 16 | (bytes[offset + 1] & 255) << 8 | (bytes[offset + 2] & 255);
        if (sector == 0) return 0;
        int at = sector * 4096 + 4;
        if (at >= bytes.length) throw new IOException("Invalid chunk location " + index);
        return bytes[at] & 255;
    }

    public Chunk read(int index, Inflater inflater) throws IOException {
        int offset = index * 4;
        int sector = (bytes[offset] & 255) << 16 | (bytes[offset + 1] & 255) << 8 | (bytes[offset + 2] & 255);
        int sectors = bytes[offset + 3] & 255;
        if (sector == 0 || sectors == 0) return null;
        int start = sector * 4096;
        if (start + 5L > bytes.length || start + 5L > (sector + (long)sectors) * 4096) throw new IOException("Invalid chunk location " + index);
        int length = (bytes[start] & 255) << 24 | (bytes[start + 1] & 255) << 16 | (bytes[start + 2] & 255) << 8 | (bytes[start + 3] & 255);
        int type = bytes[start + 4] & 255;
        if (length < 1 || start + 4L + length > bytes.length || start + 4L + length > (sector + (long)sectors) * 4096) throw new IOException("Invalid chunk length " + index);
        if ((type & 128) != 0 || type == 4) throw new UnsupportedChunkException(type);
        int dataStart = start + 5, dataLength = length - 1;
        long tick = Clock.now();
        byte[] inflated;
        int inflatedLength;
        if (type == 3) {
            byte[] buffer = BUFFER.get();
            if (buffer.length < dataLength) buffer = Arrays.copyOf(buffer, Math.max(dataLength, buffer.length * 2));
            System.arraycopy(bytes, dataStart, buffer, 0, dataLength);
            BUFFER.set(buffer);
            inflated = buffer;
            inflatedLength = dataLength;
        }
        else if (type == 2) {
            inflater.reset();
            inflater.setInput(bytes, dataStart, dataLength);
            byte[] buffer = BUFFER.get();
            int used = 0;
            try {
                while (!inflater.finished()) {
                    if (used == buffer.length) buffer = Arrays.copyOf(buffer, buffer.length * 2);
                    int amount = inflater.inflate(buffer, used, buffer.length - used);
                    if (amount == 0 && (inflater.needsInput() || inflater.needsDictionary())) throw new IOException("Incomplete zlib stream");
                    used += amount;
                }
            } catch (DataFormatException ex) { throw new IOException("Invalid zlib stream", ex); }
            BUFFER.set(buffer);
            inflated = buffer;
            inflatedLength = used;
        } else if (type == 1) {
            try (GZIPInputStream stream = new GZIPInputStream(new ByteArrayInputStream(bytes, dataStart, dataLength))) {
                byte[] buffer = BUFFER.get();
                int used = 0;
                while (true) {
                    if (used == buffer.length) buffer = Arrays.copyOf(buffer, buffer.length * 2);
                    int amount = stream.read(buffer, used, buffer.length - used);
                    if (amount < 0) break;
                    used += amount;
                }
                BUFFER.set(buffer);
                inflated = buffer;
                inflatedLength = used;
            }
        } else throw new UnsupportedChunkException(type);
        inflateNs = Clock.now() - tick;
        tick = Clock.now();
        Chunk chunk = NbtReader.read(inflated, inflatedLength);
        parseNs = Clock.now() - tick;
        return chunk;
    }

    public static final class UnsupportedChunkException extends IOException {
        public UnsupportedChunkException(int type) { super("Unsupported chunk compression " + type); }
    }
}
