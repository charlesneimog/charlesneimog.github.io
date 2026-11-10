const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const urls = require("../js/content-urls.js");
const seo = require("../js/content-seo.js");
const { build } = require("./build-content.cjs");
const ROOT = path.resolve(__dirname, "..");

test("ASCII slugs preserve music Roman numerals and accented visible titles", () => {
    for (const [title, slug] of [["Cânticos de Silício I", "canticos-de-silicio-I"],
        ["Cânticos de Silício II", "canticos-de-silicio-II"], ["Pandemônio I", "pandemonio-I"],
        ["Metamorfose Inexata", "metamorfose-inexata"], ["Ideias Roubadas III", "ideias-roubadas-III"],
        [" Há tempo... ", "ha-tempo"], ["á à â ã é ê í ó ô õ ú ç", "a-a-a-a-e-e-i-o-o-o-u-c"]])
        assert.equal(urls.slugify(title, "music"), slug);
    assert.equal(urls.slugify("Enabling Interactive Music Performance through Web Browsers for non-Programmers"),
        "enabling-interactive-music-performance-through-web-browsers-for-non-programmers");
    assert.equal(urls.slugify("Pd-UPIC", "blog"), "pd-upic");
});

test("collision assignments are stable, survive rebuilds and preserve saved URLs", () => {
    const original = [{ title: "Árvore I", year: 2020 }, { title: "Arvore I", year: 2021 },
        { title: "New title", slug: "custom-slug" }];
    const a = urls.assignSlugs(structuredClone(original), "music");
    const b = urls.assignSlugs(structuredClone(original).reverse(), "music").reverse();
    assert.deepEqual(a, b);
    assert.equal(new Set(a.map((item) => item.slug)).size, a.length);
    assert.equal(a[2].slug, "custom-slug");
    assert.deepEqual(urls.assignSlugs(structuredClone(a), "music"), a);
    a[0].title = "A different title";
    assert.equal(urls.assignSlugs(structuredClone(a), "music")[0].slug, a[0].slug);
});

test("all old titles and shareable links resolve to the same query URL", () => {
    for (const [kind, file] of Object.entries({ music: "music", research: "articles", blog: "blog" })) {
        const items = JSON.parse(fs.readFileSync(path.join(ROOT, `json/${file}.json`)));
        for (const item of items) {
            for (const alias of urls.aliases(item)) assert.equal(urls.find(items, kind, alias)?.slug, item.slug);
            assert.equal(urls.url(kind, item), urls.base + `/?${kind}=${item.slug}`);
            assert.equal(item.title, urls.find(items, kind, item.slug).title);
        }
    }
});

test("metadata describes real content, artwork and embedded videos", () => {
    const item = JSON.parse(fs.readFileSync(path.join(ROOT, "json/music.json"))).find((item) => item.title === "Cânticos de Silício I");
    const page = seo.metadata("music", item);
    assert.equal(page.title, "Cânticos de Silício I");
    assert.equal(page.canonical, urls.base + "/?music=canticos-de-silicio-I");
    assert.ok(page.description.length <= 160);
    assert.ok(page.structuredData["@graph"].some((node) => node["@type"] === "MusicComposition"));
    const video = page.structuredData["@graph"].find((node) => node["@type"] === "VideoObject");
    assert.equal(video.embedUrl, item.iframe.link);
    assert.equal(video.thumbnailUrl, new URL(item.image, urls.base + "/").href);
    assert.equal(video.uploadDate, item.iframe.uploadDate);
    const bandcamp = seo.metadata("music", { title: "Audio", slug: "audio", iframe: { source: "bandcamp", link: "https://bandcamp.com/" } });
    assert.equal(bandcamp.videos.length, 0);
});

test("the metadata build is current and adds query links without detail pages", () => {
    const pages = build({ check: true });
    assert.equal(pages.length, 24);
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    for (const page of pages) {
        assert.ok(html.includes(`href="${page.query}"`));
        assert.ok(!fs.existsSync(path.join(ROOT, page.kind, page.slug, "index.html")));
        for (const image of page.images) {
            const url = new URL(image);
            if (url.origin === urls.base) assert.ok(fs.existsSync(path.join(ROOT, decodeURIComponent(url.pathname))));
        }
    }
    assert.ok(!/\/music\/canticos-de-silicio-I\//.test(html));
    assert.ok(!/<link rel="canonical"[^>]+href="https:\/\/charlesneimog.github.io\/"/.test(html));
});
