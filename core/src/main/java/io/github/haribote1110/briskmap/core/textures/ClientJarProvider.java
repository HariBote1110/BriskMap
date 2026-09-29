package io.github.haribote1110.briskmap.core.textures;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

/** Retrieves an authenticated Minecraft client jar. Call only after the plugin obtains user consent. */
public final class ClientJarProvider {
    private static final URI DEFAULT_MANIFEST = URI.create("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    private final URI manifest;
    private final HttpClient client;

    public ClientJarProvider() { this(DEFAULT_MANIFEST); }
    public ClientJarProvider(URI manifest) {
        this.manifest = manifest;
        this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).followRedirects(HttpClient.Redirect.NORMAL).build();
    }

    /** Obtain a verified jar. The caller must have user consent before invoking this method. */
    public Path obtain(String versionId, Path cacheDir) throws IOException, InterruptedException {
        if (versionId.isEmpty() || versionId.contains("/") || versionId.contains("\\") || versionId.equals(".") || versionId.equals(".."))
            throw new IllegalArgumentException("Invalid Minecraft version id: " + versionId);
        Map<String,Object> catalogue = Json.object(Json.parse(fetchText(manifest)));
        Map<String,Object> version = null;
        for (Object item : (List<?>) catalogue.get("versions")) {
            Map<String,Object> candidate = Json.object(item);
            if (versionId.equals(candidate.get("id"))) { version = candidate; break; }
        }
        if (version == null) throw new IllegalArgumentException("Unknown Minecraft version id: " + versionId);
        Map<String,Object> metadata = Json.object(Json.parse(fetchText(URI.create((String) version.get("url")))));
        Map<String,Object> download = Json.object(Json.object(metadata.get("downloads")).get("client"));
        String sha1 = (String) download.get("sha1"); long size = ((Number) download.get("size")).longValue();
        Files.createDirectories(cacheDir);
        Path destination = cacheDir.resolve("minecraft-client-" + versionId + ".jar");
        if (Files.isRegularFile(destination) && Files.size(destination) == size && sha1.equalsIgnoreCase(digest(destination))) return destination;
        Path temporary = Files.createTempFile(cacheDir, "minecraft-client-", ".tmp");
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create((String) download.get("url"))).timeout(Duration.ofSeconds(120)).GET().build();
            HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                response.body().close();
                throw new IOException("Client jar HTTP " + response.statusCode());
            }
            try (InputStream body = response.body()) { Files.copy(body, temporary, StandardCopyOption.REPLACE_EXISTING); }
            if (Files.size(temporary) != size) throw new IOException("Client jar size mismatch for " + versionId);
            if (!sha1.equalsIgnoreCase(digest(temporary))) throw new IOException("Client jar SHA-1 mismatch for " + versionId);
            Files.move(temporary, destination, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            return destination;
        } finally { Files.deleteIfExists(temporary); }
    }

    private String fetchText(URI uri) throws IOException, InterruptedException {
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(120)).GET().build();
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (response.statusCode() < 200 || response.statusCode() >= 300) throw new IOException("HTTP " + response.statusCode() + " for " + uri);
        return response.body();
    }

    private static String digest(Path path) throws IOException {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            try (InputStream input = Files.newInputStream(path)) {
                byte[] buffer = new byte[8192]; int count;
                while ((count = input.read(buffer)) >= 0) sha.update(buffer, 0, count);
            }
            return HexFormat.of().formatHex(sha.digest());
        } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
}
