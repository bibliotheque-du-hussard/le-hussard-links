import {
  dedupeBookLinks,
  filterCatalogBooks,
  getAmazonLinks,
  matchesSearchQuery,
  normalize,
} from "./catalog-search.js";
import { getLoopedScrollPosition } from "./carousel-loop.js";
import { GIBERNE_BOOKS } from "./giberne-books.js";

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
const template = document.querySelector("#bookCardTemplate");
const giberneCarousel = document.querySelector("#giberneCarousel");
const giberneTrack = document.querySelector("#giberneTrack");
const giberneToggle = document.querySelector("#giberneToggle");
const giberneEmpty = document.querySelector("#giberneEmpty");

const formatDate = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

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

function createGiberneBookLink(book, duplicate = false) {
  const link = document.createElement("a");
  link.className = "giberne-book";
  link.href = book.url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.dataset.trackDestinationType = "website";
  link.dataset.trackDestination = "la_giberne_book";
  link.dataset.trackSurface = "giberne_carousel";
  link.dataset.trackItemId = `la-giberne-${book.id}`;
  link.dataset.trackItemTitle = book.title;
  link.dataset.giberneBookId = String(book.id);
  if (duplicate) {
    link.tabIndex = -1;
  }

  const cover = document.createElement("img");
  cover.src = book.cover;
  cover.alt = duplicate ? "" : `Couverture de ${book.title}`;
  cover.loading = "lazy";
  cover.decoding = "async";

  const copy = document.createElement("span");
  copy.className = "giberne-book-copy";

  const title = document.createElement("strong");
  title.textContent = book.title;

  const author = document.createElement("span");
  author.textContent = book.author;

  copy.append(title, author);
  link.append(cover, copy);
  return link;
}

function renderGiberneCarousel() {
  const leadingSet = document.createElement("div");
  leadingSet.className = "giberne-set";
  leadingSet.setAttribute("aria-hidden", "true");
  leadingSet.append(...GIBERNE_BOOKS.map((book) => createGiberneBookLink(book, true)));

  const primarySet = document.createElement("div");
  primarySet.className = "giberne-set";
  primarySet.append(...GIBERNE_BOOKS.map((book) => createGiberneBookLink(book)));

  const trailingSet = document.createElement("div");
  trailingSet.className = "giberne-set";
  trailingSet.setAttribute("aria-hidden", "true");
  trailingSet.append(...GIBERNE_BOOKS.map((book) => createGiberneBookLink(book, true)));

  giberneTrack.replaceChildren(leadingSet, primarySet, trailingSet);
  return primarySet;
}

function startGiberneCarousel(primarySet) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let pausedByUser = false;
  let pausedByInteraction = false;
  let lastFrameTime = null;
  let autoScrollPosition = primarySet.offsetLeft;
  let filtered = false;
  let resumeTimeoutId;

  giberneCarousel.scrollLeft = autoScrollPosition;

  function updateToggle() {
    giberneToggle.setAttribute("aria-pressed", String(pausedByUser));
    giberneToggle.querySelector(".giberne-toggle-label").textContent = pausedByUser
      ? "Relancer le défilement"
      : "Mettre en pause";
  }

  function pauseForInteraction() {
    pausedByInteraction = true;
    window.clearTimeout(resumeTimeoutId);
  }

  function resumeAfterInteraction(delay = 0) {
    window.clearTimeout(resumeTimeoutId);
    resumeTimeoutId = window.setTimeout(() => {
      if (!giberneCarousel.matches(":hover") && !giberneCarousel.contains(document.activeElement)) {
        pausedByInteraction = false;
      }
    }, delay);
  }

  function animate(timestamp) {
    if (lastFrameTime === null) {
      lastFrameTime = timestamp;
    }

    if (!filtered && !pausedByUser && !pausedByInteraction && !reducedMotion.matches && !document.hidden) {
      const elapsed = Math.min(timestamp - lastFrameTime, 50);
      autoScrollPosition += elapsed * 0.026;

      const loopWidth = primarySet.offsetWidth;
      autoScrollPosition = getLoopedScrollPosition(autoScrollPosition, loopWidth);

      giberneCarousel.scrollLeft = autoScrollPosition;
    } else {
      autoScrollPosition = giberneCarousel.scrollLeft;
    }

    lastFrameTime = timestamp;
    window.requestAnimationFrame(animate);
  }

  giberneToggle.addEventListener("click", () => {
    pausedByUser = !pausedByUser;
    updateToggle();
  });
  giberneCarousel.addEventListener("mouseenter", pauseForInteraction);
  giberneCarousel.addEventListener("mouseleave", () => resumeAfterInteraction());
  giberneCarousel.addEventListener("focusin", pauseForInteraction);
  giberneCarousel.addEventListener("focusout", () => resumeAfterInteraction());
  giberneCarousel.addEventListener("pointerdown", pauseForInteraction);
  giberneCarousel.addEventListener("pointerup", () => resumeAfterInteraction(1800));
  giberneCarousel.addEventListener("pointercancel", () => resumeAfterInteraction(1800));
  giberneCarousel.addEventListener("scroll", () => {
    if (filtered) {
      return;
    }

    const currentPosition = giberneCarousel.scrollLeft;
    const loopedPosition = getLoopedScrollPosition(currentPosition, primarySet.offsetWidth);

    if (loopedPosition !== currentPosition) {
      giberneCarousel.scrollLeft = loopedPosition;
      autoScrollPosition = loopedPosition;
    }
  });

  updateToggle();
  window.requestAnimationFrame(animate);

  return {
    setFiltered(nextFiltered) {
      filtered = nextFiltered;
      autoScrollPosition = filtered ? 0 : primarySet.offsetLeft;
      giberneCarousel.scrollLeft = autoScrollPosition;
    },
  };
}

function getFilteredGiberneBooks(query = state.query) {
  return GIBERNE_BOOKS.filter((book) =>
    matchesSearchQuery([book.title, book.author, book.keywords], query),
  );
}

function updateGiberneSearch() {
  const matches = getFilteredGiberneBooks();
  const matchingIds = new Set(matches.map((book) => String(book.id)));
  const hasQuery = state.query.trim().length > 0;

  for (const set of giberneTrack.querySelectorAll(".giberne-set")) {
    const isDuplicateSet = set.hasAttribute("aria-hidden");
    set.hidden = hasQuery && isDuplicateSet;

    for (const link of set.querySelectorAll(".giberne-book")) {
      link.hidden = !matchingIds.has(link.dataset.giberneBookId);
    }
  }

  giberneCarousel.hidden = matches.length === 0;
  giberneEmpty.hidden = matches.length > 0;
  giberneToggle.hidden = hasQuery;
  giberneCarouselController.setFiltered(hasQuery);
  return matches.length;
}

function updateStats(data) {
  const amazonLinks = dedupeBookLinks(getAmazonLinks(data));
  const sourceVideos = new Set(amazonLinks.map((link) => link.videoUrl));

  document.querySelector("#updatedAt").textContent = formatDate.format(new Date(data.generatedAt));
  document.querySelector("#amazonCount").textContent = amazonLinks.length;
  document.querySelector("#videoCount").textContent = sourceVideos.size;
}

function getFilteredLinks() {
  return filterCatalogBooks(state.data, state.query);
}

function render() {
  const links = getFilteredLinks();
  const giberneMatchCount = updateGiberneSearch();
  const totalMatchCount = links.length + giberneMatchCount;
  bookGrid.removeAttribute("aria-busy");
  bookGrid.replaceChildren();
  resultCount.textContent = state.query.trim()
    ? `${links.length} référence${links.length !== 1 ? "s" : ""} Amazon et ${giberneMatchCount} livre${giberneMatchCount !== 1 ? "s" : ""} La Giberne ${totalMatchCount === 1 ? "correspond" : "correspondent"} à votre recherche.`
    : `Plus de ${links.length} lien${links.length > 1 ? "s" : ""} Amazon disponible${links.length > 1 ? "s" : ""} !`;

  if (links.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Aucun livre ne correspond à cette recherche. Essayez un autre titre, auteur ou genre.";
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
  } else {
    updateGiberneSearch();
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

const giberneCarouselController = startGiberneCarousel(renderGiberneCarousel());
boot();
