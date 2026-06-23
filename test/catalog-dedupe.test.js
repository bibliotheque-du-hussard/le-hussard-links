import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const catalog = JSON.parse(fs.readFileSync(new URL("../data/le-hussard-links.json", import.meta.url), "utf8"));

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

function searchBooks(query) {
  const normalizedQuery = normalize(query.trim());
  const amazonLinks = dedupeBookLinks(getAmazonLinks(catalog));

  return amazonLinks.filter((link) =>
    normalize(`${link.label} ${link.author || ""} ${link.videoTitle}`).includes(normalizedQuery),
  );
}

test("search results include only the most recent link per book", () => {
  const results = searchBooks("victor hugo");
  const keys = results.map(getBookKey);

  assert.equal(keys.filter((key) => key === "les miserables victor hugo").length, 1);
  assert.equal(new Set(keys).size, keys.length);
});
