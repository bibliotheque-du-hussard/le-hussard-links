---
name: le-hussard-catalog-updater
description: Use when updating La Bibliotheque du Hussard's catalog from Le Hussard YouTube descriptions, especially the Wednesday/Sunday incremental upsert workflow for stable Amazon link labels and data consistency.
---

# Le Hussard Catalog Updater

## Purpose

Keep `data/le-hussard-links.json` current without unnecessary churn.

Le Hussard usually publishes on Wednesdays and Sundays. For routine updates, prefer an incremental upsert over a full rebuild. The incremental window is intentionally scoped to the latest 3 videos.

## Default Workflow

1. Read `PRODUCT_CONTEXT.md` if product intent or scope is unclear.
2. Generate review candidates for the latest videos:

   ```bash
   npm run update-data:candidates
   ```

3. Use LLM reasoning to review `/tmp/le-hussard-candidates.json` before any catalog write:
   - New videos should match recent Le Hussard uploads.
   - Added links should be Amazon links from public YouTube descriptions.
   - Split each book reference into `label` as the book title and `author` as the author when the source text supports it.
   - Leave `author` absent rather than guessing when the source text is ambiguous.
   - Keep `url` and `type` unchanged.
   - Remove temporary `sourceText` fields from the reviewed payload.
4. Save the reviewed payload, for example `/tmp/le-hussard-reviewed.json`, then dry-run the deterministic upsert:

   ```bash
   npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json --dry-run
   ```

5. If the dry run looks stable, write the reviewed upsert:

   ```bash
   npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json
   ```

6. Review `git diff -- data/le-hussard-links.json` before finishing.

## Autonomous Publish Workflow

Use this workflow for the scheduled automation and whenever Julian asks for an autonomous update.

1. Confirm the repository is on `main`, has no unrelated local changes, and can push with the personal GitHub profile:

   ```bash
   git status --short --branch
   GH_CONFIG_DIR="$HOME/.config/gh-personal" gh auth status
   ```

2. Run the default candidate review and dry-run workflow.
3. Publish without asking for approval only when all of these are true:
   - the dry run reports at least one new video or added link;
   - validation warnings are empty;
   - label drift and author drift are either empty or clearly harmless metadata refreshes;
   - every added link is an Amazon link from a recent public Le Hussard video description;
   - reviewed labels are useful titles, not calls to action, domains, or raw URLs.
4. If the dry run is clean but reports no catalog changes, report "no changes" and do not commit.
5. If the dry run is not clean, do not write, stage, commit, or push. Report the blocker with the candidate videos and links that need human review.
6. Write the reviewed upsert:

   ```bash
   npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json
   ```

7. Re-check the diff. Stage only `data/le-hussard-links.json`, commit with `Update Le Hussard catalog`, and push `main`:

   ```bash
   git add data/le-hussard-links.json
   git commit -m "Update Le Hussard catalog"
   git push origin main
   ```

8. Verify GitHub Pages:

   ```bash
   GH_CONFIG_DIR="$HOME/.config/gh-personal" gh api repos/bibliotheque-du-hussard/le-hussard-links/pages --jq '{html_url, status, source}'
   curl -s -L https://bibliotheque-du-hussard.github.io/le-hussard-links/data/le-hussard-links.json > /tmp/le-hussard-pages-data.json
   ```

   Confirm the deployed catalog count and latest video match the local catalog. Retry for a few minutes if Pages is still building or cached.

9. Report the commit hash, deployed URL, final catalog counts, new videos, added links, and any skipped/blocking conditions.

## When To Use Full Mode

Use a full rebuild only when:

- the parser changed and the whole catalog needs normalization;
- the data file is corrupted or missing;
- a deliberate audit of older videos is requested.

Full rebuilds preserve existing reviewed labels and authors by URL unless `--refresh-labels` is explicitly provided.

Command:

```bash
npm run update-data:full -- --wait-ms=2000
```

## Upsert Rules

- Identify videos by stable YouTube `id`.
- Identify links by normalized URL.
- Add new videos above older existing videos.
- Refresh video title, thumbnail, and YouTube URL for videos included in the incremental window.
- Preserve existing labels by default when the same URL is found again.
- Report label drift instead of changing existing labels automatically.
- Add an author to an existing link when the reviewed candidate supplies one and the existing entry has none.
- Report author drift instead of changing existing authors automatically.
- Use `--refresh-labels` only when the user explicitly wants parsed labels to replace existing labels.
- Do not treat repeated titles inside one video as mistakes until the target URLs are checked. Descriptions sometimes include multiple legitimate links for the same work, such as separate tomes, school editions, original/modernized editions, translations, or format variants. Keep each URL and make labels distinguish the variant, for example `Guerre et Paix, tome 1` / `Guerre et Paix, tome 2`.

## Label Rules

Labels should read like book or reference titles, not calls to action and not `Author, Title` pairs when the author can be separated.

Good reviewed links:

```json
{
  "label": "Les Dieux ont soif",
  "author": "Anatole France",
  "url": "https://amzn.to/4djjjAS",
  "type": "amazon"
}
```

```json
{
  "label": "Madame Bovary",
  "author": "Gustave Flaubert",
  "url": "https://amzn.to/example",
  "type": "amazon"
}
```

Suspicious labels:

- `cliquez ici`
- `via ce lien`
- `Amazon`
- a bare domain or URL
- empty or nearly empty text

When a new label is suspicious, inspect the source description before accepting it. Prefer improving parser rules over hand-editing many individual entries.

## Author Reasoning Rules

- Use the candidate `sourceText` first.
- Split clear patterns like `Author, Title`, `Title, de Author`, and `Title - Author`.
- For classical or famous works, use general literary knowledge only when you are confident.
- For anonymous, traditional, mythic, or collective works with no stable individual author, use a clear conventional value such as `Anonyme`, `Tradition orale`, or the accepted collective attribution when that is more useful than leaving the field blank.
- For films, comics, adaptations, editions, and anthology-style products, keep full coverage by using the most useful creator credit in `author`, such as director, adapter, original author, or `Collectif`.
- When two links have the same title and author but different URLs, inspect the target product pages or source text and add a concise qualifier to `label` rather than deleting either link.
- Do not invent individual authors for unclear anthology, publisher, edition, or series links.
- Preserve accents and canonical French names when known.
- If a link points to a non-book object or the author cannot be known confidently, omit `author`.

## Script Contract

The deterministic script is `scripts/update-data.mjs`.

Routine command:

```bash
npm run update-data:candidates
npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json --dry-run
npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json
```

Useful flags:

- `--dry-run`: collect and merge in memory without writing.
- `--limit=3`: inspect only the latest three channel videos; this is the incremental default.
- `--candidate-out=path/to/file.json`: write fetched candidates for LLM review.
- `--candidate-only`: stop after writing the candidate file.
- `--reviewed=path/to/file.json`: upsert an LLM-reviewed candidate payload instead of fetching descriptions.
- `--existing=path/to/file.json`: read an alternate existing catalog when testing incremental merges; defaults to `data/le-hussard-links.json`.
- `--wait-ms=2000`: slow down YouTube requests when rate-limited.
- `--refresh-labels`: allow existing labels to change when parser output differs.
- `--out=path/to/file.json`: write to another catalog file for testing.

Expected output includes the number of new videos, refreshed videos, added links, label drift, and validation warnings.
