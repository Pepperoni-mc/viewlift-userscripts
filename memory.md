# Better Viewlift — Project Memory

Context file for AI assistants (GPT/Codex, Claude, etc.) picking up work on this repo.

## The CMS API integration, end state and how it actually works (2026-08-13, late)

This supersedes the scattered notes below it from the same day - several of those describe
intermediate wrong turns. **Read this one first for how the CMS lookup works now.**

### The three facts that took all night to establish

1. **The API host is per CMS host.** `cms-gcp.viewlift.com` talks to `cms-gcp.api.viewlift.com`,
   not a shared `cms.api.viewlift.com`. Hardcoding the latter is why credential capture silently
   recorded nothing for hours - the URL filter never matched a real request. The API origin is now
   recorded per brand alongside its key.
2. **Auth is two headers, both captured live, never hardcoded.** `xApiKey` (per brand) and
   `Authorization` (per user, 24h JWT). The capture module patches the PAGE's fetch/XHR via
   `unsafeWindow` - confirmed working live (`__bvCmsCredCaptureInstalled` is visible from the page
   and a probe request incremented `__bvCmsCredCaptureCount`). Credentials live only in GM storage,
   are never logged or displayed, and only go back to the API they came from.
3. **A brand switch is required when the org differs, and cannot be skipped.** Opening an account
   id while the session sits on another org renders an empty shell. But going through
   `/v5/overview` when the session is ALREADY on that brand is pure waste, so that case now goes
   direct.

### Debugging entry points (use these before re-deriving anything)

- `window.__bvCmsCredCaptureCount` / `__bvCmsCredLastSite` / `__bvCmsCredLastApiOrigin` /
  `__bvCmsCredCaptureError` - set on the CMS page window. Counts and brand slugs only, never
  credentials. If the count stays 0 while the user works, capture is broken.
- Tampermonkey menu → "CMS API: Check captured credentials" - token age and ready brands.
- **`data-better-viewlift-installed` is a hardcoded `'3.26.0'` string and tells you nothing about
  the running version.** Use behavioural markers instead (native Reply button removed ⇒ ≥3.30.1).
  Worth fixing properly one day.

### The two bugs that made cross-brand jumps "get stuck"

Both were real, and neither was slowness:

- Selecting an org makes the v5 app do **its own full page navigation** (lands on `/content`). The
  old code waited a fixed 1200ms then redirected, racing it - when the app won, the journey just
  stopped. Completion is now event-driven: `completePendingSwitchIfReady()` runs on every CMS page
  and continues to the destination once the session's `site` cookie matches the pending brand. **Do
  not reintroduce a timed redirect here.**
- `captureQuerySwitchRequest()` rebuilt the destination from the page's query string, overwriting
  the pending entry the button had just stored - and since the v5 URL only carries `betterSwitch`,
  that replaced a direct account URL with a bare keyword-less search page. It now leaves a usable
  pending entry alone.

### Speed work (the "it sits on about:blank" complaint)

The lookup used to start on click. It now **prefetches**: once ~2s after the button appears and
again on pointer approach (throttled to 5s, network side de-duplicated, 3min TTL keyed by
ticket+email+brand). A cache hit skips the holding tab entirely. When it does have to wait, the
tab paints a "looking up <email>" placeholder immediately and a 3.5s deadline falls back to the
search page, both funnelled through one `settle()` guard so the tab is never navigated twice.

Snapshot path: Freshdesk now reacts via `GM_addValueChangeListener` instead of a 900ms poll, and
capture dropped from `devicePixelRatio` scale to 1 (on retina that was 4x the pixels to render and
push through storage, for detail a support note doesn't need).

### Deliberately NOT done - decisions worth preserving

- **Tab reuse.** The button opens a new tab each time; duplicates of the same account do happen.
  A named `window.open` target would fix it, but it would also break having two accounts open side
  by side. Left alone on purpose - ask the user before changing.
- **Removing the keep-alive presence gate.** The session-extending call is gated on real
  mouse/keyboard activity in the last 30 minutes. That is a security decision, not an oversight
  (see the keep-alive entry below) - removing it is a regression.
- **Auto-submitting anything.** The refund workflow's existing auto-submit predates this work;
  nothing new was given the power to mutate customer data.

### Removing the Reply button silently broke toolbar placement (2026-08-14)

User reported the toolbar occasionally rendering misaligned (screenshot). Cause was self-inflicted
and worth remembering as a pattern: **removing a Freshdesk element that other code used as a
landmark.** `getActionBar()` had three candidates, the third being the native Reply button's
parent - and Feature 6 has removed that button since 3.30.1, so that candidate has been dead ever
since. On a slow load, with `.reply-bar-top` and `.page-actions__left` not yet rendered, detection
fell through to the bare `section#mainactionbar` after only 4s: a different flex layout, hence the
misalignment, followed by a visible jump when the real container appeared.

Fixed by deleting the dead candidate and raising the grace period 4s → 15s, so a slow load waits
for correct placement rather than rendering wrong and moving. The bare-section fallback now only
serves its intended purpose (Freshdesk renaming those classes) and `console.warn`s once when used.

`findHeaderInsertionPoint()` has the same dead Reply lookup but degrades correctly via
`firstElementChild`; left in place with a comment.

**Pattern to watch**: anything added to Feature 6's `removalRules` may be load-bearing elsewhere.
Grep for the selector before removing an element.

### A JWT refresher is impossible here - measured, don't rebuild it (2026-08-14)

User asked for "something that refreshes the JWT". **It cannot be built with these tokens, and it
would not fix the logout problem anyway.** Both points are measured, not assumed:

- `vl-accessToken` and `vl-refreshToken` are **both JWTs with a 24h lifetime that expire at the
  same instant** (checked live: 24h total, 23.9h remaining on each, identical claim sets). That is
  not a real refresh-token pattern - a refresh token exists precisely to outlive the access token
  so it can mint new ones. Here, when one dies the other is already dead, so a refresh could never
  extend a session past 24h. Inside the 24h window the access token is valid anyway, so there is
  nothing to gain.
- `vl-refreshToken` appears **nowhere in the client bundle** - it is handled server-side by the
  Next.js layer. And only the server can mint a signed token regardless.
- The recurring "logged out after minutes of inactivity" complaint is **not** token expiry (24h
  token, minutes-long problem). See the keep-alive entry below: by elimination it is a server-side
  idle timeout, which real authenticated traffic is the lever for - not a refresher.

**What was built instead** (the achievable part of the request): the stored token now also comes
straight from the `vl-accessToken` cookie on every CMS page load, not only from intercepted
request headers. Capture was purely passive before, so the stored copy was only as current as the
last request caught - and on routes where the app binds its fetch reference before injection,
nothing was caught at all. Now it is correct from page load and updates instantly after a re-login.

Both sources feed one record and the tie-break is deliberate: **newer expiry always wins; on equal
expiry the header wins.** The two sources format the value differently (a header may carry a
`Bearer ` prefix the cookie has no reason to), and the header value is known-good because it is
literally what the app put on the wire. Locked down by `tests/cred-precedence.test.js`.

### The session token is never refreshed - it is re-captured (2026-08-14)

Asked directly "how do you refresh the JWT?". **Nothing in this script refreshes it.** The CMS app
owns the token; the capture module just overwrites the stored copy with whatever the app is
currently sending. It therefore stays current as a side effect of the user working in CMS, and
goes stale only if they don't open CMS for a long stretch. There is no refresh endpoint call, and
`/v1/token` in the bundle is Firebase's, not ViewLift's (see above).

Answering that surfaced a real defect: staleness was judged by a flat 11h age limit, written when
the lifetime was believed to be ~12h - but the JWT was later measured at **1440 minutes (24h)**.
So valid tokens were being discarded with half their life left, dropping the CMS button to the
slow path for no reason (most visibly first thing in the morning, before any CMS tab had been
opened). Validity now reads the token's own `exp` claim (`bvTokenExpiresAt`/`bvCredsAreLive`) with
a 2 minute margin; the age limit survives only as a fallback for a token that isn't a readable
JWT. **If the lifetime changes again, nothing needs updating.**

### The repo now has a test (2026-08-13)

`tests/` - run everything with `node tests/run-all.js` (syntax check + all test files). It **extracts the
real helpers out of the shipped userscript** rather than duplicating them, so it cannot drift from
what actually runs. Covers the reported ticket #350804 garbage, glue-trimming in both directions
(without damaging mixed-case/subdomain/plus-tag addresses), and the blocklist. Extend this rather
than re-deriving one-off harnesses in scratch files.

### Legacy CMS search flow: disabled, not deleted (2026-08-13)

The old fill-the-box-and-click-Search module (`runCMSFlow`, `runCMSSearch`, `getPendingCMSEmail`,
`CMS_EMAIL_PARAM`, ~150 lines) has been unreachable since the button moved to CMS's own
keyword/filter URL. It was still *running* on every CMS page though - polling for up to 10s and
scanning every input each tick - and a stale pending email in storage would have been typed into
the search box. Its entry point is now disabled and the leftover storage keys cleared once. The
functions remain in the file on purpose: deleting interconnected code deserves a session where
someone can click through CMS afterwards.

### Open threads

- Whether a `user-search` call actually resets the server's idle timer is still unproven - it
  cannot be without sitting through a real idle period. If logouts persist, attack that first.
- The account-detail page's own API calls could not be observed from an injected patch (the app
  binds its fetch reference before injection on that route). If a future feature needs subscription
  or billing data, that is the obstacle to solve first.
- `/v1/token` in the bundle is **Firebase's** securetoken endpoint, not ViewLift session refresh.
  Don't chase it again.

## CMS button reduced to one click; email chips became the multi-address path (2026-08-13)

User: the CMS button "no funciona para nada bien", does too many checks before opening, wants
"click usuario y ya" - and proposed making each highlighted in-ticket email its own CMS lookup,
asking whether that would be redundant. **It isn't redundant, it's the better split**, and it is
what removed the slowness:

- **CMS button = the ticket's official Contact Info email only.** One `bvCmsUserSearch`, then
  straight into `/users/search/<id>`. Deleted the whole multi-candidate machinery added earlier
  the same day (`collectAllTicketEmailCandidates`, `findCmsAccountForCandidates`, the
  `showCmsEmailMenu` dropdown and its styles, `runCmsLookupAndOpen`) - that walked every address
  in the ticket through the API **sequentially**, so a ticket mentioning four emails meant up to
  four round-trips before anything opened. That sequential walk was the "demasiados checks".
- **Email chips = every other address the customer mentioned.** Feature 5 already surfaces those;
  each email chip now gets a companion 🔎 CMS chip that runs the identical lookup for that
  address. The human picks, which is strictly better than the script guessing, and it costs
  exactly one request when they do.

Wiring: `openCmsForEmail(email, clientContext)` is exposed as `window.__bvOpenCmsForEmail`, and
Feature 3 additionally exposes `window.__bvGetFreshdeskClientContext` so a chip's lookup resolves
to the same brand/host the button would have used (same cross-IIFE bridge pattern as
`__betterFreshdeskGetCustomerEmail` / `__bvReconcileFreshdeskToolbar`). `@version` 3.35.0.

**Careful when editing this area**: deleting the old dropdown block left an orphaned `}` from
`runCmsLookupAndOpen`'s closing brace that `node --check` caught - re-run it after any block
deletion here, the nesting is deep.

**Live check done while testing**: `data-better-viewlift-installed` is a **hardcoded `'3.26.0'`
string** that has never been updated on version bumps - it is useless for telling which version is
loaded, don't trust it (it cost time this session). Use behavioural markers instead: native Reply
button removed ⇒ ≥3.30.1, bot Generate toggle absent ⇒ ≥3.28.0, email pill absent/hidden ⇒
≥3.30.0. Worth actually fixing that attribute to interpolate the real version at some point.

## The CMS keep-alive never kept anything alive - measured, corrected (2026-08-13)

User asked to make the CMS login persistent instead of re-authenticating after some minutes of
inactivity. The 2026-08-10 entry below "fixed" this by repointing the keep-alive from a static
CloudFront SPA route to `/api/auth/verify`, and explicitly flagged the untested assumption:
*"the next thing to check is whether `/api/auth/verify` itself resets an idle timer server-side,
or only reports current status"*. **Measured it this time. It only reports.**

### What was actually measured (live, on cms-gcp.viewlift.com)

- `GET /api/auth/verify` returns `{error, valid}` and, compared before/after by fingerprinting the
  cookies, **changes neither `vl-accessToken` nor `vl-refreshToken`**. It rotates and extends
  nothing. So both keep-alive mechanisms have, since 2026-08-10, been doing nothing but polling
  status - the "fix" was never a fix, it just made the status *reading* accurate.
- The session cookies are JWTs with a **1440-minute (24h) lifetime** (claims: `aud, deviceId, exp,
  iat, iss, site, sub`). So being logged out after minutes of inactivity is **not** token expiry -
  a fresh token still had 1437 of its 1440 minutes left.
- No client-side idle-logout machinery found (no activity listeners, no idle/timeout globals).
- `/v1/token` with `grant_type`/`refresh_token` exists in the bundle but belongs to the **Firebase**
  SDK (`photoURL`, `_getAdditionalHeaders`, `tokenApiHost` alongside it), not to ViewLift's own
  `vl-` session - so it is NOT the session refresh endpoint. Don't be fooled by it next time.

**Conclusion by elimination**: token is valid for a day, no client timer, verify doesn't extend →
the logout is a **server-side idle timeout**, and only genuine authenticated backend traffic can
reset it.

### What was built

`bvCmsApiKeepAlive()` (prelude) now makes a **real authenticated call** every keep-alive tick: a
deliberately empty, read-only `user-search` (`searchTerm: 'bv-keepalive-noop'`, `limit: 1`) via the
CMS API credentials captured in 3.33.0. Crucially it authenticates with the **Authorization
header, not cookies**, so it works from the Freshdesk tab without depending on cross-site cookie
rules - which is the whole point, since Chrome freezes a backgrounded CMS tab's own timers. Wired
into Feature 1b2's existing 5-minute cycle; the old `/api/auth/verify` ping stays but is now
correctly scoped to driving the toolbar's session dot only, and Feature 1b's header comment was
corrected to stop claiming it keeps the session warm.

**Deliberate design choice worth keeping**: the session-extending call is gated behind
`agentIsPresent()` - real mouse/keyboard activity on Freshdesk within the last 30 minutes. An idle
timeout is a genuine security control on a system holding customer data and refund powers; this
bridges the specific gap it gets wrong (agent at their desk working in Freshdesk, CMS sitting in a
background tab) without keeping a session open for someone who actually walked away. If someone
later "simplifies" this by removing the presence gate, that is a security regression, not a
cleanup.

**Verified**: `node --check` plus the live measurements above (which is the part that actually
mattered - the previous attempt failed precisely because it skipped this). **Not verified**:
whether a `user-search` call genuinely resets the server's idle timer. That is the one remaining
assumption and it cannot be proven without sitting through a real idle period. If logouts persist,
that assumption is the thing to attack next - and the fallback would be to find which endpoint the
server does treat as activity, rather than assuming any authenticated call counts. `@version`
3.34.0.

## CMS API lookup from Freshdesk - the overnight dead end, reopened and solved (2026-08-13)

The 2026-08-12/13 overnight entry below concluded "open the account directly" was blocked: the
search API replay failed with `TypeError: Failed to fetch` and the result-row click needed a
genuinely trusted event. **The user then supplied the missing piece**: the API needs TWO request
headers, `xApiKey` (per brand) and `Authorization` (per user, **rotates ~every 12 hours**), both
visible on the `verify` call in CMS's network tab. My failed replay attempts sent neither
correctly - that's why they died at the network layer rather than returning a 401.

**Deliberately did NOT hardcode the keys**, even though the user pasted one and asked me to go
find the rest. Two concrete reasons, not caution for its own sake: (1) the Authorization token
dies twice a day, so any hardcoded value is broken within hours; (2) hardcoding means hunting a
key per brand by hand and re-hunting whenever they rotate. Instead the script now **captures both
headers from the user's own live CMS session**, which fixes the expiry problem permanently and
learns every brand automatically as the user works. Nothing secret lives in the repo.

### What was built

**1. Credential capture (CMS hosts, ~line 498).** Patches the PAGE's `fetch`/`XMLHttpRequest`
(via `unsafeWindow` - the sandbox's own copies never see the app's requests; added
`@grant unsafeWindow`) and reads `xApiKey`/`Authorization` off any `cms.api.viewlift.com` call,
plus the `site` slug from the request body. Purely passive - every original call still runs
unmodified, and every step is try/catch'd so a capture failure can never break CMS itself. Stored
in GM storage (`betterViewliftCmsApiCreds`): token globally with a timestamp, xApiKey per site,
plus a host→site map so hosts outside the explicit GCP brand mapping can still resolve a slug.
**Credentials are never logged, never shown in a notification, and only ever sent back to the same
CMS API they came from.**

**2. `bvCmsUserSearch()` (prelude).** Runs the real `/v2/admin/identity/user-search` via
`GM_xmlhttpRequest` (bypasses the CORS wall that blocked the overnight attempt). Treats the token
as expired at 11h - deliberately under the real ~12h rotation so a nearly-dead token fails cleanly
instead of mid-request.

**3. Direct account open (Feature 3).** The CMS button now asks the API which candidate email
actually has an account, then opens **`/users/search/<id>`** - the customer's own account page,
no results list. Confirmed real by inspecting CMS's own cached paths (see overnight entry).
Key details: the destination tab is opened **synchronously inside the click handler**
(`about:blank`, then redirected once the async lookup returns) because a popup opened after an
await gets killed by the blocker; and a direct account link for a GCP brand still routes through
the existing `betterSwitch` account switcher, just with the account URL as its `returnUrl`, so it
lands on the right organisation instead of an empty page. Only auto-opens on an **unambiguous
single match** - multiple matches deliberately fall back to the results list for a human to judge.

**4. Email detection, properly fixed.** Two layers now:
   - `trimGluedEmailSuffix()` handles junk glued onto the END, which the previous fix missed
     entirely: the regex's TLD class is case-insensitive, so `shaytaylor32@outlook.comContact`
     matched whole. Real domains are lowercase, so a lowercase→uppercase transition inside the
     domain marks the true end. Combined with the existing front-glue dedupe into one shared
     `normalizeEmailMatches()` used by both extraction paths.
   - The API lookup itself is the real upgrade: instead of *guessing* which of N addresses is the
     customer, it asks CMS which one exists, and reports when the account is under a different
     email than the ticket's.

**Verified for real (not just `node --check`)**: a standalone harness
(scratchpad `email-test.js`) run against the user's exact reported garbage from ticket #350804 -
the 6 raw regex matches (`350804shaytaylor32@outlook.comContact`, `TaylorEmailshaytaylor32@...`,
`Emailshaytaylor32@...`, `fanassist@viewlift.com`, `somebody@email.com`, and the real one) collapse
to exactly `shaytaylor32@outlook.com`, with mixed-case/subdomain/plus-tag/all-caps addresses
passing through untouched.

**NOT verified live** (be honest about this if it misbehaves): the capture and direct-open paths
need Tampermonkey to load 3.33.0 first. The *mechanism* is proven - patching page fetch captured
exactly `Content-Type, Authorization, xApiKey` during the overnight session - but whether
Tampermonkey's `unsafeWindow` reaches the page's fetch in this specific install is untested. If it
doesn't, capture silently no-ops and everything falls back to the old search-page behaviour.
**Debug entry point**: Tampermonkey menu → "CMS API: Check captured credentials" reports token age
and which brands are ready, without printing any credential. `@version` 3.33.0.

## Refund reason: yesterday's diagnosis was half-wrong - it's a MUI Select, and it was already correct (2026-08-13)

User pasted the actual reason field's DOM: a **MUI Select** (`role="combobox"` on a `<div>`, not a
`<button>` - Ember/Radix guesses from 2026-08-12 were wrong for this specific field), with a
hidden `<input class="MuiSelect-nativeInput" value="ROTH">` sibling. Critically, **the field's
current value was already "ROTH - Other/Did not say"** - MUI Select keeps its real value on that
hidden native input specifically so it's readable without opening anything.

2026-08-12's fix removed an "assume already selected" shortcut, reasoning it was unconditionally
wrong - but the actual bug was narrower: that shortcut's STRING check (does the trigger's text
literally avoid saying "select a reason") was fragile, not the *concept* of checking the current
value. Removing it entirely meant the workflow always tried to re-open/re-select even when the
value was already correct - and since this trigger is a `<div>`, not a `<button>`, the old
`getReasonTrigger()` selector's `button[role="combobox"]` variant never matched it (only the bare
`[role="combobox"]` alternative did), and its context-check only looked at
`element.parentElement?.innerText` - one level up - which misses MUI's `<InputLabel>Reason</InputLabel>`
sibling-of-the-Select pattern (the label lives on a `FormControl` ancestor, not the direct parent).
So the trigger was never confidently identified as "the reason field" and the workflow just spun
until the 20s timeout, every time - regardless of whether the value was already right.

**Fixed properly this time**: added `getReasonCurrentText()`/`isReasonAlreadyROTH()` - reads the
hidden `.MuiSelect-nativeInput` (or a real `<select>`, or the visible `[role="combobox"]` text as
last resort) and checks if it already says ROTH, checked FIRST before attempting any click/open at
all. Also broadened `getReasonTrigger()`'s context search to `element.closest('.MuiFormControl-root,
.MuiGrid-root, [role="dialog"] > div, form')` instead of just the direct parent, for the case
where the value genuinely isn't ROTH yet and a real interaction is still needed (untested whether
that click-to-open path itself works reliably - see the 2026-08-12/13 overnight entry above about
synthetic clicks needing genuinely trusted events on other MUI components in this same app; if
this field's dropdown has the same problem, "already correct by default" may be doing all the
real work here in practice).

Also made the 20s workflow timeout visible (`bvNotify`) instead of silent, naming exactly which
field(s) never got filled - directly answers "why didn't it submit automatically" instead of a
console warning nobody sees. `@version` bumped to 3.32.0.

**Verified**: `node --check` only, built from the user's pasted DOM - didn't live-test. If the
field's default is ROTH as often as the pasted snippet suggests, this should now complete the
auto-submit chain in the common case without ever needing to click anything.

## CMS button email detection was hallucinating garbage candidates (2026-08-13)

User pasted a real example: for ticket #350804 (customer `shaytaylor32@outlook.com`), the button's
email detection surfaced `350804shaytaylor32@outlook.com`, `tayloremailshaytaylor32@outlook.com`,
`emailshaytaylor32@outlook.com`, plus `fanassist@viewlift.com` and `somebody@email.com` as if they
were all real distinct candidates. Three separate real bugs, all in the same area
(`isBlockedCmsSearchEmail`/`collectAllTicketEmailCandidates`/`extractBestCustomerEmailFromText`,
Feature 3):

1. **Concatenation artifacts** - `collectTextFromRoot`'s scraped text sometimes has no whitespace
   between adjacent DOM text nodes (a ticket number, a name, or a label glued directly onto the
   real address - e.g. "...350804" + "shaytaylor32@outlook.com" with nothing between them). The
   email regex's local-part character class (`[A-Z0-9._%+-]+`) happily consumes that glued-on
   prefix, producing a "different" garbage email that's really the same real address with junk
   stuck to the front. Fixed both `collectAllTicketEmailCandidates` and (which had the identical
   risk, just less visibly since it only returns one result) `extractBestCustomerEmailFromText`:
   when one matched candidate is another matched candidate with extra text prefixed onto it
   (`candidate.endsWith(other)`, `other` shorter), drop the longer one and keep the clean suffix.
2. **Our own internal/bot addresses weren't excluded** - `fanassist@viewlift.com` (the "Fan
   Assist" triage bot mentioned in tickets, see the 2026-08-13 Cancel Subscription entry and
   others above) isn't in `CMS_SEARCH_BLOCKED_EMAILS` and doesn't match the generic support-pattern
   regex added 2026-08-12. Rather than adding bot names one at a time, added `OWN_DOMAIN_RE`
   (`@viewlift\.com$`) - a customer's real account email is never on our own company domain, so
   this excludes any `@viewlift.com` address categorically, present or future.
3. **Placeholder/example addresses weren't excluded** - `somebody@email.com` reads exactly like
   UI hint/placeholder text, not real data. Added `PLACEHOLDER_DOMAIN_RE` (email.com, example.com,
   test.com, domain.com, yourdomain.com, sample.com) and `PLACEHOLDER_LOCAL_PART_RE`
   (somebody/someone/anybody/example/yourname/username).

`@version` bumped to 3.31.1. **Verified**: `node --check` only - built from the user's pasted
example, not re-tested live against that exact ticket. If more garbage candidates show up, they're
most likely either another concatenation-artifact shape the suffix check doesn't catch (e.g. junk
appended AFTER the real email instead of before - the current fix only handles the "prefix glued
on" direction) or another internal-system address worth adding to the blocklist.

## A second, separate cancellation dialog was never covered by Feature 2 (2026-08-13)

User reported the Comments field on the "Are you sure you want to cancel Subscription?" confirm
dialog was still always empty, even after the Cancellation Reason fix earlier. Turns out this is a
genuinely different v5 dialog from the classic Cancellation Reason field Feature 2 (~line 3022)
targets - different trigger, different field (`textarea[placeholder="Add comments"]` inside a
MUI `role="dialog"`, not the classic UI's reason input Feature 2's `isCancelButton`/
`getBestReasonField` were built against. Feature 2 was never wrong, it just never had a code path
that could reach this dialog at all.

Added a new, separate feature (right after the CMS Percentage Refund Workflow, ~line 5216):
watches for any `[role="dialog"]` whose text includes "cancel subscription", and fills its
Comments textarea with the Freshdesk ticket link via the same `setControlledValue`
(native-setter + `_valueTracker` reset) pattern already proven throughout this file - this is a
plain MUI `<textarea>`, not an Ember Power Select or a table row, so it doesn't have the
"requires a genuinely trusted event" problem hit twice on 2026-08-12/13 elsewhere. Deliberately
does **not** touch the actual confirm/cancel button - matches this project's consistent rule of
auto-filling for human review, never auto-submitting a real cancellation. `@version` bumped to
3.31.0.

**Verified**: `node --check` only - built from the user's pasted DOM snippet, not live-tested
against the real dialog (didn't have live CMS access in this turn). If the field still comes back
empty, check in DevTools whether the dialog's `role="dialog"` text actually contains "cancel
subscription" (case doesn't matter, `cleanText(...).toLowerCase()` already normalizes it) and
whether the textarea's placeholder is exactly "Add comments" - the selector also has a broader
`textarea[placeholder*="comment" i]` fallback in case the exact wording differs from the snippet.

## Overnight deep-dive: CMS's real search API, real account IDs, why MSN feels faster - and two confirmed dead ends (2026-08-12/13)

User asked why MSN's CMS search feels much faster than SCHN/others, and insisted on skipping the
results list entirely - "OPEN the account directly" when there's a match - explicitly authorizing
using the CMS session/network token for this and working on it unsupervised overnight. Spent
significant live-browser time on this. Result: one real, safe improvement shipped; two deeper
approaches investigated thoroughly and confirmed **not currently achievable**, documented in
detail below so nobody re-discovers the same dead ends from scratch.

### Why MSN is faster than SCHN/LIV-Golf/Lightning - confirmed, and now visible to the agent

Not a bug - a real architectural difference. MSN (and Altitude/DIRT on the "standard" host) go
straight to `/users/search?keyword=&filter=all` in one hop. SCHN/LIV-Golf/Lightning all live on
the shared GCP host, which has **no account selector of its own** - if the CMS session isn't
already on the right org, the script has to first load the full v5 dashboard SPA, open the org
dropdown, select the right org, THEN redirect to the actual search. That's real, unavoidable
extra work (a heavier app has to load before the search can even start), not something client-side
script can speed up. The classic account switcher (`runV5Switch()`, ~line 2938) already
short-circuits to a direct redirect when the org is already correct - the slowdown only happens on
an actual cross-org switch. **Shipped**: a `bvNotify` right where a real switch is confirmed
necessary (`switchRunning = true` branch), so the delay reads as "expected, brand needs an account
switch" instead of a silent mystery slowdown. `@version` bumped to 3.30.2.

### What was investigated for "open the account directly, skip the search results list"

**Confirmed, real, useful facts (not guesses):**
- CMS's classic search is, under the hood, `POST cms.api.viewlift.com/v3.0/invoke` wrapping
  `POST /v2/admin/identity/user-search`, with `auth.site`/`query.site` as **per-request body
  fields** (e.g. `"site": "lightning"` for Lightning/Tampa Bay) - captured live via
  `unsafeWindow`-style fetch patching on a real search.
- The response shape is `{count, users: [...]}` - each user object has a real `id` (a UUID, e.g.
  `9c05130a-5ae3-43e0-b65e-c3b1133ba52f`), plus a full `identity` object (email, country, signup
  info, etc.).
- Confirmed TWO real, working detail-page URL formats (found as actual visited paths cached in
  CMS's own `localStorage` under our own `tm-viewlift-payment-handler:<pathname>` keys - i.e. proof
  these were really visited before, not guesses): **`/users/search/<id>`** (classic UI - confirmed
  live: clicking a real result row navigates here) and **`/v5/customer-support/user/<id>`** (v5
  UI, not live-tested this session).
- **A single real click on a result row DOES navigate correctly** to `/users/search/<id>` -
  confirmed live with a real account (`test@example.com` under Lightning, which has actual
  identity data - the earlier "row click does nothing" finding from earlier the same day was
  specific to a no-plan seed-stub account, not proof rows are unclickable in general).

**Dead end #1 - replaying the search API call ourselves (to search any brand without an account
switch, or to fetch just the id without rendering the UI): fails, not just CORS.** Tried twice:
once reusing captured `Authorization`/`xApiKey` headers verbatim, once with no auth headers at all
plus `credentials:'include'`. **Both attempts failed identically** with a bare `TypeError: Failed
to fetch` - before any response, meaning this isn't a "wrong token" problem (that would be a
401/403), it's the request never completing at the network/CORS layer. Since `customer::session`
in localStorage is stored as an **array of 16 elements, not a plain JWT string** (confirmed via
`typeof`/`Array.isArray` checks), the real auth is almost certainly derived per-request (possibly
signed, e.g. AWS SigV4-style) by the app's own bundled code, not a static bearer token that can be
lifted and replayed from outside that code. Rewriting the `site` field in the app's OWN outgoing
request (patching `fetch` to mutate the body in-flight, letting the real authenticated call still
go through) DID get intercepted successfully and DID reach the server (200 OK) but returned
`count: 0` for an account confirmed to exist under that site - inconclusive whether that's session-
level enforcement beyond the body field, or a wrong site slug for that specific test (the working
slug `"lightning"` was only confirmed later, for a different test). **Next session, if revisited**:
retest the site-rewrite specifically with the now-confirmed-correct `"lightning"` slug before
concluding it's session-enforced.

**Dead end #2 - automating the row click reliably: inconsistent, not shippable.** Tried the same
`mouseover/mousedown/mouseup/click` dispatch pattern that works elsewhere in this file (e.g.
`realClick` in the CMS Percentage Refund Workflow), then the full `PointerEvent` sequence plus
native `.click()`, then targeting the inner name/email `<div>` instead of the `<tr>`, then adding
explicit `detail:1`/`clientX`/`clientY` to the MouseEvent. **One observation looked like a delayed
success**, but a clean, isolated repeat (fresh page load, single dispatch, waited 4+ seconds)
**did not navigate** - the earlier apparent success was almost certainly leftover state from an
actual real `computer.left_click` done moments earlier in the same session, not the synthetic
dispatch working. Conclusion: this MUI table row's click handling appears to require a genuinely
trusted input event, same class of wall hit earlier the same day with Freshdesk's Agent field
(Ember Power Select) - **do not ship an auto-click-the-single-result feature on this evidence**,
it would work inconsistently in a way that's worse than not having it (confusing, hard to debug
without the user present). Tried reading the id directly off the row's React fiber
(`memoizedProps` walk for a UUID pattern) as a click-free alternative - found nothing within a
reasonable depth; the id is very likely captured in a closure (e.g. inside a `.map()` callback),
which isn't reachable via prop/fiber introspection at all, only via decompiling the actual
minified bundle.

**Bottom line for next time**: the “jump straight to the account” idea is directionally correct
and the data (real ids, real URLs) is all confirmed to exist - what's missing is a *reliable,
script-triggerable* way to either (a) read the id without a network replay (blocked - dead end #1)
or (b) trigger the navigation without a genuinely trusted click (blocked - dead end #2). Either
would need substantially more reverse-engineering (reading the actual minified CMS bundle to find
the signing logic, or finding some other click-independent read path) than a single session
supports. Flagging this clearly rather than shipping something that only sometimes works.

## Removed the toolbar's visible customer-email pill (2026-08-12)

User asked to remove "the email that shows up at the top" from the Unified Toolbar - the
click-to-copy email pill (`EMAIL_ID = 'better-freshdesk-action-email'`) that sat between the CMS
button and Set Agent. Removed the visible button, its CSS, and its slot in `orderedControls`.

**Found and fixed a real cross-feature dependency while removing it**: Feature 5 (quick-copy
emails mentioned in ticket messages, `getKnownTicketEmail()`) reads
`document.getElementById('better-freshdesk-action-email')?.dataset.email` to know which email is
already "known" so it doesn't offer a redundant copy-chip for it. Deleting the element outright
would have silently broken that exclusion (every mention of the customer's own known email would
start showing a copy-chip too). Kept a **hidden, off-toolbar** version instead
(`updateHiddenEmailHolder()` - a `display:none` span appended to `document.body`, not the
toolbar), so Feature 5's cross-read still works but nothing renders in the header. Simplified
`getEmail()` slightly while restoring it (dropped the rate-limited
`window.__betterFreshdeskGetCustomerEmail` cross-tab fallback and the
`CUSTOMER_EMAIL_BLOCKLIST` check) - acceptable here since this holder only feeds an exclusion
filter, not the CMS search itself (which has its own, already-generic, `isBlockedCmsSearchEmail`).
`@version` bumped to 3.30.0.

**Resolved**: user confirmed it's Freshdesk's own native top-action-bar "Reply" shortcut button
(`button[data-test-email-action="reply"]` inside `section#mainactionbar`) - NOT the actual
Reply/Note/Forward compose tabs at the bottom of the conversation, which are untouched and fully
functional. Added it to Feature 6 (Header Clutter Removal)'s existing `removalRules` +
CSS-hide list, same pattern as the other decluttered elements there (Freddy copilot trigger,
marketplace viewer, etc.) - actually removed from the DOM (not just hidden), matching how every
other rule in that list already behaves. This selector is also used elsewhere in the file as an
insertion-point reference (unified toolbar, CMS header button) - both already have a working
fallback (`leftActions.firstElementChild || leftActions`) for when it's absent, so removing it
doesn't break their positioning. `@version` bumped to 3.30.1.

## CMS button: multi-email dropdown when a ticket mentions more than one email (2026-08-12)

User asked two things together: (1) "the CMS button still 'searches' instead of directly opening
the account via the API" and (2) since we already detect multiple emails mentioned in a ticket
(Feature 5's quick-copy chips), give the CMS button a mini dropdown to pick which email to search
when there's more than one candidate.

**On (1): explained, didn't change anything.** The `keyword`/`filter` fix from earlier today
already IS "use CMS's own mechanism instead of DOM simulation" - CMS's `/users/search` page reads
those params and runs the real search itself, no typing/clicking simulated. What's left (landing
on a results list rather than jumping straight to the account) is CMS's own UI behavior, not
something this script is simulating - and jumping straight to a profile would need the account's
CMS id up front, which is only ever learned FROM a search result (the id-based `/users/<id>` URL
format was confirmed to exist, from `CMS_USER_URL_RE`/`getCMSUserIdFromURL`, ~line 412, but
there's no known way to get that id without searching first). Not pursued further - diminishing
returns already noted earlier today when investigating this same question.

**On (2): built.** Added to Feature 3 (Freshdesk Header CMS User Search):
- `collectAllTicketEmailCandidates(primaryEmail)` - scans the whole page via the existing
  `collectTextFromRoot` (already used by the Contact Info email lookup), regex-matches every
  email, dedupes, filters through the existing `isBlockedCmsSearchEmail` denylist, with the
  Contact-Info-sourced primary email always first. Effectively the same logic the (now-removed)
  bot integration's `collectTicketEmailCandidates` used, minus anything bot-specific - restoring
  that shape turned out useful again for an unrelated feature.
- `openCMSForEmail(email, clientContext)` - the CMS-opening logic (brand routing, GCP account
  switch, `keyword`/`filter` URL) extracted unchanged from the click handler into its own function
  so both the single-email direct-open path and the new dropdown's per-item click can call it.
- `showCmsEmailMenu(button, emails, clientContext)` / `closeCmsEmailMenu()` - a small floating
  menu (own id/style block, closes on outside click), positioned under the CMS button, listing
  every candidate email with the Contact-Info one tagged. Only shown when there's more than one
  candidate - a ticket with just one email keeps the exact same one-click behavior as before, no
  added friction.

Click handler now: get the primary email (unchanged) -> collect all candidates -> if >1, show the
menu and stop; if exactly 1, open CMS directly like before. `@version` bumped to 3.29.0.

**Verified**: `node --check` only - couldn't live-test the dropdown itself (needs Tampermonkey to
pick up the update first, and a ticket with genuinely multiple distinct emails mentioned). Ask the
user to confirm the menu appears/positions correctly and each item opens the right email next time
they're on a multi-email ticket.

**Same day, follow-up**: user asked the CMS button to always exclude our own support-team
addresses (`support@`, `getsupport@`, etc.), not just the 5 specific brand emails already
hardcoded in `CMS_SEARCH_BLOCKED_EMAILS`. Added `GENERIC_SUPPORT_LOCAL_PART_RE` to
`isBlockedCmsSearchEmail()` - matches the local-part (before `@`) against
`support`/`getsupport`/`customer.support`/`customer-support`/`*-appsupport`/`no-reply`/`help`/
`contact`/`info`, regardless of domain, so a NEW brand's support inbox is excluded automatically
without needing a hardcoded entry per brand. Mirrors Feature 5's existing
`EXCLUDED_LOCAL_PARTS` pattern (quick-copy email chips) - same idea, now also applied to the CMS
button's own email detection (both the primary Contact-Info lookup and the new multi-email
dropdown share this one function). `@version` bumped to 3.29.1.

## Freshdesk API key feature + full ViewLift Bot integration removal (2026-08-12)

**Context**: user reported Support Plan/Platform custom fields sometimes come back `"None"`
(set by an external triage system called "Fan Assist" when it can't determine them), which
blocks their workflow (couldn't submit "Waiting on End User"). Tried hard to fix this via DOM
automation first - confirmed live (via `/api/_/tickets/:id`, Freshdesk's internal Ember API) the
real field names are `cf_support_plan`/`cf_platform`, both sharing the exact same picklist
(`--/Enterprise/Business/Standard/Basic/Starter/None`) - but could NOT get automated clicking to
select an Ember Power Select option no matter what: real coordinate clicks, ref-based clicks,
keyboard nav, and even the exact working pattern copied from the Set Agent feature
(`clickAgentElement`: mouseover/mousedown/mouseup + native `.click()`) all silently did nothing.
Root cause never fully identified - possibly this Ember/Power-Select version specifically
distinguishes trusted vs script-dispatched events for this control, unlike the CMS-side Radix
components which tolerate synthetic events fine elsewhere in this codebase.

**Fix shipped instead: call Freshdesk's real API directly, bypass the fragile dropdown entirely.**
Added a per-user Freshdesk API key (Tampermonkey menu: "Freshdesk: Set API Key", `GM_setValue`
under `betterFreshdeskApiKey` - same never-read-by-anything-else-in-the-script pattern as the
former bot token). `freshdeskApiRequest()` (prelude, same scope as `bvNotify`) does Basic Auth
(`apiKey:X`, Freshdesk's documented convention) via `GM_xmlhttpRequest` against
`https://viewlift.freshdesk.com` (same-origin - added `@connect viewlift.freshdesk.com`). New
Feature (very end of file, inside the Freshdesk-host guard, right after Status Placement): reads
Support Plan/Platform's current DISPLAYED text only (read-only DOM, which works fine - only
*clicking to change* the value was the automation-resistant part), and if either shows `"None"`,
`PUT /api/v2/tickets/{id}` with `custom_fields: {cf_support_plan/cf_platform: "Standard"}` -
Freshdesk's real, documented v2 REST API, not the internal one (which 401'd on write with plain
cookie auth - it wants its own token/CSRF scheme this API key sidesteps entirely). User said "any
real value is fine, don't care which" - hardcoded `"Standard"` for both. No page refresh is
triggered after a successful PUT (would be disruptive mid-reply) - the fix lands server-side
immediately, `bvNotify` tells the agent to refresh to see it reflected in the form. No-ops
silently if no API key is saved yet, exactly like the removed bot integration used to.

**Verified**: `node --check` only for the new feature - did not click-test end-to-end (would need
a saved API key + a ticket with a real "None" field, and this session had already made enough
live-ticket changes on #350785 today). If it doesn't fire, check the key was actually saved
(Tampermonkey menu) and that the PUT isn't 401ing (would mean the key itself is wrong, not the
approach - the internal-API 401 encountered during investigation was a different, unrelated
endpoint).

**Corrected same day**: user clarified "None" is a legitimate, deliberately-chosen value on both
fields - it should be left alone. Only the actual unset placeholder, literally `"--"` (the first
option in both fields' shared picklist), is the real blocking state and should trigger the
auto-fill. Changed both `getPropertyFieldValue(...) === 'None'` checks to `=== '--'`. `@version`
bumped to 3.28.1.

**User hit `http-400` live** the same day. Since a 401/403 would mean the API key itself is wrong
(different error message), a 400 means the key works but Freshdesk's v2 API rejected the request
body/ticket state - the generic `'http-' + status` error swallowed Freshdesk's own JSON validation
reason, which is exactly the info needed to fix this for real instead of guessing. Fixed
`freshdeskApiRequest()` to attach the raw response body to the error object
(`error.responseBody`), and the feature's `onDone` now `console.warn`s it. `@version` bumped to
3.28.2. **Next session: if this recurs, read the actual `[Freshdesk API] Support Plan/Platform
update rejected:` console line** - leading guesses (unconfirmed) are the ticket being
closed/resolved (v2 API commonly blocks updates in that state) or some other required-field
validation Freshdesk enforces tenant-wide on ticket updates, not a problem with the "Standard"
value itself (confirmed to be a real, exact-match choice in the field's own picklist).

**Full removal of the ViewLift Bot integration**, per explicit user request the same day. This
was the `http://135.181.37.72:3001` "ViewLift Support Assistant" integration added 2026-08-10 (see
below) - `BV_BOT_BASE_URL`/`BV_BOT_TOKEN_KEY`/`BV_BOT_BRAND_MAP`, `getBotToken`/`promptForBotToken`
+ its menu command, `botApiRequest()`, `BOT_SITE_RULES`/`getBotSiteSlugForClient`,
`checkCmsAccountViaBot()` (the CMS-lookup pre-check fired after opening the CMS tab) and its call
site, and all of Feature 8's "Generate Reply" UI (`GENERATE_TOGGLE_ID`/`GENERATE_PANEL_ID`, their
CSS, `runGenerate`/`toggleGeneratePanel`/`copyGeneratedText`/`mountGeneratePanel`/
`getTicketThreadText`, the 🤖 toggle button and its `orderedControls` slot). Removed `@connect
135.181.37.72` from the header. Added cleanup for the old toggle/panel DOM ids to the toolbar's
existing legacy-control removal block (same pattern as `better-freshdesk-next-case`/
`better-freshdesk-refund-launcher`) so stale copies disappear for anyone with an old page open.
Note: this is unrelated to "Fan Assist" (whatever sets Platform/Support Plan to "None") and to the
`schn-reply-with-bot` third-party script/"🤖 Reply with Bot" button seen live in Freshdesk's own
toolbar - those are separate systems this repo doesn't control. `@version` bumped to 3.28.0.

## Fixed reason-selection in the CMS Percentage Refund Workflow - this one DOES auto-submit (2026-08-12)

**Important, load-bearing fact discovered this session**: unlike the Refund Capture Tool (the
Google-Sheets/Freshdesk-side panel, which deliberately never auto-clicks a final confirm - see
many entries below), there is a SEPARATE, pre-existing feature - "Feature 3: CMS Percentage
Refund Workflow" (~line 4830) - whose own header comment already says "Completes the Issue Refund
form and submits it automatically." Clicking the refund "eye" icon, the "Refund" dropdown trigger,
or the "Percentage" menu item on a CMS account starts a state machine (`runWorkflow`,
20s-timeout `WORKFLOW_TIMEOUT_MS`) that: opens Refund > Percentage, fills percentage=`100`, fills
the comments box with the Freshdesk ticket link, selects reason `ROTH`, and **once all three are
filled, auto-clicks "Issue Refund"/"Confirm Refund" with no further human click**. This was
already the shipped design before this session - not something introduced today.

User reported (2026-08-12) two things together: "make the refund happen right away when I click
the eye" and "it's not selecting the refund reason" - i.e. the auto-submit chain was stalling
because `reasonSelected` never became `true`, so the modal sat there filled out but unsubmitted.
Root cause, found by re-reading (not live-reproduced - too risky to trigger a real Issue Refund
click while debugging): `getReasonOption()`'s selector only looked for
`[data-slot="select-item"], [role="option"], [data-radix-collection-item]`, missing
`[data-slot="dropdown-menu-item"]`/`[role="menuitem"]` that `getPercentageRefundOption()` (which
works) already includes - broadened it to match. Separately, and probably the bigger bug: the
fallback branch assumed the reason was "already selected" whenever the trigger's text didn't
literally contain "select a reason" - if CMS's real placeholder wording differs at all, this made
`reasonSelected = true` immediately without ever opening the menu or picking ROTH, which could
have submitted refunds with the wrong (or blank) reason silently. Removed that guess entirely -
now it always opens the trigger and waits for a real ROTH match; the existing 20s timeout is the
only bailout, and it now fails loud (`console.warn`, dialog stays open unsubmitted) instead of
possibly submitting wrong. `@version` bumped to 3.27.1.

**Verified: `node --check` only.** Did NOT trigger the real Issue Refund flow on any account
(test or real) to avoid actually submitting a refund while testing. **User should test this on a
low-stakes case first** (not a real customer they don't intend to actually refund 100% for) since
once reason-selection completes, the workflow immediately auto-submits with no confirmation step -
that behavior already existed before today, this fix just makes it more likely to actually
complete the chain instead of stalling. If it still doesn't select the reason, the next step is
live inspection of the actual reason dropdown's DOM (open Issue Refund on a real case, read the
rendered markup, do NOT click Issue Refund) rather than guessing selectors again.

## Refund Capture speed + Freshdesk toolbar button race (2026-08-12)

User asked for two things: make Refund Capture faster, and fix the Freshdesk toolbar buttons
(CMS, Set Agent) sometimes appearing misaligned/out of order before settling - asked if they could
just be made `position: fixed`. Root-caused both instead of guessing.

**Refund Capture: `observeDynamicChanges()` was fully written but never called.** Found via a plain
grep for its own name - the function (Feature 1, ~line 1539) subscribes to `onRouteChange` with a
1200ms debounce + `requestIdleCallback` specifically to re-capture as soon as the page settles
after a DOM mutation (e.g. Freshdesk's Contact Info panel finishing its own async render). Nothing
in `initRefundCaptureTool()` ever called it. Without it, the panel relied only on the fixed-delay
`retryCapture()` cascade (1000/2500/5000/9000ms after page load) to catch data that wasn't on the
page yet on the first pass - both slower (up to 9s) and less reliable (real data could still land
in the gap between two fixed checkpoints). Wired it into `initRefundCaptureTool()` alongside the
existing cascade (kept as a backstop, not removed - low risk, cheap no-op once already captured
thanks to the existing `CAPTURE_COOLDOWN_MS` guard). The actual scrape itself
(`getPageLinesOutsidePanel`) was already appropriately cached (4s) and not the bottleneck - this
was purely a "the fast path exists but is disconnected" bug, not a perf-tuning job.

**Freshdesk toolbar jumping: a genuine cross-module insertion race, not a layout/CSS problem.**
The CMS header button (`installHeaderButton`, one IIFE) and Set Agent button
(`installSetAgentButton`, a different IIFE) each insert themselves as a sibling next to
Freshdesk's own reply button inside `.page-actions__left` - the exact same container the Unified
Toolbar (`installToolbar`, yet a third IIFE) targets and re-parents children into via its own
`orderedControls` reconciliation. Each of these three modules runs on its OWN independent
route-change-triggered debounce timer (CMS/Set Agent insert first, thinking they're placing
themselves in the action bar; the toolbar's own separate schedule only later notices and
`appendChild`-moves them into the toolbar div in the right slot). The visible "loose, then jumps
into place, sometimes in the wrong order" symptom is that gap between insertion and the toolbar's
next reconciliation pass - confirmed by reading all three insertion points, not by reproducing it
live (hard to force the exact timing window on demand).

Fix: exposed `window.__bvReconcileFreshdeskToolbar = installToolbar` from the toolbar's own IIFE
(same cross-IIFE bridge pattern already used elsewhere in this file, e.g.
`window.__bvPingCMSHostsNow`) and had both `installHeaderButton()` and `installSetAgentButton()`
call it immediately after inserting/moving their own button, collapsing the race window to zero
for the common case instead of waiting for the toolbar's independent timer to eventually notice.
`installToolbar()` was already idempotent (existence checks before creating anything, reconciles
order via `orderedControls` only if actually wrong) so calling it more often from more places is
safe by construction.

**Did NOT switch the toolbar to `position: fixed`** as literally asked - the toolbar buttons are
deliberately inline inside Freshdesk's own action bar for contextual placement next to Freshdesk's
reply/forward controls (unlike the refund/generate panels, which already ARE `position: fixed`,
anchored bottom-right, by design as floating overlays). Ripping the toolbar out to fixed
positioning would detach it from that context (screen-position overlap risk, no longer tracking
where the action bar actually is) and doesn't address the actual root cause found above. Flagged
this tradeoff to the user rather than silently reinterpreting "fixed" as the race-condition fix.
`@version` bumped to 3.27.0. Verified: `node --check` + logic trace only, same as other fixes
today - didn't reproduce the exact jump timing live.

## Autonomous 1-hour investigation: audit + a real routing gap surfaced (2026-08-12)

User asked a third time "can you use more of CMS's API" then said "investigate and improve it
yourself, I'll be back in an hour." Used the time for a defensive audit plus one more live
investigation thread, rather than forcing a low-confidence change. Findings:

**Audit: no other missing-`_valueTracker` bugs.** Grepped every `_valueTracker`/native-value-setter
in the file (6 independent implementations across the two-IIFE split: `setNativeValue` x2,
`setControlledValue` x2, `selectNativeROTH`'s inline select-setter, one more) - all 6 already
reset it correctly. The CMS-search one fixed earlier today was the only one missing it, not part
of a wider pattern.

**Tried and gave up on: deep-linking straight to a customer's CMS detail page.** Confirmed (via
`CMS_USER_URL_RE`/`getCMSUserIdFromURL` in the Refund Capture Tool, ~line 412/582) that CMS detail
pages ARE id-based - `https://<host>/users/<64-hex-or-uuid>` - so a direct deep link is
theoretically possible if you already have the id. But: (1) clicking a real search-result row in
the classic UI (tested live on `cms-gcp.viewlift.com` with the `test@example.com` seed account)
did not navigate anywhere - inconclusive whether that's because this particular seed account has
no normal detail page (plausible, it's a QOSS/external-style stub, not a real subscriber) or
because row-click-through needs a different interaction; (2) even if it does work for real
subscribers, we only ever learn the id AFTER a search already ran and rendered the row, so a
"deep link" wouldn't skip anything the `keyword`/`filter` fix doesn't already make fast. Not worth
more time without a real subscriber account to test against - if this comes up again, that's
where to pick it back up.

**Real gap found, NOT fixed (needs the user to confirm, not a guess): `cms-qcp.viewlift.com` has
zero brand routing.** `getCMSKeyFromClientText` (~line 8967, used by the Freshdesk CMS button to
decide which CMS host to search) only recognizes brands for 3 of the 4 known CMS hosts - msn →
Monumental, gcp → SCHN/LIV Golf/Lightning-Tampa, standard → Altitude/DIRTVision/VGK. `cms-qcp.
viewlift.com` (present everywhere else - `@match`, `@connect`, the keep-alive host list from
2026-08-10) has **no key in `CMS_USERS_URLS` and no brand pattern routes to it at all**. Cross-
referencing the ViewLift Support Bot's confirmed 9-brand platform list (from the 2026-08-10 bot
integration entry below) against what IS recognized leaves exactly 3 unrouted: **FOX One, Knight
Time, MOTV**. Strong circumstantial case these three live on the unused `qcp` host, but this is
inference, not confirmation - guessing wrong would silently send a real customer search to the
wrong CMS instance, worse than the bug fixed earlier today (that one at least searched the right
instance). **Did not add a `qcp` entry to `CMS_USERS_URLS` without that confirmation.**

**Shipped instead (safe, doesn't require knowing the real host): made the failure loud.** Added
`UNROUTED_KNOWN_BRANDS`/`getUnroutedKnownBrandLabel()` right next to `getCMSKeyFromClientText` -
detects FOX One/Knight Time/MOTV specifically (not "any unrecognized client", which stays a quiet
`console.warn` as before - that generic case is common and not worth alarming on) and fires a
`bvNotify` warning in the button's click handler: "has no CMS host configured yet - opening the
standard CMS instead, which likely won't have this customer." Same instinct as the existing
bvNotify migration (silent console-only failures nobody sees) applied to a gap discovered today
instead of a regression. `@version` bumped to 3.26.4.

**Next session, if the user confirms where FOX One/Knight Time/MOTV actually live**: add the
matching entry to `CMS_USERS_URLS` and the brand regexes to `getCMSKeyFromClientText`, following
the exact pattern of the existing 3 entries - then this whole notice becomes dead code and can be
deleted along with it.

**Resolved same day**: user confirmed Knight Time = Vegas Golden Knights, on the standard host
(`cms.viewlift.com`) - added `\bknight\s*time\b` to the existing `vegas golden knights|vgk` rule
in `getCMSKeyFromClientText` (same brand, same host, just another name for it) and removed it from
`UNROUTED_KNOWN_BRANDS`. **MOTV and FOX One: user explicitly said not to bother** ("no me importa")
- left unmapped on purpose, kept in `UNROUTED_KNOWN_BRANDS` so a ticket for either still gets the
loud `bvNotify` instead of silently searching the wrong CMS, but no host guess was made and none
should be without the user asking. `@version` bumped to 3.26.5.

## Cancellation Reason autofill was only using the ticket link on classic /users pages (2026-08-12)

User reported the Cancellation Reason field should always be the Freshdesk ticket link,
pre-filled the moment Cancel is clicked. `getCancellationReasonValue()` (Feature 2, ~line 3082)
had a path check - `getFreshdeskTicketURL()` only got used on pages matching `/^\/users(?:\/|$)/i`
(classic CMS); anywhere else (e.g. v5 cancellation flows) it went straight to the generic
`LEGACY_CANCELLATION_REASON` string instead, regardless of whether a real ticket URL was
available. No comment explained the restriction and nothing else in the file depends on it -
removed it, so the ticket link is now tried everywhere.

Also fixed a race this surfaced: the retry loop (`fillReasonField`, up to `maxFillAttempts=20` /
~1s) used to treat "ticket URL not ready yet" and "give up, no ticket URL ever" identically -
whichever value `getCancellationReasonValue()` returned on the very next branch became the
`LEGACY_CANCELLATION_REASON` fallback text immediately if the ticket URL (propagated cross-tab via
`GM_getValue('Freshdesk ID', ...)`) hadn't landed on attempt 1. Split it: keep retrying on empty
until `maxFillAttempts` is actually exhausted, only fall back to the generic text once the real
window has passed. `@version` bumped to 3.26.3.

Verified: `node --check` + logic trace only - didn't click a real "Initiate Cancellation"/"Cancel"
button live to avoid touching an actual cancellation flow on a real account. If the field still
shows the generic text instead of the ticket link, check whether `refund-freshdesk`/`Freshdesk ID`
actually had a value captured from the Freshdesk tab before Cancel was clicked - this fix can't
produce a ticket link that was never captured in the first place.

## CMS search now goes through CMS's own native URL params, not DOM simulation (2026-08-12)

User reported the CMS button found the right customer but the search field wasn't actually
getting filled/submitted, even after a first-attempt fix (adding the missing React
`_valueTracker` reset to `setNativeValue()` at line ~9473 — real bug, but not the whole story;
that fix landed in `1ea7e60` and is still correct/kept). User then asked directly: "can you use
CMS's API to do it instead?"

**Investigated live** (logged into `cms.viewlift.com` in a real browser tab, `read_network_requests`
during a manual search): CMS's own `/users/search` page reads `keyword` and `filter` straight off
the URL query string on load and **runs the real search itself** — confirmed by navigating cold
to `https://cms.viewlift.com/users/search?keyword=<email>&filter=all` with no click/DOM
interaction at all: the input was pre-filled, the Search button showed its active state, and a
real request went to `cms.api.viewlift.com/v3.0/invoke` returning an actual (empty, for the test
email used) result. Repeated identically on a second cold load - not a fluke.

This means the entire DOM-simulation flow the script had (`runCMSFlow`/`runCMSSearch`/
`getSearchUserInput`/`getSearchButton`, keyed off the script's own invented `openCmsEmail` URL
param) was solving a problem CMS's own frontend already solves better, natively, if you just link
to it correctly. **Fix**: repointed every place that builds a CMS destination URL for the
Freshdesk "CMS" button (the header button's direct destination, its GCP-account-switch pending
return URL, and the classic CMS account switcher's `captureQuerySwitchRequest()` return URL) to
use CMS's real `keyword=<email>&filter=all` params instead of the custom `openCmsEmail` — landing
on that URL now makes CMS run the search itself, whether via `window.open` (standard/MSN hosts)
or via `location.replace` after an account switch (GCP host).

**Left the old DOM-simulation module (`runCMSFlow`, `runCMSSearch`, `getSearchUserInput`,
`getSearchButton`, `openCustomerSupportPage`, `getPendingCMSEmail`, `CMS_EMAIL_PARAM =
'openCmsEmail'`, `CMS_PENDING_EMAIL_KEY`) in place, untouched, deliberately** rather than deleting
it in the same pass: nothing sets `openCmsEmail` anymore so it's now dead code, but ripping it out
needed its own careful pass (it's ~150 lines with several cross-references) and the priority was
landing a verified fix, not a cleanup. **Next session: safe to delete**, following the same
grep-every-caller pattern as the other orphaned-function sweeps in this file - confirm
`CMS_EMAIL_PARAM`/`CMS_PENDING_EMAIL_KEY`/`openCmsEmail` have zero remaining producers before
removing the consumers.

**Verified**: `node --check` (syntax) + 2x live cold-navigation confirmation of the exact
`keyword`/`filter` URL contract on `cms.viewlift.com`. **Not verified live**: the GCP
account-switch path specifically (`captureQuerySwitchRequest`'s new returnUrl) - that one is
code-reviewed only, since exercising it requires actually being on a different CMS account first.
If a GCP-hosted brand's CMS search still misbehaves after this, check that path first.

**Follow-up same day**: user asked "can you improve more functions using CMS's API?". Checked two
more candidates live:
- **`/users/search?keyword=&filter=all` on the GCP host too** - confirmed it's the same contract
  (`cms-gcp.viewlift.com/users/search`, NOT the bare `/users` the v5 org-switcher lands on, which
  does NOT read the query params) and, this time with a real seeded QA account
  (`test@example.com`, Lightning org), watched an **actual result row render** ("Active", IN,
  "No Plan") - not just an empty table like the earlier tests. Strong end-to-end confirmation the
  fix produces real rows, not just a plausible-looking empty state.
- **Account switching itself** - already optimal, don't touch: the classic switcher's
  `runV5Switch()` (~line 2966) already short-circuits to a direct `location.replace(returnUrl)`
  when the currently-active org already matches the target, only doing the actual v5
  dropdown-click-through when an org change is genuinely needed. Also newly confirmed live: org
  selection is persisted server-side (survives a hard navigation with no dropdown interaction at
  all, confirmed by nav-ing cold to a different URL on the same host and seeing the previously-
  selected org's logo still active) - so this isn't a client-state guess, it's a real session fact.

**Deliberately did NOT extend the "use CMS's API directly" pattern to**: Cancellation Reason
autofill (Feature 2, ~line 3014) or the refund-capture/refund-percentage flows. Those fill a real
form field for the AGENT to review and submit by hand - the entire point is a human checks it
before anything mutates. Replacing that with a direct API call would mean this script submitting
a real cancellation/refund action itself, which is exactly the automation this project has
deliberately avoided everywhere else (see the refund tool never auto-clicking "Issue Refund",
above). The `keyword`/`filter` trick is safe specifically because it's a **read-only lookup** -
that distinction is why it was fair game and those aren't.

## What this is

"Better Viewlift" (formerly "Better CMS") is a Tampermonkey userscript toolkit that adds
productivity tooling on top of two internal ViewLift systems:

- **Freshdesk** (`viewlift.freshdesk.com`) — support ticketing
- **CMS** (`cms.viewlift.com`, `cms-gcp.viewlift.com`, `cms-qcp.viewlift.com`,
  `cms.monumentalsportsnetwork.com`) — the internal content/customer management system

It's built and maintained by the repo owner (GitHub: `Pepperoni-mc`), author tags in the
scripts read "Happy, Potato". Development has been done with AI coding assistants (GPT/Codex,
and now Claude Code) rather than a team.

Repo: `https://github.com/Pepperoni-mc/viewlift-userscripts.git` (remote `origin`, branch `main`).

## Layout

```
scripts/
  better-viewlift.user.js     # the ONLY script in active use, ~9.4k lines, v3.8.0 — all active logic
                               # (legacy better-cms.user.js / better-freshdesk.user.js migration
                               #  stubs were removed 2026-08-09 — single-user setup, no need to
                               #  support old installs migrating forward)
  schn-case-tracker.user.js   # standalone script (v1.5) — auto-tracks Freshdesk tickets that hit
                               # "Waiting on End User" via the case-tracking bot at
                               # http://135.181.37.72:3001/api/ticket-tracker/
extension/
  better-viewlift-capture/    # "ViewLift Helper" — Chrome MV3 companion extension
    manifest.json             # v1.0.2, permissions: tabs; host_permissions: the 4 CMS domains
    background.js, content.js
  viewlift-helper-v1.0.*-*.zip  # packaged builds for Chrome Web Store upload
privacy-policy.md             # privacy policy for the ViewLift Helper Web Store listing
README.md                     # user-facing install/usage doc
```

## Why two delivery mechanisms (userscript + extension)

The core toolkit is a single Tampermonkey userscript (`better-viewlift.user.js`), installed via
raw GitHub URL with `@updateURL`/`@downloadURL` so it auto-updates.

The **ViewLift Helper** Chrome extension is a separate, optional companion: Tampermonkey/`html2canvas`
screenshots trigger Chrome's screen-share permission prompt every time. The extension uses the
`tabs` API instead, so CMS screenshots (refund captures) happen with no prompt. It has to be
side-loaded as an unpacked extension (Chrome doesn't allow silent extension installs from a
userscript) — see README "Install" section. It's also been submitted to the Chrome Web Store
(hence the packaged zips and privacy policy).

## What the toolkit actually does

**Freshdesk side:**
- Adds a `CMS` button on tickets that opens CMS and auto-searches the customer's email
- Cleans up reply text after "Apply" (dedupes greetings/paragraphs, spacing, quote markers)
- Auto-bolds boilerplate ("Technical Support Team", "Regards,")

**CMS side:**
- Refund capture panel: captures email, Freshdesk URL, CMS URL, payment handler, refund amount;
  remembers the selected refunder (persisted via `GM_setValue`)
- Auto-fills cancellation reason
- Camera snapshot button next to customer name, and on the Customer Support search page
  (via html2canvas, or via the extension's no-prompt tab capture when installed)
- Payment handler badge next to the camera button
- Hides its own helper UI from screenshots
- Handles CMS account switching (classic + v5 CMS UIs) and keeps sessions alive/warm so the
  Freshdesk → CMS handoff doesn't hit a logged-out state
- Works across CMS's internal SPA-style navigation without a full page refresh

## Recent history (most recent first, from `git log`)

1. `1c941e9` Use automatic DOM screenshots
2. `ad89e6e` Add ViewLift Helper privacy policy
3. `72713dd` Fix Web Store icon dimensions
4. `4cf0ba0` Add Web Store listing screenshot
5. `a1920fc` Add ViewLift Helper icon
6. `8e21b81` Rename companion extension to ViewLift Helper (was previously named differently)
7. `733a33f` Add no-prompt CMS capture helper
8. `6f77c54` Reuse screenshot capture permission
9. `c8d2af5` Speed up CMS snapshots and agent updates
10. `bba17e8` Resume CMS flow after logout
11. `2df8afc` Fix v5 account option detection
12. `b1e8fb3` Click CMS search after autofill
13. `9fc8534` Route Freshdesk CMS button through account switch
14. `4adf7ab` Keep CMS sessions warm
15. `f78ec06` Add visual CMS account menu
16. `3c322c5` Add classic CMS account switcher
17. `e54ed64` Open refund sheet at stable ID column
18. `4a5058b` Add brand-aware refund sheet button
19. `ed66cb0` Detect classic CMS refund confirmation control
20. `282d889` Support classic CMS refund modal

**Reading:** the last stretch of work was building and polishing the ViewLift Helper Chrome
extension (screenshot-without-prompt) and preparing it for the Chrome Web Store (icons, privacy
policy, listing screenshot). Before that, the focus was CMS account-switching/session
reliability (classic vs v5 CMS UI) and refund-flow robustness.

## Current repo state (as of 2026-08-09)

Working tree is clean except **untracked** build artifacts that have never been committed:
- `extension/better-viewlift-capture/icon128-resized.png`
- `extension/icon128.png`
- `extension/viewlift-helper-v1.0.1-upload.zip`

These look like Web Store submission assets — worth checking with the user before adding to git
(may be intentionally kept local, or just forgotten `git add`s).

Extension manifest is at `1.0.2`, but only `v1.0.1-upload.zip` is present untracked (no `v1.0.2`
zip yet) and there's also a stray `v1.0.1-final.zip` and `v1.0.2-final.zip` already tracked —
naming isn't fully consistent (`-upload` vs `-final`).

## Notes for future sessions

- No test suite, no build step — these are hand-edited userscripts loaded directly by Tampermonkey.
  "Testing" means loading the script in a browser against real Freshdesk/CMS and clicking through.
- No CLAUDE.md exists in this repo; this `memory.md` is the closest thing to project docs beyond
  the README.

## Manual "check now" + Copy Summary (2026-08-10)

**Manual CMS session check**: `pingAllCMSHosts()` now takes an optional `onComplete` callback and
exposes itself as `window.__bvPingCMSHostsNow` so the toolbar can trigger it on demand. Made the
session dot clickable - sets a new pulsing `data-status="checking"` state immediately, calls the
ping, then re-renders with the real result. Exists specifically so the user can verify the
`/api/auth/verify` keep-alive fix from this session actually works right after logging into CMS,
instead of waiting up to 5 minutes for the next scheduled check. Verified the checking->result
state transition with a simulated async ping.

**Copy Summary button**: added `#refund-copy-summary` next to the existing "Copy Row" in the
refund panel. "Copy Row" was already there but copies a tab-separated row formatted for pasting
directly into the Google Sheet - not something a human would want to read. Copy Summary instead
builds a plain `Label: value` block (email/Freshdesk/CMS/payment handler/amount/refunder),
skipping any field that's empty, for pasting into a note or Slack message. Verified the
formatting logic (including the empty-field-skip) with a standalone DOM simulation.

## Root cause of "CMS keeps logging out" - the keep-alive was pinging a static SPA shell (2026-08-10)

User pushed back that the anti-logout fix from last night wasn't working. Investigated live via
`read_network_requests` on real CMS tabs (cms.viewlift.com and cms-gcp.viewlift.com) and found
the actual bug: both keep-alive mechanisms (same-tab `fetch` and cross-tab `GM_xmlhttpRequest`)
were re-requesting the CURRENT PAGE ROUTE (e.g. `/users/search`) - but CMS is a CloudFront-served
React SPA, confirmed via `curl -I` showing `X-Cache: ... cloudfront` and a plain static
`text/html` response. Re-requesting a page route just gets the same static `index.html` shell
back, **always 200 regardless of whether the session is valid or not** - it never touches the
backend's real session/auth logic at all. The keep-alive was never actually keeping anything
alive; at best it gave a false "alive" reading forever, at worst it did nothing while also
reporting nothing wrong.

Found the real endpoint by watching what the CMS app itself calls on load:
**`GET /api/auth/verify`** (confirmed 200 on both cms.viewlift.com and cms-gcp.viewlift.com via
live network capture) - an actual authenticated API route, not a static asset. Repointed both
keep-alive mechanisms at `<origin>/api/auth/verify` instead of the bare page route, GET instead
of HEAD (matching what the real app does - unverified whether HEAD is even handled the same by
this route). Could not verify end-to-end that this actually prevents the real-world logout
(would need hours of real usage to confirm) - flagged this clearly to the user rather than
claiming certainty. **If this recurs, the next thing to check is whether `/api/auth/verify`
itself resets an idle timer server-side, or only reports current status without extending
anything** - those are different guarantees and I only confirmed the latter (the response is
real and endpoint-accurate), not the former.

**Related, same complaint's second half**: user reported other toolbar controls "appear in
other places" too, same as the CMS button did before its earlier fix. Checked every button-
creating module's page guard: Set Agent (`installSetAgentButton`) already correctly restricts
to `isTicketPage()` and actively removes itself when navigating away - not part of the bug. The
CMS button (`installHeaderButton`) had NO ticket restriction (`isFreshdeskPage()` only, any
Freshdesk page) - added the same create-on-ticket/remove-elsewhere pattern Set Agent already
used. Also fixed a second bug in the `onRouteChange` subscriber that re-triggers
`installHeaderButton()`: it early-returned whenever the button already existed, which meant
navigating FROM a ticket TO a non-ticket page via SPA routing (not a hard reload) would never
re-invoke the function that contains the removal logic - changed the guard to compare
button-exists against should-exist-here instead of just checking existence.

## Regression from the bvNotify migration, fixed same session (2026-08-10)

The "could not find a customer email" notification fired on the tickets list/filters page
(`/a/tickets/filters/...`), not just individual ticket pages - because `installHeaderButton()`
puts the CMS button on ANY Freshdesk page (`isFreshdeskPage()`, no path restriction), and
clicking it with no ticket open naturally finds no contact info (correct, not a bug), but I'd
made "not found" visible unconditionally when I migrated it to `bvNotify`. Fixed: gated the
"using ticket-text fallback" info notice to only fire on `/a/tickets/\d+` pages, and removed the
"total failure" notify entirely - the click handler that calls this function already shows a
native `alert()` when the email comes back empty, so the toast was a redundant second message
on top of that, not just noise on the list page. **Lesson: promoting a console.log to a visible
notification changes its blast radius - check every call site's context before assuming "always
show" is correct, the same way a new feature would need that scoping.**

## Unified visible-notification system: bvNotify (2026-08-10)

Structural fix for a pattern that showed up repeatedly today: real problems (CMS session dying,
an email lookup silently falling back to a worse method) only ever logged to `console.*`, which
nobody looks at during normal work. Added `bvNotify(message, {level, ttl})` to the shared
prelude (alongside `isCMSHost`/`waitFor`/`onRouteChange`) - a small stacked toast in the
top-right corner (warn=amber, error=red, info=blue), click-to-dismiss, auto-expires. Verified
live (had to check via DOM query, not screenshot - the browser tool was intermittently
unresponsive to screenshots all session, `getBoundingClientRect()` checks worked fine as a
substitute).

Migrated 4 existing scattered warnings to use it, each with a "don't repeat every check" guard
where relevant:
- Same-tab CMS keep-alive's "needs OTP/login" (`console.warn` before) - now also `bvNotify`,
  gated by a `lastNotifiedNeedsLogin` flag so it fires once per state transition, not every 8
  minutes while still logged out.
- Cross-tab keep-alive's aggregate status - same transition-gated notify, comparing against the
  previously stored `GM_getValue` state before overwriting it.
- `getCustomerEmailFromContactInfo()`'s fallback path (Contact Info panel lookup failed, using a
  less-reliable ticket-text scan instead) - this is the LEADING candidate for the still-
  unresolved colleague-reported CMS search bug from earlier today; now it's visible the moment
  it happens instead of a console.log nobody sees.
- The same function's total-failure path (no email found anywhere) - was `console.log`, is now
  a `bvNotify` warn.
- Consolidated the ad-hoc `showSearchedEmailToast` (added earlier today for the same bug) into a
  one-line call to `bvNotify` instead of its own bespoke fixed-position div - one less toast
  implementation to maintain.

Deliberately did NOT migrate the duplicate-refund warning banner (`#refund-duplicate-warning`) -
it's tied to specific panel state and benefits from staying visible until the case changes,
which doesn't fit the auto-expiring toast model as well.

## CMS session status dot + phone-number chips (2026-08-10)

**Visible keep-alive indicator**: the Freshdesk-side cross-tab keep-alive (Feature 1b2) pinged
CMS hosts silently with no way to confirm it was working short of digging through GM storage.
Changed `pingAllCMSHosts()` to track completion of all 4 host pings, then writes an aggregate
`{overall, hosts, checkedAt}` to a new shared key `BV_CMS_KEEP_ALIVE_STATUS_KEY`
(`betterViewliftCmsSessionStatus`). Added a small dot (`#better-freshdesk-cms-session-dot`) to
the Unified Toolbar's `orderedControls` that reads this on every `installToolbar()` pass -
green/red/amber for alive/needs-login/error, gray+"not checked yet" before the first ping
completes. Verified the read/render logic with a standalone simulation.

**Phone-number chips**: generalized the email-mention-chip module (added earlier today) into a
`DETECTORS` array (`{type, re, normalize, isExcluded}`) so it can flag phone numbers the same
way. `PHONE_RE` deliberately requires a separator between digit groups
(`\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}`) specifically so a bare 10-digit run (an order/ticket ID)
doesn't get flagged as a phone number - verified with `node -e` against both real phone formats
from an actual message in this ticket ("713-651-9333", "(713) 651-9333", "+1 713-651-9333") and
false-positive candidates (bare digit-string IDs), all behaved as intended.

## New features + an unresolved colleague-reported bug (2026-08-10)

**Duplicate-refund warning**: added a local, approximate history (`betterViewliftRefundHistory`
GM key, capped at 30 entries) recording `{email, amount, ticketUrl, capturedAt}` whenever the
Refund Capture Tool captures an amount on CMS. Before recording, checks for an entry with the
same email but a DIFFERENT ticket within the last 24h and shows a banner in the panel
(`#refund-duplicate-warning`) if found. **Important caveat, load-bearing for how this should be
understood**: this is NOT a record of confirmed completed refunds — the tool never auto-clicks
CMS's final "Issue Refund" confirmation (by design, for safety), so there's no signal anywhere
in the codebase for "a refund actually went through." This only detects "we captured refund info
for this email before," which is a reasonable gentle-nudge proxy, not a hard guarantee. Verified
the record/detect logic with a standalone simulation (same email + different ticket flags, same
ticket doesn't, different email never does).

**Removed a marketplace app icon** ("Translate Buddy") from the conversation view - added to the
existing Header Clutter Removal module's `removalRules` array, same pattern as the other
removals there.

**Unresolved: colleague reports the CMS button searches but returns no results for a real
customer.** Investigated live: tested the exact set-value-then-click-search sequence on both
`cms-gcp.viewlift.com` and `cms.viewlift.com` (one synthetic email, one real one) - both
searched correctly, ruling out a naive React-state-timing race. Also checked for a mismatch
between the CMS-button's account-detection (`getCMSAccountForClient`: schn/liv-golf/lightning)
and the classic account-switcher's recognized keys (`ORGANIZATIONS`: lightning/liv-golf/schn) -
they match exactly, ruling that out too. Confirmed symptom (via the user) is specifically "No
Data Available", not wrong-customer or a non-responsive button. Leading unconfirmed theory:
`getCustomerEmailFromContactInfo()` (prioritizes Freshdesk's official Contact Info panel, falls
back to scanning ticket body text) may be picking up an email that isn't actually the
customer's real CMS account email - either the contact-info lookup silently fails and falls
back to a less reliable text scan, or the customer's real account is on a different CMS
domain/brand than the one the ticket routed to. **Shipped a diagnostic instead of a blind fix**:
a toast on the CMS page ("Searched: x@y.com") showing exactly which email was used, so next
occurrence is self-explaining instead of a silent empty table. If it recurs, check what email
the toast shows against the customer's actual on-file email first.

## Orphaned-function sweep #2, following the toggleRefundPanel pattern (2026-08-10)

After finding `toggleRefundPanel()` had zero callers, ran a systematic sweep (grep every
`function name(` declaration, count total occurrences) for more of the same pattern. Found 8;
fixed the 2 that were real bugs, deleted the rest as confirmed dead code:

- **`scanEditors()`** — the auto-bold/font-normalizer module only reacted to
  keydown/paste/input; it never did an initial pass over editors already open/populated when
  the script attaches. Fixed by calling it once at module init (it already internally calls
  `addEditorFontNormalizerStyles()`, so this replaces that standalone call rather than
  duplicating it).
- **`truncateAfterFirstSignature()`** — sibling of `removeRepeatedTopGreeting`/
  `removeDefaultTemplateAfterAppliedScenario`, both of which ARE called from
  `cleanAppliedScenarioDuplicates()`, but this one wasn't. Added it as a third step in that same
  pipeline (handles a canned response applied twice leaving a duplicated signed message).
- **`makeButton(id, text, title)`** — turned out to be a small helper that creates exactly the
  kind of button the new refund-toggle needed. Used it instead of leaving it orphaned AND
  leaving my hand-rolled `document.createElement('button')` version in place.
- Deleted as dead code: `isV5UI()` (added in Stage 1, never actually migrated to by anything -
  a half-finished refactor, not a bug), `getDeepPageTextOutsidePanel()` + its recursive
  `collectDeepTextFromRoot()` helper (28 lines, shadow-DOM text scanning, no callers),
  `normalizeEditorFont()` (a pure pass-through alias to `normalizeEditorFormatting`, an old
  rename left behind), and **`requestExtensionCapture()`** (the full postMessage bridge to the
  ViewLift Helper extension for no-prompt screenshots).

**`requestExtensionCapture()` being dead is a bigger deal than the others**: it confirms
`captureRealTabSnapshot()` (the actual click handler behind both camera buttons) only uses
`html2canvas` now and never calls the extension bridge at all - matches the git history
("Use automatic DOM screenshots" superseded the extension-based capture). **The ViewLift Helper
Chrome extension currently has no active purpose in the code that calls it** - worth deciding
explicitly whether to keep maintaining/distributing it (e.g. for the Chrome Web Store listing)
or treat it as deprecated, rather than it just quietly rotting. Not decided yet, flagged for the
user.

## Root-caused "the button appears then disappears after ~1s" - orphaned toggle (2026-08-10)

Real bug, unrelated to anything from today's other fixes. Sequence: `createUI()` first shows the
panel as a floating minimized "$" pill (visible). Shortly after, `installToolbar()` runs and
calls `mountRefundPanel(toolbar)`, which re-parents the panel INTO the unified toolbar and adds
`.better-freshdesk-inline-panel`. Once inline-mounted, a different CSS rule takes over:
`[data-better-open="no"] { display: none !important; }` - and since `betterOpen` defaults to
`'no'`, the panel goes fully invisible the moment it gets absorbed into the toolbar. That's the
"~1 second" timing: however long `installToolbar()` takes to first run after `createUI()`.

There WAS a `toggleRefundPanel()` function already written to flip `betterOpen` and show it -
confirmed via `grep` that it had **zero callers anywhere in the file**. A comment nearby
(`// These legacy toolbar controls are intentionally removed`) removing
`better-freshdesk-refund-launcher` explains it: some earlier cleanup pass removed the OLD button
that used to call `toggleRefundPanel()` and never added a replacement trigger, leaving the
function orphaned. Diagnosed by instrumenting `Element.prototype.remove` (confirmed the panel is
never actually removed from the DOM - it's a pure CSS visibility issue) and by directly checking
`getComputedStyle(panel).display` before/after manually toggling `betterOpen` (none -> block,
confirmed).

Fix: added a new `#better-freshdesk-refund-toggle` button ("$" icon) to the unified toolbar's
`orderedControls`, wired to call `toggleRefundPanel()`, styled with the same gradient/glow
treatment as the other toolbar buttons from today's visual pass.

## Missed one in the visual pass: the refund-capture floating launcher (2026-08-10)

User pointed out "the refund capture button" specifically. Checked live: `#refund-capture-panel`
is NOT mounted inside the unified toolbar on Freshdesk (`mountRefundPanel` isn't actually
attaching it there in practice - parent is the top-level `ember-application` div) - it renders as
its own fixed-position floating "$" pill, bottom-right of the whole page, independent of the
toolbar. That's "the refund capture button" - missed it in the first visual pass because it
lives in the Refund Capture Tool module (`#refund-icon`/`#refund-header.is-minimized`), not
in the Unified Toolbar module I was focused on. Same fix as everywhere else: flat `#0b5cab` ->
gradient, added an inset highlight, added a proper `:active` press state (there wasn't one -
only a hover lift existed before). **Worth remembering**: `mountRefundPanel`'s toolbar-mounting
path may not be working as intended - didn't investigate further since visual polish, not
behavior, was the ask, but if the panel's placement itself comes up as a complaint later, start
there.

## Visual pass across all injected buttons (2026-08-10)

User asked for a visual improvement pass on every button/badge the toolkit injects. Surveyed
every `addStyles()`/`GM_addStyle()` block first: the CMS snapshot camera button
(`extension`-independent, in `Feature 4`) and the refund-capture panel were already the most
polished things in the codebase (gradient backgrounds, color-matched glow shadows, hover-lift +
active-press states, smooth transitions) — everything else (CMS header button, Set Agent button,
classic CMS account switcher, the brand/email pills in the unified toolbar, the new email-mention
chips) was comparatively flat: solid single color, 1px border, no shadow, no hover motion.

Used the camera button's language as the template and applied it consistently: gradient
background (light-to-darker same hue, ~20% darker at the bottom), border in the same hue,
`box-shadow` with a color-matched glow + `inset 0 1px 0 rgba(255,255,255,.15-.2)` top highlight,
`:hover` = lighter gradient + deeper shadow + `translateY(-1px)`, `:active` = reset translate +
inset shadow (press-down feel), `transition` on background/box-shadow/transform. Brand pills got
a lighter version (gradient + tinted box-shadow per brand's existing color, kept as a pill shape
`border-radius: 999px` instead of the old `6px` rounded-rect, to read as a "badge" rather than a
"button"). Bumped toolbar pill height from `30px` to `32px` to match the buttons next to them
(CMS/Set Agent are both 32px) — was a small but visible misalignment before.

Touched: `styleHeaderButton`/`ensureHeaderButtonStyle` (CMS button), `addSetAgentStyles` (Set
Agent), the classic CMS account switcher's `addStyles`, the Unified Toolbar's brand/email pill
CSS, and the email-mention chip CSS. Did NOT touch the camera button or refund panel (already the
reference standard) or the payment-handler badge (already has the gradient+glow treatment).
Verified with `node --check` only - couldn't get a live screenshot confirmation this round, the
browser tab was unresponsive to the automation tools at the time. User should visually confirm
once Tampermonkey picks up the update.

## Live feedback after waking up (2026-08-10, daytime): real regression found + new feature

User updated Tampermonkey and reported 3 things live: (1) the unified toolbar loads misaligned
then visibly jumps into place, (2) the tracker badge shows nothing, (3) wants a way to
one-click-copy an email a customer mentions in their own message text (found the concrete case
live: a customer wrote "It's my email cartwright.keith@gmail.com", different from the ticket's
registered email).

**(1) was a real regression from the overnight toolbar hardening**, root-caused live: the bare
`section#mainactionbar` fallback added to `getActionBar()` fires almost every page load because
Freshdesk's `.reply-bar-top`/`.page-actions__left` render a beat AFTER `#mainactionbar` itself
exists - so the toolbar installs into the bare section first (different flex layout → looks
misaligned), then the parent-mismatch re-verify (also added overnight) correctly detects the
real container appearing and relocates it → the visible jump. Fixed by splitting into a strict
`getActionBar()` (no fallback) and `getActionBarWithFallback()`, which only settles for the bare
section after a 4s grace period of the real containers never appearing -
`installToolbar()` now waits during that window instead of installing early. Verified against a
simulated DOM racing the real container's arrival before shipping (v3.16.1). **Lesson: the
"harden the selector" instinct from last night's audit had a blind spot - a broader fallback
selector isn't free, it can make the common case worse if reached prematurely due to timing.**

**(2) turned out to be correct behavior, not a bug** - `localStorage['schnTrackerProgress']` was
genuinely empty (schn-case-tracker.user.js hadn't tracked anything that day), so "Tracker: —"
was the badge working as designed on empty data. User asked to remove the feature entirely
rather than debug the underlying tracker connection - removed the whole module, left a tiny
one-time cleanup stub that deletes the badge/style elements for anyone with a stale page open.

**(3) new feature, "Feature 5: Quick-copy emails mentioned in ticket messages"**: for each
Freshdesk conversation message (`.ticket_note`), scans its text for email addresses and, for any
NOT already the ticket's known email (read from the Unified Toolbar's email button,
`#better-freshdesk-action-email`'s `dataset.email`) and not an obvious internal/system address,
inserts a one-click-copy chip row right after that message. Deliberately does NOT try to
distinguish "customer message" from "agent reply" - investigated live (Freshdesk gives replies
from both a `.ticket_note` with no reliable inbound/outbound/customer/agent class; the only clean
signal found was `.ticket-details__privatenote` for private notes, which are agent-only by
definition but that alone isn't enough to positively identify customer messages). Instead relies
on excluding the already-known email + noreply/support/internal patterns, which self-filters
agent replies quoting the known email in the common case. Verified live against the real ticket
with Keith's alternate email - correctly surfaced it plus 3 other mentioned emails, correctly
excluded the ticket's currently-known email.

Also found (while looking at the Requester Email module for the above) that "Feature 5:
Requester Email in Ticket Header" was ANOTHER disabled dead module (early `return`, comment says
"Superseded by the cached email control in the unified action bar") that neither the original
architecture analysis nor last night's sweeps had caught - **this means the "Requester Email"
observer I deliberately left un-migrated last night (reasoning it needed `characterData:true`)
was reasoning about unreachable code the whole time; harmless in outcome (leaving dead code alone
is always safe) but worth knowing the justification was moot.** Deleted it.

## Centralized 3 GM-storage keys that were duplicated string literals

`betterFreshdeskPendingSnapshot` (producer in the CMS snapshot module, consumer in the Freshdesk
snapshot-queue module) and `__betterFreshdeskCannedResponseProtectionUntil` +
`data-better-freshdesk-canned-response-lock` (both declared identically in two different reply-
cleanup-related spots) were each re-declared as a fresh local string literal in 2 places instead
of sharing one source. Added `BV_SNAPSHOT_KEY`, `BV_CANNED_RESPONSE_GLOBAL_KEY`,
`BV_CANNED_RESPONSE_LOCK_ATTR` to the module-scope prelude (same place as `isCMSHost`/`waitFor`)
and pointed all 6 local declarations at them - kept each module's own local const NAME unchanged
so no call sites needed touching, only what they're initialized from. Verified with grep that
zero bare occurrences of the raw strings remain outside the 3 new prelude declarations.

## Two more cleanups, one deliberate non-change (retryCapture)

Found via a second grep sweep (`.forEach` wrapping `setTimeout`, and remaining `setInterval`
calls) after the previous round:
- Header Cleanup module's `init()` had a 3rd hidden fixed cascade (`[500,1500,3500].forEach(...)`)
  - didn't just convert to `waitFor` (no clean boolean signal - `removeHeaderClutter` doesn't
  return anything meaningful and clutter can reappear at any time, not just once), instead
  subscribed it to `onRouteChange` directly, which is strictly better: reacts to actual DOM
  changes instead of guessing at 3 fixed checkpoints.
- CMS payment-handler badge's `waitForPaymentHandler` was another hand-rolled `waitFor` clone
  (setInterval-based this time, 300ms poll) - replaced with a one-line wrapper.

**Deliberately did NOT touch** `retryCapture()` (Refund Capture module, 1s/2.5s/5s/9s fixed
cascade calling `runCapture`) despite it looking like the same pattern - there's an explicit
comment right above its call site: "Startup, route, focus and periodic passes cover
asynchronous rendering without reacting to every DOM mutation on Freshdesk and the CMS." That's
a deliberate prior design decision to NOT make this one reactive to DOM mutations, and I have no
evidence it's wrong - respecting a documented intentional choice over "this looks like the same
pattern as the others." Also left the Refund Capture Tool's periodic 8s reconciliation pass
(`setInterval` at what's now ~line 2040) alone - it does more than plain route-change reaction
(a full create/capture/remove state reconciliation with an else-branch), so folding it into
`onRouteChange` risked losing that behavior for an unclear benefit given the shared engine's own
5s fallback already covers the pure route-change portion.

## Stage 2 follow-up: 4 more observers Codex's pass missed, one more timeout cascade

Codex's Stage 2 migration scoped itself to observers explicitly about *navigation* detection and
missed several MORE raw `document.body`-subtree `MutationObserver`s that exist for a different
reason (reacting to new content appearing) but use the EXACT SAME trigger condition the shared
engine already watches. Found by grepping `new MutationObserver` post-Stage-2 and checking what
was left. Migrated 4 more to `onRouteChange`, keeping each one's own local debounce unchanged:
Refund Capture's `observeDynamicChanges` (1200ms), Cancellation Reason autofill's observer (no
debounce, unchanged), Save & End Session's observer (50ms), and the Classic CMS Account
Switcher's observer (no debounce, unchanged). Also found and fixed one more fixed-timeout
cascade Stage 1 missed (it used a `[0,100,250,500,900,1500].forEach(setTimeout(...))` array
form instead of individual `setTimeout` lines, so the original grep-based sweep didn't catch
it): Save & End Session's `scheduleFill()`, replaced with `waitFor(fillEndSessionForm, ...)`.

**Deliberately left alone** (checked, not missed): Refund Percentage Workflow's observer (drives
an active multi-step refund automation with `workflowActive` state - real financial action,
didn't want to touch it without a concrete problem), Reply Cleanup's observer (the single
highest-frequency feature in daily use, same reasoning), and Requester Email's observer (needs
`characterData:true`, which the shared engine doesn't watch - already correctly left by Codex).
Final state: 1 canonical observer inside the shared engine itself + these 3 deliberate holdouts,
down from ~14 raw MutationObservers found across the whole file before any of this work started.

## Helper duplication: consolidated waitFor clones, deliberately left isVisible/cleanText/realClick alone

The Set Agent module (Feature 9, IIFE A) had three hand-rolled clones of the exact same
"poll every 60ms until predicate true or timeout" pattern (`waitForAgentOptions`,
`waitForSelectedAgent`, `waitForAgentUpdateButton`) - structurally identical to each other and
to the shared `waitFor()` added in Stage 1. Replaced all three with thin wrappers around
`waitFor()`, checked every caller's usage first to make sure the return contract matched exactly
(`waitForAgentOptions` must resolve an array even on timeout, not null, because callers do
`.length` on it without a null-check - handled with `.then(() => lastOptions)`; `waitForSelectedAgent`
must resolve a boolean - handled with `.then(Boolean)`; `waitForAgentUpdateButton` already matched
`waitFor`'s native element-or-null contract, no wrapper needed).

**Did NOT** consolidate the ~20 duplicated `isVisible`/`cleanText`/`realClick` definitions the
original architecture analysis flagged, despite them looking like the same kind of easy win.
Checked several side by side first - they're NOT identical: e.g. the one in the header-cleanup
module requires `rect.width > 100 && rect.height > 30` (a deliberate minimum-size filter, not
just "is it visible at all"), and some check `element.nodeType !== 1` or `style.opacity !== '0'`
while others don't. Blindly replacing these with one shared version would silently change
filtering behavior in at least one module. Not worth the risk for a pure cosmetic/duplication
cleanup with zero user-facing benefit - left as-is. If someone wants to tackle this later, audit
each call site's actual behavior first, don't assume same-name means same-behavior.

## Cross-tab snapshot race fixed (2026-08-10)

`betterFreshdeskPendingSnapshot` (GM storage) was a single value: two snapshot requests within
the consumer's ~900ms poll window silently clobbered each other, and there was no way to queue
a snapshot for ticket A while ticket B's tab wasn't open yet. Changed the producer to push onto
an array (capped at the last 5) instead of overwriting, and the consumer now peeks for an entry
matching the CURRENT ticket specifically (`getPendingSnapshotForTicket`) and only removes that
one entry (`removeSnapshotFromQueue`, matched by `createdAt`+`ticketUrl`) on confirmed paste
success - other tickets' queued snapshots are left untouched for their own tab. Preserved the
original retry semantics exactly: a failed paste leaves the snapshot in the queue rather than
requeuing it, so the existing polling interval just retries the same entry next tick. Verified
with a standalone simulation of the queue logic (fake GM_* backed by a plain object) confirming
two different-ticket pushes both survive and consuming one doesn't touch the other.

## Stage 2 landed: unified route-change engine (2026-08-10)

Consolidated the 8-10 duplicate "SPA change detector" instances (each with its own
MutationObserver + backup setInterval + sometimes its own history.pushState/replaceState
patch) into one shared engine, declared in module scope before the first IIFE alongside
`isCMSHost`/`waitFor`: `startRouteChangeEngine()` (single history patch, single popstate/
hashchange listener, single 100ms-debounced MutationObserver on document.body, single 5s
fallback interval) + `onRouteChange(callback)` (subscribe, get an immediate async first call,
returns an unsubscribe function).

Migrated: Refund Capture, Refunder Preference, Set Agent, CMS Snapshot toolbar (2 separate
subscriptions - route watcher + payment-handler-badge observer), Unified Toolbar, Daily Goal
Badge, CMS user-search header button + CMS flow observer (needed a `{disconnect: fn}` shim
since calling code elsewhere does `cmsFlowObserver.disconnect()`), and Status Placement.
Each kept its own local debounce timing (80-500ms) wrapping the shared callback, so per-module
responsiveness is unchanged - only the underlying "how do I know something changed" mechanism
was consolidated.

**Deliberately NOT migrated**, and this is correct, not an oversight: the Requester Email badge
module observes with `characterData: true` (the shared engine only watches `childList`), so
folding it in would silently lose text-node-content-change detection. Keep-alive timers, form
autofill polling, and snapshot-consumption polling aren't route-change detection at all and were
correctly left alone.

Verified: full diff read line-by-line (each migrated site checked against what its old
observer/interval/pushState-patch actually did before removing it), plus a live integration
test injecting the actual shared-engine code into a real Freshdesk tab and confirming pushState,
a DOM mutation, and the initial callback all correctly fire a subscriber.

## Overnight session 2026-08-10: toolbar hardening + daily-goal badge

User asked to work unattended overnight through a punch list, with no more check-ins possible
(no Tampermonkey click access to confirm live updates). Two findings from that session:

**Unified toolbar (brand/email badge) "bug" reported earlier turned out inconclusive live.**
Manually re-implementing `getActionBar`/`installToolbar`'s exact logic via direct DOM injection
(bypassing Tampermonkey entirely, using the browser tool's `javascript_tool`) on a real ticket
worked fine and the injected node survived 5+ seconds untouched — no evidence Ember actually
rips out the toolbar on an idle page. Most likely explanation for the earlier failure: Tampermonkey
was running a stale/different version, not a code bug. Hardened it anyway as cheap insurance:
`getActionBar()` now has two more fallback selectors ending in a bare `section#mainactionbar`,
and `scheduleInstall()` now re-verifies `toolbar.parentElement === getActionBar()` (catches Ember
replacing the action bar subtree wholesale, not just the toolbar node going missing) with an
80ms debounce (was 250ms) and a 4s backstop interval (was 8s). Verified the self-heal loop live
by injecting the real logic and manually deleting the test node — it recreated within the
debounce window.

**Reactivated the SCHN+ daily-goal badge** ("Feature 8b", right after Feature 8 in
better-viewlift.user.js) that Stage 1 deleted as dead code. Key insight: it doesn't need the
tracker's API key or to talk to `135.181.37.72:3001` at all — `schn-case-tracker.user.js`
already writes today's count to `localStorage['schnTrackerProgress']`, and `localStorage` (unlike
`GM_getValue`/`GM_setValue`, which is per-script-isolated) is shared per-origin across all
userscripts running on that page. So this badge is purely read-only against a cache another
script already maintains — no new configuration needed from the user. Verified live by seeding
a fake cache value via `javascript_tool` and confirming the render logic picks it up (then
cleaned the fake value back out immediately — don't leave test data in real `localStorage`
caches, there's no way to know what real value, if any, you clobbered).

## CMS session keep-alive (2026-08-10)

The old keep-alive (better-viewlift.user.js, "Feature 1b: CMS Session Keep-Alive", ~line 2126)
only *detects* an expired session (HEAD request every 8 min, logs a console warning) — it never
prevented expiry. Root cause of "still get OTP-prompted": user confirmed the logout is
inactivity-triggered (backgrounding the CMS tab to work in Freshdesk, not a fixed absolute
timer). Chrome freezes/throttles JS timers in backgrounded tabs (Page Lifecycle API — a tab can
be frozen after ~5 min in the background even without full "discard"), which stops the in-page
`setInterval` from firing until the tab is foregrounded again.

**User explicitly rejected the ViewLift Helper extension as part of the fix ("no quiero nada
con la extensión, de momento todo con Tampermonkey") — a first attempt that moved the ping into
the extension's background service worker was reverted.** Reason this matters technically: a
page-scoped script fundamentally cannot run while its own tab is frozen — no code running only
in the CMS tab can defeat this, extension or not. The approach actually shipped instead pings
the CMS hosts from the **Freshdesk tab** via `GM_xmlhttpRequest` (needs `@connect` for the 4 CMS
hosts) — since Freshdesk is the tab the user is actively driving, it doesn't get frozen, so it
can carry the keep-alive load for CMS even while the CMS tab itself is backgrounded. Whether
`GM_xmlhttpRequest` actually carries the CMS session cookie cross-origin depends on that
cookie's `SameSite` attribute — unverified, needs real-world confirmation. The existing
same-origin CMS-side interval was kept as a fallback for whenever CMS itself is the active tab.
Independent of any code: excluding the CMS hosts from Chrome's tab discarding
(`chrome://settings/performance` → "Always keep these sites active") is the one fix that isn't
limited by page-JS constraints at all, since it stops the freeze/discard from happening in the
first place.

## Deep architecture findings (2026-08-09 analysis)

`better-viewlift.user.js` is a **mechanical merge of two formerly-separate scripts, never
reorganized**: guard (24-29) → IIFE A lines 31-5640 (the old "Better CMS") → IIFE B lines
5642-9411 (the old "Better Freshdesk"), pasted back to back. Proof: each IIFE restarts its own
"Feature 1, 2, 3..." numbering from scratch, out of order. Because the two IIFEs are separate
scopes, helpers like `isVisible`/`cleanText`/`realClick` are reimplemented independently on each
side instead of shared.

**Consequence:** each side brought its own "SPA change detector" (MutationObserver + backup
setInterval + its own pushState/replaceState/popstate patch), so **8-10 near-identical
detector instances run in parallel** on every CMS/Freshdesk page load. The two full
history.pushState-patching blocks (~1911-1934 and ~5502-5525) are almost byte-identical copies.

**Dead code (~450 lines, safe to delete, already identified, not yet removed):**
- Lines 4729-4762: "Feature 3 Legacy" — injects a huge inline `<script>` string, but its own
  guard (`window.__betterCmsV5PercentageRefundInstalled`, line 4744) is always already `true`
  because the maintained module right above (4347-4351) sets it unconditionally first. Never
  executes.
- Lines 6479-6601: "Ticket Tracker integration" — starts with a literal `return;` on line 6483
  (comment says "removed from Better Freshdesk") but the ~120 lines of dead logic below it are
  **the existing scaffold for talking to the case-tracker bot at `135.181.37.72:3001`** (line
  6488) — this is the natural starting point if/when that integration gets reactivated inside
  better-viewlift.user.js itself instead of the separate schn-case-tracker.user.js.

**Fixed-timeout cascades (the direct "make it feel faster" lever):** ~6 near-identical spots
fire a fixed sequence of `setTimeout`s (e.g. lines 2719-2723: `300,700,1200,2000,3000`ms; lines
5531-5535, 8016-8020, 8220-8222, 9156-9159) instead of resolving as soon as the target element
appears. Every one of these is guaranteed wasted latency on the common case where the element
was ready well before the last timeout fires.

**CMS host/UI detection is copy-pasted, not centralized:** the same hostname regex
(`/^(?:cms(?:-gcp|-qcp)?\.viewlift\.com|cms\.monumentalsportsnetwork\.com)$/i`) is redeclared
in 8+ places instead of one shared `isCMSHost()`; there's no shared `isV5UI()` either — each
feature re-detects v5 by sniffing MUI classes (`.MuiSelect-select`, etc.) on its own.

**Fragile selectors worth hardening reactively** (matches past commits like `2df8afc Fix v5
account option detection`): line 388 (`p.break-all` Tailwind utility class), line 943-944
(Ember Power Select classes), the MUI class selectors in the refund-percentage module
(4340-4728), and the 4-selector fallback cascade at 6544-6548 (a sign it already broke once).

**Cross-tab snapshot race** (lines 4784/6614, consumer polls every 900ms at line 6742): two
snapshot requests within 900ms of each other can silently clobber each other since it's one
`GM_setValue` key with no queue.

**There's a THIRD script, not in this repo, discovered live on 2026-08-09:** a `#schn-reply-with-bot`
button ("🤖 Reply with Bot") is injected into the Freshdesk ticket header — same `schn-` naming
convention as `schn-case-tracker.user.js`, but its own separate userscript. This confirms the
bot at `135.181.37.72:3001` ("ViewLift Support Assistant", a FastAPI + React app, login-gated,
`POST /api/ticket-tracker/` with `Authorization: Bearer <api_key>`) does more than tracking —
it can also generate/suggest replies. That script's source wasn't in `scripts/`, so its exact
behavior is unconfirmed; worth asking the user directly before assuming what it does.

**Priority order suggested by this analysis (highest impact/effort ratio first):**
1. Delete the ~450 lines of confirmed dead code — zero risk.
2. Unify the 8-10 duplicate SPA-detector instances into one shared route-change engine — biggest
   perceived-speed and CPU win, but touches most modules, needs the double-IIFE flattened first.
3. Replace the fixed-timeout cascades with the unified engine's "wait for element" — direct
   latency win per ticket.
4. Extract shared helpers (`waitFor`, `isVisible`, `cleanText`, `isCMSHost`) once flattened.
5. Harden fragile selectors — reactively, unless getting ahead of it is wanted.

## 2026-08-10 — Session catch-up + ViewLift Support Bot integration

**Catch-up note:** this file's last entry above was the original one-shot deep analysis; every
fix from the optimization pass that followed shipped as commits but was never written up here.
For the record, since `d337cfb` (dropped the legacy `better-cms.user.js`/`better-freshdesk.user.js`
scripts): the double-IIFE SPA-detectors were unified into one shared route bus (`e2bd953`), three
GM-storage keys were centralized (`2b7a55a`), the toolbar's load-then-jump race was fixed with a
4s grace period before falling back to the bare action-bar container (`6b08026`), the Freshdesk
daily-goal tracker was removed per request (`da6f278`), a shared `bvNotify` toast system replaced
silent `console.warn`s (`5a8f5f5`) and one bug it caused (false "email not found" on the tickets
list page) was fixed same-day (`1e31242`), the CMS keep-alive (both same-tab and cross-tab) was
repointed from a CloudFront-static SPA-shell URL to the real `/api/auth/verify` endpoint after the
user reported the CMS still logging out (`fa76321`), and a CMS session status dot plus manual
"check now" button were added so that fix is self-verifiable without waiting hours (`2702004`,
`71c630f`). The CMS header button was also fixed to only render inside a ticket
(`installHeaderButton`'s ticket-path guard, mirroring Set Agent's existing pattern) after the
user reported it appearing elsewhere.

### Bot integration: CMS-lookup pre-check + basic "Generate Reply"

Two features requested together ("Las dos, aunque 'generate' quede básico"), both built on top
of the internal ViewLift Support Assistant bot at `http://135.181.37.72:3001` (a separate FastAPI
+ React app with its own login, unrelated to Freshdesk/CMS auth). `@version` bumped to 3.26.0.

**Investigation (live browser, `135.181.37.72:3001`):**
- `GET /api/cms/lookup?email=<email>&site=<site>` returns `{"found": bool, "email": string}`,
  confirmed live: `site=schn` for a SCHN-tagged ticket returned `found:false` with a real
  `Authorization: Bearer <token>` header built from that origin's own `localStorage['token']`
  (a JWT obtained by logging into the bot directly - never read, logged, or stored by this
  script; only entered by the user themselves).
- `POST /api/generate` (the "Analyze and Generate" button's real endpoint, found by patching
  `XMLHttpRequest.prototype.send` in-page since the app uses axios, not `fetch`) - request body:
  `message` (string), `platform_id` (number), `images` (null), `agent_notes` (null),
  `cms_account` (null), `cms_not_found` (bool), `cms_no_subscription` (bool). Response body keys:
  `parsed, response, next_steps, bot_notes, needs_verification, faq_sources, canned_sources,
  cache_hit, history_id, learned_count, is_spam`. `response` is the plain-text generated reply.
  `platform_id: 1` was confirmed live for a SCHN ticket (the bot's active platform at the time).
  The bot's platform switcher dropdown lists 9 platforms in this order: SCHN+, LIV Golf, Altitude
  Sports, Monumental Sports, TBL, FOX One, Knight Time, MOTV, DIRTVision - repeated attempts to
  click through each and re-capture `platform_id` for the other 8 were blocked by the dropdown
  closing before the next click landed (component re-render timing), then by a bundle-source
  workaround tripping this environment's own cookie/JWT-shaped-string content filter. **Only
  `platform_id: 1` (SCHN) is independently confirmed.** The mapping used in code for the other 5
  brands this script cares about (LIV=2, ALTITUDE=3, MSN=4, FOX=6, DIRT=9) assumes the dropdown's
  display order matches ascending DB ids - a reasonable but unverified guess. This is safe by
  design: the generated draft is always reviewed and copied by hand, never auto-inserted or
  auto-sent, so a wrong `platform_id` can only make the draft's wording worse, not send anything
  wrong.
- The bot's "⚡ Full Automated" mode is not a per-ticket generation mode - it's a shared
  round-robin queue across all admins that auto-assigns whatever ticket is next in the shared
  pool. Confirmed by inspecting its own on-screen description; ruled out as a way to test
  additional platform_ids.

**Code (`better-viewlift.user.js`):**
- Header: added `@grant GM_registerMenuCommand` and `@connect 135.181.37.72`.
- Prelude (shared, before the first Feature IIFE): `BV_BOT_BASE_URL`, `BV_BOT_TOKEN_KEY`,
  `BV_BOT_BRAND_MAP` (brand label -> `{site, platformId}`), `getBotToken()`,
  `promptForBotToken()` (registered via `GM_registerMenuCommand('ViewLift Bot: Set API Token', ...)`,
  mirroring `schn-case-tracker.user.js`'s existing "Set API Key" pattern - a native `prompt()`
  the user types their own token into directly; blank + OK clears it), and `botApiRequest()` (a
  thin `GM_xmlhttpRequest` wrapper adding the `Authorization: Bearer` header, JSON-encoding the
  body when present, and normalizing 401/403 to an `unauthorized` error). Everything no-ops
  silently if no token is saved - neither feature does anything until the user runs the menu
  command once.
- Feature 3 (CMS user search, `installHeaderButton`'s click handler): after the existing
  `window.open(...)` (unchanged, still fires synchronously so the popup blocker doesn't catch
  it), added a fire-and-forget `checkCmsAccountViaBot(email, clientContext)`. It maps the ticket's
  client context to a bot `site` slug via a new local `BOT_SITE_RULES`/`getBotSiteSlugForClient`
  (6 brands: schn/liv/dirt/altitude/msn/fox), then calls `/api/cms/lookup` for the primary email
  and, if not found, walks every other email mentioned anywhere in the ticket (via the
  already-existing `collectTextFromRoot`, filtered through the existing
  `isBlockedCmsSearchEmail` denylist) until one is found or the list is exhausted. If a
  different email than the one just searched turns out to have the account, it shows a
  `bvNotify` telling the agent to try that email instead - directly actionable for the
  originally-reported "CMS search returns No Data Available for a real customer" bug, instead of
  just diagnosing it. If truly no candidate has an account, it says so once. Any bot/network
  error is swallowed silently - this check can never make the CMS-search flow worse, only
  supplement it.
- Feature 8 (unified toolbar): added a 5th toolbar button (🤖, `GENERATE_TOGGLE_ID`) and an inline
  panel (`GENERATE_PANEL_ID`, styled like the refund panel but built fresh in
  `mountGeneratePanel` since there's no pre-existing DOM to reuse). Clicking it opens the panel
  and immediately calls `runGenerate()`: resolves `platform_id` from `detectBrand()` +
  `BV_BOT_BRAND_MAP`, builds `message` from every `.ticket_note` element's text (same selector
  Feature 5's email/phone quick-copy chips already scan) joined with the ticket's `document.title`
  as a subject line and capped to the last 12,000 characters, then `POST /api/generate` with
  `cms_account: null` and both `cms_*` flags `false` (the "básico" simplification - this script
  doesn't yet feed real CMS-account state into the request the way the bot's own UI does when an
  agent has looked one up first). The response's `.response` text lands in a readonly textarea
  with Copy and Regenerate buttons only - no agent-notes field, no screenshot attach, no
  FAQ-sources display, no queue system, and critically no "insert into reply"/auto-send: the
  agent always copies and pastes by hand. `copyGeneratedText()` is a small local clipboard helper,
  written separately from Feature 8's existing `copyText()` on purpose - `copyText` hardcodes
  the tooltip it reverts to after the copied-flash to email-specific text, which would have been
  wrong on a reused Copy button.
- Verified end-to-end against the live bot (both endpoints hit for real from the browser, response
  shapes matched what the code expects) before writing this entry; did not verify inside
  Tampermonkey's own sandbox since triggering the real `GM_registerMenuCommand` prompt from
  browser automation would block the extension (blocks on any native `prompt()`/`confirm()`), so
  that specific path is `node --check`-verified plus reviewed only, not click-tested live.

**Open threads:**
- `platform_id` for LIV/ALTITUDE/MSN/FOX/DIRT is unconfirmed (see above) - worth a 5-minute
  manual check next time someone is in the bot's UI on one of those brands: switch platform,
  paste something short, hit Analyze and Generate, and read `platform_id` off the request.
- The bot's own UI passes a real `cms_account`/`cms_not_found`/`cms_no_subscription` when the
  agent has already looked the account up in its flow; this integration always sends
  `cms_not_found: false`. Wiring `checkCmsAccountViaBot`'s result into `runGenerate()`'s request
  body would make the draft's "no account found" framing accurate instead of always assuming an
  account exists - straightforward follow-up once the two features have been used a bit.
