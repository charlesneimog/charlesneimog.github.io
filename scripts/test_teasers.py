"""Configuration regressions: python -m unittest test_teasers.py."""

from copy import deepcopy
import json
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import teasers


class TeaserConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "example.json"
        self.data = {
            "video_screens": {"Message": {"type": "message", "text": "Hello world."}},
            "scenes": ["Message"],
        }

    def load(self, data=None):
        self.path.write_text(json.dumps(self.data if data is None else data), encoding="utf-8")
        return teasers.load_settings(self.path)

    def test_minimal_teaser_needs_no_title_warning_or_performances(self):
        settings = self.load()
        self.assertEqual(settings["configuration"]["performances"], {})
        self.assertEqual(settings["render"]["frame_width"], 9)
        self.assertEqual(settings["video_screens"]["Message"]["font_size"], 30)

    def test_existing_teasers_validate_and_keep_all_musicians(self):
        root = Path(teasers.__file__).parent
        nis = teasers.load_settings(root / "NIS.json")
        openscofo = teasers.load_settings(root / "openscofo.json")
        self.assertEqual(len(teasers.selected_screens(nis)), 12)
        self.assertEqual(openscofo["scenes"][-1], "end_card")
        self.assertEqual([Path(logo["image"]).name for logo in openscofo["video_screens"]["end_card"]["logos"]],
                         ["eca.png", "capes.png", "usp.png"])
        self.assertEqual(len(nis["configuration"]["performances"]["carioca"]["musicians"]), 28)

    def test_required_fields_and_unknown_options_report_screen(self):
        cases = [({"type": "message"}, "'text' is a required property"),
                 ({"type": "message", "text": "Hi", "duraton": 4}, "duraton"),
                 ({"type": "message", "text": "Hi", "show_authors": True}, "show_authors"),
                 ({"type": "message", "text": "Hi", "duration": False}, "duration"),
                 ({"type": "message", "text": "Hi", "transparent": "false"}, "transparent"),
                 ({"type": "message", "text": "Hi", "overlay_opacity": 2}, "overlay_opacity"),
                 ({"type": "credits", "columns": 0}, "columns")]
        for screen, message in cases:
            with self.subTest(screen=screen):
                data = deepcopy(self.data)
                data["video_screens"]["Message"] = screen
                with self.assertRaisesRegex(ValueError, message):
                    self.load(data)

    def test_requirements_are_controlled_by_schema(self):
        schema = teasers.read_json(teasers.SCHEMA_PATH)
        schema["$defs"]["message"]["required"] = ["text", "duration"]
        path = self.path.with_name("custom.schema.json")
        path.write_text(json.dumps(schema), encoding="utf-8")
        with patch.object(teasers, "SCHEMA_PATH", path):
            with self.assertRaisesRegex(ValueError, "'duration' is a required property"):
                self.load()
            self.data["video_screens"]["Message"]["duration"] = 3
            self.assertEqual(self.load()["video_screens"]["Message"]["duration"], 3)

    def test_omitting_optional_text_is_supported_when_schema_allows_it(self):
        schema = teasers.read_json(teasers.SCHEMA_PATH)
        schema["$defs"]["message"]["required"] = []
        path = self.path.with_name("custom.schema.json")
        path.write_text(json.dumps(schema), encoding="utf-8")
        del self.data["video_screens"]["Message"]["text"]
        with patch.object(teasers, "SCHEMA_PATH", path):
            self.load()

    def test_duplicate_keys_are_not_silently_discarded(self):
        self.path.write_text('{"render": {}, "render": {}}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Duplicate JSON key: 'render'"):
            teasers.load_settings(self.path)

    def test_unknown_scene_and_performance_references_fail_early(self):
        self.data["scenes"] = ["Missing"]
        with self.assertRaisesRegex(ValueError, "unknown video screen 'Missing'"):
            self.load()
        self.data["scenes"] = ["Message"]
        self.data["video_screens"]["Message"] = {"type": "performance", "performance": "missing"}
        with self.assertRaisesRegex(ValueError, "unknown performance 'missing'"):
            self.load()

    def test_order_and_disabled_screens_are_respected(self):
        self.data["video_screens"].update(End={"type": "end_card"}, Hidden={"type": "overlay", "enabled": False})
        self.data["scenes"] = ["End", "Hidden", "Message"]
        settings = self.load()
        self.assertEqual([name for name, _ in teasers.selected_screens(settings)], ["End", "Message"])
        self.assertEqual([name for name, _ in teasers.selected_screens(settings, ["Message", "End"])], ["End", "Message"])
        with self.assertRaisesRegex(ValueError, "Unknown scene"):
            teasers.selected_screens(settings, ["Typo"])

    def test_geometry_and_transparency_are_not_silently_overridden(self):
        self.data["render"] = {"pixel_width": 1920, "pixel_height": 1080, "frame_height": 9, "frame_rate": 24}
        settings = self.load()
        self.assertEqual(settings["render"]["frame_width"], 16)
        self.assertEqual(settings["render"]["frame_rate"], 24)
        self.data["render"]["frame_width"] = 9
        with self.assertRaisesRegex(ValueError, "must match"):
            self.load()
        del self.data["render"]["frame_width"]
        self.data["render"]["transparent"] = True
        with self.assertRaisesRegex(ValueError, "requires format"):
            self.load()

    def test_screens_inherit_transparency_and_can_override_in_either_direction(self):
        for global_value in (True, False):
            with self.subTest(global_value=global_value):
                self.data["render"] = {"format": "mov", "transparent": global_value}
                self.data["video_screens"]["Override"] = {
                    "type": "message", "text": "Override", "transparent": not global_value,
                }
                self.data["scenes"] = ["Message", "Override"]
                screens = self.load()["video_screens"]
                self.assertEqual(screens["Message"]["transparent"], global_value)
                self.assertEqual(screens["Override"]["transparent"], not global_value)

    def test_mp4_transparency_validation_uses_screen_override(self):
        self.data["video_screens"]["Message"]["transparent"] = True
        with self.assertRaisesRegex(ValueError, "video_screens.Message: transparent output requires format"):
            self.load()
        self.data["render"] = {"format": "mp4", "transparent": True}
        self.data["video_screens"]["Message"]["transparent"] = False
        self.assertFalse(self.load()["video_screens"]["Message"]["transparent"])

    def test_padding_cannot_hide_all_text(self):
        self.data["video_screens"]["Message"]["overlay_padding"] = 10
        with self.assertRaisesRegex(ValueError, "padding leaves no space"):
            self.load()

    def test_pagination_preserves_deliberate_line_breaks_and_limits(self):
        self.assertEqual(teasers.text_pages("one\ntwo\n\nthree", 50), ["one\ntwo\n\nthree"])
        pages = teasers.text_pages("á" * 37, 10)
        self.assertEqual("".join(pages), "á" * 37)
        self.assertTrue(all(len(page) <= 10 for page in pages))
        with self.assertRaises(ValueError):
            teasers.text_pages("Hello", 0)

    def test_explicit_duration_is_total_including_all_pages(self):
        screen = self.load()["video_screens"]["Message"]
        pages = ["Hi", "Longer text"]
        self.assertEqual(teasers.page_durations(pages, screen), [4, 4])
        screen["duration"] = 6
        self.assertEqual(teasers.page_durations(pages, screen), [3, 3])

    def test_text_does_not_rewrap_at_different_video_resolutions(self):
        import manim as m

        layout = teasers.ScreenLayout()
        layout.m = m
        layout.visual = self.load()["configuration"]["visual"]
        dimensions = []
        for width, height in ((180, 320), (1080, 1920)):
            with m.tempconfig({"pixel_width": width, "pixel_height": height,
                               "text_dir": str(self.path.parent / f"texts-{width}")}):
                text = layout.text("The same sentence must stay on one line at any output resolution.", 30)
                dimensions.append((text.width, text.height))
                self.assertEqual((m.config.pixel_width, m.config.pixel_height), (width, height))
        self.assertAlmostEqual(dimensions[0][0], dimensions[1][0])
        self.assertAlmostEqual(dimensions[0][1], dimensions[1][1])

    def test_title_image_paths_are_relative_to_the_json(self):
        image = self.path.parent / "logo.svg"
        image.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>')
        self.data["video_screens"]["Message"] = {"type": "title", "image": "logo.svg", "show_title": False}
        screen = self.load()["video_screens"]["Message"]
        self.assertEqual(screen["image"], str(image.resolve()))
        self.assertEqual(screen["image_height"], 3)
        self.assertFalse(screen["show_title"])

    def test_missing_title_image_fails_before_rendering(self):
        self.data["video_screens"]["Message"] = {"type": "title", "image": "missing.svg"}
        with self.assertRaisesRegex(ValueError, "video_screens.Message.image: file not found"):
            self.load()

    def test_title_image_options_are_validated(self):
        for options in ({"image_height": 0}, {"image_color": "white"}, {"image": ""}):
            with self.subTest(options=options):
                self.data["video_screens"]["Message"] = {"type": "title", **options}
                with self.assertRaises(ValueError):
                    self.load()
        self.data["video_screens"]["Message"] = {"type": "message", "text": "Hello", "image": "logo.png"}
        with self.assertRaisesRegex(ValueError, "image"):
            self.load()

    def test_logo_paths_defaults_and_special_thanks(self):
        image = self.path.parent / "logo.svg"
        image.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')
        self.data["video_screens"]["Message"] = {
            "type": "logos", "logos": [{"image": "logo.svg"}, {"image": str(image)}],
            "special_thanks": ["A musician", "An institution"],
        }
        screen = self.load()["video_screens"]["Message"]
        self.assertEqual([logo["image"] for logo in screen["logos"]], [str(image.resolve())] * 2)
        self.assertEqual(screen["image_height"], 2.5)
        self.assertEqual(screen["duration"], 6)
        self.assertEqual(screen["special_thanks_title"], "Special thanks")
        self.assertEqual(screen["special_thanks"], ["A musician", "An institution"])

    def test_missing_logo_reports_its_position_before_rendering(self):
        self.data["video_screens"]["Message"] = {"type": "logos", "logos": [{"image": "missing.png"}]}
        with self.assertRaisesRegex(ValueError, "video_screens.Message.logos.0.image: file not found"):
            self.load()

    def test_logo_schema_rejects_incomplete_entries_and_unknown_options(self):
        cases = [{"type": "logos"}, {"type": "logos", "logos": []},
                 {"type": "logos", "logos": [{}]},
                 {"type": "logos", "logos": [{"image": " "}]},
                 {"type": "logos", "logos": [{"image": "logo.png", "position": "left"}]},
                 {"type": "logos", "logos": [{"image": "logo.png", "image_color": "white"}]},
                 {"type": "logos", "logos": [{"image": "logo.png"}], "gap": -1},
                 {"type": "logos", "logos": [{"image": "logo.png"}], "special_thanks": [""]},
                 {"type": "message", "text": "Hello", "logos": [{"image": "logo.png"}]}]
        for screen in cases:
            with self.subTest(screen=screen):
                self.data["video_screens"]["Message"] = screen
                with self.assertRaises(ValueError):
                    self.load()

    def test_logo_layout_fits_different_counts_aspects_and_thanks(self):
        import manim as m
        import numpy as np

        for width, height in ((16, 9), (9, 16), (4, 4)):
            for count in (1, 2, 3, 5, 12, 25):
                for thanks in ([], ["A long acknowledgment " * 8, "Another name"]):
                    with self.subTest(frame=(width, height), count=count, thanks=bool(thanks)):
                        layout = teasers.ScreenLayout()
                        layout.m = m
                        layout.visual = self.load()["configuration"]["visual"]
                        layout.screen = {
                            "logos": [{"image": str(index)} for index in range(count)],
                            "image_height": 2.5, "gap": 0.65 if count < 12 else 100,
                            "overlay_enabled": True, "overlay_padding": 0.25, "overlay_opacity": 0.65,
                            "special_thanks": thanks, "special_thanks_title": "Special thanks",
                            "font_size": 22, "title_font_size": 35,
                        }
                        ratios = (0.25, 1, 4)
                        images = [m.ImageMobject(np.full((8, int(8 * ratios[i % 3]), 4), 255, dtype=np.uint8))
                                  for i in range(count)]
                        with m.tempconfig({"frame_width": width, "frame_height": height,
                                           "pixel_width": 400, "pixel_height": int(400 * height / width),
                                           "text_dir": str(self.path.parent / "texts")}):
                            with patch.object(layout, "image", side_effect=images), patch.object(layout, "add", create=True) as add:
                                layout.logos()
                        panel = add.call_args.args[0]
                        self.assertLessEqual(panel.width, width - 2 * layout.visual["margin_x"] + 1e-6)
                        self.assertLessEqual(panel.height, height - 2 * layout.visual["margin_y"] + 1e-6)
                        self.assertAlmostEqual(panel.get_center()[0], 0)
                        self.assertAlmostEqual(panel.get_center()[1], 0)
                        for i, image in enumerate(images):
                            self.assertAlmostEqual(image.width / image.height, ratios[i % 3])
                            for other in images[i + 1:]:
                                overlap_x = min(image.get_right()[0], other.get_right()[0]) - max(image.get_left()[0], other.get_left()[0])
                                overlap_y = min(image.get_top()[1], other.get_top()[1]) - max(image.get_bottom()[1], other.get_bottom()[1])
                                self.assertTrue(overlap_x <= 1e-6 or overlap_y <= 1e-6)
                        positions = [(round(-image.get_center()[1], 6), round(image.get_center()[0], 6)) for image in images]
                        self.assertEqual(positions, sorted(positions))
                        content = panel[1]
                        self.assertEqual(len(content), 2 if thanks else 1)
                        if thanks:
                            self.assertGreater(content[0].get_bottom()[1], content[1].get_top()[1])

    def test_image_tint_preserves_transparency_and_proportions(self):
        import manim as m
        import numpy as np
        from PIL import Image

        image = self.path.parent / "logo.png"
        rgba = np.array([[[255, 0, 0, 0], [100, 50, 200, 127], [20, 200, 100, 255]]], dtype=np.uint8)
        Image.fromarray(rgba).save(image)
        layout = teasers.ScreenLayout()
        layout.m = m
        layout.screen = {"image": str(image), "image_height": 2, "image_color": "#FFFFFF"}
        result = layout.title_image()
        self.assertTrue(np.array_equal(result.pixel_array[:, :, 3], rgba[:, :, 3]))
        self.assertTrue((result.pixel_array[:, :, :3] == 255).all())
        self.assertAlmostEqual(result.height, 2)
        self.assertAlmostEqual(result.width / result.height, 3)

    def test_downsampling_preserves_fine_detail_transparency_and_layout(self):
        import manim as m
        import numpy as np

        # Alternating transparent and opaque strokes should average to 50%
        # opacity when reduced, rather than disappearing or becoming solid.
        rgba = np.full((64, 64, 4), 255, dtype=np.uint8)
        rgba[:, ::2, 3] = 0
        image = m.ImageMobject(rgba).scale_to_fit_height(4)
        small = m.ImageMobject(rgba[:4, :4]).scale_to_fit_height(4)
        group = m.Group(image, small).arrange(m.RIGHT).scale(0.25)
        points = image.points.copy()
        small_pixels = small.pixel_array.copy()
        layout = teasers.ScreenLayout()
        layout.m = m
        layout.camera = SimpleNamespace(pixel_width=64, pixel_height=64, frame_width=8, frame_height=8)
        with patch.object(layout, "get_mobject_family_members", return_value=group.get_family(), create=True):
            layout.resample_images()
        self.assertEqual(image.pixel_array.shape, (8, 8, 4))
        alpha = image.pixel_array[1:-1, 1:-1, 3]
        self.assertTrue(((alpha > 120) & (alpha < 136)).all())
        self.assertTrue((image.pixel_array[:, :, :3] == 255).all())
        self.assertTrue(np.array_equal(image.pixel_array[:, :, 3], image.orig_alpha_pixel_array))
        self.assertTrue(np.array_equal(image.points, points))
        self.assertTrue(np.array_equal(small.pixel_array, small_pixels))

    @unittest.skipUnless(shutil.which("rsvg-convert"), "SVG titles require rsvg-convert")
    def test_svg_title_includes_embedded_text_and_original_colors(self):
        import manim as m

        image = self.path.parent / "wordmark.svg"
        image.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="5" y="55" font-size="30" fill="#FF0000">OpenScofo</text></svg>')
        layout = teasers.ScreenLayout()
        layout.m = m
        layout.screen = {"image": str(image), "image_height": 2}
        result = layout.title_image()
        visible = result.pixel_array[result.pixel_array[:, :, 3] > 0]
        self.assertGreater(len(visible), 0)
        self.assertTrue((visible[:, :3] == [255, 0, 0]).all())


if __name__ == "__main__":
    unittest.main()
