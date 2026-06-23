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
  const amazonLinks = getAmazonLinks(state.data);

  if (!query) {
    return dedupeBookLinks(amazonLinks);
  }

  return dedupeBookLinks(
    amazonLinks.filter((link) => normalize(`${link.label} ${link.author || ""} ${link.videoTitle}`).includes(query)),
  );
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

boot();
