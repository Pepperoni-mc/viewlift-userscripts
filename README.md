# ViewLift Userscripts

A small Tampermonkey toolkit for ViewLift CMS and Freshdesk workflows.

## Install

| Script | Purpose | Install |
|---|---|---|
| **Better&nbsp;Freshdesk** | Freshdesk reply cleanup, auto-bold text, and CMS email search | [Install](https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-freshdesk.user.js) |
| **Better&nbsp;CMS** | Refund capture, refund automation, cancellation reason autofill, screenshots, and payment badges | [Install](https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-cms.user.js) |

## What They Do

### Better Freshdesk

- Adds a `CMS` button to Freshdesk tickets
- Opens CMS and searches the customer email automatically
- Cleans replies after clicking `Apply`
- Removes duplicated greetings, repeated paragraphs, extra spacing, and quoted markers
- Auto-bolds standard support text like `Technical Support Team` and `Regards,`

### Better CMS

- Adds the refund capture panel
- Captures email, Freshdesk URL, CMS URL, payment handler, and refund amount
- Saves the selected refunder permanently
- Auto-fills cancellation reason
- Prepares 100% refund workflow with `ROTH` reason
- Adds Freshdesk ticket URL to refund comments when available
- Adds camera snapshot button and payment handler badge
- Hides helper UI from screenshots
- Works across internal CMS navigation without refreshing

## Recommended Setup

Keep only these scripts enabled in Tampermonkey:

```text
Better Freshdesk
Better CMS
