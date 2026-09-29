package io.github.haribote1110.briskmap.paper.textures;

import io.github.haribote1110.briskmap.core.textures.Json;
import io.github.haribote1110.briskmap.core.textures.TextureBuilder;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.logging.Logger;
import java.util.stream.Stream;

/** Builds server-local texture assets without depending on Bukkit. */
public final class TextureService {
    @FunctionalInterface public interface JarProvider {
        Path obtain(String versionId, Path cacheDir) throws IOException, InterruptedException;
    }
    public enum Status { NOT_READY, BUILDING, READY, FAILED }
    public record State(Status status, String version, String relativeUrl, String message) { }

    private final String version;
    private final Path cacheDir;
    private final Path texturesRoot;
    private final JarProvider provider;
    private final Logger logger;
    private final Executor executor;
    private final Runnable changed;
    private volatile boolean consent;
    private volatile State state;
    private CompletableFuture<State> running;
    private boolean warnedNoConsent;

    public TextureService(String version, Path cacheDir, Path texturesRoot, boolean consent,
            JarProvider provider, Logger logger, Executor executor, Runnable changed) {
        if (version.isBlank() || version.equals(".") || version.equals("..") || version.contains("/") || version.contains("\\"))
            throw new IllegalArgumentException("Invalid Minecraft version id: " + version);
        this.version = version;
        this.cacheDir = cacheDir;
        this.texturesRoot = texturesRoot;
        this.consent = consent;
        this.provider = provider;
        this.logger = logger;
        this.executor = executor;
        this.changed = changed;
        this.state = new State(Status.NOT_READY, version, null, null);
    }

    public State state() { return state; }
    public void setConsent(boolean value) { consent = value; }
    public synchronized CompletableFuture<State> ensure() { return start(false); }
    public synchronized CompletableFuture<State> rebuild() { return start(true); }

    private CompletableFuture<State> start(boolean force) {
        if (running != null && !running.isDone())
            return force ? running.thenCompose(ignored -> rebuild()) : running;
        if (!force && (state.status() == Status.READY || state.status() == Status.FAILED))
            return CompletableFuture.completedFuture(state);
        publish(new State(Status.BUILDING, version, null, null));
        CompletableFuture<State> result = new CompletableFuture<>();
        running = result;
        try {
            executor.execute(() -> {
                State outcome;
                try { outcome = build(force); }
                catch (IOException | InterruptedException | RuntimeException exception) {
                    if (exception instanceof InterruptedException) Thread.currentThread().interrupt();
                    String message = Objects.toString(exception.getMessage(), exception.getClass().getSimpleName());
                    logger.warning("Texture generation failed for " + version + ": " + message);
                    outcome = new State(Status.FAILED, version, null, message);
                }
                publish(outcome);
                result.complete(outcome);
            });
        } catch (RuntimeException exception) {
            String message = Objects.toString(exception.getMessage(), exception.getClass().getSimpleName());
            logger.warning("Texture generation failed for " + version + ": " + message);
            State failed = new State(Status.FAILED, version, null, message);
            publish(failed);
            result.complete(failed);
        }
        return result;
    }

    private State build(boolean force) throws IOException, InterruptedException {
        Path folder = texturesRoot.resolve(version);
        if (force) remove(folder);
        if (ready(folder)) return new State(Status.READY, version, "textures/" + version + "/", null);
        Path jar = cacheDir.resolve("minecraft-client-" + version + ".jar");
        if (!Files.isRegularFile(jar)) {
            if (!consent) {
                if (!warnedNoConsent) {
                    logger.warning("Textures unavailable: set textures.accept-mojang-download: true to download the client jar from Mojang "
                            + "and accept the Minecraft EULA https://www.minecraft.net/en-us/eula ; or place the client jar at "
                            + jar + ". The map shows plain colours meanwhile.");
                    warnedNoConsent = true;
                }
                return new State(Status.NOT_READY, version, null, null);
            }
            jar = provider.obtain(version, cacheDir);
        }
        TextureBuilder.build(jar, folder);
        cleanOldVersions();
        return new State(Status.READY, version, "textures/" + version + "/", null);
    }

    private boolean ready(Path folder) throws IOException {
        if (!Files.isRegularFile(folder.resolve("atlas.png")) || !Files.isRegularFile(folder.resolve("blocks.json"))) return false;
        try {
            Object source = Json.object(Json.parse(Files.readString(folder.resolve("blocks.json")))).get("source");
            return ("minecraft-client-" + version + ".jar").equals(source);
        } catch (IllegalArgumentException exception) { return false; }
    }

    private void cleanOldVersions() throws IOException {
        try (Stream<Path> children = Files.list(texturesRoot)) {
            for (Path child : children.toList()) {
                if (!child.getFileName().toString().equals(version)
                        && Files.isDirectory(child, LinkOption.NOFOLLOW_LINKS)) remove(child);
            }
        }
    }

    private static void remove(Path folder) throws IOException {
        if (!Files.exists(folder, LinkOption.NOFOLLOW_LINKS)) return;
        try (Stream<Path> paths = Files.walk(folder)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
        }
    }

    private void publish(State next) {
        State previous = state;
        state = next;
        if (!previous.equals(next)) changed.run();
    }
}
