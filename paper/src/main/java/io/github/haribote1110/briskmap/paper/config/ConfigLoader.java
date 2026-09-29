package io.github.haribote1110.briskmap.paper.config;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;

public final class ConfigLoader {
    private ConfigLoader() { }

    public static BriskMapConfig load(Map<String, ?> values, Consumer<String> warning) {
        return load(values::get, warning);
    }

    public static BriskMapConfig load(Function<String, ?> values, Consumer<String> warning) {
        boolean web = bool(values, warning, "web.enabled", true);
        String bind = string(values, warning, "web.bind", "0.0.0.0");
        int port = number(values, warning, "web.port", 8123, 1, 65535);
        int webThreads = number(values, warning, "web.threads", 4, 1, 256);
        int threads = number(values, warning, "extract.threads", 0, 0, 256);
        if (threads == 0) threads = Math.max(1, Runtime.getRuntime().availableProcessors() / 2);
        String caves = choice(values, warning, "extract.caves", "hide", "hide", "show");
        String fluids = choice(values, warning, "extract.fluids", "surface", "surface", "all");
        int compression = number(values, warning, "extract.compression-level", 6, 0, 9);
        int interval = number(values, warning, "extract.scan-interval-seconds", 30, 1, 86400);
        Object excluded = values.apply("worlds.exclude");
        List<String> worlds = List.of();
        if (excluded instanceof List<?> list && list.stream().allMatch(String.class::isInstance)) {
            worlds = list.stream().map(String.class::cast).toList();
        } else if (excluded != null) warning.accept("Invalid worlds.exclude; using default");
        boolean download = bool(values, warning, "textures.accept-mojang-download", false);
        return new BriskMapConfig(web, bind, port, webThreads, threads, caves, fluids,
                compression, interval, worlds, download);
    }

    private static boolean bool(Function<String, ?> values, Consumer<String> warning, String key, boolean fallback) {
        Object value = values.apply(key);
        if (value == null) return fallback;
        if (value instanceof Boolean valid) return valid;
        warning.accept("Invalid " + key + "; using default");
        return fallback;
    }

    private static String string(Function<String, ?> values, Consumer<String> warning, String key, String fallback) {
        Object value = values.apply(key);
        if (value == null) return fallback;
        if (value instanceof String valid && !valid.isBlank()) return valid;
        warning.accept("Invalid " + key + "; using default");
        return fallback;
    }

    private static int number(Function<String, ?> values, Consumer<String> warning, String key, int fallback, int min, int max) {
        Object value = values.apply(key);
        if (value == null) return fallback;
        if (value instanceof Number number) {
            double candidate = number.doubleValue();
            if (candidate >= min && candidate <= max && candidate == Math.rint(candidate)) return number.intValue();
        }
        warning.accept("Invalid " + key + "; using default");
        return fallback;
    }

    private static String choice(Function<String, ?> values, Consumer<String> warning, String key,
            String fallback, String first, String second) {
        Object value = values.apply(key);
        if (value == null) return fallback;
        if (value.equals(first) || value.equals(second)) return (String) value;
        warning.accept("Invalid " + key + "; using default");
        return fallback;
    }
}
