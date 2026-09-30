package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import org.junit.jupiter.api.Test;

class CaveDepthTest {
    @Test void defaultsToSixteenAndPreservesTheCut() {
        ExtractOptions options = new ExtractOptions(true, true, 6, true, true);
        assertEquals(16, options.caveDepth());
        assertEquals(16, options.withMaxY(80).caveDepth());
        assertEquals(0, options.withCaveDepth(0).caveDepth());
        assertThrows(IllegalArgumentException.class, () -> options.withCaveDepth(17));
    }
}
