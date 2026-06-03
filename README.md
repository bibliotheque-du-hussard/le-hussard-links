# La Bibliothèque du Hussard

Static community catalog for Amazon links found in Le Hussard's public YouTube descriptions.

For the product-level purpose, audience, and boundaries, see [PRODUCT_CONTEXT.md](PRODUCT_CONTEXT.md).

## Run locally

```bash
npm start
```

Then open the local URL printed by `serve`.

## Update the catalog

Routine updates should use the incremental upsert flow. Le Hussard usually publishes on Wednesdays and Sundays, so this is the stable twice-a-week path. Incremental candidate generation checks the latest 3 videos by default:

```bash
npm run update-data:candidates
npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json --dry-run
npm run update-data:incremental -- --reviewed=/tmp/le-hussard-reviewed.json
```

The candidate file is reviewed with Codex before writing so new links can be normalized into `label` plus `author`. The incremental updater then reads the existing catalog, upserts reviewed videos and links, preserves existing labels by default, and reports label drift, author drift, or suspicious labels before writing.

For a full rebuild:

```bash
npm run update-data:full -- --limit=30
```

Use `--limit=all` or omit `--limit` to crawl every video currently exposed by the channel pages. The generated file is `data/le-hussard-links.json`. The scraper keeps only Amazon links, so La Giberne and other non-affiliate/business links stay out of the public catalog.

If YouTube rate-limits requests, increase the delay between video pages:

```bash
npm run update-data:full -- --limit=all --wait-ms=2000
```

For Codex workflow guidance, see `.codex/skills/le-hussard-catalog-updater/SKILL.md`.

## Deploy

The site is deployed with GitHub Pages from the `bibliotheque-du-hussard/le-hussard-links` repository. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment runbook, including the personal GitHub CLI profile, SSH alias, Pages setup, and verification commands.

## Notes

This is not an official Le Hussard website. It references public links from YouTube descriptions so the community can find them more easily.
