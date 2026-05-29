const dataUrl = "data/le-hussard-links.json";

const state = {
  data: null,
  query: "",
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

function updateStats(data) {
  const amazonLinks = getAmazonLinks(data);
  const sourceVideos = new Set(amazonLinks.map((link) => link.videoUrl));

  document.querySelector("#updatedAt").textContent = formatDate.format(new Date(data.generatedAt));
  document.querySelector("#amazonCount").textContent = amazonLinks.length;
  document.querySelector("#videoCount").textContent = sourceVideos.size;
}

function getFilteredLinks() {
  const query = normalize(state.query.trim());
  const amazonLinks = getAmazonLinks(state.data);

  if (!query) {
    return amazonLinks;
  }

  return amazonLinks.filter((link) => normalize(`${link.label} ${link.videoTitle}`).includes(query));
}

function render() {
  const links = getFilteredLinks();
  bookGrid.replaceChildren();
  resultCount.textContent = `${links.length} lien${links.length > 1 ? "s" : ""} Amazon trouvé${links.length > 1 ? "s" : ""}`;

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
    const amazonLink = card.querySelector(".amazon-link");
    const sourceLink = card.querySelector(".source-link");
    const sourceTitle = card.querySelector(".source-link strong");

    card.style.animationDelay = `${Math.min(index, 10) * 35}ms`;
    title.textContent = link.label;
    amazonLink.href = link.url;
    sourceLink.href = link.videoUrl;
    sourceTitle.textContent = link.videoTitle;
    bookGrid.append(card);
  });
}

searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

async function boot() {
  try {
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
