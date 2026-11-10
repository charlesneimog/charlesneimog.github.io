"""Move a page's executable script and style blocks into the shared asset folders."""

from html import escape
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import urljoin, urlsplit


class AssetBlocks(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.offsets = [0]
        self.offsets.extend(match.end() for match in re.finditer("\n", source))
        self.blocks = []
        self.current = None
        self.feed(source)

    def source_offset(self):
        line, column = self.getpos()
        return self.offsets[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            start = self.source_offset()
            self.current = (tag, dict(attrs), start, start + len(self.get_starttag_text()))

    def handle_endtag(self, tag):
        if self.current and tag == self.current[0]:
            self.blocks.append((*self.current, self.source_offset(), self.source_offset() + len(tag) + 3))
            self.current = None


def rebase_css(source, page_path):
    """Inline CSS URLs originally resolve relative to the HTML document."""
    def replace(match):
        value = match.group(1).strip().strip("\"'")
        if not value or value.startswith(("#", "/")) or urlsplit(value).scheme:
            return match.group(0)
        return f'url("{urljoin("/" + page_path.as_posix(), value)}")'

    return re.sub(r"url\(\s*([^)]*?)\s*\)", replace, source)


def extract_page_assets(filename, root=None, asset_stem=None):
    filename = Path(filename).resolve()
    root = Path(root).resolve() if root else Path(__file__).resolve().parent.parent
    relative = filename.relative_to(root)
    source = filename.read_text(encoding="utf-8")
    replacements = []
    counts = {"script": 0, "style": 0}
    folder = relative.parent

    for tag, attrs, start, body_start, body_end, end in AssetBlocks(source).blocks:
        body = source[body_start:body_end]
        if not body.strip() or "src" in attrs:
            continue
        if tag == "script" and attrs.get("type", "").lower() not in (
            "", "text/javascript", "application/javascript", "module"
        ):
            continue
        # StatiCrypt substitutes executable code into its generator template.
        # The generated page is extracted after encryption instead.
        if "/*[|js_staticrypt|]*/" in body:
            continue

        counts[tag] += 1
        suffix = "" if counts[tag] == 1 else f"-{counts[tag]}"
        extension = "js" if tag == "script" else "css"
        asset = Path(extension) / folder / f"{asset_stem or filename.stem}{suffix}.{extension}"
        if relative == Path("index.html"):
            asset = Path(extension) / f"home{suffix}.{extension}"
        if tag == "script" and "gtag(\"config\", \"G-JQ132MRVKN\")" in body:
            asset = Path("js/analytics.js")
        if tag == "style":
            body = rebase_css(body, relative)

        target = root / asset
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
        url = "/" + asset.as_posix()
        if tag == "style":
            media = f' media="{escape(attrs["media"], quote=True)}"' if "media" in attrs else ""
            replacement = f'<link rel="stylesheet" href="{url}"{media} />'
        else:
            attributes = "".join(
                f' {key}' if value is None else f' {key}="{escape(value, quote=True)}"'
                for key, value in attrs.items()
            )
            replacement = f'<script{attributes} src="{url}"></script>'
        replacements.append((start, end, replacement))

    for start, end, replacement in reversed(replacements):
        source = source[:start] + replacement + source[end:]
    filename.write_text(source, encoding="utf-8")
    return len(replacements)


if __name__ == "__main__":
    import sys

    for argument in sys.argv[1:]:
        extract_page_assets(argument)
