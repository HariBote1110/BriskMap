dependencies {
    // 対応範囲で最も古い版の API に対してビルドする（ADR 0002）
    compileOnly("io.papermc.paper:paper-api:1.21.11-R0.1-SNAPSHOT")
    implementation(project(":core"))
}

tasks.processResources {
    val props = mapOf("version" to project.version)
    inputs.properties(props)
    filesMatching("plugin.yml") { expand(props) }
}

tasks.jar {
    archiveBaseName.set("BriskMap")
    // 内部実装（NMS）を使わないので、1.21.x での読み込み時の変換を省く
    manifest.attributes("paperweight-mappings-namespace" to "mojang")
    // core を同梱する（外部依存はないので単純な結合で足りる）
    dependsOn(":core:jar")
    from(project(":core").sourceSets["main"].output)
}
