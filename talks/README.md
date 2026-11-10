# Talks and presentations

Each folder in `talks/` is one presentation. It can contain either:

- `index.html`: a standalone HTML presentation, including password-protected presentations.
- `slide.md`: a Markdown presentation rendered by the shared `talks/slide.html` viewer. No HTML wrapper or build step is required.

Keep images, audio, and other media beside the presentation. Relative links in Markdown and embedded HTML resolve from that presentation's folder.

JavaScript lives in `js/` and presentation styles live in `css/talks/`.
Presentation-specific assets use matching subfolders under `js/talks/` and
`css/talks/`. Executable scripts and
styles are external files; JSON-LD metadata stays in the HTML.

`encrypt.py` extracts scripts and styles after generating password-protected
pages. To extract assets from a new standalone HTML presentation manually, run
`python3 scripts/extract_page_assets.py talks/my-presentation/index.html`
from the repository root. The generator template retains the JavaScript
placeholders required by StatiCrypt; its generated pages use external scripts.

Build the presentation Tailwind stylesheet from the repository root with
`tailwindcss -i css/talks/input.css -o css/talks/output.css`.

## Add a presentation

Create `talks/my-presentation/index.html` or `talks/my-presentation/slide.md`, then add an entry to `talks/talks.json`:

```json
{
    "title": "My presentation",
    "link": "./my-presentation",
    "language": "🇧🇷",
    "date": "08/10/2026",
    "description": "A short description.",
    "encrypt": false
}
```

The talks page opens the shared viewer, which uses `index.html` when it exists and falls back to `slide.md`. If both files exist, set `link` to `./my-presentation/slide.md` to explicitly use Markdown, or to `./my-presentation/index.html` to open HTML directly.

## Write Markdown slides

Use `#` for the title slide and `##` to start each subsequent slide. Smaller headings stay on the same slide. Lists, images, links, code fences, embedded HTML, math, Mermaid diagrams, and audio are supported.

```markdown
# My presentation

Charles K. Neimog

## First slide

- A point
- Another point

## Media

![An illustration](image.png)

<audio src="example.mp3" controls></audio>
```

Create a QR code from any non-empty URL with the custom `qrcode` element. The renderer creates an accessible SVG when the slide becomes active. `title` and `alt` are optional; inline `style` can change the default 240 px width.

```html
<qrcode
  link="https://example.com/handout"
  title="Presentation handout"
  alt="QR code for the presentation handout"
  style="width: 200px">
</qrcode>
```

Add a transition to a slide's `#` or `##` heading. The transition applies to the whole slide; `###` and smaller headings stay on the slide and can animate as fragments.

```markdown
## SLIDE 2 — Presentation Map {data-transition="zoom" data-transition-speed="fast"}

Text revealed on the next click. {data-transition="fade"}

- First point {data-transition="zoom"}
- **Another point** {data-transition="fade-up" data-fragment-index="1"}

**A highlighted phrase** {class="fragment" data-transition="fade-in-then-out"}

<ul><li data-transition="zoom">An HTML bullet</li></ul>
```

Slide transitions accept Reveal's `none`, `fade`, `slide`, `convex`, `concave`, and `zoom`, including separate entry/exit values such as `slide-in fade-out`. Text, bullets, images, and embedded HTML with `data-transition` become fragments automatically. For fragments, `fade` means fade in, `zoom` means zoom in, `slide` slides in from the right, and `none` reveals instantly. Native fragment effects such as `fade-up`, `grow`, and `fade-in-then-out` also work. Existing classes and `data-fragment-index` are preserved. Transitions apply only to the annotated element.

Share Markdown presentations using `/talks/slide.html?talk=my-presentation/`. A static server cannot render a Markdown-only folder's URL directly; use the viewer URL or the talks page. Existing HTML presentations retain their direct folder URLs.

The shared viewer adds a PDF link and QR code to the title slide. Both open the current presentation in Reveal's print layout by preserving the presentation URL and adding `print-pdf`. The browser's print dialog can then save the deck as a PDF. The control is omitted from the printable output.

Preview from the repository root with `python3 -m http.server 8000`, then open `http://localhost:8000/talks/`. HTTP is required for loading Markdown.

## Protect a presentation

Set `encrypt` to `true` in `talks.json`, then run `python3 talks/encrypt.py` from the repository root. The script prompts for the password; automated runs can provide `STATICRYPT_PASSWORD` through the environment. It protects the main HTML page and any alternate HTML pages recursively in the presentation folder.

For Markdown presentations, both the HTML viewer and `slide.md` are encrypted. The Markdown file contains a StatiCrypt ciphertext envelope rather than readable slide text. Opening it through the shared viewer redirects to the protected HTML page, where the password unlocks the embedded slides.

Set `encrypt` to `false` and run the same command to restore plaintext HTML and Markdown. The script restores the original HTML from inline or extracted StatiCrypt payloads and removes obsolete encryption assets only when no pages or resources still reference them. Shared resources are retained.

`encrypt` controls encryption and the access labels shown on the talks page. It is the desired state and is never changed by the script. Unchanged files are left alone; updated Markdown is embedded when rebuilding an encrypted viewer. Missing Markdown can be recovered from an existing embedded presentation during encryption.

All presentations are prepared before any files are replaced. Incorrect passwords or malformed payloads leave the original files unchanged. Replacements use temporary files and roll back if a filesystem replacement fails. Use `--no-tailwind` to skip the shared stylesheet build.
