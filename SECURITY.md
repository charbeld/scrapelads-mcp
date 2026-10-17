# Security

## What this server does with your data

- **Nothing is stored.** The server is stateless. No database, no queue, no cache of request bodies
  or responses.
- **Your API token is never persisted.** It is read from the `Authorization` header, used for the
  single upstream call to the actor API, and discarded when the request ends. It is not written to
  logs, disk or any storage.

  **Forwarding it to Apify is the design, not a side effect.** Every tool call sends your token to
  `https://api.apify.com`, which is how the run is billed to your own account and why you never hand
  credentials to an unknown scraping service. What this server does not do is keep it. If you would
  rather verify that than trust it, the whole server is in [`src/mcp.js`](src/mcp.js): `bearerToken()`
  reads the header, `runActor()` places it in a single `fetch`, and nothing writes it anywhere else.
- **No cookies, no sessions, no user accounts.** The server issues no session id and sets no state
  between requests.
- **Results pass through.** Actor output is returned to the caller and not retained.

## What leaves the server

The only outbound requests are to `https://api.apify.com`, carrying your token and the tool's input.
Nothing is sent to any third party.

## Reporting a vulnerability

Email **hello@scrapelads.com** with a description and, if possible, reproduction steps. Please do not
open a public issue for security problems. Expect a reply within a few days.

## Scope

The hosted endpoint at `https://scrapelads.com/mcp` is in scope. The upstream Apify actors, the
Apify platform itself, and third-party MCP clients are out of scope — report those to their
respective owners.
