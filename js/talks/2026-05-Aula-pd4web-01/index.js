
            const viewer = new URL("../slide.html", window.location.href);
            viewer.searchParams.set("talk", "2026-05-Aula-pd4web-01/slide.md");
            viewer.hash = window.location.hash;
            window.location.replace(viewer.href);
        