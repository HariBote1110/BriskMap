package io.github.haribote1110.briskmap.core;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class MilestoneTest {
    @Test
    void optionsAreImmutable() {
        ExtractOptions options = new ExtractOptions(true, true, 6, true, true);
        assertEquals(6, options.compressionLevel());
    }
}
