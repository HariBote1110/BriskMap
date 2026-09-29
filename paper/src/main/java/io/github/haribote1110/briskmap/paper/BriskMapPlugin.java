package io.github.haribote1110.briskmap.paper;

import org.bukkit.plugin.java.JavaPlugin;

public final class BriskMapPlugin extends JavaPlugin {
    @Override
    public void onEnable() {
        getLogger().info("BriskMap enabled on Minecraft " + getServer().getMinecraftVersion());
    }
}
