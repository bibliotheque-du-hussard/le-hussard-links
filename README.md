# La Bibliothèque du Hussard

Static community catalog for Amazon links found in Le Hussard's public YouTube descriptions.

## Run locally

```bash
npm run update-data
npm start
```

Then open the local URL printed by `serve`.

## Update the catalog

```bash
npm run update-data -- --limit=30
```

Use `--limit=all` or omit `--limit` to crawl every video currently exposed by the channel pages. The generated file is `data/le-hussard-links.json`. The scraper keeps only Amazon links, so La Giberne and other non-affiliate/business links stay out of the public catalog.

If YouTube rate-limits requests, increase the delay between video pages:

```bash
npm run update-data -- --limit=all --wait-ms=2000
```

## Notes

This is not an official Le Hussard website. It references public links from YouTube descriptions so the community can find them more easily.
