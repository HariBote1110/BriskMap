#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/build/test-classes"
find "$here/src/main/java" "$here/src/test/java" -name '*.java' -print0 | xargs -0 javac --release 21 -d "$here/build/test-classes"
java -cp "$here/build/test-classes" briskmap.extract.Tests
