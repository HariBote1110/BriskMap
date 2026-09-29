package io.github.haribote1110.briskmap.core;

import io.github.haribote1110.briskmap.core.textures.Json;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/** Immutable block names and their canonical default states. */
public final class BlockDefaults {
    private static final BlockDefaults EMPTY = new BlockDefaults(Map.of());
    private final Map<String, String> states;

    private BlockDefaults(Map<String, String> states) { this.states = Map.copyOf(states); }

    public static BlockDefaults empty() { return EMPTY; }

    public static BlockDefaults of(Map<String, String> states) {
        Objects.requireNonNull(states);
        if (states.isEmpty()) return EMPTY;
        Map<String, String> canonical = new HashMap<>();
        for (var entry : states.entrySet()) canonical.put(entry.getKey(), canonical(entry.getKey(), entry.getValue()));
        return new BlockDefaults(canonical);
    }

    /**
     * Returns {@code state} in core's canonical form (properties sorted by their {@code key=value} text),
     * or throws {@link IllegalArgumentException} when it is not a state of the block {@code name}.
     */
    public static String canonical(String name, String state) {
        Objects.requireNonNull(name);
        Objects.requireNonNull(state);
        int opening = state.indexOf('[');
        if (opening < 0) {
            if (!state.equals(name)) throw new IllegalArgumentException("Default state name differs: " + name);
            return state;
        }
        if (opening != name.length() || !state.startsWith(name) || !state.endsWith("]") || opening + 2 >= state.length())
            throw new IllegalArgumentException("Invalid default state: " + state);
        String[] properties = state.substring(opening + 1, state.length() - 1).split(",");
        for (String property : properties)
            if (property.indexOf('=') <= 0) throw new IllegalArgumentException("Invalid default state: " + state);
        Arrays.sort(properties);
        return name + "[" + String.join(",", properties) + "]";
    }

    public static BlockDefaults readJson(Path path) throws IOException {
        Map<String, Object> object = Json.object(Json.parse(Files.readString(path)));
        Map<String, String> states = new HashMap<>();
        for (var entry : object.entrySet()) {
            if (!(entry.getValue() instanceof String state))
                throw new IllegalArgumentException("Default state must be a string: " + entry.getKey());
            states.put(entry.getKey(), state);
        }
        return of(states);
    }

    public boolean isEmpty() { return states.isEmpty(); }

    public String state(String name) { return states.getOrDefault(name, name); }

    @Override public boolean equals(Object other) {
        return other instanceof BlockDefaults defaults && states.equals(defaults.states);
    }

    @Override public int hashCode() { return states.hashCode(); }
}
