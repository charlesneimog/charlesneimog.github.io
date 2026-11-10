/* Shared by the browser and the dependency-free Node content build. */
(function (root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.ContentURLs = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
    "use strict";
    const base = "https://charlesneimog.github.io";
    const letters = { ß: "ss", æ: "ae", œ: "oe", ø: "o", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

    function slugify(value = "", kind = "research") {
        const title = String(value ?? "").trim();
        const ending = kind === "music" && title.match(/(?:^|[\s\-–—])([IVXLCDM]+)[.!?]*$/);
        const roman = ending && /^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(ending[1])
            ? ending[1] : "";
        let slug = title.normalize("NFKD").replace(/\p{Mark}/gu, "").toLowerCase()
            .replace(/[ßæœøłđðþı]/g, (letter) => letters[letter])
            .replace(/['’`]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        if (roman) slug = slug.slice(0, -roman.length) + roman;
        return slug;
    }

    function assignSlugs(records, kind) {
        const used = new Set();
        // Reserve saved slugs first. Stable ordering also makes first-build
        // collision suffixes independent of JSON array order.
        const identity = (item) => JSON.stringify([item.title, item.year, item.file, item.shareableLink, item.link, item.iframe?.link]);
        const ordered = records.map((item, index) => ({ item, index }))
            .sort((a, b) => Number(Boolean(b.item.slug)) - Number(Boolean(a.item.slug)) ||
                (identity(a.item) < identity(b.item) ? -1 : identity(a.item) > identity(b.item) ? 1 : a.index - b.index));
        for (const { item } of ordered) {
            const supplied = item.slug || (kind === "blog" && item.shareableLink) || item.title;
            const valid = kind === "music" ? /^[a-z0-9]+(?:-[a-z0-9]+)*(?:-[IVXLCDM]+(?:-[0-9]+)?)?$/ : /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
            const stem = item.slug && valid.test(item.slug) ? item.slug : slugify(supplied, kind) || kind;
            let slug = stem;
            for (let suffix = 2; used.has(slug); suffix++) slug = `${stem}-${suffix}`;
            used.add(slug);
            item.slug = slug;
        }
        return records;
    }

    function aliases(item) {
        return [...new Set([item.slug, item.title, item.title?.trim().replace(/\s+/g, "-"),
            item.shareableLink, ...(item.aliases || [])].filter(Boolean))];
    }

    function find(records, kind, requested) {
        if (!requested) return null;
        return records.find((item) => item.slug === requested) ||
            records.find((item) => aliases(item).includes(requested)) ||
            records.find((item) => aliases(item).some((alias) =>
                slugify(alias, kind).toLowerCase() === slugify(requested, kind).toLowerCase())) || null;
    }

    const query = (kind, item) => `/?${kind}=${item.slug}`;
    const url = (kind, item) => base + query(kind, item);
    return { base, slugify, assignSlugs, aliases, find, url, query };
});
