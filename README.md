# ViewLift Userscripts

Tampermonkey scripts for ViewLift CMS and Freshdesk workflows.

## Scripts

### Better Freshdesk

Combines Freshdesk improvements into one script.

Features:

- Auto-bolds standard support text like `Technical Support Team` and `Regards,`
- Cleans duplicated greetings, repeated paragraphs, excessive spacing, and quoted reply markers after clicking `Apply`
- Adds a `CMS` button in the Freshdesk ticket header
- Opens ViewLift CMS and automatically searches the customer email

Install:

https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js

---

### Better CMS

Combines CMS tools into one script.

Features:

- Adds the refund capture panel
- Captures customer email, Freshdesk ticket URL, CMS user URL, payment handler, and refund amount
- Saves the selected refunder permanently, so you do not need to select `Sebastian`, `Eric`, or `Esteban` every time
- Auto-fills the cancellation reason after clicking `Cancel`
- Starts the percentage refund workflow after clicking the action icon
- Selects 100% refund
- Selects the `ROTH` refund reason
- Adds the Freshdesk ticket URL to additional comments when available
- Adds the camera snapshot button next to the customer name
- Shows the payment handler badge next to the camera button
- Hides the camera button, payment badge, and refund panel from screenshots
- Works across internal CMS navigation without needing to refresh

Install:

https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-cms.user.js

---

## Installation

1. Install the Tampermonkey browser extension.
2. Click one of the install links above.
3. Tampermonkey should open the install screen.
4. Click `Install`.

If Tampermonkey does not open automatically, copy the raw URL and paste it into your browser address bar.

---

## Recommended Setup

Use only these active scripts:

```text
Better Freshdesk
Better CMS
