from __future__ import annotations

import mimetypes
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path


IMAGE_EXTENSIONS = {
    ".avif",
    ".bmp",
    ".gif",
    ".heic",
    ".heif",
    ".jpeg",
    ".jpg",
    ".png",
    ".tif",
    ".tiff",
    ".webp",
}

VIDEO_EXTENSIONS = {
    ".3gp",
    ".avi",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".ogv",
    ".webm",
    ".wmv",
}


@dataclass
class ConverterSettings:
    image_quality: int = 78
    image_max_width: int = 1920
    image_max_height: int = 1920
    video_crf: int = 34
    video_max_width: int = 1280
    video_max_height: int = 720
    keep_original: bool = False
    ffmpeg_path: str = "ffmpeg"


@dataclass
class ConversionResult:
    ok: bool
    input_path: str
    output_path: str
    media_type: str
    action: str
    error: str = ""


def convert_file(input_path: str | Path, output_dir: str | Path, settings: ConverterSettings | None = None) -> ConversionResult:
    source = Path(input_path)
    destination_dir = Path(output_dir)
    active_settings = settings or ConverterSettings()

    if not source.exists() or not source.is_file():
        return ConversionResult(False, str(source), "", "unknown", "failed", "Input file does not exist.")

    destination_dir.mkdir(parents=True, exist_ok=True)
    extension = source.suffix.lower()

    if extension in IMAGE_EXTENSIONS:
        return convert_image(source, destination_dir, active_settings)

    if extension in VIDEO_EXTENSIONS:
        return convert_video(source, destination_dir, active_settings)

    copied = unique_path(destination_dir / source.name)
    shutil.copy2(source, copied)
    return ConversionResult(True, str(source), str(copied), detect_media_type(source), "copied")


def convert_image(source: Path, output_dir: Path, settings: ConverterSettings) -> ConversionResult:
    output_path = unique_path(output_dir / f"{source.stem}.webp")

    try:
        from PIL import Image, ImageOps
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            pass
    except ImportError:
        copied = unique_path(output_dir / source.name)
        shutil.copy2(source, copied)
        return ConversionResult(
            False,
            str(source),
            str(copied),
            "image",
            "copied",
            "Pillow is not installed; image was copied without WebP conversion.",
        )

    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((settings.image_max_width, settings.image_max_height))
            if image.mode not in {"RGB", "RGBA"}:
                image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
            image.save(output_path, "WEBP", quality=clamp(settings.image_quality, 1, 100), method=6)
    except Exception as exc:
        return ConversionResult(False, str(source), "", "image", "failed", str(exc))

    cleanup_original(source, settings)
    return ConversionResult(True, str(source), str(output_path), "image", "converted")


def convert_video(source: Path, output_dir: Path, settings: ConverterSettings) -> ConversionResult:
    output_path = unique_path(output_dir / f"{source.stem}.webm")
    scale = (
        f"scale='min({settings.video_max_width},iw)':"
        f"'min({settings.video_max_height},ih)':force_original_aspect_ratio=decrease"
    )
    command = [
        settings.ffmpeg_path,
        "-y",
        "-i",
        str(source),
        "-vf",
        scale,
        "-c:v",
        "libvpx-vp9",
        "-crf",
        str(clamp(settings.video_crf, 18, 45)),
        "-b:v",
        "0",
        "-c:a",
        "libopus",
        "-b:a",
        "96k",
        str(output_path),
    ]

    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        copied = unique_path(output_dir / source.name)
        shutil.copy2(source, copied)
        return ConversionResult(
            False,
            str(source),
            str(copied),
            "video",
            "copied",
            "FFmpeg was not found; video was copied without WebM conversion.",
        )

    if completed.returncode != 0:
        return ConversionResult(False, str(source), "", "video", "failed", completed.stderr.strip()[-1000:])

    cleanup_original(source, settings)
    return ConversionResult(True, str(source), str(output_path), "video", "converted")


def cleanup_original(source: Path, settings: ConverterSettings) -> None:
    if settings.keep_original:
        return
    try:
        source.unlink()
    except OSError:
        pass


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path

    counter = 2
    while True:
        candidate = path.with_name(f"{path.stem}_{counter}{path.suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def detect_media_type(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        return guessed.split("/", 1)[0]
    return "file"


def clamp(value: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, int(value)))
