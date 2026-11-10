(function (root, factory) {
    const api = factory(typeof module === "object" && module.exports ? require("./content-urls.js") : root.ContentURLs);
    if (typeof module === "object" && module.exports) module.exports = api;
    else {
        root.ContentSEO = api;
        api.initialize();
    }
})(typeof globalThis === "object" ? globalThis : this, function (urls) {
    "use strict";
    const author = { "@type": "Person", "@id": urls.base + "/#person", name: "Charles K. Neimog" };
    const absolute = (value) => value ? new URL(value, urls.base + "/").href : null;
    function plain(value = "") {
        return String(value).replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
            .replace(/<[^>]+>/g, " ").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
    }
    function metadata(kind, item) {
        const text = plain(item.description || item.abstract || item.title);
        const description = text.length > 160 ? text.slice(0, 157).replace(/\s+\S*$/, "") + "…" : text;
        const images = [...new Set([item.image, ...(item.images || []).slice(0, 4)].filter(Boolean).map(absolute))];
        const canonical = urls.url(kind, item);
        const entity = {
            "@type": kind === "music" ? "MusicComposition" : kind === "research" ? "ScholarlyArticle" : "BlogPosting",
            "@id": canonical + "#work", url: canonical, name: item.title, description: plain(item.description || item.abstract),
            mainEntityOfPage: { "@id": canonical + "#webpage" },
        };
        if (images.length) entity.image = images;
        if (kind === "music") {
            entity.composer = author;
            if (item.year) entity.dateCreated = String(item.year);
            if (item.score) entity.encoding = { "@type": "MediaObject", contentUrl: absolute(item.score), encodingFormat: "application/pdf" };
        } else {
            entity.headline = item.title;
            entity.author = item.authors?.length ? item.authors.map((name) => ({ "@type": "Person", name })) : author;
            if (item.publisher) entity.publisher = { "@type": "Organization", name: item.publisher };
            if (item.abstract) entity.abstract = plain(item.abstract);
            if (item.year) entity.datePublished = String(item.year);
            if (kind === "blog" && item.date) {
                const date = new Date(item.date);
                if (!Number.isNaN(date.valueOf())) entity.datePublished = date.toISOString().slice(0, 10);
            }
        }
        if (kind === "research") entity.inLanguage = item.language === "🇧🇷" ? "pt-BR" : "en";
        if (item.link) entity.sameAs = absolute(item.link);
        const graph = [{ "@type": "WebPage", "@id": canonical + "#webpage", url: canonical,
            name: item.title, description, isPartOf: { "@id": urls.base + "/#website" },
            mainEntity: { "@id": entity["@id"] } }, entity];
        const videos = [];
        if (kind === "music" && item.iframe?.source === "youtube" && item.iframe.link) {
            const video = { "@type": "VideoObject", "@id": canonical + "#video", name: item.title,
                description: plain(item.description), embedUrl: absolute(item.iframe.link),
                thumbnailUrl: absolute(item.image), url: canonical, about: { "@id": entity["@id"] } };
            if (item.iframe.uploadDate) video.uploadDate = item.iframe.uploadDate;
            graph.push(video);
            entity.video = { "@id": video["@id"] };
            videos.push({ url: video.embedUrl, title: video.name, description: video.description,
                thumbnail_loc: video.thumbnailUrl, publication_date: video.uploadDate });
        }
        return { kind, slug: item.slug, title: item.title, aliases: urls.aliases(item), canonical,
            query: urls.query(kind, item), description, images, videos,
            image: images[0] || urls.base + "/images/myself/about-rect.avif",
            language: kind === "research" && item.language === "🇧🇷" ? "pt-BR" : "en",
            structuredData: { "@context": "https://schema.org", "@graph": graph } };
    }

    let pages = [];
    let homepage = null;
    function setMeta(selector, attribute, key, value) {
        let tag = document.head.querySelector(selector);
        if (!tag) { tag = document.createElement("meta"); tag.setAttribute(attribute, key); document.head.appendChild(tag); }
        tag.content = value;
    }
    function apply(page) {
        if (!page) return;
        document.title = page.title + " | Charles K. Neimog";
        setMeta('meta[name="description"]', "name", "description", page.description);
        for (const [key, value] of Object.entries({ title: document.title, description: page.description,
            url: page.canonical, image: page.image, "image:alt": page.title, type: "article" }))
            setMeta(`meta[property="og:${key}"]`, "property", "og:" + key, value);
        for (const [key, value] of Object.entries({ card: "summary_large_image", title: document.title,
            description: page.description, image: page.image, "image:alt": page.title, url: page.canonical }))
            setMeta(`meta[name="twitter:${key}"]`, "name", "twitter:" + key, value);
        let canonical = document.head.querySelector('link[rel="canonical"]');
        if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
        canonical.href = page.canonical;
        let schema = document.getElementById("content-schema");
        if (!schema) { schema = document.createElement("script"); schema.id = "content-schema"; schema.type = "application/ld+json"; document.head.appendChild(schema); }
        schema.textContent = JSON.stringify(page.structuredData);
    }
    function restore() {
        if (!homepage) return;
        document.title = homepage.title;
        for (const [selector, content] of homepage.tags) document.head.querySelector(selector)?.setAttribute("content", content);
        const existing = new Set(homepage.tags.map(([selector]) => selector));
        document.head.querySelectorAll('meta[name^="twitter:"], meta[property^="og:"]').forEach((tag) => {
            const selector = tag.name ? `meta[name="${tag.name}"]` : `meta[property="${tag.getAttribute("property")}"]`;
            if (!existing.has(selector)) tag.remove();
        });
        const canonical = document.head.querySelector('link[rel="canonical"]');
        if (canonical) canonical.href = urls.base + "/";
        document.getElementById("content-schema")?.remove();
    }
    function find(kind, item) { return pages.find((page) => page.kind === kind && page.slug === item.slug); }
    function initialize() {
        pages = JSON.parse(document.getElementById("content-pages")?.textContent || "[]");
        homepage = { title: document.title, tags: [...document.head.querySelectorAll("meta[name], meta[property]")]
            .filter((tag) => /^(description|og:|twitter:)/.test(tag.name || tag.getAttribute("property")))
            .map((tag) => [tag.name ? `meta[name="${tag.name}"]` : `meta[property="${tag.getAttribute("property")}"]`, tag.content]) };
        const params = new URLSearchParams(location.search);
        const selectedKind = ["music", "research", "blog"].find((kind) => params.has(kind));
        const selected = selectedKind && urls.find(pages.filter((page) => page.kind === selectedKind), selectedKind, params.get(selectedKind));
        if (selected) apply(selected);
        else if (!selectedKind) {
            const canonical = document.createElement("link"); canonical.rel = "canonical"; canonical.href = urls.base + "/";
            if (!document.head.querySelector('link[rel="canonical"]')) document.head.appendChild(canonical);
        }
    }
    return { metadata, plain, absolute, initialize, apply, restore, find, get pages() { return pages; } };
});
