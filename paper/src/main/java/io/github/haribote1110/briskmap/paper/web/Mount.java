package io.github.haribote1110.briskmap.paper.web;

import java.nio.file.Path;
import java.util.Objects;

/** A URL path prefix backed by a directory or classpath resources. */
public sealed interface Mount permits Mount.Directory, Mount.Classpath {
    String prefix();

    static void checkPrefix(String prefix) {
        Objects.requireNonNull(prefix);
        if (!prefix.startsWith("/") || !prefix.endsWith("/") || prefix.contains("//")) {
            throw new IllegalArgumentException("Mount prefix must start and end with '/'");
        }
    }

    record Directory(String prefix, Path directory) implements Mount {
        public Directory {
            checkPrefix(prefix);
            Objects.requireNonNull(directory);
        }
    }

    record Classpath(String prefix, String resourceRoot) implements Mount {
        public Classpath {
            checkPrefix(prefix);
            Objects.requireNonNull(resourceRoot);
            if (resourceRoot.startsWith("/") || (!resourceRoot.isEmpty() && !resourceRoot.endsWith("/"))
                    || resourceRoot.contains("..") || resourceRoot.contains("\\")) {
                throw new IllegalArgumentException("Invalid resource root");
            }
        }
    }
}
