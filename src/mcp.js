/**
 * Minimal MCP server over Streamable HTTP (JSON-RPC 2.0).
 * Stateless: every POST is independent, so no session id is issued.
 *
 * Auth: the caller supplies their own Apify token as
 *   Authorization: Bearer <token>
 * It is passed through to the actor API and never stored.
 */

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "scrapelads", title: "ScrapeLads", version: "1.0.0" };

const ACTOR_BASE = "https://api.apify.com/v2/acts/Scrape-Lads~";

const TOOLS = [
  {
    name: "find_tiktok_creators",
    description:
      "Find TikTok creators by keyword and return one row per creator: handle, bio, follower and like counts, " +
      "plus any contact email, Instagram, YouTube or WhatsApp link the creator publishes. Billed to your Apify " +
      "account at about $1 per 1,000 profiles.",
    inputSchema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Search terms, e.g. [\"skincare routine\", \"home workouts\"]",
        },
        minFollowers: { type: "integer", description: "Minimum follower count" },
        maxFollowers: { type: "integer", description: "Maximum follower count" },
        maxResults: {
          type: "integer",
          description: "Maximum profiles to return. Keep this small while testing (default 20).",
        },
        onlyWithEmail: {
          type: "boolean",
          description: "Return only creators that publish a contact email",
        },
      },
      required: ["keywords"],
    },
  },
  {
    name: "find_youtube_channel_emails",
    description:
      "Resolve the contact email behind YouTube channels, alongside their videos and Shorts with views, likes, " +
      "tags and exact publish dates. One free contact row is returned per channel. Billed to your Apify account " +
      "at about $1.50 per 1,000 videos.",
    inputSchema: {
      type: "object",
      properties: {
        channels: {
          type: "array",
          items: { type: "string" },
          description: "Channel handles or URLs, e.g. [\"@handle\", \"https://youtube.com/@handle\"]",
        },
        searchQueries: {
          type: "array",
          items: { type: "string" },
          description: "Keyword searches instead of explicit channels",
        },
        maxResults: { type: "integer", description: "Maximum video rows in total (default 20)" },
        newerThanDays: { type: "integer", description: "Only include videos newer than N days" },
        includeChannelContacts: {
          type: "boolean",
          description: "Add one free contact row per channel with its About data and emails (default true)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_video_transcripts",
    description:
      "Get transcripts for TikTok videos, Instagram Reels, YouTube videos and Shorts, and X videos. Uses the " +
      "platform's own subtitles when they exist and speech-to-text when they do not. Billed to your Apify " +
      "account at about $2 per 1,000 subtitle transcripts ($5 per 1,000 speech-to-text ones).",
    inputSchema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "Video URLs across TikTok, Instagram, YouTube or X",
        },
        profiles: {
          type: "array",
          items: { type: "string" },
          description: "Creator profile URLs to transcribe the latest videos from",
        },
        maxVideosPerProfile: {
          type: "integer",
          description: "How many of the newest videos to transcribe per profile (default 3)",
        },
        language: { type: "string", description: "Preferred subtitle language, e.g. \"en\"" },
        includeSegments: {
          type: "boolean",
          description: "Include timestamped segments instead of one text block (default true)",
        },
      },
      required: [],
    },
  },
];

// ---------------------------------------------------------------------------

export async function handleMcp(request, env) {
  if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
  if (request.method !== "POST") {
    return withCors(
      new Response("This MCP endpoint accepts POST only.", {
        status: 405,
        headers: { Allow: "POST, OPTIONS" },
      })
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  const token = bearerToken(request);
  const batch = Array.isArray(payload);
  const messages = batch ? payload : [payload];

  const responses = [];
  for (const message of messages) {
    const response = await handleMessage(message, env, token);
    if (response) responses.push(response);
  }

  if (responses.length === 0) return withCors(new Response(null, { status: 202 }));

  return withCors(
    new Response(JSON.stringify(batch ? responses : responses[0]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
}

async function handleMessage(message, env, token) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id ?? null, -32600, "Invalid Request");
  }

  const isNotification = message.id === undefined || message.id === null;
  if (isNotification) return null; // notifications/initialized, cancelled, ...

  const { id, method, params } = message;

  switch (method) {
    case "initialize": {
      const requested = params?.protocolVersion;
      const version = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "ScrapeLads exposes three data tools backed by Apify actors. " +
          "Requests must carry an Apify token: Authorization: Bearer <token>. " +
          "Usage is billed to that Apify account. Keep maxResults small while exploring.",
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS });

    case "tools/call":
      return callTool(id, params, env, token);

    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

async function callTool(id, params, env, token) {
  const name = params?.name;
  const args = params?.arguments || {};

  if (!token) {
    return rpcResult(id, {
      content: [
        {
          type: "text",
          text:
            "Authentication required. Send your Apify API token as a request header:\n\n" +
            "  Authorization: Bearer <your Apify token>\n\n" +
            "Create one at https://console.apify.com/settings/integrations — usage is billed to that account.",
        },
      ],
      isError: true,
    });
  }

  try {
    let result;
    if (name === "find_tiktok_creators") result = await tiktokCreators(args, token);
    else if (name === "find_youtube_channel_emails") result = await youtubeEmails(args, token);
    else if (name === "get_video_transcripts") result = await transcripts(args, token);
    else return rpcError(id, -32602, `Unknown tool: ${name}`);

    return rpcResult(id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    });
  } catch (error) {
    return rpcResult(id, {
      content: [{ type: "text", text: String(error?.message || error) }],
      isError: true,
    });
  }
}

// --- tools -----------------------------------------------------------------

async function tiktokCreators(args, token) {
  const keywords = asArray(args.keywords);
  if (!keywords.length) throw new Error("keywords is required — pass an array of search terms.");

  const items = await runActor("tiktok-profile-scraper", token, {
    searchKeywords: keywords,
    minFollowers: args.minFollowers ?? 1000,
    maxFollowers: args.maxFollowers ?? undefined,
    maxResults: clampInt(args.maxResults, 20, 200),
    onlyWithEmail: args.onlyWithEmail ?? false,
    enrichBioLinks: true,
  });

  return summarise(items, 60);
}

async function youtubeEmails(args, token) {
  const channels = asArray(args.channels);
  const searchQueries = asArray(args.searchQueries);
  if (!channels.length && !searchQueries.length) {
    throw new Error("Provide channels (handles or URLs) or searchQueries.");
  }

  const items = await runActor("youtube-scraper", token, {
    channels,
    searchQueries,
    maxResults: clampInt(args.maxResults, 20, 200),
    maxResultsPerSource: 5,
    newerThanDays: args.newerThanDays ?? 0,
    includeChannelContacts: args.includeChannelContacts ?? true,
    fetchChannelWebsite: true,
  });

  return summarise(items, 60);
}

async function transcripts(args, token) {
  const urls = asArray(args.urls);
  const profiles = asArray(args.profiles);
  if (!urls.length && !profiles.length) {
    throw new Error("Provide urls (video links) or profiles (creator URLs).");
  }

  const items = await runActor("video-transcript-scraper", token, {
    urls,
    profiles,
    maxVideosPerProfile: clampInt(args.maxVideosPerProfile, 3, 20),
    language: args.language || undefined,
    includeSegments: args.includeSegments ?? true,
  });

  return summarise(items, 25);
}

async function runActor(actor, token, input) {
  const response = await fetch(`${ACTOR_BASE}${actor}/run-sync-get-dataset-items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(prune(input)),
  });

  if (!response.ok) {
    const raw = (await response.text()).slice(0, 600);
    let apiMessage = "";
    try {
      apiMessage = JSON.parse(raw)?.error?.message || "";
    } catch {
      /* not JSON */
    }

    if (response.status === 401) {
      throw new Error("Apify rejected the API token (HTTP 401). Check the token in your Authorization header.");
    }
    if (response.status === 402) {
      throw new Error(
        apiMessage || "The Apify account behind this token has insufficient credit for this run."
      );
    }
    if (response.status === 403) {
      // Commonly "Monthly usage hard limit exceeded", not a token problem.
      throw new Error(
        `Apify refused the run: ${apiMessage || raw.slice(0, 200)}. ` +
          "This is usually an account usage limit or plan restriction, not an invalid token."
      );
    }
    throw new Error(`Actor run failed (HTTP ${response.status}): ${apiMessage || raw}`);
  }

  const items = await response.json();
  return Array.isArray(items) ? items : [];
}

// --- helpers ---------------------------------------------------------------

function summarise(items, maxRows) {
  const rows = items.slice(0, maxRows);
  return {
    count: rows.length,
    truncated: items.length > maxRows,
    results: rows,
  };
}

function prune(object) {
  const out = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function clampInt(value, fallback, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function bearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// These return plain JSON-RPC objects; handleMcp serialises them once.
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version"
  );
  return new Response(response.body, { status: response.status, headers });
}
