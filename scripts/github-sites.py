#!/usr/bin/env python3
"""Discover published Pages content and media, then safely generate a sitemap.

Only stdlib + the authenticated GitHub CLI are required. Repository-specific
adapters below mirror the *renderers*, not arbitrary JSON/file-name heuristics.
See scripts/README.md for their source contracts and offline/live commands.
"""

import argparse
import base64
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import date, datetime
import gzip
import hashlib
from html import escape, unescape
from html.parser import HTMLParser
import json
import logging
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "https://charlesneimog.github.io/"
HOST = "charlesneimog.github.io"
SITEMAP_ONLY_PROJECTS = {
    BASE_URL + "Awesome-Pd/": BASE_URL + "Awesome-Pd/sitemap.xml",
}
SITEMAP = REPOSITORY_ROOT / "sitemap.xml"
NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9"
IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1"
VIDEO_NS = "http://www.google.com/schemas/sitemap-video/1.1"
USER_AGENT = "GithubSitesSitemap/1.0"
MAX_URLS = 50_000
MAX_BYTES = 50 * 1024 * 1024
LOG = logging.getLogger("github_sites")
ET.register_namespace("", NAMESPACE)
ET.register_namespace("image", IMAGE_NS)
ET.register_namespace("video", VIDEO_NS)


def public_url(value, base=BASE_URL):
    """Remove fragments and encode URLs, preserving existing percent escapes."""
    if not isinstance(value, str) or not value.strip():
        return None
    parts = urlsplit(urljoin(base, unescape(value.strip())))
    if parts.scheme not in ("https", "http") or not parts.hostname or parts.username or parts.password:
        return None
    # A literal percent (e.g. metro-dev%/) is not a valid escape. Leaving it
    # unencoded makes GitHub Pages reject the request with HTTP 400.
    path = re.sub(r"%(?![0-9a-fA-F]{2})", "%25", parts.path or "/")
    query = re.sub(r"%(?![0-9a-fA-F]{2})", "%25", parts.query)
    return urlunsplit((parts.scheme, parts.netloc, quote(path, safe="/%:@!$&'()*+,;=-._~"),
                       quote(query, safe="%=&;+/:?@!$'()*,-._~"), ""))


def on_site(url):
    parts = urlsplit(url)
    return parts.hostname == HOST and parts.port in (None, 80, 443)


def sitemap_only_project(url):
    if not on_site(url):
        return None
    path = urlsplit(url).path
    for project, sitemap in SITEMAP_ONLY_PROJECTS.items():
        prefix = urlsplit(project).path
        if path == prefix.rstrip("/") or path.startswith(prefix):
            return sitemap
    return None


def valid_lastmod(value):
    if not isinstance(value, str):
        return None
    try:
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            date.fromisoformat(value)
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})", value):
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            return None
        return value
    except ValueError:
        return None


def plain_text(value):
    text = re.sub(r"<[^>]*>", "", str(value or ""))
    return unescape(re.sub(r"[*_`]", "", text)).strip()


def atomic_write(path, data, backup=False):
    """Keep the prior file until the fully written replacement is ready."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        if backup and path.exists():
            atomic_write(path.with_name(path.name + ".bak"), path.read_bytes())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@dataclass
class Report:
    partial: bool = False
    errors: list = field(default_factory=list)
    excluded: list = field(default_factory=list)
    missing_metadata: list = field(default_factory=list)
    files: list = field(default_factory=list)
    associations: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)
    _seen: set = field(default_factory=set, repr=False)

    def add(self, group, **record):
        key = (group, json.dumps(record, sort_keys=True, ensure_ascii=False))
        if key not in self._seen:
            self._seen.add(key)
            getattr(self, group).append(record)
            return True
        return False

    def error(self, source, message, partial=True):
        if self.add("errors", source=str(source), message=str(message)):
            LOG.error("ERROR: %s: %s", source, message)
        self.partial |= partial

    def warning(self, message):
        if message not in self.warnings:
            self.warnings.append(message)
            LOG.warning("WARNING: %s", message)

    def as_dict(self):
        return {key: value for key, value in vars(self).items() if not key.startswith("_")}


class DiscoveryError(RuntimeError):
    pass


def gh_api(endpoint, paginate=False, timeout=30, retries=2):
    command = ["gh", "api"]
    if paginate:
        command.extend(["--paginate", "--slurp"])
    command.append(endpoint)
    for attempt in range(retries + 1):
        LOG.info("GitHub: %s (attempt %d/%d)", endpoint, attempt + 1, retries + 1)
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=True)
            data = json.loads(result.stdout)
            if paginate:
                if not isinstance(data, list) or any(not isinstance(page, list) for page in data):
                    raise DiscoveryError(f"{endpoint}: expected --slurp array of pages")
                data = [repo for page in data for repo in page]
                if any(not isinstance(repo, dict) for repo in data):
                    raise DiscoveryError(f"{endpoint}: invalid repository response")
            LOG.info("GitHub: %s -> OK", endpoint)
            return data
        except subprocess.CalledProcessError as exc:
            message = (exc.stderr or "GitHub API failed").strip()
            # Authentication, permissions and rate limits must never look like no Pages.
            transient = bool(re.search(r"HTTP 5\d\d|error connecting|timeout", message, re.I))
            if not transient or attempt == retries:
                raise DiscoveryError(f"{endpoint}: {message}") from exc
        except subprocess.TimeoutExpired as exc:
            if attempt == retries:
                raise DiscoveryError(f"{endpoint}: gh api timeout ({timeout}s)") from exc
        except (OSError, ValueError) as exc:
            raise DiscoveryError(f"{endpoint}: {exc}") from exc
        delay = min(2 ** attempt, 4)
        LOG.warning("WARNING: GitHub: %s failed; retrying in %ds", endpoint, delay)
        time.sleep(delay)


def get_pages(repo, **options):
    if not repo.get("has_pages"):
        return None
    endpoint = f"repos/{repo['owner']['login']}/{repo['name']}/pages"
    pages = gh_api(endpoint, **options)
    if not isinstance(pages, dict) or not pages.get("html_url"):
        raise DiscoveryError(f"{endpoint}: Pages response has no html_url")
    return pages


def discover_sites(report, timeout=30, retries=2):
    options = {"timeout": timeout, "retries": retries}
    account = gh_api("user", **options)
    if not isinstance(account, dict) or not isinstance(account.get("login"), str) or not account["login"]:
        raise DiscoveryError("user: authenticated API response has no login")
    username = account["login"]
    # Authenticated endpoint includes private owned repos, unlike users/{name}/repos.
    repos = gh_api("user/repos?per_page=100&affiliation=owner&sort=full_name", paginate=True, **options)
    report.counts["repositories"] = len(repos)
    report.counts["repositories_with_pages"] = sum(bool(repo.get("has_pages")) for repo in repos)
    LOG.info("Discovery: %d repositories, %d with Pages", len(repos), report.counts["repositories_with_pages"])
    sites = {BASE_URL}
    for repo in repos:
        if not repo.get("has_pages"):
            continue
        try:
            pages = get_pages(repo, **options)
            url = public_url(pages["html_url"])
            if not url or not on_site(url):
                report.add("excluded", url=pages["html_url"], reason="Pages outside target host")
            elif pages.get("public") is False:
                report.add("excluded", url=url, reason="private Pages")
            else:
                sites.add(url)
                if url == BASE_URL:
                    report.counts["pages_build"] = {key: pages.get(key) for key in ("build_type", "source")}
        except (DiscoveryError, KeyError, TypeError) as exc:
            report.error(repo.get("full_name", repo["name"]), exc)
    report.counts["authenticated_account"] = username
    return sorted(sites)


@dataclass
class Response:
    url: str
    status: int
    headers: dict
    body: bytes = b""

    @property
    def text(self):
        return self.body.decode("utf-8", errors="replace")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HTTPClient:
    """Bounded requests, disk cache (including failures), and explicit redirects."""
    def __init__(self, cache, timeout=15, retries=2, ttl=86400, max_requests=10000):
        self.cache = Path(cache)
        self.timeout, self.retries, self.ttl = timeout, retries, ttl
        self.max_requests, self.requests, self.cache_hits = max_requests, 0, 0
        self.opener = build_opener(NoRedirect())
        self.memory = {}

    def request(self, url, method="GET", max_bytes=8 * 1024 * 1024):
        key = hashlib.sha256(f"{method} {url}".encode()).hexdigest()
        if key in self.memory:
            return self.memory[key]
        path = self.cache / (key + ".json")
        try:
            cached = json.loads(path.read_text())
            life = self.ttl if cached["status"] < 400 else min(self.ttl, 300)
            if time.time() - cached["cached_at"] < life:
                response = Response(cached["url"], cached["status"], cached["headers"], base64.b64decode(cached["body"]))
                self.cache_hits += 1
                self.memory[key] = response
                LOG.info("Cache: %s %s -> HTTP %d", method, url, response.status)
                return response
        except (OSError, ValueError, KeyError):
            pass
        for attempt in range(self.retries + 1):
            if self.requests >= self.max_requests:
                raise DiscoveryError(f"HTTP request limit ({self.max_requests}) reached")
            self.requests += 1
            LOG.info("HTTP [%d/%d]: %s %s (attempt %d/%d)", self.requests, self.max_requests,
                     method, url, attempt + 1, self.retries + 1)
            started = time.monotonic()
            try:
                request = Request(url, method=method, headers={"User-Agent": USER_AGENT})
                try:
                    stream = self.opener.open(request, timeout=self.timeout)
                except HTTPError as exc:
                    stream = exc
                with stream:
                    status = stream.code
                    headers = {key.lower(): value for key, value in stream.headers.items()}
                    # Never download complete PDFs/videos/images just to check publication.
                    body = stream.read(max_bytes + 1) if method == "GET" and status == 200 else b""
                    if len(body) > max_bytes:
                        raise DiscoveryError(f"{url}: response exceeds {max_bytes} bytes")
                    response = Response(url, status, headers, body)
                LOG.info("HTTP: %s %s -> %d (%.2fs)", method, url, status, time.monotonic() - started)
                if status not in (429, 500, 502, 503, 504) or attempt == self.retries:
                    break
            except (URLError, TimeoutError, OSError) as exc:
                LOG.warning("WARNING: HTTP: %s %s -> %s", method, url, exc)
                if attempt == self.retries:
                    raise DiscoveryError(f"{url}: {exc}") from exc
            delay = min(2 ** attempt, 4)
            LOG.warning("WARNING: HTTP: %s %s retrying in %ds", method, url, delay)
            time.sleep(delay)
        atomic_write(path, json.dumps({"url": url, "status": response.status, "headers": response.headers,
                                     "body": base64.b64encode(response.body).decode(), "cached_at": time.time()}).encode())
        self.memory[key] = response
        return response


class Robots:
    """Longest-match robots rules including * and $, with Allow winning ties."""
    def __init__(self, text):
        self.sitemaps = []
        self.groups = []
        agents, rules = [], []
        for line in text.splitlines() + ["User-agent: __end__"]:
            key, separator, value = line.split("#", 1)[0].partition(":")
            if not separator:
                continue
            key, value = key.strip().lower(), value.strip()
            if key == "sitemap":
                self.sitemaps.append(value)
            elif key == "user-agent":
                if rules:
                    self.groups.append((agents, rules))
                    agents, rules = [], []
                agents.append(value.lower())
            elif key in ("allow", "disallow") and value and agents:
                rules.append((key == "allow", value))
        self.groups.append((agents, rules))

    def allows(self, url):
        # Apply rules to both our fetcher and Googlebot (the sitemap consumer).
        for agent in (USER_AGENT.lower(), "googlebot"):
            matching = [(names, rules) for names, rules in self.groups
                        if any(name == "*" or name in agent for name in names)]
            specific = [(names, rules) for names, rules in matching if any(name != "*" and name in agent for name in names)]
            rules = [rule for _, group in (specific or matching) for rule in group]
            parts = urlsplit(url)
            target = parts.path + ("?" + parts.query if parts.query else "")
            matches = []
            for allow, pattern in rules:
                pattern = quote(pattern, safe="/%*?$&=:@!'+,;()-._~")
                pattern = re.sub(r"%[0-9a-fA-F]{2}", lambda match: match[0].upper(), pattern)
                normalized_target = re.sub(r"%[0-9a-fA-F]{2}", lambda match: match[0].upper(), target)
                expression = re.escape(pattern).replace(r"\*", ".*")
                expression = expression[:-2] + "$" if pattern.endswith("$") else expression
                if re.match(expression, normalized_target):
                    matches.append((len(pattern.replace("*", "").rstrip("$")), allow))
            if matches and not max(matches)[1]:
                return False
        return True


def video_identity(url):
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if host in ("youtube.com", "www.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "youtu.be"):
        identifier = parts.path.strip("/") if host == "youtu.be" else (
            parts.path.split("/")[2] if parts.path.startswith(("/embed/", "/shorts/")) else parse_qs(parts.query).get("v", [""])[0])
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", identifier):
            return "youtube", identifier
    if host in ("vimeo.com", "www.vimeo.com", "player.vimeo.com"):
        match = re.search(r"/(?:video/)?(\d+)(?:/|$)", parts.path)
        if match:
            # Vimeo's h token can identify an unlisted video; retain it.
            return "vimeo", match[1] + (":" + parse_qs(parts.query)["h"][0] if "h" in parse_qs(parts.query) else "")
    if re.search(r"\.(mp4|webm|mov|m4v|ogv)(?:$|\?)", url, re.I):
        return "local", url
    return None


def useful_image(url, attrs=None):
    attrs = attrs or {}
    if not url or url.startswith("data:"):
        return False
    name = Path(urlsplit(url).path).name.lower()
    label = " ".join(str(attrs.get(key, "")) for key in ("class", "id", "alt", "role"))
    if attrs.get("aria-hidden") == "true" or attrs.get("role") == "presentation":
        return False
    if re.search(r"(?:^|[-_/\s])(icon|placeholder|spinner|loading|favicon|avatar)(?:[-_.\s]|$)", name + " " + label, re.I):
        return False
    if name in ("pdf.svg", "pd4web.svg", "github-dark.svg", "github-light.svg") and "logo" in label.lower():
        return False
    for key in ("width", "height"):
        if str(attrs.get(key, "")).isdigit() and int(attrs[key]) <= 32:
            return False
    return True


def srcset_urls(value):
    # Follow srcset's URL/descriptor token boundaries. In particular, commas
    # inside a data URI must not create a bogus relative image URL.
    urls, position = [], 0
    while position < len(value):
        while position < len(value) and (value[position].isspace() or value[position] == ","):
            position += 1
        start = position
        while position < len(value) and not value[position].isspace():
            position += 1
        candidate = value[start:position]
        trailing_comma = candidate.endswith(",")
        candidate = candidate.rstrip(",")
        if candidate and not candidate.startswith("data:"):
            urls.append(candidate)
        if not trailing_comma:
            parentheses = 0
            while position < len(value):
                char = value[position]
                parentheses += (char == "(") - (char == ")")
                position += 1
                if char == "," and parentheses == 0:
                    break
    return urls


class PageHTML(HTMLParser):
    def __init__(self, text, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.links, self.images, self.videos, self.files, self.scripts, self.markdown, self.structured = [], [], [], [], [], [], []
        self.canonical, self.noindex, self.protected = None, False, False
        self._video, self._audio, self._script, self._script_text = None, False, None, []
        self._ignored = []
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, values):
        attrs = dict(values)
        url = lambda value: public_url(value, self.base)
        # Template, noscript and hidden content is not displayed by this site's JS.
        void = tag in ("area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr")
        hidden = tag in ("template", "noscript") or "hidden" in attrs or attrs.get("aria-hidden") == "true"
        if self._ignored or hidden:
            # Dropdown navigation starts hidden but its links are public routes.
            if tag in ("a", "area") and attrs.get("href") and not any(item in ("template", "noscript") for item in self._ignored):
                self.links.append(url(attrs["href"]))
            if not void:
                self._ignored.append(tag)
            return
        if tag == "base" and attrs.get("href"):
            self.base = url(attrs["href"]) or self.base
        if tag == "meta" and attrs.get("name", "").lower() in ("robots", "googlebot"):
            self.noindex |= bool(re.search(r"\b(noindex|none)\b", attrs.get("content", ""), re.I))
        if "staticrypt-html" in attrs.get("class", "") or attrs.get("type") == "password" or "data-password-screen" in attrs:
            self.protected = True
        if tag == "link":
            rel = attrs.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical = url(attrs.get("href"))
        if tag in ("a", "area") and attrs.get("href"):
            self.links.append(url(attrs["href"]))
        if tag in ("img", "source") and not self._video and not self._audio:
            for key in ("src", "data-src", "data-lazy-src", "data-original"):
                if useful_image(attrs.get(key), attrs):
                    self.images.append(url(attrs[key]))
            for key in ("srcset", "data-srcset", "data-lazy-srcset"):
                self.images.extend(url(item) for item in srcset_urls(attrs.get(key, "")) if useful_image(item, attrs))
        if attrs.get("role") == "img" or "background-image" in attrs.get("style", ""):
            self.images.extend(url(match) for match in re.findall(r"url\(['\"]?([^)'\"]+)", attrs.get("style", "")))
        if tag == "video":
            # Silent autoplay/loop footage without controls is usually decorative.
            decorative = "controls" not in attrs and any(key in attrs for key in ("autoplay", "loop", "muted"))
            self._video = {"url": url(attrs.get("src") or attrs.get("data-src")),
                           "thumbnail_loc": url(attrs.get("poster")), "title": attrs.get("title", ""),
                           "description": attrs.get("data-description", ""), "decorative": decorative}
            self.videos.append(self._video)
        if tag == "audio":
            self._audio = True
            self.files.append((url(attrs.get("src") or attrs.get("data-src")), "audio"))
        if tag == "source" and self._video:
            source = url(attrs.get("src") or attrs.get("data-src"))
            if source:
                if not self._video["url"]:
                    self._video["url"] = source
                else:
                    self.files.append((source, "alternate video source"))
        if tag == "source" and self._audio:
            self.files.append((url(attrs.get("src") or attrs.get("data-src")), "audio"))
        if tag == "iframe":
            source = url(attrs.get("src") or attrs.get("data-src"))
            if source and video_identity(source):
                self.videos.append({"url": source, "title": attrs.get("title", ""),
                                    "description": attrs.get("data-description", ""), "thumbnail_loc": url(attrs.get("poster"))})
            elif source and "bandcamp.com" in (urlsplit(source).hostname or ""):
                self.files.append((source, "audio embed"))
        if attrs.get("data-markdown"):
            self.markdown.append(url(attrs["data-markdown"]))
        if tag == "script":
            self._script, self._script_text = attrs, []
            if attrs.get("src"):
                self.scripts.append(url(attrs["src"]))

    def handle_data(self, text):
        if self._script is not None:
            self._script_text.append(text)

    def handle_endtag(self, tag):
        if self._ignored:
            if tag == self._ignored[-1]:
                self._ignored.pop()
            return
        if tag == "video":
            self._video = None
        if tag == "audio":
            self._audio = False
        if tag == "script" and self._script is not None:
            content = "".join(self._script_text)
            if self._script.get("type") == "application/ld+json":
                try:
                    self.structured.append(json.loads(content))
                except ValueError:
                    pass
            if self._script.get("id") == "presentation-markdown" and self._script.get("type") == "application/json":
                try:
                    self.markdown.append((json.loads(content), public_url("slide.md", self.base)))
                except ValueError:
                    pass
            self._script = None


def markdown_html(text):
    """Extract displayed Markdown links/media; never publish the source as loc."""
    text = re.sub(r"(?ms)^\s*(`{3,}|~{3,}).*?^\s*\1\s*$", "", text)
    references = dict(re.findall(r"(?m)^\s*\[([^\]]+)\]:\s*<?([^\s>]+)>?", text))
    def reference(match):
        target = references.get(match[3] or match[2])
        if not target:
            return match[0]
        return f'{match[1]}[{match[2]}]({target})'
    text = re.sub(r"(!?)\[([^\]]*)\]\[([^\]]*)\]", reference, text)
    def link(match):
        image, label, target = match.groups()
        target = target.strip().split()[0].strip("<>")
        return f'<img src="{escape(target, quote=True)}" alt="{escape(label, quote=True)}">' if image else f'<a href="{escape(target, quote=True)}">{escape(label)}</a>'
    return re.sub(r"(!?)\[([^\]]*)\]\(([^)]+)\)", link, text)


def structured_videos(value):
    """Read metadata only; a VideoObject alone does not prove presentation."""
    if isinstance(value, list):
        for child in value:
            yield from structured_videos(child)
    elif isinstance(value, dict):
        types = value.get("@type", [])
        if "VideoObject" in (types if isinstance(types, list) else [types]):
            yield value
        for child in value.values():
            if isinstance(child, (dict, list)):
                yield from structured_videos(child)


@dataclass
class Entry:
    loc: str
    lastmod: str = None
    images: set = field(default_factory=set)
    videos: dict = field(default_factory=dict)


def parse_sitemap(data):
    if data.startswith(b"\x1f\x8b"):
        # Limit decompression as well as the compressed HTTP response.
        import io
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
                data = stream.read(MAX_BYTES + 1)
        except (OSError, EOFError) as exc:
            raise DiscoveryError(f"Invalid compressed sitemap: {exc}") from exc
    if len(data) > MAX_BYTES:
        raise DiscoveryError("Sitemap exceeds uncompressed size limit")
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise DiscoveryError("Sitemap with DTD/entities rejected")
    root = ET.fromstring(data)
    kind = root.tag.rsplit("}", 1)[-1]
    if kind not in ("sitemapindex", "urlset"):
        raise DiscoveryError(f"Unexpected sitemap root: {kind}")
    records = []
    for node in root:
        values = {child.tag.rsplit("}", 1)[-1]: child.text for child in node if child.tag.startswith("{" + NAMESPACE + "}")}
        if values.get("loc"):
            images = [el.text for el in node.findall(f"{{{IMAGE_NS}}}image/{{{IMAGE_NS}}}loc") if el.text]
            videos = [{child.tag.rsplit("}", 1)[-1]: child.text for child in el} for el in node.findall(f"{{{VIDEO_NS}}}video")]
            records.append((values["loc"], valid_lastmod(values.get("lastmod")), images, videos))
    return kind, records


class RepositoryContent:
    """Publication/renderer contracts observed in this repository.

    sections.js + content-urls.js: music/research/blog query modals and saved slugs.
    content-seo.js binds the selected item to its canonical URL and metadata.
    talks.js + talk-slide.js: HTML redirect or Markdown in slide.html?talk=...
    classes.js + course.js + lesson-slide.js: password-gated course viewers.
    tools/tools.js: links are relative to the tools listing, not its JSON file.
    """
    def __init__(self, root, report, build_dir=None):
        self.root, self.report = Path(root), report
        self.published = Path(build_dir) if build_dir else self.root
        self.routes, self.protected_prefixes, self.processed = {}, set(), set()
        self.content_pages = self.json("json/content-pages.json") if (self.root / "json/content-pages.json").is_file() else []
        self.content_urls = {}
        for page in self.content_pages:
            category, slug = page.get("kind"), page.get("slug")
            if category not in ("music", "research", "blog") or not isinstance(slug, str):
                self.report.error("json/content-pages.json", "Invalid content URL manifest; run node scripts/build-content.cjs")
                continue
            canonical = public_url("?" + urlencode({category: slug}))
            if page.get("canonical") != canonical:
                self.report.error("json/content-pages.json", "Canonical URL differs from query route; run node scripts/build-content.cjs")
                continue
            for alias in [slug, *page.get("aliases", [])]:
                self.content_urls.setdefault((category, alias), canonical)
        self.content_urls_folded = {(category, alias.casefold()): canonical for (category, alias), canonical in self.content_urls.items()}
        self.prepare_access()

    def json(self, relative):
        try:
            data = json.loads((self.root / relative).read_text(encoding="utf-8"))
            if not isinstance(data, list) or any(not isinstance(item, dict) for item in data):
                raise ValueError("Expected an array of objects, as consumed by the renderer")
            return data
        except (OSError, ValueError) as exc:
            self.report.error(relative, exc)
            return []

    def prepare_access(self):
        for talk in self.json("talks/talks.json"):
            if talk.get("encrypt"):
                path = urlsplit(public_url(talk["link"], BASE_URL + "talks/")).path
                self.protected_prefixes.add(path.rsplit("/", 1)[0] + "/" if path.endswith((".html", ".md")) else path.rstrip("/") + "/")
        # lesson-slide.js requires an unlocked session even if listing.locked=false.
        self.protected_prefixes.update(("/classes/course.html", "/classes/slide.html"))
        for course in self.json("classes/classes.json"):
            if course.get("path"):
                self.protected_prefixes.add(urlsplit(public_url(course["path"].rstrip("/") + "/", BASE_URL + "classes/")).path)

    def protected(self, url):
        parts = urlsplit(url)
        path = parts.path
        if any(path == prefix or prefix.endswith("/") and path.startswith(prefix) for prefix in self.protected_prefixes):
            return True
        talk = parse_qs(parts.query).get("talk", [None])[0]
        return bool(talk and any(urlsplit(public_url(talk, BASE_URL + "talks/")).path.rstrip("/") + "/" == prefix or
                                urlsplit(public_url(talk, BASE_URL + "talks/")).path.startswith(prefix)
                                for prefix in self.protected_prefixes))

    def path(self, url):
        if not on_site(url):
            return None
        from urllib.parse import unquote
        relative = unquote(urlsplit(url).path).lstrip("/")
        path = (self.published / relative).resolve()
        if not path.is_relative_to(self.published.resolve()):
            return None
        if path.is_dir() or urlsplit(url).path.endswith("/"):
            path = path / "index.html"
        return path if path.is_file() else None

    def canonical_content_url(self, url):
        if not on_site(url) or urlsplit(url).path not in ("/", "/index.html"):
            return url
        params = parse_qs(urlsplit(url).query)
        for category in ("music", "research", "blog"):
            if category in params:
                slug = params[category][0]
                return self.content_urls.get((category, slug)) or self.content_urls_folded.get((category, slug.casefold())) or url
        return url

    def local_response(self, url, method="GET"):
        route = self.routes.get(url)
        path = self.path(route["shell"] if route else url)
        if not path:
            return None
        suffix = path.suffix.lower()
        content_type = "text/html" if suffix == ".html" else "application/pdf" if suffix == ".pdf" else "application/octet-stream"
        body = path.read_bytes() if method == "GET" and suffix in (".html", ".xml", ".txt", ".md", ".json", ".js") else b""
        return Response(url, 200, {"content-type": content_type}, body)

    def adapters(self, url, html, crawler):
        scripts = {urlsplit(item).path for item in html.scripts if item}
        if "/js/sections.js" in scripts and "home" not in self.processed:
            self.processed.add("home")
            source = (self.root / "js/sections.js").read_text()
            required = ('const MUSIC_QUERY_PARAM = "music"', 'const RESEARCH_QUERY_PARAM = "research"',
                        'const BLOG_QUERY_PARAM = "blog"', 'post.iframe.source === "youtube"', 'post.iframe.link',
                        'post.images.slice(0, 4)', 'fetchMarkdown(post.file, article)', 'ContentURLs.query', 'ContentSEO.apply')
            if any(marker not in source for marker in required):
                self.report.error("js/sections.js", "Renderer contract changed; update the sitemap adapter")
                return
            for category, filename in (("music", "json/music.json"), ("research", "json/articles.json"), ("blog", "json/blog.json")):
                if f'fetch("/{filename}")' not in source:
                    self.report.error(filename, "JSON loader changed; update the sitemap adapter")
                    continue
                for index, item in enumerate(self.json(filename)):
                    slug = item.get("slug")
                    manifest = next((page for page in self.content_pages if page.get("kind") == category and page.get("slug") == slug), None)
                    if not slug or not manifest or manifest.get("title") != item.get("title"):
                        self.report.error(filename, "Content metadata missing or stale; run node scripts/build-content.cjs")
                        continue
                    page = public_url("?" + urlencode({category: slug}))
                    route = {"shell": BASE_URL, "category": category, "canonical": page, "source": filename,
                             "images": [item["image"]] if item.get("image") else [], "videos": [], "links": []}
                    if category == "music":
                        if item.get("image"):
                            html.images.append(public_url(item["image"], BASE_URL))  # card on homepage
                        route["images"].extend(item.get("images", [])[:4])
                        iframe = item.get("iframe") or {}
                        if iframe.get("source") == "youtube" and iframe.get("link"):
                            route["videos"].append({"url": public_url(iframe["link"], url), "title": item.get("title"),
                                                    "description": item.get("description"), "thumbnail_loc": public_url(item.get("image"), url),
                                                    "publication_date": iframe.get("uploadDate"), "source": f"{filename}[{index}].iframe"})
                        elif iframe.get("source") == "bandcamp":
                            crawler.record_file(page, public_url(iframe.get("link"), url), "audio embed", filename)
                        route["links"] = [item[key] for key in ("pd4web", "score", "github") if item.get(key)]
                    elif category == "research":
                        route["images"].extend(item.get("images", [])[:4])
                        route["links"] = [item[key] for key in ("link", "paper") if item.get(key)]
                    else:
                        route["markdown"] = (self.root / item["file"], BASE_URL)  # fetchMarkdown does not rebase links
                    self.routes[page] = route
                    crawler.enqueue(page)
            if 'fetch("json/software.json")' in source:
                for item in self.json("json/software.json"):
                    html.images.extend(public_url(item[key], url) for key in ("img", "imgDark") if item.get(key))
                    if item.get("link"):
                        html.links.append(public_url(item["link"], url))
        if "/js/talks.js" in scripts and "talks" not in self.processed:
            self.processed.add("talks")
            for talk in self.json("talks/talks.json"):
                target = public_url(talk.get("link"), url)
                if not target:
                    continue
                viewer = public_url("slide.html?" + urlencode({"talk": urlsplit(target).path}), url)
                if talk.get("encrypt"):
                    self.report.add("excluded", url=viewer, reason="protected presentation", source="talks/talks.json")
                    continue
                if target.endswith(".html"):
                    crawler.enqueue(target)
                    continue
                folder = target if target.endswith("/") else target + "/"
                markdown = target if target.endswith(".md") else public_url("slide.md", folder)
                html_url = public_url("index.html", folder)
                if not target.endswith(".md") and self.path(html_url):
                    crawler.enqueue(html_url)  # talk-slide.js redirects to this HTML
                else:
                    path = self.path(markdown)
                    if path:
                        self.routes[viewer] = {"shell": public_url("slide.html", url), "source": "talks/talks.json",
                                               "markdown": (path, markdown)}
                        crawler.enqueue(viewer)
                    else:
                        self.report.error(target, "Presentation has neither published HTML nor Markdown")
        if "/tools/tools.js" in scripts and "tools" not in self.processed:
            self.processed.add("tools")
            for item in self.json("tools/tools.json"):
                if item.get("link") and not item.get("locked"):
                    html.links.append(public_url(item["link"], url))

    def augment(self, url, html):
        route = self.routes.get(url)
        if not route:
            if urlsplit(url).path in ("/", "/index.html") and self.content_pages:
                params = parse_qs(urlsplit(url).query, keep_blank_values=True)
                if any(category in params for category in ("music", "research", "blog")):
                    html.noindex = True  # same missing-content behavior as the browser
                else:
                    html.canonical = BASE_URL  # includes index.html and tracking aliases
            return
        if route.get("category"):
            # The modal presents this item's media. Homepage card images from
            # other items must not be associated with every query URL.
            html.canonical = route["canonical"]
            for key in ("images", "links", "videos", "files", "structured"):
                getattr(html, key).clear()
        html.images.extend(public_url(item, route["shell"]) for item in route.get("images", []))
        html.links.extend(public_url(item, route["shell"]) for item in route.get("links", []))
        html.videos.extend(route.get("videos", []))
        if route.get("markdown"):
            path, base = route["markdown"]
            text = path.read_text(encoding="utf-8")
            if '"staticrypt-markdown"' in text:
                html.protected = True
            else:
                extra = PageHTML(markdown_html(text), base)
                for video in extra.videos:
                    video["source"] = path.relative_to(self.root).as_posix()
                for key in ("images", "links", "videos", "files"):
                    getattr(html, key).extend(getattr(extra, key))

    def rendered_code_images(self, html):
        # Constant assignments in page-specific renderers provide evidence of
        # displayed media. Never scan dependency bundles or every source literal.
        for script in html.scripts:
            if not script or not on_site(script):
                continue
            path = self.path(script)
            if not path or not urlsplit(script).path.startswith("/js/talks/"):
                continue
            source = path.read_text(encoding="utf-8")
            for value in re.findall(r'\b\w+\.src\s*=\s*["\']([^"\']+)["\']', source):
                image = public_url(value, html.base)
                if image and Path(urlsplit(image).path).suffix.lower() in IMAGE_SUFFIXES and useful_image(image):
                    html.images.append(image)

    def build_pages(self):
        """Inventory existing public HTML, excluding source/test/protected folders."""
        pages = []
        for path in sorted(self.published.rglob("*.html")):
            relative = path.relative_to(self.published)
            if any(part.startswith((".", "_")) or part.lower() in INTERNAL_PARTS for part in relative.parts[:-1]):
                continue
            url = public_url(relative.as_posix())
            if not self.protected(url) and path.name not in ("404.html", "template.html"):
                pages.append(url)
        return pages


INTERNAL_PARTS = {".git", ".github", "node_modules", "vendor", "__pycache__", "scripts", "css", "js", "fonts",
                  "test", "tests", "testes", "media", "webpatch"}
SOURCE_SUFFIXES = {".md", ".json", ".js", ".css", ".py", ".cjs", ".ts", ".tsx", ".typ", ".map", ".woff", ".woff2", ".ttf", ".xml"}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".avif", ".webp", ".gif", ".svg"}
FILE_SUFFIXES = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".aac", ".zip", ".pd", ".odt", ".mp4", ".webm", ".mov", ".m4v", ".svg"}


class Crawler:
    def __init__(self, repository, client, report, offline=False, max_pages=2000, max_depth=8,
                 max_query_variants=50, max_sitemaps=100):
        self.repository, self.client, self.report = repository, client, report
        self.offline, self.max_pages, self.max_depth = offline, max_pages, max_depth
        self.max_query_variants, self.max_sitemaps = max_query_variants, max_sitemaps
        self.queue, self.scheduled, self.visited = deque(), set(), set()
        self.variants, self.robots_cache, self.sitemap_seen = defaultdict(set), {}, set()
        self.entries, self.old, self.aliases, self.accepted = {}, {}, {}, set()
        self.asset_cache, self.oembed_cache = {}, {}
        self.pending_sitemaps, self.imported = set(), set()

    def exclude(self, url, reason, **extra):
        self.report.add("excluded", url=url, reason=reason, **extra)

    def limit(self, url, reason, option, value):
        self.report.partial = True
        limits = self.report.counts.setdefault("crawl_limits", {})
        record = limits.setdefault(option, {"limit": value, "excluded": 0})
        if self.report.add("excluded", url=url, reason=reason):
            record["excluded"] += 1
            if record["excluded"] == 1:
                self.report.warning(f"{reason} reached ({option}={value}) at {url}; increase {option} for complete discovery.")

    def entry(self, url):
        if url not in self.entries:
            self.entries[url] = Entry(url, self.old.get(url, Entry(url)).lastmod)
        return self.entries[url]

    def enqueue(self, url, depth=0):
        if not url:
            return
        url = public_url(url)
        if not url or not on_site(url):
            if url:
                self.exclude(url, "outside target host")
            return
        canonical = self.repository.canonical_content_url(url)
        if canonical != url:
            self.aliases[url] = canonical
            url = canonical
        published_sitemap = sitemap_only_project(url)
        if published_sitemap:
            if not self.offline and published_sitemap not in self.sitemap_seen:
                self.pending_sitemaps.add(published_sitemap)
            return
        if self.repository.protected(url):
            self.exclude(url, "protected page or protected source")
            return
        parts = urlsplit(url)
        suffix = Path(parts.path).suffix.lower()
        if suffix in SOURCE_SUFFIXES or any(part.startswith(".") or part.lower() in INTERNAL_PARTS for part in parts.path.split("/") if part):
            self.exclude(url, "internal/development/source file")
            return
        if Path(parts.path).name in ("template.html", "404.html") or parts.path.startswith("/google") and suffix == ".html":
            self.exclude(url, "template, error or verification page")
            return
        if parts.path in ("/talks/slide.html", "/classes/course.html", "/classes/slide.html") and not parts.query:
            self.exclude(url, "viewer without content")
            return
        if suffix in IMAGE_SUFFIXES | FILE_SUFFIXES:
            # Standalone media belongs to a parent page (or the file report).
            self.record_file(None, url, "linked media/file", None)
            return
        if url in self.scheduled:
            return
        if depth > self.max_depth:
            self.limit(url, "crawl depth limit", "--max-depth", self.max_depth)
            return
        key = (parts.netloc, parts.path)
        if parts.query and len(self.variants[key]) >= self.max_query_variants:
            self.limit(url, "query variant limit", "--max-query-variants", self.max_query_variants)
            return
        if parts.query:
            self.variants[key].add(parts.query)
        # Bound the queue too, so a huge sitemap cannot consume unbounded memory.
        if len(self.scheduled) >= self.max_pages:
            self.limit(url, "page limit", "--max-pages", self.max_pages)
            return
        self.scheduled.add(url)
        self.queue.append((url, depth))

    def robots(self, url):
        parts = urlsplit(url)
        origin = urlunsplit((parts.scheme, parts.netloc, "", "", ""))
        if origin in self.robots_cache:
            return self.robots_cache[origin]
        target = origin + "/robots.txt"
        try:
            if self.offline:
                path = self.repository.root / "robots.txt"
                text = path.read_text() if on_site(url) and path.exists() else ""
            else:
                response = self.fetch(target, check_robots=False, site_only=False)
                if response.status == 200:
                    text = response.text
                elif 400 <= response.status < 500 and response.status != 429:
                    # RFC 9309 section 2.3.1.3 permits crawling when robots.txt
                    # is unavailable (4xx). Rate limits remain transient failures.
                    text = ""
                    if response.status != 404:
                        self.report.warning(f"{target}: robots.txt HTTP {response.status}; unavailable, continuing without robots rules.")
                else:
                    raise DiscoveryError(f"robots.txt HTTP {response.status}; access unknown")
            rules = Robots(text)
        except DiscoveryError as exc:
            self.report.error(target, exc)
            rules = Robots("User-agent: *\nDisallow: /")
        self.robots_cache[origin] = rules
        return rules

    def fetch(self, url, method="GET", check_robots=True, site_only=True):
        for _ in range(10):
            if site_only and not on_site(url):
                raise DiscoveryError(f"Redirect leaves target host: {url}")
            if self.repository.protected(url) and on_site(url):
                raise DiscoveryError(f"Protected redirect target: {url}")
            if check_robots and not self.robots(url).allows(url):
                raise DiscoveryError(f"robots.txt disallows {url}")
            if self.offline:
                response = self.repository.local_response(url, method)
                if response is None:
                    raise DiscoveryError(f"Not available in offline publication: {url}")
            else:
                response = self.client.request(url, method=method)
            if response.status in (301, 302, 303, 307, 308) and response.headers.get("location"):
                redirected = public_url(response.headers["location"], url)
                if not redirected:
                    raise DiscoveryError(f"Invalid redirect from {url}")
                self.report.add("associations", page=url, canonical=redirected, reason="HTTP redirect")
                self.aliases[url] = redirected
                url = redirected
                continue
            return response
        raise DiscoveryError(f"Redirect limit: {url}")

    def load_existing(self, path, seen=None):
        seen = seen if seen is not None else set()
        path = Path(path).resolve()
        if path in seen or not path.exists():
            return
        if len(seen) >= self.max_sitemaps:
            self.report.error(path, "Existing sitemap index limit")
            return
        seen.add(path)
        try:
            kind, records = parse_sitemap(path.read_bytes())
            for loc, lastmod, images, videos in records:
                loc = public_url(loc)
                if not loc or not on_site(loc):
                    continue
                if kind != "sitemapindex":
                    loc = self.repository.canonical_content_url(loc)
                if kind == "sitemapindex":
                    child = self.repository.root / urlsplit(loc).path.lstrip("/")
                    if child.resolve().is_relative_to(self.repository.root.resolve()):
                        if child.exists():
                            self.load_existing(child, seen)
                        else:
                            self.report.error(child, "Existing sitemap index references a missing child")
                    else:
                        self.report.error(path, "Existing sitemap index path escapes repository")
                else:
                    old = self.old.setdefault(loc, Entry(loc))
                    old.lastmod = old.lastmod or lastmod
                    old.images.update(images)
                    for video in videos:
                        identity = video_identity(video.get("content_loc") or video.get("player_loc") or "")
                        if identity:
                            old.videos[identity] = video
                    self.enqueue(loc)
        except (OSError, ET.ParseError, DiscoveryError) as exc:
            self.report.error(path, exc)

    def sitemap(self, url, optional=False, project=None):
        url = public_url(url)
        self.pending_sitemaps.discard(url)
        if not url or not on_site(url) or url in self.sitemap_seen:
            return
        project = project or sitemap_only_project(url)
        if len(self.sitemap_seen) >= self.max_sitemaps:
            self.report.error(url, "Sitemap discovery limit")
            return
        self.sitemap_seen.add(url)
        LOG.info("Sitemap: %s (%s)", url, "import without crawling pages" if project else "discover crawl URLs")
        if not self.robots(url).allows(url):
            self.exclude(url, "robots.txt disallows sitemap")
            return
        try:
            response = self.fetch(url)
            if response.status == 404 and optional:
                return
            if response.status != 200:
                raise DiscoveryError(f"Sitemap HTTP {response.status}")
            kind, records = parse_sitemap(response.body)
            for loc, lastmod, images, videos in records:
                loc = public_url(loc, url)
                if not loc or not on_site(loc):
                    if loc:
                        self.exclude(loc, "sitemap URL outside target host")
                    continue
                if kind != "sitemapindex" and not project:
                    loc = self.repository.canonical_content_url(loc)
                if kind == "sitemapindex":
                    self.sitemap(loc, project=project)
                elif project:
                    if sitemap_only_project(loc) != project:
                        self.exclude(loc, "published sitemap URL outside project")
                        continue
                    # Awesome-Pd already publishes its page inventory. Import it
                    # directly, including media, without page/asset HTTP checks.
                    entry = self.entry(loc)
                    entry.lastmod = entry.lastmod or lastmod
                    entry.images.update(image for value in images if (image := public_url(value, url)))
                    for video in videos:
                        metadata = dict(video)
                        for key in ("content_loc", "player_loc", "thumbnail_loc"):
                            if metadata.get(key):
                                metadata[key] = public_url(metadata[key], url)
                        identity = video_identity(metadata.get("content_loc") or metadata.get("player_loc") or "")
                        if identity:
                            entry.videos.setdefault(identity, metadata)
                    self.accepted.add(loc)
                    self.imported.add(loc)
                else:
                    # Do not let published stale data overwrite an already valid lastmod.
                    old = self.old.setdefault(loc, Entry(loc))
                    old.lastmod = old.lastmod or lastmod
                    old.images.update(images)
                    for video in videos:
                        identity = video_identity(video.get("content_loc") or video.get("player_loc") or "")
                        if identity:
                            old.videos.setdefault(identity, video)
                    self.enqueue(loc)
            if project:
                LOG.info("Sitemap imported: %s; %d project URLs retained without crawling", url, len(self.imported))
        except (DiscoveryError, ET.ParseError, OSError) as exc:
            self.report.error(url, exc)

    def seed(self, sites):
        for site in sites:
            LOG.info("Seed: %s", site)
            published_sitemap = sitemap_only_project(site)
            if published_sitemap:
                if not self.offline:
                    self.sitemap(published_sitemap)
                continue
            self.enqueue(site)
            if self.offline:
                continue
            for sitemap in self.robots(site).sitemaps:
                self.sitemap(public_url(sitemap, site))
            self.sitemap(public_url("sitemap.xml", site), optional=True)

    def asset(self, url):
        if not url:
            return None
        if url in self.asset_cache:
            return self.asset_cache[url]
        result = None
        try:
            if self.offline and not on_site(url):
                # No assertion of publication for unverified external files.
                self.exclude(url, "external media not verified offline")
            elif not self.robots(url).allows(url):
                self.exclude(url, "robots.txt disallows media")
            else:
                response = self.fetch(url, method="HEAD", site_only=False)
                if response.status == 200 and not re.search(r"\b(noindex|none)\b", response.headers.get("x-robots-tag", ""), re.I):
                    result = response.url
                elif response.status in (404, 410, 401, 403):
                    self.exclude(url, f"media HTTP {response.status}")
                else:
                    raise DiscoveryError(f"Media HTTP {response.status}")
        except DiscoveryError as exc:
            # Unpublished local references are reported; unavailable remote checks are partial.
            self.report.error(url, exc, partial=not self.offline)
        self.asset_cache[url] = result
        return result

    def record_file(self, page, url, kind, source):
        if not url:
            return
        checked = on_site(url) and self.asset(url)
        self.report.add("files", page=page, url=url, kind=kind, source=source,
                        publication="verified" if checked else "referenced; not verified")

    def oembed(self, url):
        identity = video_identity(url)
        if not identity or identity[0] == "local" or self.offline:
            return {}
        if identity in self.oembed_cache:
            return self.oembed_cache[identity]
        provider, identifier = identity
        if provider == "youtube":
            watch = "https://www.youtube.com/watch?v=" + identifier
            endpoint = "https://www.youtube.com/oembed?" + urlencode({"url": watch, "format": "json"})
        else:
            number, _, token = identifier.partition(":")
            watch = "https://vimeo.com/" + number + ("/" + token if token else "")
            endpoint = "https://vimeo.com/api/oembed.json?" + urlencode({"url": watch})
        metadata = {}
        try:
            # oEmbed is a metadata API, not page crawling. Restrict every redirect to the provider.
            current = endpoint
            for _ in range(5):
                if urlsplit(current).hostname not in ("www.youtube.com", "youtube.com", "vimeo.com", "www.vimeo.com"):
                    raise DiscoveryError("oEmbed redirect leaves provider")
                response = self.client.request(current)
                if response.status in (301, 302, 307, 308):
                    current = public_url(response.headers.get("location"), current)
                    if not current:
                        raise DiscoveryError("Invalid oEmbed redirect")
                    continue
                if response.status != 200:
                    raise DiscoveryError(f"oEmbed HTTP {response.status}")
                metadata = json.loads(response.text)
                if not isinstance(metadata, dict):
                    raise DiscoveryError("Invalid oEmbed response")
                break
            else:
                raise DiscoveryError("oEmbed redirect limit")
        except (DiscoveryError, ValueError) as exc:
            self.report.error(endpoint, exc, partial=False)
        self.oembed_cache[identity] = metadata
        return metadata

    def add_video(self, page, candidate, source):
        url = candidate.get("url")
        identity = video_identity(url or "")
        if not identity:
            if url:
                self.report.add("missing_metadata", source=candidate.get("source", source), page=page,
                                video=url, missing=["recognized video/player URL"])
            return
        if candidate.get("decorative"):
            self.exclude(url, "decorative video", page=page)
            return
        old = self.old.get(self.aliases.get(page, page), Entry(page)).videos.get(identity, {})
        # Metadata from the same demonstrated recording can be reused when an
        # HTML presentation embeds it, with provenance retained in the report.
        for route in self.repository.routes.values():
            for existing in route.get("videos", []):
                if video_identity(existing.get("url", "")) == identity:
                    for key in ("thumbnail_loc", "title", "description", "publication_date"):
                        if not candidate.get(key) or candidate.get(key) == "YouTube video player":
                            candidate[key] = existing.get(key)
                    self.report.add("associations", page=page, video=url, metadata_source=existing.get("source"))
        metadata = {key: candidate.get(key) or old.get(key) for key in
                    ("thumbnail_loc", "title", "description", "publication_date", "duration")}
        if metadata["title"] in ("YouTube video player", "Vimeo video player"):
            metadata["title"] = None
        if any(not metadata[key] for key in ("thumbnail_loc", "title", "description")):
            external = self.oembed(url)
            for field_name, oembed_key in (("title", "title"), ("thumbnail_loc", "thumbnail_url"), ("description", "description")):
                metadata[field_name] = metadata[field_name] or external.get(oembed_key)
            # Do not infer description, upload date or duration from author/year.
        metadata["title"] = plain_text(metadata["title"])[:100]
        metadata["description"] = plain_text(metadata["description"])[:2048]
        metadata["thumbnail_loc"] = self.asset(public_url(metadata["thumbnail_loc"], page))
        if identity[0] == "local":
            metadata["content_loc"] = self.asset(url)
        else:
            metadata["player_loc"] = url
        if not valid_lastmod(metadata.get("publication_date")):
            metadata.pop("publication_date", None)
        duration = str(metadata.get("duration") or "")
        if not duration.isdigit() or not 1 <= int(duration) <= 28800:
            metadata.pop("duration", None)
        missing = [key for key in ("thumbnail_loc", "title", "description") if not metadata.get(key)]
        if not metadata.get("content_loc") and not metadata.get("player_loc"):
            missing.append("content_loc or player_loc")
        origin = candidate.get("source", source)
        self.report.add("associations", source=origin, page=page, video=url)
        if missing:
            self.report.add("missing_metadata", source=origin, page=page, video=url, missing=missing)
            return
        self.entry(page).videos.setdefault(identity, {key: value for key, value in metadata.items() if value})

    def displayed_markdown(self, html, source):
        for item in html.markdown:
            try:
                if isinstance(item, tuple):
                    text, base = item
                else:
                    base = item
                    response = self.fetch(item)
                    if response.status != 200:
                        raise DiscoveryError(f"Displayed Markdown HTTP {response.status}")
                    text = response.text
                if '"staticrypt-markdown"' in text:
                    html.protected = True
                    continue
                extra = PageHTML(markdown_html(text), base)
                for key in ("images", "links", "videos", "files"):
                    getattr(html, key).extend(getattr(extra, key))
            except DiscoveryError as exc:
                self.report.error(source, exc)

    def crawl(self):
        while self.queue or self.pending_sitemaps:
            while self.pending_sitemaps:
                self.sitemap(min(self.pending_sitemaps))
            if not self.queue:
                break
            requested, depth = self.queue.popleft()
            if requested in self.visited:
                continue
            self.visited.add(requested)
            LOG.info("Crawl [%d/%d, %d queued]: %s", len(self.visited), self.max_pages, len(self.queue), requested)
            if not self.robots(requested).allows(requested):
                self.exclude(requested, "robots.txt disallows page")
                continue
            if self.offline and not self.repository.local_response(requested):
                self.exclude(requested, "project or route not available offline")
                self.report.partial = True
                continue
            try:
                method = "HEAD" if urlsplit(requested).path.lower().endswith(".pdf") else "GET"
                response = self.fetch(requested, method=method)
                url = response.url
                if response.status in (401, 403, 404, 410):
                    self.exclude(requested, f"page HTTP {response.status}")
                    if response.status in (401, 403):
                        self.report.error(requested, f"Page access denied (HTTP {response.status})")
                    continue
                if response.status != 200:
                    raise DiscoveryError(f"Page HTTP {response.status}")
                if re.search(r"\b(noindex|none)\b", response.headers.get("x-robots-tag", ""), re.I):
                    self.exclude(url, "X-Robots-Tag noindex")
                    continue
                if "application/pdf" in response.headers.get("content-type", "") or method == "HEAD":
                    canonical = re.search(r'<([^>]+)>;\s*rel=["\']?canonical', response.headers.get("link", ""), re.I)
                    if canonical:
                        target = public_url(canonical[1], url)
                        if target and target != url:
                            self.aliases[url] = target
                            self.enqueue(target, depth)
                    self.entry(url)
                    self.accepted.add(url)
                    continue
                if "html" not in response.headers.get("content-type", "") and not response.text.lstrip().lower().startswith(("<!doctype html", "<html")):
                    self.record_file(None, url, "other public file", requested)
                    continue
                html = PageHTML(response.text, url)
                if html.noindex or html.protected:
                    self.exclude(url, "noindex" if html.noindex else "password-protected HTML")
                    continue
                self.repository.adapters(url, html, self)
                self.repository.augment(url, html)
                self.repository.rendered_code_images(html)
                self.displayed_markdown(html, url)
                if html.noindex or html.protected:
                    self.exclude(url, "noindex" if html.noindex else "password-protected HTML or Markdown")
                    continue
                canonical = html.canonical
                header_canonical = re.search(r'<([^>]+)>;\s*rel=["\']?canonical', response.headers.get("link", ""), re.I)
                if header_canonical:
                    canonical = public_url(header_canonical[1], url)
                if canonical and canonical != url:
                    self.aliases[url] = canonical
                    self.report.add("associations", page=url, canonical=canonical, reason="rel=canonical")
                    self.enqueue(canonical, depth)
                self.accepted.add(url)
                entry = self.entry(url)
                for image in html.images:
                    if useful_image(image):
                        published = self.asset(image)
                        if published:
                            entry.images.add(published)
                source_path = self.repository.path(url)
                local_source = str(source_path.relative_to(self.repository.root)) if source_path and source_path.is_relative_to(self.repository.root) else url
                source = self.repository.routes.get(url, {}).get("source", local_source)
                for metadata in structured_videos(html.structured):
                    identity = video_identity(metadata.get("contentUrl") or metadata.get("embedUrl") or "")
                    if not identity:
                        continue
                    for candidate in html.videos:
                        if video_identity(candidate.get("url") or "") == identity:
                            mapping = {"title": "name", "description": "description", "thumbnail_loc": "thumbnailUrl",
                                       "publication_date": "uploadDate"}
                            for key, json_key in mapping.items():
                                value = metadata.get(json_key)
                                if isinstance(value, list):
                                    value = value[0] if value else None
                                if isinstance(value, str) and (not candidate.get(key) or candidate.get(key) == "YouTube video player"):
                                    candidate[key] = value
                for candidate in html.videos:
                    self.add_video(url, candidate, source)
                # Public project sitemaps can describe media injected by their JS.
                # Main-repo media must instead be demonstrated by its actual renderer.
                if not self.repository.path(url):
                    old = self.old.get(url, Entry(url))
                    for image in old.images:
                        published = self.asset(image)
                        if published and useful_image(published):
                            entry.images.add(published)
                    for video in old.videos.values():
                        self.add_video(url, {**video, "url": video.get("content_loc") or video.get("player_loc")}, "published sitemap")
                for file_url, kind in html.files:
                    self.record_file(url, file_url, kind, source)
                for link in html.links:
                    if link and Path(urlsplit(link).path).suffix.lower() in FILE_SUFFIXES:
                        self.record_file(url, link, "linked public file", source)
                    else:
                        self.enqueue(link, depth + 1)
            except (DiscoveryError, OSError, ValueError, KeyError, TypeError) as exc:
                self.report.error(requested, exc)
        return self.final_entries()

    def final_entries(self):
        result = {}
        for loc, entry in self.entries.items():
            target, seen = loc, set()
            while target in self.aliases and target not in seen:
                seen.add(target)
                target = self.aliases[target]
            if target in seen:
                self.report.error(loc, "Canonical/redirect cycle")
                continue
            if target not in self.accepted or not on_site(target) or self.repository.protected(target):
                self.exclude(loc, "canonical destination is not a verified indexable page")
                continue
            merged = result.setdefault(target, Entry(target, self.old.get(target, Entry(target)).lastmod))
            merged.lastmod = merged.lastmod or (entry.lastmod if loc == target else None)
            merged.images.update(entry.images)
            for identity, metadata in entry.videos.items():
                merged.videos.setdefault(identity, metadata)
        for entry in result.values():
            if len(entry.images) > 1000:
                self.report.error(entry.loc, "More than 1000 images on one page; image extension truncated")
                entry.images = set(sorted(entry.images)[:1000])
        self.report.counts.update({"pages": len(result), "pdfs": sum(urlsplit(url).path.lower().endswith(".pdf") for url in result),
                                  "image_associations": sum(len(entry.images) for entry in result.values()),
                                  "video_associations": sum(len(entry.videos) for entry in result.values()),
                                  "visited": len(self.visited), "sitemaps_read": len(self.sitemap_seen),
                                  "pages_imported_from_sitemaps": len(self.imported),
                                  "http_requests": self.client.requests, "cache_hits": self.client.cache_hits,
                                  "excluded": len(self.report.excluded), "errors": len(self.report.errors),
                                  "videos_missing_metadata": len(self.report.missing_metadata), "other_files": len(self.report.files)})
        return [result[key] for key in sorted(result)]


def xml_entry(entry):
    node = ET.Element(f"{{{NAMESPACE}}}url")
    ET.SubElement(node, f"{{{NAMESPACE}}}loc").text = entry.loc
    if valid_lastmod(entry.lastmod):
        ET.SubElement(node, f"{{{NAMESPACE}}}lastmod").text = entry.lastmod
    for url in sorted(entry.images):
        image = ET.SubElement(node, f"{{{IMAGE_NS}}}image")
        ET.SubElement(image, f"{{{IMAGE_NS}}}loc").text = url
    for identity, metadata in sorted(entry.videos.items()):
        video = ET.SubElement(node, f"{{{VIDEO_NS}}}video")
        for key in ("thumbnail_loc", "title", "description", "content_loc", "player_loc", "duration", "publication_date"):
            if metadata.get(key):
                ET.SubElement(video, f"{{{VIDEO_NS}}}{key}").text = str(metadata[key])
    return node


def xml_document(root):
    ET.indent(root, space="  ")
    data = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    ET.fromstring(data)  # reject invalid XML before replacing any file
    return data


def sitemap_documents(entries, output, max_urls=MAX_URLS, max_bytes=MAX_BYTES, root=REPOSITORY_ROOT):
    output = Path(output)
    chunks, current = [], []
    # Serialize each node once to avoid quadratic work near the 50k/50MiB limits.
    overhead = 400
    size = overhead
    for entry in entries:
        node = xml_entry(entry)
        ET.indent(node, space="  ", level=1)
        node_size = len(ET.tostring(node, encoding="utf-8")) + 100
        if node_size + overhead > max_bytes:
            raise DiscoveryError(f"Single sitemap entry exceeds byte limit: {entry.loc}")
        if current and (len(current) >= max_urls or size + node_size > max_bytes):
            chunks.append(current)
            current, size = [], overhead
        current.append(node)
        size += node_size
    chunks.append(current)
    documents = {}
    for index, chunk in enumerate(chunks):
        urlset = ET.Element(f"{{{NAMESPACE}}}urlset")
        urlset.extend(chunk)
        data = xml_document(urlset)
        if len(data) > max_bytes:
            raise DiscoveryError("Serialized sitemap exceeds byte limit")
        if len(chunks) == 1:
            documents[output] = data
        else:
            # Content-addressed child names leave the old index fully usable until
            # its atomic replacement; never overwrite children referenced by it.
            digest = hashlib.sha256(data).hexdigest()[:16]
            child = output.with_name(f"{output.stem}-{index + 1}-{digest}.xml")
            documents[child] = data
    if len(chunks) > 1:
        if len(chunks) > MAX_URLS:
            raise DiscoveryError("Sitemap index exceeds 50,000 child sitemaps")
        index = ET.Element(f"{{{NAMESPACE}}}sitemapindex")
        for path in documents:
            try:
                relative = path.resolve().relative_to(Path(root).resolve()).as_posix()
            except ValueError as exc:
                raise DiscoveryError("Split sitemaps must be written inside the published repository root") from exc
            node = ET.SubElement(index, f"{{{NAMESPACE}}}sitemap")
            ET.SubElement(node, f"{{{NAMESPACE}}}loc").text = public_url(relative)
        data = xml_document(index)
        if len(data) > MAX_BYTES:
            raise DiscoveryError("Sitemap index exceeds 50 MiB")
        documents[output] = data
    return documents


def write_documents(documents, output, report, allow_partial=False):
    if report.partial and not allow_partial:
        limits = "; ".join(f"{record['excluded']} URLs excluded by {option}={record['limit']}"
                           for option, record in report.counts.get("crawl_limits", {}).items())
        details = f"Crawl limits: {limits}. " if limits else ""
        raise DiscoveryError("Partial discovery: sitemap left intact. " + details +
                             "Review the report; --allow-partial explicitly permits replacement.")
    # The output/index is inserted last by sitemap_documents; all children exist
    # before readers see the new index. Existing child files are retained for backups.
    for path, data in documents.items():
        LOG.info("Write: %s (%d bytes)", path, len(data))
        atomic_write(path, data, backup=True)


def argument_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Generate/validate XML in memory, write only the report and cache")
    parser.add_argument("--quiet", action="store_true", help="Hide progress output; keep warnings, errors and the final JSON summary")
    parser.add_argument("--offline", action="store_true", help="Simulate the repository publication without gh/HTTP (always partial)")
    parser.add_argument("--allow-partial", action="store_true", help="Explicitly allow replacing the sitemap after incomplete discovery")
    parser.add_argument("--output", default="sitemap.xml", help="Output relative to repository root, regardless of cwd")
    parser.add_argument("--report", default=".cache/github-sites/report.json", help="Report relative to repository root")
    parser.add_argument("--cache-dir", default=".cache/github-sites/http")
    parser.add_argument("--build-dir", help="Published build directory relative to repository root (e.g. _site)")
    parser.add_argument("--max-pages", type=int, default=2000)
    parser.add_argument("--max-depth", type=int, default=8)
    parser.add_argument("--max-query-variants", type=int, default=50)
    parser.add_argument("--max-sitemaps", type=int, default=100)
    parser.add_argument("--max-requests", type=int, default=10000)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--gh-timeout", type=float, default=60, help="Timeout for entire paginated gh subprocess")
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--cache-ttl", type=int, default=86400, help="HTTP cache validity in seconds; 0 refreshes")
    return parser


def main(argv=None):
    parser = argument_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING if args.quiet else logging.INFO, format="%(message)s")
    if any(value < 1 for value in (args.max_pages, args.max_query_variants, args.max_sitemaps, args.max_requests)) or args.max_depth < 0:
        parser.error("Crawl limits must be positive (depth can be zero)")
    if args.timeout <= 0 or args.gh_timeout <= 0 or not 0 <= args.retries <= 5 or args.cache_ttl < 0:
        parser.error("Positive timeouts, 0–5 retries and nonnegative cache TTL required")
    resolve = lambda value: (REPOSITORY_ROOT / value).resolve()
    output, report_path = resolve(args.output), resolve(args.report)
    LOG.info("Start: %s; output=%s; max-pages=%d", "offline" if args.offline else "live", output, args.max_pages)
    if output == report_path:
        parser.error("Report and sitemap must use different paths")
    report = Report(partial=args.offline)
    if args.offline:
        report.warning("Offline simulation: external Pages, redirects and HTTP directives are not verified; result is partial.")
    client = HTTPClient(resolve(args.cache_dir), args.timeout, args.retries, args.cache_ttl, args.max_requests)
    content = RepositoryContent(REPOSITORY_ROOT, report, resolve(args.build_dir) if args.build_dir else None)
    crawler = Crawler(content, client, report, args.offline, args.max_pages, args.max_depth, args.max_query_variants, args.max_sitemaps)
    crawler.load_existing(output)
    # A custom output should still inherit the repository's canonical sitemap.
    if output != SITEMAP:
        crawler.load_existing(SITEMAP)
    try:
        for url in content.build_pages():
            crawler.enqueue(url)
        sites = [BASE_URL] if args.offline else discover_sites(report, args.gh_timeout, args.retries)
        crawler.seed(sites)
        entries = crawler.crawl()
        LOG.info("Crawl complete: %d pages, %d HTTP requests, %d cache hits; partial=%s",
                 len(entries), client.requests, client.cache_hits, report.partial)
        documents = sitemap_documents(entries, output)
        report.counts["xml_files"] = len(documents)
        report.counts["xml_bytes"] = sum(len(data) for data in documents.values())
        if not args.dry_run:
            write_documents(documents, output, report, args.allow_partial)
        else:
            LOG.info("Dry run: validated %d XML files (%d bytes)", len(documents), report.counts["xml_bytes"])
        report.counts["sitemap_written"] = not args.dry_run
    except (DiscoveryError, OSError, ValueError) as exc:
        report.error("generation", exc)
        report.counts["sitemap_written"] = False
    report.counts.update({"errors": len(report.errors), "excluded": len(report.excluded),
                          "videos_missing_metadata": len(report.missing_metadata)})
    LOG.info("Report: %s", report_path)
    atomic_write(report_path, (json.dumps(report.as_dict(), ensure_ascii=False, indent=2) + "\n").encode())
    print(json.dumps({"partial": report.partial, "counts": report.counts, "report": str(report_path)}, ensure_ascii=False, indent=2))
    return 2 if report.partial or report.counts.get("sitemap_written") is False and not args.dry_run else 0


if __name__ == "__main__":
    sys.exit(main())
