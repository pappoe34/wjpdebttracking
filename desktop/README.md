# WJP Desktop (Tauri)

Native desktop wrapper for WJP Debt Tracking. ~5MB Rust-based binary, auto-update support, much smaller than Electron equivalent.

## Why Tauri over Electron

- Bundle size: ~5MB vs ~80MB
- Memory: ~50MB vs ~200MB
- Native menu integration on macOS, Windows, Linux
- Auto-update built in

## Prerequisites

- Rust toolchain (https://www.rust-lang.org/tools/install)
- Tauri CLI: `cargo install tauri-cli --version "^2.0"`
- Platform-specific build deps (see https://tauri.app/start/prerequisites/)

## Develop

```bash
cd desktop
cargo tauri dev
```

This opens a native window pointing at https://wjpdebttracking.com (per `devUrl` in tauri.conf.json).

## Build

```bash
cargo tauri build
```

Outputs:
- macOS: `.dmg` and `.app` bundle
- Windows: `.msi` installer
- Linux: `.deb` and `.AppImage`

## Bundle config

Edit `src-tauri/tauri.conf.json` for window size, app metadata, icons.

## Status

**Scaffold only.** Build process not yet tested. Recommend deferring publish until after web launch (May 26) and verifying real user demand.
