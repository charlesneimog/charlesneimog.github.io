#!/usr/bin/env python3
"""Convert a Kdenlive timeline to portrait without rebuilding its audio edit.

The converter itself uses Python's standard library. Cards use the project's
existing teasers.py/ScreenLayout Manim workflow in a configurable interpreter.
See scripts/kdenlive2vertical.md for configuration and supported structures.
"""

from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
from dataclasses import dataclass, field
from fractions import Fraction
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urlparse
import xml.etree.ElementTree as ET


VERSION = 1
WIDTH, HEIGHT = 1080, 1920
FILE_SERVICES = {"avformat", "avformat-novalidate", "qimage", "pixbuf", "timewarp"}
GENERATORS = {"color", "colour", "qtext", "kdenlivetitle", "pango", "noise", "tone", "count"}
AUDIO_EFFECTS = {"volume", "panner", "audiolevel", "audiochannels", "audiomap",
                 "audioconvert", "swresample", "mix", "audioseam"}
SUPPORTED_EFFECTS = AUDIO_EFFECTS | {"brightness", "qtblend", "affine"}


class ConversionError(ValueError):
    pass


def properties(element):
    return {p.get("name"): p.text or "" for p in element.findall("property")}


def put(element, name, value):
    p = next((p for p in element.findall("property") if p.get("name") == name), None)
    if p is None:
        p = ET.SubElement(element, "property", name=name)
    p.text = str(value)


def load_json(path):
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise ConversionError(f"Duplicate JSON key: {k}")
            result[k] = v
        return result

    def invalid(value):
        raise ConversionError(f"Invalid JSON number: {value}")

    return json.loads(Path(path).read_text(encoding="utf-8"),
                      object_pairs_hook=unique, parse_constant=invalid)


def run(command, *, log=None, timeout=600):
    """No shell, even for configurable executables or paths containing spaces."""
    try:
        result = subprocess.run([str(a) for a in command], capture_output=True,
                                text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ConversionError(f"Cannot run {command[0]}: {error}") from error
    if log:
        Path(log).write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode:
        raise ConversionError(f"Command failed ({result.returncode}): {command!r}\n"
                              f"{(result.stdout + result.stderr)[-5000:]}")
    return result.stdout


def probe(path, ffprobe="ffprobe", *, count_frames=False):
    args = [ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json"]
    if count_frames:
        args += ["-count_frames"]
    return json.loads(run(args + [str(path)], timeout=180))


def video_stream(info):
    return next((s for s in info.get("streams", []) if s["codec_type"] == "video"), None)


def nearest(value):
    value = Fraction(value)
    return (value.numerator * 2 + value.denominator) // (2 * value.denominator)


def frames(value, fps):
    """MLT integers are frames; clock strings are seconds; out is inclusive."""
    value = str(value)
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    parts = value.split(":")
    if len(parts) == 4:
        h, m, s, f = map(int, parts)
        return nearest((h * 3600 + m * 60 + s) * fps) + f
    if len(parts) == 3:
        h, m, s = parts
        return nearest((int(h) * 3600 + int(m) * 60 + Fraction(s)) * fps)
    raise ConversionError(f"Unsupported MLT time value: {value!r}")


@dataclass
class Clip:
    key: str
    producer: str
    track: int
    start: int
    source_in: int
    source_out: int
    audio: bool
    video: bool
    hidden_audio: bool
    hidden_video: bool
    path: tuple
    entry: ET.Element = field(repr=False)
    lineage: tuple = field(repr=False)

    @property
    def duration(self):
        return self.source_out - self.source_in + 1


class Project:
    def __init__(self, source, config=None):
        self.source = Path(source).expanduser().resolve()
        self.tree = ET.parse(self.source)
        self.root = self.tree.getroot()
        if self.root.tag != "mlt":
            raise ConversionError("Expected an MLT/Kdenlive XML document.")
        self.config = config or {}
        self.profile = self.root.find("profile")
        if self.profile is None:
            raise ConversionError("Project has no explicit profile/frame rate.")
        self.fps = Fraction(int(self.profile.get("frame_rate_num")),
                            int(self.profile.get("frame_rate_den")))
        self.old_size = (int(self.profile.get("width")), int(self.profile.get("height")))
        if self.fps <= 0 or min(self.old_size) <= 0:
            raise ConversionError("Invalid project profile.")
        self.nodes = {e.get("id"): e for e in self.root
                      if e.tag in {"chain", "producer", "playlist", "tractor"}}
        self.check_references()
        self.bin = self.nodes.get("main_bin")
        self.active = self.find_active()
        self.media = {id: self.media_path(e) for id, e in self.nodes.items()
                      if e.tag in {"chain", "producer"}}
        self.clips = []
        self.walk(self.active, 0, self.length(self.active) - 1, 0, -1,
                  False, False, (), (), None)

    def check_references(self):
        ids = [e.get("id") for e in self.root.iter() if e.get("id")]
        duplicate = [id for id, n in Counter(ids).items() if n > 1]
        if duplicate:
            raise ConversionError(f"Duplicate XML IDs: {duplicate}")
        for e in self.root.iter():
            if e.tag in {"entry", "track"} and e.get("producer") not in self.nodes:
                raise ConversionError(f"Unresolved {e.tag} reference: {e.get('producer')}")
        target = self.root.get("producer")
        if target and target not in self.nodes:
            raise ConversionError(f"Unresolved root producer: {target}")

    def find_active(self):
        selected = self.config.get("sequence")
        active_uuid = properties(self.bin).get("kdenlive:docproperties.activetimeline") if self.bin is not None else None
        candidates = []
        for id, e in self.nodes.items():
            p = properties(e)
            if e.tag == "tractor" and (id == selected or
                    (selected or active_uuid) in {p.get("kdenlive:uuid", ""),
                    p.get("kdenlive:sequenceproperties.documentuuid", "")}):
                candidates.append(id)
        if not candidates and selected:
            raise ConversionError(f"Sequence not found: {selected}")
        if not candidates:
            wrappers = [e for e in self.nodes.values()
                        if properties(e).get("kdenlive:projectTractor") == "1"]
            if len(wrappers) == 1 and len(wrappers[0].findall("track")) == 1:
                candidates = [wrappers[0].find("track").get("producer")]
        if len(candidates) != 1:
            raise ConversionError(f"Cannot identify one active sequence ({candidates}); set config.sequence.")
        return candidates[0]

    def resolve(self, value):
        if value.startswith("file:"):
            url = urlparse(value)
            if url.netloc not in {"", "localhost"}:
                raise ConversionError(f"Remote file URL unsupported: {value}")
            value = unquote(url.path)
        for old, new in self.config.get("media_relocations", {}).items():
            if value == old or value.startswith(old.rstrip("/") + "/"):
                value = str(Path(new).expanduser()) + value[len(old):]
                break
        path = Path(value).expanduser()
        if path.is_absolute():
            return path.resolve()
        root = Path(self.root.get("root", str(self.source.parent))).expanduser()
        if not root.is_absolute():
            root = self.source.parent / root
        first = (root / path).resolve()
        fallback = (self.source.parent / path).resolve()
        return first if first.exists() or not fallback.exists() else fallback

    def media_path(self, e):
        p = properties(e)
        service = p.get("mlt_service", "")
        if service in GENERATORS:
            return None
        if service not in FILE_SERVICES:
            raise ConversionError(f"Unsupported producer service {service!r} on {e.get('id')}; "
                                  "XML-backed, network and custom producers need an explicit adapter.")
        value = p.get("warp_resource") if service == "timewarp" else p.get("resource")
        if not value:
            raise ConversionError(f"Producer {e.get('id')} has no media resource.")
        if re.match(r"^[a-zA-Z]+://", value) and not value.startswith("file:"):
            raise ConversionError(f"Network media unsupported: {value}")
        return self.resolve(value)

    def length(self, id, stack=()):
        if id in stack:
            raise ConversionError(f"Cyclic timeline graph: {stack + (id,)}")
        e = self.nodes[id]
        if e.tag == "playlist":
            result = 0
            for child in e:
                if child.tag == "blank":
                    result += frames(child.get("length"), self.fps)
                elif child.tag == "entry":
                    a = frames(child.get("in", "0"), self.fps)
                    b = frames(child.get("out"), self.fps) if child.get("out") is not None else self.length(child.get("producer"), stack + (id,)) - 1
                    if b < a:
                        raise ConversionError(f"Invalid trim on {id}: {child.attrib}")
                    result += b - a + 1
            return result
        if e.get("out") is not None:
            # A service's out marks its final accessible source frame, even when
            # it also has a nonzero in. A track/entry applies its own trim.
            return frames(e.get("out"), self.fps) + 1
        if e.tag == "tractor":
            lengths = []
            for t in e.findall("track"):
                b = frames(t.get("out"), self.fps) + 1 if t.get("out") is not None else self.length(t.get("producer"), stack + (id,))
                lengths.append(b - frames(t.get("in", "0"), self.fps))
            return max(lengths, default=0)
        n = properties(e).get("length")
        if n is None:
            raise ConversionError(f"No duration on {id}")
        return frames(n, self.fps)

    def walk(self, id, lo, hi, start, track, ha, hv, path, lineage, entry, stack=()):
        if hi < lo:
            return
        if id in stack:
            raise ConversionError(f"Cyclic graph: {stack + (id,)}")
        e = self.nodes[id]
        lineage = lineage + (e,)
        stack = stack + (id,)
        p = properties(e)
        ha = ha or p.get("set.test_audio") == "1"
        hv = hv or p.get("set.test_image") == "1"
        if e.tag == "playlist":
            cursor, ordinal = 0, 0
            for child in e:
                if child.tag == "blank":
                    cursor += frames(child.get("length"), self.fps)
                elif child.tag == "entry":
                    a = frames(child.get("in", "0"), self.fps)
                    b = frames(child.get("out"), self.fps) if child.get("out") is not None else self.length(child.get("producer")) - 1
                    x, y = max(lo, cursor), min(hi, cursor + b - a)
                    if x <= y:
                        self.walk(child.get("producer"), a + x - cursor, a + y - cursor,
                                  start + x - lo, track, ha, hv,
                                  path + (f"{id}:{ordinal}",), lineage + (child,), child, stack)
                    cursor += b - a + 1
                    ordinal += 1
                elif child.tag not in {"property", "filter"}:
                    raise ConversionError(f"Unsupported playlist element {child.tag} in {id}")
        elif e.tag == "tractor":
            for index, t in enumerate(e.findall("track")):
                a = frames(t.get("in", "0"), self.fps)
                b = frames(t.get("out"), self.fps) if t.get("out") is not None else self.length(t.get("producer")) - 1
                x, y = max(lo, 0), min(hi, b - a)
                hidden = t.get("hide", "")
                self.walk(t.get("producer"), a + x, a + y, start + x - lo,
                          index if id == self.active else track,
                          ha or hidden in {"audio", "both"}, hv or hidden in {"video", "both"},
                          path + (f"{id}/track{index}",), lineage + (t,), entry, stack)
        else:
            if entry is None:
                return  # Sequence background producer, not a timeline clip.
            ai = p.get("audio_index", "0") != "-1" and p.get("mlt_service") not in GENERATORS
            vi = p.get("video_index", "0") != "-1" and p.get("set.test_image") != "1"
            self.clips.append(Clip(path[-1], id, track, start, lo, hi,
                                   ai and not ha, vi and not hv, ha, hv,
                                   path, entry, lineage))

    def timeline_signature(self):
        """Exact structural comparison, including muted tracks and unused lanes."""
        return [(id, e.tag, dict(e.attrib),
                 [(c.tag, dict(c.attrib), properties(c)) for c in e
                  if c.tag in {"entry", "blank", "track"}])
                for id, e in self.nodes.items() if e.tag in {"playlist", "tractor"}]

    def audio_signature(self):
        result = []
        for c in self.clips:
            p = properties(self.nodes[c.producer])
            if p.get("set.test_image") != "1" and not c.audio:
                continue
            effects = [(f.tag, dict(f.attrib), properties(f))
                       for ancestor in c.lineage for f in list(ancestor)
                       if f.tag in {"filter", "transition"}
                       and properties(f).get("mlt_service") in AUDIO_EFFECTS]
            result.append((c.path, c.producer, c.start, c.source_in, c.source_out,
                           c.hidden_audio, str(self.media[c.producer]),
                           {k: v for k, v in p.items() if k in {
                               "audio_index", "astream", "set.test_audio", "set.test_image",
                               "warp_speed", "mute_on_pause"}}, effects))
        return result


def config_path(value, base):
    p = Path(value).expanduser()
    return p.resolve() if p.is_absolute() else (base / p).resolve()


def read_config(path):
    config = load_json(path) if path else {"version": VERSION}
    if config.get("version") != VERSION:
        raise ConversionError(f"Configuration must specify version {VERSION}.")
    unknown = set(config) - {"version", "sequence", "manim", "defaults", "clips",
                             "media_relocations", "allow_unsupported_effects", "validation"}
    if unknown:
        raise ConversionError(f"Unknown configuration keys: {sorted(unknown)}")
    base = Path(path).resolve().parent if path else Path.cwd()
    for key in ("script", "settings"):
        if key in config.get("manim", {}):
            config["manim"][key] = str(config_path(config["manim"][key], base))
    for old, new in config.get("media_relocations", {}).items():
        config["media_relocations"][old] = str(config_path(new, base))
    return config


def discover_manim(project, config):
    """Discover a matching existing teasers workflow; never synthesize content."""
    supplied = config.get("manim", {})
    if supplied.get("script") and supplied.get("settings"):
        return supplied
    locations = {Path(__file__).resolve().parent / "scripts", project.source.parent,
                 Path.cwd() / "scripts"}
    for p in project.media.values():
        if p:
            locations.update(p.parents[:4])
    candidates = []
    used_stems = {p.stem for c in project.clips if c.video
                  and (p := project.media.get(c.producer))}
    for directory in sorted(locations):
        script = directory / "teasers.py"
        if not script.is_file():
            continue
        for path in directory.glob("*.json"):
            try:
                data = load_json(path)
            except (OSError, ValueError):
                continue
            if isinstance(data, dict) and isinstance(data.get("video_screens"), dict):
                score = len(used_stems & set(data["video_screens"]))
                if score:
                    candidates.append((score, script, path))
    if not candidates:
        return supplied
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        raise ConversionError("Several Manim configurations match. Set manim.script and manim.settings.")
    _, script, settings = candidates[0]
    return {**supplied, "script": str(script), "settings": str(settings)}


def validate_framing(spec, duration):
    allowed = {"mode", "start", "end", "keyframes", "background", "anchor", "note"}
    if set(spec) - allowed:
        raise ConversionError(f"Unknown framing keys: {set(spec) - allowed}")
    mode = spec.get("mode", "crop")
    if mode not in {"crop", "fit", "keep"}:
        raise ConversionError(f"Unknown camera mode: {mode}")
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", spec.get("background", "#080808")):
        raise ConversionError("background must be #RRGGBB")
    anchor = spec.get("anchor", [0.5, 0.5])
    if len(anchor) != 2 or not all(isinstance(v, (float, int)) and math.isfinite(v) and 0 <= v <= 1 for v in anchor):
        raise ConversionError("anchor must contain two normalized coordinates.")
    points = spec.get("keyframes")
    if points is None:
        a = spec.get("start", {"x": 0.5, "y": 0.5, "zoom": 1.0})
        points = [{"at": 0, **a}, {"at": 1, **spec.get("end", a)}]
    if not isinstance(points, list) or len(points) < 2:
        raise ConversionError("Supply at least two camera keyframes.")
    previous = -1
    result = []
    for point in points:
        if set(point) - {"at", "x", "y", "zoom"}:
            raise ConversionError(f"Unknown camera keyframe keys: {point}")
        values = {k: point.get(k, 1 if k == "zoom" else 0.5) for k in ("at", "x", "y", "zoom")}
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool)
                   and math.isfinite(v) for v in values.values()):
            raise ConversionError(f"Invalid camera keyframe: {point}")
        if not all(0 <= values[k] <= 1 for k in ("at", "x", "y")) or not 1 <= values["zoom"] <= 4:
            raise ConversionError(f"Focal coordinates/time must be 0..1; zoom must be 1..4: {point}")
        frame = nearest(Fraction(str(values["at"])) * (duration - 1))
        if frame <= previous and duration > 1:
            raise ConversionError("Keyframes must increase and occupy distinct frames.")
        previous = frame
        result.append((frame, values))
    if result[0][0] != 0 or result[-1][0] != duration - 1:
        raise ConversionError("Camera keyframes must start at at=0 and end at at=1.")
    return mode, result


def camera_rectangle(size, spec, point):
    """Source DAR is respected by qtblend; no stretching or subject tracking."""
    sw, sh = size
    mode = spec.get("mode", "crop")
    scale = (max if mode == "crop" else min)(WIDTH / sw, HEIGHT / sh) * point["zoom"]
    w, h = sw * scale, sh * scale
    ax, ay = spec.get("anchor", [0.5, 0.5])
    x, y = WIDTH * ax - point["x"] * w, HEIGHT * ay - point["y"] * h
    # Clamp within the image when it covers a dimension. In fit layouts, center
    # a smaller dimension at the anchor; dark background is intentional.
    x = min(0, max(WIDTH - w, x)) if w >= WIDTH else min(WIDTH - w, max(0, x))
    y = min(0, max(HEIGHT - h, y)) if h >= HEIGHT else min(HEIGHT - h, max(0, y))
    return x, y, w, h, 1.0


def camera_animation(size, spec, duration):
    """Sample smoothstep easing as bounded linear keys, avoiding spline overshoot."""
    mode, points = validate_framing(spec, duration)
    if mode == "keep":
        return ""
    rectangles = []
    for (a, pa), (b, pb) in zip(points, points[1:]):
        # At most 16 intervals per movement. All keys stay editable in Kdenlive.
        count = max(1, min(16, b - a))
        for i in range(count + 1):
            frame = a + nearest(Fraction(i, count) * (b - a))
            if rectangles and rectangles[-1][0] == frame:
                continue
            t = (frame - a) / (b - a) if b > a else 0
            ease = t * t * (3 - 2 * t)
            point = {k: pa[k] + (pb[k] - pa[k]) * ease for k in ("x", "y", "zoom")}
            rectangles.append((frame, camera_rectangle(size, spec, point)))
    return ";".join(f"{frame}=" + " ".join(f"{v:.6f}" for v in rect)
                    for frame, rect in rectangles)


def framing_for(config, clip, path):
    mapping = config.get("clips", {})
    # Precise occurrence > producer > full media path > basename > default.
    for key in (clip.key, clip.producer, str(path), path.name):
        if key in mapping:
            return deepcopy(mapping[key])
    return deepcopy(config.get("defaults", {"mode": "fit"}))


def build_plan(project, config, ffprobe):
    active_ids = {c.producer for c in project.clips}
    missing = [{"producer": id, "path": str(path), "active": id in active_ids}
               for id, path in project.media.items() if path and not path.is_file()]
    info = {}
    for id in sorted(active_ids):
        path = project.media[id]
        if path and path.is_file() and path not in info:
            info[path] = probe(path, ffprobe)
    manim = discover_manim(project, config)
    settings = load_json(manim["settings"]) if manim.get("settings") else {}
    screens = settings.get("video_screens", {})
    clips, cards, cameras = [], {}, []
    used_config = set()
    for c in project.clips:
        path = project.media[c.producer]
        stream = video_stream(info.get(path, {}))
        visible_video = c.video and stream is not None
        data = {"key": c.key, "path": list(c.path), "producer": c.producer,
                "track": c.track, "timeline_in": c.start, "timeline_out": c.start + c.duration - 1,
                "source_in": c.source_in, "source_out": c.source_out, "frames": c.duration,
                "media": str(path) if path else None, "audio": c.audio,
                "hidden_audio": c.hidden_audio, "hidden_video": c.hidden_video,
                "effects": [properties(f) for ancestor in c.lineage for f in ancestor.findall("filter")]}
        if visible_video and path.stem in screens:
            if properties(project.nodes[c.producer]).get("mlt_service") == "timewarp":
                raise ConversionError(f"Timewarped card {c.key} needs a workflow adapter.")
            scene = path.stem
            if scene not in settings.get("scenes", []) or screens[scene].get("enabled", True) is False:
                raise ConversionError(f"Used card {scene} is disabled/not selected in its existing JSON.")
            card = cards.setdefault(scene, {"sources": [], "required_frames": 0})
            if str(path) not in card["sources"]:
                card["sources"].append(str(path))
            # Retain the entire source's time domain, including unused handles.
            duration = Fraction(stream.get("duration", info[path]["format"]["duration"]))
            card["required_frames"] = max(card["required_frames"], c.source_out + 1,
                                           nearest(duration * project.fps))
            data["action"] = "regenerate Manim card"
            data["scene"] = scene
        elif visible_video:
            if path.suffix.lower() in {".mov", ".webm"} and "media" in path.parts and "videos" in path.parts:
                raise ConversionError(f"Used generated card {path} has no matching Manim scene. "
                                      "Supply its existing settings and script; cropping cards is disabled.")
            spec = framing_for(config, c, path)
            mode, _ = validate_framing(spec, c.duration)
            sar = stream.get("sample_aspect_ratio", "1:1")
            sar = Fraction(sar.replace(":", "/")) if sar not in {"N/A", "0:1", "0:0"} else Fraction(1)
            rotation = next((s.get("rotation", 0) for s in stream.get("side_data_list", [])
                             if "rotation" in s), 0)
            size = (float(stream["width"] * sar), stream["height"])
            if int(rotation) % 180:
                size = size[::-1]
            existing = [f for a in c.lineage for f in a.findall("filter")
                        if properties(f).get("mlt_service") in {"qtblend", "affine"}]
            if existing and mode != "keep":
                raise ConversionError(f"{c.key} already has a Transform effect. Use mode=keep "
                                      "or adapt its framing before applying another camera.")
            if c.entry.get("producer") != c.producer and mode != "keep":
                raise ConversionError(f"{c.key}: camera on a direct tractor track needs a playlist entry.")
            data.update(action=f"editable {mode} Transform", framing=spec, dimensions=list(size))
            cameras.append((c, spec, size))
            for k in config.get("clips", {}):
                if k in {c.key, c.producer, str(path), path.name}:
                    used_config.add(k)
        else:
            data["action"] = "preserve audio/mute state" if not visible_video else "preserve"
        clips.append(data)
    unused_config = set(config.get("clips", {})) - used_config
    if unused_config:
        raise ConversionError(f"Framing overrides match no active video clip: {sorted(unused_config)}")
    effects, unsupported = [], []
    seen = set()
    for c in project.clips:
        for ancestor in c.lineage:
            for e in list(ancestor):
                if e.tag not in {"filter", "transition"} or e in seen:
                    continue
                seen.add(e)
                p = properties(e)
                service = p.get("mlt_service", "")
                effects.append({"id": e.get("id"), "type": e.tag,
                                "attributes": dict(e.attrib), "properties": p})
                if service not in SUPPORTED_EFFECTS and service not in config.get("allow_unsupported_effects", []):
                    unsupported.append(f"{e.get('id')}: {service}")
    report = {"source": str(project.source), "active_sequence": project.active,
              "source_dimensions": list(project.old_size), "output_dimensions": [WIDTH, HEIGHT],
              "fps": str(project.fps), "timeline_frames": project.length(project.active),
              "timeline_seconds": float(Fraction(project.length(project.active), 1) / project.fps),
              "clips": clips, "cards": cards, "manim": manim,
              "missing_media": missing, "effects_and_transitions": effects,
              "unsupported_effects": unsupported,
              "unused_bin_producers": sorted(set(project.media) - active_ids),
              "warnings": ["Focal points are configured manually; no automatic subject tracking.",
                           "Inactive sequences retain their structure but are not reframed."]}
    return report, cards, cameras, info


def render_cards_job(job_path):
    """Executed in the chosen Manim Python; imports and extends the real layout."""
    job = load_json(job_path)
    spec = importlib.util.spec_from_file_location("vertical_existing_teasers", job["manim"]["script"])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if not all(hasattr(module, name) for name in ("ScreenLayout", "load_settings", "render_screens")):
        raise ConversionError("This Manim script needs a portrait adapter. The built-in adapter "
                              "supports teasers.py's ScreenLayout/load_settings/render_screens API.")
    import manim as m

    settings = module.load_settings(job["manim"]["settings"])
    margin = job["manim"].get("safe_margin_px", [90, 150])
    if len(margin) != 2 or not (0 <= margin[0] < WIDTH / 2 and 0 <= margin[1] < HEIGHT / 2):
        raise ConversionError("manim.safe_margin_px must leave a usable frame.")
    settings["render"].update(pixel_width=WIDTH, pixel_height=HEIGHT,
                               frame_width=9, frame_height=16,
                               frame_rate=float(Fraction(job["fps"])),
                               format="mov", output_dir="render")
    visual = settings["configuration"]["visual"]
    visual["margin_x"] = max(visual["margin_x"], margin[0] / WIDTH * 9)
    visual["margin_y"] = max(visual["margin_y"], margin[1] / HEIGHT * 16)
    for name, card in job["cards"].items():
        settings["video_screens"][name]["duration"] = float(Fraction(card["required_frames"], 1) / Fraction(job["fps"]))
    allowed = {"font_size", "subtitle_font_size", "authors_font_size", "title_font_size",
               "image_height", "overlay_padding", "columns", "gap", "corner_radius",
               "max_chars_per_line"}
    for name, changes in job["manim"].get("screen_overrides", {}).items():
        if name not in settings["video_screens"]:
            raise ConversionError(f"Unknown Manim scene override: {name}")
        if set(changes) - allowed:
            raise ConversionError(f"Manim overrides may adjust layout only: {set(changes) - allowed}")
        settings["video_screens"][name].update(changes)
    settings["scenes"] = [s for s in settings["scenes"] if s in job["cards"]]
    bounds = []
    existing = module.ScreenLayout

    class PortraitLayout(existing):
        def text(self, content, size, *, muted=False, bold=False):
            # Word wrapping uses the actual font's measured Manim glyph widths.
            # Preserve explicit breaks, names, punctuation and all source words.
            padding = self.screen["overlay_padding"] if self.screen["overlay_enabled"] else 0
            limit = m.config.frame_width - 2 * (self.visual["margin_x"] + padding)
            lines = []
            for line in content.split("\n"):
                current = ""
                for word in line.split():
                    candidate = f"{current} {word}".strip()
                    shaped = super().text(candidate, size, muted=muted, bold=bold)
                    if current and shaped.width > limit:
                        lines.append(current)
                        current = word
                    else:
                        current = candidate
                lines.append(current)
            return super().text("\n".join(lines), size, muted=muted, bold=bold)

        def text_block(self, page, *, left=False):
            # Existing paragraph/line spacing and panel behavior are retained.
            # Let measured wrapping, rather than landscape character counts,
            # determine breaks. Pagination is unchanged.
            old = self.screen["max_chars_per_line"]
            self.screen["max_chars_per_line"] = 100000
            try:
                return super().text_block(page, left=left)
            finally:
                self.screen["max_chars_per_line"] = old

        def wait(self, *args, **kwargs):
            # Paginated ScreenLayout removes body text after each wait. Check
            # each rendered page while its objects are still on the canvas.
            checked = []
            for obj in self.get_mobject_family_members():
                if not isinstance(obj, (m.Text, m.ImageMobject)):
                    continue
                box = [float(obj.get_left()[0]), float(obj.get_bottom()[1]),
                       float(obj.get_right()[0]), float(obj.get_top()[1])]
                if (box[0] < -4.5 + visual["margin_x"] - 0.02 or
                    box[2] > 4.5 - visual["margin_x"] + 0.02 or
                    box[1] < -8 + visual["margin_y"] - 0.02 or
                    box[3] > 8 - visual["margin_y"] + 0.02):
                    raise ConversionError(f"Card {self.__class__.__name__} exceeds safe margins: {box}")
                checked.append({"text": getattr(obj, "text", None), "bounds": box})
            bounds.append({"scene": self.__class__.__name__, "objects": checked})
            return super().wait(*args, **kwargs)

    module.ScreenLayout = PortraitLayout
    adapted = Path(job_path).with_name("portrait-settings.json")
    settings["$schema"] = str(Path(job["manim"]["script"]).with_name("teasers.schema.json"))
    adapted.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    outputs = module.render_screens(settings, adapted)
    result = {"manim_version": m.__version__, "outputs": {p.stem: str(p) for p in outputs},
              "safe_margin_px": margin, "layout_bounds": bounds}
    Path(job_path).with_name("render-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def verify_card(path, required_frames, fps, transparent, ffprobe):
    info = probe(path, ffprobe, count_frames=True)
    v = video_stream(info)
    if not v or (v["width"], v["height"]) != (WIDTH, HEIGHT):
        raise ConversionError(f"Incorrect card dimensions: {path}")
    n = int(v.get("nb_read_frames", v.get("nb_frames", 0)))
    if n != required_frames:
        raise ConversionError(f"Card {path}: expected {required_frames} frames, got {n}")
    if Fraction(v["r_frame_rate"]) != fps:
        raise ConversionError(f"Incorrect card frame rate: {path}")
    if any(s["codec_type"] == "audio" for s in info["streams"]):
        raise ConversionError(f"Generated card unexpectedly contains audio: {path}")
    has_alpha = v.get("pix_fmt", "").startswith(("argb", "rgba", "bgra", "abgr", "yuva", "gbrap"))
    if transparent and not has_alpha:
        raise ConversionError(f"Transparent card has no alpha channel: {path}")
    duration = Fraction(v.get("duration", info["format"]["duration"]))
    if abs(duration - Fraction(required_frames, 1) / fps) > Fraction(1, 1000):
        raise ConversionError(f"Incorrect generated card duration: {path}")
    return {"path": str(path), "frames": n, "dimensions": [v["width"], v["height"]],
            "fps": v["r_frame_rate"], "duration": str(duration), "alpha": has_alpha,
            "audio_streams": 0}


def render_cards(cards, manim, fps, assets, ffprobe):
    if not cards:
        return {}, {"cards": [], "status": "no cards used"}
    if not manim.get("script") or not manim.get("settings"):
        raise ConversionError("Used cards require manim.script and manim.settings.")
    interpreter = manim.get("python", sys.executable)
    fingerprint = hashlib.sha256()
    for p in (Path(__file__), Path(manim["script"]), Path(manim["settings"])):
        fingerprint.update(p.read_bytes())
    # Include referenced logos/images so changed artwork invalidates the cache.
    original_settings = load_json(manim["settings"])
    for screen in original_settings["video_screens"].values():
        images = ([screen["image"]] if "image" in screen else []) + [v["image"] for v in screen.get("logos", [])]
        for value in images:
            p = config_path(value, Path(manim["settings"]).parent)
            if not p.is_file():
                raise ConversionError(f"Missing Manim artwork: {p}")
            fingerprint.update(p.read_bytes())
    fingerprint.update(json.dumps([cards, manim, str(fps)], sort_keys=True).encode())
    directory = assets / "cards" / fingerprint.hexdigest()[:16]
    directory.mkdir(parents=True, exist_ok=True)
    result_path = directory / "render-result.json"
    if result_path.is_file():
        result = load_json(result_path)
    else:
        job = directory / "render-job.json"
        job.write_text(json.dumps({"cards": cards, "manim": manim, "fps": str(fps)},
                                  ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Rendering {len(cards)} portrait cards with {interpreter} ...", flush=True)
        run([interpreter, str(Path(__file__).resolve()), "--render-cards-job", str(job)],
            log=directory / "manim.log", timeout=1800)
        result = load_json(result_path)
    rendered, validation = {}, []
    for scene, card in cards.items():
        path = Path(result["outputs"][scene])
        transparent = original_settings["video_screens"][scene].get(
            "transparent", original_settings.get("render", {}).get("transparent", True))
        validation.append(verify_card(path, card["required_frames"], fps, transparent, ffprobe))
        for source in card["sources"]:
            rendered[Path(source)] = path
    result["cards"] = validation
    result["status"] = "rendered and verified"
    return rendered, result


def scale_rectangles(value, sx, sy):
    """Scale MLT animated rectangles; reject unfamiliar geometry explicitly."""
    result = []
    for part in value.split(";"):
        prefix, rect = part.rsplit("=", 1) if "=" in part else (None, part)
        # Current Kdenlive/MLT space-separated rect syntax, with optional alpha.
        tokens = rect.split()
        if len(tokens) not in {4, 5}:
            raise ConversionError(f"Unsupported geometry syntax: {value!r}")
        scaled = []
        for token, factor in zip(tokens[:4], (sx, sy, sx, sy)):
            if token.endswith("%"):
                scaled.append(token)
            else:
                try:
                    scaled.append(f"{float(token) * factor:.6f}")
                except ValueError as error:
                    raise ConversionError(f"Unsupported rectangle value: {token}") from error
        scaled.extend(tokens[4:])
        result.append((prefix + "=" if prefix is not None else "") + " ".join(scaled))
    return ";".join(result)


def profile_text(profile):
    keys = ("description", "frame_rate_num", "frame_rate_den", "width", "height",
            "progressive", "sample_aspect_num", "sample_aspect_den",
            "display_aspect_num", "display_aspect_den", "colorspace")
    return "\n".join(f"{k}={profile.get(k)}" for k in keys) + "\n"


def convert_xml(project, config, replacements, cameras, output, assets):
    before_timeline = project.timeline_signature()
    before_audio = project.audio_signature()
    # Resolve every file resource, including unused bin assets. Moving the XML
    # must not reinterpret any relative path against the new project directory.
    for id, path in project.media.items():
        if path is None:
            continue
        e = project.nodes[id]
        p = properties(e)
        replacement = replacements.get(path)
        resolved = replacement or path
        if p.get("mlt_service") == "timewarp":
            put(e, "warp_resource", resolved)
            put(e, "resource", f"{p['warp_speed']}:{resolved}")
        else:
            put(e, "resource", resolved)
        for name in ("kdenlive:originalurl", "kdenlive:proxy", "kdenlive:original.resource"):
            if p.get(name) and p[name] != "-":
                put(e, name, resolved if replacement else project.resolve(p[name]))
        if replacement:
            for child in list(e.findall("property")):
                name = child.get("name", "")
                if name.startswith(("meta.", "kdenlive:meta.")):
                    e.remove(child)
            put(e, "kdenlive:file_size", resolved.stat().st_size)
            # Let Kdenlive recalculate its own sampled hash and codec metadata.
            for name in ("kdenlive:file_hash", "kdenlive:proxy"):
                for child in e.findall("property"):
                    if child.get("name") == name:
                        e.remove(child)
            put(e, "meta.media.width", WIDTH)
            put(e, "meta.media.height", HEIGHT)
            put(e, "meta.media.frame_rate_num", project.fps.numerator)
            put(e, "meta.media.frame_rate_den", project.fps.denominator)
    sx, sy = WIDTH / project.old_size[0], HEIGHT / project.old_size[1]
    geometry_updates = []
    for e in project.root.iter():
        if e.tag not in {"filter", "transition"}:
            continue
        p = properties(e)
        service = p.get("mlt_service")
        for key in ({"rect"} if service == "qtblend" else {"transition.rect", "rect"} if service == "affine" else set()):
            if key in p:
                put(e, key, scale_rectangles(p[key], sx, sy))
                geometry_updates.append({"id": e.get("id"), "property": key})
    ids = {e.get("id") for e in project.root.iter() if e.get("id")}
    ordinal, handled = 0, {}
    for c, spec, size in cameras:
        animation = camera_animation(size, spec, c.duration)
        if not animation:
            continue
        identity = c.entry
        description = (animation, c.source_in, c.source_out)
        if identity in handled:
            if handled[identity] != description:
                raise ConversionError(f"Shared nested entry {c.key} has conflicting camera windows. "
                                      "Make separate sequence instances in Kdenlive or use mode=keep.")
            continue
        handled[identity] = description
        while f"vertical_filter{ordinal}" in ids:
            ordinal += 1
        f = ET.SubElement(c.entry, "filter", id=f"vertical_filter{ordinal}",
                          **{"in": str(c.source_in), "out": str(c.source_out)})
        ids.add(f.get("id"))
        ordinal += 1
        rgb = spec.get("background", "#080808").lstrip("#")
        bg = "0" if spec.get("mode", "crop") == "crop" else str(int("ff" + rgb[4:6] + rgb[2:4] + rgb[0:2], 16))
        for k, v in {"mlt_service": "qtblend", "kdenlive_id": "qtblend",
                     "kdenlive:effectName": "Transform", "kdenlive:collapsed": "0",
                     "kdenlive:sync_in_out": "1", "rect": animation, "rotation": "0",
                     "compositing": "0", "distort": "0", "rotate_center": "1",
                     "background_color": bg}.items():
            put(f, k, v)
    project.profile.attrib.update(width=str(WIDTH), height=str(HEIGHT),
                                 sample_aspect_num="1", sample_aspect_den="1",
                                 display_aspect_num="9", display_aspect_den="16",
                                 description=f"Portrait 1080x1920 {project.fps} fps")
    profile_dir = assets / "profiles"
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_file = profile_dir / f"1080x1920-{project.fps.numerator}-{project.fps.denominator}.mlt"
    profile_file.write_text(profile_text(project.profile), encoding="utf-8")
    if project.bin is not None:
        put(project.bin, "kdenlive:docproperties.profile", profile_file)
        put(project.bin, "kdenlive:docproperties.renderurl", output.with_suffix(".mp4"))
        put(project.bin, "kdenlive:docproperties.renderrescale", "0")
        put(project.bin, "kdenlive:docproperties.renderrescalewidth", WIDTH)
        put(project.bin, "kdenlive:docproperties.renderrescaleheight", HEIGHT)
        put(project.bin, "kdenlive2vertical:source", project.source)
    project.root.set("root", str(output.parent))
    if project.timeline_signature() != before_timeline:
        raise ConversionError("Internal error: timeline topology/timing changed.")
    # Reparse to recompute resolved media and audio alignment from the final XML.
    with tempfile.NamedTemporaryFile(dir=output.parent, suffix=".kdenlive", delete=False) as temp:
        temporary = Path(temp.name)
    try:
        project.tree.write(temporary, encoding="utf-8", xml_declaration=True)
        after = Project(temporary, config)
        if after.audio_signature() != before_audio:
            raise ConversionError("Internal error: audio alignment or settings changed.")
        if after.length(after.active) != project.length(project.active):
            raise ConversionError("Internal error: timeline duration changed.")
        for c in after.clips:
            path = after.media[c.producer]
            if path and not path.is_file():
                raise ConversionError(f"Converted timeline media missing: {path}")
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)
    return {"xml_references": "passed", "timeline_topology": "unchanged",
            "audio_alignment_and_settings": "unchanged", "geometry_updates": geometry_updates,
            "camera_effects_added": len(handled), "profile": str(profile_file),
            "baked_camera_movements": []}


def find_melt(config):
    configured = config.get("validation", {}).get("melt_command")
    if configured is not None:
        if not isinstance(configured, list) or not configured or not all(isinstance(s, str) for s in configured):
            raise ConversionError("validation.melt_command must be an argument list.")
        return configured
    for name in ("melt", "melt-7", "qmelt"):
        if shutil.which(name):
            return [shutil.which(name)]
    if shutil.which("flatpak"):
        check = subprocess.run(["flatpak", "info", "org.kde.kdenlive"], capture_output=True, timeout=20)
        if check.returncode == 0:
            return ["flatpak", "run", "--env=QT_QPA_PLATFORM=offscreen",
                    "--command=melt-7", "org.kde.kdenlive"]
    return None


def validate_mlt(source, output, report, assets, command, ffprobe, ffmpeg):
    if not command:
        return {"status": "not performed: MLT melt/Kdenlive not found"}
    directory = assets / "validation" / hashlib.sha256(output.read_bytes()).hexdigest()[:16]
    directory.mkdir(parents=True, exist_ok=True)
    result = {"command": command, "version": run(command + ["-version"]).strip(),
              "representative_frames": []}
    samples = []
    scenes = set()
    for c in report["clips"]:
        if "scene" in c:
            if c["scene"] in scenes:
                continue
            scenes.add(c["scene"])
            samples.append((c["key"], c["timeline_in"] + c["frames"] // 2))
        elif c["action"].startswith("editable"):
            # Start, middle, end exercise source-offset keyframes and framing.
            for fraction in (0.1, 0.5, 0.9):
                samples.append((c["key"], c["timeline_in"] + nearest(Fraction(str(fraction)) * (c["frames"] - 1))))
    for i, (key, frame) in enumerate(samples):
        image = directory / f"{i:02d}-{key.replace(':', '-')}-frame-{frame}.png"
        print(f"MLT sample {i + 1}/{len(samples)}: timeline frame {frame}", flush=True)
        run(command + [str(output), f"in={frame}", f"out={frame}", "-consumer",
                       f"avformat:{image}", "vcodec=png", "f=image2", "an=1",
                       "real_time=-1", "threads=2"], log=image.with_suffix(".log"), timeout=180)
        v = video_stream(probe(image, ffprobe))
        if not v or (v["width"], v["height"]) != (WIDTH, HEIGHT):
            raise ConversionError(f"MLT sample dimensions incorrect: {image}")
        result["representative_frames"].append({"key": key, "frame": frame, "path": str(image)})
    hashes = []
    for name, path in (("original", source), ("vertical", output)):
        audio = directory / f"{name}.wav"
        print(f"Checking full {name} audio render ...", flush=True)
        run(command + [str(path), "in=0", f"out={report['timeline_frames'] - 1}",
                       "-consumer", f"avformat:{audio}", "vn=1", "acodec=pcm_s24le",
                       "ar=48000", "ac=2", "real_time=-1", "threads=2"],
            log=audio.with_suffix(".log"), timeout=600)
        hashes.append(run([ffmpeg, "-v", "error", "-i", str(audio), "-map", "0:a:0",
                           "-f", "hash", "-hash", "sha256", "-"]).strip())
        info = probe(audio, ffprobe)
        expected = Fraction(report["timeline_frames"], 1) / Fraction(report["fps"])
        if abs(Fraction(info["format"]["duration"]) - expected) > Fraction(1, 48000):
            raise ConversionError(f"MLT timeline/audio duration mismatch: {audio}")
    if hashes[0] != hashes[1]:
        raise ConversionError("MLT audio render comparison failed: original and portrait PCM differ.")
    result.update(status="passed", audio_pcm_sha256=hashes[0],
                  audio_comparison="full original and vertical 48 kHz PCM are identical",
                  timeline_duration="verified by full audio renders")
    return result


def print_plan(report):
    print(f"Source: {report['source']}\nSequence: {report['active_sequence']}\n"
          f"{report['source_dimensions']} -> {report['output_dimensions']}, {report['fps']} fps\n"
          f"Timeline: {report['timeline_frames']} frames ({report['timeline_seconds']:.3f} s)")
    for c in report["clips"]:
        print(f"  {c['key']:17} track {c['track']:2} timeline {c['timeline_in']:4}..{c['timeline_out']:4} "
              f"source {c['source_in']:5}..{c['source_out']:5}  {c['action']}  "
              f"{Path(c['media']).name if c['media'] else '(generator)'}")
    print(f"Cards: {', '.join(report['cards']) or 'none'}\n"
          f"Unused bin producers retained: {len(report['unused_bin_producers'])}")
    for missing in report["missing_media"]:
        print(f"MISSING {'TIMELINE' if missing['active'] else 'UNUSED BIN'}: "
              f"{missing['producer']} {missing['path']}")
    for effect in report["unsupported_effects"]:
        print(f"UNSUPPORTED EFFECT: {effect}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--output", type=Path, help="Default: SOURCE-vertical.kdenlive alongside source")
    parser.add_argument("--assets-dir", type=Path, help="Default: vertical-assets alongside output")
    parser.add_argument("--config", type=Path)
    parser.add_argument("--dry-run", action="store_true", help="Inspect and report; never create or modify files")
    parser.add_argument("--write-config", type=Path, help="Write an editable configuration for this project and exit")
    parser.add_argument("--force", action="store_true", help="Replace only an existing converter-produced output project")
    parser.add_argument("--skip-mlt-validation", action="store_true")
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    args = parser.parse_args(argv)
    try:
        config = read_config(args.config)
        project = Project(args.project, config)
        output = (args.output or project.source.with_name(project.source.stem + "-vertical.kdenlive")).expanduser().resolve()
        assets = (args.assets_dir or output.parent / "vertical-assets").expanduser().resolve()
        protected = {project.source} | {p for p in project.media.values() if p}
        if output in protected:
            raise ConversionError("Output would overwrite the original project or source media.")
        if args.dry_run and args.write_config:
            raise ConversionError("--dry-run and --write-config are mutually exclusive.")
        report, cards, cameras, info = build_plan(project, config, args.ffprobe)
        report.update(output=str(output), assets_dir=str(assets), converter_version=VERSION)
        print_plan(report)
        if args.write_config:
            destination = args.write_config.expanduser().resolve()
            if destination.exists() or destination in protected:
                raise ConversionError(f"Refusing to overwrite configuration: {destination}")
            template = {"version": VERSION, "manim": report["manim"], "defaults": {"mode": "fit"},
                        "clips": {c.key: {"mode": "fit", "background": "#080808",
                                           "start": {"x": 0.5, "y": 0.5, "zoom": 1},
                                           "end": {"x": 0.5, "y": 0.5, "zoom": 1}}
                                  for c, _, _ in cameras}}
            destination.write_text(json.dumps(template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"Configuration written: {destination}")
            return 0
        blockers = [f"Missing active media: {v['path']}" for v in report["missing_media"] if v["active"]]
        blockers += [f"Unsupported effect: {v}" for v in report["unsupported_effects"]]
        if cards:
            interpreter = report["manim"].get("python", sys.executable)
            try:
                # Dependency inspection writes no bytecode or Manim media.
                run([interpreter, "-B", "-c", "import importlib.util,sys; "
                     "sys.exit(0 if all(importlib.util.find_spec(n) for n in ('manim','jsonschema')) else 1)"])
            except ConversionError:
                blockers.append(f"Manim and jsonschema are required in {interpreter}. "
                                 "Install scripts/requirements-teasers.txt there, or set manim.python.")
        if args.dry_run:
            for blocker in blockers:
                print(f"BLOCKED: {blocker}")
            print("Dry run complete. No files were written or rendered.")
            return 2 if blockers else 0
        if blockers:
            raise ConversionError("\n".join(blockers))
        if output.exists():
            existing = ET.parse(output).getroot()
            provenance = [p.text for p in existing.iter("property") if p.get("name") == "kdenlive2vertical:source"]
            if not args.force or provenance != [str(project.source)]:
                raise ConversionError(f"Output exists: {output}. --force is allowed only for an output "
                                      "previously generated from this same source.")
        if assets in protected or assets.is_file():
            raise ConversionError(f"Assets directory conflicts with an input file: {assets}")
        output.parent.mkdir(parents=True, exist_ok=True)
        assets.mkdir(parents=True, exist_ok=True)
        replacements, card_validation = render_cards(cards, report["manim"], project.fps, assets, args.ffprobe)
        report["card_validation"] = card_validation
        report["xml_validation"] = convert_xml(project, config, replacements, cameras, output, assets)
        report_path = output.with_suffix(".vertical-report.json")
        try:
            report["mlt_validation"] = ({"status": "skipped by --skip-mlt-validation"}
                if args.skip_mlt_validation else validate_mlt(project.source, output, report, assets,
                    find_melt(config), args.ffprobe, args.ffmpeg))
        except ConversionError as error:
            report["mlt_validation"] = {"status": "failed", "error": str(error)}
            raise
        finally:
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Project: {output}\nReport: {report_path}\n"
              f"MLT validation: {report['mlt_validation']['status']}\n"
              "Camera movement remains editable; no movements are baked into replacement video.")
        return 0
    except (OSError, ValueError, ET.ParseError, KeyError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--render-cards-job":
        try:
            render_cards_job(Path(sys.argv[2]))
        except Exception as error:
            print(f"Card render failed: {error}", file=sys.stderr)
            raise
    else:
        raise SystemExit(main())
