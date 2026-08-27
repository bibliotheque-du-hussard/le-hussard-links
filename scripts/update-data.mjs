import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { KEYWORD_TAXONOMY } from "../catalog-search.js";

const channel = {
  name: "Le Hussard",
  handle: "@LeHussard",
  url: "https://www.youtube.com/@LeHussard",
  videosUrl: "https://www.youtube.com/@LeHussard/videos",
};

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const mode = args.get("mode") || (args.has("incremental") ? "incremental" : "full");
const rawLimit = args.get("limit") || (mode === "incremental" ? "3" : "all");
const limit = rawLimit === "all" ? Infinity : Number(rawLimit);
const defaultCatalogFile = "data/le-hussard-links.json";
const outFile = args.get("out") || defaultCatalogFile;
const existingFile = args.get("existing") || defaultCatalogFile;
const waitMs = Number(args.get("wait-ms") || 750);
const dryRun = args.has("dry-run");
const refreshLabels = args.has("refresh-labels");
const candidateOutFile = args.get("candidate-out");
const candidateOnly = args.has("candidate-only");
const reviewedFile = args.get("reviewed");
const reportOutFile = args.get("report-out");
const publishGate = args.has("publish-gate");

if (!["full", "incremental"].includes(mode)) {
  throw new Error(`Unknown mode "${mode}". Use --mode=full or --mode=incremental.`);
}

if (!Number.isFinite(limit) && rawLimit !== "all") {
  throw new Error(`Invalid --limit value "${rawLimit}". Use a number or "all".`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractInitialData(html) {
  const match = html.match(/var ytInitialData = (.*?);<\/script>/s);
  if (!match) {
    throw new Error("Could not find ytInitialData on the channel page.");
  }

  return JSON.parse(match[1]);
}

function extractClientConfig(html) {
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)/)?.[1];
  const contextMatch = html.match(/"INNERTUBE_CONTEXT":(\{.*?\}),"INNERTUBE_CONTEXT_CLIENT_NAME"/s);

  if (!key || !contextMatch) {
    throw new Error("Could not find YouTube client config.");
  }

  return {
    key,
    context: JSON.parse(contextMatch[1]),
  };
}

function getContinuationToken(value) {
  const tokens = [];

  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (node.continuationCommand?.token) {
      tokens.push(node.continuationCommand.token);
    }

    Object.values(node).forEach(walk);
  }

  walk(value);
  return tokens[0] || null;
}

function getVideos(initialData, seen = new Set()) {
  const videos = [];

  function walk(value) {
    if (!value || typeof value !== "object") {
      return;
    }

    const lockup = value.lockupViewModel;
    if (lockup?.contentId && lockup.contentType === "LOCKUP_CONTENT_TYPE_VIDEO" && !seen.has(lockup.contentId)) {
      seen.add(lockup.contentId);
      videos.push({
        id: lockup.contentId,
        title: lockup.metadata?.lockupMetadataViewModel?.title?.content || "Sans titre",
        thumbnail: `https://i.ytimg.com/vi/${lockup.contentId}/hqdefault.jpg`,
        youtubeUrl: `https://www.youtube.com/watch?v=${lockup.contentId}`,
      });
    }

    Object.values(value).forEach(walk);
  }

  walk(initialData);
  return videos;
}

function cleanUrl(url) {
  return url.replace(/[),.;!?:]+$/, "");
}

function normalizeUrlKey(url) {
  const parsed = new URL(cleanUrl(url));
  parsed.hash = "";
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  }

  return parsed.toString();
}

function tidyLabel(label) {
  const isCallToAction = /\b(?:acheter|cliquez|c['’]est par ici|via ce lien|procurer|pas encore lu|voulez|foncez)\b/i.test(label);
  const quoteMatch = label.match(/["“](.+?)["”](?:\s+(?:de|d['’])\s+([^,!.?()]+))?/i);
  if (isCallToAction && quoteMatch) {
    return [quoteMatch[1], quoteMatch[2]].filter(Boolean).join(", ");
  }

  return label
    .replace(/^si vous n['’]avez pas encore lu\s+/i, "")
    .replace(/^si vous voulez (?:re)?découvrir\s+/i, "")
    .replace(/^pour (?:acheter|voir)\s+/i, "")
    .replace(/^vous pouvez vous procurer leur édition collector de\s+/i, "")
    .replace(/^foncez vous procurer\s+/i, "")
    .replace(/^vous procurer\s+/i, "")
    .replace(/^acheter\s+/i, "")
    .replace(/^se procurer\s+/i, "")
    .replace(/^bonus\s*:\s*/i, "")
    .replace(/,?\s*(?:cliquez ici|c['’]est par ici|via ce lien)\s*$/i, "")
    .replace(/^céline et son voyage$/i, "Voyage au bout de la nuit, Céline")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function prettifyLabel(line, rawUrl) {
  const label = line
    .replace(rawUrl, "")
    .replace(/^[\s👉•\-*–—]+/, "")
    .replace(/[:：\-–—\s]+$/, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return tidyLabel(label) || new URL(cleanUrl(rawUrl)).hostname.replace(/^www\./, "");
}

function linkType(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/amzn\.to|amazon\./i.test(host)) {
    return "amazon";
  }

  return null;
}

function isAmazonLink(link) {
  try {
    return link.type === "amazon" && linkType(link.url) === "amazon";
  } catch {
    return false;
  }
}

function extractLinks(description, { includeSourceText = false } = {}) {
  const links = [];
  const seen = new Set();

  for (const line of description.split(/\r?\n/)) {
    for (const match of line.matchAll(/https?:\/\/[^\s<>"']+/g)) {
      const url = cleanUrl(match[0]);
      const type = linkType(url);
      if (!type || seen.has(url)) {
        continue;
      }

      seen.add(url);
      const link = {
        label: prettifyLabel(line, match[0]),
        url,
        type,
      };

      if (includeSourceText) {
        link.sourceText = line.trim();
      }

      links.push(link);
    }
  }

  return links;
}

function isSuspiciousLabel(label, url) {
  const trimmed = label.trim();
  const host = new URL(cleanUrl(url)).hostname.replace(/^www\./, "");

  return (
    trimmed.length < 3 ||
    trimmed === host ||
    /^https?:\/\//i.test(trimmed) ||
    /^(?:amazon|amzn\.to|cliquez ici|c['’]est par ici|via ce lien|lien)$/i.test(trimmed)
  );
}

function validateLinks(videos) {
  const warnings = [];

  for (const video of videos) {
    const seen = new Set();

    for (const link of video.links) {
      if (!isAmazonLink(link)) {
        warnings.push(`${video.id}: non-Amazon link ${link.url}`);
        continue;
      }

      const key = normalizeUrlKey(link.url);

      if (seen.has(key)) {
        warnings.push(`${video.id}: duplicate link ${link.url}`);
      }

      if (isSuspiciousLabel(link.label, link.url)) {
        warnings.push(`${video.id}: suspicious label "${link.label}" for ${link.url}`);
      }

      if (!Array.isArray(link.keywords) || link.keywords.length !== 5) {
        warnings.push(`${video.id}: expected exactly 5 keywords for "${link.label}"`);
      } else {
        const normalizedKeywords = link.keywords.map((keyword) =>
          typeof keyword === "string" ? keyword.trim().toLocaleLowerCase("fr-FR") : "",
        );

        if (normalizedKeywords.some((keyword) => !keyword)) {
          warnings.push(`${video.id}: keywords must be non-empty strings for "${link.label}"`);
        }

        if (new Set(normalizedKeywords).size !== normalizedKeywords.length) {
          warnings.push(`${video.id}: keywords must be unique for "${link.label}"`);
        }

        if (normalizedKeywords.some((keyword, index) => keyword !== link.keywords[index])) {
          warnings.push(`${video.id}: keywords must be lowercase and trimmed for "${link.label}"`);
        }

        const unknownKeywords = normalizedKeywords.filter((keyword) => !KEYWORD_TAXONOMY.has(keyword));
        if (unknownKeywords.length > 0) {
          warnings.push(`${video.id}: unknown keywords for "${link.label}": ${unknownKeywords.join(", ")}`);
        }
      }

      seen.add(key);
    }
  }

  return warnings;
}

function validateReviewedPayload(payload) {
  const warnings = [];
  const videoIds = new Set();

  if (!payload || typeof payload !== "object") {
    return ["reviewed payload: expected a JSON object"];
  }

  if (!Array.isArray(payload.videos)) {
    return ["reviewed payload: expected videos array"];
  }

  for (const [videoIndex, video] of payload.videos.entries()) {
    const videoRef = video?.id || `videos[${videoIndex}]`;

    if (!video?.id) {
      warnings.push(`videos[${videoIndex}]: missing id`);
    } else if (videoIds.has(video.id)) {
      warnings.push(`${video.id}: duplicate video id`);
    } else {
      videoIds.add(video.id);
    }

    for (const field of ["title", "thumbnail", "youtubeUrl"]) {
      if (!video?.[field]) {
        warnings.push(`${videoRef}: missing ${field}`);
      }
    }

    if (!Array.isArray(video?.links)) {
      warnings.push(`${videoRef}: missing links array`);
      continue;
    }

    for (const [linkIndex, link] of video.links.entries()) {
      const linkRef = `${videoRef}.links[${linkIndex}]`;

      if (!link || typeof link !== "object") {
        warnings.push(`${linkRef}: expected link object`);
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(link, "sourceText")) {
        warnings.push(`${linkRef}: sourceText must be removed after review`);
      }

      for (const field of ["label", "url", "type"]) {
        if (!link?.[field]) {
          warnings.push(`${linkRef}: missing ${field}`);
        }
      }

      if (link?.url && !isAmazonLink(link)) {
        warnings.push(`${linkRef}: expected an Amazon link`);
      }
    }
  }

  return warnings;
}

async function readExistingCatalog(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function fetchText(url, retries = 3) {
  const response = await fetch(url, {
    headers: {
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 affiliate-link-catalog/1.0",
    },
  });

  if (response.status === 429 && retries > 0) {
    const delay = (4 - retries) * 15_000;
    console.log(`Rate limited by YouTube. Waiting ${delay / 1000}s before retrying...`);
    await sleep(delay);
    return fetchText(url, retries - 1);
  }

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }

  return response.text();
}

async function fetchContinuation({ key, context, token }) {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${key}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 affiliate-link-catalog/1.0",
    },
    body: JSON.stringify({ context, continuation: token }),
  });

  if (!response.ok) {
    throw new Error(`Continuation request failed ${response.status}.`);
  }

  return response.json();
}

async function fetchVideoDescription({ key, context, videoId }, retries = 3) {
  let response;

  try {
    response = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${key}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
        "user-agent": "Mozilla/5.0 affiliate-link-catalog/1.0",
      },
      body: JSON.stringify({ context, videoId }),
    });
  } catch (error) {
    if (retries > 0) {
      const delay = (4 - retries) * 5_000;
      console.log(`Video details request failed for ${videoId}. Waiting ${delay / 1000}s before retrying...`);
      await sleep(delay);
      return fetchVideoDescription({ key, context, videoId }, retries - 1);
    }

    throw error;
  }

  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    const delay = (4 - retries) * 10_000;
    console.log(`Video details request returned ${response.status} for ${videoId}. Waiting ${delay / 1000}s before retrying...`);
    await sleep(delay);
    return fetchVideoDescription({ key, context, videoId }, retries - 1);
  }

  if (!response.ok) {
    throw new Error(`Video details request failed ${response.status}: ${videoId}`);
  }

  const data = await response.json();
  return (
    data.engagementPanels?.find((panel) => panel.engagementPanelSectionListRenderer)
      ?.engagementPanelSectionListRenderer?.content?.structuredDescriptionContentRenderer?.items?.find(
        (item) => item.expandableVideoDescriptionBodyRenderer,
      )?.expandableVideoDescriptionBodyRenderer?.attributedDescriptionBodyText?.content ||
    data.contents?.twoColumnWatchNextResults?.results?.results?.contents?.find(
      (item) => item.videoSecondaryInfoRenderer,
    )?.videoSecondaryInfoRenderer?.attributedDescription?.content ||
    ""
  );
}

async function getAllVideos(channelHtml, client) {
  const seen = new Set();
  let data = extractInitialData(channelHtml);
  let token = getContinuationToken(data);
  const videos = getVideos(data, seen);

  while (token && videos.length < limit) {
    data = await fetchContinuation({ ...client, token });
    const nextVideos = getVideos(data, seen);
    videos.push(...nextVideos);
    token = getContinuationToken(data);
  }

  return videos.slice(0, limit);
}

function mergeLinks(existingLinks = [], incomingLinks = [], report, video) {
  const merged = [];
  const byUrl = new Map();

  for (const link of existingLinks) {
    const key = normalizeUrlKey(link.url);
    if (!byUrl.has(key)) {
      byUrl.set(key, { ...link });
      merged.push(byUrl.get(key));
    }
  }

  for (const link of incomingLinks) {
    const key = normalizeUrlKey(link.url);
    const current = byUrl.get(key);

    if (!current) {
      const next = { ...link };
      byUrl.set(key, next);
      merged.push(next);
      report.addedLinks += 1;
      report.addedLinkDetails.push({
        videoId: video.id,
        videoTitle: video.title,
        ...link,
      });
      continue;
    }

    if (current.label !== link.label) {
      report.labelChanges.push({
        url: link.url,
        from: current.label,
        to: link.label,
      });

      if (refreshLabels) {
        current.label = link.label;
      }
    }

    if (link.author && !current.author) {
      current.author = link.author;
      report.addedAuthors += 1;
      report.addedAuthorDetails.push({
        videoId: video.id,
        videoTitle: video.title,
        url: link.url,
        label: current.label,
        author: link.author,
      });
    } else if (link.author && current.author && current.author !== link.author) {
      report.authorChanges.push({
        url: link.url,
        from: current.author,
        to: link.author,
      });

      if (refreshLabels) {
        current.author = link.author;
      }
    }

    if (Array.isArray(link.keywords) && link.keywords.length > 0) {
      current.keywords = [...link.keywords];
    }

    current.type = link.type;
  }

  return merged;
}

function mergeCatalog(existing, incoming) {
  const report = {
    newVideos: 0,
    updatedVideos: 0,
    addedLinks: 0,
    addedAuthors: 0,
    newVideoDetails: [],
    addedLinkDetails: [],
    addedAuthorDetails: [],
    labelChanges: [],
    authorChanges: [],
  };

  if (!existing || mode === "full") {
    return { payload: incoming, report };
  }

  const existingById = new Map(existing.videos.map((video) => [video.id, video]));
  const incomingIds = new Set(incoming.videos.map((video) => video.id));
  const videos = [];

  for (const incomingVideo of incoming.videos) {
    const existingVideo = existingById.get(incomingVideo.id);

    if (!existingVideo) {
      report.newVideos += 1;
      report.addedLinks += incomingVideo.links.length;
      report.newVideoDetails.push({
        id: incomingVideo.id,
        title: incomingVideo.title,
        youtubeUrl: incomingVideo.youtubeUrl,
        linkCount: incomingVideo.links.length,
      });
      report.addedLinkDetails.push(
        ...incomingVideo.links.map((link) => ({
          videoId: incomingVideo.id,
          videoTitle: incomingVideo.title,
          ...link,
        })),
      );
      videos.push(incomingVideo);
      continue;
    }

    report.updatedVideos += 1;
    videos.push({
      ...existingVideo,
      ...incomingVideo,
      links: mergeLinks(existingVideo.links, incomingVideo.links, report, incomingVideo),
    });
  }

  for (const existingVideo of existing.videos) {
    if (!incomingIds.has(existingVideo.id)) {
      videos.push(existingVideo);
    }
  }

  return {
    payload: {
      ...existing,
      generatedAt: incoming.generatedAt,
      channel: incoming.channel,
      videos,
    },
    report,
  };
}

function preserveReviewedLinkMetadata(existing, incoming) {
  if (!existing) {
    return incoming;
  }

  const existingLinksByUrl = new Map();

  for (const video of existing.videos) {
    for (const link of video.links || []) {
      existingLinksByUrl.set(normalizeUrlKey(link.url), link);
    }
  }

  return {
    ...incoming,
    videos: incoming.videos.map((video) => ({
      ...video,
      links: video.links.map((link) => {
        const existingLink = existingLinksByUrl.get(normalizeUrlKey(link.url));
        if (!existingLink) {
          return link;
        }

        return {
          ...link,
          label: refreshLabels ? link.label : existingLink.label,
          ...(existingLink.author && !refreshLabels ? { author: existingLink.author } : {}),
          ...(link.author ? { author: link.author } : {}),
          ...(existingLink.keywords ? { keywords: existingLink.keywords } : {}),
          ...(link.keywords ? { keywords: link.keywords } : {}),
        };
      }),
    })),
  };
}

async function collectCatalog(videos, client, options = {}) {
  const collected = [];
  console.log(`Found ${videos.length} videos. Collecting descriptions...`);

  for (const [index, video] of videos.entries()) {
    await sleep(waitMs);
    const description = await fetchVideoDescription({ ...client, videoId: video.id });
    const links = extractLinks(description, options);

    if (links.length > 0) {
      collected.push({ ...video, links });
    }

    if ((index + 1) % 25 === 0) {
      console.log(`Processed ${index + 1}/${videos.length} videos...`);
    }
  }

  return collected;
}

function countLinks(videos) {
  return videos.reduce((total, video) => total + video.links.length, 0);
}

function summarizePayload(payload) {
  return {
    generatedAt: payload.generatedAt,
    videoCount: payload.videos.length,
    linkCount: countLinks(payload.videos),
    latestVideo: payload.videos[0]
      ? {
          id: payload.videos[0].id,
          title: payload.videos[0].title,
          youtubeUrl: payload.videos[0].youtubeUrl,
          linkCount: payload.videos[0].links.length,
        }
      : null,
  };
}

async function writeCatalog(payload) {
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(`${outFile}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(`${outFile}.tmp`, outFile);
}

async function writeJson(file, payload) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

function normalizeReviewedPayload(payload) {
  return {
    ...payload,
    videos: payload.videos.map((video) => ({
      id: video.id,
      title: video.title,
      thumbnail: video.thumbnail,
      youtubeUrl: video.youtubeUrl,
      links: video.links.map((link) => ({
        label: link.label,
        ...(link.author ? { author: link.author } : {}),
        ...(link.keywords ? { keywords: link.keywords } : {}),
        url: link.url,
        type: link.type,
      })),
    })),
  };
}

function printReport(report, warnings) {
  if (mode === "incremental") {
    console.log(
      `Incremental report: ${report.newVideos} new videos, ${report.updatedVideos} refreshed videos, ${report.addedLinks} added links.`,
    );
  }

  if (report.labelChanges.length > 0) {
    console.log(`Label drift detected on ${report.labelChanges.length} existing links.`);
    for (const change of report.labelChanges.slice(0, 20)) {
      console.log(`- ${change.url}: "${change.from}" -> "${change.to}"`);
    }
  }

  if (report.authorChanges.length > 0) {
    console.log(`Author drift detected on ${report.authorChanges.length} existing links.`);
    for (const change of report.authorChanges.slice(0, 20)) {
      console.log(`- ${change.url}: "${change.from}" -> "${change.to}"`);
    }
  }

  if (report.addedAuthors > 0) {
    console.log(`Added authors to ${report.addedAuthors} existing links.`);
  }

  if (warnings.length > 0) {
    console.warn(`Validation warnings (${warnings.length}):`);
    for (const warning of warnings.slice(0, 20)) {
      console.warn(`- ${warning}`);
    }
  }
}

function buildGateReport({ existing, incoming, payload, report, warnings }) {
  const blockers = [];
  const hasPublishableChanges = report.newVideos > 0 || report.addedLinks > 0;

  if (warnings.length > 0) {
    blockers.push({
      type: "validation_warnings",
      count: warnings.length,
      items: warnings,
    });
  }

  if (report.labelChanges.length > 0) {
    blockers.push({
      type: "label_drift",
      count: report.labelChanges.length,
      items: report.labelChanges,
    });
  }

  if (report.authorChanges.length > 0) {
    blockers.push({
      type: "author_drift",
      count: report.authorChanges.length,
      items: report.authorChanges,
    });
  }

  if (!hasPublishableChanges) {
    blockers.push({
      type: "no_publishable_changes",
      count: 0,
      items: [],
    });
  }

  const onlyNoChanges = blockers.length === 1 && blockers[0].type === "no_publishable_changes";

  return {
    status: blockers.length === 0 ? "publishable" : onlyNoChanges ? "no_changes" : "blocked",
    publishable: blockers.length === 0,
    mode,
    dryRun,
    refreshLabels,
    files: {
      existing: existingFile,
      out: outFile,
      reviewed: reviewedFile || null,
    },
    counts: {
      existing: existing ? summarizePayload(existing) : null,
      incoming: summarizePayload(incoming),
      output: summarizePayload(payload),
    },
    changes: report,
    warnings,
    blockers,
  };
}

async function main() {
  let incoming;
  let reviewedWarnings = [];

  if (reviewedFile) {
    const reviewedPayload = await readJson(reviewedFile);
    reviewedWarnings = validateReviewedPayload(reviewedPayload);
    incoming = normalizeReviewedPayload(reviewedPayload);
    console.log(`Loaded reviewed candidates from ${reviewedFile}.`);
  } else {
    const channelHtml = await fetchText(channel.videosUrl);
    const client = extractClientConfig(channelHtml);
    const videos = await getAllVideos(channelHtml, client);
    const collected = await collectCatalog(videos, client, { includeSourceText: Boolean(candidateOutFile) });

    incoming = {
      generatedAt: new Date().toISOString(),
      channel: {
        name: channel.name,
        handle: channel.handle,
        url: channel.url,
      },
      videos: collected,
    };
  }

  if (candidateOutFile) {
    await writeJson(candidateOutFile, incoming);
    console.log(`Wrote review candidates to ${candidateOutFile}: ${incoming.videos.length} videos, ${countLinks(incoming.videos)} links.`);

    if (candidateOnly) {
      return;
    }
  }

  const existing = await readExistingCatalog(existingFile);
  const reviewedIncoming = mode === "full" ? preserveReviewedLinkMetadata(existing, incoming) : incoming;
  const { payload, report } = mergeCatalog(mode === "incremental" ? existing : null, reviewedIncoming);
  const warnings = [...reviewedWarnings, ...validateLinks(payload.videos)];
  const gateReport = buildGateReport({ existing, incoming, payload, report, warnings });

  printReport(report, warnings);

  if (reportOutFile) {
    await writeJson(reportOutFile, gateReport);
    console.log(`Wrote update report to ${reportOutFile}: ${gateReport.status}.`);
  }

  if (publishGate && !gateReport.publishable) {
    const gateVerb = gateReport.status === "no_changes" ? "stopped" : "blocked";
    console.error(`Publish gate ${gateVerb}: ${gateReport.blockers.map((blocker) => blocker.type).join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log(`Dry run only. Would write ${outFile}: ${payload.videos.length} videos, ${countLinks(payload.videos)} links.`);
    return;
  }

  await writeCatalog(payload);
  console.log(`Wrote ${outFile}: ${payload.videos.length} videos, ${countLinks(payload.videos)} links.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
