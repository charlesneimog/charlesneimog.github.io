# Published sitemap

`github-sites.py` discovers the authenticated account's GitHub Pages with
`gh api --paginate --slurp`, checks `has_pages`, and reads each Pages endpoint's
actual URL. It includes only pages and PDFs on `charlesneimog.github.io` in the
main sitemap. Authentication, Pages permissions and rate-limit errors are
reported rather than interpreted as a missing site.

From the repository root:

```sh
node scripts/build-content.cjs
node scripts/build-content.cjs --check
node scripts/test_content.cjs
python3 scripts/github-sites.py --dry-run
python3 scripts/github-sites.py
python3 scripts/github-sites.py --offline --dry-run --report .cache/github-sites/offline-report.json
python3 -m unittest discover -s scripts -p 'test_github_sites.py' -v
```

## Raster images to AVIF

Run `python3 scripts/imgs2avif.py` from any directory to migrate raster images
in this repository. For every PNG, JPEG, WebP, GIF, BMP, or TIFF file, the
script writes the AVIF first, replaces complete occurrences of the original
filename in UTF-8 text files throughout the repository, and deletes the source
image only after all conversions and reference updates succeed. `.git`,
symbolic links, SVG files, and `favicon.ico` are left untouched. The script also
retains its existing audio-to-MP3 conversion pass.

Run its focused tests with
`python3 -m unittest discover -s scripts -p 'test_imgs2avif.py' -v`.

`github-sites.py` prints progress immediately to stderr: GitHub discovery, each crawled URL,
HTTP requests/status/timing, cache hits, retries and writes. The final JSON
summary stays on stdout. Use `--quiet` to hide progress while retaining warnings
and errors. A crawl limit prints the option to increase and records excluded URL
counts in `counts.crawl_limits`; for a larger inventory, use for example
`python3 scripts/github-sites.py --dry-run --max-pages 10000`.

Paths (`--output`, `--report`, `--cache-dir`, `--build-dir`) are relative to the
repository root, including when invoking the script by absolute path from
another directory. The default outputs are `sitemap.xml` and
`.cache/github-sites/report.json`. `--dry-run` validates XML in memory and writes
only the report/cache. Offline simulation deliberately exits with status 2,
because it cannot verify other projects or public HTTP directives.

The current Pages configuration publishes the root of `main` with the legacy
GitHub Pages build. There is no custom build workflow in this repository. The
script starts with the homepage, linked public pages, renderer routes and the
existing sitemap. It does **not** turn every source HTML/Markdown/JSON file into
a public page. Existing HTML files in the published root are inventoried, with
source/test folders, templates and protected content excluded. If you have a generated publication directory, pass
`--build-dir _site`; generated HTML becomes an additional route inventory.
The existing Tailwind/encryption workflows are unchanged.

These adapters are based on the actual JavaScript loaded by the pages:

| Source | Renderer | Public association |
| --- | --- | --- |
| `json/music.json` | `js/sections.js`, `createMusicPage` | `/?music=<slug>`; artwork, displayed images and embedded player |
| `json/articles.json` | `js/sections.js`, `createResearchPage` | `/?research=<slug>`; images, `link` and `paper` |
| `json/blog.json` | `js/sections.js`, `createBlogPage` | `/?blog=<slug>`; `file` is rendered Markdown, **not** its public page URL |
| `json/software.json` | `js/sections.js`, `addSoftwares` | Homepage card images (`img`, `imgDark`) and project `link` |
| `talks/talks.json` | `js/talks.js`, `js/talk-slide.js` | `slide.html?talk=<path>` for Markdown; viewer redirects to existing `index.html` unless `.md` is explicitly requested |
| `classes/classes.json` | `js/classes.js`, `js/course.js`, `js/lesson-slide.js` | Course/lesson viewers require an unlocked session and are excluded, along with protected sources |
| `tools/tools.json` | `tools/tools.js` | `link` resolves from `/tools/`, not from the JSON file |

Music, research and blog keep the existing query URLs and dialogs. Each item
has a saved ASCII `slug`; `js/content-urls.js` is shared by the browser and the
Node metadata helper. Accents are removed from slugs, words use lowercase,
and trailing uppercase music Roman numerals are retained. Valid saved slugs
survive title edits; collision suffixes are assigned consistently and saved.
Existing blog shareable links remain valid, and saved `aliases` retain old
accented titles and legacy URL values. Slugs do not translate visible titles.

Run `node scripts/build-content.cjs` after editing these JSON files. It refreshes
saved slugs/aliases, `json/content-pages.json`, the homepage's crawlable card
links and its embedded metadata catalog. It creates **no detail HTML pages**.
`--check` detects stale generated metadata without writing files. Normal card
clicks keep the modal UI; actual anchors support discovery and opening a new tab.
Opening a dialog pushes history, old/direct URLs normalize with replaceState,
and Back/Forward restores the dialog and its metadata. Query normalization
preserves unrelated parameters and fragments; canonical URLs exclude them.

`js/content-seo.js` sets the selected item's title, description, canonical,
Open Graph, Twitter and structured data before the body renders. The initial
homepage HTML omits a hardcoded homepage canonical to avoid conflicting with
content canonical URLs. Closing a dialog restores homepage metadata. Music
uses MusicComposition with actual embedded VideoObjects, research uses
ScholarlyArticle, and blog uses BlogPosting. No fake blog paths or missing-image
URLs are emitted. The sitemap adapter keeps a separate canonical entry and
the associated media for every item; legacy aliases collapse into that entry.

GitHub Pages serves the same initial HTML for every query variant. This
implementation preserves the site's architecture and adds no prerendered
detail pages: complete dialog text and per-item metadata require JavaScript.
Non-JavaScript crawlers and social preview bots may still see generic homepage
metadata. Unique raw HTML/social previews for query URLs would require a
server that varies responses by query, or a change to static path URLs. Sitemap
entries and client-side canonical tags improve discovery but cannot guarantee
indexing or substitute for HTTP redirects. See [Google's JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

Music video data uses **`iframe.source` and `iframe.link`**, with `title` and
`description` on the music record. The current renderer presents only
`source: "youtube"` as video; `source: "bandcamp"` is audio. A standalone
YouTube `link` is not a player. `js/content-seo.js` assigns `item.image` as
the VideoObject's thumbnail, so that existing mapping supplies
`video:thumbnail_loc`. `iframe.uploadDate` is optional video publication
metadata, never a page's `lastmod`. The adapter checks its renderer contract
and reports drift. Adding a new JSON player format requires updating both its
renderer and the adapter; unsupported formats are not inferred as displayed.

YouTube, YouTube No Cookie, Vimeo and local `<video>` sources in displayed HTML
or Markdown are also recognized. The same recording can reuse metadata from
its demonstrated music JSON entry, with provenance in the report. Matching
VideoObject JSON-LD can enrich an embedded player, but cannot create a video
association by itself. oEmbed supplies actual available fields only; author
names or page titles are not invented descriptions. Decorative autoplay
footage and mere video links do not become `video:video` entries.

For videos needing metadata, the report's `missing_metadata` includes the
source file, presenting page, video URL and missing fields. Existing HTML
players can supply `title`, `data-description` and `poster` (or matching
VideoObject JSON-LD). Local `<video>` supports the same attributes and a
`src`/`<source>`. The current music JSON records already contain all required
video fields. Without external oEmbed, the current simulation identifies:

- `talks/2026-10-Knob/slide.md`: YouTube player `TEbEC4O37YQ` needs a real title,
  description and thumbnail. oEmbed may supply title/thumbnail, but its
  description must still come from actual metadata.
- `talks/2025-09-SBCM-pd4web/index.html`: local `pd4web.mp4` needs title, description
  and poster/thumbnail.

Images come from displayed HTML, picture/srcset, lazy-load attributes,
content backgrounds and the documented JSON renderer fields. Local files and
external media are checked for publication; UI icons/placeholders are excluded.
Linked audio and other files are recorded under `files` without invented sitemap
extensions. External PDFs/files outside the target host remain references in
the report rather than main sitemap URLs.

Awesome-Pd uses only its [published sitemap](https://charlesneimog.github.io/Awesome-Pd/sitemap.xml).
Its URLs, lastmod values and media are imported directly, including child
sitemaps if it publishes an index. Its pages and media are not crawled again;
old Awesome-Pd URLs absent from the published sitemap are dropped. Links and
existing sitemap entries under `/Awesome-Pd/` trigger the same import rather
than page crawling. These imported URLs do not consume `--max-pages`; the
report counts them under `pages_imported_from_sitemaps`. A failed import marks
discovery partial without falling back to crawling the project.

Other projects contribute their published sitemap/index and public HTML links;
relative media stays under each project's URL base. Public sitemaps can also
describe their JavaScript-injected media. Arbitrary external JSON applications
without published media sitemaps need their own renderer adapter: this script
does not execute every project's JavaScript or guess which JSON fields appear.

The crawler respects robots rules (including wildcards and longest matches),
HTML/X-Robots noindex, access protection, HTTP redirects and HTML/HTTP canonical
links. Canonical destinations must themselves be verified and indexable.
Literal percent signs in URLs are encoded as `%25`; existing `%HH` escapes are
preserved. An unavailable robots.txt (HTTP 4xx except 429) means no robots rules,
as permitted by [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3).
Non-404 responses produce a warning. HTTP 429, server errors and network failures
still block crawling and mark discovery partial; page/media access checks apply
independently of robots.txt availability.
PDF/media checks use HEAD to avoid downloading videos or complete documents.
Existing valid `lastmod` values are retained, with valid published sitemap
values filling gaps. No execution timestamp, checkout mtime, repository-wide
push date or unrelated commit is used as a page modification date.

Controls include `--max-pages` (2000), `--max-depth` (8),
`--max-query-variants` (50 per path), `--max-sitemaps` (100),
`--max-requests` (10000), `--timeout` (15 seconds), `--gh-timeout` (60 seconds),
`--retries` (2, bounded to 5), and `--cache-ttl` (86400 seconds; 0 refreshes).
HTTP/oEmbed results and failures are cached; failures expire sooner. API/network
errors and exhausted crawl limits mark the report `partial` and return status 2.
Missing video metadata is reported and that video is omitted; it is not filled
with placeholders. `--allow-partial` explicitly permits writing a partial result.

Writes use a same-directory temporary file, fsync and atomic replacement. An
existing sitemap is backed up to `sitemap.xml.bak`. A single sitemap is used
under 50,000 URLs and 50 MiB (uncompressed); larger results use an index and
content-addressed children. Children are written before the index and prior
children are retained so existing indexes/backups remain usable. No sitemap
is submitted, committed or published by this script. Do not run the older
`createsitemap.py` afterward: that separate script only regenerates its six
static routes and uses filesystem mtimes.

References: [GitHub CLI pagination](https://cli.github.com/manual/gh_api),
[sitemap protocol](https://www.sitemaps.org/protocol.html),
[video sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/video-sitemaps),
[image sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps).

# Teaser screens

Install Manim's system dependencies ([instructions](https://docs.manim.community/en/stable/installation.html)), then:

```sh
python -m pip install -r requirements-teasers.txt
python teasers.py NIS.json --check
python teasers.py NIS.json                 # render every enabled scene
python teasers.py NIS.json --list
python teasers.py NIS.json --scene Title   # repeat --scene to select more
```

Copy `NIS.json` or `openscofo.json`, or start with this small example:

```json
{
  "$schema": "./teasers.schema.json",
  "configuration": {
    "title": "My teaser",
    "authors": ["My name"],
    "visual": {"accent": "#654ff0", "font": ""}
  },
  "render": {
    "pixel_width": 1080, "pixel_height": 1920, "frame_rate": 60,
    "format": "mov", "transparent": true
  },
  "video_screens": {
    "Intro": {"type": "title", "duration": 5},
    "Explanation": {"type": "message", "text": "A full-screen message."},
    "Caption": {"type": "subtitle", "text": "Text over footage.", "duration": 4},
    "Thanks": {"type": "credits", "title": "Thank you", "lines": ["Camera: Alex"], "columns": 1}
  },
  "scenes": ["Intro", "Explanation", "Caption", "Thanks"]
}
```

- `configuration`: shared title, subtitle, authors, visual style, performances, research and technology. All are optional.
- `render`: exact pixel dimensions, frame rate, logical frame dimensions, format, transparency and output directory. Omitted settings use schema defaults; `frame_width` is calculated from the aspect ratio if omitted. If supplied, both aspect ratios must match.
- `video_screens`: named screen definitions. Types: `title`, `message` (centered text), `subtitle` (bottom text), `warning`, `performance`, `credits`, `overlay`, `end_card`, `logos`.
- `scenes`: names to render, in order. Omit a name or set its screen's `enabled` to `false` to skip it. Each produces a separate clip at `media/<JSON filename>/videos/<scene>.<format>`, relative to the JSON. Change `render.output_dir` to choose another directory.

Required fields and defaults live in **`teasers.schema.json`**. Root `required` lists required sections; `$defs.screen.required` lists common requirements; `$defs.message.required`, `$defs.warning.required`, etc. list requirements for each type. Add a field name to a `required` array to require it; remove it to make it optional. Core `video_screens`, `scenes` and screen `type` identify what to render. Unrecognized fields are rejected to catch typos.

`message`/`subtitle` require `text`; `warning` requires `title` and `text`; `performance` requires a `performance` key referring to `configuration.performances`. Each performance requires `ensemble`; conductor, location, date and musicians are optional. `credits` can reference the same performance or use custom `lines`.

A `credits` screen accepts a `title` and an optional `subtitle`, displayed directly below the title and above the credit names. Set `title_font_size` (default: 35) and `subtitle_font_size` (default: 24) independently. Omit `subtitle` or set it to an empty string to hide it.

A `title` screen can include `"image": "assets/logo.svg"` (or a PNG/JPEG). Paths are absolute or relative to the JSON. Set `image_height` in Manim units (default: 3); the image keeps its proportions and fits above the subtitle/authors. `show_title: false` hides the separate title text when the logo includes the name. Optional `image_color: "#FFFFFF"` makes the image white while preserving transparency; omit it to keep its colors. SVG images require `rsvg-convert` from librsvg and use installed fonts for embedded SVG text.

Images are antialiased at their final display size after layout, preserving thin strokes and transparent edges when large logos shrink. Output resolution comes from `render.pixel_width` and `render.pixel_height`; increasing those cannot restore details missing from a small source PNG. Prefer SVG originals for logos when available.

Transparent clips store smooth image edges partly in the alpha channel. Players that ignore alpha can show jagged white edges; assess these clips composited over footage in your editor. For ordinary playback, use `transparent: false` globally or on the screen. Transparent MOV uses lossless RGB encoding; WebM uses lossy compression.

Add a `logos` list to a `credits` or `end_card` screen to show a small, centered row below its text. Positions and sizes adjust automatically to fit every logo on one line. `openscofo.json` uses this layout on `end_card`:

```json
"end_card": {
  "type": "credits",
  "title": "OpenScofo",
  "subtitle": "Open Source Score Follower",
  "title_font_size": 76,
  "subtitle_font_size": 29,
  "lines": ["Charles K. Neimog", "Cássia Carrascoza"],
  "show_musicians": false,
  "columns": 1,
  "image_height": 0.9,
  "gap": 0.35,
  "corner_radius": 0.05,
  "logos": [
    {"image": "assets/eca.png"},
    {"image": "assets/capes.png"},
    {"image": "assets/usp.png"}
  ],
  "special_thanks": []
}
```

On these cards, `image_height` defaults to 1 Manim unit and `gap` to 0.35. Fill `special_thanks` with names or acknowledgment lines to show them between the credits and logos; `special_thanks_title` defaults to `Special thanks`. Empty lists hide their sections. The logos keep their proportions, colors and rounded corners as they shrink to fit.

For a separate logo screen, add a `logos` screen and put its name last in `scenes`:

```json
"logos": {
  "type": "logos",
  "duration": 6,
  "graphics": false,
  "overlay_enabled": false,
  "corner_radius": 0.12,
  "logos": [
    {"image": "assets/eca.png"},
    {"image": "assets/capes.png"},
    {"image": "assets/usp.png"}
  ],
  "special_thanks_title": "Special thanks",
  "special_thanks": ["Name or institution", "Another acknowledgment"]
}
```

Add or remove entries in `logos`; rows, positions and sizes adjust automatically to the number of images, their proportions and the available frame space. A separate `logos` screen must contain at least one logo. Image paths and optional per-logo `image_color` work like title images. `image_height` caps each logo's height (default: 2.5 Manim units); `gap` sets the preferred spacing (default: 0.65), reduced when needed. Original colors and proportions are preserved. On this screen type, `special_thanks` displays centered lines below the logos; leave it empty to hide the section until you have names to add. `font_size` and `title_font_size` control that text.

Set `corner_radius` for rounded logo corners (for example, `0.05` with small logos or `0.12` with larger ones). It uses Manim units at `image_height` and scales with the logos. The default `0` keeps square corners. Rounding preserves each image's existing transparency.

All screens accept `duration` (seconds), `graphics`, `transparent`, `border_size`, `overlay_enabled`, `overlay_opacity` (0–1) and `overlay_padding` (Manim units). A screen's `transparent` (`true` or `false`) overrides `render.transparent`; omitting it inherits the global setting. With `false`, the screen uses `configuration.visual.background`. Transparent screens require `mov` or `webm`. Text is scaled down when necessary to fit the safe margins. Visual colors use `#RRGGBB`; an empty font selects the system default. `title_weight` and `normal_weight` accept `NORMAL` or `BOLD`.

Messages/subtitles wrap at `max_chars_per_line` and paginate at `max_chars_per_scene`; `\n` makes a line break and `\n\n` separates paragraphs. With `duration`, pages share that total time equally; otherwise each page lasts at least `min_page_duration`, extended according to `chars_per_second`. Video timing is rounded to frames. Set `format` to `mov` or `webm` with `transparent: true` for overlays on footage. This exports graphics clips for your editor.
