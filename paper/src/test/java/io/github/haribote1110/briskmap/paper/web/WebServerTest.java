package io.github.haribote1110.briskmap.paper.web;

import static org.junit.jupiter.api.Assertions.*;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.logging.Logger;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class WebServerTest {
    @TempDir Path temporary;
    private Path maps;
    private Path textures;
    private WebServer server;
    private HttpClient client;
    private byte[] data;

    @BeforeEach void setUp() throws Exception {
        maps = Files.createDirectory(temporary.resolve("maps"));
        textures = Files.createDirectory(temporary.resolve("textures"));
        data = new byte[8192];
        for (int i = 0; i < data.length; i++) data[i] = (byte) i;
        Files.write(maps.resolve("r.0.0.b3d"), data);
        Files.write(textures.resolve("blocks.json"), "{\"name\":\"old\"}".getBytes(StandardCharsets.UTF_8));
        server = new WebServer(new WebServerConfig("127.0.0.1", 0, 4, 1024 * 1024,
                List.of(new Mount.Directory("/maps/", maps), new Mount.Directory("/textures/", textures),
                        new Mount.Classpath("/", "web/")), getClass().getClassLoader(),
                Logger.getLogger(WebServerTest.class.getName())));
        server.start();
        client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @AfterEach void tearDown() {
        if (server != null) server.stop();
        if (client != null) client.close();
    }

    private HttpResponse<byte[]> request(String method, String path, Map<String, String> headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port() + path));
        headers.forEach(builder::header);
        return client.send(builder.method(method, HttpRequest.BodyPublishers.noBody()).build(),
                HttpResponse.BodyHandlers.ofByteArray());
    }

    private HttpResponse<byte[]> get(String path, String... headers) throws Exception {
        java.util.HashMap<String, String> map = new java.util.HashMap<>();
        for (int i = 0; i < headers.length; i += 2) map.put(headers[i], headers[i + 1]);
        return request("GET", path, map);
    }

    private static String header(HttpResponse<?> response, String name) {
        return response.headers().firstValue(name).orElse(null);
    }

    @Test void fullGetAndHeadHaveMetadata() throws Exception {
        HttpResponse<byte[]> full = get("/maps/r.0.0.b3d");
        assertEquals(200, full.statusCode());
        assertArrayEquals(data, full.body());
        assertEquals(String.valueOf(data.length), header(full, "Content-Length"));
        assertEquals("application/octet-stream", header(full, "Content-Type"));
        assertEquals("nosniff", header(full, "X-Content-Type-Options"));
        assertEquals("no-cache", header(full, "Cache-Control"));
        assertNotNull(header(full, "ETag"));
        assertNotNull(header(full, "Last-Modified"));
        HttpResponse<byte[]> head = request("HEAD", "/maps/r.0.0.b3d", Map.of());
        assertEquals(200, head.statusCode());
        assertEquals(0, head.body().length);
        assertEquals(header(full, "Content-Length"), header(head, "Content-Length"));
        assertEquals(header(full, "ETag"), header(head, "ETag"));
    }

    @Test void methodsAndPathsAreRestricted() throws Exception {
        HttpResponse<byte[]> method = request("POST", "/maps/r.0.0.b3d", Map.of());
        assertEquals(405, method.statusCode());
        assertEquals("GET, HEAD", header(method, "Allow"));
        Path outside = Files.writeString(temporary.resolve("secret"), "secret");
        Files.createSymbolicLink(maps.resolve("escape"), outside);
        for (String path : List.of("/maps/%2e%2e/secret", "/maps/a%5cb", "/maps/a%00b",
                "/maps/escape", "/mapsx/r.0.0.b3d", "/maps/")) {
            assertTrue(get(path).statusCode() >= 400, path);
        }
        assertEquals(404, rawStatus("/maps/../secret"));
        assertEquals(404, rawStatus("/maps/%2e%2e/secret"));
        assertEquals(404, rawStatus("/maps/./r.0.0.b3d"));
        assertEquals(400, rawStatus("/maps/%GG"));
        assertEquals(404, rawStatus("/maps/a%00b"));
    }

    private int rawStatus(String target) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1", server.port()));
            socket.setSoTimeout(5000);
            socket.getOutputStream().write(("GET " + target + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                    .getBytes(StandardCharsets.US_ASCII));
            String line = new String(socket.getInputStream().readNBytes(80), StandardCharsets.US_ASCII);
            return Integer.parseInt(line.split(" ")[1]);
        }
    }

    @Test void classpathIndexAndAssets() throws Exception {
        assertTrue(new String(get("/").body(), StandardCharsets.UTF_8).contains("BriskMap test viewer"));
        assertTrue(new String(get("/sub/").body(), StandardCharsets.UTF_8).contains("Subdirectory"));
        HttpResponse<byte[]> asset = get("/app.js");
        assertEquals("text/javascript; charset=utf-8", header(asset, "Content-Type"));
        assertEquals("Accept-Encoding", header(asset, "Vary"));
        assertEquals(404, get("/missing").statusCode());
    }

    @Test void rangesAndConditionalRequests() throws Exception {
        String path = "/maps/r.0.0.b3d";
        String etag = header(get(path), "ETag");
        for (String[] range : List.of(new String[] {"bytes=10-19", "10", "19"},
                new String[] {"bytes=100-", "100", String.valueOf(data.length - 1)},
                new String[] {"bytes=-17", String.valueOf(data.length - 17), String.valueOf(data.length - 1)},
                new String[] {"bytes=8000-99999", "8000", String.valueOf(data.length - 1)})) {
            int start = Integer.parseInt(range[1]);
            int end = Integer.parseInt(range[2]);
            HttpResponse<byte[]> response = get(path, "Range", range[0]);
            assertEquals(206, response.statusCode());
            assertArrayEquals(Arrays.copyOfRange(data, start, end + 1), response.body());
            assertEquals("bytes " + start + "-" + end + "/" + data.length, header(response, "Content-Range"));
            assertEquals("bytes", header(response, "Accept-Ranges"));
            assertEquals(etag, header(response, "ETag"));
        }
        for (String value : List.of("bytes=" + data.length + "-", "bytes=-0", "bytes=20-10")) {
            HttpResponse<byte[]> invalid = get(path, "Range", value);
            assertEquals(416, invalid.statusCode());
            assertEquals("bytes */" + data.length, header(invalid, "Content-Range"));
        }
        for (String value : List.of("bytes=0-1,3-4", "bytes=oops", "units=1-2")) {
            assertEquals(200, get(path, "Range", value).statusCode());
        }
        for (String value : List.of(etag, "W/" + etag, "*", "\"other\", " + etag)) {
            assertEquals(304, get(path, "If-None-Match", value).statusCode());
        }
        assertEquals(206, get(path, "Range", "bytes=1-2", "If-Range", etag).statusCode());
        String modified = header(get(path), "Last-Modified");
        assertEquals(206, get(path, "Range", "bytes=1-2", "If-Range", modified).statusCode());
        assertEquals(200, get(path, "Range", "bytes=1-2", "If-Range", "Wed, 01 Jan 2020 00:00:00 GMT").statusCode());
        HttpResponse<byte[]> rangedHead = request("HEAD", path, Map.of("Range", "bytes=1-2"));
        assertEquals(206, rangedHead.statusCode());
        assertEquals("2", header(rangedHead, "Content-Length"));
        assertEquals(0, rangedHead.body().length);
        Files.write(maps.resolve("r.0.0.b3d"), new byte[] {4, 5, 6});
        HttpResponse<byte[]> replaced = get(path, "Range", "bytes=1-2", "If-Range", etag);
        assertEquals(200, replaced.statusCode());
        assertNotEquals(etag, header(replaced, "ETag"));
        assertArrayEquals(new byte[] {4, 5, 6}, replaced.body());
    }

    @Test void gzipNegotiationAndInvalidation() throws Exception {
        String path = "/textures/blocks.json";
        byte[] original = Files.readAllBytes(textures.resolve("blocks.json"));
        for (String encoding : List.of("identity", "gzip;q=0")) {
            HttpResponse<byte[]> response = get(path, "Accept-Encoding", encoding);
            assertNull(header(response, "Content-Encoding"));
            assertArrayEquals(original, response.body());
            assertEquals("Accept-Encoding", header(response, "Vary"));
        }
        assertNull(header(get(path), "Content-Encoding"));
        HttpResponse<byte[]> compressed = get(path, "Accept-Encoding", "br, gzip;q=0.5");
        assertEquals("gzip", header(compressed, "Content-Encoding"));
        assertNotEquals(header(get(path), "ETag"), header(compressed, "ETag"));
        assertArrayEquals(original, gunzip(compressed.body()));
        assertNull(header(get(path, "Range", "bytes=0-3", "Accept-Encoding", "gzip"), "Content-Encoding"));
        assertNull(header(get("/maps/r.0.0.b3d", "Accept-Encoding", "gzip"), "Content-Encoding"));
        byte[] changed = "{\"name\":\"new and longer\"}".getBytes(StandardCharsets.UTF_8);
        Files.write(textures.resolve("blocks.json"), changed);
        HttpResponse<byte[]> refreshed = get(path, "Accept-Encoding", "gzip");
        assertArrayEquals(changed, gunzip(refreshed.body()));
        assertNotEquals(header(compressed, "ETag"), header(refreshed, "ETag"));
    }

    private static byte[] gunzip(byte[] bytes) throws Exception {
        try (GZIPInputStream input = new GZIPInputStream(new java.io.ByteArrayInputStream(bytes))) {
            return input.readAllBytes();
        }
    }

    @Test void atomicReplacementKeepsOneResponseVersion() throws Exception {
        byte[] old = new byte[8 * 1024 * 1024];
        byte[] replacement = new byte[old.length];
        Arrays.fill(old, (byte) 7);
        Arrays.fill(replacement, (byte) 9);
        Path file = maps.resolve("large.b3d");
        Files.write(file, old);
        try (Socket socket = new Socket("127.0.0.1", server.port())) {
            socket.setSoTimeout(10000);
            socket.getOutputStream().write(("GET /maps/large.b3d HTTP/1.1\r\nHost: localhost\r\nRange: bytes=0-" + (old.length - 1)
                    + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
            InputStream input = socket.getInputStream();
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            while (true) {
                int current = input.read();
                if (current < 0) fail("missing headers");
                head.write(current);
                byte[] h = head.toByteArray();
                if (h.length >= 4 && h[h.length - 4] == 13 && h[h.length - 3] == 10
                        && h[h.length - 2] == 13 && h[h.length - 1] == 10) break;
            }
            assertTrue(new String(head.toByteArray(), StandardCharsets.US_ASCII).startsWith("HTTP/1.1 206"));
            byte[] first = input.readNBytes(1024);
            assertEquals(1024, first.length);
            Path temp = Files.write(maps.resolve("replacement.tmp"), replacement);
            Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            body.write(first);
            while (body.size() < old.length) {
                byte[] chunk = input.readNBytes(Math.min(65536, old.length - body.size()));
                if (chunk.length == 0) break;
                body.write(chunk);
                Thread.sleep(1);
            }
            assertArrayEquals(old, body.toByteArray());
        }
    }

    @Test void concurrentRangesAndStop() throws Exception {
        List<CompletableFuture<HttpResponse<byte[]>>> requests = new ArrayList<>();
        for (int i = 0; i < 32; i++) {
            int start = i * 100;
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + server.port()
                    + "/maps/r.0.0.b3d")).header("Range", "bytes=" + start + "-" + (start + 99)).build();
            requests.add(client.sendAsync(request, HttpResponse.BodyHandlers.ofByteArray()));
        }
        for (int i = 0; i < requests.size(); i++) {
            HttpResponse<byte[]> response = requests.get(i).get(10, TimeUnit.SECONDS);
            assertEquals(206, response.statusCode());
            assertArrayEquals(Arrays.copyOfRange(data, i * 100, i * 100 + 100), response.body());
        }
        int port = server.port();
        server.stop();
        server.stop();
        try (java.net.ServerSocket socket = new java.net.ServerSocket(port, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            assertEquals(port, socket.getLocalPort());
        }
    }
}
