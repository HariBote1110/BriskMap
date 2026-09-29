package io.github.haribote1110.briskmap.paper.textures;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import io.github.haribote1110.briskmap.paper.index.MapIndexWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class MapIndexPermissionsTest {
    @TempDir Path temporary;

    @Test void publishedIndexRespectsUmask() throws Exception {
        assumeTrue(Files.getFileStore(temporary).supportsFileAttributeView("posix"));
        Path index = temporary.resolve("web/maps/index.json");
        assertTrue(new MapIndexWriter(index).write(List.of()));
        Path reference = index.resolveSibling("reference");
        try (var stream = Files.newOutputStream(reference, StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) { stream.flush(); }
        Set<PosixFilePermission> expected = Files.getPosixFilePermissions(reference);
        Set<PosixFilePermission> actual = Files.getPosixFilePermissions(index);
        assertEquals(expected, actual);
        for (PosixFilePermission read : new PosixFilePermission[] {
                PosixFilePermission.GROUP_READ, PosixFilePermission.OTHERS_READ}) {
            assertTrue(!expected.contains(read) || actual.contains(read), "index lacks " + read);
        }
    }
}
