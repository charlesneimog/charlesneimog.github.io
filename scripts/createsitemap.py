import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, timezone

BASE_URL = "https://charlesneimog.github.io"

MAX_URLS_PER_SITEMAP = 50000  # Google limit

STATIC_PAGES = {
    "/": "index.html",
    "/talks/": "talks/index.html",
    "/classes/": "classes/index.html",
    "/tools/": "tools/index.html",
    "/tools/else-help/": "tools/else-help/index.html",
    "/tools/score-follower-marks/": "tools/score-follower-marks/index.html",
}


def generate_entries():
    entries = []
    repository_root = Path(__file__).resolve().parent.parent

    for route, relative_path in STATIC_PAGES.items():
        path = repository_root / relative_path
        lastmod = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")
        entries.append((f"{BASE_URL}{route}", lastmod))

    return entries


def write_sitemap(entries, output_file):
    """Write a single sitemap file."""
    urlset = ET.Element("urlset")
    urlset.set("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9")

    for url, lastmod in entries:
        url_tag = ET.SubElement(urlset, "url")

        loc = ET.SubElement(url_tag, "loc")
        loc.text = url

        lm = ET.SubElement(url_tag, "lastmod")
        lm.text = lastmod

    tree = ET.ElementTree(urlset)
    tree.write(output_file, encoding="utf-8", xml_declaration=True)


def write_sitemap_index(files, output_file):
    """Write sitemap index when more than 50k URLs."""
    index = ET.Element("sitemapindex")
    index.set("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for f in files:
        tag = ET.SubElement(index, "sitemap")

        loc = ET.SubElement(tag, "loc")
        loc.text = f"{BASE_URL}/{f}"

        lm = ET.SubElement(tag, "lastmod")
        lm.text = today

    tree = ET.ElementTree(index)
    tree.write(output_file, encoding="utf-8", xml_declaration=True)


def generate_sitemap():
    entries = generate_entries()
    repository_root = Path(__file__).resolve().parent.parent

    # Remove duplicates and sort
    entries = list(dict.fromkeys(entries))
    entries.sort(key=lambda x: x[0])

    # Split if too large
    if len(entries) > MAX_URLS_PER_SITEMAP:
        files = []
        chunks = [
            entries[i : i + MAX_URLS_PER_SITEMAP]
            for i in range(0, len(entries), MAX_URLS_PER_SITEMAP)
        ]

        for idx, chunk in enumerate(chunks, start=1):
            fname = f"sitemap{idx}.xml"
            write_sitemap(chunk, repository_root / fname)
            files.append(fname)

        write_sitemap_index(files, repository_root / "sitemap.xml")
        print(f"Created sitemap index with {len(files)} files.")

    else:
        write_sitemap(entries, repository_root / "sitemap.xml")
        print(f"Created sitemap.xml with {len(entries)} URLs.")


if __name__ == "__main__":
    generate_sitemap()
