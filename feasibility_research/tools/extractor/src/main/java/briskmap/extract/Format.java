package briskmap.extract;

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
        }
        return encoder.bytes.toByteArray();
    }

    public static void varint(DataOutputStream out, int value) throws IOException {
        while ((value & ~127) != 0) { out.writeByte((value & 127) | 128); value >>>= 7; }
        out.writeByte(value);
    }

    public static final class WriteResult {
        public long compressNs, writeNs, bytes;
    }

    public static WriteResult write(Path path, int kind, int regionX, int regionZ, Palette blocks, Palette biomes, byte[][] payloads, Deflater deflater) throws IOException {
        WriteResult result = new WriteResult();
        byte[][] compressed = new byte[1024][];
        byte[] buffer = COMPRESS_BUFFER.get();
        long tick = Clock.now();
        for (int i = 0; i < 1024; i++) {
            if (payloads[i] == null) continue;
            deflater.reset();
            deflater.setInput(payloads[i]);
            deflater.finish();
            ByteArrayOutputStream packed = new ByteArrayOutputStream(payloads[i].length / 2);
            while (!deflater.finished()) packed.write(buffer, 0, deflater.deflate(buffer));
            compressed[i] = packed.toByteArray();
        }
        result.compressNs = Clock.now() - tick;
        tick = Clock.now();
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        DataOutputStream out = new DataOutputStream(header);
        out.write(new byte[]{'B', 'R', 'S', 'K'});
        out.writeByte(1); out.writeByte(kind); out.writeInt(regionX); out.writeInt(regionZ);
        table(out, blocks);
        if (kind == 1) table(out, biomes);
        int payloadStart = header.size() + 8192;
        int cursor = payloadStart;
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
            }
            Files.move(temp, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } finally { Files.deleteIfExists(temp); }
        result.writeNs = Clock.now() - tick;
        result.bytes = Files.size(path);
        return result;
    }

    private static void table(DataOutputStream out, Palette palette) throws IOException {
        varint(out, palette.size());
        for (String value : palette.entries()) {
            byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
            varint(out, bytes.length);
            out.write(bytes);
        }
    }
}
