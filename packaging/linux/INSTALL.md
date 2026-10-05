# DH Photo Tagger for Linux (plain binary)

This build uses your system's WebKitGTK instead of bundling one (unlike the AppImage), which
avoids blank-window issues some AppImages have on Wayland/Hyprland. Works on Arch / Omarchy.

## Arch / Omarchy

```sh
sudo pacman -S --needed webkit2gtk-4.1 gst-plugins-good gst-plugins-bad gst-libav
./install.sh            # installs to ~/.local (binary, icon, app-launcher entry)
dh-photo-tagger
```

The GStreamer packages are only needed to *play* videos in the app (H.264/HEVC); matching
works without them.

## Other distros

Install WebKitGTK 4.1 (Debian/Ubuntu: `libwebkit2gtk-4.1-0`, Fedora: `webkit2gtk4.1`), then run
`./install.sh` or start `./dh-photo-tagger` directly.

If the window stays blank on Wayland, try `WEBKIT_DISABLE_DMABUF_RENDERER=1 dh-photo-tagger`.
