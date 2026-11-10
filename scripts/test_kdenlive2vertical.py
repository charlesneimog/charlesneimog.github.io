"""Timing/graph invariants and failure handling, without rendering dependencies."""

from copy import deepcopy
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location("kdenlive2vertical", Path(__file__).resolve().parents[1] / "kdenlive2vertical.py")
kv = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = kv
spec.loader.exec_module(kv)


class ProjectTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        (self.directory / "source.mp4").write_bytes(b"fixture media")
        self.source = self.directory / "edit.kdenlive"
        self.root = ET.fromstring('''<mlt root="." producer="main_bin">
          <profile width="1920" height="1080" frame_rate_num="30000" frame_rate_den="1001"
            colorspace="709" progressive="1" sample_aspect_num="1" sample_aspect_den="1"
            display_aspect_num="16" display_aspect_den="9"/>
          <chain id="video" out="99"><property name="resource">source.mp4</property>
            <property name="mlt_service">avformat</property><property name="set.test_audio">1</property>
            <property name="audio_index">1</property><property name="video_index">0</property></chain>
          <chain id="audio" out="99"><property name="resource">source.mp4</property>
            <property name="mlt_service">avformat</property><property name="set.test_image">1</property>
            <property name="audio_index">1</property><property name="video_index">0</property></chain>
          <chain id="unused" out="999"><property name="resource">missing-unused.mp4</property>
            <property name="mlt_service">avformat</property></chain>
          <playlist id="inner"><blank length="5"/><entry producer="video" in="10" out="29"/></playlist>
          <tractor id="nested" out="24"><track producer="inner" hide="audio"/></tractor>
          <playlist id="outer"><blank length="7"/><entry producer="nested" in="8" out="18"/></playlist>
          <playlist id="audio_lane"><blank length="7"/><entry producer="audio" in="13" out="23">
            <filter id="fade" in="13" out="15"><property name="mlt_service">volume</property>
              <property name="kdenlive_id">fadein</property><property name="gain">0</property>
              <property name="end">1</property></filter></entry></playlist>
          <tractor id="muted"><track producer="audio_lane" hide="both"/>
            <filter id="gain"><property name="mlt_service">volume</property>
              <property name="level">-24.2265</property></filter></tractor>
          <tractor id="sequence" out="17"><property name="kdenlive:uuid">uuid</property>
            <track producer="outer" hide="audio"/><track producer="audio_lane" hide="video"/>
            <track producer="muted"/></tractor>
          <playlist id="main_bin"><property name="kdenlive:docproperties.activetimeline">uuid</property>
            <entry producer="unused" in="0" out="999"/>
            <entry producer="sequence" in="0" out="18"/></playlist>
          <tractor id="export" out="17"><property name="kdenlive:projectTractor">1</property>
            <track producer="sequence" in="0" out="17"/></tractor>
        </mlt>''')

    def project(self):
        ET.ElementTree(self.root).write(self.source)
        return kv.Project(self.source)

    def test_nested_trims_duplicate_media_and_muted_tracks(self):
        p = self.project()
        self.assertEqual(p.active, "sequence")
        self.assertEqual(p.length(p.active), 18)
        video = next(c for c in p.clips if c.video)
        self.assertEqual((video.key, video.start, video.source_in, video.source_out, video.duration),
                         ("inner:0", 7, 13, 23, 11))
        self.assertEqual(len(p.clips), 3)
        self.assertEqual(sum(c.audio for c in p.clips), 1)
        self.assertTrue(p.clips[-1].hidden_audio)
        self.assertNotIn("unused", {c.producer for c in p.clips})
        self.assertEqual(p.media["video"], self.directory / "source.mp4")

    def test_missing_internal_reference_and_duplicate_ids(self):
        self.root.find("playlist/entry").set("producer", "absent")
        with self.assertRaisesRegex(kv.ConversionError, "Unresolved entry"):
            self.project()
        self.root.find("playlist/entry").set("producer", "video")
        self.root.append(deepcopy(self.root.find("chain")))
        with self.assertRaisesRegex(kv.ConversionError, "Duplicate XML IDs"):
            self.project()

    def test_cycle_is_reported(self):
        self.root.find("playlist/entry").set("producer", "nested")
        with self.assertRaisesRegex(kv.ConversionError, "Cyclic"):
            self.project()

    def test_conversion_preserves_audio_and_nested_timing(self):
        p = self.project()
        before = p.audio_signature()
        before_timeline = p.timeline_signature()
        c = next(c for c in p.clips if c.video)
        output, assets = self.directory / "vertical.kdenlive", self.directory / "assets"
        check = kv.convert_xml(p, {}, {}, [(c, {"mode": "crop"}, (1920, 1080))], output, assets)
        after = kv.Project(output)
        self.assertEqual(after.timeline_signature(), before_timeline)
        self.assertEqual(after.audio_signature(), before)
        self.assertEqual(after.fps, Fraction(30000, 1001))
        self.assertEqual(after.profile.get("width"), "1080")
        self.assertEqual(after.profile.get("height"), "1920")
        camera = after.nodes["inner"].find("entry/filter")
        self.assertEqual((camera.get("in"), camera.get("out")), ("13", "23"))
        self.assertEqual(check["baked_camera_movements"], [])
        self.assertEqual(self.source.read_bytes(), ET.tostring(self.root))

    def test_dry_run_writes_nothing_and_reports_unused_missing_media(self):
        self.project()
        before = {p.name: p.read_bytes() for p in self.directory.iterdir()}
        info = {"streams": [{"codec_type": "video", "width": 1920, "height": 1080,
                             "sample_aspect_ratio": "1:1", "duration": "10"}],
                "format": {"duration": "10"}}
        with patch.object(kv, "probe", return_value=info):
            code = kv.main([str(self.source), "--dry-run", "--output", str(self.directory / "new"),
                            "--assets-dir", str(self.directory / "new-assets")])
        self.assertEqual(code, 0)
        self.assertEqual(before, {p.name: p.read_bytes() for p in self.directory.iterdir()})


class TimeAndFramingTest(unittest.TestCase):
    def test_fractional_rate_clock_and_inclusive_out(self):
        fps = Fraction(30000, 1001)
        self.assertEqual(kv.frames("00:00:01.502", fps), 45)
        self.assertEqual(kv.frames("00:00:01:15", fps), 45)
        self.assertEqual(kv.frames("45", fps), 45)
        self.assertEqual(kv.frames("00:00:00.033", fps) - kv.frames("0", fps) + 1, 2)

    def test_camera_never_exposes_edges_during_eased_crop(self):
        spec = {"mode": "crop", "start": {"x": 0, "y": 1, "zoom": 1},
                "end": {"x": 1, "y": 0, "zoom": 1.15}}
        animation = kv.camera_animation((1920, 1080), spec, 301)
        self.assertTrue(animation.startswith("0="))
        self.assertIn("300=", animation)
        for pair in animation.split(";"):
            x, y, w, h, _ = map(float, pair.split("=")[1].split())
            self.assertLessEqual(x, 0.00001)
            self.assertLessEqual(y, 0.00001)
            self.assertGreaterEqual(x + w, kv.WIDTH - 0.00001)
            self.assertGreaterEqual(y + h, kv.HEIGHT - 0.00001)

    def test_fit_focal_point_moves_with_background_and_no_stretch(self):
        rect = kv.camera_rectangle((1920, 1200), {"mode": "fit"}, {"x": .64, "y": .35, "zoom": 1.38})
        self.assertAlmostEqual(rect[2] / rect[3], 1920 / 1200)
        self.assertAlmostEqual(rect[1] + .35 * rect[3], kv.HEIGHT / 2)

    def test_invalid_or_oversampled_keyframes_rejected(self):
        for spec in ({"mode": "crop", "start": {"zoom": .9}},
                     {"keyframes": [{"at": 0}, {"at": .001}, {"at": 1}]}):
            with self.assertRaises(kv.ConversionError):
                kv.validate_framing(spec, 30)

    def test_spatial_effect_geometry_scaling_and_unknown_syntax(self):
        self.assertEqual(kv.scale_rectangles("0=-10 20 1920 1080 1;29~=0% 0% 100% 100% 0.5", .5, 2),
                         "0=-5.000000 40.000000 960.000000 2160.000000 1;29~=0% 0% 100% 100% 0.5")
        with self.assertRaises(kv.ConversionError):
            kv.scale_rectangles("0/0:100x100", 1, 1)


if __name__ == "__main__":
    unittest.main()
