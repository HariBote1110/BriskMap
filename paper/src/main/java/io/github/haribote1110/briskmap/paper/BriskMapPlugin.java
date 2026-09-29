package io.github.haribote1110.briskmap.paper;

import io.github.haribote1110.briskmap.core.BlockDefaults;
import io.github.haribote1110.briskmap.paper.config.BriskMapConfig;
import io.github.haribote1110.briskmap.paper.config.ConfigLoader;
import io.github.haribote1110.briskmap.paper.extract.ExtractionService;
import io.github.haribote1110.briskmap.paper.index.MapIndexWriter;
import io.github.haribote1110.briskmap.paper.textures.TextureService;
import io.github.haribote1110.briskmap.core.textures.ClientJarProvider;
import io.github.haribote1110.briskmap.paper.world.MapTarget;
import io.github.haribote1110.briskmap.paper.world.MissingRegionWarnings;
import io.github.haribote1110.briskmap.paper.world.RegionFolderResolver;
import io.github.haribote1110.briskmap.paper.web.Mount;
import io.github.haribote1110.briskmap.paper.web.WebServer;
import io.github.haribote1110.briskmap.paper.web.WebServerConfig;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.PluginCommand;
import org.bukkit.command.TabCompleter;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.world.WorldLoadEvent;
import org.bukkit.event.world.WorldSaveEvent;
import org.bukkit.event.world.WorldUnloadEvent;
import org.bukkit.plugin.java.JavaPlugin;

public final class BriskMapPlugin extends JavaPlugin implements Listener, CommandExecutor, TabCompleter {
    private BriskMapConfig settings;
    private BlockDefaults blockDefaults = BlockDefaults.empty();
    private ExtractionService extraction;
    private WebServer web;
    private MapIndexWriter index;
    private TextureService textures;
    private ExecutorService textureWorker;
    private ExecutorService indexWorker;
    private Path mapsRoot;
    private final java.util.concurrent.atomic.AtomicBoolean indexQueued = new java.util.concurrent.atomic.AtomicBoolean();
    private final java.util.concurrent.atomic.AtomicBoolean indexDirty = new java.util.concurrent.atomic.AtomicBoolean();
    private final Map<String, Long> saveScans = new java.util.concurrent.ConcurrentHashMap<>();
    private final MissingRegionWarnings missingRegionWarnings = new MissingRegionWarnings();

    @Override public void onEnable() {
        missingRegionWarnings.reset();
        saveDefaultConfig();
        settings = readSettings();
        blockDefaults = serverBlockDefaults();
        Path root = getDataFolder().toPath().resolve("web");
        mapsRoot = root.resolve("maps");
        try {
            Files.createDirectories(mapsRoot);
            Files.createDirectories(root.resolve("textures"));
        } catch (IOException exception) {
            getLogger().log(Level.SEVERE, "Cannot create map directories", exception);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        index = new MapIndexWriter(mapsRoot.resolve("index.json"));
        indexWorker = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "BriskMap-index");
            thread.setDaemon(true);
            return thread;
        });
        startWeb();
        startExtraction();
        for (World world : getServer().getWorlds()) addWorld(world);
        startTextures(root);
        requestIndex();
        extraction.scanNow(null);
        getServer().getPluginManager().registerEvents(this, this);
        PluginCommand command = getCommand("briskmap");
        if (command != null) { command.setExecutor(this); command.setTabCompleter(this); }
        getLogger().info("BriskMap enabled on Minecraft " + getServer().getMinecraftVersion());
    }

    private BriskMapConfig readSettings() {
        FileConfiguration file = getConfig();
        return ConfigLoader.load(file::get, getLogger()::warning);
    }

    private BlockDefaults serverBlockDefaults() {
        Map<String, String> states = new HashMap<>();
        int failed = 0;
        for (Material material : Material.values()) {
            if (material.isLegacy() || !material.isBlock()) continue;
            try {
                String name = material.getKey().toString();
                states.put(name, BlockDefaults.canonical(name, material.createBlockData().getAsString()));
            } catch (RuntimeException exception) {
                failed++;
            }
        }
        getLogger().info("Block defaults: " + states.size() + " loaded, " + failed + " failed");
        return BlockDefaults.of(states);
    }

    private void startWeb() {
        if (!settings.webEnabled()) return;
        Path root = getDataFolder().toPath().resolve("web");
        WebServerConfig config = new WebServerConfig(settings.webBind(), settings.webPort(), settings.webThreads(),
                16L * 1024 * 1024,
                List.of(new Mount.Directory("/maps/", mapsRoot),
                        new Mount.Directory("/textures/", root.resolve("textures")),
                        new Mount.Classpath("/", "web/")), getClassLoader(), getLogger());
        WebServer candidate = new WebServer(config);
        try {
            candidate.start();
            web = candidate;
            getLogger().info("Web server listening on " + settings.webBind() + ":" + candidate.port());
        } catch (IOException | RuntimeException exception) {
            getLogger().severe("Web server could not bind " + settings.webBind() + ":" + settings.webPort()
                    + " (possibly already in use): " + exception.getMessage());
        }
    }

    private void startExtraction() {
        extraction = new ExtractionService(settings.extractThreads(), settings.scanIntervalSeconds(),
                settings.options().withBlockDefaults(blockDefaults), getLogger(), this::requestIndex);
    }

    private void addWorld(World world) {
        String id = world.getName();
        if (settings.excludedWorlds().contains(id)) return;
        Path out = mapsRoot.resolve(id).normalize();
        if (!out.getParent().equals(mapsRoot)) {
            getLogger().warning("Unsafe world name ignored: " + id);
            return;
        }
        var key = world.getKey();
        RegionFolderResolver.Environment environment = switch (world.getEnvironment()) {
            case NORMAL -> RegionFolderResolver.Environment.NORMAL;
            case NETHER -> RegionFolderResolver.Environment.NETHER;
            case THE_END -> RegionFolderResolver.Environment.THE_END;
            default -> RegionFolderResolver.Environment.CUSTOM;
        };
        RegionFolderResolver.resolve(world.getWorldFolder().toPath(), key.getNamespace(), key.getKey(), environment)
                .ifPresentOrElse(region -> {
                    var spawn = world.getSpawnLocation();
                    extraction.add(new MapTarget(id, id, key.toString(), region, out,
                            new int[]{spawn.getBlockX(), spawn.getBlockY(), spawn.getBlockZ()}));
                    extraction.scanNow(id);
                }, () -> {
                    if (missingRegionWarnings.shouldWarn(id))
                        getLogger().warning("No region directory for world " + id);
                });
    }

    private void startTextures(Path root) {
        textureWorker = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, "BriskMap-textures");
            thread.setDaemon(true);
            return thread;
        });
        textures = new TextureService(getServer().getMinecraftVersion(), getDataFolder().toPath().resolve("cache"),
                root.resolve("textures"), settings.acceptMojangDownload(), new ClientJarProvider()::obtain,
                getLogger(), textureWorker, this::requestIndex);
        textures.ensure();
    }

    private void requestIndex() {
        ExecutorService worker = indexWorker;
        if (worker == null || worker.isShutdown()) return;
        indexDirty.set(true);
        if (!indexQueued.compareAndSet(false, true)) return;
        try { worker.execute(() -> {
            try { while (indexDirty.getAndSet(false)) writeIndex(); }
            finally {
                indexQueued.set(false);
                if (indexDirty.get()) requestIndex();
            }
        }); }
        catch (java.util.concurrent.RejectedExecutionException ignored) { indexQueued.set(false); }
    }

    private void writeIndex() {
        ExtractionService service = extraction;
        if (service == null) return;
        Map<String, ExtractionService.Status> statuses = new java.util.HashMap<>();
        for (var status : service.statuses()) statuses.put(status.id(), status);
        List<MapIndexWriter.MapEntry> entries = new ArrayList<>();
        for (MapTarget target : service.targets()) {
            var status = statuses.get(target.id());
            if (status != null) entries.add(new MapIndexWriter.MapEntry(target.id(), target.name(), target.dimension(),
                    target.spawn(), settings.caves(), settings.fluids(), status.dataVersionMin(),
                    status.dataVersionMax(), target.outDir(), status.updated()));
        }
        try { index.write(entries, textures == null ? null : textures.state().relativeUrl()); }
        catch (IOException exception) { getLogger().warning("Cannot write map index: " + exception.getMessage()); }
    }

    @EventHandler public void onWorldLoad(WorldLoadEvent event) { addWorld(event.getWorld()); requestIndex(); }
    @EventHandler public void onWorldUnload(WorldUnloadEvent event) {
        extraction.remove(event.getWorld().getName());
        requestIndex();
    }
    @EventHandler public void onWorldSave(WorldSaveEvent event) {
        String id = event.getWorld().getName();
        if (!hasWorld(id) && !settings.excludedWorlds().contains(id)) {
            addWorld(event.getWorld());
            requestIndex();
        }
        long now = System.currentTimeMillis();
        Long previous = saveScans.putIfAbsent(id, now);
        if (previous == null || now - previous >= 5000) {
            saveScans.put(id, now);
            extraction.scanNow(id);
        }
    }

    @Override public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        String action = args.length == 0 ? "status" : args[0].toLowerCase(Locale.ROOT);
        switch (action) {
            case "status" -> {
                String url = web == null ? "off" : StatusFormatter.webUrl(settings.webBind(), Bukkit.getIp(), web.port());
                List<ExtractionService.Status> statuses = extraction.statuses();
                if (statuses.isEmpty()) sender.sendMessage("BriskMap: no enabled maps; web=" + url);
                long now = System.currentTimeMillis();
                ZoneId zone = ZoneId.systemDefault();
                for (var status : statuses) sender.sendMessage("BriskMap " + status.id() + ": " + status.done()
                        + "/" + status.total() + " regions, failed=" + status.failed() + ", running="
                        + status.running() + ", last scan=" + StatusFormatter.lastScan(status.lastScan(), now, zone)
                        + ", web=" + url);
                TextureService.State textureState = textures.state();
                sender.sendMessage("BriskMap textures " + textureState.version() + ": "
                        + textureState.status() + (textureState.message() == null ? "" : " (" + textureState.message() + ")"));
                return true;
            }
            case "scan" -> {
                if (args.length > 2 || args.length == 2 && !hasWorld(args[1])) return false;
                extraction.scanNow(args.length == 2 ? args[1] : null);
                sender.sendMessage("BriskMap scan queued");
                return true;
            }
            case "rebuild" -> {
                if (args.length != 2 || !hasWorld(args[1])) return false;
                getLogger().info("Rebuilding map " + args[1]);
                extraction.rebuild(args[1]);
                sender.sendMessage("BriskMap rebuild queued for " + args[1]);
                return true;
            }
            case "textures" -> {
                if (args.length != 1) return false;
                textures.rebuild();
                sender.sendMessage("BriskMap texture rebuild queued");
                return true;
            }
            case "reload" -> {
                if (args.length != 1) return false;
                reloadBriskMap();
                sender.sendMessage("BriskMap configuration reloaded");
                return true;
            }
            default -> { return false; }
        }
    }

    private boolean hasWorld(String id) { return extraction.targets().stream().anyMatch(target -> target.id().equals(id)); }

    private void reloadBriskMap() {
        missingRegionWarnings.reset();
        BriskMapConfig old = settings;
        reloadConfig();
        settings = readSettings();
        textures.setConsent(settings.acceptMojangDownload());
        if (textures.state().status() != TextureService.Status.READY) {
            if (textures.state().status() == TextureService.Status.FAILED) textures.rebuild();
            else textures.ensure();
        }
        if (old.webEnabled() != settings.webEnabled() || !old.webBind().equals(settings.webBind())
                || old.webPort() != settings.webPort() || old.webThreads() != settings.webThreads()) {
            if (web != null) { web.stop(); web = null; }
            startWeb();
        }
        ExtractionService previous = extraction;
        Map<String, ExtractionService.Status> earlier = new java.util.HashMap<>();
        for (var status : previous.statuses()) earlier.put(status.id(), status);
        startExtraction();
        for (World world : getServer().getWorlds()) addWorld(world);
        if (old.options().equals(settings.options()))
            for (var entry : earlier.entrySet()) extraction.seed(entry.getKey(), entry.getValue());
        extraction.scanNow(null);
        requestIndex();
        Thread cleanup = new Thread(previous::close, "BriskMap-old-extraction");
        cleanup.setDaemon(true);
        cleanup.start();
    }

    @Override public List<String> onTabComplete(CommandSender sender, Command command, String alias, String[] args) {
        if (args.length == 1) return Arrays.stream(new String[]{"status", "scan", "rebuild", "reload", "textures"})
                .filter(value -> value.startsWith(args[0].toLowerCase(Locale.ROOT))).toList();
        if (args.length == 2 && (args[0].equalsIgnoreCase("scan") || args[0].equalsIgnoreCase("rebuild")))
            return extraction.targets().stream().map(MapTarget::id).filter(id -> id.startsWith(args[1])).sorted().toList();
        return List.of();
    }

    @Override public void onDisable() {
        if (textureWorker != null) textureWorker.shutdownNow();
        if (extraction != null) extraction.close();
        if (indexWorker != null) {
            indexWorker.shutdown();
            try { if (!indexWorker.awaitTermination(2, TimeUnit.SECONDS)) indexWorker.shutdownNow(); }
            catch (InterruptedException exception) { Thread.currentThread().interrupt(); indexWorker.shutdownNow(); }
        }
        if (web != null) { web.stop(); web = null; }
    }
}
