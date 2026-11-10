(() => {
    const CARD_MIN_WIDTH = 320;
    const CURRENT_YEAR = new Date().getFullYear();
    const COURSE_PAGE_VERSION = "2";
    let classesResizeObserver;
    let classesResizeHandler;

    function createClassCard(classEntry, index) {
        const courseLink = getCourseLink(classEntry);
        const card = document.createElement("article");
        card.className =
            "text-left flex-shrink-0 border border-gray-300 dark:border-gray-700 p-6 rounded-lg transition-shadow duration-300 reveal-card pf snap-center md:snap-start max-sm:w-full max-sm:max-w-[90vw] max-sm:min-w-[85vw] max-sm:max-h-[70vh] max-sm:overflow-y-auto";
        card.dataset.snapCard = "true";
        card.style.transitionDelay = `${index * 200}ms`;
        card.style.cursor = courseLink ? "pointer" : "default";
        card.style.width = "100%";

        const metaParts = [classEntry.date, classEntry.language].filter(Boolean);
        if (metaParts.length) {
            const meta = document.createElement("p");
            meta.className = "text-sm font-medium text-text-light-secondary dark:text-text-dark-secondary";
            meta.textContent = metaParts.join(" • ");
            card.appendChild(meta);
        }

        const status = document.createElement("span");
        status.className =
            "mt-3 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border " +
            (classEntry.locked
                ? "text-amber-400 border-amber-400/40 bg-amber-500/10"
                : "text-emerald-400 border-emerald-400/40 bg-emerald-500/10");

        const statusIcon = document.createElement("span");
        statusIcon.className = "material-symbols-outlined text-base";
        statusIcon.textContent = classEntry.locked ? "lock" : "lock_open";

        const statusLabel = document.createElement("span");
        statusLabel.textContent = classEntry.locked ? "Password required" : "Open access";
        status.append(statusIcon, statusLabel);
        card.appendChild(status);

        const title = document.createElement("h3");
        title.className = "mt-2 text-xl font-bold text-text-light-primary dark:text-text-dark-primary";
        title.textContent = classEntry.title || "Untitled class";
        card.appendChild(title);

        const description = document.createElement("p");
        description.className =
            "mt-3 text-base text-text-light-secondary dark:text-text-dark-secondary leading-relaxed";
        description.textContent = classEntry.description || "Details will be available soon.";
        card.appendChild(description);

        if (courseLink) {
            const cta = document.createElement("button");
            cta.type = "button";
            cta.className =
                "mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-classic-tech-blue transition-colors";
            cta.textContent = "View class";
            cta.title = classEntry.locked
                ? "This class is protected—enter the password to continue."
                : "Open class";
            cta.addEventListener("click", (event) => {
                event.stopPropagation();
                window.location.href = courseLink;
            });
            card.appendChild(cta);

            card.addEventListener("click", () => {
                window.location.href = courseLink;
            });
        }

        return card;
    }

    function getCourseLink(classEntry) {
        if (!classEntry.path) return classEntry.link || "";
        return `course.html?${new URLSearchParams({ v: COURSE_PAGE_VERSION, course: classEntry.path })}`;
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.querySelectorAll("[data-current-year]").forEach((element) => {
            element.textContent = String(CURRENT_YEAR);
        });

        addClasses().catch((error) => console.error("Classes init failed:", error));
    });

    async function addClasses() {
        const container = document.getElementById("containerClasses");
        if (!container) return;

        container.innerHTML =
            '<p class="text-sm text-text-light-secondary dark:text-text-dark-secondary">Loading classes…</p>';

        try {
            const response = await fetch("classes.json", { cache: "no-store" });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const payload = await response.json();
            const classes = Array.isArray(payload)
                ? payload.filter(
                      (classEntry) => classEntry.render !== false && Number(classEntry.year) === CURRENT_YEAR,
                  )
                : [];

            if (!classes.length) {
                container.innerHTML = `<p class="text-sm text-text-light-secondary dark:text-text-dark-secondary">No classes available for ${CURRENT_YEAR}.</p>`;
                return;
            }

            container.innerHTML = "";
            classes.forEach((classEntry, index) => {
                container.appendChild(createClassCard(classEntry, index));
            });

            setTimeout(() => {
                container.querySelectorAll(".reveal-card").forEach((card) => {
                    card.style.opacity = "1";
                });
            }, 150);

            setupClassesLayout(container);

            if (typeof observer !== "undefined") {
                container.querySelectorAll(".reveal-card").forEach((card) => observer.observe(card));
            }
        } catch (error) {
            console.error("Failed to load classes:", error);
            container.innerHTML =
                '<p class="text-sm text-red-400">Unable to load classes right now. Please try again later.</p>';
        }
    }

    function setupClassesLayout(container) {
        const applyLayout = () => {
            const width = container.clientWidth || container.parentElement?.clientWidth || window.innerWidth;
            const columns = Math.max(1, Math.floor(width / CARD_MIN_WIDTH));
            container.style.display = "grid";
            container.style.gridTemplateColumns = `repeat(${columns}, minmax(${CARD_MIN_WIDTH}px, 1fr))`;
            container.style.gap = "1.5rem";
            container.style.alignItems = "stretch";
        };

        applyLayout();

        if (typeof ResizeObserver !== "undefined") {
            classesResizeObserver?.disconnect();
            classesResizeObserver = new ResizeObserver(applyLayout);
            classesResizeObserver.observe(container);
        } else if (!classesResizeHandler) {
            classesResizeHandler = applyLayout;
            window.addEventListener("resize", classesResizeHandler, { passive: true });
        }
    }
})();
