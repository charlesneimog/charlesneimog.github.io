"""Focused sitemap regressions; no GitHub credentials or network required."""

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET

SCRIPT = Path(__file__).with_name("github-sites.py")
spec = importlib.util.spec_from_file_location("github_sites", SCRIPT)
sites = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = sites
spec.loader.exec_module(sites)
ROOT = SCRIPT.parent.parent
BASE = sites.BASE_URL


class FixtureClient:
    def __init__(self, responses):
        self.responses = responses
        self.requests = self.cache_hits = 0
        self.calls = []

    def request(self, url, method="GET", **kwargs):
        self.requests += 1
        self.calls.append((url, method))
        value = self.responses.get((url, method), self.responses.get(url))
        if value is None:
            return sites.Response(url, 404, {})
        if isinstance(value, Exception):
            raise value
        return value


def response(url, text="", status=200, headers=None):
    return sites.Response(url, status, headers or {"content-type": "text/html"}, text.encode())


class SitemapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for directory in ("talks", "classes"):
            (self.root / directory).mkdir()
            (self.root / directory / (directory + ".json")).write_text("[]")
        self.report = sites.Report()
        self.repository = sites.RepositoryContent(self.root, self.report)

    def tearDown(self):
        self.tmp.cleanup()

    def crawler(self, responses=None, **kwargs):
        return sites.Crawler(self.repository, FixtureClient(responses or {}), self.report, **kwargs)

    def test_paginated_257_repositories_use_slurp_and_flatten(self):
        repositories = [{"name": str(index)} for index in range(257)]
        result = subprocess.CompletedProcess([], 0, json.dumps([repositories[:100], repositories[100:200], repositories[200:]]), "")
        with patch.object(sites.subprocess, "run", return_value=result) as run:
            data = sites.gh_api("user/repos?per_page=100&affiliation=owner", paginate=True)
        self.assertEqual(data, repositories)
        self.assertEqual(run.call_args.args[0], ["gh", "api", "--paginate", "--slurp", "user/repos?per_page=100&affiliation=owner"])
        self.assertGreater(run.call_args.kwargs["timeout"], 0)

    def test_malformed_pagination_fails_explicitly(self):
        with patch.object(sites.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, '[{"name":"flat"}]', "")):
            with self.assertRaisesRegex(sites.DiscoveryError, "array of pages"):
                sites.gh_api("user/repos", paginate=True)

    def test_pages_filter_and_real_urls_and_errors(self):
        repos = [{"name": "none", "has_pages": False, "owner": {"login": "owner"}},
                 {"name": "project", "has_pages": True, "owner": {"login": "owner"}},
                 {"name": "custom", "has_pages": True, "owner": {"login": "owner"}},
                 {"name": "forbidden", "has_pages": True, "owner": {"login": "owner"}}]
        def api(endpoint, **kwargs):
            if endpoint == "user":
                return {"login": "owner"}
            if endpoint.startswith("user/repos"):
                self.assertTrue(kwargs["paginate"])
                return repos
            if endpoint.endswith("project/pages"):
                return {"html_url": BASE + "Actual-Case/", "public": True}
            if endpoint.endswith("custom/pages"):
                return {"html_url": "https://custom.test/"}
            raise sites.DiscoveryError("HTTP 403: permission denied")
        with patch.object(sites, "gh_api", side_effect=api) as api_mock:
            found = sites.discover_sites(self.report)
        self.assertEqual(found, sorted([BASE, BASE + "Actual-Case/"]))
        self.assertFalse(any("none/pages" in call.args[0] for call in api_mock.call_args_list))
        self.assertTrue(self.report.partial)
        self.assertIn("403", self.report.errors[0]["message"])

    def test_api_auth_permissions_and_rate_limits_do_not_retry_as_absence(self):
        for message in ("HTTP 401: Bad credentials", "HTTP 403: permission denied", "HTTP 429: API rate limit exceeded", "HTTP 404: Not Found"):
            with self.subTest(message=message), patch.object(sites.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["gh"], stderr=message)) as run:
                with self.assertRaisesRegex(sites.DiscoveryError, "HTTP"):
                    sites.gh_api("repos/a/b/pages")
                self.assertEqual(run.call_count, 1)

    def test_urls_preserve_case_parameters_and_slashes(self):
        url = sites.public_url("../Score/A B.pdf?work=X&edition=2#page=3", BASE + "Project/docs/topic.html")
        self.assertEqual(url, BASE + "Project/Score/A%20B.pdf?work=X&edition=2")
        self.assertNotEqual(sites.public_url("Project"), sites.public_url("Project/"))
        self.assertNotEqual(sites.public_url("Project/?id=1"), sites.public_url("Project/?id=2"))
        self.assertIsNone(sites.public_url("javascript:alert(1)"))
        self.assertFalse(sites.on_site("https://charlesneimog.github.io.evil.test/"))

    def test_literal_percent_is_encoded_without_double_encoding_escapes(self):
        for value, expected in (("metro-dev%/", "metro-dev%25/"),
                                ("metro-dev%25/", "metro-dev%25/"),
                                ("%/%2/%zz/", "%25/%252/%25zz/"),
                                ("%2f/C%C3%A2nticos/?rate=50%&name=A%20B&raw=%GG", "%2f/C%C3%A2nticos/?rate=50%25&name=A%20B&raw=%25GG")):
            with self.subTest(value=value):
                normalized = sites.public_url(value)
                self.assertEqual(normalized, BASE + expected)
                self.assertEqual(sites.public_url(normalized), normalized)

    def test_crawler_fetches_percent_named_page_with_encoded_url(self):
        project = BASE + "Project/"
        encoded = project + "objects/stochastic___probabilistic/metro-dev%25/"
        crawler = self.crawler({project: response(project, '<a href="objects/stochastic___probabilistic/metro-dev%/">Object</a>'),
                                encoded: response(encoded)})
        crawler.enqueue(project)
        self.assertEqual({entry.loc for entry in crawler.crawl()}, {project, encoded})
        self.assertIn((encoded, "GET"), crawler.client.calls)
        self.assertFalse(self.report.partial)

    def test_output_and_dry_run_work_from_another_cwd(self):
        output = self.root / "sitemap.xml"
        output.write_bytes(b"original sitemap")
        report = self.root / "report.json"
        result = subprocess.run([sys.executable, str(SCRIPT), "--offline", "--dry-run", "--report", str(report)],
                                cwd=self.root, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2, result.stderr)  # explicit offline/partial status
        self.assertIn("Start: offline", result.stderr)
        self.assertIn("Crawl [", result.stderr)
        self.assertIn("Crawl complete:", result.stderr)
        self.assertTrue(json.loads(result.stdout)["partial"])
        self.assertEqual(output.read_bytes(), b"original sitemap")
        self.assertTrue(report.is_file())
        self.assertFalse(json.loads(report.read_text())["counts"]["sitemap_written"])
        self.assertEqual(sites.SITEMAP, ROOT / "sitemap.xml")

        quiet = subprocess.run([sys.executable, str(SCRIPT), "--offline", "--dry-run", "--quiet", "--report", str(report)],
                               cwd=self.root, capture_output=True, text=True)
        self.assertEqual(quiet.returncode, 2, quiet.stderr)
        self.assertNotIn("Crawl [", quiet.stderr)
        self.assertIn("WARNING: Offline simulation", quiet.stderr)
        self.assertTrue(json.loads(quiet.stdout)["partial"])

    def test_real_jsons_generate_rendered_routes_and_video_associations(self):
        report = sites.Report()
        content = sites.RepositoryContent(ROOT, report)
        crawler = sites.Crawler(content, FixtureClient({}), report, offline=True)
        crawler.enqueue(BASE)
        entries = {entry.loc: entry for entry in crawler.crawl()}
        music = json.loads((ROOT / "json/music.json").read_text())
        youtube = [item for item in music if item.get("iframe", {}).get("source") == "youtube"]
        self.assertFalse(entries[BASE].videos)
        for item in youtube:
            identity = sites.video_identity(item["iframe"]["link"])
            page = BASE + "?music=" + item["slug"]
            self.assertEqual(entries[page].videos[identity]["title"], item["title"])
            self.assertIn(BASE + item["image"], entries[page].images)
        self.assertEqual(sum("?music=" in loc for loc in entries), len(music))
        pandemonio = next(item for item in music if item["title"] == "Pandemônio")
        route = next((route for route in content.routes.values() if route.get("images") == [pandemonio["image"], *pandemonio["images"][:4]]), None)
        self.assertIsNotNone(route)
        self.assertEqual(route["videos"], [])  # YouTube link is not an embedded video
        self.assertTrue(any(record.get("kind") == "audio embed" for record in report.files))
        self.assertTrue(any("?music=canticos-de-silicio-I" in record.get("page", "") for record in report.associations))
        self.assertTrue(any("/talks/2026-10-Knob/slide.md" in record.get("source", "") or record.get("source") == "talks/2026-10-Knob/slide.md" for record in report.missing_metadata))
        self.assertFalse(any("/blog/pd-upic" in urlsplit(loc).path for loc in entries))
        self.assertFalse(any(urlsplit(loc).path.endswith((".md", ".json")) for loc in entries))
        self.assertIn(BASE + "scores/metamorfose+bula.pdf", entries)

    @unittest.skipUnless(shutil.which("node"), "Node needed to compare with the site's real JS renderer")
    def test_routes_match_real_javascript_functions(self):
        source = (ROOT / "js/sections.js").read_text()
        start = source.index("function slugifyMusicTitle(")
        function = source[start:source.index("\n}", start) + 2]
        titles = [item["title"] for item in json.loads((ROOT / "json/music.json").read_text())]
        program = "const ContentURLs = require(" + json.dumps(str(ROOT / "js/content-urls.js")) + ");\n" + function + "\nconsole.log(JSON.stringify(" + json.dumps(titles) + ".map(slugifyMusicTitle)));"
        expected = json.loads(subprocess.run(["node", "-e", program], text=True, capture_output=True, check=True).stdout)
        html = sites.PageHTML((ROOT / "index.html").read_text(), BASE)
        content = sites.RepositoryContent(ROOT, self.report)
        crawler = sites.Crawler(content, FixtureClient({}), self.report, offline=True)
        content.adapters(BASE, html, crawler)
        for slug in expected:
            self.assertIn(BASE + "?music=" + slug, content.routes)
        talks = (ROOT / "js/talks.js").read_text()
        start = talks.index("function getTalkLink(")
        function = talks[start:talks.index("\n}", start) + 2]
        program = 'global.window={location:{href:"' + BASE + 'talks/",origin:"' + BASE.rstrip("/") + '"}};\n' + function + '\nconsole.log(getTalkLink("./2026-10-Knob"));'
        expected_viewer = subprocess.run(["node", "-e", program], text=True, capture_output=True, check=True).stdout.strip()
        html = sites.PageHTML((ROOT / "talks/index.html").read_text(), BASE + "talks/")
        content.adapters(BASE + "talks/", html, crawler)
        self.assertIn(expected_viewer, content.routes)

    def test_protected_sources_and_viewers_are_not_queued(self):
        report = sites.Report()
        repository = sites.RepositoryContent(ROOT, report)
        crawler = sites.Crawler(repository, FixtureClient({}), report, offline=True)
        for url in (BASE + "talks/2026-05-Nusom/slide.md", BASE + "talks/2026-05-Nusom/index.html",
                    BASE + "talks/slide.html?talk=%2Ftalks%2F2026-05-Nusom", BASE + "classes/2026/SI-Percepção-II/aula9.md",
                    BASE + "classes/slide.html?course=2026%2FSI-Percepção-II&md=aula9.md"):
            crawler.enqueue(url)
        self.assertEqual(len(crawler.queue), 0)
        self.assertEqual(len(report.excluded), 5)

    def test_html_images_srcset_lazy_hidden_and_decorative_video(self):
        html = sites.PageHTML('''<base href="/Project/sub/">
          <img data-src="photo.jpg" srcset="photo-small.jpg 1x, photo-large.jpg 2x">
          <picture><source data-srcset="photo.avif 600w"></picture>
          <img src="placeholder.png"><img src="icon.svg" width="16">
          <img src="hidden.jpg" hidden><div hidden><div><img src="secret.jpg"></div></div>
          <div role="img" style="background-image:url('../art.jpg')"></div>
          <video autoplay muted loop src="background.mp4"></video>
          <video controls poster="poster.jpg" title="Work" data-description="Actual recording"><source src="work.mp4"></video>
          <iframe data-src="https://player.vimeo.com/video/123?h=private"></iframe>
          <a href="https://youtu.be/NO0qqwnb-lk">Linked, not displayed</a>''', BASE)
        self.assertEqual(set(html.images), {BASE + "Project/sub/photo.jpg", BASE + "Project/sub/photo-small.jpg",
                                           BASE + "Project/sub/photo-large.jpg", BASE + "Project/sub/photo.avif", BASE + "Project/art.jpg"})
        self.assertEqual(len(html.videos), 3)
        self.assertTrue(html.videos[0]["decorative"])
        self.assertEqual(html.videos[1]["url"], BASE + "Project/sub/work.mp4")
        self.assertEqual(sites.video_identity(html.videos[2]["url"]), ("vimeo", "123:private"))

    def test_lazy_placeholder_and_data_uri_srcset(self):
        html = sites.PageHTML('<img src="placeholder.jpg" data-original="actual.jpg" srcset="data:image/png;base64,AAAA 1x, actual-2.jpg 2x">', BASE + "Project/")
        self.assertEqual(set(html.images), {BASE + "Project/actual.jpg", BASE + "Project/actual-2.jpg"})

    def test_structured_metadata_only_enriches_presented_video(self):
        thumbnail = BASE + "poster.jpg"
        metadata = {"@type": "VideoObject", "name": "Actual title", "description": "Actual description",
                    "thumbnailUrl": thumbnail, "embedUrl": "https://www.youtube.com/embed/NO0qqwnb-lk"}
        text = '<script type="application/ld+json">' + json.dumps(metadata) + '</script>'
        crawler = self.crawler({BASE: response(BASE, text), thumbnail: response(thumbnail)})
        crawler.enqueue(BASE)
        self.assertFalse(crawler.crawl()[0].videos)
        crawler = self.crawler({BASE: response(BASE, text + '<iframe src="https://www.youtube.com/embed/NO0qqwnb-lk" title="YouTube video player"></iframe>'),
                                thumbnail: response(thumbnail)})
        crawler.enqueue(BASE)
        entries = crawler.crawl()
        self.assertEqual(next(iter(entries[0].videos.values()))["description"], "Actual description")

    def test_http_cache_retries_and_failure_expiry(self):
        from io import BytesIO
        class Stream(BytesIO):
            def __init__(self, status):
                super().__init__(b"body")
                self.code = status
                self.headers = {"Content-Type": "text/plain"}
        opener = unittest.mock.Mock()
        opener.open.side_effect = [Stream(503), Stream(200)]
        cache = self.root / "cache"
        with self.assertLogs(sites.LOG, level="INFO") as logs, patch.object(sites, "build_opener", return_value=opener), patch.object(sites.time, "sleep"):
            client = sites.HTTPClient(cache, retries=1)
            self.assertEqual(client.request(BASE).status, 200)
            self.assertEqual(client.requests, 2)
            cached_client = sites.HTTPClient(cache, retries=1)
            self.assertEqual(cached_client.request(BASE).body, b"body")
            self.assertEqual(cached_client.requests, 0)
            self.assertEqual(cached_client.cache_hits, 1)
        self.assertEqual(opener.open.call_count, 2)
        output = "\n".join(logs.output)
        self.assertIn("HTTP [1/10000]: GET " + BASE + " (attempt 1/2)", output)
        self.assertIn("-> 503", output)
        self.assertIn("retrying in 1s", output)
        self.assertIn("-> 200", output)
        self.assertIn("Cache: GET " + BASE + " -> HTTP 200", output)
        opener.open.side_effect = [Stream(429)]
        with patch.object(sites, "build_opener", return_value=opener), patch.object(sites.time, "sleep"):
            client = sites.HTTPClient(cache, retries=0)
            self.assertEqual(client.request(BASE + "failure").status, 429)
        cache_file = next(path for path in cache.glob("*.json") if json.loads(path.read_text())["status"] == 429)
        record = json.loads(cache_file.read_text())
        record["cached_at"] -= 301
        cache_file.write_text(json.dumps(record))
        opener.open.side_effect = [Stream(200)]
        with patch.object(sites, "build_opener", return_value=opener):
            self.assertEqual(sites.HTTPClient(cache, retries=0).request(BASE + "failure").status, 200)

    def test_atomic_replacement_failure_preserves_old_xml(self):
        path = self.root / "sitemap.xml"
        path.write_bytes(b"old")
        replace = sites.os.replace
        def fail_final(source, target):
            if target == path:
                raise OSError("injected replacement failure")
            return replace(source, target)
        with patch.object(sites.os, "replace", side_effect=fail_final):
            with self.assertRaises(OSError):
                sites.atomic_write(path, b"new", backup=True)
        self.assertEqual(path.read_bytes(), b"old")
        self.assertEqual(path.with_name("sitemap.xml.bak").read_bytes(), b"old")
        self.assertFalse(list(self.root.glob(".sitemap.xml.*")))

    def test_existing_valid_lastmod_wins_and_bad_values_are_omitted(self):
        output = self.root / "sitemap.xml"
        output.write_bytes(sites.sitemap_documents([sites.Entry(BASE, "2024-06-01")], output)[output])
        published = BASE + "sitemap.xml"
        text = '<urlset xmlns="' + sites.NAMESPACE + '"><url><loc>' + BASE + '</loc><lastmod>2025-06-01</lastmod></url><url><loc>' + BASE + 'bad</loc><lastmod>invalid</lastmod></url></urlset>'
        crawler = self.crawler({published: response(published, text), BASE: response(BASE), BASE + "bad": response(BASE + "bad")})
        crawler.load_existing(output)
        crawler.sitemap(published)
        entries = {entry.loc: entry for entry in crawler.crawl()}
        self.assertEqual(entries[BASE].lastmod, "2024-06-01")
        self.assertIsNone(entries[BASE + "bad"].lastmod)

    def test_same_page_video_dedup_and_incomplete_metadata(self):
        crawler = self.crawler(offline=True)
        (self.root / "poster.jpg").write_bytes(b"image")
        candidate = {"url": "https://www.youtube.com/embed/NO0qqwnb-lk?start=3", "title": "Recording",
                     "description": "Existing description", "thumbnail_loc": BASE + "poster.jpg", "source": "json/music.json[0].iframe"}
        crawler.add_video(BASE, candidate.copy(), "ignored")
        candidate["url"] = "https://www.youtube-nocookie.com/embed/NO0qqwnb-lk?start=100"
        crawler.add_video(BASE, candidate, "ignored")
        self.assertEqual(len(crawler.entries[BASE].videos), 1)
        crawler.add_video(BASE, {"url": "https://player.vimeo.com/video/234", "title": "Work", "source": "actual.json[2]"}, "ignored")
        self.assertEqual(self.report.missing_metadata[0]["missing"], ["thumbnail_loc", "description"])
        self.assertEqual(self.report.missing_metadata[0]["source"], "actual.json[2]")

    def test_oembed_caches_and_does_not_invent_description(self):
        endpoint = "https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DNO0qqwnb-lk&format=json"
        thumbnail = "https://i.ytimg.com/thumb.jpg"
        crawler = self.crawler({endpoint: response(endpoint, json.dumps({"title": "Existing title", "thumbnail_url": thumbnail, "author_name": "Author"})),
                                thumbnail: response(thumbnail), "https://i.ytimg.com/robots.txt": response("https://i.ytimg.com/robots.txt", "")})
        crawler.add_video(BASE, {"url": "https://youtu.be/NO0qqwnb-lk", "source": "videos.json[1]"}, "ignored")
        crawler.add_video(BASE, {"url": "https://www.youtube.com/embed/NO0qqwnb-lk", "source": "videos.json[1]"}, "ignored")
        self.assertEqual(crawler.client.calls.count((endpoint, "GET")), 1)
        self.assertEqual(self.report.missing_metadata[0]["missing"], ["description"])
        self.assertFalse(crawler.entries)
        self.assertFalse(self.report.partial)

    def test_robots_wildcards_and_allow_longest_match(self):
        rules = sites.Robots("User-agent: *\nDisallow: /private/\nAllow: /private/public/\nDisallow: /*?download=*\nSitemap: " + BASE + "map.xml")
        self.assertFalse(rules.allows(BASE + "private/work/"))
        self.assertTrue(rules.allows(BASE + "private/public/work/"))
        self.assertFalse(rules.allows(BASE + "work/?download=1"))
        self.assertEqual(rules.sitemaps, [BASE + "map.xml"])
        rules = sites.Robots("User-agent: *\nDisallow: /Percepção/")
        self.assertFalse(rules.allows(sites.public_url("Percepção/aula.html")))

    def test_robots_4xx_is_unavailable_and_does_not_block_media(self):
        robots = "https://cdn.jsdelivr.net/robots.txt"
        image = "https://cdn.jsdelivr.net/gh/project/image.svg"
        for status in (400, 401, 403, 404, 410):
            with self.subTest(status=status):
                report = sites.Report()
                client = FixtureClient({robots: response(robots, status=status), image: response(image)})
                crawler = sites.Crawler(self.repository, client, report)
                self.assertEqual(crawler.asset(image), image)
                self.assertTrue(crawler.robots(image).allows(image))
                self.assertEqual(client.calls.count((robots, "GET")), 1)
                self.assertFalse(report.partial)
                self.assertFalse(report.errors)
                self.assertEqual(len(report.warnings), 0 if status == 404 else 1)

    def test_robots_rate_limit_and_server_failures_remain_partial(self):
        robots = BASE + "robots.txt"
        for failure in (response(robots, status=429), response(robots, status=500),
                        response(robots, status=503), sites.DiscoveryError("network timeout")):
            with self.subTest(failure=failure):
                report = sites.Report()
                crawler = sites.Crawler(self.repository, FixtureClient({robots: failure}), report)
                self.assertFalse(crawler.robots(BASE).allows(BASE))
                self.assertTrue(report.partial)
                self.assertEqual(len(report.errors), 1)

    def test_unavailable_robots_does_not_bypass_page_http_permissions(self):
        crawler = self.crawler({BASE + "robots.txt": response(BASE + "robots.txt", status=400),
                                BASE: response(BASE, status=403)})
        crawler.enqueue(BASE)
        self.assertEqual(crawler.crawl(), [])
        self.assertTrue(self.report.partial)
        self.assertIn("access denied", self.report.errors[0]["message"])

    def test_crawl_redirect_canonical_noindex_robots_and_content_queries(self):
        page = BASE + "Project/"
        responses = {BASE + "robots.txt": response(BASE + "robots.txt", "User-agent: *\nDisallow: /blocked"),
                     page: response(page, '<a href="old">old</a><a href="hidden">hidden</a><a href="blocked">blocked</a><a href="?work=A">A</a><a href="?work=B">B</a>'),
                     BASE + "Project/old": response(BASE + "Project/old", status=301, headers={"location": "final"}),
                     BASE + "Project/final": response(BASE + "Project/final", '<link rel="canonical" href="canonical">'),
                     BASE + "Project/canonical": response(BASE + "Project/canonical"),
                     BASE + "Project/hidden": response(BASE + "Project/hidden", '<meta name="robots" content="noindex"><img src="private.jpg">'),
                     page + "?work=A": response(page + "?work=A"), page + "?work=B": response(page + "?work=B")}
        # robots rule must cover project paths too.
        responses[BASE + "robots.txt"] = response(BASE + "robots.txt", "User-agent: *\nDisallow: /Project/blocked")
        crawler = self.crawler(responses)
        crawler.seed([page])
        result = {entry.loc for entry in crawler.crawl()}
        self.assertEqual(result, {page, BASE + "Project/canonical", page + "?work=A", page + "?work=B"})
        self.assertNotIn((BASE + "Project/blocked", "GET"), crawler.client.calls)
        self.assertNotIn((BASE + "Project/private.jpg", "HEAD"), crawler.client.calls)

    def test_legacy_content_urls_collapse_to_one_canonical_query_route(self):
        content = sites.RepositoryContent(ROOT, self.report)
        crawler = sites.Crawler(content, FixtureClient({}), self.report, offline=True)
        legacy = BASE + "?music=C%C3%A2nticos-de-Sil%C3%ADcio-I"
        canonical = BASE + "?music=canticos-de-silicio-I"
        crawler.enqueue(legacy)
        crawler.enqueue(canonical)
        self.assertEqual(list(crawler.queue), [(canonical, 0)])
        self.assertEqual(crawler.aliases[legacy], canonical)
        output = self.root / "old.xml"
        output.write_bytes(sites.sitemap_documents([sites.Entry(legacy, "2024-01-02")], output)[output])
        crawler.load_existing(output)
        self.assertEqual(crawler.old[canonical].lastmod, "2024-01-02")

    def test_query_routes_have_their_own_canonical_and_media(self):
        content = sites.RepositoryContent(ROOT, self.report)
        crawler = sites.Crawler(content, FixtureClient({}), self.report, offline=True)
        crawler.enqueue(BASE)
        entries = {entry.loc: entry for entry in crawler.crawl()}
        for category, file in (("music", "music"), ("research", "articles"), ("blog", "blog")):
            for item in json.loads((ROOT / f"json/{file}.json").read_text()):
                canonical = BASE + f"?{category}=" + item["slug"]
                self.assertIn(canonical, entries)
        self.assertNotIn(BASE + "images/music/hatempo.avif", entries[BASE + "?music=canticos-de-silicio-I"].images)
        self.assertNotIn(BASE + "?music=C%C3%A2nticos-de-Sil%C3%ADcio-I", entries)

    def test_homepage_aliases_and_unknown_content_match_client_metadata(self):
        content = sites.RepositoryContent(ROOT, self.report)
        source = (ROOT / "index.html").read_text()
        for url in (BASE + "index.html", BASE + "?utm_source=example"):
            html = sites.PageHTML(source, url)
            content.augment(url, html)
            self.assertEqual(html.canonical, BASE)
        for url in (BASE + "?music=unknown", BASE + "?music="):
            html = sites.PageHTML(source, url)
            content.augment(url, html)
            self.assertTrue(html.noindex)

    def test_canonical_to_noindex_is_omitted(self):
        crawler = self.crawler({BASE: response(BASE, '<link rel="canonical" href="hidden">'),
                                BASE + "hidden": response(BASE + "hidden", '<meta name="robots" content="noindex">')})
        crawler.enqueue(BASE)
        self.assertEqual(crawler.crawl(), [])

    def test_pdf_xrobots_and_header_canonical(self):
        crawler = self.crawler({BASE + "work.pdf": response(BASE + "work.pdf", headers={"content-type": "application/pdf", "x-robots-tag": "noindex"}),
                                BASE + "other.pdf": response(BASE + "other.pdf", headers={"content-type": "application/pdf", "link": '<' + BASE + 'final.pdf>; rel="canonical"'}),
                                BASE + "final.pdf": response(BASE + "final.pdf", headers={"content-type": "application/pdf"})})
        crawler.enqueue(BASE + "work.pdf")
        crawler.enqueue(BASE + "other.pdf")
        self.assertEqual([entry.loc for entry in crawler.crawl()], [BASE + "final.pdf"])
        self.assertTrue(all(method == "HEAD" for url, method in crawler.client.calls if url.endswith(".pdf")))

    def test_nested_project_sitemap_preserves_lastmod_and_crawls_links(self):
        def xml(kind, body):
            return f'<{kind} xmlns="{sites.NAMESPACE}">{body}</{kind}>'
        index = BASE + "Project/sitemap.xml"
        child = BASE + "Project/docs/map.xml"
        page = BASE + "Project/docs/Topic.html?edition=2"
        crawler = self.crawler({index: response(index, xml("sitemapindex", '<sitemap><loc>' + child + '</loc></sitemap>')),
                                child: response(child, xml("urlset", '<url><loc>' + page + '</loc><lastmod>2024-01-02</lastmod></url>')),
                                page: response(page, '<a href="../paper.pdf">Paper</a>'),
                                BASE + "Project/paper.pdf": response(BASE + "Project/paper.pdf", headers={"content-type": "application/pdf"})})
        crawler.sitemap(index)
        entries = {entry.loc: entry for entry in crawler.crawl()}
        self.assertEqual(entries[page].lastmod, "2024-01-02")
        self.assertIn(BASE + "Project/paper.pdf", entries)

    def test_awesome_pd_imports_only_published_sitemap_without_page_or_media_requests(self):
        project = BASE + "Awesome-Pd/"
        sitemap = project + "sitemap.xml"
        raw = project + "objects/stochastic___probabilistic/metro-dev%/"
        page = sites.public_url(raw)
        image = project + "images/example.png"
        video = {"title": "Published title", "description": "Published description",
                 "thumbnail_loc": image, "player_loc": "https://www.youtube.com/embed/NO0qqwnb-lk"}
        published = [sites.Entry(raw, "2026-01-01", {image}, {("youtube", "NO0qqwnb-lk"): video}),
                     sites.Entry(project + "objects/another/", "2025-02-03")]
        path = self.root / "published.xml"
        data = sites.sitemap_documents(published, path)[path]
        stale = project + "objects/removed/"
        previous = self.root / "sitemap.xml"
        previous.write_bytes(sites.sitemap_documents([sites.Entry(stale), sites.Entry(page, "2024-01-02")], previous)[previous])
        crawler = self.crawler({sitemap: sites.Response(sitemap, 200, {"content-type": "application/xml"}, data),
                                BASE: response(BASE, '<a href="Awesome-Pd/">Project</a><a href="Awesome-Pd/unlisted/">Unlisted</a>')},
                               max_pages=1)
        crawler.load_existing(previous)
        self.assertFalse(crawler.queue)
        crawler.seed([project, BASE])
        entries = {entry.loc: entry for entry in crawler.crawl()}
        self.assertEqual(set(entries), {BASE, page, project + "objects/another/"})
        self.assertEqual(entries[page].lastmod, "2024-01-02")
        self.assertEqual(entries[page].images, {image})
        self.assertEqual(entries[page].videos[("youtube", "NO0qqwnb-lk")], video)
        self.assertEqual(crawler.client.calls.count((sitemap, "GET")), 1)
        self.assertEqual([call for call in crawler.client.calls if call[0].startswith(project)], [(sitemap, "GET")])
        self.assertEqual(self.report.counts["visited"], 1)
        self.assertEqual(self.report.counts["pages_imported_from_sitemaps"], 2)
        self.assertFalse(self.report.partial)

    def test_awesome_pd_link_and_old_sitemap_trigger_import_even_without_pages_seed(self):
        project = BASE + "Awesome-Pd/"
        sitemap = project + "sitemap.xml"
        page = project + "objects/metro-dev%25/"
        xml = f'<urlset xmlns="{sites.NAMESPACE}"><url><loc>{page}</loc></url></urlset>'
        crawler = self.crawler({sitemap: response(sitemap, xml)})
        crawler.enqueue(project + "objects/metro-dev%/")
        self.assertEqual([entry.loc for entry in crawler.crawl()], [page])
        self.assertEqual([call for call in crawler.client.calls if call[0].startswith(project)], [(sitemap, "GET")])

    def test_awesome_pd_nested_sitemaps_are_imported_and_scope_is_restricted(self):
        project = BASE + "Awesome-Pd/"
        sitemap = project + "sitemap.xml"
        child = project + "objects.xml"
        page = project + "objects/public/"
        index = f'<sitemapindex xmlns="{sites.NAMESPACE}"><sitemap><loc>{child}</loc></sitemap></sitemapindex>'
        xml = (f'<urlset xmlns="{sites.NAMESPACE}"><url><loc>{page}</loc></url>'
               f'<url><loc>{BASE}unrelated/</loc></url><url><loc>https://outside.test/page</loc></url></urlset>')
        crawler = self.crawler({sitemap: response(sitemap, index), child: response(child, xml)})
        crawler.seed([project])
        self.assertEqual([entry.loc for entry in crawler.crawl()], [page])
        self.assertFalse(crawler.visited)
        self.assertEqual([call for call in crawler.client.calls if call[0].startswith(project)], [(sitemap, "GET"), (child, "GET")])
        self.assertFalse(self.report.partial)

    def test_awesome_pd_failed_import_is_partial_without_fallback_crawl(self):
        project = BASE + "Awesome-Pd/"
        sitemap = project + "sitemap.xml"
        crawler = self.crawler({sitemap: response(sitemap, status=404)})
        crawler.seed([project])
        self.assertEqual(crawler.crawl(), [])
        self.assertFalse(crawler.visited)
        self.assertTrue(self.report.partial)
        self.assertEqual(self.report.errors[0]["source"], sitemap)
        self.assertEqual([call for call in crawler.client.calls if call[0].startswith(project)], [(sitemap, "GET")])

    def test_crawl_limits_make_result_partial_and_protect_existing(self):
        crawler = self.crawler(max_pages=1)
        crawler.enqueue(BASE)
        crawler.enqueue(BASE + "next")
        self.assertTrue(self.report.partial)
        output = self.root / "sitemap.xml"
        output.write_bytes(b"complete")
        self.assertEqual(self.report.counts["crawl_limits"]["--max-pages"], {"limit": 1, "excluded": 1})
        self.assertIn("increase --max-pages", self.report.warnings[0])
        with self.assertRaisesRegex(sites.DiscoveryError, "1 URLs excluded by --max-pages=1"):
            sites.write_documents({output: b"partial"}, output, self.report)
        self.assertEqual(output.read_bytes(), b"complete")
        sites.write_documents({output: b"partial"}, output, self.report, allow_partial=True)
        self.assertEqual(output.read_bytes(), b"partial")
        self.assertEqual(output.with_name("sitemap.xml.bak").read_bytes(), b"complete")

    def test_query_limit_and_depth_limit(self):
        crawler = self.crawler(max_query_variants=1, max_depth=1)
        crawler.enqueue(BASE + "?work=A")
        crawler.enqueue(BASE + "?work=B")
        crawler.enqueue(BASE + "deep", depth=2)
        self.assertEqual(len(crawler.queue), 1)
        self.assertTrue(self.report.partial)
        self.assertEqual(set(self.report.counts["crawl_limits"]), {"--max-depth", "--max-query-variants"})

    def test_xml_escaping_namespaces_and_valid_lastmod(self):
        entry = sites.Entry(BASE + "?work=A&version=B", "2024-02-29", {BASE + "image.jpg?a=1&b=2"},
                            {("local", "recording"): {"title": "A & B <work>", "description": "Actual & existing",
                                                      "thumbnail_loc": BASE + "image.jpg", "content_loc": BASE + "video.mp4"}})
        output = self.root / "sitemap.xml"
        data = sites.sitemap_documents([entry], output)[output]
        root = ET.fromstring(data)
        self.assertEqual(root.find(f"{{{sites.NAMESPACE}}}url/{{{sites.NAMESPACE}}}loc").text, entry.loc)
        self.assertEqual(len(root.findall(f"{{{sites.NAMESPACE}}}url/{{{sites.IMAGE_NS}}}image")), 1)
        video = root.find(f"{{{sites.NAMESPACE}}}url/{{{sites.VIDEO_NS}}}video")
        self.assertEqual(video.find(f"{{{sites.VIDEO_NS}}}title").text, "A & B <work>")
        self.assertIn(b"&amp;", data)
        self.assertIn(b"xmlns:video=", data)
        self.assertIsNone(sites.valid_lastmod("2025-02-29"))
        self.assertIsNone(sites.valid_lastmod("yesterday"))
        self.assertEqual(sites.valid_lastmod("2026-06-14T16:30:13-07:00"), "2026-06-14T16:30:13-07:00")

    def test_count_and_byte_splitting_and_index_urls(self):
        entries = [sites.Entry(BASE + f"Project/{index}/") for index in range(5)]
        output = self.root / "sitemap.xml"
        documents = sites.sitemap_documents(entries, output, max_urls=2, root=self.root)
        self.assertEqual(len(documents), 4)
        index = ET.fromstring(documents[output])
        self.assertEqual(index.tag, f"{{{sites.NAMESPACE}}}sitemapindex")
        self.assertFalse(index.findall(f".//{{{sites.NAMESPACE}}}lastmod"))
        for node in index:
            loc = node.find(f"{{{sites.NAMESPACE}}}loc").text
            self.assertIn(self.root / urlsplit(loc).path.lstrip("/"), documents)
        sized = sites.sitemap_documents(entries, output, max_bytes=700, root=self.root)
        self.assertGreater(len(sized), 1)
        self.assertTrue(all(len(data) <= 700 for data in sized.values()))

    def test_build_inventory_uses_generated_routes_only(self):
        build = self.root / "_site"
        (build / "article").mkdir(parents=True)
        (build / "article/index.html").write_text("<html>Article</html>")
        (build / "draft.md").write_text("# Source")
        content = sites.RepositoryContent(self.root, self.report, build)
        self.assertEqual(content.build_pages(), [BASE + "article/index.html"])
        self.assertEqual(sites.RepositoryContent(self.root, self.report).build_pages(), [])


if __name__ == "__main__":
    unittest.main()
