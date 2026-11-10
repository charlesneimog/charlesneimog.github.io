document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector("[data-mobile-nav]");
    const toggle = nav?.querySelector("[data-mobile-nav-toggle]");
    const menu = nav?.querySelector("[data-mobile-nav-menu]");
    const moreMenu = nav?.querySelector("[data-more-menu]");
    const moreToggle = moreMenu?.querySelector("[data-more-menu-toggle]");
    const morePanel = moreMenu?.querySelector("[data-more-menu-panel]");

    if (!nav || !toggle || !menu) return;

    const setMenuOpen = (isOpen) => {
        toggle.setAttribute("aria-expanded", String(isOpen));
        toggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
        menu.hidden = !isOpen;
        nav.classList.toggle("mobile-nav-open", isOpen);
    };

    const setMoreOpen = (isOpen, returnFocus = false) => {
        if (!moreToggle || !morePanel) return;

        moreToggle.setAttribute("aria-expanded", String(isOpen));
        morePanel.hidden = !isOpen;
        if (returnFocus) moreToggle.focus();
    };

    toggle.addEventListener("click", () => {
        setMenuOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    moreToggle?.addEventListener("click", () => {
        setMoreOpen(moreToggle.getAttribute("aria-expanded") !== "true");
    });

    moreToggle?.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowDown") return;

        event.preventDefault();
        setMoreOpen(true);
        morePanel.querySelector("a")?.focus();
    });

    morePanel?.addEventListener("keydown", (event) => {
        const links = [...morePanel.querySelectorAll("a")];
        const currentIndex = links.indexOf(document.activeElement);
        let nextIndex;

        if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % links.length;
        else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + links.length) % links.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = links.length - 1;
        else return;

        event.preventDefault();
        links[nextIndex]?.focus();
    });

    morePanel?.addEventListener("click", (event) => {
        if (event.target.closest("a")) setMoreOpen(false);
    });

    menu.addEventListener("click", (event) => {
        if (event.target.closest("a")) setMenuOpen(false);
    });

    document.addEventListener("click", (event) => {
        if (!nav.contains(event.target)) setMenuOpen(false);
        if (moreMenu && !moreMenu.contains(event.target)) setMoreOpen(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;

        if (moreToggle?.getAttribute("aria-expanded") === "true") {
            setMoreOpen(false, true);
        } else if (toggle.getAttribute("aria-expanded") === "true") {
            setMenuOpen(false);
            toggle.focus();
        }
    });

    window.matchMedia("(min-width: 960px)").addEventListener("change", (event) => {
        if (event.matches) setMenuOpen(false);
        else setMoreOpen(false);
    });
});
