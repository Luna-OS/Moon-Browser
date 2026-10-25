#!/bin/bash
# Updates Luma (formerly Moon Browser) on a Mac to the newest release, in
# place: nothing to uninstall, and bookmarks, history, logins and extensions
# stay, as they live in your Library, not in the app. In Terminal:
#
#   curl -fsSL https://github.com/Luna-OS/Moon-Browser/releases/latest/download/update-mac.sh | bash
#
# Luma 0.1.35 and later update themselves (src/main/mac-update.ts); this is
# for older copies, and for when that can't (an app in a folder you can't
# write to). It does the same checks: the zip's SHA-512 from latest-mac.yml,
# then the new app's signature, bundle ID and version, before it replaces
# the old app.
#
# LUMA_APP=/path/to/Luma.app picks the app to update; LUMA_RELEASES another
# place to download from (a mirror, or file:// for tests).

# All in one function, run on the last line: a download cut short runs nothing.
main() {
  set -euo pipefail

  local releases="${LUMA_RELEASES:-https://github.com/Luna-OS/Moon-Browser/releases}"
  local bundle_id="io.lunaos.moonbrowser"

  say() { printf '%s\n' "$*"; }
  fail() {
    printf 'Luma update: %s\n' "$*" >&2
    exit 1
  }
  info() { defaults read "$1/Contents/Info" "$2" 2>/dev/null; }

  [ "$(uname -s)" = Darwin ] || fail "this is for macOS."

  # The installed app: where it usually is, or wherever Spotlight knows it.
  local app="${LUMA_APP:-}" candidate
  if [ -z "$app" ]; then
    for candidate in "/Applications/Luma.app" "/Applications/Moon Browser.app" \
      "$HOME/Applications/Luma.app" "$HOME/Applications/Moon Browser.app"; do
      if [ -d "$candidate" ]; then
        app="$candidate"
        break
      fi
    done
  fi
  if [ -z "$app" ]; then
    app="$(mdfind "kMDItemCFBundleIdentifier == '$bundle_id'" 2>/dev/null |
      grep -v '^/Volumes/' | grep '\.app$' | head -n 1 || true)"
  fi
  [ -n "$app" ] && [ -d "$app" ] || fail "Luma isn't installed. Download it from $releases/latest"
  app="$(cd "$app" && pwd)"
  [ "$(info "$app" CFBundleIdentifier)" = "$bundle_id" ] || fail "$app is not Luma."
  case "$app" in
    /Volumes/*) fail "Luma runs from the disk image: drag it into Applications first." ;;
  esac
  local current
  current="$(info "$app" CFBundleShortVersionString || true)"

  # The newest release, and its zip for this Mac.
  local arch=x64
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ] && arch=arm64
  local feed
  feed="$(curl -fsSL "$releases/latest/download/latest-mac.yml")" ||
    fail "couldn't reach $releases"
  local version
  version="$(printf '%s\n' "$feed" | awk '/^version:/ { gsub(/["'\'']/, "", $2); print $2; exit }')"
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+' || fail "latest-mac.yml names no version."
  local entry zip sha512
  entry="$(printf '%s\n' "$feed" | awk -v want="-mac-$arch.zip" '
    /^ *- *url:/ { url = $NF; next }
    /^ *sha512:/ && url != "" {
      if (substr(url, length(url) - length(want) + 1) == want) { print url, $NF; exit }
      url = ""
    }')"
  zip="${entry%% *}"
  sha512="${entry#* }"
  [ -n "$entry" ] && [ "${zip#*/}" = "$zip" ] || fail "the release has no zip for this Mac ($arch)."

  if [ "$current" = "$version" ]; then
    say "Luma $version is up to date ($app)."
    return 0
  fi
  say "Updating Luma ${current:-?} to $version ($app)…"

  local work
  work="$(mktemp -d "${TMPDIR:-/tmp}/luma-update.XXXXXX")"
  # shellcheck disable=SC2064 # $work is local: the trap gets its value now.
  trap "rm -rf '$work'" EXIT
  curl -fL --progress-bar -o "$work/$zip" "$releases/download/v$version/$zip" ||
    fail "the download failed."
  [ "$(openssl dgst -sha512 -binary "$work/$zip" | base64 | tr -d '\n')" = "$sha512" ] ||
    fail "the download is damaged (its SHA-512 doesn't match latest-mac.yml)."

  ditto -x -k "$work/$zip" "$work/new" || fail "couldn't unpack the update."
  local new count
  count="$(find "$work/new" -mindepth 1 -maxdepth 1 -name '*.app' | wc -l | tr -d ' ')"
  [ "$count" = 1 ] || fail "the update holds no app."
  new="$(find "$work/new" -mindepth 1 -maxdepth 1 -name '*.app')"
  [ "$(info "$new" CFBundleIdentifier)" = "$bundle_id" ] || fail "the update is not Luma."
  [ "$(info "$new" CFBundleShortVersionString)" = "$version" ] ||
    fail "the update is not the version it was announced as."
  codesign --verify --deep --strict "$new" 2>/dev/null || fail "the update's signature is broken."

  # Luma quits first (as with File → Quit), and opens again afterwards.
  local running=0 i
  if pgrep -f "$app/Contents/MacOS/" >/dev/null 2>&1; then
    running=1
    say "Quitting Luma…"
    osascript -e "tell application id \"$bundle_id\" to quit" >/dev/null 2>&1 || true
    for i in $(seq 1 60); do
      pgrep -f "$app/Contents/MacOS/" >/dev/null 2>&1 || break
      sleep 0.5
    done
    pgrep -f "$app/Contents/MacOS/" >/dev/null 2>&1 &&
      fail "Luma is still open. Quit it, then run this again."
    # Luma 0.1.35 and later may have put a downloaded update in place as it quit.
    sleep 2
    if [ ! -d "$app" ] || [ "$(info "$app" CFBundleShortVersionString || true)" = "$version" ]; then
      say "Luma updated itself to $version."
      [ -d "$app" ] || app="$(dirname "$app")/$(basename "$new")"
      [ "$running" = 1 ] && open "$app" 2>/dev/null || true
      return 0
    fi
  fi

  # The app keeps the new version's name ("Moon Browser.app" becomes
  # "Luma.app"), unless something else already has that name there.
  local dir target aside sudo=""
  dir="$(dirname "$app")"
  target="$dir/$(basename "$new")"
  if [ "$target" != "$app" ] && [ -e "$target" ]; then target="$app"; fi
  aside="$app.moon-previous"
  if [ ! -w "$dir" ] || [ ! -w "$app" ]; then
    say "Your password is needed to write to $dir."
    sudo="sudo"
  fi
  $sudo rm -rf "$aside"
  $sudo mv "$app" "$aside" || fail "couldn't move the old app aside."
  if ! $sudo mv "$new" "$target"; then
    $sudo mv "$aside" "$app"
    fail "couldn't put the new app in place; the old one is back."
  fi
  $sudo rm -rf "$aside"
  $sudo xattr -dr com.apple.quarantine "$target" 2>/dev/null || true
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
    -f "$target" >/dev/null 2>&1 || true

  say "Luma $version is installed: $target"
  if [ "$target" != "$app" ]; then
    say "(It was called $(basename "$app" .app). If it was in your Dock, drag Luma there anew.)"
  fi
  if [ "$running" = 1 ]; then open "$target" 2>/dev/null || true; fi
}

main "$@"
