import tempfile
from pathlib import Path
import unittest

from PIL import Image

import imgs2avif


class ImageMigrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)

    def tearDown(self):
        self.temporary_directory.cleanup()

    def test_converts_references_then_deletes_original(self):
        image = self.root / "assets" / "newarticle.png"
        image.parent.mkdir()
        Image.new("RGB", (13, 7), "red").save(image)

        page = self.root / "page.html"
        page.write_text(
            '<img src="assets/newarticle.png">\n'
            'https://example.com/newarticle.png?size=2\n'
            'notnewarticle.png\n',
            encoding="utf-8",
        )
        git_metadata = self.root / ".git" / "metadata.txt"
        git_metadata.parent.mkdir()
        git_metadata.write_text("newarticle.png\n", encoding="utf-8")

        converted, changed_files, changed_references = imgs2avif.migrate_images(self.root)

        avif = image.with_suffix(".avif")
        self.assertEqual((converted, changed_files, changed_references), (1, 1, 2))
        self.assertFalse(image.exists())
        self.assertTrue(avif.exists())
        with Image.open(avif) as converted_image:
            self.assertEqual(converted_image.size, (13, 7))
        self.assertEqual(
            page.read_text(encoding="utf-8"),
            '<img src="assets/newarticle.avif">\n'
            'https://example.com/newarticle.avif?size=2\n'
            'notnewarticle.png\n',
        )
        self.assertEqual(git_metadata.read_text(encoding="utf-8"), "newarticle.png\n")

    def test_rejects_two_sources_that_would_overwrite_one_avif(self):
        Image.new("RGB", (2, 2)).save(self.root / "same.png")
        Image.new("RGB", (2, 2)).save(self.root / "same.jpg")

        with self.assertRaisesRegex(RuntimeError, "would overwrite"):
            imgs2avif.migrate_images(self.root)

        self.assertTrue((self.root / "same.png").exists())
        self.assertTrue((self.root / "same.jpg").exists())
        self.assertFalse((self.root / "same.avif").exists())

    def test_keeps_favicon_ico(self):
        favicon = self.root / "favicon.ico"
        favicon.write_bytes(b"keep this icon")

        self.assertEqual(imgs2avif.migrate_images(self.root), (0, 0, 0))
        self.assertEqual(favicon.read_bytes(), b"keep this icon")
        self.assertFalse((self.root / "favicon.avif").exists())


if __name__ == "__main__":
    unittest.main()
