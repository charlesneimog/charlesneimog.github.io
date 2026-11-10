"""Render the screens selected by a teaser JSON: python teasers.py NIS.json."""

import argparse
from copy import deepcopy
from io import BytesIO
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import textwrap


SCHEMA_PATH = Path(__file__).with_name("teasers.schema.json")


def read_json(path):
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError(f"Duplicate JSON key: {key!r}")
            result[key] = value
        return result

    def invalid_number(value):
        raise ValueError(f"Invalid JSON number: {value}")

    with Path(path).open(encoding="utf-8") as source:
        return json.load(source, object_pairs_hook=unique_keys, parse_constant=invalid_number)


def apply_defaults(value, rule, schema, validator):
    """Use defaults from the schema, including the selected screen type."""
    if "$ref" in rule:
        target = schema
        for key in rule["$ref"].removeprefix("#/").split("/"):
            target = target[key]
        apply_defaults(value, target, schema, validator)
    if isinstance(value, dict):
        properties = rule.get("properties", {})
        for key, child in properties.items():
            if key not in value and "default" in child:
                value[key] = deepcopy(child["default"])
            if key in value:
                apply_defaults(value[key], child, schema, validator)
        extra = rule.get("additionalProperties")
        if isinstance(extra, dict):
            for key in value.keys() - properties.keys():
                apply_defaults(value[key], extra, schema, validator)
    if isinstance(value, list) and "items" in rule:
        for item in value:
            apply_defaults(item, rule["items"], schema, validator)
    for child in rule.get("allOf", []):
        apply_defaults(value, child, schema, validator)
    if "if" in rule:
        branch = "then" if validator.evolve(schema=rule["if"]).is_valid(value) else "else"
        apply_defaults(value, rule.get(branch, {}), schema, validator)


def load_settings(path):
    try:
        from jsonschema import Draft202012Validator
    except ImportError as error:
        raise ValueError("Install dependencies: python -m pip install -r requirements-teasers.txt") from error

    schema = read_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    settings = read_json(path)
    validator = Draft202012Validator(schema)
    errors = list(validator.iter_errors(settings))
    if errors:
        messages = []
        for error in errors[:10]:
            location = ".".join(map(str, error.absolute_path)) or "JSON"
            messages.append(f"{location}: {error.message}")
        raise ValueError("\n".join(messages))
    # Validate first: a required field must be supplied even if it has a default.
    apply_defaults(settings, schema, schema, validator)
    render = settings["render"]
    render.setdefault("frame_width", render["frame_height"] * render["pixel_width"] / render["pixel_height"])
    if not math.isclose(render["frame_width"] / render["frame_height"],
                        render["pixel_width"] / render["pixel_height"], rel_tol=1e-6):
        raise ValueError("render: frame_width/frame_height must match pixel_width/pixel_height to avoid stretched text.")
    visual = settings["configuration"]["visual"]
    if 2 * visual["margin_x"] >= render["frame_width"] or 2 * visual["margin_y"] >= render["frame_height"]:
        raise ValueError("configuration.visual: margins must leave space inside the frame.")
    screens = settings["video_screens"]
    for name in settings["scenes"]:
        if name not in screens:
            raise ValueError(f"scenes: unknown video screen {name!r}.")
    for name, screen in screens.items():
        screen.setdefault("transparent", render["transparent"])
        if screen["transparent"] and render["format"] == "mp4":
            raise ValueError(f'video_screens.{name}: transparent output requires format "mov" or "webm".')
        images = [(screen, f"video_screens.{name}.image")] if "image" in screen else []
        images.extend((logo, f"video_screens.{name}.logos.{index}.image")
                      for index, logo in enumerate(screen.get("logos", [])))
        for owner, location in images:
            image = Path(owner["image"]).expanduser()
            if not image.is_absolute():
                image = Path(path).resolve().parent / image
            if not image.is_file():
                raise ValueError(f"{location}: file not found: {image}")
            owner["image"] = str(image.resolve())
        performance = screen.get("performance")
        if performance is not None and performance not in settings["configuration"]["performances"]:
            raise ValueError(f"video_screens.{name}.performance: unknown performance {performance!r}.")
        padding = screen["overlay_padding"] if screen["overlay_enabled"] else 0
        if 2 * (visual["margin_x"] + padding) >= render["frame_width"] or 2 * (visual["margin_y"] + padding) >= render["frame_height"]:
            raise ValueError(f"video_screens.{name}: overlay padding leaves no space for text.")
    return settings


def selected_screens(settings, names=None):
    requested = set(names) if names is not None else None
    if requested is not None:
        unknown = requested - set(settings["scenes"])
        if unknown:
            raise ValueError(f"Unknown scene(s): {', '.join(sorted(unknown))}")
    return [(name, settings["video_screens"][name]) for name in settings["scenes"]
            if (requested is None or name in requested) and settings["video_screens"][name]["enabled"]]


def text_pages(content, max_chars):
    """Split at paragraphs, sentences or words, preserving explicit newlines."""
    if isinstance(max_chars, bool) or not isinstance(max_chars, int) or max_chars < 1:
        raise ValueError("max_chars_per_scene must be a positive integer.")
    remaining = content.strip()
    pages = []
    while len(remaining) > max_chars:
        window = remaining[:max_chars + 1]
        breaks = [match.start() for match in re.finditer(r"\n\s*\n|(?<=[.!?])\s", window)]
        useful = [position for position in breaks if position >= max_chars // 2]
        spaces = [match.start() for match in re.finditer(r"\s", window)]
        end = (useful[-1] if useful else spaces[-1] if spaces else max_chars) or max_chars
        pages.append(remaining[:end].strip())
        remaining = remaining[end:].lstrip()
    if remaining:
        pages.append(remaining)
    return pages


def page_durations(pages, screen):
    """An explicit duration is the total screen duration, shared across pages."""
    if "duration" in screen:
        return [screen["duration"] / len(pages)] * len(pages) if pages else []
    return [max(screen["min_page_duration"], len(page) / screen["chars_per_second"]) for page in pages]


class ScreenLayout:
    """Layout mixin; Manim is imported only when an actual render is requested."""

    def text(self, content, size, *, muted=False, bold=False):
        m = self.m
        # Shape large vector glyphs to prevent Pango's small-size spacing gaps.
        render_size = max(120, size)
        # Pango uses pixel_width as its wrapping canvas. Keep shaping independent
        # of output resolution; only text_block() should introduce wrapped lines.
        lines = content.splitlines() or [""]
        with m.tempconfig({"pixel_width": max(4096, int(max(map(len, lines)) * render_size * 2 + 100)),
                           "pixel_height": max(4096, int(len(lines) * render_size * 3 + 100))}):
            text = m.Text(content, font=self.visual["font"], font_size=render_size,
                          color=self.visual["muted" if muted else "foreground"],
                          weight=self.visual["title_weight" if bold else "normal_weight"])
        return text.scale(size / render_size)

    def stack(self, items, buff=0.2, left=False):
        group = self.m.VGroup(*items)
        if len(group):
            group.arrange(self.m.DOWN, buff=buff, **({"aligned_edge": self.m.LEFT} if left else {}))
        return group

    def fit(self, group, *, padding=0, max_width=None, max_height=None):
        width = self.m.config.frame_width - 2 * (self.visual["margin_x"] + padding)
        height = self.m.config.frame_height - 2 * (self.visual["margin_y"] + padding)
        if max_width is not None:
            width = min(width, max_width)
        if max_height is not None:
            height = min(height, max_height)
        if width <= 0 or height <= 0:
            raise ValueError("Text margins, heading or padding leave no usable space.")
        return group.scale(min(1, width / group.width if group.width else 1,
                               height / group.height if group.height else 1))

    def panel(self, group, *, max_width=None, max_height=None):
        padding = self.screen["overlay_padding"] if self.screen["overlay_enabled"] else 0
        self.fit(group, padding=padding, max_width=max_width, max_height=max_height)
        if not len(group) or not self.screen["overlay_enabled"]:
            return group
        backdrop = self.m.SurroundingRectangle(
            group, buff=padding, corner_radius=0.12, stroke_width=0,
            fill_color=self.visual["overlay_color"], fill_opacity=self.screen["overlay_opacity"])
        return self.m.Group(backdrop, group)

    def graphics(self):
        m = self.m
        accent = self.visual["accent"]
        top = m.Rectangle(width=m.config.frame_width - 0.6, height=self.screen["border_size"],
                          stroke_width=0, fill_color=accent, fill_opacity=1).to_edge(m.UP, buff=0.2)
        left = m.Rectangle(width=min(1.45, m.config.frame_width - 0.6), height=0.18,
                           stroke_width=0, fill_color=accent, fill_opacity=1)
        left.to_corner(m.UL, buff=0.2).shift(m.DOWN * 0.14).align_to(top, m.LEFT)
        right = m.Rectangle(width=min(2.7, m.config.frame_width), height=0.42,
                            stroke_width=0, fill_color=accent, fill_opacity=1).to_corner(m.DR, buff=0)
        return m.VGroup(top, left, right)

    def image(self, path, height, color=None, *, corner_radius=0):
        """Load raster images or the complete SVG, including its text elements."""
        import numpy as np
        from PIL import Image, ImageChops, ImageDraw

        path = Path(path)
        if path.suffix.lower() == ".svg":
            converter = shutil.which("rsvg-convert")
            if converter is None:
                raise ValueError("SVG images require rsvg-convert (librsvg). Install it or use a PNG image.")
            # Render above display resolution so logos stay sharp after fitting.
            display_height = min(height, self.m.config.frame_height)
            pixel_height = math.ceil(2 * display_height * self.m.config.pixel_height / self.m.config.frame_height)
            result = subprocess.run(
                [converter, "--keep-aspect-ratio", "--height", str(pixel_height), str(path)],
                capture_output=True,
            )
            if result.returncode:
                raise ValueError(f"Cannot render SVG {path}: {result.stderr.decode(errors='replace').strip()}")
            source = BytesIO(result.stdout)
        else:
            source = path
        with Image.open(source) as image:
            rgba = image.convert("RGBA")
        if corner_radius:
            width_px, height_px = rgba.size
            radius_px = min(corner_radius * height_px / height, width_px / 2, height_px / 2)
            mask = Image.new("L", (width_px * 2, height_px * 2))
            ImageDraw.Draw(mask).rounded_rectangle(
                (0, 0, width_px * 2 - 1, height_px * 2 - 1), radius=radius_px * 2, fill=255)
            mask = mask.resize(rgba.size, Image.Resampling.LANCZOS)
            rgba.putalpha(ImageChops.multiply(rgba.getchannel("A"), mask))
        mobject = self.m.ImageMobject(np.array(rgba))
        if color is not None:
            mobject.set_color(color)
        return mobject.scale_to_fit_height(height)

    def title_image(self):
        return self.image(self.screen["image"], self.screen["image_height"], self.screen.get("image_color"))

    def resample_images(self):
        """Antialias images once, at their final display size, before rendering."""
        import numpy as np
        from PIL import Image

        for image in self.get_mobject_family_members():
            if not isinstance(image, self.m.ImageMobject):
                continue
            size = (max(1, round(image.width * self.camera.pixel_width / self.camera.frame_width)),
                    max(1, round(image.height * self.camera.pixel_height / self.camera.frame_height)))
            source = Image.fromarray(image.pixel_array)
            if source.width <= size[0] and source.height <= size[1]:
                continue
            # Manim's perspective transform interpolates without an antialiasing
            # prefilter. Resize first with Lanczos, including premultiplied alpha,
            # so thin strokes survive large reductions without jagged edges.
            image.pixel_array = np.array(source.resize(size, Image.Resampling.LANCZOS))
            image.orig_alpha_pixel_array = image.pixel_array[:, :, 3].copy()

    def title(self):
        s, c = self.screen, self.configuration
        items = []
        title = s.get("title", c["title"])
        subtitle = s.get("subtitle", c["subtitle"])
        if "image" in s:
            items.append(self.title_image())
        if s["show_title"] and title:
            items.append(self.text(title, s["font_size"], bold=True))
        if s["show_subtitle"] and subtitle:
            items.append(self.text(subtitle, s["subtitle_font_size"], muted=True))
        center = self.m.Group(*items)
        if items:
            center.arrange(self.m.DOWN, buff=0.2)
        if s["show_authors"] and c["authors"]:
            authors = self.text("  ·  ".join(c["authors"]), s["authors_font_size"], muted=True)
            authors.next_to(center, self.m.DOWN, buff=0.65)
            center.add(authors)
        self.add(self.panel(center).move_to(self.m.ORIGIN))

    def warning(self):
        s = self.screen
        icon = self.text("◉", 38)
        icon.set_color(self.visual["accent"])
        items = [icon]
        if s.get("title"):
            items.append(self.text(s["title"], s["font_size"], bold=True))
        if s.get("text"):
            items.append(self.text(s["text"], s["text_font_size"], muted=True))
        self.add(self.panel(self.stack(items, buff=0.24)).move_to(self.m.ORIGIN))

    def performance(self):
        s = self.screen
        performance = self.configuration["performances"].get(s.get("performance"), {})
        items = []
        if performance.get("ensemble"):
            items.append(self.text(performance["ensemble"], s["font_size"], bold=True))
        details = []
        if performance.get("conductor"):
            details.append(f"Direction: {performance['conductor']}")
        details.extend(performance[key] for key in ("location", "date") if performance.get(key))
        if details:
            items.append(self.text("  ·  ".join(details), s["detail_font_size"], muted=True))
        info = self.stack(items, buff=0.1, left=True)
        if not len(info):
            return
        line = self.m.Rectangle(width=0.055, height=info.height, stroke_width=0,
                                fill_color=self.visual["accent"], fill_opacity=1)
        line.next_to(info, self.m.LEFT, buff=0.2)
        panel = self.panel(self.m.VGroup(line, info))
        panel.to_edge(self.m.LEFT, buff=self.visual["margin_x"])
        panel.to_edge(self.m.DOWN, buff=max(self.visual["margin_y"], 0.67 if s["graphics"] else 0))
        self.add(panel)

    def credits(self):
        s, c = self.screen, self.configuration
        performance = c["performances"].get(s.get("performance"), {})
        title = s.get("title", performance.get("ensemble", c["title"]))
        header = []
        if title:
            header.append(self.text(title, s["title_font_size"], bold=True))
        if s["subtitle"]:
            header.append(self.text(s["subtitle"], s["subtitle_font_size"], muted=True))
        if performance.get("conductor"):
            header.append(self.text(f"Direction: {performance['conductor']}", 19, muted=True))
        if s["show_authors"] and c["authors"]:
            header.append(self.text("  ·  ".join(c["authors"]), 22, muted=True))
        for item in header:
            self.fit(item)
        group = self.stack(header, buff=0.12)
        names = list(s["lines"])
        if s["show_musicians"]:
            names.extend(performance.get("musicians", []))
        if names:
            count = min(s["columns"], len(names))
            columns = [self.stack([self.text(name, s["font_size"]) for name in names[i::count]],
                                  buff=0.12, left=True) for i in range(count)]
            names_group = self.m.VGroup(*columns).arrange(self.m.RIGHT, aligned_edge=self.m.UP, buff=0.75)
            self.fit(names_group, max_width=14, max_height=5.3)
            if len(group):
                names_group.next_to(group, self.m.DOWN, buff=0.55)
            group.add(names_group)
        panel = self.panel(self.logo_footer(group, s["font_size"]))
        panel.to_edge(self.m.UP, buff=self.visual["margin_y"])
        self.add(panel)

    def logo_footer(self, content, font_size):
        """Append acknowledgments and a small logo row beneath card text."""
        s, m = self.screen, self.m
        if not s["logos"] and not s["special_thanks"]:
            return content
        items = [content] if len(content) else []
        if s["special_thanks"]:
            thanks = []
            if s["special_thanks_title"]:
                thanks.append(self.text(s["special_thanks_title"], font_size, bold=True))
            thanks.extend(self.text(line, font_size) for line in s["special_thanks"])
            block = self.stack(thanks, buff=0.15)
            self.fit(block)
            items.append(block)
        if s["logos"]:
            images = [self.image(logo["image"], s["image_height"], logo.get("image_color"),
                                 corner_radius=s["corner_radius"])
                      for logo in s["logos"]]
            row = m.Group(*images).arrange(m.RIGHT, buff=s["gap"])
            padding = s["overlay_padding"] if s["overlay_enabled"] else 0
            self.fit(row, padding=padding, max_height=s["image_height"])
            items.append(row)
        return m.Group(*items).arrange(m.DOWN, buff=0.5)

    def overlay(self):
        s, c, m = self.screen, self.configuration, self.m
        items = []
        if s["show_title"] and c["title"]:
            items.append(self.text(c["title"], s["font_size"], bold=True))
        if s["show_subtitle"] and c["subtitle"]:
            items.append(self.text(c["subtitle"], s["subtitle_font_size"], muted=True))
        if items:
            panel = self.panel(self.stack(items, buff=0.05, left=True))
            panel.to_edge(m.LEFT, buff=self.visual["margin_x"])
            panel.to_edge(m.UP, buff=self.visual["margin_y"])
            self.add(panel)
        if s["label"]:
            label = self.panel(self.m.VGroup(self.text(s["label"], s["label_font_size"], bold=True)))
            label.to_edge(m.LEFT, buff=self.visual["margin_x"])
            label.to_edge(m.DOWN, buff=self.visual["margin_y"])
            self.add(label)

    def logo_grid(self, images, width, height):
        """Choose rows that give the logos the largest common height, in order."""
        count = len(images)
        best = None
        for columns in range(1, count + 1):
            rows = math.ceil(count / columns)
            # Reduce excessive spacing so even large collections still fit.
            gap = min(self.screen["gap"], width / (2 * columns), height / (2 * rows))
            logo_height = min(self.screen["image_height"], (height - (rows - 1) * gap) / rows)
            for start in range(0, count, columns):
                row = images[start:start + columns]
                ratio_sum = sum(image.width / image.height for image in row)
                logo_height = min(logo_height, (width - (len(row) - 1) * gap) / ratio_sum)
            candidate = (logo_height, -rows, columns, gap)
            if best is None or candidate > best:
                best = candidate
        logo_height, _, columns, gap = best
        for image in images:
            image.scale_to_fit_height(logo_height)
        rows = [self.m.Group(*images[start:start + columns]).arrange(self.m.RIGHT, buff=gap)
                for start in range(0, count, columns)]
        return self.m.Group(*rows).arrange(self.m.DOWN, buff=gap)

    def logos(self):
        s, m = self.screen, self.m
        padding = s["overlay_padding"] if s["overlay_enabled"] else 0
        width = m.config.frame_width - 2 * (self.visual["margin_x"] + padding)
        height = m.config.frame_height - 2 * (self.visual["margin_y"] + padding)
        thanks = None
        if s["special_thanks"]:
            items = []
            if s["special_thanks_title"]:
                items.append(self.text(s["special_thanks_title"], s["title_font_size"], bold=True))
            items.extend(self.text(line, s["font_size"]) for line in s["special_thanks"])
            thanks = self.stack(items, buff=0.18)
            self.fit(thanks, padding=padding, max_height=height / 3)
        section_gap = min(0.65, height / 10) if thanks is not None else 0
        logo_height = height - (thanks.height + section_gap if thanks is not None else 0)
        images = [self.image(logo["image"], s["image_height"], logo.get("image_color"),
                             corner_radius=s.get("corner_radius", 0))
                  for logo in s["logos"]]
        grid = self.logo_grid(images, width, logo_height)
        content = m.Group(grid, thanks) if thanks is not None else m.Group(grid)
        content.arrange(m.DOWN, buff=section_gap)
        self.add(self.panel(content).move_to(m.ORIGIN))

    def end_card(self):
        s, c = self.screen, self.configuration
        items = []
        title = s.get("title", c["title"])
        if title:
            items.append(self.text(title, s["font_size"], bold=True))
        if s["show_authors"] and c["authors"]:
            items.append(self.text("  ·  ".join(c["authors"]), s["authors_font_size"], muted=True))
        content = self.stack(items)
        self.fit(content)
        extra = []
        technology, research = c["technology"], c["research"]
        if s["show_technology"] and technology["enabled"] and technology["items"]:
            extra.append(self.text(f"{technology['label']}: " + " · ".join(technology["items"]), 17, muted=True))
        if s["show_research"] and research["enabled"] and research["institution"]:
            extra.append(self.text(f"{research['label']} — {research['institution']}", 16, muted=True))
        if extra:
            details = self.stack(extra, buff=0.12)
            self.fit(details)
            details.next_to(content, self.m.DOWN, buff=0.75)
            content.add(details)
        self.add(self.panel(self.logo_footer(content, s["authors_font_size"])).move_to(self.m.ORIGIN))

    def text_block(self, page, *, left=False):
        paragraphs = []
        for paragraph in page.split("\n\n"):
            lines = []
            for line in paragraph.splitlines():
                lines.extend(textwrap.wrap(line, width=self.screen["max_chars_per_line"],
                                           break_long_words=True, break_on_hyphens=False))
            if lines:
                paragraphs.append(self.stack([self.text(line, self.screen["font_size"]) for line in lines],
                                             buff=0.14, left=left))
        return self.stack(paragraphs, buff=0.35, left=left)

    def paginated_text(self, *, subtitle=False):
        s, m = self.screen, self.m
        pages = text_pages(s.get("text", ""), s["max_chars_per_scene"])
        heading = None
        padding = s["overlay_padding"] if s["overlay_enabled"] else 0
        if not subtitle and s["title"]:
            heading = self.panel(m.VGroup(self.text(s["title"], s["title_font_size"], bold=True)))
            heading.to_edge(m.UP, buff=self.visual["margin_y"])
            self.add(heading)
        if not pages:
            self.wait(s.get("duration", s["min_page_duration"]), frozen_frame=True)
        for page, duration in zip(pages, page_durations(pages, s)):
            block = self.text_block(page, left=subtitle)
            available_height = m.config.frame_height - 2 * self.visual["margin_y"]
            if heading is not None:
                available_height = min(available_height, 2 * (heading.get_bottom()[1] - 0.35))
            panel = self.panel(block, max_width=12, max_height=min(5.2, available_height - 2 * padding))
            if subtitle:
                panel.to_edge(m.LEFT, buff=self.visual["margin_x"])
                panel.to_edge(m.DOWN, buff=self.visual["margin_y"])
            else:
                panel.move_to(m.ORIGIN)
            self.add(panel)
            self.wait(duration, frozen_frame=True)
            self.remove(panel)

    def construct(self):
        self.configuration = self.project["configuration"]
        self.visual = self.configuration["visual"]
        self.camera.background_color = self.visual["background"]
        if self.screen["graphics"]:
            self.add(self.graphics())
        kind = self.screen["type"]
        if kind in ("message", "subtitle"):
            self.paginated_text(subtitle=kind == "subtitle")
        else:
            getattr(self, kind)()
            self.resample_images()
            self.wait(self.screen["duration"], frozen_frame=True)


def render_screens(settings, path, names=None):
    screens = selected_screens(settings, names)
    if not screens:
        raise ValueError("No enabled scenes selected.")
    try:
        import manim as m
    except ImportError as error:
        raise ValueError("Install dependencies: python -m pip install -r requirements-teasers.txt") from error
    render = settings["render"]
    output_dir = (Path(path).resolve().parent / render["output_dir"] / Path(path).stem).resolve()
    options = {key: render[key] for key in ("pixel_width", "pixel_height", "frame_rate", "frame_width", "frame_height", "format", "transparent")}
    options.update(renderer="cairo", media_dir=str(output_dir), video_dir="{media_dir}/videos",
                   images_dir="{media_dir}/images", text_dir="{media_dir}/texts",
                   write_to_movie=True, save_last_frame=False, preview=False,
                   disable_caching=True, progress_bar="none", verbosity="WARNING",
                   input_file=str(Path(__file__).resolve()), write_all=False)
    outputs = []
    with m.tempconfig(options):
        for name, screen in screens:
            with m.tempconfig({"output_file": name, "transparent": screen["transparent"]}):
                scene_class = type(name, (ScreenLayout, m.Scene),
                                   {"project": settings, "screen": screen, "m": m})
                scene = scene_class()
                scene.render()
                output = Path(scene.renderer.file_writer.movie_file_path)
                outputs.append(output)
                print(output)
    return outputs


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json", type=Path, help="Teaser JSON file (for example NIS.json)")
    parser.add_argument("--scene", action="append", help="Render only this scene; repeat to select more")
    parser.add_argument("--check", action="store_true", help="Validate without rendering")
    parser.add_argument("--list", action="store_true", help="List enabled scenes without rendering")
    args = parser.parse_args(argv)
    try:
        settings = load_settings(args.json)
        scenes = selected_screens(settings, args.scene)
        if args.list:
            for name, screen in scenes:
                print(f"{name}: {screen['type']}")
        elif args.check:
            print(f"{args.json}: valid ({len(scenes)} enabled scenes)")
        else:
            render_screens(settings, args.json, args.scene)
    except (OSError, ValueError) as error:
        parser.exit(2, f"Error: {error}\n")


if __name__ == "__main__":
    main()
