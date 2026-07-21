const dataUrl = "data/le-hussard-links.json";
const searchDebounceMs = 350;
const skeletonCardCount = 6;

const state = {
  data: null,
  query: "",
  searchTracked: false,
};

const bookGrid = document.querySelector("#bookGrid");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const searchBox = document.querySelector("#catalogue .search-box");
const searchControls = document.querySelector("#catalogue .controls");
const toolbar = document.querySelector("#catalogue");
const template = document.querySelector("#bookCardTemplate");

const formatDate = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

function normalize(value) {
  return value
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function slugify(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function track(eventName, properties = {}) {
  const cleanProperties = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined && value !== ""),
  );

  window.posthog?.capture?.(eventName, cleanProperties);
}

function trackExternalNavigation(properties) {
  track("external navigation triggered", properties);
}

function debounce(callback, delay) {
  let timeoutId;

  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => callback(...args), delay);
  };
}

function getAmazonLinks(data) {
  return data.videos.flatMap((video) =>
    video.links
      .filter((link) => link.type === "amazon")
      .map((link) => ({
        ...link,
        videoTitle: video.title,
        videoUrl: video.youtubeUrl,
      })),
  );
}

function getBookKey(link) {
  return normalize(`${link.label} ${link.author || ""}`.trim());
}

function dedupeBookLinks(links) {
  const seen = new Set();
  const uniqueLinks = [];

  for (const link of links) {
    const key = getBookKey(link);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueLinks.push(link);
  }

  return uniqueLinks;
}

function updateStats(data) {
  const amazonLinks = dedupeBookLinks(getAmazonLinks(data));
  const sourceVideos = new Set(amazonLinks.map((link) => link.videoUrl));

  document.querySelector("#updatedAt").textContent = formatDate.format(new Date(data.generatedAt));
  document.querySelector("#amazonCount").textContent = amazonLinks.length;
  document.querySelector("#videoCount").textContent = sourceVideos.size;
}

function getFilteredLinks() {
  const query = normalize(state.query.trim());
  const amazonLinks = dedupeBookLinks(getAmazonLinks(state.data));

  if (!query) {
    return amazonLinks;
  }

  return amazonLinks.filter((link) => normalize(`${link.label} ${link.author || ""} ${link.videoTitle}`).includes(query));
}

function render() {
  const links = getFilteredLinks();
  bookGrid.removeAttribute("aria-busy");
  bookGrid.replaceChildren();
  resultCount.textContent = `Plus de ${links.length} lien${links.length > 1 ? "s" : ""} Amazon disponible${links.length > 1 ? "s" : ""} !`;

  if (links.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun livre ne correspond à cette recherche. Essayez un autre titre ou auteur.";
    bookGrid.append(empty);
    return;
  }

  links.forEach((link, index) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const title = card.querySelector("h3");
    const author = card.querySelector(".book-author");
    const amazonLink = card.querySelector(".amazon-link");
    const sourceLink = card.querySelector(".source-link");
    const sourceTitle = card.querySelector(".source-link strong");

    card.style.animationDelay = `${Math.min(index, 10) * 35}ms`;
    title.textContent = link.label;
    author.textContent = link.author ? link.author : "";
    author.hidden = !link.author;
    amazonLink.href = link.url;
    amazonLink.dataset.trackDestinationType = "amazon";
    amazonLink.dataset.trackDestination = "amazon";
    amazonLink.dataset.trackSurface = "book_card";
    amazonLink.dataset.trackItemId = slugify(`${link.label}-${link.url}`);
    amazonLink.dataset.trackItemTitle = link.label;
    sourceLink.href = link.videoUrl;
    sourceTitle.textContent = link.videoTitle;
    bookGrid.append(card);
  });
}

function renderSkeletons() {
  bookGrid.setAttribute("aria-busy", "true");
  resultCount.textContent = "Chargement du catalogue...";
  bookGrid.replaceChildren(
    ...Array.from({ length: skeletonCardCount }, () => {
      const card = document.createElement("article");
      card.className = "book-card book-card-skeleton";
      card.setAttribute("aria-hidden", "true");
      card.innerHTML = `
        <div class="book-spine"></div>
        <div class="book-body">
          <span class="skeleton-line skeleton-kicker"></span>
          <span class="skeleton-line skeleton-title"></span>
          <span class="skeleton-line skeleton-title skeleton-title-short"></span>
          <span class="skeleton-line skeleton-author"></span>
          <span class="skeleton-pill"></span>
        </div>
        <div class="source-link skeleton-source">
          <span class="skeleton-line skeleton-source-label"></span>
          <span class="skeleton-line skeleton-source-title"></span>
        </div>
      `;
      return card;
    }),
  );
}

const applySearchQuery = debounce((query) => {
  state.query = query;

  if (state.data) {
    render();
  }
}, searchDebounceMs);

searchInput.addEventListener("input", (event) => {
  const nextQuery = event.target.value;

  if (!state.searchTracked && nextQuery.length > 0) {
    state.searchTracked = true;
    track("search used", {
      surface: "catalogue",
    });
  }

  applySearchQuery(nextQuery);
});

function setupSearchDock() {
  if (!searchBox || !searchControls || !toolbar) {
    return;
  }

  const dockMaxWidth = 880;
  const dockTop = 12;
  const durationMs = 380;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let docked = false;
  // 0 = fully in the toolbar cell, 1 = fully docked at the top. The animation is
  // driven manually (rather than via a CSS transition) so each frame can read the
  // live in-flow cell position — that way the box tracks the cell even while the
  // user keeps scrolling during the transition, and lands on it with no snap.
  let progress = 0;
  let rafId = null;
  let animFrom = 0;
  let animTo = 0;
  let animStart = 0;
  // Vertical distance from the search box's top to the input's top in normal
  // flow (the "Recherche" label height + gap). While docked the label is hidden,
  // so we anchor the animation to the input's position — otherwise the label
  // reappearing on undock would shove the input down and cause a snap.
  let labelOffset = 0;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const getDockTarget = () => {
    const width = Math.min(dockMaxWidth, window.innerWidth * 0.92);
    return { width, left: (window.innerWidth - width) / 2, top: dockTop };
  };

  // Geometry at a given progress: interpolate between the live in-flow cell (0)
  // and the docked target (1). Both are read fresh so scrolling/resizing is
  // tracked continuously.
  const geometryAt = (p) => {
    const cell = searchControls.getBoundingClientRect();
    const target = getDockTarget();
    // In-flow endpoint is the input's top (cell top + label offset), since the
    // label is hidden while docked and reclaims that space on undock.
    const originTop = cell.top + labelOffset;
    return {
      left: cell.left + (target.left - cell.left) * p,
      top: originTop + (target.top - originTop) * p,
      width: cell.width + (target.width - cell.width) * p,
    };
  };

  const applyGeometry = (p) => {
    const { left, top, width } = geometryAt(p);
    searchBox.style.width = `${width}px`;
    searchBox.style.transform = `translate(${left}px, ${top}px)`;
  };

  const finishUndock = () => {
    // Guard against a re-dock that happened mid-transition.
    if (docked) {
      return;
    }
    const hadFocus = document.activeElement === searchInput;
    // Move back into the toolbar cell (still fixed, so no visual jump), then drop
    // the fixed positioning so it resumes normal flow exactly in place.
    searchControls.appendChild(searchBox);
    searchBox.classList.remove("is-docked");
    searchBox.style.transform = "";
    searchBox.style.width = "";
    searchControls.style.minHeight = "";
    if (hadFocus) {
      searchInput.focus({ preventScroll: true });
    }
  };

  const frame = (now) => {
    const linear = durationMs <= 0 ? 1 : Math.min((now - animStart) / durationMs, 1);
    progress = animFrom + (animTo - animFrom) * easeOutCubic(linear);
    applyGeometry(progress);

    if (linear < 1) {
      rafId = window.requestAnimationFrame(frame);
      return;
    }

    rafId = null;
    progress = animTo;
    if (animTo === 0) {
      finishUndock();
    }
  };

  const animateTo = (target) => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }

    if (prefersReducedMotion) {
      progress = target;
      applyGeometry(progress);
      if (target === 0) {
        finishUndock();
      }
      return;
    }

    animFrom = progress;
    animTo = target;
    animStart = performance.now();
    rafId = window.requestAnimationFrame(frame);
  };

  const dock = () => {
    if (docked) {
      return;
    }
    docked = true;

    // Freeze the toolbar cell height so the layout below does not jump when the
    // search box leaves the normal flow.
    const rect = searchBox.getBoundingClientRect();
    const hadFocus = document.activeElement === searchInput;
    // Measure the label offset now, while the label is still laid out.
    labelOffset = searchInput.getBoundingClientRect().top - rect.top;
    searchControls.style.minHeight = `${rect.height}px`;

    // The .toolbar has an animation that leaves a non-none transform, which would
    // make it the containing block for our fixed box (positioning it relative to
    // the scrolled-away toolbar instead of the viewport). Reparent to <body> so
    // fixed positioning is genuinely viewport-relative.
    document.body.appendChild(searchBox);
    if (hadFocus) {
      searchInput.focus({ preventScroll: true });
    }

    searchBox.classList.add("is-docked");
    applyGeometry(progress); // start exactly where the box currently sits
    animateTo(1);
  };

  const undock = () => {
    if (!docked) {
      return;
    }
    docked = false;
    animateTo(0);
  };

  // Keep the docked pill centered/sized correctly across viewport resizes while
  // it is docked and idle (during an animation the rAF loop already tracks it).
  window.addEventListener("resize", () => {
    if (docked && rafId === null) {
      applyGeometry(progress);
    }
  });

  // Dock once the catalogue toolbar has scrolled up out of view; undock when it
  // scrolls back in.
  const observer = new IntersectionObserver(
    ([entry]) => {
      const scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      if (scrolledPast) {
        dock();
      } else {
        undock();
      }
    },
    { threshold: 0 },
  );

  observer.observe(toolbar);
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-track-destination-type]");

  if (!link) {
    return;
  }

  trackExternalNavigation({
    destination_type: link.dataset.trackDestinationType,
    destination: link.dataset.trackDestination,
    surface: link.dataset.trackSurface,
    item_id: link.dataset.trackItemId,
    item_title: link.dataset.trackItemTitle,
  });
});

async function boot() {
  try {
    track("landing page viewed", {
      page: "home",
    });
    renderSkeletons();

    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Impossible de charger ${dataUrl}`);
    }

    state.data = await response.json();
    updateStats(state.data);
    render();
  } catch (error) {
    bookGrid.innerHTML = `<div class="empty-state">Le catalogue n'a pas pu être chargé. Lancez <code>npm run update-data</code>, puis servez le site avec <code>npm start</code>.</div>`;
    console.error(error);
  }
}

setupSearchDock();
boot();
