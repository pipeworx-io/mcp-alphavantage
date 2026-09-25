interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    // Fleet #2382. Everything that isn't a timeout/abort here is a genuine
    // NETWORK-LEVEL failure — DNS resolution, connection refused, TLS handshake,
    // Cloudflare's own "Network connection lost." — meaning `fetch()` itself
    // threw and no HTTP response of any kind was ever received. Until this fix
    // that raw exception was rethrown VERBATIM: a bare `TypeError: fetch failed`
    // (or the Workers-runtime equivalent) names no upstream, carries no class
    // token, and reads exactly like a defect in OUR code — because it says
    // nothing about the call at all. It landed in `error`, the tier that means
    // "Pipeworx has a defect", for every one of the (at the time of writing)
    // ~470 packs that call this helper directly with no wrapper of their own.
    //
    // `dexscreener` hit this independently (fleet #1579) and fixed it with a
    // bespoke per-pack try/catch around `fetchWithTimeout`. That fix is correct
    // but only covers one pack; every other caller of this shared helper still
    // leaked the raw exception. Moving the same fix HERE — the one place that
    // already carries the timeout case — covers every pack that uses
    // `fetchWithTimeout` without a wrapper, for free, and without widening
    // `classifyToolError`'s regex list: the fix is giving the message a proper
    // `upstream_down:` token at the point the two facts (no response was ever
    // received, and which host we were trying to reach) are actually in hand,
    // not teaching the classifier to guess from prose after the fact.
    //
    // Safe on the same grounds as the timeout branch above: no argument a
    // caller passes can make `fetch()` itself throw a connection-level error,
    // so this is always an availability failure, never a caller mistake. Same
    // `markInternalOrigin` treatment — an origin we run that never answered is
    // still ours, not a third party's outage.
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(
      markInternalOrigin(
        `upstream_down: could not reach ${name} at all (${raw.slice(0, 160)}). ` +
          `No request reached ${name}, so this says NOTHING about whether the arguments you passed ` +
          'are valid — do not re-check them on the strength of this error. Retry shortly.',
        url,
      ),
    );
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * Alpha Vantage MCP — Stock market data, fundamentals, and earnings
 *
 * PAID-TIER PLATFORM KEY SINCE 2026-09-10 (Bruce). This reverses the 2026-09-02
 * `byok` ruling (fleet #1117): that ruling and #1129 were about the FREE tier,
 * which Alpha Vantage meters by server IP so no free key works from the
 * gateway. The key Bruce supplied on 09-10 is a PAID plan (verified: it answers
 * the premium intraday endpoint a free key refuses), metered by key, and the
 * gateway entry names PLATFORM_ALPHAVANTAGE_KEY with `paidKeyOnly: true` —
 * OUR key backs calls from PAID accounts only; everyone else passes `_apiKey`.
 * Callers with neither get the refusal in extractKey below, which says the
 * pack requires an API key and names two keyless substitutes.
 *
 * The key that has to be brought is a PAID one. A FREE key does not work from
 * our infrastructure at all — Alpha Vantage meters the free tier by source IP
 * and never validates the key, so a caller's free key is refused from our
 * egress for exactly the reason ours was, and both our egress paths are already
 * spent. See the measurement below (fleet #1070) before assuming a key of any
 * kind is the fix.
 *
 * Tools:
 * - av_quote: get real-time stock quote
 * - av_daily: get daily time series (price history)
 * - av_overview: get company overview/fundamentals
 * - av_income_statement: get income statement (annual + quarterly)
 * - av_balance_sheet: get balance sheet (annual + quarterly)
 * - av_earnings: get earnings data + EPS
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'Alpha Vantage');
}

const BASE = 'https://www.alphavantage.co/query';

/**
 * ALPHA VANTAGE'S FREE TIER IS METERED PER SOURCE IP, NOT PER KEY — AND NEITHER
 * OF OUR EGRESS PATHS HAS ANY OF THAT BUDGET LEFT.
 *
 * Measured 2026-09-02 (fleet #1070), the first three within one minute:
 *   gateway, a key Bruce had just issued  -> "25 requests per day" refusal
 *   gateway, the string "ZZZZINVALIDKEY99" -> the SAME refusal
 *   laptop,  the string "ZZZZINVALIDKEY99" -> HTTP 200, real IBM quote data
 *   supabase edge fn, that same string     -> the same 25-per-day refusal
 *
 * A key Alpha Vantage never validates cannot be the thing it is counting; what
 * is spent is the address we leave from. That rules out every fix that sounds
 * plausible here: rotating our platform key (Bruce supplied a fresh one and it
 * changed nothing), BYOK (a caller's free key is refused from our egress just
 * like ours), and the non-CF egress relay (its own IP is spent too — this is
 * the GLOBOCAN case, not the stackexchange case, so the host is deliberately
 * NOT allow-listed in supabase/functions/egress-proxy/index.ts).
 *
 * RE-CONFIRMED 2026-09-02 on a THIRD key, because the obvious response to all of
 * the above is to try one more. Bruce issued a new key and answered fleet #1070
 * with it. Measured the same hour:
 *   laptop, that new key            -> HTTP 200, real MSFT quote
 *   laptop, "ZZZZINVALIDKEY99"      -> HTTP 200, real IBM quote   <-- the point
 *   gateway, that new key as _apiKey -> the same daily-cap refusal
 * The second line is why a laptop check proves nothing here: Alpha Vantage does
 * not validate the key on this path at all, so ANY string "works" from an IP
 * with budget left. Validating a key from your workstation and concluding the
 * key is good is the trap; the only meaningful probe is from the gateway.
 *
 * What is left is a PAID key: premium is the one thing Alpha Vantage actually
 * authenticates, its premium endpoints refuse a free key by name. Not verified
 * from here — we do not hold one — so it is an inference, not a measurement.
 * Note BYOK does not rescue this either unless the CALLER's key is itself paid:
 * a caller's free key is metered by our egress IP exactly like ours.
 *
 * That is the whole content of Bruce's `byok` ruling on fleet #1117, and it is
 * worth stating plainly rather than leaving implied: BYOK here is NOT "any
 * caller key makes this work again". It restores the pack for the narrow set of
 * callers who already hold a PAID Alpha Vantage plan, and for everyone else it
 * makes the refusal honest and free — honest because a keyless caller now meets
 * our own "requires an API key" wall instead of Alpha Vantage's daily-cap prose
 * about a key they never supplied, and free because that wall is reached
 * without spending an upstream call. Every refusal names finnhub (quotes) and
 * keyless sec-xbrl (US company financials), which do work today.
 */

// ── Helpers ───────────────────────────────────────────────────────────

const FINNHUB_HINT = 'For real-time quotes without rate-limit headaches, the "finnhub" pack is a better default — get a free key at https://finnhub.io/register (60 calls/min, no daily cap).';

// For fundamentals (income statement / balance sheet / overview / earnings) the
// best fallback is keyless: SEC XBRL needs NO API key at all and is never
// quota-limited. Point US-company financial-statement queries there first.
const SEC_XBRL_HINT = 'For US-company financial statements without any API key, call get_company_financials (the "sec-xbrl" pack) — keyless SEC XBRL data, no daily cap. Pass it as `company` — a ticker (e.g. "NVDA") or a CIK. Then finnhub (needs a free key) covers non-US / real-time.';

function extractKey(args: Record<string, unknown>): string {
  const key = args._apiKey as string;
  delete args._apiKey;
  if (!key || typeof key !== 'string' || !key.trim()) {
    // THE BYO WALL, and the one refusal most callers of this pack will ever see
    // (Bruce, fleet #1117: `byok`). Three things it has to do, none optional:
    //
    // 1. Say "requires an API key", in those words. That clause is what marks a
    //    gated refusal as an expected access wall rather than a pack defect;
    //    without it the call books as an ERROR and the pack shows up on the
    //    problem-tool list for working exactly as designed.
    // 2. Carry the `auth_required:` prefix, which classifyToolError trusts
    //    unconditionally (workers/gateway/src/error-class.ts) instead of
    //    inferring the class from incidental wording.
    // 3. NOT send the caller to fetch a free key. The previous version of this
    //    message did ("Get one free at ... and pass via _apiKey") and it was
    //    measured wrong: Alpha Vantage meters its free tier by SOURCE IP and
    //    never validates the key, so a caller's free key is refused from our
    //    egress exactly like ours was. Telling someone to go and get a
    //    credential that cannot change the outcome is worse than refusing, and
    //    it is the same mistake this pack spent a month making about OUR key.
    //    Only a PAID key changes anything, because premium is the one thing
    //    Alpha Vantage actually authenticates.
    //
    // Both substitutes are named because they cover the pack's two halves and
    // both work right now: sec-xbrl keylessly for US financial statements,
    // finnhub for quotes.
    throw new Error(
      'auth_required: alphavantage requires an API key — Pipeworx fronts one for paid accounts only; otherwise pass your own via _apiKey. '
      + 'It must be a PAID Alpha Vantage key: their free tier is metered by source IP rather than by key, so a free key is refused through the gateway no matter whose it is (https://www.alphavantage.co/premium/). '
      + `Two substitutes that need no paid key at all: ${SEC_XBRL_HINT} ${FINNHUB_HINT}`,
    );
  }
  if (key.trim().toLowerCase() === 'demo') {
    throw new Error(`auth_required: The "demo" Alpha Vantage key is heavily rate-limited and only works for one specific symbol, and a free key of your own will not work either — Alpha Vantage meters the free tier by source IP, so it is refused through the gateway. A PAID key works (https://www.alphavantage.co/premium/). ${SEC_XBRL_HINT} ${FINNHUB_HINT}`);
  }
  return key;
}

async function avGet(apiKey: string, params: Record<string, string>, fallbackHint: string = FINNHUB_HINT): Promise<unknown> {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  url.searchParams.set('apikey', apiKey);

  // Declared BEFORE the first thing that can echo the upstream, not after it.
  // #1091 added this scrub for the 200-with-a-notice branches, where Alpha
  // Vantage quotes the key back in prose ("We have detected your API key as
  // <key>..."). The non-200 branch below forwards res.text() verbatim and sat
  // ABOVE the declaration, so it was the one path that could still put the key
  // into a thrown message — and a thrown message reaches Analytics Engine
  // (blob5) unscrubbed. That is how the previous key went out in live
  // rate-limit responses; rotating without closing this would refill the same
  // pipe with the new one.
  const scrub = (text: string): string => (apiKey ? text.split(apiKey).join('[redacted]') : text);

  const res = await pwFetch(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpha Vantage API error (${res.status}): ${scrub(text)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Alpha Vantage quotes the key straight back inside its own refusal prose
  // ("We have detected your API key as <key> and our standard API rate limit is
  // 25 requests per day"), so every branch below that repeats the upstream's
  // words redacts ours out of it first. The gateway scrubs injected credentials
  // from a RETURNED envelope, but the daily-cap branch now THROWS, and a thrown
  // message reaches Analytics Engine (blob5) unscrubbed — so leaving this to the
  // gateway would park our own platform key in the metrics store for the
  // retention window. Doing it here also keeps the standalone npm build honest,
  // where there is no gateway to scrub anything. (fleet #1091)
  // scrub is declared above, before the first branch that can echo upstream text.

  // Alpha Vantage returns error messages in the response body. Treat genuine
  // input errors (bad symbol, malformed request) as hard errors — the agent
  // should know to fix its call.
  if (data['Error Message']) {
    throw new Error(`Alpha Vantage error: ${scrub(String(data['Error Message']))}`);
  }

  // THE REFUSAL NOTICE ARRIVES UNDER EITHER KEY, and which one is not stable.
  // This used to be two separate branches: `Note` was hardcoded to
  // reason:'rate_limit' and only `Information` was classified. Measured live
  // 2026-09-02, minutes apart, on the same spent key:
  //   Information: "Thank you for using Alpha Vantage! Please contact
  //                 premium@alphavantage.co ..."          -> quota_exceeded
  //   Note:        "We have detected your API key as <k> and our standard API
  //                 rate limit is 25 requests per day ..." -> rate_limit
  // The SECOND is the more explicit daily-cap message and it was the one landing
  // in the branch that could not say so. Fleet #1091 was filed on exactly that
  // observation ("the reason string is rate_limit, NOT quota_exceeded") and read
  // it as a transcription error; it was the envelope key. Classify one notice,
  // whichever key carries it.
  const notice = data['Note'] ?? data['Information'];
  if (notice !== undefined && notice !== null && String(notice).trim()) {
    const info = scrub(String(notice));
    // A notice naming ONLY a per-minute frequency is a short throttle: wait a
    // minute and the same call works. Anything else, on a key whose entire free
    // allowance is 25 calls a DAY, is that allowance being spent — including the
    // bare "contact premium@alphavantage.co if you are targeting a higher API
    // call volume", which is what Alpha Vantage says once the day is gone.
    //
    // Narrow by construction rather than by wording: all six tools in this pack
    // call free-tier functions (GLOBAL_QUOTE, TIME_SERIES_DAILY, OVERVIEW,
    // INCOME_STATEMENT, BALANCE_SHEET, EARNINGS), so the third thing Alpha
    // Vantage uses these keys for — "this is a premium endpoint" — cannot be
    // reached from here. If a premium-only function is ever added to this pack,
    // it needs its own branch and a plan_required clause; do not let it fall in
    // here and get reported as a purchase that would not fix it.
    // The burst notice names a PER-SECOND frequency, not a per-minute one:
    // "Please consider spreading out your free API requests more sparingly
    // (1 request per second)" — measured live 2026-09-02. Matching only
    // /per minute/ meant that notice fell through to the daily-cap branch and
    // told the caller their allowance was gone when the next second would have
    // worked, which is the same defect in the other direction.
    const shortThrottle = /per (minute|second)/i.test(info) && !/per day/i.test(info);
    if (!shortThrottle) {
      // A SPENT DAILY ALLOWANCE IS A CREDENTIAL STATE, NOT DATA (fleet #1091).
      //
      // This used to return `{found:false, reason:'quota_exceeded'}`, and that
      // shape is invisible to everything that asks "is our key alive": the
      // monitor's platform-key probe classifies on `structuredContent.credential`
      // or `.error`, this payload carried neither, so it fell off the end of the
      // ladder into `pass` — at the HIGHER confidence band, so not even on the
      // list a human re-checks. The key had been spent daily for weeks while a
      // Needs Bruce item (#1070) said so and the board said healthy.
      //
      // Throwing hands it to the channel built for this. `auth_required:` is the
      // token classifyToolError trusts unconditionally (shared/src/error-prefix.ts),
      // and "the daily request allowance behind this key is spent" is the clause
      // PLATFORM_QUOTA_PATTERNS matches — together they produce a `credential`
      // block of {holder, state:'quota_exhausted'} on the response, which the
      // probe reads as `account_limited`: a purchase, not a key to rotate.
      //
      // The gateway decides the HOLDER, which is the half a pack cannot know:
      // our key and the caller's arrive in the same `_apiKey` slot, so a pack
      // that asserted "Pipeworx's key is spent" would say it to BYO callers too.
      //
      // Keyed on OUR wording rather than Alpha Vantage's, for the reason
      // jina-reader is: the vendor's prose has already changed under us once, and
      // a pattern chasing it fails silently. The coupling is pinned by a test in
      // workers/gateway/src/provisioned-platform-key.test.ts — reword this clause
      // and the build goes red instead of the class going quiet.
      //
      // ask_pipeworx still fails over: `auth_required` is retriable
      // (workers/gateway/src/index.ts ~14459) and the retry skips siblings that
      // would hit the same key wall, so keyless sec-xbrl is still reached.
      throw new Error(
        `auth_required: Alpha Vantage refused this call because the daily request allowance behind this key is spent (${info.slice(0, 200)}). `
        + 'The key itself is valid, so there is nothing to rotate and nothing a short retry will fix — it stays refused until the daily cap resets or the plan is raised at https://www.alphavantage.co/premium/. '
        // NOT "pass your own key and it works". Alpha Vantage meters the free
        // tier by source IP and never validates the key at all (see the header
        // note above: an invented key gets the same refusal, and the same
        // invented key returns real data from a laptop). Telling a caller to
        // supply their own key sends them to fetch a credential that cannot
        // change the outcome — the exact failure this pack was already making
        // about OUR key, aimed at theirs. Only a PAID key changes it, because
        // premium is the one thing Alpha Vantage authenticates.
        + 'Supplying your own FREE key via _apiKey will not help: Alpha Vantage meters the free tier by source IP, so a caller key is refused from here for the same reason ours is. A PAID Alpha Vantage key should work, since premium is what it actually authenticates — untested, we do not hold one. '
        + `${fallbackHint}`,
      );
    }
    // Soft-failed, same pattern as dictionary/europepmc/zippopotam: a structured
    // no-data with a hint pointing at finnhub, so the routing layer can recover
    // instead of crashing the conversation. Kept ONLY for the short throttle,
    // which really does clear on its own.
    return {
      found: false,
      reason: 'rate_limit',
      provider: 'alphavantage',
      message: info,
      hint: `Alpha Vantage is throttling calls on this key for the next minute or so. ${fallbackHint}`,
    };
  }

  return data;
}

// ── Tool definitions ──────────────────────────────────────────────────

const tools: McpToolExport['tools'] = [
  {
    name: 'av_quote',
    description:
      'Get real-time stock price for a symbol (e.g., "AAPL"). Returns current price, change, percent change, and trading volume. Needs your own PAID Alpha Vantage key via _apiKey — Pipeworx fronts no key for this pack and a free-tier key is refused when the call goes through the gateway (Alpha Vantage meters its free tier by source IP, not by key). Keyless alternative for US company financials: sec-xbrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: {
          type: 'string',
          description:
            'REQUIRED — your own PAID Alpha Vantage key. Pipeworx does not front a key for this pack. '
            + 'A free Alpha Vantage key will not work here: they meter the free tier by source IP rather than by key, '
            + 'so it is refused when the call goes through the gateway, whoever it belongs to. Paid plans: https://www.alphavantage.co/premium/. '
            + 'If you have no paid key, use sec-xbrl (keyless US financial statements) or finnhub (quotes) instead.',
        },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "SOFI", "AFRM", "SQ", "PYPL")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_daily',
    description:
      'Get daily stock price history for a symbol (e.g., "AAPL"). Returns open, high, low, close, volume for recent days or full 20+ year history. Needs your own PAID Alpha Vantage key via _apiKey — Pipeworx fronts no key for this pack and a free-tier key is refused when the call goes through the gateway (Alpha Vantage meters its free tier by source IP, not by key). Keyless alternative for US company financials: sec-xbrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: {
          type: 'string',
          description:
            'REQUIRED — your own PAID Alpha Vantage key. Pipeworx does not front a key for this pack. '
            + 'A free Alpha Vantage key will not work here: they meter the free tier by source IP rather than by key, '
            + 'so it is refused when the call goes through the gateway, whoever it belongs to. Paid plans: https://www.alphavantage.co/premium/. '
            + 'If you have no paid key, use sec-xbrl (keyless US financial statements) or finnhub (quotes) instead.',
        },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
        },
        outputsize: {
          type: 'string',
          description: '"compact" for last 100 data points (default), "full" for 20+ years of data',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_overview',
    description:
      'Get company fundamentals for a symbol (e.g., "AAPL"). Returns sector, market cap, P/E ratio, EPS, dividend yield, 52-week range, and analyst ratings. Needs your own PAID Alpha Vantage key via _apiKey — Pipeworx fronts no key for this pack and a free-tier key is refused when the call goes through the gateway (Alpha Vantage meters its free tier by source IP, not by key). Keyless alternative for US company financials: sec-xbrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: {
          type: 'string',
          description:
            'REQUIRED — your own PAID Alpha Vantage key. Pipeworx does not front a key for this pack. '
            + 'A free Alpha Vantage key will not work here: they meter the free tier by source IP rather than by key, '
            + 'so it is refused when the call goes through the gateway, whoever it belongs to. Paid plans: https://www.alphavantage.co/premium/. '
            + 'If you have no paid key, use sec-xbrl (keyless US financial statements) or finnhub (quotes) instead.',
        },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "GOOGL")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_income_statement',
    description:
      'Get annual and quarterly income statements for a symbol (e.g., "AAPL"). Returns revenue, gross profit, operating income, net income, and EBITDA. Needs your own PAID Alpha Vantage key via _apiKey — Pipeworx fronts no key for this pack and a free-tier key is refused when the call goes through the gateway (Alpha Vantage meters its free tier by source IP, not by key). Keyless alternative for US company financials: sec-xbrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: {
          type: 'string',
          description:
            'REQUIRED — your own PAID Alpha Vantage key. Pipeworx does not front a key for this pack. '
            + 'A free Alpha Vantage key will not work here: they meter the free tier by source IP rather than by key, '
            + 'so it is refused when the call goes through the gateway, whoever it belongs to. Paid plans: https://www.alphavantage.co/premium/. '
            + 'If you have no paid key, use sec-xbrl (keyless US financial statements) or finnhub (quotes) instead.',
        },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "MSFT")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_balance_sheet',
    description:
      'Get annual and quarterly balance sheets for a symbol (e.g., "AAPL"). Returns total assets, liabilities, equity, cash, and debt. Needs your own PAID Alpha Vantage key via _apiKey — Pipeworx fronts no key for this pack and a free-tier key is refused when the call goes through the gateway (Alpha Vantage meters its free tier by source IP, not by key). Keyless alternative for US company financials: sec-xbrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: {
          type: 'string',
          description:
            'REQUIRED — your own PAID Alpha Vantage key. Pipeworx does not front a key for this pack. '
            + 'A free Alpha Vantage key will not work here: they meter the free tier by source IP rather than by key, '
            + 'so it is refused when the call goes through the gateway, whoever it belongs to. Paid plans: https://www.alphavantage.co/premium/. '
            + 'If you have no paid key, use sec-xbrl (keyless US financial statements) or finnhub (quotes) instead.',
        },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "TSLA")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
  {
    name: 'av_earnings',
    description:
      'Get quarterly earnings data for a symbol (e.g., "AAPL"). Returns reported and estimated EPS, surprise amount, and surprise percentage. Needs your own PAID Alpha Vantage key via _apiKey — Pipeworx fronts no key for this pack and a free-tier key is refused when the call goes through the gateway (Alpha Vantage meters its free tier by source IP, not by key). Keyless alternative for US company financials: sec-xbrl.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        _apiKey: {
          type: 'string',
          description:
            'REQUIRED — your own PAID Alpha Vantage key. Pipeworx does not front a key for this pack. '
            + 'A free Alpha Vantage key will not work here: they meter the free tier by source IP rather than by key, '
            + 'so it is refused when the call goes through the gateway, whoever it belongs to. Paid plans: https://www.alphavantage.co/premium/. '
            + 'If you have no paid key, use sec-xbrl (keyless US financial statements) or finnhub (quotes) instead.',
        },
        symbol: {
          type: 'string',
          description: 'Stock ticker symbol (e.g., "AAPL", "NVDA")',
        },
      },
      required: ['_apiKey', 'symbol'],
    },
  },
];

// ── callTool dispatcher ───────────────────────────────────────────────

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const key = extractKey(args);

  switch (name) {
    case 'av_quote':
      return getQuote(key, args.symbol as string);
    case 'av_daily':
      return getDaily(key, args.symbol as string, (args.outputsize as string) ?? 'compact');
    case 'av_overview':
      return getOverview(key, args.symbol as string);
    case 'av_income_statement':
      return getIncomeStatement(key, args.symbol as string);
    case 'av_balance_sheet':
      return getBalanceSheet(key, args.symbol as string);
    case 'av_earnings':
      return getEarnings(key, args.symbol as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Tool implementations ─────────────────────────────────────────────

async function getQuote(apiKey: string, symbol: string) {
  const raw = await avGet(apiKey, {
    function: 'GLOBAL_QUOTE',
    symbol,
  });
  if ((raw as { found?: boolean }).found === false) return raw;
  const data = raw as { 'Global Quote': Record<string, string> };

  const q = data['Global Quote'];
  if (!q || Object.keys(q).length === 0) {
    throw new Error(`No quote data found for symbol: ${symbol}`);
  }

  return {
    symbol: q['01. symbol'] ?? symbol,
    open: q['02. open'] ?? null,
    high: q['03. high'] ?? null,
    low: q['04. low'] ?? null,
    price: q['05. price'] ?? null,
    volume: q['06. volume'] ?? null,
    latest_trading_day: q['07. latest trading day'] ?? null,
    previous_close: q['08. previous close'] ?? null,
    change: q['09. change'] ?? null,
    change_percent: q['10. change percent'] ?? null,
  };
}

async function getDaily(apiKey: string, symbol: string, outputsize: string) {
  const raw = await avGet(apiKey, {
    function: 'TIME_SERIES_DAILY',
    symbol,
    outputsize,
  });
  if ((raw as { found?: boolean }).found === false) return raw;
  const data = raw as {
    'Meta Data': Record<string, string>;
    'Time Series (Daily)': Record<string, Record<string, string>>;
  };

  const meta = data['Meta Data'] ?? {};
  const timeSeries = data['Time Series (Daily)'] ?? {};

  const dates = Object.keys(timeSeries).sort().reverse();

  return {
    symbol: meta['2. Symbol'] ?? symbol,
    last_refreshed: meta['3. Last Refreshed'] ?? null,
    outputsize,
    data_points: dates.length,
    time_series: dates.map((date) => {
      const day = timeSeries[date];
      return {
        date,
        open: day['1. open'] ?? null,
        high: day['2. high'] ?? null,
        low: day['3. low'] ?? null,
        close: day['4. close'] ?? null,
        volume: day['5. volume'] ?? null,
      };
    }),
  };
}

async function getOverview(apiKey: string, symbol: string) {
  const raw = await avGet(apiKey, {
    function: 'OVERVIEW',
    symbol,
  }, SEC_XBRL_HINT);
  if ((raw as { found?: boolean }).found === false) return raw;
  const data = raw as Record<string, string>;

  if (!data.Symbol && !data.Name) {
    throw new Error(`No overview data found for symbol: ${symbol}`);
  }

  return {
    symbol: data.Symbol ?? symbol,
    name: data.Name ?? null,
    description: data.Description ?? null,
    exchange: data.Exchange ?? null,
    currency: data.Currency ?? null,
    country: data.Country ?? null,
    sector: data.Sector ?? null,
    industry: data.Industry ?? null,
    market_cap: data.MarketCapitalization ?? null,
    pe_ratio: data.PERatio ?? null,
    peg_ratio: data.PEGRatio ?? null,
    book_value: data.BookValue ?? null,
    dividend_per_share: data.DividendPerShare ?? null,
    dividend_yield: data.DividendYield ?? null,
    eps: data.EPS ?? null,
    revenue_per_share: data.RevenuePerShareTTM ?? null,
    profit_margin: data.ProfitMargin ?? null,
    operating_margin: data.OperatingMarginTTM ?? null,
    return_on_assets: data.ReturnOnAssetsTTM ?? null,
    return_on_equity: data.ReturnOnEquityTTM ?? null,
    revenue_ttm: data.RevenueTTM ?? null,
    gross_profit_ttm: data.GrossProfitTTM ?? null,
    ebitda: data.EBITDA ?? null,
    beta: data.Beta ?? null,
    week_52_high: data['52WeekHigh'] ?? null,
    week_52_low: data['52WeekLow'] ?? null,
    moving_average_50: data['50DayMovingAverage'] ?? null,
    moving_average_200: data['200DayMovingAverage'] ?? null,
    shares_outstanding: data.SharesOutstanding ?? null,
    fiscal_year_end: data.FiscalYearEnd ?? null,
    latest_quarter: data.LatestQuarter ?? null,
  };
}

async function getIncomeStatement(apiKey: string, symbol: string) {
  const raw = await avGet(apiKey, {
    function: 'INCOME_STATEMENT',
    symbol,
  }, SEC_XBRL_HINT);
  if ((raw as { found?: boolean }).found === false) return raw;
  const data = raw as {
    symbol: string;
    annualReports: Record<string, string>[];
    quarterlyReports: Record<string, string>[];
  };

  return {
    symbol: data.symbol ?? symbol,
    annual_reports: (data.annualReports ?? []).map(formatIncomeReport),
    quarterly_reports: (data.quarterlyReports ?? []).slice(0, 8).map(formatIncomeReport),
  };
}

function formatIncomeReport(r: Record<string, string>) {
  return {
    fiscal_date: r.fiscalDateEnding ?? null,
    reported_currency: r.reportedCurrency ?? null,
    total_revenue: r.totalRevenue ?? null,
    cost_of_revenue: r.costOfRevenue ?? null,
    gross_profit: r.grossProfit ?? null,
    operating_expenses: r.operatingExpenses ?? null,
    operating_income: r.operatingIncome ?? null,
    net_income: r.netIncome ?? null,
    ebitda: r.ebitda ?? null,
    interest_expense: r.interestExpense ?? null,
    income_tax_expense: r.incomeTaxExpense ?? null,
    research_and_development: r.researchAndDevelopment ?? null,
  };
}

async function getBalanceSheet(apiKey: string, symbol: string) {
  const raw = await avGet(apiKey, {
    function: 'BALANCE_SHEET',
    symbol,
  }, SEC_XBRL_HINT);
  if ((raw as { found?: boolean }).found === false) return raw;
  const data = raw as {
    symbol: string;
    annualReports: Record<string, string>[];
    quarterlyReports: Record<string, string>[];
  };

  return {
    symbol: data.symbol ?? symbol,
    annual_reports: (data.annualReports ?? []).map(formatBalanceReport),
    quarterly_reports: (data.quarterlyReports ?? []).slice(0, 8).map(formatBalanceReport),
  };
}

function formatBalanceReport(r: Record<string, string>) {
  return {
    fiscal_date: r.fiscalDateEnding ?? null,
    reported_currency: r.reportedCurrency ?? null,
    total_assets: r.totalAssets ?? null,
    total_current_assets: r.totalCurrentAssets ?? null,
    cash_and_equivalents: r.cashAndCashEquivalentsAtCarryingValue ?? null,
    total_liabilities: r.totalLiabilities ?? null,
    total_current_liabilities: r.totalCurrentLiabilities ?? null,
    long_term_debt: r.longTermDebt ?? null,
    total_shareholder_equity: r.totalShareholderEquity ?? null,
    retained_earnings: r.retainedEarnings ?? null,
    common_stock_shares_outstanding: r.commonStockSharesOutstanding ?? null,
  };
}

async function getEarnings(apiKey: string, symbol: string) {
  const raw = await avGet(apiKey, {
    function: 'EARNINGS',
    symbol,
  }, SEC_XBRL_HINT);
  if ((raw as { found?: boolean }).found === false) return raw;
  const data = raw as {
    symbol: string;
    annualEarnings: Record<string, string>[];
    quarterlyEarnings: Record<string, string>[];
  };

  return {
    symbol: data.symbol ?? symbol,
    annual_earnings: (data.annualEarnings ?? []).map((r) => ({
      fiscal_date: r.fiscalDateEnding ?? null,
      reported_eps: r.reportedEPS ?? null,
    })),
    quarterly_earnings: (data.quarterlyEarnings ?? []).slice(0, 12).map((r) => ({
      fiscal_date: r.fiscalDateEnding ?? null,
      reported_date: r.reportedDate ?? null,
      reported_eps: r.reportedEPS ?? null,
      estimated_eps: r.estimatedEPS ?? null,
      surprise: r.surprise ?? null,
      surprise_percentage: r.surprisePercentage ?? null,
    })),
  };
}

export default { tools, callTool, meter: { credits: 10 }, provider: 'alphavantage' } satisfies McpToolExport;
