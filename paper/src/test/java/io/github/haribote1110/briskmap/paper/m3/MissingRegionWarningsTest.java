package io.github.haribote1110.briskmap.paper.m3;

import io.github.haribote1110.briskmap.paper.world.MissingRegionWarnings;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class MissingRegionWarningsTest {
    @Test void warnsOncePerWorldUntilReload() {
        MissingRegionWarnings warnings = new MissingRegionWarnings();
        assertTrue(warnings.shouldWarn("world_nether"));
        assertFalse(warnings.shouldWarn("world_nether"));
        assertTrue(warnings.shouldWarn("world_the_end"));
        assertFalse(warnings.shouldWarn("world_the_end"));
        warnings.reset();
        assertTrue(warnings.shouldWarn("world_nether"));
        assertFalse(warnings.shouldWarn("world_nether"));
    }
}
