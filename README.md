# Alpha Vantage — Stock and Market Data

Alpha Vantage's REST API for stock prices, fundamentals, technical indicators, forex, crypto, and economic indicators. ~20+ years of historical equities data, real-time-ish quotes (15-minute delayed on free tier), and structured fundamental data parsed from SEC filings.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Why this matters for AI agents

Where SEC EDGAR gives you raw filings, Alpha Vantage gives you cleaned-up structured data ready for analysis: income statements, balance sheets, cash flow, key ratios, recent earnings, technical indicators. For real-time-ish quotes during market hours, this is the source.

Common flows:

- **Quote.** "Where's AAPL trading?" → `av_quote({symbol: "AAPL"})` → latest price, change, volume.
- **Income statement.** "Apple's last 4 quarters of revenue/income." → `av_income_statement({symbol: "AAPL"})`.
- **Earnings.** "When does NVDA report next?" → `av_earnings({symbol: "NVDA"})`.
- **Daily price history.** "AAPL 1-year history." → `av_daily({symbol: "AAPL"})`.

Used by the `fintech_company_deep_dive` compound for the quote + income statement layer alongside SEC EDGAR.

## Auth

Free tier: 25 requests/day, 5 per minute, real key required. Get one in 30s at https://www.alphavantage.co/support/#api-key. Pass via `_apiKey`.

**The "demo" key**: Alpha Vantage advertises `demo` as a no-signup key, but it returns errors for most calls. Always use a real key — the gateway will surface the demo-key error if you forget.

Higher tiers ($50–250/mo) lift the daily cap and unlock real-time quotes (vs. 15-min delayed on free tier).

## Update cadence

- **Quotes**: real-time on paid tiers, 15-minute delayed on free, market hours only
- **Daily / weekly / monthly history**: end-of-day, refreshes after market close
- **Fundamentals**: refreshes within ~24h of new SEC filings
- **Earnings**: refreshes after each company reports

Pipeworx caches with TTLs aligned to these.

## Common pitfalls

- **Free-tier 5/min limit.** Bursting fails. Pace agent calls or upgrade.
- **Symbol vs ticker.** Mostly the same on Alpha Vantage, but a few non-US tickers need a suffix (e.g., `BARC.LON`). Default endpoints assume US-listed.
- **"Real-time" definition.** Free tier is 15-min delayed end-of-day-style snapshots. For algo trading, you want a paid tier. For agent research, free is fine.
- **Earnings calendar isn't always accurate.** Companies move report dates; Alpha Vantage updates eventually but sometimes lags by a day or two.
- **Adjusted vs unadjusted prices.** Daily-adjusted returns split- and dividend-adjusted closes; daily returns raw closes. For long-horizon analysis you almost always want adjusted.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "alphavantage": {
      "url": "https://gateway.pipeworx.io/alphavantage/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/alphavantage/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Alphavantage data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

## No MCP client? Call it over HTTP

Our alphavantage key is reserved for paid accounts, so an anonymous call to `POST https://gateway.pipeworx.io/v1/tools/av_quote` needs your own key passed as `_apiKey` alongside the arguments. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/av_quote`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.
