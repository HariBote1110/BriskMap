package io.github.haribote1110.briskmap.core.textures;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Small JSON reader and Node-compatible two-space writer for asset documents. */
public final class Json {
    private Json() { }

    public static Object parse(String text) {
        Parser parser = new Parser(text);
        Object value = parser.value();
        parser.space();
        if (parser.position != text.length()) throw new IllegalArgumentException("Trailing JSON data");
        return value;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException("Expected JSON object");
        return (Map<String, Object>) value;
    }

    public static String stringify(Object value) {
        StringBuilder output = new StringBuilder();
        write(output, value, 0);
        return output.append('\n').toString();
    }

    private static void write(StringBuilder output, Object value, int depth) {
        if (value == null) output.append("null");
        else if (value instanceof String string) quote(output, string);
        else if (value instanceof Number || value instanceof Boolean) output.append(value);
        else if (value instanceof Map<?, ?> map) {
            output.append('{');
            int index = 0;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (index++ > 0) output.append(',');
                output.append('\n'); indent(output, depth + 1); quote(output, (String) entry.getKey()); output.append(": ");
                write(output, entry.getValue(), depth + 1);
            }
            if (!map.isEmpty()) { output.append('\n'); indent(output, depth); }
            output.append('}');
        } else if (value instanceof Iterable<?> list) {
            output.append('[');
            int index = 0;
            for (Object item : list) {
                if (index++ > 0) output.append(',');
                output.append('\n'); indent(output, depth + 1); write(output, item, depth + 1);
            }
            if (index > 0) { output.append('\n'); indent(output, depth); }
            output.append(']');
        } else throw new IllegalArgumentException("Unsupported JSON value: " + value.getClass());
    }

    private static void indent(StringBuilder output, int depth) { output.append("  ".repeat(depth)); }

    private static void quote(StringBuilder output, String string) {
        output.append('"');
        for (int i = 0; i < string.length(); i++) {
            char c = string.charAt(i);
            switch (c) {
                case '"' -> output.append("\\\"");
                case '\\' -> output.append("\\\\");
                case '\b' -> output.append("\\b");
                case '\f' -> output.append("\\f");
                case '\n' -> output.append("\\n");
                case '\r' -> output.append("\\r");
                case '\t' -> output.append("\\t");
                default -> {
                    if (c < 32) output.append(String.format("\\u%04x", (int) c));
                    else output.append(c);
                }
            }
        }
        output.append('"');
    }

    private static final class Parser {
        private final String input;
        private int position;
        Parser(String input) { this.input = input; }
        void space() { while (position < input.length() && " \t\r\n".indexOf(input.charAt(position)) >= 0) position++; }
        Object value() {
            space();
            if (position >= input.length()) throw error();
            char c = input.charAt(position);
            if (c == '"') return string();
            if (c == '{') return object();
            if (c == '[') return array();
            if (c == 't') return literal("true", true);
            if (c == 'f') return literal("false", false);
            if (c == 'n') return literal("null", null);
            if (c == '-' || c >= '0' && c <= '9') return number();
            throw error();
        }
        private Object literal(String token, Object value) {
            if (!input.startsWith(token, position)) throw error();
            position += token.length(); return value;
        }
        private Map<String, Object> object() {
            position++; Map<String, Object> result = new LinkedHashMap<>(); space();
            if (take('}')) return result;
            do {
                space(); if (position >= input.length() || input.charAt(position) != '"') throw error();
                String key = string(); space(); require(':'); result.put(key, value()); space();
                if (take('}')) return result;
                require(',');
            } while (true);
        }
        private List<Object> array() {
            position++; List<Object> result = new ArrayList<>(); space();
            if (take(']')) return result;
            do {
                result.add(value()); space(); if (take(']')) return result; require(',');
            } while (true);
        }
        private String string() {
            require('"'); StringBuilder result = new StringBuilder();
            while (position < input.length()) {
                char c = input.charAt(position++);
                if (c == '"') return result.toString();
                if (c < 32) throw error();
                if (c != '\\') { result.append(c); continue; }
                if (position >= input.length()) throw error();
                char escape = input.charAt(position++);
                switch (escape) {
                    case '"', '\\', '/' -> result.append(escape);
                    case 'b' -> result.append('\b'); case 'f' -> result.append('\f');
                    case 'n' -> result.append('\n'); case 'r' -> result.append('\r'); case 't' -> result.append('\t');
                    case 'u' -> {
                        if (position + 4 > input.length()) throw error();
                        try { result.append((char) Integer.parseInt(input.substring(position, position + 4), 16)); }
                        catch (NumberFormatException exception) { throw error(); }
                        position += 4;
                    }
                    default -> throw error();
                }
            }
            throw error();
        }
        private Number number() {
            int start = position;
            take('-');
            if (take('0')) { if (digit()) throw error(); }
            else { if (!digit()) throw error(); while (digit()) position++; }
            if (take('.')) { if (!digit()) throw error(); while (digit()) position++; }
            if (take('e') || take('E')) { if (!take('+')) take('-'); if (!digit()) throw error(); while (digit()) position++; }
            String token = input.substring(start, position);
            try {
                if (token.indexOf('.') >= 0 || token.indexOf('e') >= 0 || token.indexOf('E') >= 0) return Double.valueOf(token);
                return Long.valueOf(token);
            }
            catch (NumberFormatException exception) { return Double.valueOf(token); }
        }
        private boolean digit() { return position < input.length() && input.charAt(position) >= '0' && input.charAt(position) <= '9'; }
        private boolean take(char c) { if (position < input.length() && input.charAt(position) == c) { position++; return true; } return false; }
        private void require(char c) { if (!take(c)) throw error(); }
        private IllegalArgumentException error() { return new IllegalArgumentException("Invalid JSON at offset " + position); }
    }
}
