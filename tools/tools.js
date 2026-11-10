const CARD_MIN_WIDTH = 320;
let toolsResizeObserver;
let toolsResizeHandler;

function createTalkCard(talk, index) {
  const card = document.createElement("article");
  card.className =
    "text-left flex-shrink-0 border border-gray-300 dark:border-gray-700 p-6 rounded-lg transition-shadow duration-300 reveal-card pf snap-center md:snap-start max-sm:w-full max-sm:max-w-[90vw] max-sm:min-w-[85vw] max-sm:max-h-[70vh] max-sm:overflow-y-auto";
  card.dataset.snapCard = "true";
  card.style.transitionDelay = `${index * 200}ms`;
  card.style.cursor = talk.link ? "pointer" : "default";
  card.style.width = "100%";

  const talkDate = parseTalkDate(talk.date);
  const formattedDate = talkDate
    ? talkDate.toLocaleDateString("pt-BR", { year: "numeric", month: "short", day: "2-digit" })
    : talk.date || null;
  const metaParts = [formattedDate, talk.language].filter(Boolean);
  if (metaParts.length) {
    const meta = document.createElement("p");
    meta.className = "text-sm font-medium text-text-light-secondary dark:text-text-dark-secondary";
    meta.textContent = metaParts.join(" • ");
    card.appendChild(meta);
  }

  const status = document.createElement("span");
  status.className =
    "mt-3 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full border " +
    (talk.locked
      ? "text-amber-400 border-amber-400/40 bg-amber-500/10"
      : "text-emerald-400 border-emerald-400/40 bg-emerald-500/10");
  const statusIcon = document.createElement("span");
  statusIcon.className = "material-symbols-outlined text-base";
  statusIcon.textContent = talk.locked ? "lock" : "lock_open";
  const statusLabel = document.createElement("span");
  statusLabel.textContent = talk.locked ? "Password required" : "Open access";
  status.append(statusIcon, statusLabel);
  card.appendChild(status);

  const title = document.createElement("h4");
  title.className = "mt-2 text-xl font-bold text-text-light-primary dark:text-text-dark-primary";
  title.textContent = talk.title || "Untitled talk";
  card.appendChild(title);

  const desc = document.createElement("p");
  desc.className = "mt-3 text-base text-text-light-secondary dark:text-text-dark-secondary leading-relaxed";
  desc.textContent = talk.description || "Details will be available soon.";
  card.appendChild(desc);

  if (talk.link) {
    const cta = document.createElement("button");
    cta.type = "button";
    cta.className =
      "mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-classic-tech-blue transition-colors";
    cta.textContent = "Open Tool";
    cta.title = talk.locked ? "This presentation is protected—enter the password on open." : "Open presentation";
    cta.addEventListener("click", (event) => {
      event.stopPropagation();
      window.open(talk.link, "_blank");
    });
    card.appendChild(cta);

    card.addEventListener("click", () => window.open(talk.link, "_blank"));
  }

  return card;
}

document.addEventListener("DOMContentLoaded", () => {
  addTools().catch((error) => console.error("tools init failed:", error));
});

async function addTools() {
  const container = document.getElementById("containerTools");
  if (!container) return;

  container.innerHTML =
    '<p class="text-sm text-text-light-secondary dark:text-text-dark-secondary">Loading tools…</p>';

  try {
    const response = await fetch("tools.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const tools = Array.isArray(payload) ? payload : [];

    if (!tools.length) {
      container.innerHTML =
        '<p class="text-sm text-text-light-secondary dark:text-text-dark-secondary">No tools yet—check back soon.</p>';
      return;
    }

    container.innerHTML = "";
    const sortedtools = tools
      .slice()
      .sort((a, b) => {
        const dateA = parseTalkDate(a.date);
        const dateB = parseTalkDate(b.date);
        return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
      });

    sortedtools.forEach((talk, index) => container.appendChild(createTalkCard(talk, index)));
    // set opacity to 1 after a short delay to trigger fade-in
    setTimeout(() => {
      container.querySelectorAll(".reveal-card").forEach((card) => {
        card.style.opacity = "1";
      });
    }, 150);

    setuptoolsLayout(container);

    if (typeof observer !== "undefined") {
      container.querySelectorAll(".reveal-card").forEach((card) => observer.observe(card));
    }
  } catch (error) {
    console.error("Failed to load tools:", error);
    container.innerHTML =
      '<p class="text-sm text-red-400">Unable to load tools right now. Please try again later.</p>';
  }
}

function setuptoolsLayout(container) {
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
    toolsResizeObserver?.disconnect();
    toolsResizeObserver = new ResizeObserver(applyLayout);
    toolsResizeObserver.observe(container);
  } else if (!toolsResizeHandler) {
    toolsResizeHandler = applyLayout;
    window.addEventListener("resize", toolsResizeHandler, { passive: true });
  }
}

function parseTalkDate(value) {
  if (!value) return null;
  const slashMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return new Date(`${year}-${month}-${day}T00:00:00`);
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}