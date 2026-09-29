package io.github.haribote1110.briskmap.paper.web;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;

/** Standalone, dependency-free HTTP server for map files and viewer assets. */
public final class WebServer implements AutoCloseable {
    private static final DateTimeFormatter HTTP_DATE = DateTimeFormatter.RFC_1123_DATE_TIME.withZone(ZoneOffset.UTC);
    private final WebServerConfig config;
    private final Map<String, byte[]> gzipCache = new LinkedHashMap<>(16, 0.75f, true);
    private final Map<String, Asset> resources = new java.util.concurrent.ConcurrentHashMap<>();
    private long cachedBytes;
    private HttpServer server;
    private ExecutorService executor;

    public WebServer(WebServerConfig config) {
        this.config = java.util.Objects.requireNonNull(config);
    }

    public synchronized void start() throws IOException {
        if (server != null) return;
        HttpServer created = HttpServer.create(new InetSocketAddress(config.bindAddress(), config.port()), 0);
        AtomicInteger nextThread = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(config.threads(), task -> {
            Thread thread = new Thread(task, "BriskMap-web-" + nextThread.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        });
        created.setExecutor(pool);
        created.createContext("/", this::handle);
        created.start();
        executor = pool;
        server = created;
    }

    public synchronized int port() {
        if (server == null) throw new IllegalStateException("Server is not running");
        return server.getAddress().getPort();
    }

    public synchronized void stop() {
        if (server == null) return;
        server.stop(0);
        executor.shutdownNow();
        server = null;
        executor = null;
    }

    @Override public void close() {
        stop();
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            serve(exchange);
        } catch (Exception exception) {
            config.logger().warning("Web request failed: " + exception);
            try {
                send(exchange, 500);
            } catch (IOException | IllegalStateException ignored) {
                exchange.close();
            }
        } finally {
            exchange.close();
        }
    }

    private void serve(HttpExchange exchange) throws IOException {
        Headers headers = exchange.getResponseHeaders();
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "no-cache");
        headers.set("Accept-Ranges", "bytes");
        String method = exchange.getRequestMethod();
        if (!method.equals("GET") && !method.equals("HEAD")) {
            headers.set("Allow", "GET, HEAD");
            send(exchange, 405);
            return;
        }
        String decoded;
        try {
            decoded = decode(exchange.getRequestURI().getRawPath());
        } catch (IllegalArgumentException exception) {
            send(exchange, 400);
            return;
        }
        if (decoded == null || !decoded.startsWith("/") || decoded.indexOf('\\') >= 0
                || decoded.indexOf('\0') >= 0) {
            send(exchange, 404);
            return;
        }
        String[] parts = decoded.split("/", -1);
        for (String part : parts) {
            if (part.equals(".") || part.equals("..")) {
                send(exchange, 404);
                return;
            }
        }
        String path = decoded.replaceAll("/{2,}", "/");
        Mount mount = config.mounts().stream().filter(m -> path.startsWith(m.prefix()))
                .max(Comparator.comparingInt(m -> m.prefix().length())).orElse(null);
        if (mount == null) {
            send(exchange, 404);
            return;
        }
        String local = path.substring(mount.prefix().length());
        if (path.endsWith("/")) local += "index.html";
        Asset asset;
        if (mount instanceof Mount.Directory directory) {
            asset = openFile(directory, local);
        } else {
            Mount.Classpath classpath = (Mount.Classpath) mount;
            asset = openResource(classpath.resourceRoot() + local);
        }
        if (asset == null) {
            send(exchange, 404);
            return;
        }
        try (asset) {
            headers.set("Content-Type", contentType(local));
            if (compressible(local)) headers.set("Vary", "Accept-Encoding");
            if (asset.modified != null) headers.set("Last-Modified", HTTP_DATE.format(asset.modified));
            String rangeHeader = exchange.getRequestHeaders().getFirst("Range");
            boolean gzip = rangeHeader == null && compressible(local)
                    && acceptsGzip(exchange.getRequestHeaders().getFirst("Accept-Encoding"));
            String etag = gzip ? asset.etag.substring(0, asset.etag.length() - 1) + "-gz\"" : asset.etag;
            headers.set("ETag", etag);
            if (matchesNone(exchange.getRequestHeaders().getFirst("If-None-Match"), etag)) {
                send(exchange, 304);
                return;
            }
            if (gzip) {
                byte[] bytes = gzip(asset);
                headers.set("Content-Encoding", "gzip");
                writeBytes(exchange, method, 200, bytes);
                return;
            }
            Range range = parseRange(rangeHeader, asset.size);
            if (range != null && !ifRangeMatches(exchange.getRequestHeaders().getFirst("If-Range"), asset)) {
                range = null;
            }
            if (range != null && range.unsatisfiable) {
                headers.set("Content-Range", "bytes */" + asset.size);
                send(exchange, 416);
                return;
            }
            long start = range == null ? 0 : range.start;
            long length = range == null ? asset.size : range.end - range.start + 1;
            int status = range == null ? 200 : 206;
            if (range != null) headers.set("Content-Range", "bytes " + range.start + "-" + range.end + "/" + asset.size);
            headers.set("Content-Length", Long.toString(length));
            if (method.equals("HEAD")) {
                send(exchange, status);
                return;
            }
            exchange.sendResponseHeaders(status, length == 0 ? -1 : length);
            if (length > 0) {
                try (OutputStream output = exchange.getResponseBody()) {
                    asset.write(output, start, length);
                }
            }
        }
    }

    private Asset openFile(Mount.Directory mount, String local) throws IOException {
        Path root = mount.directory().toRealPath();
        Path candidate = root.resolve(local).normalize();
        if (!candidate.startsWith(root)) return null;
        Path real;
        try {
            real = candidate.toRealPath();
        } catch (IOException exception) {
            return null;
        }
        if (!real.startsWith(root) || !Files.isRegularFile(real)) return null;
        for (int attempt = 0; attempt < 4; attempt++) {
            BasicFileAttributes before = Files.readAttributes(real, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            FileChannel channel = FileChannel.open(real, StandardOpenOption.READ);
            BasicFileAttributes after = Files.readAttributes(real, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (before.isRegularFile() && after.isRegularFile()
                    && sameFile(before, after) && channel.size() == before.size()) {
                String tag = fileTag(before);
                return new Asset(real.toString(), tag, before.size(), before.lastModifiedTime().toInstant(), channel, null);
            }
            channel.close();
        }
        throw new IOException("File changed during opening");
    }

    private static boolean sameFile(BasicFileAttributes left, BasicFileAttributes right) {
        return java.util.Objects.equals(left.fileKey(), right.fileKey()) && left.size() == right.size()
                && left.lastModifiedTime().equals(right.lastModifiedTime());
    }

    private static String fileTag(BasicFileAttributes attributes) {
        String value = Long.toHexString(attributes.size()) + '-' + Long.toHexString(attributes.lastModifiedTime().to(java.util.concurrent.TimeUnit.NANOSECONDS))
                + '-' + Integer.toHexString(java.util.Objects.hashCode(attributes.fileKey()));
        return '"' + value + '"';
    }

    private Asset openResource(String name) throws IOException {
        Asset cached = resources.get(name);
        if (cached != null) return cached;
        try (InputStream input = config.classLoader().getResourceAsStream(name)) {
            if (input == null) return null;
            byte[] bytes = input.readAllBytes();
            Asset resource = new Asset(name, '"' + sha256(bytes) + '"', bytes.length, null, null, bytes);
            Asset prior = resources.putIfAbsent(name, resource);
            return prior == null ? resource : prior;
        }
    }

    private static String sha256(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private byte[] gzip(Asset asset) throws IOException {
        String key = asset.name + '\0' + asset.etag;
        synchronized (gzipCache) {
            byte[] hit = gzipCache.get(key);
            if (hit != null) return hit;
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (GZIPOutputStream compressed = new GZIPOutputStream(output)) {
            asset.write(compressed, 0, asset.size);
        }
        byte[] bytes = output.toByteArray();
        synchronized (gzipCache) {
            if (bytes.length <= config.gzipCacheBytes()) {
                byte[] previous = gzipCache.put(key, bytes);
                if (previous != null) cachedBytes -= previous.length;
                cachedBytes += bytes.length;
                var iterator = gzipCache.entrySet().iterator();
                while (cachedBytes > config.gzipCacheBytes() && iterator.hasNext()) {
                    Map.Entry<String, byte[]> entry = iterator.next();
                    cachedBytes -= entry.getValue().length;
                    iterator.remove();
                }
            }
        }
        return bytes;
    }

    private static void writeBytes(HttpExchange exchange, String method, int status, byte[] bytes) throws IOException {
        exchange.getResponseHeaders().set("Content-Length", Integer.toString(bytes.length));
        if (method.equals("HEAD")) {
            send(exchange, status);
        } else {
            exchange.sendResponseHeaders(status, bytes.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        }
    }

    private static void send(HttpExchange exchange, int status) throws IOException {
        exchange.sendResponseHeaders(status, -1);
    }

    private static String decode(String raw) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        for (int i = 0; i < raw.length();) {
            int point = raw.codePointAt(i);
            if (point == '%') {
                if (i + 2 >= raw.length()) throw new IllegalArgumentException("Invalid escape");
                int high = Character.digit(raw.charAt(i + 1), 16);
                int low = Character.digit(raw.charAt(i + 2), 16);
                if (high < 0 || low < 0) throw new IllegalArgumentException("Invalid escape");
                bytes.write((high << 4) | low);
                i += 3;
            } else {
                bytes.writeBytes(new String(Character.toChars(point)).getBytes(StandardCharsets.UTF_8));
                i += Character.charCount(point);
            }
        }
        try {
            return StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException exception) {
            throw new IllegalArgumentException("Invalid UTF-8", exception);
        }
    }

    private static boolean matchesNone(String value, String etag) {
        if (value == null) return false;
        for (String candidate : value.split(",")) {
            String tag = candidate.trim();
            if (tag.equals("*") || tag.equals(etag) || tag.equals("W/" + etag)) return true;
        }
        return false;
    }

    private static boolean ifRangeMatches(String value, Asset asset) {
        if (value == null) return true;
        if (value.startsWith("\"") || value.startsWith("W/")) return value.equals(asset.etag);
        if (asset.modified == null) return false;
        try {
            return Instant.from(HTTP_DATE.parse(value)).equals(asset.modified.truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        } catch (java.time.DateTimeException exception) {
            return false;
        }
    }

    private static Range parseRange(String value, long size) {
        if (value == null || !value.startsWith("bytes=") || value.indexOf(',') >= 0) return null;
        String input = value.substring(6);
        if (!input.matches("[0-9]*-[0-9]*") || input.equals("-")) return null;
        int separator = input.indexOf('-');
        try {
            String left = input.substring(0, separator);
            String right = input.substring(separator + 1);
            long start;
            long end;
            if (left.isEmpty()) {
                long suffix = Long.parseLong(right);
                if (suffix == 0 || size == 0) return new Range(0, 0, true);
                start = Math.max(0, size - suffix);
                end = size - 1;
            } else {
                start = Long.parseLong(left);
                end = right.isEmpty() ? size - 1 : Long.parseLong(right);
                if (start >= size || start > end) return new Range(0, 0, true);
                end = Math.min(end, size - 1);
            }
            return new Range(start, end, false);
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private static boolean acceptsGzip(String value) {
        if (value == null) return false;
        for (String item : value.split(",")) {
            String[] fields = item.trim().split(";");
            if (!fields[0].trim().equalsIgnoreCase("gzip")) continue;
            for (int i = 1; i < fields.length; i++) {
                String field = fields[i].trim();
                if (field.startsWith("q=")) {
                    try {
                        return Double.parseDouble(field.substring(2)) > 0;
                    } catch (NumberFormatException exception) {
                        return false;
                    }
                }
            }
            return true;
        }
        return false;
    }

    private static boolean compressible(String name) {
        return List.of(".json", ".js", ".mjs", ".css", ".html", ".svg", ".webmanifest")
                .stream().anyMatch(name::endsWith);
    }

    private static String contentType(String name) {
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".js") || name.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        if (name.endsWith(".json")) return "application/json; charset=utf-8";
        if (name.endsWith(".wasm")) return "application/wasm";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    private record Range(long start, long end, boolean unsatisfiable) { }

    private static final class Asset implements AutoCloseable {
        private final String name;
        private final String etag;
        private final long size;
        private final Instant modified;
        private final FileChannel channel;
        private final byte[] bytes;

        private Asset(String name, String etag, long size, Instant modified, FileChannel channel, byte[] bytes) {
            this.name = name;
            this.etag = etag;
            this.size = size;
            this.modified = modified;
            this.channel = channel;
            this.bytes = bytes;
        }

        private void write(OutputStream output, long start, long length) throws IOException {
            if (bytes != null) {
                output.write(bytes, Math.toIntExact(start), Math.toIntExact(length));
                return;
            }
            ByteBuffer buffer = ByteBuffer.allocate(64 * 1024);
            long position = start;
            long remaining = length;
            while (remaining > 0) {
                buffer.clear();
                buffer.limit((int) Math.min(buffer.capacity(), remaining));
                int count = channel.read(buffer, position);
                if (count < 0) throw new IOException("File shortened during read");
                if (count == 0) continue;
                output.write(buffer.array(), 0, count);
                position += count;
                remaining -= count;
            }
        }

        @Override public void close() throws IOException {
            if (channel != null) channel.close();
        }
    }
}
