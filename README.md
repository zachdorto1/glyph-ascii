# Glyph — ASCII Art Converter

Turn photos and videos into colored ASCII art in your browser. Everything runs client-side; files never leave your device.

## Open in the browser

If this project is published on Cursor, open it from the app pill / Publish UI in the agent chat (same pattern as other Cursor-hosted apps like Wordle solvers).

## Run locally

```bash
cd ascii-art   # or the repo root if this folder is the repository
python3 -m http.server 8765 --bind 127.0.0.1
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765).

No build step or npm install. Sample media is in `samples/`.

## Features

- Upload image (PNG, JPG, WebP, GIF) or video (MP4, WebM)
- Density-based ASCII character ramps
- Color modes: full RGB, ANSI 16, mono green/amber, grayscale
- Adjustable columns and invert brightness
- Playable ASCII video preview with FPS control
- Copy plain text, download PNG, or download colored HTML
