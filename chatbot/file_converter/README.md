# File Converter

Backend-only conversion helpers for Live Satellite user uploads.

## Purpose

- Convert uploaded images to WebP.
- Convert uploaded videos to WebM.
- Copy unsupported file types into the user folder unchanged.
- Return a structured result so `backend.py` or `control_panel_ui.py` can show conversion status later.

## Notes

- Image conversion uses Pillow.
- iPhone HEIC/HEIF conversion uses optional `pillow-heif`.
- Video conversion uses FFmpeg.
- This folder has no user interface.
- Control panel settings can later pass quality, size, and keep-original values through `ConverterSettings`.
