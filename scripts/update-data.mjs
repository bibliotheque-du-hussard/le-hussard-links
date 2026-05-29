import { mkdir, rename, writeFile } from "node:fs/promises";

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

const rawLimit = args.get("limit") || "all";
const limit = rawLimit === "all" ? Infinity : Number(rawLimit);
const outFile = args.get("out") || "data/le-hussard-links.json";
const waitMs = Number(args.get("wait-ms") || 750);

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

function prettifyLabel(line, rawUrl) {
  const label = line
    .replace(rawUrl, "")
    .replace(/^[\s👉•\-*–—]+/, "")
    .replace(/[:：\-–—\s]+$/, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return label || new URL(cleanUrl(rawUrl)).hostname.replace(/^www\./, "");
}

function linkType(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (/amzn\.to|amazon\./i.test(host)) {
    return "amazon";
  }

  return null;
}

function extractLinks(description) {
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
      links.push({
        label: prettifyLabel(line, match[0]),
        url,
        type,
      });
    }
  }

  return links;
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

async function fetchVideoDescription({ key, context, videoId }) {
  const response = await fetch(`https://www.youtube.com/youtubei/v1/next?key=${key}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept-language": "fr-FR,fr;q=0.9,en;q=0.8",
      "user-agent": "Mozilla/5.0 affiliate-link-catalog/1.0",
    },
    body: JSON.stringify({ context, videoId }),
  });

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

async function main() {
  const channelHtml = await fetchText(channel.videosUrl);
  const client = extractClientConfig(channelHtml);
  const videos = await getAllVideos(channelHtml, client);
  const collected = [];
  console.log(`Found ${videos.length} videos. Collecting descriptions...`);

  for (const [index, video] of videos.entries()) {
    await sleep(waitMs);
    const description = await fetchVideoDescription({ ...client, videoId: video.id });
    const links = extractLinks(description);

    if (links.length > 0) {
      collected.push({ ...video, links });
    }

    if ((index + 1) % 25 === 0) {
      console.log(`Processed ${index + 1}/${videos.length} videos...`);
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    channel: {
      name: channel.name,
      handle: channel.handle,
      url: channel.url,
    },
    videos: collected,
  };

  await mkdir(outFile.split("/").slice(0, -1).join("/"), { recursive: true });
  await writeFile(`${outFile}.tmp`, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(`${outFile}.tmp`, outFile);

  const totalLinks = collected.reduce((total, video) => total + video.links.length, 0);
  console.log(`Wrote ${outFile}: ${collected.length} videos, ${totalLinks} links.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
