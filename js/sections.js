const MOBILE_MEDIA_QUERY = "(max-width: 959px)";
const SCROLL_EDGE_EPSILON = 8;
const scrollAmount = 300;
var renderer;

const languageIcons = {
    Lua: "devicon-lua-plain",
    C: "devicon-c-original",
    "C++": "devicon-cplusplus-plain",
    Python: "devicon-python-plain",
    JavaScript: "devicon-javascript-plain",
    Java: "devicon-java-plain",
    Wasm: "devicon-wasm-plain",
    // add more as needed
};

const REVEAL_STAGGER_MS = 120;

const observer = new IntersectionObserver(
    (entries) => {
        const visibleEntries = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.target.getBoundingClientRect().left - b.target.getBoundingClientRect().left);

        visibleEntries.forEach((entry, index) => {
            // Stagger only cards that became visible in this observer tick.
            entry.target.style.transitionDelay = `${index * REVEAL_STAGGER_MS}ms`;
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
        });
    },
    { threshold: 0.2, rootMargin: "0px 0px 0px 0px" },
);

//╭─────────────────────────────────────╮
//│              Utilities              │
//╰─────────────────────────────────────╯
async function fetchMarkdown(file, html) {
    const markdownURL = file;
    return fetch(markdownURL)
        .then((response) => {
            if (!response.ok) throw new Error("Failed to fetch markdown file");
            return response.text();
        })
        .then((markdownText) => {
            const mdhtml = marked.parse(markdownText);
            html.innerHTML = mdhtml;
            enhanceEmbeddedMedia(html);
        })
        .catch((err) => {
            console.error(err);
        });
}

// ─────────────────────────────────────
function enhanceEmbeddedMedia(container) {
    if (!container) return;

    const audioElements = container.querySelectorAll("audio");
    audioElements.forEach((audio) => {
        if (audio.dataset.wavesurfer === "true") return;
        audio.dataset.wavesurfer = "true";
        createAudioElement(audio);
    });
}

// ─────────────────────────────────────
function isMobileViewport() {
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

// ─────────────────────────────────────
function getSnapCards(container) {
    if (!container) return [];
    return Array.from(container.children).filter((child) => child.dataset?.snapCard === "true");
}

// ─────────────────────────────────────
function getCenteredScrollLeft(container, card) {
    if (!container || !card) return 0;
    return Math.max(card.offsetLeft - (container.clientWidth - card.offsetWidth) / 2, 0);
}

// ─────────────────────────────────────
function centerCardInContainer(container, card, behavior = "smooth") {
    if (!container || !card) return;
    const targetLeft = getCenteredScrollLeft(container, card);
    container.scrollTo({
        left: targetLeft,
        behavior,
    });
}

// ─────────────────────────────────────
function getClosestCardIndex(container, cards) {
    if (!container || !cards.length) return 0;
    const containerCenter = container.scrollLeft + container.clientWidth / 2;
    let closestIdx = 0;
    let minDistance = Infinity;

    cards.forEach((card, index) => {
        const cardCenter = card.offsetLeft + card.offsetWidth / 2;
        const distance = Math.abs(cardCenter - containerCenter);
        if (distance < minDistance) {
            minDistance = distance;
            closestIdx = index;
        }
    });

    return closestIdx;
}

// ─────────────────────────────────────
function activateDialog(overlay, closeButton, closeDialog) {
    const previouslyFocused = document.activeElement;

    const handleKeydown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeDialog();
        }
    };

    const removalObserver = new MutationObserver(() => {
        if (overlay.isConnected) return;
        document.removeEventListener("keydown", handleKeydown);
        removalObserver.disconnect();
        previouslyFocused?.focus?.();
    });

    document.addEventListener("keydown", handleKeydown);
    removalObserver.observe(document.body, { childList: true });
    requestAnimationFrame(() => closeButton.focus());
}

//╭─────────────────────────────────────╮
//│                Music                │
//╰─────────────────────────────────────╯
const MUSIC_QUERY_PARAM = "music";
const RESEARCH_QUERY_PARAM = "research";
const BLOG_QUERY_PARAM = "blog";
let musicDataCache = [];
let researchDataCache = [];
let blogDataCache = [];
let activeContentDialog = null;
let contentReady = false;

// ─────────────────────────────────────
function slugifyMusicTitle(title = "") {
    return ContentURLs.slugify(title, "music");
}

// ─────────────────────────────────────
function contentLocation(kind, post) {
    const url = new URL(window.location.href);
    [MUSIC_QUERY_PARAM, RESEARCH_QUERY_PARAM, BLOG_QUERY_PARAM].forEach((key) => url.searchParams.delete(key));
    if (kind && post) url.searchParams.set(kind, post.slug);
    return url.pathname + url.search + url.hash;
}

function beginContentDialog(kind, post, navigation) {
    document.getElementById("content-error-robots")?.remove();
    document.getElementById("content-not-found")?.remove();
    activeContentDialog?.remove();
    activeContentDialog = null;
    const url = contentLocation(kind, post);
    if (navigation === "push") history.pushState({ ...history.state, contentDialog: true }, "", url);
    else if (url !== location.pathname + location.search + location.hash) history.replaceState(history.state, "", url);
    ContentSEO.apply(ContentSEO.metadata(kind, post));
}

function closeContentDialog(overlay) {
    overlay.remove();
    activeContentDialog = null;
    if (history.state?.contentDialog) history.back();
    else {
        history.replaceState(history.state, "", contentLocation());
        ContentSEO.restore();
    }
}

function contentLink(kind, post, open) {
    const anchor = document.createElement("a");
    anchor.href = ContentURLs.query(kind, post);
    anchor.className = "card-open-button";
    anchor.setAttribute("aria-label", `Open ${kind} details for ${post.title}`);
    anchor.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        open(post);
    });
    return anchor;
}

function registerContentDialog(overlay, kind, post) {
    overlay.dataset.contentKind = kind;
    overlay.dataset.contentSlug = post.slug;
    activeContentDialog = overlay;
}

// ─────────────────────────────────────
async function createMusicPage(post, { navigation = "push" } = {}) {
    if (!post) return;

    beginContentDialog("music", post, navigation);

    // Create overlay wrapper
    const overlay = document.createElement("div");
    overlay.className =
        "fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 sm:p-6 md:p-8";

    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "music-modal-title");

    // Modal container
    const modal = document.createElement("div");
    modal.className =
        "relative w-full max-w-5xl max-h-[90vh] rounded-xl bg-background-light dark:bg-background-dark border border-gray-300 dark:border-gray-700 flex flex-col max-sm:max-h-[90vh] max-sm:overflow-y-auto";
    overlay.appendChild(modal);

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.className =
        "absolute top-2 right-2 p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white rounded-full transition-colors cursor-pointer";
    closeBtn.setAttribute("aria-label", "Close music details");
    closeBtn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">close</span>`;
    const closeDialog = () => {
        closeContentDialog(overlay);
    };
    closeBtn.addEventListener("click", closeDialog);

    // set pointer button
    modal.appendChild(closeBtn);

    // Content wrapper (scrollable)
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "flex flex-col lg:flex-row flex-1 overflow-hidden max-sm:overflow-y-auto";
    modal.appendChild(contentWrapper);

    // Left / Top Section: text + piece card
    const left = document.createElement("div");
    left.className = "flex flex-col w-full lg:w-1/3 p-6 lg:p-8 overflow-y-auto";

    // Text
    const title = document.createElement("h2");
    title.id = "music-modal-title";
    title.className = "text-gray-900 dark:text-white text-xl font-bold leading-tight pb-3";
    title.textContent = post.title + " (" + post.year + ")";
    left.appendChild(title);

    const description = document.createElement("p");
    description.className = "text-gray-600 dark:text-gray-400 text-base font-normal leading-relaxed pb-6 text-justify";
    const mdhtml = marked.parse(post.description);
    description.innerHTML = mdhtml;

    left.appendChild(description);

    const card = document.createElement("div");
    card.className = "flex flex-col items-stretch justify-start rounded-lg mt-auto pt-4";

    const info = document.createElement("div");
    info.className = "flex flex-col items-stretch justify-center gap-1 py-4";

    const type = document.createElement("p");
    type.className = "text-primary text-sm font-medium leading-normal";

    if (post.performer === "Electroacoustic") {
        type.textContent = "Acousmatic Piece (" + post.year + ")";
    } else {
        type.innerHTML = `<i>by ${post.performer}</i>`;
    }
    info.appendChild(type);

    const links = document.createElement("div");
    links.className = "flex flex-col items-stretch justify-center gap-1 py-4";

    if (post.pd4web) {
        const pd4web = document.createElement("a");
        pd4web.className = "flex items-center gap-3 group";
        pd4web.href = post.pd4web; // link para o site
        pd4web.target = "_blank"; // abre em nova aba
        pd4web.rel = "noopener noreferrer";

        const img = document.createElement("img");
        img.src = "images/pd4web.svg";
        img.alt = "pd4web logo";
        img.className = "h-4 dark:text-text-dark-primary transition-colors";

        const span2 = document.createElement("span");
        span2.className =
            "text-gray-700 dark:text-gray-300 group-hover:text-primary font-medium transition-colors hover:text-text-light-primary dark:text-text-dark-primary transition-colors";
        span2.textContent = "Play using pd4web";

        pd4web.appendChild(img);
        pd4web.appendChild(span2);
        links.appendChild(pd4web);
    }

    if (post.score) {
        const score = document.createElement("a");
        score.className = "flex items-center gap-3 group";
        score.href = post.score;
        score.target = "_blank";
        score.rel = "noopener noreferrer";

        const img = document.createElement("img");
        img.src = "images/pdf.svg";
        img.alt = `PDF score for ${post.title}`;
        img.className = "h-4 hover:text-text-light-primary dark:text-text-dark-primary transition-colors";

        const span2 = document.createElement("span");
        span2.className = "text-gray-700 dark:text-gray-300 group-hover:text-primary font-medium transition-colors";
        span2.textContent = "Score";

        score.appendChild(img);
        score.appendChild(span2);
        links.appendChild(score);
    }

    if (post.github) {
        const github = document.createElement("a");
        github.className = "flex items-center gap-3 group";
        github.href = post.github;
        github.target = "_blank";
        github.rel = "noopener noreferrer";

        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const img = document.createElement("img");
        if (isDark) {
            img.src = "images/github-dark.svg";
        } else {
            img.src = "images/github-light.svg";
        }
        img.alt = `GitHub repository for ${post.title}`;
        img.className = "h-4 hover:text-text-light-primary dark:text-text-dark-primary transition-colors";

        const span2 = document.createElement("span");
        span2.className = "text-gray-700 dark:text-gray-300 group-hover:text-primary font-medium transition-colors";
        span2.textContent = "Github Repository";

        github.appendChild(img);
        github.appendChild(span2);
        links.appendChild(github);
    }

    const share = document.createElement("a");
    share.href = ContentURLs.url("music", post);
    share.className = "text-primary text-sm underline";
    share.textContent = "Link to this composition";
    links.appendChild(share);
    card.appendChild(info);
    card.appendChild(links);
    left.appendChild(card);

    // Left card
    contentWrapper.appendChild(left);
    if (post.iframe && post.iframe.source === "youtube") {
        const right = document.createElement("div");
        right.className =
            "w-full lg:w-2/3 p-6 lg:p-8 bg-gray-100/50 dark:bg-black/20 flex items-center justify-center rounded-xl ";

        const iframeWrapper = document.createElement("div");
        iframeWrapper.className = "w-full aspect-video rounded-xl overflow-hidden bg-black";

        const iframe = document.createElement("iframe");
        const playerURL = new URL(post.iframe.link);
        Object.entries({ autoplay: 1, vq: "hd720", hd: 1, rel: 0, mute: 0, controls: 1, modestbranding: 1, loop: 0 })
            .forEach(([key, value]) => playerURL.searchParams.set(key, value));
        iframe.src = playerURL.href;
        iframe.title = `Performance of ${post.title}`;

        iframe.allow = "accelerometer; autoplay; gyroscope; picture-in-picture;";
        iframe.allowFullscreen = true;
        iframe.className = "w-full h-full";

        iframeWrapper.appendChild(iframe);
        right.appendChild(iframeWrapper);
        contentWrapper.appendChild(right);
    }

    if (post.iframe && post.iframe.source === "bandcamp") {
        const right = document.createElement("div");

        right.className =
            "w-full lg:w-2/3 p-6 lg:p-8 bg-gray-100/50 dark:bg-black/20 " +
            "flex items-center justify-center rounded-xl";

        const iframe = document.createElement("iframe");
        iframe.src = post.iframe.link;
        iframe.title = `Listen to ${post.title}`;
        iframe.style.border = "0";
        iframe.style.width = post.iframe.width || "100%";
        iframe.style.height = post.iframe.height || "442px";
        iframe.setAttribute("seamless", "");

        iframe.className = "rounded-xl overflow-hidden";
        right.appendChild(iframe);
        contentWrapper.appendChild(right);
    }

    if (post.images && post.images.length > 0) {
        const right = document.createElement("div");
        right.className = "w-full lg:w-2/3 p-6 lg:p-8 bg-gray-100/50 dark:bg-black/20 rounded-xl";

        const grid = document.createElement("div");
        grid.className = "grid grid-cols-2 gap-4";

        post.images.slice(0, 4).forEach((src) => {
            const cell = document.createElement("div");
            cell.className =
                "w-full bg-center bg-no-repeat aspect-square bg-cover rounded-lg overflow-hidden transition-transform duration-300 hover:scale-105";
            cell.style.backgroundImage = `url("${src}")`;
            cell.setAttribute("role", "img");
            cell.setAttribute("aria-label", `Visual documentation for ${post.title}`);
            grid.appendChild(cell);
        });

        right.appendChild(grid);
        contentWrapper.appendChild(right);
    }

    // Add overlay to document
    document.body.appendChild(overlay);
    registerContentDialog(overlay, "music", post);
    activateDialog(overlay, closeBtn, closeDialog);
}

// ─────────────────────────────────────
async function addMusics() {
    const musicDiv = document.getElementById("divMusic");

    const response = await fetch("/json/music.json");
    if (!response.ok) throw new Error("Unable to load music");
    const musicjson = await response.json();

    musicDataCache = ContentURLs.assignSlugs(Array.isArray(musicjson) ? musicjson : [], "music");

    musicDiv.innerHTML = "";

    for (let i = musicjson.length - 1; i >= 0; i--) {
        const composition = musicjson[i];

        const container = document.createElement("article");
        container.className = "project-card reveal-card";

        container.dataset.snapCard = "true";

        const imageFrame = document.createElement("div");
        imageFrame.className = "project-image-frame";

        const img = document.createElement("img");

        img.src = composition.image;
        img.alt = `Artwork for ${composition.title}`;
        img.loading = "lazy";
        img.decoding = "async";

        imageFrame.appendChild(img);
        container.appendChild(imageFrame);

        const title = document.createElement("h3");

        title.className = "project-title";

        title.textContent = `${composition.title} – (${composition.year})`;

        container.appendChild(title);

        const performerText = [composition.performer, composition.date].filter(Boolean).join(", ");

        const performer = document.createElement("p");

        performer.className = "project-metadata";

        performer.textContent = performerText;

        container.appendChild(performer);

        const openButton = contentLink("music", composition, createMusicPage);
        container.appendChild(openButton);

        musicDiv.prepend(container);
    }

    musicDiv.querySelectorAll(".reveal-card").forEach((card) => observer.observe(card));
}

// ─────────────────────────────────────
function openMusicModalFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const requestedSlug = params.get(MUSIC_QUERY_PARAM);
    if (!requestedSlug || !musicDataCache.length) return;

    const match = ContentURLs.find(musicDataCache, "music", requestedSlug);
    if (match) {
        createMusicPage(match, { navigation: "replace" });
    }
}

// ─────────────────────────────────────
function openResearchModalFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const requestedSlug = params.get(RESEARCH_QUERY_PARAM);
    if (!requestedSlug || !researchDataCache.length) return;

    const match = ContentURLs.find(researchDataCache, "research", requestedSlug);
    if (match) {
        createResearchPage(match, { navigation: "replace" });
    }
}

// ─────────────────────────────────────
function openBlogModalFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const requestedSlug = params.get(BLOG_QUERY_PARAM);
    if (!requestedSlug || !blogDataCache.length) return;

    const match = ContentURLs.find(blogDataCache, "blog", requestedSlug);

    if (match) {
        createBlogPage(match, { navigation: "replace" });
    }
}

//╭─────────────────────────────────────╮
//│              Articles               │
//╰─────────────────────────────────────╯
async function createResearchPage(post, { navigation = "push" } = {}) {
    if (!post) return;

    beginContentDialog("research", post, navigation);

    // Overlay
    const overlay = document.createElement("div");
    overlay.className =
        "fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 sm:p-6 md:p-8";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "research-modal-title");

    // Main card
    const card = document.createElement("div");
    card.className =
        "relative bg-background-light dark:bg-background-dark rounded-xl p-6 md:p-8 border border-gray-300 dark:border-gray-700 " +
        "max-w-4xl w-full max-sm:max-h-[90vh] max-sm:overflow-y-auto";

    overlay.appendChild(card);

    // Close button *INSIDE* the card
    const closeBtn = document.createElement("button");
    closeBtn.className =
        "absolute top-4 right-4 p-2 text-gray-600 dark:text-gray-300 " +
        "hover:text-gray-900 dark:hover:text-white transition-colors";
    closeBtn.setAttribute("aria-label", "Close research details");
    closeBtn.innerHTML = `<span class="material-symbols-outlined text-3xl" aria-hidden="true">close</span>`;
    const closeDialog = () => {
        closeContentDialog(overlay);
    };
    closeBtn.addEventListener("click", closeDialog);
    closeBtn.style.cursor = "pointer";
    card.appendChild(closeBtn);

    // GRID layout
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 md:grid-cols-2 gap-8 items-center";
    card.appendChild(grid);

    // LEFT — text block
    const left = document.createElement("div");
    left.className = "flex flex-col gap-4";

    // Title
    const titleBlock = document.createElement("div");
    titleBlock.className = "flex flex-col gap-2";

    const title = document.createElement("h2");
    title.id = "research-modal-title";
    title.className = "text-gray-900 dark:text-white text-xl font-bold leading-tight pb-3";
    title.textContent = post.title;

    titleBlock.appendChild(title);

    // META: authors • publisher • year
    if (post.authors || post.publisher || post.year) {
        const meta = document.createElement("p");
        meta.className = "text-sm text-text-muted dark:text-text-dark-secondary italic";

        const authors = Array.isArray(post.authors) ? post.authors.join(", ") : post.authors || "";

        const pubInfo = [post.publisher, post.year].filter(Boolean).join(" • ");

        meta.textContent = [authors, pubInfo].filter(Boolean).join(" — ");

        titleBlock.appendChild(meta);
    }

    // ABSTRACT (Markdown)
    if (post.abstract) {
        const abstract = document.createElement("div");
        abstract.className =
            " text-[0.9rem] text-gray-600 dark:text-gray-400 text-base font-normal leading-relaxed pb-6 text-justify";

        const mdhtml = marked.parse(post.abstract);
        abstract.innerHTML = mdhtml;

        titleBlock.appendChild(abstract);
    }

    // Buttons
    const buttons = document.createElement("div");
    buttons.className = "flex flex-wrap items-center gap-4 pt-2";

    if (post.link) {
        const viewBtn = document.createElement("a");
        viewBtn.href = post.link;
        viewBtn.target = "_blank";
        viewBtn.className =
            "group flex min-w-[84px] cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-lg h-10 px-4 text-text-muted text-sm font-medium transition-colors hover:text-primary";

        const t = document.createElement("span");
        t.className =
            "truncate text-gray-700 dark:text-gray-300 group-hover:text-primary font-medium transition-colors hover:text-text-light-primary dark:text-text-dark-primary transition-colors";
        t.textContent = "Read Paper";

        const ic = document.createElement("span");
        ic.className =
            "material-symbols-outlined !text-xl group-hover:translate-x-1 transition-transform truncate text-gray-700 dark:text-gray-300 font-medium transition-colors dark:text-text-dark-primary transition-colors";
        ic.textContent = "arrow_forward";

        viewBtn.appendChild(t);
        viewBtn.appendChild(ic);
        buttons.appendChild(viewBtn);
    }

    if (post.paper) {
        const paperBtn = document.createElement("a");
        paperBtn.href = post.paper;

        paperBtn.className =
            "group flex min-w-[84px] cursor-pointer items-center justify-center gap-2 " +
            "overflow-hidden rounded-lg h-10 px-4 text-sm font-medium transition-colors " +
            "text-text-light-secondary dark:text-text-dark-secondary " +
            "hover:text-primary";

        const spanText = document.createElement("span");
        spanText.className = "truncate";
        spanText.textContent = "Read Paper";

        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined !text-xl transition-transform group-hover:translate-x-1";
        icon.textContent = "article";

        paperBtn.appendChild(spanText);
        paperBtn.appendChild(icon);

        buttons.appendChild(paperBtn);
    }

    left.appendChild(titleBlock);
    const share = document.createElement("a");
    share.href = ContentURLs.url("research", post);
    share.className = "text-primary text-sm underline";
    share.textContent = "Link to this research";
    buttons.appendChild(share);
    left.appendChild(buttons);

    // RIGHT — 2x2 image grid
    const right = document.createElement("div");
    right.className = "grid grid-cols-2 gap-4";

    const imgs = (post.images?.length ? post.images : post.image ? [post.image] : []).slice(0, 4);

    imgs.forEach((src) => {
        const cell = document.createElement("div");
        cell.className =
            "w-full bg-center bg-no-repeat aspect-square bg-cover rounded-lg overflow-hidden " +
            "transition-transform duration-300 hover:scale-105";
        cell.style.backgroundImage = `url("${src}")`;
        cell.setAttribute("role", "img");
        cell.setAttribute("aria-label", `Visual documentation for ${post.title}`);
        right.appendChild(cell);
    });

    grid.appendChild(left);
    grid.appendChild(right);

    // Finally show modal
    document.body.appendChild(overlay);
    registerContentDialog(overlay, "research", post);
    activateDialog(overlay, closeBtn, closeDialog);
}

// ─────────────────────────────────────
function addResearchCard(post) {
    const container = document.createElement("article");
    container.className = "content-card research-card reveal-card";
    container.dataset.snapCard = "true";

    // Title
    const title = document.createElement("h3");
    title.textContent = post.title || "";
    container.appendChild(title);

    // Authors / publisher
    if (post.authors || post.year || post.publisher) {
        const meta = document.createElement("p");
        meta.className = "card-metadata";
        const authors = Array.isArray(post.authors) ? post.authors.join(", ") : post.authors || "";
        const pubYear = [post.publisher, post.year].filter(Boolean).join(" • ");
        meta.textContent = [authors, pubYear].filter(Boolean).join(" — ");
        container.appendChild(meta);
    }

    // Language
    if (post.language) {
        const lan = document.createElement("p");
        lan.className = "card-language";
        lan.textContent = post.language;
        container.appendChild(lan);
    }

    // Description / abstract snippet
    if (post.description) {
        const desc = document.createElement("p");
        desc.className = "card-description";
        desc.textContent = post.description;
        container.appendChild(desc);
    }

    const openButton = contentLink("research", post, createResearchPage);
    container.appendChild(openButton);

    return container;
}

// ─────────────────────────────────────
async function addResearch() {
    const articlesDiv = document.getElementById("divResearch");
    if (!articlesDiv) return;

    const response = await fetch("/json/articles.json");
    if (!response.ok) throw new Error("Unable to load research");
    const articles = await response.json();
    researchDataCache = ContentURLs.assignSlugs(Array.isArray(articles) ? articles : [], "research");

    articlesDiv.innerHTML = "";

    for (let i = articles.length - 1; i >= 0; i--) {
        const post = articles[i];
        const card = addResearchCard(post);
        articlesDiv.prepend(card);
    }

    articlesDiv.querySelectorAll(".reveal-card").forEach((card) => observer.observe(card));
}

//╭─────────────────────────────────────╮
//│              Software               │
//╰─────────────────────────────────────╯
async function addSoftwares() {
    const softwareDiv = document.getElementById("divSoftware");
    const response = await fetch("json/software.json");
    const softwares = await response.json();

    softwareDiv.innerHTML = "";

    for (let i = softwares.length - 1; i >= 0; i--) {
        const item = softwares[i];

        const container = document.createElement("article");
        container.className = "content-card software-card reveal-card";
        container.dataset.snapCard = "true";

        // Title
        const title = document.createElement("h3");
        title.textContent = item.title;
        container.appendChild(title);

        // Image wrapper (uniform logo area)
        const imgWrapper = document.createElement("div");
        imgWrapper.className = "software-logo-frame";

        const img = document.createElement("img");
        img.src = item.img;
        img.alt = `${item.title} open-source music software logo by Charles K. Neimog`;
        img.loading = "lazy";
        img.decoding = "async";

        if (window.matchMedia("(prefers-color-scheme: dark)").matches && item.imgDark) {
            img.src = item.imgDark;
        }

        imgWrapper.appendChild(img);
        container.appendChild(imgWrapper);

        // Language icons
        if (item.language?.length) {
            const langContainer = document.createElement("div");
            langContainer.className = "software-languages";

            const languages = Array.isArray(item.language) ? item.language : [item.language];

            languages.forEach((lang) => {
                const iconClass = languageIcons[lang];

                if (iconClass) {
                    const icon = document.createElement("i");
                    icon.className = iconClass;
                    icon.title = lang;
                    icon.setAttribute("aria-label", lang);
                    langContainer.appendChild(icon);
                } else {
                    const p = document.createElement("p");
                    p.className = "card-language";
                    p.textContent = lang;
                    langContainer.appendChild(p);
                }
            });

            container.appendChild(langContainer);
        }

        // Description
        const desc = document.createElement("p");
        desc.className = "card-description";
        desc.textContent = item.description;
        container.appendChild(desc);

        if (item.authors?.length) {
            const authorLine = document.createElement("p");
            authorLine.className = "card-authors";
            authorLine.append("By ");
            item.authors.forEach((author, index) => {
                if (author === "Charles K. Neimog") {
                    const authorLink = document.createElement("a");
                    authorLink.href = "/#about";
                    authorLink.rel = "author";
                    authorLink.className = "underline";
                    authorLink.textContent = author;
                    authorLine.appendChild(authorLink);
                } else {
                    authorLine.append(author);
                }
                if (index < item.authors.length - 1) authorLine.append(", ");
            });
            container.appendChild(authorLine);
        }

        // Explicit project link keeps the interaction semantic and keyboard accessible.
        if (item.link) {
            const projectLink = document.createElement("a");
            projectLink.href = item.link;
            projectLink.target = "_blank";
            projectLink.rel = "noopener noreferrer";
            projectLink.className = "card-visit-link";
            projectLink.textContent = "Visit project →";
            projectLink.setAttribute("aria-label", `Visit ${item.title} project (opens in a new tab)`);
            container.appendChild(projectLink);
        }

        softwareDiv.prepend(container);
    }

    softwareDiv.querySelectorAll(".reveal-card").forEach((card) => observer.observe(card));
}

//╭─────────────────────────────────────╮
//│                Blog                 │
//╰─────────────────────────────────────╯
function createAudioElement(audio) {
    const source = audio.currentSrc || audio.src || audio.querySelector("source")?.src;
    if (!source) {
        console.warn("WaveSurfer: audio element missing source", audio);
        return;
    }

    // Div pai
    const parentWrapper = document.createElement("div");
    parentWrapper.style.width = "100%";
    parentWrapper.style.margin = "0 auto";
    parentWrapper.style.borderRadius = "12px";
    parentWrapper.style.overflow = "hidden";
    parentWrapper.className =
        "p-4 flex flex-col text-text-light-secondary dark:text-text-dark-secondary text-lg font-normal leading-relaxed tracking-wide blog-article markdown";

    parentWrapper.tabIndex = 0;
    parentWrapper.addEventListener("mouseenter", () => parentWrapper.focus());
    parentWrapper.addEventListener("mouseleave", () => parentWrapper.blur());

    audio.replaceWith(parentWrapper);

    // Div WaveSurfer
    const wavesurferWrapper = document.createElement("div");
    wavesurferWrapper.style.borderRadius = "12px";
    wavesurferWrapper.style.overflow = "hidden";
    parentWrapper.appendChild(wavesurferWrapper);

    // Inicializar WaveSurfer
    const root = document.documentElement;
    const strokeCol = getComputedStyle(root).getPropertyValue("--color-primary").trim();

    const wavesurfer = WaveSurfer.create({
        container: wavesurferWrapper,
        normalize: true,
        splitChannels: true,
        waveColor: strokeCol,
        progressColor: "#FF5733",
    });

    wavesurfer.load(source);

    // Botão só depois do WaveSurfer ready
    wavesurfer.on("ready", () => {
        // Div do botão
        const buttonWrapper = document.createElement("div");
        buttonWrapper.style.display = "flex";
        buttonWrapper.style.justifyContent = "center";
        buttonWrapper.style.marginTop = "10px"; // espaço entre wave e botão
        parentWrapper.appendChild(buttonWrapper);

        // Botão play/pause
        const playBtn = document.createElement("button");
        playBtn.setAttribute("aria-label", "Play/Pause");
        playBtn.className =
            "play-pause-button flex items-center justify-center h-12 w-12 rounded-full border border-gray-700 text-text-dark-secondary";

        const playIcon = document.createElement("span");
        playIcon.className = "material-symbols-outlined play-icon !text-3xl";
        playIcon.textContent = "play_arrow";

        const pauseIcon = document.createElement("span");
        pauseIcon.className = "material-symbols-outlined pause-icon !text-3xl";
        pauseIcon.textContent = "pause";
        pauseIcon.style.display = "none";

        playBtn.appendChild(playIcon);
        playBtn.appendChild(pauseIcon);
        buttonWrapper.appendChild(playBtn);

        const toggleIcons = () => {
            if (wavesurfer.isPlaying()) {
                playBtn.classList.add("playing");
                playIcon.style.display = "none";
                pauseIcon.style.display = "block";
            } else {
                playBtn.classList.remove("playing");
                playIcon.style.display = "block";
                pauseIcon.style.display = "none";
            }
        };

        playBtn.addEventListener("click", () => {
            wavesurfer.playPause();
            toggleIcons();
        });

        parentWrapper.addEventListener("keydown", (event) => {
            if (event.code === "Space") {
                event.preventDefault();
                wavesurfer.playPause();
                toggleIcons();
            }
        });

        wavesurfer.on("finish", () => toggleIcons());
    });
}

// ─────────────────────────────────────
function createBlogPage(post, { navigation = "push" } = {}) {
    if (!post) return;

    beginContentDialog("blog", post, navigation);

    const oldModal = document.getElementById("blog-modal");
    if (oldModal) oldModal.remove();

    const overlay = document.createElement("div");
    overlay.id = "blog-modal";
    overlay.className =
        "fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 sm:p-6 md:p-8";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "blog-modal-title");

    const modal = document.createElement("div");
    modal.className =
        "relative w-full max-w-4xl max-h-[90vh] " +
        "bg-background-light dark:bg-background-dark " +
        "rounded-xl border border-gray-300 dark:border-gray-700 flex flex-col max-sm:max-h-[90vh] max-sm:overflow-y-auto";

    const closeBtn = document.createElement("button");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.className =
        "absolute top-4 right-4 " +
        "text-text-light-secondary dark:text-text-dark-secondary " +
        "hover:text-text-light-primary dark:hover:text-text-dark-primary " +
        "transition-colors";

    const closeIcon = document.createElement("span");
    closeIcon.className = "material-symbols-outlined !text-3xl";
    closeIcon.textContent = "close";
    closeIcon.style.cursor = "pointer";
    closeBtn.appendChild(closeIcon);

    const closeDialog = () => {
        closeContentDialog(overlay);
    };
    closeBtn.addEventListener("click", closeDialog);

    const scroller = document.createElement("div");
    scroller.className = "overflow-y-auto p-8 md:p-12 max-sm:max-h-[80vh]";

    const header = document.createElement("header");
    header.className = "mb-10 space-y-2";

    const h2 = document.createElement("h2");
    h2.id = "blog-modal-title";
    h2.textContent = post.title;
    h2.className =
        "text-4xl md:text-5xl font-black tracking-tight leading-tight " +
        "text-text-light-primary dark:text-text-dark-primary";

    const meta = document.createElement("p");
    meta.textContent = `${post.date}`;
    meta.className = "text-text-light-secondary dark:text-text-dark-secondary text-sm md:text-base";

    header.appendChild(h2);
    header.appendChild(meta);
    const share = document.createElement("a");
    share.href = ContentURLs.url("blog", post);
    share.className = "text-primary text-sm underline";
    share.textContent = "Link to this post";
    header.appendChild(share);

    const article = document.createElement("article");
    article.className =
        "prose prose-lg max-w-none space-y-6 leading-relaxed " +
        "text-text-light-secondary dark:text-text-dark-secondary " +
        "prose-headings:text-text-light-primary dark:prose-headings:text-text-dark-primary";

    scroller.appendChild(header);
    scroller.appendChild(article);

    modal.appendChild(closeBtn);
    modal.appendChild(scroller);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    registerContentDialog(overlay, "blog", post);
    activateDialog(overlay, closeBtn, closeDialog);

    fetchMarkdown(post.file, article).then(() => {
        const elements = article.querySelectorAll("h1, h2, h3, p, a, img, ul, ol, li, figure, figcaption");

        elements.forEach((el) => {
            switch (el.tagName) {
                case "h2":
                    el.classList.add(
                        "text-4xl",
                        "md:text-5xl",
                        "font-black",
                        "!leading-tight",
                        "tracking-tight",
                        "!mb-8",
                        "text-text-light-primary",
                        "dark:text-text-dark-primary",
                    );
                    break;

                case "H2":
                    el.classList.add(
                        "text-3xl",
                        "font-bold",
                        "!mt-12",
                        "!mb-4",
                        "text-text-light-primary",
                        "dark:text-text-dark-primary",
                    );
                    break;

                case "H3":
                    el.classList.add(
                        "text-2xl",
                        "font-bold",
                        "!mt-10",
                        "!mb-4",
                        "text-text-light-primary",
                        "dark:text-text-dark-primary",
                    );
                    break;

                case "P":
                    el.classList.add(
                        "leading-relaxed",
                        "mb-4",
                        "text-text-light-secondary",
                        "dark:text-text-dark-secondary",
                    );
                    break;

                case "A":
                    el.classList.add(
                        "transition-colors",
                        "text-text-light-primary",
                        "dark:text-text-dark-primary",
                        "hover:text-classic-tech-blue",
                    );
                    el.target = "_blank";
                    break;

                case "IMG":
                    el.classList.add("w-full", "rounded-lg", "shadow-md", "my-6");
                    el.style.objectFit = "cover";
                    break;

                case "UL":
                case "OL":
                    el.classList.add("space-y-2", "pl-6", "my-4", "list-disc");
                    break;

                case "LI":
                    el.classList.add("leading-relaxed", "text-text-light-secondary", "dark:text-text-dark-secondary");
                    break;

                case "FIGURE":
                    el.classList.add("my-10");
                    break;

                case "FIGCAPTION":
                    el.classList.add(
                        "text-center",
                        "text-sm",
                        "mt-2",
                        "text-text-light-secondary",
                        "dark:text-text-dark-secondary",
                    );
                    break;
            }
        });
    });

    return overlay;
}

// ─────────────────────────────────────
async function addBlog() {
    const blogDiv = document.getElementById("divBlog");
    const response = await fetch("/json/blog.json");
    if (!response.ok) throw new Error("Unable to load blog posts");
    const posts = await response.json();
    blogDataCache = ContentURLs.assignSlugs(Array.isArray(posts) ? posts : [], "blog");

    blogDiv.innerHTML = "";

    for (let i = posts.length - 1; i >= 0; i--) {
        const post = posts[i];

        const container = document.createElement("article");
        container.className = "content-card blog-card reveal-card";
        container.dataset.snapCard = "true";

        // Date
        if (post.date) {
            const date = document.createElement("p");
            date.className = "card-metadata";
            date.textContent = post.date;
            container.appendChild(date);
        }

        // Title
        const title = document.createElement("h3");
        title.textContent = post.title;
        container.appendChild(title);

        // Description
        const desc = document.createElement("p");
        desc.className = "card-description";
        desc.textContent = post.description;
        container.appendChild(desc);

        const openButton = contentLink("blog", post, createBlogPage);
        container.appendChild(openButton);

        blogDiv.prepend(container);
    }

    blogDiv.querySelectorAll(".reveal-card").forEach((card) => observer.observe(card));
}

//╭─────────────────────────────────────╮
//│           Event Listener            │
//╰─────────────────────────────────────╯
document.addEventListener("DOMContentLoaded", async function () {
    const results = await Promise.allSettled([addMusics(), addResearch(), addSoftwares(), addBlog()]);
    results.forEach((result) => { if (result.status === "rejected") console.error(result.reason); });
    contentReady = true;
    synchronizeContentLocation();

    const listScroll = ["Music", "Research", "Software", "Blog"];

    listScroll.forEach((sectionName) => {
        setupHorizontalScroll(sectionName);
    });
});

function synchronizeContentLocation() {
    if (!contentReady) return;
    const params = new URLSearchParams(location.search);
    const kind = [MUSIC_QUERY_PARAM, RESEARCH_QUERY_PARAM, BLOG_QUERY_PARAM].find((key) => params.has(key));
    const caches = { music: musicDataCache, research: researchDataCache, blog: blogDataCache };
    const match = kind && ContentURLs.find(caches[kind], kind, params.get(kind));
    document.getElementById("content-not-found")?.remove();
    document.getElementById("content-error-robots")?.remove();
    if (match && activeContentDialog?.dataset.contentKind === kind && activeContentDialog.dataset.contentSlug === match.slug) return;
    activeContentDialog?.remove();
    activeContentDialog = null;
    if (match) {
        const open = { music: createMusicPage, research: createResearchPage, blog: createBlogPage }[kind];
        open(match, { navigation: "replace" });
    } else {
        ContentSEO.restore();
        if (kind) {
            const robots = document.createElement("meta");
            robots.id = "content-error-robots";
            robots.name = "robots";
            robots.content = "noindex";
            document.head.appendChild(robots);
            const message = document.createElement("p");
            message.id = "content-not-found";
            message.setAttribute("role", "status");
            message.textContent = "This content could not be found. Please choose an item below.";
            document.querySelector("main")?.prepend(message);
        }
    }
}

window.addEventListener("popstate", synchronizeContentLocation);

function setupHorizontalScroll(sectionName) {
    const containerId = "div" + sectionName;
    const idLeft = "scrollLeft" + sectionName;
    const idRight = "scrollRight" + sectionName;

    const leftButton = document.getElementById(idLeft);
    const rightButton = document.getElementById(idRight);
    const container = document.getElementById(containerId);

    if (!container) return;

    // Calcular a quantidade de scroll baseado no tamanho do card
    const getScrollAmount = () => {
        const firstCard = getSnapCards(container)[0];
        if (!firstCard) return 300; // fallback
        const styles = window.getComputedStyle(container);
        const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0;
        return firstCard.offsetWidth + gap;
    };

    const scrollByDirection = (direction) => {
        const cards = getSnapCards(container);
        if (isMobileViewport() && cards.length) {
            const currentIndex = getClosestCardIndex(container, cards);
            const targetIndex = Math.min(cards.length - 1, Math.max(0, currentIndex + direction));
            centerCardInContainer(container, cards[targetIndex]);
        } else {
            container.scrollBy({
                left: direction * getScrollAmount(),
                behavior: "smooth",
            });
        }
    };

    if (leftButton) {
        leftButton.addEventListener("click", () => scrollByDirection(-1));
    }

    if (rightButton) {
        rightButton.addEventListener("click", () => scrollByDirection(1));
    }

    const updateButtonState = () => {
        const cards = getSnapCards(container);

        if (!cards.length) {
            if (leftButton) leftButton.hidden = true;
            if (rightButton) rightButton.hidden = true;
            return;
        }

        const maxScroll = container.scrollWidth - container.clientWidth;
        const hasOverflow = maxScroll > SCROLL_EDGE_EPSILON;
        let atStart = container.scrollLeft <= SCROLL_EDGE_EPSILON;
        let atEnd = maxScroll - container.scrollLeft <= SCROLL_EDGE_EPSILON;

        if (isMobileViewport()) {
            const firstTarget = getCenteredScrollLeft(container, cards[0]);
            const lastTarget = getCenteredScrollLeft(container, cards[cards.length - 1]);
            atStart = Math.abs(container.scrollLeft - firstTarget) <= SCROLL_EDGE_EPSILON;
            atEnd = Math.abs(container.scrollLeft - lastTarget) <= SCROLL_EDGE_EPSILON;
        }

        if (leftButton) {
            leftButton.hidden = !hasOverflow;
            leftButton.disabled = atStart;
        }
        if (rightButton) {
            rightButton.hidden = !hasOverflow;
            rightButton.disabled = atEnd;
        }
    };

    container.addEventListener("scroll", updateButtonState, { passive: true });
    updateButtonState();

    const centerInitialCard = () => {
        if (!isMobileViewport()) return;
        const cards = getSnapCards(container);
        if (cards.length) {
            centerCardInContainer(container, cards[0], "auto");
        }
    };

    centerInitialCard();
    updateButtonState();
    window.addEventListener("resize", updateButtonState, { passive: true });
}
