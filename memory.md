# Better Viewlift — Project Memory

Context file for AI assistants (GPT/Codex, Claude, etc.) picking up work on this repo.

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
