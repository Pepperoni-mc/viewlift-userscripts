# Better Viewlift — Project Memory

Context file for AI assistants (GPT/Codex, Claude, etc.) picking up work on this repo.

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
