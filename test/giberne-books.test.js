import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GIBERNE_BOOKS } from "../giberne-books.js";
import { getLoopedScrollPosition } from "../carousel-loop.js";
import { KEYWORD_TAXONOMY, matchesSearchQuery } from "../catalog-search.js";

const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("La Giberne carousel books have unique product pages and valid covers", () => {
  assert.equal(GIBERNE_BOOKS.length, 17);
  assert.deepEqual(
    GIBERNE_BOOKS.map((book) => book.id),
    [17, 16, 15, 14, 13, 9, 8, 7, 6, 5, 4, 3, 2, 1, 12, 11, 10],
  );
  assert.equal(new Set(GIBERNE_BOOKS.map((book) => book.id)).size, GIBERNE_BOOKS.length);
  assert.equal(new Set(GIBERNE_BOOKS.map((book) => book.url)).size, GIBERNE_BOOKS.length);

  for (const book of GIBERNE_BOOKS) {
    assert.ok(book.title, `book ${book.id} should have a title`);
    assert.ok(book.author, `book ${book.id} should have an author`);
    assert.equal(book.keywords.length, 5, `${book.title} should have 5 keywords`);
    assert.equal(new Set(book.keywords).size, 5, `${book.title} should have unique keywords`);
    assert.ok(
      book.keywords.every((keyword) => KEYWORD_TAXONOMY.has(keyword)),
      `${book.title} should use the standard taxonomy`,
    );
    assert.equal(book.url, `https://www.lagiberne.fr/books/${book.id}`);
    assert.match(book.cover, /^https:\/\/www\.lagiberne\.fr\/storage\/books\/.+\.jpg$/);
  }
});

test("La Giberne books can be searched by title, author, or category", () => {
  const search = (query) =>
    GIBERNE_BOOKS.filter((book) => matchesSearchQuery([book.title, book.author, book.keywords], query));

  assert.deepEqual(search("objectif 23").map((book) => book.id), [7]);
  assert.deepEqual(search("vivien destro").map((book) => book.id), [17]);
  assert.deepEqual(search("antoine albalat").map((book) => book.id), [12]);
  assert.ok(search("science-fiction dystopie").some((book) => book.id === 7));
  assert.ok(search("aventure fantasy").some((book) => book.id === 5));
});

test("hidden carousel books and duplicate sets are removed from layout", () => {
  assert.match(styles, /\.giberne-(?:book|set)\[hidden\][\s\S]*?display:\s*none\s*!important/);
});

test("manual carousel scrolling recenters in either direction", () => {
  const loopWidth = 1_000;

  assert.equal(getLoopedScrollPosition(200, loopWidth), 1_200);
  assert.equal(getLoopedScrollPosition(1_200, loopWidth), 1_200);
  assert.equal(getLoopedScrollPosition(1_800, loopWidth), 800);
  assert.equal(getLoopedScrollPosition(2_800, loopWidth), 800);
});
