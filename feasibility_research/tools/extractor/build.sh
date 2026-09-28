#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/build/classes"
find "$here/src/main/java" -name '*.java' -print0 | xargs -0 javac --release 21 -d "$here/build/classes"
printf 'Main-Class: briskmap.extract.Main\n' > "$here/build/manifest.mf"
jar cfm "$here/build/brisk-extract.jar" "$here/build/manifest.mf" -C "$here/build/classes" .
