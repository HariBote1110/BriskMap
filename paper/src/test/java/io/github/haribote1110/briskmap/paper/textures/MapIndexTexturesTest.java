package io.github.haribote1110.briskmap.paper.textures;

import io.github.haribote1110.briskmap.paper.index.MapIndexWriter;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class MapIndexTexturesTest {
    @TempDir Path temporary;

    @Test void writesAndClearsTextureUrl() throws Exception {
        Path index = temporary.resolve("maps/index.json");
        MapIndexWriter writer = new MapIndexWriter(index);
        assertTrue(writer.write(List.of(), "textures/26.3/"));
        assertTrue(Files.readString(index).contains("\"textures\":\"textures/26.3/\""));
        assertFalse(writer.write(List.of(), "textures/26.3/"));
        assertTrue(writer.write(List.of(), null));
        assertTrue(Files.readString(index).contains("\"textures\":null"));
    }
}
