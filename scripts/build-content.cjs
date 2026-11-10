#!/usr/bin/env node
// Prepare existing query URLs, metadata and homepage links. Node only; no new pages.
const fs = require("node:fs");
const path = require("node:path");
const urls = require("../js/content-urls.js");
const seo = require("../js/content-seo.js");
const ROOT = path.resolve(__dirname, "..");
const escape = (value = "") => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const readJSON = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

function rootLinks(html, navigation = false) {
    return html.replace(/\b(href|src|poster)=(['"])(.*?)\2/g, (tag, attr, quote, value) => {
        if (navigation && value.startsWith("#")) value = "/" + value;
        else if (value && !value.startsWith("/") && !value.startsWith("#") && !/^[a-z][a-z\d+.-]*:/i.test(value))
            value = new URL(value, urls.base + "/").pathname + new URL(value, urls.base + "/").search;
        return `${attr}=${quote}${value}${quote}`;
    });
}
function image(src, title, className = "") {
    return `<img class="${className}" src="${escape(seo.absolute(src))}" alt="${escape(title)}" loading="lazy" decoding="async">`;
}
function card(kind, item) {
    const music = kind === "music";
    const meta = music ? [item.performer, item.date].filter(Boolean).join(", ") :
        kind === "research" ? [...(item.authors || []), item.publisher, item.year].filter(Boolean).join(" — ") : item.date;
    return `<article class="${music ? "project-card" : "content-card " + kind + "-card"} reveal-card visible" data-snap-card="true">
        ${music ? `<div class="project-image-frame">${image(item.image, "Artwork for " + item.title)}</div>` : ""}
        <h3 class="${music ? "project-title" : ""}">${escape(item.title)}${music ? " – (" + escape(item.year) + ")" : ""}</h3>
        ${meta ? `<p class="${music ? "project-metadata" : "card-metadata"}">${escape(meta)}</p>` : ""}
        ${!music && item.description ? `<p class="card-description">${escape(item.description)}</p>` : ""}
        <a class="card-open-button" href="${urls.query(kind, item)}" aria-label="Open ${kind} details for ${escape(item.title)}"></a>
    </article>`;
}
function build({ check = false } = {}) {
    const outputs = new Map();
    const categories = { music: "json/music.json", research: "json/articles.json", blog: "json/blog.json" };
    const records = {};
    const pages = [];
    for (const [kind, source] of Object.entries(categories)) {
        records[kind] = urls.assignSlugs(readJSON(source), kind);
        for (const item of records[kind]) {
            item.aliases = urls.aliases(item).filter((alias) => alias !== item.slug);
            pages.push({ ...seo.metadata(kind, item), source });
        }
        outputs.set(source, JSON.stringify(records[kind], null, 4) + "\n");
    }
    outputs.set("json/content-pages.json", JSON.stringify(pages, null, 2) + "\n");
    let homepage = rootLinks(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
    homepage = homepage.replace(/\s*<link rel="canonical"[^>]*>/g, "");
    const manifest = `<!-- content manifest -->\n        <script id="content-pages" type="application/json">${json(pages)}</script>\n        <!-- /content manifest -->`;
    if (homepage.includes("<!-- content manifest -->"))
        homepage = homepage.replace(/<!-- content manifest -->[\s\S]*?<!-- \/content manifest -->/, manifest);
    else homepage = homepage.replace('<script src="/js/content-urls.js">', manifest + '\n        <script src="/js/content-urls.js">');
    for (const [kind, id] of Object.entries({ music: "Music", research: "Research", blog: "Blog" })) {
        const expression = new RegExp(`(<div\\s+id="div${id}"[^>]*>)[\\s\\S]*?(</div>)`);
        // Each generated block ends at an explicit marker, not a nested card div.
        const existing = new RegExp(`(<div\\s+id="div${id}"[^>]*>)[\\s\\S]*?<!-- /generated ${kind} -->\\s*</div>`);
        const cards = records[kind].map((item) => card(kind, item)).join("\n");
        const replacement = `$1\n<!-- generated ${kind} -->\n${cards}\n<!-- /generated ${kind} -->\n</div>`;
        homepage = homepage.replace(existing.test(homepage) ? existing : expression, replacement);
    }
    const catalog = { "@context": "https://schema.org", "@type": "ItemList", itemListElement: pages.map((page, index) =>
        ({ "@type": "ListItem", position: index + 1, name: page.title, url: page.canonical })) };
    const catalogTag = `<script id="catalog-schema" type="application/ld+json">${json(catalog)}</script>`;
    if (homepage.includes('id="catalog-schema"')) homepage = homepage.replace(/<script id="catalog-schema" type="application\/ld\+json">[\s\S]*?<\/script>/, catalogTag);
    else homepage = homepage.replace("    </head>", `        ${catalogTag}\n    </head>`);
    outputs.set("index.html", homepage.replace(/[ \t]+$/gm, ""));
    const changed = [...outputs].filter(([file, data]) => !fs.existsSync(path.join(ROOT, file)) || fs.readFileSync(path.join(ROOT, file), "utf8") !== data);
    if (check && changed.length) throw new Error("Content metadata is stale: " + changed.map(([file]) => file).join(", "));
    if (!check) {
        for (const [file, data] of changed) { fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true }); fs.writeFileSync(path.join(ROOT, file), data); }
    }
    console.log(`Content build: ${pages.length} query URLs; ${changed.length} files ${check ? "need updating" : "updated"}.`);
    return pages;
}
if (require.main === module) { try { build({ check: process.argv.includes("--check") }); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { build, card };
