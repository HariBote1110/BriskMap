package io.github.haribote1110.briskmap.core.extract;


import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class Palette {
    private final Map<String, Integer> indices = new HashMap<>();
    private final List<String> entries = new ArrayList<>();
    public int index(String value) {
        Integer found = indices.get(value);
        if (found != null) return found;
        int next = entries.size();
        entries.add(value);
        indices.put(value, next);
        return next;
    }
    public String get(int index) { return entries.get(index); }
    public int size() { return entries.size(); }
    public List<String> entries() { return entries; }
}
