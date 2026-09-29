package io.github.haribote1110.briskmap.core.textures;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ClientJarProviderTest {
    @TempDir Path temporary;

    @Test void downloadReuseAndErrors() throws Exception {
        byte[] jar = "fake client jar".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(jar));
        AtomicInteger downloads = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/manifest", exchange -> respond(exchange, 200, "{\"versions\":[{\"id\":\"ok\",\"url\":\""+base+"/version\"},{\"id\":\"bad-sha\",\"url\":\""+base+"/bad-sha\"},{\"id\":\"bad-size\",\"url\":\""+base+"/bad-size\"},{\"id\":\"not-found\",\"url\":\""+base+"/404\"},{\"id\":\"server-error\",\"url\":\""+base+"/500\"}]}"));
        server.createContext("/version", exchange -> respond(exchange, 200, version(base,sha,jar.length)));
        server.createContext("/bad-sha", exchange -> respond(exchange, 200, version(base,"0000000000000000000000000000000000000000",jar.length)));
        server.createContext("/bad-size", exchange -> respond(exchange, 200, version(base,sha,jar.length+1)));
        server.createContext("/jar", exchange -> { downloads.incrementAndGet(); exchange.sendResponseHeaders(200,jar.length); try (var body=exchange.getResponseBody()) { body.write(jar); } });
        server.createContext("/404", exchange -> respond(exchange,404,"missing")); server.createContext("/500", exchange -> respond(exchange,500,"error"));
        server.start();
        try {
            ClientJarProvider provider = new ClientJarProvider(URI.create(base+"/manifest"));
            Path cached = provider.obtain("ok", temporary); assertArrayEquals(jar,Files.readAllBytes(cached));
            assertEquals(cached, provider.obtain("ok",temporary)); assertEquals(1,downloads.get());
            Files.writeString(cached, "damaged");
            assertEquals(cached, provider.obtain("ok",temporary)); assertArrayEquals(jar,Files.readAllBytes(cached)); assertEquals(2,downloads.get());
            assertThrows(Exception.class, () -> provider.obtain("bad-sha", temporary)); assertFalse(Files.exists(temporary.resolve("minecraft-client-bad-sha.jar")));
            assertThrows(Exception.class, () -> provider.obtain("bad-size", temporary)); assertFalse(Files.exists(temporary.resolve("minecraft-client-bad-size.jar")));
            Exception unknown = assertThrows(Exception.class, () -> provider.obtain("unknown-id", temporary)); assertTrue(unknown.getMessage().contains("unknown-id"));
            assertThrows(Exception.class, () -> provider.obtain("not-found", temporary)); assertThrows(Exception.class, () -> provider.obtain("server-error", temporary));
        } finally { server.stop(0); }
    }

    private static String version(String base,String sha,int size) { return "{\"downloads\":{\"client\":{\"url\":\""+base+"/jar\",\"sha1\":\""+sha+"\",\"size\":"+size+"}}}"; }
    private static void respond(com.sun.net.httpserver.HttpExchange exchange,int status,String value) throws java.io.IOException {
        byte[] body=value.getBytes(java.nio.charset.StandardCharsets.UTF_8); exchange.sendResponseHeaders(status,body.length); try (var out=exchange.getResponseBody()) { out.write(body); }
    }
}
