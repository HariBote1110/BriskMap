package io.github.haribote1110.briskmap.core.textures;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.DeflaterOutputStream;
import org.junit.jupiter.api.Test;

class PngJsonTest {
    @Test void crcAndRoundTrip() {
        byte[] sample = "123456789".getBytes(StandardCharsets.US_ASCII);
        CRC32 crc = new CRC32(); crc.update(sample);
        assertEquals(0xcbf43926L, crc.getValue());
        assertEquals(crc.getValue(), Png.crc32(sample));
        byte[] rgba = {(byte) 255, 0, 12, (byte) 255, 0, 20, (byte) 255, 50};
        assertArrayEquals(rgba, Png.decode(Png.encode(2, 1, rgba)).pixels());
    }

    @Test void colourTypesAndPackedPixels() throws Exception {
        assertArrayEquals(bytes(90,90,90,255), Png.decode(raw(0, 1, 1, 8, bytes(0,90), null, null)).pixels());
        assertArrayEquals(bytes(1,2,3,255), Png.decode(raw(2, 1, 1, 8, bytes(0,1,2,3), null, null)).pixels());
        assertArrayEquals(bytes(7,8,9,20), Png.decode(raw(3, 1, 1, 8, bytes(0,1), bytes(4,5,6,7,8,9), bytes(255,20))).pixels());
        assertArrayEquals(bytes(40,40,40,50), Png.decode(raw(4, 1, 1, 8, bytes(0,40,50), null, null)).pixels());
        assertArrayEquals(bytes(1,2,3,4), Png.decode(raw(6, 1, 1, 8, bytes(0,1,2,3,4), null, null)).pixels());
        assertArrayEquals(bytes(0,0,0,255,255,0,255,128), Png.decode(raw(3, 2, 1, 4, bytes(0,1), bytes(0,0,0,255,0,255), bytes(255,128))).pixels());
        assertArrayEquals(bytes(85,85,85,255,0,0,0,255), Png.decode(raw(0, 2, 1, 2, bytes(0,0x40), null, null)).pixels());
    }

    @Test void allFilters() throws Exception {
        for (int filter = 0; filter <= 4; filter++) {
            int[] wanted = {30,50,70}, prior = {10,20,30};
            byte[] rows = bytes(0,10,20,30,filter,0,0,0);
            for (int i = 0; i < 3; i++) {
                int predictor = switch (filter) {
                    case 0 -> 0;
                    case 1 -> 0;
                    case 2 -> prior[i];
                    case 3 -> prior[i] / 2;
                    default -> { int a = 0, b = prior[i], c = 0; int p = a+b-c;
                        yield Math.abs(p-a) <= Math.abs(p-b) && Math.abs(p-a) <= Math.abs(p-c) ? a : Math.abs(p-b) <= Math.abs(p-c) ? b : c; }
                };
                rows[5+i] = (byte) (wanted[i] - predictor);
            }
            byte[] pixels = Png.decode(raw(2, 1, 2, 8, rows, null, null)).pixels();
            assertArrayEquals(bytes(30,50,70,255), Arrays.copyOfRange(pixels, 4, 8), "filter " + filter);
        }
    }

    @Test void jsonReaderAndNodeWriter() {
        Map<String,Object> parsed = Json.object(Json.parse("{\"a\\n\": [1,-2.5e2,true,null,\"\\uD83D\\uDE00\"],\"nested\":{\"x\":0}}"));
        List<?> values = (List<?>) parsed.get("a\n");
        assertEquals(1L, values.get(0)); assertEquals(-250.0, values.get(1)); assertEquals(true, values.get(2));
        assertNull(values.get(3)); assertEquals("😀", values.get(4));
        assertEquals(0L, Json.object(parsed.get("nested")).get("x"));
        Map<String,Object> document = new LinkedHashMap<>();
        document.put("format", 1); document.put("source", "a\nb"); document.put("values", List.of("<missing>", true));
        // Expected text generated with node -e 'console.log(JSON.stringify({format:1,source:"a\nb",values:["<missing>",true]},null,2))'.
        assertEquals("{\n  \"format\": 1,\n  \"source\": \"a\\nb\",\n  \"values\": [\n    \"<missing>\",\n    true\n  ]\n}\n", Json.stringify(document));
        assertThrows(IllegalArgumentException.class, () -> Json.parse("{\"x\":1,}"));
    }

    private static byte[] bytes(int... values) { byte[] out = new byte[values.length]; for (int i=0;i<values.length;i++) out[i]=(byte)values[i]; return out; }
    private static byte[] raw(int type, int width, int height, int depth, byte[] rows, byte[] palette, byte[] transparency) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream(); out.write(bytes(137,80,78,71,13,10,26,10));
        ByteBuffer head = ByteBuffer.allocate(13).order(ByteOrder.BIG_ENDIAN).putInt(width).putInt(height).put((byte)depth).put((byte)type).put(new byte[3]);
        chunk(out,"IHDR",head.array()); if (palette != null) chunk(out,"PLTE",palette); if (transparency != null) chunk(out,"tRNS",transparency);
        ByteArrayOutputStream compressed = new ByteArrayOutputStream(); try (DeflaterOutputStream zip = new DeflaterOutputStream(compressed)) { zip.write(rows); }
        chunk(out,"IDAT",compressed.toByteArray()); chunk(out,"IEND",new byte[0]); return out.toByteArray();
    }
    private static void chunk(ByteArrayOutputStream out, String name, byte[] data) throws Exception {
        byte[] tag = name.getBytes(StandardCharsets.US_ASCII); CRC32 crc = new CRC32(); crc.update(tag); crc.update(data);
        out.write(ByteBuffer.allocate(4).putInt(data.length).array()); out.write(tag); out.write(data); out.write(ByteBuffer.allocate(4).putInt((int)crc.getValue()).array());
    }
}
