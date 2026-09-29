package io.github.haribote1110.briskmap.paper.m3;

import io.github.haribote1110.briskmap.paper.StatusFormatter;
import java.time.Instant;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class StatusFormatterTest {
    @Test void formatsLocalScanTimeAndAge() {
        long scan = Instant.parse("2026-09-30T03:04:05Z").toEpochMilli();
        assertEquals("12:04:05 (7s ago)", StatusFormatter.lastScan(scan, scan + 7_900, ZoneId.of("Asia/Tokyo")));
        assertEquals("never", StatusFormatter.lastScan(0, scan, ZoneId.of("Asia/Tokyo")));
    }

    @Test void formatsUsableWebAddress() {
        assertEquals("http://192.0.2.5:8123/", StatusFormatter.webUrl("0.0.0.0", "192.0.2.5", 8123));
        assertEquals("http://localhost:8123/", StatusFormatter.webUrl("::", "", 8123));
        assertEquals("http://example.org:9000/", StatusFormatter.webUrl("example.org", "192.0.2.5", 9000));
        assertEquals("http://[::1]:9000/", StatusFormatter.webUrl("::1", "", 9000));
    }
}
