export const KEYWORD_TAXONOMY = new Set([
  "absurde", "afrique", "américaine", "amour", "antiquité", "argentine", "autobiographie",
  "aventure", "britannique", "cape et épée", "classique", "drame", "dystopie", "écriture",
  "enquête", "épopée", "espagnole", "essai", "européenne", "exploration", "fantastique",
  "fantasy", "française", "francophone", "guerre", "héroïsme", "histoire",
  "horreur", "humour", "idées", "imaginaire", "italienne", "japonaise", "jeunesse", "langue",
  "littérature", "lyrisme", "mémoire", "mémoires", "moyen âge", "mystère", "mythologie",
  "philosophie", "poésie", "policier", "politique", "psychologie", "quête", "réalisme", "roman",
  "roman historique", "russe", "sagesse", "satire", "scène", "science-fiction", "société",
  "space opera", "spiritualité", "témoignage", "théâtre", "transgression", "voyage", "xixe siècle",
  "xxe siècle",
]);

export function normalize(value) {
  return String(value ?? "")
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function getAmazonLinks(data) {
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

export function getBookKey(link) {
  return normalize(`${link.label} ${link.author || ""}`.trim());
}

export function dedupeBookLinks(links) {
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

export function matchesSearchQuery(values, query) {
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }

  const searchableText = normalize(values.flat().filter(Boolean).join(" "));
  return terms.every((term) => searchableText.includes(term));
}

export function filterCatalogBooks(data, query) {
  const amazonLinks = dedupeBookLinks(getAmazonLinks(data));
  return amazonLinks.filter((link) =>
    matchesSearchQuery([link.label, link.author, link.videoTitle, link.keywords || []], query),
  );
}
