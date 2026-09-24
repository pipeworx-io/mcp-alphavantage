# Alpha Vantage — Stock and Market Data

Alpha Vantage's REST API for stock prices, fundamentals, technical indicators, forex, crypto, and economic indicators. ~20+ years of historical equities data, real-time-ish quotes (15-minute delayed on free tier), and structured fundamental data parsed from SEC filings.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1679+ live data sources.

## Why this matters for AI agents

Where SEC EDGAR gives you raw filings, Alpha Vantage gives you cleaned-up structured data ready for analysis: income statements, balance sheets, cash flow, key ratios, recent earnings, technical indicators. For real-time-ish quotes during market hours, this is the source.

Common flows:

- **Quote.** "Where's AAPL trading?" → `av_quote({symbol: "AAPL"})` → latest price, change, volume.
- **Income statement.** "Apple's last 4 quarters of revenue/income." → `av_income_statement({symbol: "AAPL"})`.
- **Earnings.** "When does NVDA report next?" → `av_earnings({symbol: "NVDA"})`.
- **Daily price history.** "AAPL 1-year history." → `av_daily({symbol: "AAPL"})`.

Used by the `fintech_company_deep_dive` compound for the quote + income statement layer alongside SEC EDGAR.

## Auth — bring your own PAID key (Pipeworx fronts none)

**This pack is BYO-only as of 2026-09-02** (Bruce's ruling on fleet #1117). Pipeworx
does not supply a key: the gateway entry no longer names
`PLATFORM_ALPHAVANTAGE_KEY`, so `_apiKey` is whatever you pass and nothing else.
Call it with no key and you get a refusal that says the pack requires an API key
and names two working substitutes — no upstream call is spent producing it.

**A FREE Alpha Vantage key will not work here, whoever it belongs to.** Alpha
Vantage meters its free tier by SOURCE IP and never validates the key at all —
measured 2026-09-02 on three real keys plus the invented string
`ZZZZINVALIDKEY99`, which drew the same "25 requests per day" refusal from our
gateway that a real key did, and returned real IBM data from a laptop in the same
minute (fleet #1070; the full measurement is in the header of `src/index.ts`).
Because the address the call leaves from is what is spent, your free key is
refused through the gateway for exactly the reason ours was. That also means a
laptop test proves nothing about this pack: any string "works" from an IP with
budget left.

**What does work: a PAID key.** Premium ($50–250/mo) is the one thing Alpha
Vantage actually authenticates — its premium endpoints refuse a free key by name.
Untested from here, since we do not hold one, so treat it as an inference rather
than a measurement. Pass it via `_apiKey`.

**If you have no paid key**, use the substitutes the refusal names, both of which
answer these questions today:

- `get_company_financials` (**sec-xbrl** pack) — US income statements, balance
  sheets and cash flow, **keyless**, no daily cap. Covers everything
  `av_overview` / `av_income_statement` / `av_balance_sheet` / `av_earnings` do
  for US filers.
- **finnhub** — real-time quotes, free key, 60 calls/min and no daily cap.
  Covers `av_quote`, and non-US symbols.

**The "demo" key**: Alpha Vantage advertises `demo` as a no-signup key, but it
returns errors for most calls, and through the gateway it hits the same IP meter
as any other free key. The pack refuses it explicitly.

## Update cadence

- **Quotes**: real-time on paid tiers, 15-minute delayed on free, market hours only
- **Daily / weekly / monthly history**: end-of-day, refreshes after market close
- **Fundamentals**: refreshes within ~24h of new SEC filings
- **Earnings**: refreshes after each company reports

Pipeworx caches with TTLs aligned to these.

## Common pitfalls

- **Free-tier 5/min limit.** Bursting fails. Pace agent calls or upgrade. Moot
  from Pipeworx, where a free key never gets as far as the per-minute limit.
- **A spent daily allowance is an error, not an empty answer.** Once the 25-a-day
  cap on YOUR key is gone, every tool in this pack fails with `auth_required` and
  the words "the daily request allowance behind this key is spent" —
  deliberately, so the gateway can attach a `credential` block saying whose key
  ran out. It used to answer `{found:false, reason:"quota_exceeded"}`, which reads
  as a successful call to every consumer that does not parse prose, and a spent
  key was reported healthy for weeks (fleet #1091). A SHORT throttle — a notice
  naming only a per-minute frequency — is still a soft
  `{found:false, reason:"rate_limit"}`, because that one really does clear on its
  own. Since #1117 that block can only ever say `caller`: the pack left the
  platform-key probe rotation along with the platform key, so there is no
  Pipeworx allowance left to spend.
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

Both URLs reach the same gateway and the same 1679+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

Our alphavantage key is reserved for paid accounts, so an anonymous call to `POST https://gateway.pipeworx.io/v1/tools/av_quote` needs your own key passed as `_apiKey` alongside the arguments. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/av_quote`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "alphavantage": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-alphavantage"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-alphavantage
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

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
