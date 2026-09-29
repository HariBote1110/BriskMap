package io.github.haribote1110.briskmap.core.region;
import io.github.haribote1110.briskmap.core.BlockDefaults;
import io.github.haribote1110.briskmap.core.extract.Chunk;
import io.github.haribote1110.briskmap.core.extract.Clock;
import io.github.haribote1110.briskmap.core.nbt.NbtReader;

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
    private final Path path;
    private final int regionX, regionZ;
    private static final ThreadLocal<byte[]> BUFFER = ThreadLocal.withInitial(() -> new byte[131072]);
    public long inflateNs, parseNs;

    public Region(Path path) throws IOException {
        this.path = path;
        String[] parts = path.getFileName().toString().split("\\.");
        if (parts.length != 4 || !parts[0].equals("r") || !parts[3].equals("mca")) throw new IOException("Invalid region name");
        try { regionX = Integer.parseInt(parts[1]); regionZ = Integer.parseInt(parts[2]); }
        catch (NumberFormatException ex) { throw new IOException("Invalid region name", ex); }
        bytes = Files.readAllBytes(path);
        if (bytes.length < 8192) throw new IOException("Short region header");
    }
    public long size() { return bytes.length; }
    public boolean present(int index) {
        int at = index * 4;
        return (bytes[at] != 0 || bytes[at + 1] != 0 || bytes[at + 2] != 0) && bytes[at + 3] != 0;
    }
    public long timestamp(int index) {
        int at = 4096 + index * 4;
        return ((long)(bytes[at] & 255) << 24) | ((long)(bytes[at + 1] & 255) << 16)
                | ((long)(bytes[at + 2] & 255) << 8) | (bytes[at + 3] & 255);
    }

    public int compressionType(int index) throws IOException {
        int offset = index * 4;
        int sector = (bytes[offset] & 255) << 16 | (bytes[offset + 1] & 255) << 8 | (bytes[offset + 2] & 255);
        if (sector == 0) return 0;
        int at = sector * 4096 + 4;
        if (at >= bytes.length) throw new IOException("Invalid chunk location " + index);
        return bytes[at] & 255;
    }

    public Chunk read(int index, Inflater inflater) throws IOException {
        return read(index, inflater, BlockDefaults.empty());
    }

    public Chunk read(int index, Inflater inflater, BlockDefaults defaults) throws IOException {
        int offset = index * 4;
        int sector = (bytes[offset] & 255) << 16 | (bytes[offset + 1] & 255) << 8 | (bytes[offset + 2] & 255);
        int sectors = bytes[offset + 3] & 255;
        if (sector == 0 || sectors == 0) return null;
        int start = sector * 4096;
        if (start + 5L > bytes.length || start + 5L > (sector + (long)sectors) * 4096) throw new IOException("Invalid chunk location " + index);
        int length = (bytes[start] & 255) << 24 | (bytes[start + 1] & 255) << 16 | (bytes[start + 2] & 255) << 8 | (bytes[start + 3] & 255);
        int type = bytes[start + 4] & 255;
        if (length < 1 || start + 4L + length > bytes.length || start + 4L + length > (sector + (long)sectors) * 4096) throw new IOException("Invalid chunk length " + index);
        boolean external = (type & 128) != 0;
        type &= 127;
        if (type == 4) throw new UnsupportedChunkException(type);
        byte[] source = bytes;
        int dataStart = start + 5, dataLength = length - 1;
        if (external) {
            int chunkX = regionX * 32 + (index & 31), chunkZ = regionZ * 32 + (index >>> 5);
            source = Files.readAllBytes(path.resolveSibling("c." + chunkX + "." + chunkZ + ".mcc"));
            dataStart = 0;
            dataLength = source.length;
        }
        long tick = Clock.now();
        byte[] inflated;
        int inflatedLength;
        if (type == 3) {
            byte[] buffer = BUFFER.get();
            if (buffer.length < dataLength) buffer = Arrays.copyOf(buffer, Math.max(dataLength, buffer.length * 2));
            System.arraycopy(source, dataStart, buffer, 0, dataLength);
            BUFFER.set(buffer);
            inflated = buffer;
            inflatedLength = dataLength;
        }
        else if (type == 2) {
            inflater.reset();
            inflater.setInput(source, dataStart, dataLength);
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
            try (GZIPInputStream stream = new GZIPInputStream(new ByteArrayInputStream(source, dataStart, dataLength))) {
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
        Chunk chunk = NbtReader.read(inflated, inflatedLength, defaults);
        parseNs = Clock.now() - tick;
        return chunk;
    }

    public static final class UnsupportedChunkException extends IOException {
        private static final long serialVersionUID = 1L;
        public UnsupportedChunkException(int type) { super("Unsupported chunk compression " + type); }
    }
}
