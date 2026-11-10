"""Apply the encryption state configured in talks.json using StatiCrypt."""

import argparse
import getpass
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import unquote, urljoin, urlsplit

SITE_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SITE_ROOT / "scripts"))
from extract_page_assets import AssetBlocks, extract_page_assets

MARKDOWN_BLOCK = re.compile(
    r'<script\b(?=[^>]*\bid=["\'](?:slides-markdown|presentation-markdown)["\'])[^>]*>'
    r'([\s\S]*?)</script>', re.IGNORECASE
)
CIPHER_FIELDS = ("staticryptEncryptedMsgUniqueVariableName", "staticryptSaltUniqueVariableName")


def validate_payload(payload):
    if not isinstance(payload, dict) or any(
        not isinstance(payload.get(field), str) or not re.fullmatch(r"(?:[0-9a-fA-F]{2})+", payload[field])
        for field in CIPHER_FIELDS
    ):
        raise RuntimeError("Malformed StatiCrypt payload: missing or invalid ciphertext/salt.")


def payload_operation(action, password, staticrypt, **kwargs):
    if action == "decrypt":
        validate_payload(kwargs.get("payload"))
    request = {"action": action, "password": password, "staticrypt": staticrypt, **kwargs}
    result = subprocess.run(
        ["node", str(SITE_ROOT / "scripts/staticrypt_payload.cjs")],
        input=json.dumps(request), capture_output=True, text=True,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "StatiCrypt payload operation failed.")
    return json.loads(result.stdout)


def find_html_payload(filename, root):
    """Find inline ciphertext or the ciphertext in an extracted local script."""
    source = filename.read_text(encoding="utf-8")
    if "/*[|js_staticrypt|]*/" in source:
        return None, None
    candidates = [filename]
    page_url = "/" + filename.relative_to(root).as_posix()
    for tag, attrs, *_ in AssetBlocks(source).blocks:
        if tag != "script" or not attrs.get("src"):
            continue
        url = urlsplit(urljoin(page_url, attrs["src"]))
        if (url.netloc in ("", "charlesneimog.github.io") and url.scheme in ("", "http", "https")
                and url.path.startswith("/js/")):
            candidates.append(root / url.path.lstrip("/"))

    for candidate in candidates:
        if not candidate.is_file():
            continue
        content = candidate.read_text(encoding="utf-8")
        payload = {}
        for field in CIPHER_FIELDS:
            match = re.search(r'["\']?' + field + r'["\']?\s*:\s*["\']([^"\'\n]*)["\']', content)
            if match:
                payload[field] = match[1]
        if payload or any(re.search(r'["\']?' + field + r'["\']?\s*:', content) for field in CIPHER_FIELDS):
            validate_payload(payload)
            return candidate, payload
    if re.search(r'\bclass=["\'][^"\']*\bstaticrypt-html\b', source):
        raise RuntimeError(f"Missing or malformed StatiCrypt payload for {filename.name}.")
    return None, None


def markdown_payload(source):
    try:
        payload = json.loads(source)
    except ValueError:
        if source.lstrip().startswith("{") and any(
            marker in source for marker in ('"staticrypt-markdown"', *CIPHER_FIELDS)
        ):
            raise RuntimeError("Malformed encrypted Markdown JSON.")
        return None
    if isinstance(payload, dict) and (
        payload.get("format") == "staticrypt-markdown" or any(field in payload for field in CIPHER_FIELDS)
    ):
        validate_payload(payload)
        if payload.get("format") != "staticrypt-markdown" or payload.get("version") != 1:
            raise RuntimeError("Malformed or unsupported encrypted Markdown format/version.")
        return payload
    return None


def read_markdown(filename, password, staticrypt):
    source = filename.read_text(encoding="utf-8")
    payload = markdown_payload(source)
    return payload_operation("decrypt", password, staticrypt, payload=payload) if payload else source


def embed_markdown(html, markdown):
    data = json.dumps(markdown, ensure_ascii=False).replace("<", "\\u003c")
    match = MARKDOWN_BLOCK.search(html)
    if match:
        if json.loads(match[1]) == markdown:
            return html
        return html[:match.start(1)] + data + html[match.end(1):]
    block = f'<script type="application/json" id="presentation-markdown">{data}</script>'
    if "</body>" not in html:
        raise RuntimeError("The presentation HTML has no closing body tag.")
    return html.replace("</body>", block + "\n</body>")


def markdown_viewer(root):
    html = (root / "talks/slide.html").read_text(encoding="utf-8")
    # The shared viewer's relative assets need root URLs in a presentation subfolder.
    return re.sub(
        r'\b(src|href)="([^"\n]+)"',
        lambda match: f'{match[1]}="{urljoin("/talks/slide.html", match[2])}"', html,
    )


def write_protected_html(filename, html, password, staticrypt, root):
    """Encrypt in a temporary folder so plaintext never becomes a public file."""
    with tempfile.TemporaryDirectory(prefix="talk-encryption-") as directory:
        source = Path(directory) / "index.html"
        output = Path(directory) / "encrypted"
        source.write_text(html, encoding="utf-8")
        result = subprocess.run(
            [staticrypt, str(source), "-t", str(root / "talks/template.html"),
             "-d", str(output), "-c", "false", "--short"],
            env={**os.environ, "STATICRYPT_PASSWORD": password},
            capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError(f"Could not encrypt {filename.name}: {result.stderr.strip()}")
        generated = output / "index.html"
        if not generated.is_file():
            raise RuntimeError("StatiCrypt did not generate the encrypted page.")
        filename.write_text(generated.read_text(encoding="utf-8"), encoding="utf-8")
    extract_page_assets(filename, root, asset_stem=f"{filename.stem}-locked")


def update_html_payload(payload_file, payload, html, password, staticrypt):
    encrypted = payload_operation("encrypt", password, staticrypt, source=html,
                                  salt=payload["staticryptSaltUniqueVariableName"])
    public_script = payload_file.read_text(encoding="utf-8")
    public_script, count = re.subn(
        r'(["\']?staticryptEncryptedMsgUniqueVariableName["\']?\s*:\s*)(["\'])[^"\'\n]+\2',
        lambda match: match[1] + match[2] + encrypted["staticryptEncryptedMsgUniqueVariableName"] + match[2],
        public_script,
    )
    if count != 1:
        raise RuntimeError("Malformed StatiCrypt payload: could not replace the ciphertext safely.")
    payload_file.write_text(public_script, encoding="utf-8")


def replace_files(changes):
    """Stage all files beside their destinations, then replace; roll back on error."""
    staged = {}
    backups = {}
    replaced = []
    try:
        for filename, content in changes.items():
            filename.parent.mkdir(parents=True, exist_ok=True)
            for mapping, data in ((staged, content.encode("utf-8")),
                                  (backups, filename.read_bytes() if filename.exists() else None)):
                if data is None:
                    mapping[filename] = None
                    continue
                fd, temporary = tempfile.mkstemp(prefix=f".{filename.name}-", dir=filename.parent)
                mapping[filename] = Path(temporary)
                with os.fdopen(fd, "wb") as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.chmod(temporary, filename.stat().st_mode & 0o777 if filename.exists() else 0o644)
        for filename, temporary in staged.items():
            os.replace(temporary, filename)
            replaced.append(filename)
    except Exception:
        for filename in reversed(replaced):
            if backups[filename] is None:
                filename.unlink()
            else:
                os.replace(backups[filename], filename)
        raise
    finally:
        for temporary in (*staged.values(), *backups.values()):
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def local_references(source, filename, root):
    """Resolve literal URLs in HTML, Markdown, CSS, and JavaScript strings."""
    values = [next(value for value in match if value) for match in re.findall(
        r'"([^"\n]+)"|\'([^\'\n]+)\'|`([^`\n]+)`', source
    )]
    values += re.findall(r'\b(?:src|href|poster|data-src)\s*=\s*([^\s>"\']+)', source)
    values += re.findall(r'\]\(([^)\n]+)\)', source)
    values += [value.strip().strip("\"'") for value in re.findall(r'url\(([^)]+)\)', source)]
    for match in MARKDOWN_BLOCK.finditer(source):
        values.extend('/' + path.relative_to(root).as_posix()
                      for path in local_references(json.loads(match[1]), filename, root))
    references = set()
    base = "/" + filename.relative_to(root).as_posix()
    for value in values:
        if len(value) > 4096 or "\0" in value:
            continue
        try:
            url = urlsplit(urljoin(base, value))
        except ValueError:
            continue
        if (url.scheme not in ("", "http", "https") or url.netloc not in ("", "charlesneimog.github.io")
                or not url.path):
            continue
        references.add(root / posixpath.normpath(unquote(url.path)).lstrip("/"))
    return references


def encryption_assets(page, root):
    """Only consider page-specific assets produced by encryption/extraction."""
    assets = set()
    for path in local_references(page.read_text(encoding="utf-8"), page, root):
        extension = path.suffix.lstrip(".")
        namespace = root / extension / page.relative_to(root).parent
        if extension not in ("js", "css") or path.parent != namespace or not path.is_file():
            continue
        if not re.fullmatch(re.escape(page.stem) + r'(?:-locked)?(?:-\d+)?\.' + extension, path.name):
            continue
        content = path.read_text(encoding="utf-8")
        if (extension == "js" and ("staticryptInitiator" in content or CIPHER_FIELDS[0] in content)) or (
            extension == "css" and ".staticrypt-" in content
        ):
            assets.add(path)
    return assets


def remove_obsolete_assets(candidates, root, password, staticrypt):
    """Keep shared/referenced assets, including references inside protected pages."""
    if not candidates:
        return
    references = set()
    candidate_sources = {}
    for filename in root.rglob("*"):
        if ".git" in filename.relative_to(root).parts or not filename.is_file() or filename.suffix not in (
            ".html", ".md", ".js", ".css", ".json", ".svg", ".xml"
        ):
            continue
        try:
            source = filename.read_text(encoding="utf-8")
            if filename.suffix == ".html":
                _, payload = find_html_payload(filename, root)
                if payload:
                    source += "\n" + payload_operation("decrypt", password, staticrypt, payload=payload)
            elif filename.suffix == ".md":
                source = read_markdown(filename, password, staticrypt)
            links = local_references(source, filename, root)
        except (RuntimeError, ValueError, UnicodeError):
            # Unreadable protected content may reference these assets; retain them.
            return
        if filename in candidates:
            candidate_sources[filename] = links
        else:
            references.update(links)
    while True:
        used = set(candidate_sources) & references
        if not used:
            break
        for filename in used:
            references.update(candidate_sources.pop(filename))
    for filename in candidate_sources:
        filename.unlink()


def prepare_presentation(talk, root, password, staticrypt):
    """Decode everything before preparing replacements; never change metadata."""
    root = root.resolve()
    folder = (root / "talks" / talk["link"]).resolve()
    if folder.name in ("index.html", "slide.md"):
        folder = folder.parent
    folder.relative_to(root / "talks")
    html_file = folder / "index.html"
    markdown_file = folder / "slide.md"
    if not html_file.is_file() and not markdown_file.is_file():
        raise RuntimeError(f"Missing presentation in {folder.name}.")

    pages = {}
    obsolete = set()
    for page in sorted(folder.rglob("*.html")):
        payload_file, payload = find_html_payload(page, root)
        html = payload_operation("decrypt", password, staticrypt, payload=payload) if payload else page.read_text(encoding="utf-8")
        pages[page] = (payload_file, payload, html)
        if payload and not talk.get("encrypt", False):
            obsolete.update(encryption_assets(page, root))
    markdown = read_markdown(markdown_file, password, staticrypt) if markdown_file.is_file() else None
    changes = {}
    if not talk.get("encrypt", False):
        for page, (_, payload, html) in pages.items():
            if payload:
                changes[page] = html
        if markdown_file.is_file() and markdown_payload(markdown_file.read_text(encoding="utf-8")):
            changes[markdown_file] = markdown
        return changes, obsolete

    html = pages[html_file][2] if html_file in pages else markdown_viewer(root)
    embedded = MARKDOWN_BLOCK.search(html)
    if markdown is None and embedded:
        markdown = json.loads(embedded[1])
    if markdown is not None:
        html = embed_markdown(html, markdown)
    if markdown is not None and (
        not markdown_file.is_file() or not markdown_payload(markdown_file.read_text(encoding="utf-8"))
    ):
        protected = payload_operation("encrypt", password, staticrypt, source=markdown)
        changes[markdown_file] = json.dumps(protected, indent=2) + "\n"
    pages.setdefault(html_file, (None, None, html))
    with tempfile.TemporaryDirectory(prefix="talk-preparation-") as directory:
        stage_root = Path(directory)
        for page, (payload_file, payload, original) in pages.items():
            source = html if page == html_file else original
            if payload and source == original:
                continue
            if payload:
                staged = stage_root / payload_file.relative_to(root)
                staged.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(payload_file, staged)
                update_html_payload(staged, payload, source, password, staticrypt)
            else:
                template = stage_root / "talks/template.html"
                template.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(root / "talks/template.html", template)
                staged = stage_root / page.relative_to(root)
                staged.parent.mkdir(parents=True, exist_ok=True)
                write_protected_html(staged, source, password, staticrypt, stage_root)
        for staged in stage_root.rglob("*"):
            if staged.is_file() and staged != stage_root / "talks/template.html":
                target = root / staged.relative_to(stage_root)
                if target.suffix in (".js", ".css") and target.exists() and target not in {
                    record[0] for record in pages.values() if record[1]
                }:
                    existing = target.read_text(encoding="utf-8")
                    if "staticryptInitiator" not in existing and ".staticrypt-" not in existing:
                        raise RuntimeError(f"Refusing to overwrite presentation resource {target.name}.")
                changes[target] = staged.read_text(encoding="utf-8")
    return changes, obsolete


def protect_presentation(talk, root, password, staticrypt):
    """Encrypt or decrypt one presentation according to its encrypt setting."""
    changes, obsolete = prepare_presentation(talk, root, password, staticrypt)
    replace_files(changes)
    remove_obsolete_assets(obsolete, root.resolve(), password, staticrypt)
    return bool(changes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-tailwind", action="store_true", help="Skip rebuilding the shared Tailwind stylesheet.")
    args = parser.parse_args()
    staticrypt = shutil.which("staticrypt")
    if not staticrypt:
        raise RuntimeError('Install StatiCrypt first: "npm install -g staticrypt".')
    password = os.environ.get("STATICRYPT_PASSWORD") or getpass.getpass("Presentation password: ")
    catalog = SITE_ROOT / "talks/talks.json"
    talks = json.loads(catalog.read_text(encoding="utf-8"))
    changes = {}
    obsolete = set()
    messages = []
    for talk in talks:
        try:
            prepared, unused = prepare_presentation(talk, SITE_ROOT, password, staticrypt)
        except (RuntimeError, ValueError, OSError) as error:
            raise RuntimeError(f'Could not process {talk["link"]}: {error}') from error
        for filename, content in prepared.items():
            if filename in changes and changes[filename] != content:
                raise RuntimeError(f"Conflicting presentation updates for {filename}.")
            changes[filename] = content
        obsolete.update(unused)
        if prepared:
            action = "Encrypted" if talk.get("encrypt", False) else "Decrypted"
            messages.append(f'{action} {talk["link"]}')
    replace_files(changes)
    remove_obsolete_assets(obsolete, SITE_ROOT, password, staticrypt)
    for message in messages:
        print(message)
    if changes and not args.no_tailwind:
        tailwindcss = shutil.which("tailwindcss")
        if not tailwindcss:
            raise RuntimeError("Install the Tailwind CSS CLI to build the shared stylesheet.")
        subprocess.run([tailwindcss, "-i", str(SITE_ROOT / "css/talks/input.css"),
                        "-o", str(SITE_ROOT / "css/talks/output.css")], check=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
