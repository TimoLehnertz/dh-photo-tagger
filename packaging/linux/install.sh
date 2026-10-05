#!/bin/sh
# Installs DH Photo Tagger for the current user (no root needed).
set -e
here=$(cd "$(dirname "$0")" && pwd)
prefix=${PREFIX:-$HOME/.local}
install -Dm755 "$here/dh-photo-tagger" "$prefix/bin/dh-photo-tagger"
install -Dm644 "$here/dh-photo-tagger.png" "$prefix/share/icons/hicolor/128x128/apps/dh-photo-tagger.png"
install -Dm644 "$here/dh-photo-tagger.desktop" "$prefix/share/applications/dh-photo-tagger.desktop"
echo "Installed to $prefix/bin/dh-photo-tagger (make sure $prefix/bin is on your PATH)."
