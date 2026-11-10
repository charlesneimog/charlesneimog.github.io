(() => {
    "use strict";

    const STORAGE_X = "charles-neimog:stuck-pixel:x";
    const STORAGE_Y = "charles-neimog:stuck-pixel:y";
    const MIN_POSITION = 0.05;
    const MAX_POSITION = 0.95;

    const isValidCoordinate = (value) => Number.isFinite(value) && value >= MIN_POSITION && value <= MAX_POSITION;

    let normalizedX;
    let normalizedY;

    try {
        normalizedX = Number.parseFloat(sessionStorage.getItem(STORAGE_X));
        normalizedY = Number.parseFloat(sessionStorage.getItem(STORAGE_Y));

        if (!isValidCoordinate(normalizedX) || !isValidCoordinate(normalizedY)) {
            normalizedX = MIN_POSITION + Math.random() * (MAX_POSITION - MIN_POSITION);
            normalizedY = MIN_POSITION + Math.random() * (MAX_POSITION - MIN_POSITION);
            sessionStorage.setItem(STORAGE_X, String(normalizedX));
            sessionStorage.setItem(STORAGE_Y, String(normalizedY));
        }
    } catch {
        normalizedX = MIN_POSITION + Math.random() * (MAX_POSITION - MIN_POSITION);
        normalizedY = MIN_POSITION + Math.random() * (MAX_POSITION - MIN_POSITION);
    }

    if (document.getElementById("stuck-pixel")) return;

    const pixel = document.createElement("div");
    pixel.id = "stuck-pixel";
    pixel.setAttribute("aria-hidden", "true");
    Object.assign(pixel.style, {
        backgroundColor: "#00ff66",
        border: "0",
        boxShadow: "none",
        contain: "strict",
        margin: "0",
        padding: "0",
        pointerEvents: "none",
        position: "fixed",
        transition: "none",
        userSelect: "none",
        height: "3px",
        width: "3px",
        zIndex: "2147483647",
    });

    const positionPixel = () => {
        const left = Math.min(window.innerWidth - 1, Math.round(window.innerWidth * normalizedX));
        const top = Math.min(window.innerHeight - 1, Math.round(window.innerHeight * normalizedY));
        pixel.style.left = `${left}px`;
        pixel.style.top = `${top}px`;
    };

    positionPixel();
    document.body.appendChild(pixel);

    let resizeTimer;
    window.addEventListener(
        "resize",
        () => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(positionPixel, 180);
        },
        { passive: true },
    );
})();
