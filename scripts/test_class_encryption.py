"""Exercise reversible encryption for numbered class Markdown lessons."""

import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("class_encryption", ROOT / "classes/encrypt.py")
encryption = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(encryption)
STATICRYPT = shutil.which("staticrypt")
PASSWORD = "class-test-password"
SECRET = encryption.normalize_password(PASSWORD)


class FixedProvider:
    def __init__(self, secret=SECRET):
        self.secret = secret
        self.calls = 0

    def get_secret(self, _course_path, _config):
        self.calls += 1
        return self.secret


@unittest.skipUnless(STATICRYPT and shutil.which("node"), "StatiCrypt and Node.js are required")
class ClassEncryptionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.course = self.root / "classes/2026/Test-Course"
        self.course.mkdir(parents=True)
        self.config_file = self.course / "course.json"
        self.config = {
            "title": "Test course",
            "description": "Private lessons",
            "encrypt": True,
            "passwordHash": SECRET,
            "lessonPrefix": "aula",
            "lessonExtension": ".md",
            "maxLessons": 50,
        }
        self.sources = {
            "aula1.md": "# First lesson\n\nConfidential content.\n",
            "aula2.md": "# Second lesson\n\nMore confidential content.\n",
        }
        self.write_config(self.config)
        for name, source in self.sources.items():
            (self.course / name).write_text(source, encoding="utf-8")

    def write_config(self, config):
        self.config_file.write_text(json.dumps(config, indent=4), encoding="utf-8")

    def apply(self, provider=None):
        changes = encryption.prepare_course(
            "2026/Test-Course", self.course, provider or FixedProvider(), STATICRYPT
        )
        encryption.talk_encryption.replace_files(changes)
        return changes

    def snapshot(self):
        return {path.name: path.read_bytes() for path in self.course.iterdir() if path.is_file()}

    def test_encrypts_all_lessons_with_one_salt_and_removes_fast_password_hash(self):
        self.apply()
        salts = set()
        for name, source in self.sources.items():
            filename = self.course / name
            public_source = filename.read_text(encoding="utf-8")
            self.assertNotIn("Confidential", public_source)
            payload = json.loads(public_source)
            salts.add(payload["staticryptSaltUniqueVariableName"])
            self.assertEqual(
                encryption.talk_encryption.payload_operation(
                    "decrypt", SECRET, STATICRYPT, payload=payload
                ),
                source,
            )
        self.assertEqual(len(salts), 1)
        public_config = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertTrue(public_config["encrypt"])
        self.assertNotIn("password", public_config)
        self.assertNotIn("passwordHash", public_config)

    def test_rerun_is_idempotent_and_does_not_request_password(self):
        self.apply()

        class RejectProvider:
            def get_secret(self, *_args):
                raise AssertionError("An unchanged encrypted course must not request a password")

        before = self.snapshot()
        changes = encryption.prepare_course(
            "2026/Test-Course", self.course, RejectProvider(), STATICRYPT
        )
        self.assertEqual(changes, {})
        self.assertEqual(self.snapshot(), before)

    def test_encrypt_then_decrypt_round_trip(self):
        self.apply()
        config = json.loads(self.config_file.read_text(encoding="utf-8"))
        config["encrypt"] = False
        self.write_config(config)
        self.apply(FixedProvider())
        for name, source in self.sources.items():
            self.assertEqual((self.course / name).read_text(encoding="utf-8"), source)

    def test_wrong_password_leaves_every_file_unchanged(self):
        self.apply()
        config = json.loads(self.config_file.read_text(encoding="utf-8"))
        config["encrypt"] = False
        self.write_config(config)
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "Could not decrypt"):
            encryption.prepare_course(
                "2026/Test-Course",
                self.course,
                FixedProvider(encryption.normalize_password("wrong-password")),
                STATICRYPT,
            )
        self.assertEqual(self.snapshot(), before)

    def test_mixed_course_reuses_existing_salt(self):
        self.apply()
        original_payload = json.loads((self.course / "aula1.md").read_text(encoding="utf-8"))
        (self.course / "aula3.md").write_text("# Third lesson\n\nNew content.\n", encoding="utf-8")
        self.apply(FixedProvider())
        new_payload = json.loads((self.course / "aula3.md").read_text(encoding="utf-8"))
        self.assertEqual(
            new_payload["staticryptSaltUniqueVariableName"],
            original_payload["staticryptSaltUniqueVariableName"],
        )

    def test_conflicting_salts_are_rejected_before_changes(self):
        first = encryption.talk_encryption.payload_operation(
            "encrypt", SECRET, STATICRYPT, source=self.sources["aula1.md"]
        )
        second = encryption.talk_encryption.payload_operation(
            "encrypt", SECRET, STATICRYPT, source=self.sources["aula2.md"]
        )
        (self.course / "aula1.md").write_text(json.dumps(first), encoding="utf-8")
        (self.course / "aula2.md").write_text(json.dumps(second), encoding="utf-8")
        before = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, "do not share one salt"):
            encryption.prepare_course("2026/Test-Course", self.course, FixedProvider(), STATICRYPT)
        self.assertEqual(self.snapshot(), before)


if __name__ == "__main__":
    unittest.main()

