#!/usr/bin/env bash
# Validate the data, then build + sign the APK (aapt2 -> javac -> d8 -> zipalign -> apksigner).
#
#   tools/build.sh            build with the version in app/version.properties
#   tools/build.sh --bump     increase versionCode by 1 first (do this for every release you install)
#   tools/build.sh --test     also run the Playwright end-to-end test before building
#   tools/build.sh --debuggable   test build: debuggable, WebView open to Chrome DevTools (file name ends in -debug)
#
# Environment (all optional):
#   ANDROID_HOME   SDK root with build-tools/<ver>/ and platforms/android-<api>/android.jar
#   KEYSTORE, KS_PASS, KEY_ALIAS, KEY_PASS   signing key (default: keystore/madregot-release.jks)
#                  -> to install over an older build, sign with the SAME keystore it was signed with
#   APP_ID         application id (default com.plap.studystairs); must match the installed app to update it
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8   # Hebrew output on a Windows console
unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL     # Git Bash must convert /c/... paths for the Windows tools below

# python: prefer the project venv (has Playwright), then python3, then python
PY="${PYTHON:-}"
if [ -z "$PY" ]; then
  for c in "$ROOT/.venv/Scripts/python.exe" "$ROOT/.venv/bin/python" python3 python; do
    if [ -x "$c" ] || command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
  done
fi

BUMP=0; TEST=0; DEBUG=0
for a in "$@"; do
  case "$a" in
    --bump) BUMP=1 ;;
    --test) TEST=1 ;;
    --debuggable) DEBUG=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$ROOT/../android-sdk}}"
BT="${BUILD_TOOLS:-$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)}"
ANDROID_JAR="${ANDROID_JAR:-$(ls "$ANDROID_HOME"/platforms/android-*/android.jar 2>/dev/null | sort -V | tail -1)}"
# SDK tools are aapt2/zipalign(.exe) and d8/apksigner(.bat) on Windows, plain scripts elsewhere
tool() { for e in "" .exe .bat; do [ -f "$BT/$1$e" ] && { echo "$BT/$1$e"; return; }; done; echo "$1 not found in $BT" >&2; exit 1; }
[ -n "$BT" ] && [ -f "$(tool aapt2 2>/dev/null)" ] || { echo "aapt2 not found. Set ANDROID_HOME (needs build-tools)." >&2; exit 1; }
[ -f "$ANDROID_JAR" ] || { echo "android.jar not found. Set ANDROID_HOME (needs platforms/android-XX)." >&2; exit 1; }

KEYSTORE="${KEYSTORE:-$ROOT/keystore/madregot-release.jks}"
KS_PASS="${KS_PASS:-}"
KEY_ALIAS="${KEY_ALIAS:-madregot}"
KEY_PASS="${KEY_PASS:-$KS_PASS}"
APP_ID="${APP_ID:-com.plap.studystairs}"
MIN_SDK=24
TARGET_SDK=34

# ---------------------------------------------------------------- version
VERSION_FILE="$ROOT/app/version.properties"
VERSION_CODE=$(grep '^versionCode=' "$VERSION_FILE" | cut -d= -f2)
VERSION_NAME=$(grep '^versionName=' "$VERSION_FILE" | cut -d= -f2)
if [ "$BUMP" = 1 ]; then
  VERSION_CODE=$((VERSION_CODE + 1))
  sed -i "s/^versionCode=.*/versionCode=$VERSION_CODE/" "$VERSION_FILE"
fi

# ---------------------------------------------------------------- 1. validate (fails the build on any error)
echo "== validating data"
"$PY" "$ROOT/tools/validate_data.py"

if [ "$TEST" = 1 ]; then
  echo "== end-to-end test"
  "$PY" "$ROOT/tests/e2e_test.py"
fi

# ---------------------------------------------------------------- 2. build
OUT="$ROOT/build/apk"
rm -rf "$OUT"; mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "== aapt2 compile + link"
AAPT2="$(tool aapt2)"; D8="$(tool d8)"; ZIPALIGN="$(tool zipalign)"; APKSIGNER="$(tool apksigner)"
"$AAPT2" compile --dir "$ROOT/app/res" -o "$OUT/res.zip"
RENAME=()
DEBUGFLAG=()
[ "$DEBUG" = 1 ] && DEBUGFLAG=(--debug-mode)
[ "$APP_ID" != "com.plap.studystairs" ] && RENAME=(--rename-manifest-package "$APP_ID")
"$AAPT2" link -o "$OUT/base.apk" -I "$ANDROID_JAR" \
  --manifest "$ROOT/app/AndroidManifest.xml" -A "$ROOT/app/assets" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "${RENAME[@]}" "${DEBUGFLAG[@]}" --java "$OUT/gen" --auto-add-overlay "$OUT/res.zip"

echo "== javac"
# javac reads the @file itself, so on Windows the paths in it must be Windows paths
if command -v cygpath >/dev/null 2>&1; then find "$ROOT/app/java" "$OUT/gen" -name '*.java' | cygpath -m -f - > "$OUT/sources.txt"
else find "$ROOT/app/java" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"; fi
javac --release 11 -nowarn -Xlint:-options -encoding UTF-8 -classpath "$ANDROID_JAR" -d "$OUT/classes" @"$OUT/sources.txt"

echo "== d8"
"$D8" --release --min-api $MIN_SDK --lib "$ANDROID_JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "== package, zipalign, sign"
cp "$OUT/base.apk" "$OUT/unaligned.apk"
# add classes.dex (python zipfile: Git Bash on Windows has no `zip`)
"$PY" -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1],"a",zipfile.ZIP_DEFLATED).write(sys.argv[2],"classes.dex")' "$OUT/unaligned.apk" "$OUT/dex/classes.dex"
"$ZIPALIGN" -p -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"
mkdir -p "$ROOT/build/outputs"
SUFFIX=""; [ "$DEBUG" = 1 ] && SUFFIX="-debug"
APK="$ROOT/build/outputs/the-road-to-100-v${VERSION_NAME}-${VERSION_CODE}${SUFFIX}.apk"
"$APKSIGNER" sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" --key-pass "pass:$KEY_PASS" --out "$APK" "$OUT/aligned.apk"
"$APKSIGNER" verify "$APK"
rm -f "$APK.idsig"

echo
echo "APK ready: $APK  (versionCode $VERSION_CODE, $(du -h "$APK" | cut -f1))"
