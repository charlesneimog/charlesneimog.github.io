import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

import pillow_avif  # noqa: F401 - registers AVIF support with Pillow
from PIL import Image


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}
AUDIO_SUFFIXES = {".wav", ".ogg", ".flac", ".m4a", ".aac"}


def list_files(root: Path):
    """Yield repository files without ever descending into a .git directory."""
    for directory, directories, filenames in os.walk(root):
        directories[:] = [name for name in directories if name != ".git"]
        for filename in filenames:
            if filename == ".git":
                continue
            path = Path(directory, filename)
            if not path.is_symlink():
                yield path


def atomic_write(path: Path, data: bytes):
    """Replace a file atomically while preserving its permission bits."""
    mode = stat.S_IMODE(path.stat().st_mode)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as temporary_file:
            temporary_file.write(data)
        temporary.chmod(mode)
        os.replace(temporary, path)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def convert_image(source: Path) -> Path:
    """Convert one raster image to AVIF without exposing a partial output."""
    destination = source.with_suffix(".avif")
    mode = stat.S_IMODE(source.stat().st_mode)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{destination.stem}.", suffix=".avif", dir=destination.parent
    )
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with Image.open(source) as image:
            image.load()
            image.save(temporary, format="AVIF", quality=80)
        temporary.chmod(mode)
        os.replace(temporary, destination)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return destination


def filename_pattern(filename: str) -> re.Pattern:
    """Match a complete filename inside paths, URLs, markup, and source code."""
    return re.compile(rf"(?<![\w.-]){re.escape(filename)}(?![\w.-])")


def replace_image_references(root: Path, replacements: dict[str, str]) -> tuple[int, int]:
    """Replace original image filenames in every UTF-8 text file outside .git."""
    patterns = [(filename_pattern(old), new) for old, new in replacements.items()]
    if not patterns:
        return 0, 0
    changed_files = 0
    changed_references = 0

    for path in list_files(root):
        try:
            original = path.read_bytes()
            text = original.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue

        updated = text
        replacements_in_file = 0
        for pattern, new_name in patterns:
            updated, count = pattern.subn(new_name, updated)
            replacements_in_file += count

        if replacements_in_file:
            atomic_write(path, updated.encode("utf-8"))
            changed_files += 1
            changed_references += replacements_in_file
            print(f"Updated {replacements_in_file} reference(s) in {path.relative_to(root)}")

    return changed_files, changed_references


def migrate_images(root: Path) -> tuple[int, int, int]:
    """Convert images, update all references, and only then delete the originals."""
    sources = [path for path in list_files(root) if path.suffix.lower() in IMAGE_SUFFIXES]
    destinations: dict[Path, Path] = {}

    for source in sources:
        destination = source.with_suffix(".avif")
        previous = destinations.get(destination)
        if previous is not None and previous != source:
            raise RuntimeError(
                f"Both {previous.relative_to(root)} and {source.relative_to(root)} "
                f"would overwrite {destination.relative_to(root)}"
            )
        destinations[destination] = source

    replacements: dict[str, str] = {}
    for source in sources:
        print(f"Converting {source.relative_to(root)}")
        destination = convert_image(source)
        replacements[source.name] = destination.name

    changed_files, changed_references = replace_image_references(root, replacements)

    # Reaching this point means every conversion and every text rewrite succeeded.
    for source in sources:
        source.unlink()
        print(f"Deleted {source.relative_to(root)}")

    return len(sources), changed_files, changed_references


def convert_audio(root: Path) -> int:
    """Preserve the script's existing audio-to-MP3 conversion behavior."""
    sources = [path for path in list_files(root) if path.suffix.lower() in AUDIO_SUFFIXES]
    for source in sources:
        destination = source.with_suffix(".mp3")
        print(f"Converting audio {source.relative_to(root)}")
        command = [
            "ffmpeg", "-y", "-i", source,
            "-c:a", "libmp3lame", "-b:a", "64k", destination,
        ]
        subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return len(sources)


def main():
    image_count, changed_files, changed_references = migrate_images(REPOSITORY_ROOT)
    audio_count = convert_audio(REPOSITORY_ROOT)
    print(
        f"Finished: {image_count} image(s) converted and deleted; "
        f"{changed_references} reference(s) updated in {changed_files} file(s); "
        f"{audio_count} audio file(s) converted."
    )


if __name__ == "__main__":
    main()
