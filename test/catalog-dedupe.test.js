import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { KEYWORD_TAXONOMY, filterCatalogBooks, getBookKey } from "../catalog-search.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../data/le-hussard-links.json", import.meta.url), "utf8"));

function searchBooks(query) {
  return filterCatalogBooks(catalog, query);
}

test("search results include only the most recent link per book", () => {
  const results = searchBooks("victor hugo");
  const keys = results.map(getBookKey);

  assert.equal(keys.filter((key) => key === "les miserables victor hugo").length, 1);
  assert.equal(new Set(keys).size, keys.length);
});

test("every Amazon link has exactly 5 unique keywords", () => {
  for (const video of catalog.videos) {
    for (const link of video.links.filter((item) => item.type === "amazon")) {
      assert.equal(link.keywords.length, 5, `${link.label} should have 5 keywords`);
      assert.equal(new Set(link.keywords).size, 5, `${link.label} should have unique keywords`);
      assert.ok(
        link.keywords.every((keyword) => KEYWORD_TAXONOMY.has(keyword)),
        `${link.label} should use the standard keyword taxonomy`,
      );
    }
  }
});

test("search matches categories regardless of accents and term order", () => {
  const fantasyAdventure = searchBooks("fantasy aventure");

  assert.ok(fantasyAdventure.some((link) => link.author === "J. R. R. Tolkien"));
  assert.deepEqual(
    searchBooks("aventure fantasy").map(getBookKey),
    fantasyAdventure.map(getBookKey),
  );
});
