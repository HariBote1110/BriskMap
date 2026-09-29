package io.github.haribote1110.briskmap.paper;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

public final class StatusFormatter {
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss");

    private StatusFormatter() { }

    public static String lastScan(long scanMillis, long nowMillis, ZoneId zone) {
        if (scanMillis <= 0) return "never";
        String time = TIME.format(Instant.ofEpochMilli(scanMillis).atZone(zone));
        long seconds = Math.max(0, (nowMillis - scanMillis) / 1000);
        return time + " (" + seconds + "s ago)";
    }

    public static String webUrl(String bind, String serverIp, int port) {
        String host = bind.equals("0.0.0.0") || bind.equals("::")
                ? serverIp.isBlank() ? "localhost" : serverIp : bind;
        if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
        return "http://" + host + ":" + port + "/";
    }
}
