const dataUrl = "data/le-hussard-links.json";
const searchDebounceMs = 350;
const skeletonCardCount = 6;

const state = {
  data: null,
  query: "",
  searchTracked: false,
  mode: "all", // "all" | "authors" | "videos"
  selectedAuthor: null,
  selectedVideo: null,
  videoSort: { field: "date", dir: "desc" }, // field: "alpha" | "date"; dir: "asc" | "desc"
};

const bookGrid = document.querySelector("#bookGrid");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const searchBox = document.querySelector("#catalogue .search-box");
const searchControls = document.querySelector("#catalogue .controls");
const toolbar = document.querySelector("#catalogue");
const template = document.querySelector("#bookCardTemplate");
const facetList = document.querySelector("#facetList");
const browseModes = document.querySelector(".browse-modes");
const facetSort = document.querySelector("#facetSort");
const sortDir = document.querySelector("#sortDir");
// Assigned by setupSearchDock; lets a browse-mode change re-evaluate docking.
let refreshSearchDock = () => {};

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

function getBooks() {
  return dedupeBookLinks(getAmazonLinks(state.data));
}

function getAuthorFacets(books) {
  const counts = new Map();
  for (const book of books) {
    if (!book.author) {
      continue;
    }
    counts.set(book.author, (counts.get(book.author) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([author, count]) => ({ key: author, label: author, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

function getVideoFacets(books) {
  // Videos are stored newest-first, so the array index is a date proxy:
  // order 0 = most recent, higher order = older.
  const orderByUrl = new Map(state.data.videos.map((video, index) => [video.youtubeUrl, index]));

  const byVideo = new Map();
  for (const book of books) {
    const existing = byVideo.get(book.videoUrl);
    if (existing) {
      existing.count += 1;
    } else {
      byVideo.set(book.videoUrl, {
        key: book.videoUrl,
        label: book.videoTitle,
        count: 1,
        order: orderByUrl.get(book.videoUrl) ?? Number.MAX_SAFE_INTEGER,
      });
    }
  }

  const { field, dir } = state.videoSort;
  const sign = dir === "asc" ? 1 : -1;

  return [...byVideo.values()].sort((a, b) => {
    if (field === "alpha") {
      return sign * a.label.localeCompare(b.label, "fr");
    }
    // "asc" (increasing date) = oldest first = higher order first.
    return sign * (b.order - a.order);
  });
}

function updateStats(data) {
  const amazonLinks = dedupeBookLinks(getAmazonLinks(data));
  const sourceVideos = new Set(amazonLinks.map((link) => link.videoUrl));

  document.querySelector("#updatedAt").textContent = formatDate.format(new Date(data.generatedAt));
  document.querySelector("#amazonCount").textContent = amazonLinks.length;
  document.querySelector("#videoCount").textContent = sourceVideos.size;
}

function getFilteredLinks() {
  let books = getBooks();

  if (state.mode === "authors" && state.selectedAuthor) {
    books = books.filter((book) => book.author === state.selectedAuthor);
  } else if (state.mode === "videos" && state.selectedVideo) {
    books = books.filter((book) => book.videoUrl === state.selectedVideo);
  }

  // In "all" mode the search filters the books directly. In a browse mode the
  // search filters the facet chips instead (see renderFacets), so the selected
  // author/video keeps showing its books.
  if (state.mode === "all") {
    const query = normalize(state.query.trim());
    if (query) {
      books = books.filter((link) =>
        normalize(`${link.label} ${link.author || ""} ${link.videoTitle}`).includes(query),
      );
    }
  }

  return books;
}

function makeInfo(text) {
  const info = document.createElement("div");
  info.className = "empty-state";
  info.textContent = text;
  return info;
}

function describeResults(count) {
  const plural = count > 1 ? "s" : "";
  if (state.mode === "authors" && state.selectedAuthor) {
    return `${count} livre${plural} de ${state.selectedAuthor}`;
  }
  if (state.mode === "videos" && state.selectedVideo) {
    return `${count} livre${plural} dans cette vidéo`;
  }
  if (state.query.trim()) {
    return `${count} livre${plural} trouvé${plural}`;
  }
  return `Plus de ${count} lien${plural} Amazon disponible${plural} !`;
}

function render() {
  renderFacets();
  renderBooks();
}

function renderFacets() {
  // The sort bar only applies to the video list.
  facetSort.hidden = state.mode !== "videos";
  if (state.mode === "videos") {
    updateSortControl();
  }

  if (state.mode === "all") {
    facetList.hidden = true;
    facetList.replaceChildren();
    return;
  }

  const books = getBooks();
  let facets = state.mode === "authors" ? getAuthorFacets(books) : getVideoFacets(books);

  const query = normalize(state.query.trim());
  if (query) {
    facets = facets.filter((facet) => normalize(facet.label).includes(query));
  }

  facetList.hidden = false;
  facetList.replaceChildren();

  if (facets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "facet-empty";
    empty.textContent = "Aucun résultat pour cette recherche.";
    facetList.append(empty);
    return;
  }

  const selectedKey = state.mode === "authors" ? state.selectedAuthor : state.selectedVideo;

  for (const facet of facets) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "facet-chip";
    chip.dataset.facetKey = facet.key;
    const active = facet.key === selectedKey;
    chip.classList.toggle("is-active", active);
    chip.setAttribute("aria-pressed", String(active));

    const label = document.createElement("span");
    label.className = "facet-label";
    label.textContent = facet.label;

    const count = document.createElement("span");
    count.className = "facet-count";
    count.textContent = facet.count;

    chip.append(label, count);
    facetList.append(chip);
  }
}

function renderBooks() {
  bookGrid.removeAttribute("aria-busy");
  bookGrid.replaceChildren();

  // In a browse mode with nothing selected yet, prompt the user to pick one.
  if (state.mode === "authors" && !state.selectedAuthor) {
    resultCount.textContent = "Choisissez un auteur pour afficher ses livres.";
    bookGrid.append(makeInfo("Sélectionnez un auteur dans la liste ci-dessus pour voir ses livres."));
    return;
  }
  if (state.mode === "videos" && !state.selectedVideo) {
    resultCount.textContent = "Choisissez une vidéo pour afficher ses livres.";
    bookGrid.append(makeInfo("Sélectionnez une vidéo dans la liste ci-dessus pour voir ses livres."));
    return;
  }

  const links = getFilteredLinks();
  resultCount.textContent = describeResults(links.length);

  if (links.length === 0) {
    bookGrid.append(
      makeInfo("Aucun livre ne correspond à cette recherche. Essayez un autre titre ou auteur."),
    );
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

function updateModeButtons() {
  for (const button of browseModes.querySelectorAll(".browse-mode")) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function updateSearchPlaceholder() {
  searchInput.placeholder =
    state.mode === "authors"
      ? "Rechercher un auteur..."
      : state.mode === "videos"
        ? "Rechercher une vidéo..."
        : "Ex: titre, auteur, vidéo...";
}

const sortDirLabels = {
  alpha: { asc: "A → Z", desc: "Z → A" },
  date: { asc: "Plus ancien", desc: "Plus récent" },
};

function updateSortControl() {
  const { field, dir } = state.videoSort;

  for (const button of facetSort.querySelectorAll(".sort-btn")) {
    const active = button.dataset.sortField === field;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }

  sortDir.textContent = sortDirLabels[field][dir];
  sortDir.dataset.dir = dir;
}

facetSort?.addEventListener("click", (event) => {
  const fieldButton = event.target.closest(".sort-btn");
  const dirButton = event.target.closest(".sort-dir");

  if (fieldButton && fieldButton.dataset.sortField !== state.videoSort.field) {
    state.videoSort.field = fieldButton.dataset.sortField;
  } else if (dirButton) {
    state.videoSort.dir = state.videoSort.dir === "asc" ? "desc" : "asc";
  } else {
    return;
  }

  track("catalogue video sort changed", { ...state.videoSort });
  render();
});

browseModes?.addEventListener("click", (event) => {
  const button = event.target.closest(".browse-mode");
  if (!button || button.dataset.mode === state.mode) {
    return;
  }

  state.mode = button.dataset.mode;
  updateModeButtons();
  updateSearchPlaceholder();
  refreshSearchDock(); // undock when leaving "Tout"; allow docking again on return
  track("catalogue browse mode changed", { mode: state.mode });

  if (state.data) {
    render();
  }
});

facetList?.addEventListener("click", (event) => {
  const chip = event.target.closest(".facet-chip");
  if (!chip) {
    return;
  }

  const key = chip.dataset.facetKey;
  if (state.mode === "authors") {
    // Toggle: clicking the active author clears the selection.
    state.selectedAuthor = state.selectedAuthor === key ? null : key;
    track("catalogue author selected", { author: state.selectedAuthor || undefined });
  } else if (state.mode === "videos") {
    state.selectedVideo = state.selectedVideo === key ? null : key;
    track("catalogue video selected", { video_url: state.selectedVideo || undefined });
  }

  render();
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
  // scrolls back in. The sticky bar is only used in "Tout" mode — the browse
  // modes search the facet list instead, so a floating search bar is not needed.
  let scrolledPast = false;

  const update = () => {
    if (scrolledPast && state.mode === "all") {
      dock();
    } else {
      undock();
    }
  };

  // Allow a browse-mode change to re-evaluate the dock state immediately.
  refreshSearchDock = update;

  const observer = new IntersectionObserver(
    ([entry]) => {
      scrolledPast = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      update();
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
