package io.github.haribote1110.briskmap.core.textures;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TextureBuilderPermissionsTest {
    @TempDir Path temporary;

    @Test void publishedFilesRespectUmask() throws Exception {
        assumeTrue(Files.getFileStore(temporary).supportsFileAttributeView("posix"));
        Path jar = temporary.resolve("client.jar");
        try (var zip = new ZipOutputStream(Files.newOutputStream(jar))) { zip.finish(); }

        Path output = temporary.resolve("web/textures/26.3");
        TextureBuilder.build(jar, output);
        Path reference = output.resolve("reference");
        try (var stream = Files.newOutputStream(reference, StandardOpenOption.CREATE,
                StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) { stream.flush(); }
        Set<PosixFilePermission> expected = Files.getPosixFilePermissions(reference);
        for (String name : new String[] {"atlas.png", "blocks.json"}) {
            Set<PosixFilePermission> actual = Files.getPosixFilePermissions(output.resolve(name));
            assertEquals(expected, actual, name);
            for (PosixFilePermission read : new PosixFilePermission[] {
                    PosixFilePermission.GROUP_READ, PosixFilePermission.OTHERS_READ}) {
                assertTrue(!expected.contains(read) || actual.contains(read), name + " lacks " + read);
            }
        }
    }
}
