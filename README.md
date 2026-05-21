# ViewLift Userscripts

Tampermonkey scripts for ViewLift CMS and Freshdesk workflows.

## Scripts

### Better Freshdesk

Combines Freshdesk improvements into one script:

- Auto-bolds standard support text like `Technical Support Team` and `Regards,`
- Cleans duplicated greetings, repeated paragraphs, excessive spacing, and quoted reply markers after clicking `Apply`
- Adds a `CMS` button in the Freshdesk ticket header
- Opens ViewLift CMS and automatically searches the customer email

Install:

https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js

---

### ViewLift Snapshot Tool

Adds a camera button next to the customer name in ViewLift CMS.

Features:

- Takes a real browser tab snapshot
- Copies the screenshot to clipboard
- Shows the payment handler badge next to the camera button
- Hides the camera button, payment badge, and refund capture panel from the screenshot
- Works across internal CMS navigation without needing to refresh

Install:

https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/viewlift-snapshot.user.js

---

### Refund Capture Tool

Adds a floating refund capture panel for Freshdesk and ViewLift CMS.

Features:

- Captures customer email
- Captures Freshdesk ticket URL
- Captures CMS user URL
- Captures payment handler
- Captures amount/refund-related values
- Copies a formatted spreadsheet row
- Syncs data across Freshdesk and CMS tabs
- Works across internal CMS navigation without needing to refresh

Install:

https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/refund-capture-tool.user.js

---

## Installation

1. Install the Tampermonkey browser extension.
2. Click one of the install links above.
3. Tampermonkey should open the install screen.
4. Click `Install`.

If Tampermonkey does not open automatically, copy the raw URL and paste it into your browser address bar.

---

## Updating

Tampermonkey updates these scripts from GitHub using the `@updateURL` and `@downloadURL` metadata fields.

When editing a script:

1. Open the `.user.js` file in GitHub.
2. Click the pencil/edit button.
3. Make your changes.
4. Increase the `@version` number.
5. Commit the change to `main`.

Example:

```javascript
// @version      1.0
