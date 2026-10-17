# ScrapeLads MCP Server

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that gives AI assistants
access to three social-data extractors, backed by [Apify](https://apify.com/scrape-lads) actors.

**Endpoint:** `https://scrapelads.com/mcp` · Streamable HTTP · stateless

## Tools

| Tool | What it returns |
|---|---|
| `find_tiktok_creators` | TikTok creators by keyword: handle, bio, follower and like counts, plus the contact email, Instagram, YouTube or WhatsApp link the creator publishes |
| `find_youtube_channel_emails` | The contact email behind YouTube channels, alongside their videos and Shorts with views, likes, tags and exact publish dates |
| `get_video_transcripts` | Transcripts for TikTok videos, Instagram Reels, YouTube videos and Shorts, and X videos — native subtitles first, speech-to-text when a video has none |

## Connect

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "scrapelads": {
      "url": "https://scrapelads.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_APIFY_TOKEN"
      }
    }
  }
}
```

Any MCP client that supports remote HTTP servers works the same way.

## Authentication

You bring your own Apify API token, sent as `Authorization: Bearer <token>`. It is read from the
request, forwarded to the actor API for that single call, and never stored.

Calls without a token return a message asking for one — there is no fallback to the operator's
account.

Usage is billed to your Apify account at the actors' published per-result prices, against whatever
plan or free credit that account has.

## Protocol

JSON-RPC 2.0 over Streamable HTTP. Supported methods: `initialize`, `ping`, `tools/list`,
`tools/call`. Notifications (messages without an `id`) receive `202` with an empty body. The server
issues no session id, so every `POST` is independent and it runs fine behind any serverless host or
proxy. CORS is open, so browser-based clients can call it too.

```bash
curl -s -X POST https://scrapelads.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Source

[`src/mcp.js`](src/mcp.js) is the complete server: request handling, tool schemas, the actor calls and
error handling, in about 300 lines with no dependencies. It runs as a Cloudflare Worker route in front
of a static site, but nothing in it is Cloudflare-specific beyond the `env.ASSETS` binding used for
serving the site itself.

## Links

- Product page: <https://scrapelads.com/mcp-server/>
- Actors: <https://apify.com/scrape-lads>
- Registry: `com.scrapelads/scrapelads` on the official MCP registry

## License

MIT — see [LICENSE](LICENSE). Security notes in [SECURITY.md](SECURITY.md).
