// The content catalog is emitted into index.html by scripts/build-content.cjs.
// Keep a fallback for previews that have not run the metadata build.
if (!document.getElementById("catalog-schema") && window.ContentSEO?.pages.length) {
    const schema = document.createElement("script");
    schema.id = "catalog-schema";
    schema.type = "application/ld+json";
    schema.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        itemListElement: ContentSEO.pages.map((page, index) => ({
            "@type": "ListItem", position: index + 1, name: page.title, url: page.canonical,
        })),
    });
    document.head.appendChild(schema);
}
