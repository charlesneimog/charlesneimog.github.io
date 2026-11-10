"""Exercise protected HTML and Markdown using the installed StatiCrypt codec."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("talk_encryption", ROOT / "talks/encrypt.py")
encryption = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(encryption)
PASSWORD = "presentation-test-password"
STATICRYPT = shutil.which("staticrypt")


@unittest.skipUnless(STATICRYPT and shutil.which("node"), "StatiCrypt and Node.js are required")
class TalkEncryptionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.folder = self.root / "talks/private"
        self.folder.mkdir(parents=True)
        for name in ("template.html", "slide.html"):
            shutil.copyfile(ROOT / "talks" / name, self.root / "talks" / name)
        self.talk = {"link": "./private/slide.md", "encrypt": True}
        self.source = '# Confidential presentation\n\n## Images\n\n<img src="picture.png">\n\nA literal </script> is safe.\n'

    def protect(self, password=PASSWORD):
        return encryption.protect_presentation(self.talk, self.root, password, STATICRYPT)

    def decrypt_html(self, filename="index.html"):
        _, payload = encryption.find_html_payload(self.folder / filename, self.root)
        self.assertIsNotNone(payload)
        return encryption.payload_operation("decrypt", PASSWORD, STATICRYPT, payload=payload)

    def snapshot(self):
        return {path: path.read_bytes() for path in self.root.rglob("*") if path.is_file()}

    def test_markdown_is_encrypted_and_embedded_only_inside_protected_html(self):
        markdown = self.folder / "slide.md"
        markdown.write_text(self.source)
        self.assertTrue(self.protect())
        payload = json.loads(markdown.read_text())
        self.assertEqual(payload["format"], "staticrypt-markdown")
        self.assertNotIn("Confidential presentation", markdown.read_text())
        self.assertEqual(encryption.read_markdown(markdown, PASSWORD, STATICRYPT), self.source)
        html = self.decrypt_html()
        self.assertEqual(json.loads(encryption.MARKDOWN_BLOCK.search(html)[1]), self.source)
        self.assertIn('src="/js/talk-slide.js?v=4"', html)
        self.assertIn('href="/css/reveals.css"', html)
        for public_file in self.root.rglob("*"):
            if public_file.is_file():
                self.assertNotIn("Confidential presentation", public_file.read_text(), public_file)

    def test_rerunning_does_not_double_encrypt_and_recovers_missing_markdown(self):
        markdown = self.folder / "slide.md"
        markdown.write_text(self.source)
        self.protect()
        first_html = self.decrypt_html()
        before = self.snapshot()
        self.assertFalse(self.protect())
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.decrypt_html(), first_html)
        markdown.unlink()
        self.protect()
        self.assertEqual(encryption.read_markdown(markdown, PASSWORD, STATICRYPT), self.source)

    def test_wrong_password_leaves_existing_protected_files_unchanged(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        self.talk["encrypt"] = False
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "Could not decrypt"):
            self.protect("incorrect-password")
        self.assertEqual(self.snapshot(), before)

    def test_html_variants_are_protected_without_overwriting_their_original_scripts(self):
        self.talk["link"] = "./private"
        (self.folder / "index.html").write_text('<!doctype html><html><body>Main presentation</body></html>')
        variant = '<!doctype html><html><body>Alternate presentation<script src="/js/talks/private/index2.js"></script></body></html>'
        (self.folder / "index2.html").write_text(variant)
        original_script = self.root / "js/talks/private/index2.js"
        original_script.parent.mkdir(parents=True)
        original_script.write_text("window.presentationInitialized = true;")
        self.protect()
        self.assertEqual(self.decrypt_html("index2.html"), variant)
        self.assertEqual(original_script.read_text(), "window.presentationInitialized = true;")
        self.assertIn("index2-locked.js", (self.folder / "index2.html").read_text())

    def test_public_markdown_remains_public(self):
        self.talk["encrypt"] = False
        markdown = self.folder / "slide.md"
        markdown.write_text(self.source)
        self.assertFalse(self.protect())
        self.assertEqual(markdown.read_text(), self.source)
        self.assertFalse((self.folder / "index.html").exists())

    def test_html_markdown_round_trip_and_reencryption_preserve_content_and_metadata(self):
        original = '<!doctype html><html><body><h1>Original content</h1><script src="/js/shared.js"></script></body></html>'
        (self.folder / "index.html").write_text(original)
        (self.folder / "slide.md").write_text(self.source)
        shared = self.root / "js/shared.js"
        shared.parent.mkdir()
        shared.write_text("window.shared = true;")
        configured = dict(self.talk)
        self.assertTrue(self.protect())
        protected_html = self.decrypt_html()
        self.assertIn("Original content", protected_html)
        self.assertEqual(self.talk, configured)
        payload_file, _ = encryption.find_html_payload(self.folder / "index.html", self.root)
        self.assertNotEqual(payload_file, self.folder / "index.html")
        self.talk["encrypt"] = False
        self.assertTrue(self.protect())
        self.assertEqual((self.folder / "index.html").read_text(), protected_html)
        self.assertEqual((self.folder / "slide.md").read_text(), self.source)
        self.assertEqual(json.loads(encryption.MARKDOWN_BLOCK.search(protected_html)[1]), self.source)
        self.assertNotIn("index-locked.js", protected_html)
        self.assertFalse(payload_file.exists())
        self.assertEqual(shared.read_text(), "window.shared = true;")
        self.assertFalse(self.talk["encrypt"])
        before = self.snapshot()
        self.assertFalse(self.protect())
        self.assertEqual(self.snapshot(), before)

        self.talk["encrypt"] = True
        self.assertTrue(self.protect())
        self.assertEqual(self.decrypt_html(), protected_html)
        self.assertEqual(encryption.read_markdown(self.folder / "slide.md", PASSWORD, STATICRYPT), self.source)
        before = self.snapshot()
        self.assertFalse(self.protect())
        self.assertEqual(self.snapshot(), before)

    def test_single_quoted_inline_ciphertext_can_be_updated_and_decrypted(self):
        markdown = self.folder / "slide.md"
        markdown.write_text(self.source)
        self.protect()
        page = self.folder / "index.html"
        script, _ = encryption.find_html_payload(page, self.root)
        inline = script.read_text()
        for field in encryption.CIPHER_FIELDS:
            inline = inline.replace(f'"{field}"', f"'{field}'")
        page.write_text(page.read_text().replace(
            f'<script src="/js/talks/private/{script.name}"></script>', f'<script>{inline}</script>'
        ))
        script.unlink()
        updated = self.source + "\nMore content.\n"
        markdown.write_text(updated)
        self.protect()
        self.assertEqual(json.loads(encryption.MARKDOWN_BLOCK.search(self.decrypt_html())[1]), updated)
        self.talk["encrypt"] = False
        self.protect()
        self.assertEqual(markdown.read_text(), updated)
        self.assertIsNone(encryption.find_html_payload(page, self.root)[1])

    def test_changed_plaintext_markdown_updates_an_existing_encrypted_viewer(self):
        markdown = self.folder / "slide.md"
        markdown.write_text(self.source)
        self.protect()
        updated = self.source + "\nUpdated slides.\n"
        markdown.write_text(updated)
        self.assertTrue(self.protect())
        self.assertEqual(json.loads(encryption.MARKDOWN_BLOCK.search(self.decrypt_html())[1]), updated)
        self.assertEqual(encryption.read_markdown(markdown, PASSWORD, STATICRYPT), updated)

    def test_recursive_html_is_restored_before_obsolete_assets_are_removed(self):
        main = '<html><body>Main presentation</body></html>'
        variant = '<html><body><img src="../picture.png"><script src="/js/shared.js"></script></body></html>'
        (self.folder / "index.html").write_text(main)
        nested = self.folder / "nested/extra.html"
        nested.parent.mkdir()
        nested.write_text(variant)
        self.protect()
        payload_file, _ = encryption.find_html_payload(nested, self.root)
        self.talk["encrypt"] = False
        self.protect()
        self.assertEqual((self.folder / "index.html").read_text(), main)
        self.assertEqual(nested.read_text(), variant)
        self.assertFalse(payload_file.exists())

    def test_legacy_inline_payload_and_extracted_assets_are_supported(self):
        original = '<html><body>Legacy presentation</body></html>'
        (self.folder / "index.html").write_text(original)
        self.protect()
        wrapper = self.folder / "index.html"
        script, _ = encryption.find_html_payload(wrapper, self.root)
        legacy_script = script.with_name("index-2.js")
        script.rename(legacy_script)
        engine = legacy_script.with_name("index.js")
        engine.write_text("const staticryptInitiator = {};")
        style = self.root / "css/talks/private/index.css"
        style.parent.mkdir(parents=True)
        style.write_text(".staticrypt-form { color: red; }")
        wrapper.write_text(wrapper.read_text().replace("index-locked.js", "index-2.js").replace(
            "</head>", '<script src="/js/talks/private/index.js"></script><link href="/css/talks/private/index.css" rel="stylesheet"></head>'
        ))
        self.talk["encrypt"] = False
        self.protect()
        self.assertEqual(wrapper.read_text(), original)
        self.assertFalse(legacy_script.exists())
        self.assertFalse(engine.exists())
        self.assertFalse(style.exists())
        self.talk["encrypt"] = True
        self.protect()
        script, _ = encryption.find_html_payload(wrapper, self.root)
        wrapper.write_text(wrapper.read_text().replace(
            f'<script src="/js/talks/private/{script.name}"></script>', f'<script>{script.read_text()}</script>'
        ))
        script.unlink()
        self.talk["encrypt"] = False
        self.protect()
        self.assertEqual(wrapper.read_text(), original)

    def test_referenced_encryption_assets_and_shared_styles_are_retained(self):
        (self.folder / "index.html").write_text('<html><body>Presentation</body></html>')
        self.protect()
        script, _ = encryption.find_html_payload(self.folder / "index.html", self.root)
        (self.root / "other.html").write_text(f'<script src="https://charlesneimog.github.io/js/talks/private/{script.name}"></script>')
        shared = self.root / "css/talks/template.css"
        shared.parent.mkdir(parents=True)
        shared.write_text(".staticrypt-spinner { display: block; }")
        self.talk["encrypt"] = False
        self.protect()
        self.assertTrue(script.exists())
        self.assertTrue(shared.exists())

    def test_assets_referenced_only_inside_another_protected_page_are_retained(self):
        (self.folder / "index.html").write_text('<html><body>Presentation</body></html>')
        self.protect()
        script, _ = encryption.find_html_payload(self.folder / "index.html", self.root)
        other = self.root / "talks/other"
        other.mkdir()
        (other / "index.html").write_text(f'<html><body><script src="/js/talks/private/{script.name}"></script></body></html>')
        encryption.protect_presentation({"link": "./other", "encrypt": True}, self.root, PASSWORD, STATICRYPT)
        self.talk["encrypt"] = False
        self.protect()
        self.assertTrue(script.exists())

    def test_malformed_markdown_does_not_modify_any_files(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        self.talk["encrypt"] = False
        for damaged in ('{"format":"staticrypt-markdown",', '{"format":"staticrypt-markdown","version":1}'):
            (self.folder / "slide.md").write_text(damaged)
            before = self.snapshot()
            with self.assertRaisesRegex(RuntimeError, "Malformed"):
                self.protect()
            self.assertEqual(self.snapshot(), before)

    def test_malformed_html_payload_does_not_modify_any_files(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        script, payload = encryption.find_html_payload(self.folder / "index.html", self.root)
        script.write_text(script.read_text().replace(payload[encryption.CIPHER_FIELDS[0]], "broken-ciphertext"))
        self.talk["encrypt"] = False
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "Malformed"):
            self.protect()
        self.assertEqual(self.snapshot(), before)

    def test_late_recursive_decryption_failure_leaves_every_file_unchanged(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        nested = self.folder / "nested/extra.html"
        nested.parent.mkdir()
        encryption.write_protected_html(nested, '<html><body>Different password</body></html>',
                                        "different-password", STATICRYPT, self.root)
        self.talk["encrypt"] = False
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "Could not decrypt"):
            self.protect()
        self.assertEqual(self.snapshot(), before)

    def test_late_markdown_decryption_failure_leaves_html_encrypted(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        payload = encryption.payload_operation("encrypt", "different-password", STATICRYPT, source=self.source)
        (self.folder / "slide.md").write_text(json.dumps(payload))
        self.talk["encrypt"] = False
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "Could not decrypt"):
            self.protect()
        self.assertEqual(self.snapshot(), before)

    def test_atomic_replacement_rolls_back_a_partial_filesystem_failure(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        self.talk["encrypt"] = False
        before = self.snapshot()
        replace = os.replace
        calls = 0

        def fail_second_replace(source, destination):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("Simulated replacement failure")
            return replace(source, destination)

        with mock.patch.object(encryption.os, "replace", side_effect=fail_second_replace):
            with self.assertRaisesRegex(OSError, "Simulated replacement failure"):
                self.protect()
        self.assertEqual(self.snapshot(), before)

    def test_cli_prepares_all_presentations_before_replacing_and_preserves_catalog(self):
        (self.folder / "slide.md").write_text(self.source)
        self.protect()
        other = self.root / "talks/other"
        other.mkdir()
        encryption.write_protected_html(other / "index.html", '<html><body>Other</body></html>',
                                        "different-password", STATICRYPT, self.root)
        self.talk["encrypt"] = False
        catalog = self.root / "talks/talks.json"
        catalog.write_text(json.dumps([self.talk, {"link": "./other", "encrypt": False}], indent=3))
        helper = self.root / "scripts/staticrypt_payload.cjs"
        helper.parent.mkdir()
        shutil.copyfile(ROOT / "scripts/staticrypt_payload.cjs", helper)
        before = self.snapshot()
        with mock.patch.object(encryption, "SITE_ROOT", self.root), mock.patch.dict(
            os.environ, {"STATICRYPT_PASSWORD": PASSWORD}
        ), mock.patch("sys.argv", ["encrypt.py", "--no-tailwind"]):
            with self.assertRaisesRegex(RuntimeError, "Could not process ./other: Could not decrypt"):
                encryption.main()
        self.assertEqual(self.snapshot(), before)


if __name__ == "__main__":
    unittest.main()
