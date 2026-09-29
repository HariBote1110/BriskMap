package io.github.haribote1110.briskmap.core.format;
import io.github.haribote1110.briskmap.core.extract.Extracted2d;
import io.github.haribote1110.briskmap.core.extract.Extracted3d;
import io.github.haribote1110.briskmap.core.extract.Palette;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.zip.Deflater;

public final class Format {
    private static final ThreadLocal<Encoder> ENCODER = ThreadLocal.withInitial(Encoder::new);
    private static final ThreadLocal<byte[]> COMPRESS_BUFFER = ThreadLocal.withInitial(() -> new byte[65536]);
    private Format() {}

    private static final class Encoder {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream(4096);
        final DataOutputStream out = new DataOutputStream(bytes);
    }

    public static byte[] encode2d(Extracted2d surface) throws IOException {
        Encoder encoder = ENCODER.get();
        encoder.bytes.reset();
        DataOutputStream out = encoder.out;
        for (int i = 0; i < 256; i++) {
            out.writeShort(surface.y[i]);
            varint(out, surface.block[i]);
            varint(out, surface.biome[i]);
            out.writeByte(surface.depth[i]);
        }
        return encoder.bytes.toByteArray();
    }

    public static byte[] encode3d(Extracted3d shell) throws IOException {
        Encoder encoder = ENCODER.get();
        encoder.bytes.reset();
        DataOutputStream out = encoder.out;
        for (int sy = 0; sy < 24; sy++) {
            varint(out, shell.positions[sy].length);
            int previous = 0;
            for (int position : shell.positions[sy]) { varint(out, position - previous); previous = position; }
            for (int block : shell.blocks[sy]) varint(out, block);
            if (shell.masks[sy].length != shell.positions[sy].length) throw new IllegalArgumentException("Missing face masks");
            for (byte mask : shell.masks[sy]) {
                if (mask == 0 || (mask & 0xc0) != 0) throw new IllegalArgumentException("Invalid face mask");
                out.writeByte(mask);
            }
        }
        return encoder.bytes.toByteArray();
    }

    public static void varint(DataOutputStream out, int value) throws IOException {
        while ((value & ~127) != 0) { out.writeByte((value & 127) | 128); value >>>= 7; }
        out.writeByte(value);
    }

    private static void table(DataOutputStream out, Palette palette) throws IOException {
        varint(out, palette.size());
        for (String value : palette.entries()) {
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            varint(out, bytes.length);
            out.write(bytes);
        }
    }

    public static byte[] compress(byte[] payload, Deflater deflater) {
        deflater.reset();
        deflater.setInput(payload);
        deflater.finish();
        byte[] buffer = COMPRESS_BUFFER.get();
        ByteArrayOutputStream packed = new ByteArrayOutputStream(payload.length / 2);
        while (!deflater.finished()) packed.write(buffer, 0, deflater.deflate(buffer));
        return packed.toByteArray();
    }

    public static long writeV3(Path path, int kind, int regionX, int regionZ, int flags,
            Palette blocks, Palette biomes, byte[][] compressed, long[] timestamps) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(header);
        out.write(new byte[]{'B', 'R', 'S', 'K'});
        out.writeByte(3); out.writeByte(kind); out.writeInt(regionX); out.writeInt(regionZ);
        out.writeByte(flags); out.writeByte(0);
        table(out, blocks);
        if (kind == 1) table(out, biomes);
        int cursor = header.size() + 8192;
        for (byte[] data : compressed) {
            if (data == null) { out.writeInt(0); out.writeInt(0); }
            else { out.writeInt(cursor); out.writeInt(data.length); cursor = Math.addExact(cursor, data.length); }
        }
        Files.createDirectories(path.getParent());
        Path temp = path.resolveSibling(path.getFileName() + ".tmp");
        try {
            try (var stream = Files.newOutputStream(temp)) {
                header.writeTo(stream);
                for (byte[] data : compressed) if (data != null) stream.write(data);
                DataOutputStream trailer = new DataOutputStream(stream);
                for (long timestamp : timestamps) trailer.writeInt((int) timestamp);
                trailer.write(new byte[]{'B', 'R', 'S', 'T'});
            }
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temp); }
        return Files.size(path);
    }
}
