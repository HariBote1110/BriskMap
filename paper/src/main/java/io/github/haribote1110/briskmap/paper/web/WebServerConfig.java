package io.github.haribote1110.briskmap.paper.web;

import java.util.List;
import java.util.Objects;
import java.util.logging.Logger;

/** Settings for the embedded HTTP server. */
public record WebServerConfig(String bindAddress, int port, int threads, long gzipCacheBytes,
        List<Mount> mounts, ClassLoader classLoader, Logger logger) {
    public WebServerConfig {
        Objects.requireNonNull(bindAddress);
        Objects.requireNonNull(mounts);
        Objects.requireNonNull(classLoader);
        Objects.requireNonNull(logger);
        mounts = List.copyOf(mounts);
        if (port < 0 || port > 65535 || threads < 1 || gzipCacheBytes < 0) {
            throw new IllegalArgumentException("Invalid server settings");
        }
    }

    public WebServerConfig(List<Mount> mounts, ClassLoader classLoader, Logger logger) {
        this("0.0.0.0", 8123, 4, 16L * 1024 * 1024, mounts, classLoader, logger);
    }
}
