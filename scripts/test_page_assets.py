"""Regression checks for centralized page assets and the extraction helper."""

from pathlib import Path
from html.parser import HTMLParser
import re
import tempfile
import unittest
from urllib.parse import unquote, urljoin, urlsplit

from extract_page_assets import AssetBlocks, extract_page_assets


ROOT = Path(__file__).resolve().parent.parent


class PageAssetsTests(unittest.TestCase):
    def test_local_script_and_stylesheet_references_exist(self):
        references = []

        class References(HTMLParser):
            def handle_starttag(self, tag, attrs):
                attrs = dict(attrs)
                if tag == "script" and "src" in attrs:
                    references.append(attrs["src"])
                elif tag == "link" and attrs.get("rel") == "stylesheet":
                    references.append(attrs["href"])

        for page in ROOT.rglob("*.html"):
            if ".git" in page.parts:
                continue
            references.clear()
            References().feed(page.read_text())
            for value in references:
                url = urlsplit(urljoin("/" + page.relative_to(ROOT).as_posix(), value))
                if url.netloc and url.netloc != "charlesneimog.github.io":
                    continue
                with self.subTest(page=page, value=value):
                    self.assertTrue((ROOT / unquote(url.path.lstrip("/"))).is_file(), value)

    def test_content_folders_do_not_contain_javascript_or_css(self):
        for directory in ("talks", "classes"):
            assets = [p for p in (ROOT / directory).rglob("*") if p.suffix in (".js", ".css")]
            self.assertEqual(assets, [])

    def test_public_pages_use_external_code_and_keep_json_metadata(self):
        for page in ROOT.rglob("*.html"):
            if ".git" in page.parts or page == ROOT / "talks/template.html":
                continue
            source = page.read_text()
            for tag, attrs, _, start, end, _ in AssetBlocks(source).blocks:
                if not source[start:end].strip() or "src" in attrs:
                    continue
                with self.subTest(page=page, tag=tag):
                    self.assertEqual(tag, "script")
                    self.assertIn(attrs.get("type"), ("application/json", "application/ld+json"))

    def test_stylesheet_fonts_and_media_resolve_after_relocation(self):
        for stylesheet in (ROOT / "css").rglob("*.css"):
            for value in re.findall(r"url\(\s*([^)]*?)\s*\)", stylesheet.read_text()):
                value = value.strip().strip("\"'")
                if value.startswith("#") or urlsplit(value).scheme:
                    continue
                page_url = "/" + stylesheet.relative_to(ROOT).as_posix()
                target = ROOT / unquote(urlsplit(urljoin(page_url, value)).path.lstrip("/"))
                with self.subTest(stylesheet=stylesheet, value=value):
                    self.assertTrue(target.is_file(), target)

    def test_extraction_preserves_order_data_and_css_base(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            page = root / "talks/example/index.html"
            page.parent.mkdir(parents=True)
            page.write_text('''<!doctype html><html><head>
<!-- <script>commentedOut()</script> -->
<style media="screen">body { background: url("picture.png"); }</style>
<script type="application/ld+json">{"name":"Example"}</script>
</head><body><script id="first">window.order = [1];</script>
<script src="https://example.test/library.js"></script>
<script type="module">window.order.push(2);</script></body></html>''')
            self.assertEqual(extract_page_assets(page, root), 3)
            result = page.read_text()
            self.assertIn('<script type="application/ld+json">{"name":"Example"}</script>', result)
            self.assertIn('<!-- <script>commentedOut()</script> -->', result)
            self.assertIn('media="screen"', result)
            self.assertLess(result.index('/js/talks/example/index.js'), result.index('https://example.test/library.js'))
            self.assertLess(result.index('https://example.test/library.js'), result.index('/js/talks/example/index-2.js'))
            self.assertEqual((root / "js/talks/example/index.js").read_text(), 'window.order = [1];')
            self.assertIn('url("/talks/example/picture.png")', (root / "css/talks/example/index.css").read_text())
            self.assertEqual(extract_page_assets(page, root), 0)


if __name__ == "__main__":
    unittest.main()
