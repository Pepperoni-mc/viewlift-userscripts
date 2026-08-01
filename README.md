# Better Viewlift

A unified Tampermonkey toolkit for ViewLift CMS and Freshdesk workflows.

## Install

| Script | Purpose | Install |
|---|---|---|
| **Better&nbsp;Viewlift** | All Freshdesk and CMS productivity tools in one userscript | [Install](https://raw.githubusercontent.com/Pepperoni-mc/viewlift-userscripts/main/scripts/better-viewlift.user.js) |

## What It Does

### Freshdesk

- Adds a `CMS` button to Freshdesk tickets
- Opens CMS and searches the customer email automatically
- Cleans replies after clicking `Apply`
- Removes duplicated greetings, repeated paragraphs, extra spacing, and quoted markers
- Auto-bolds standard support text like `Technical Support Team` and `Regards,`

### CMS

- Adds the refund capture panel
- Captures email, Freshdesk URL, CMS URL, payment handler, and refund amount
- Saves the selected refunder permanently
- Auto-fills cancellation reason
- Adds the camera snapshot button next to the customer name
- Shows the payment handler badge next to the camera button
- Hides helper UI from screenshots
- Works across internal CMS navigation without refreshing

## Migrating from the old scripts

Previous Better CMS installations update to Better Viewlift automatically. After
updating, uninstall the `Better Freshdesk (Merged - Remove)` legacy entry from
Tampermonkey. New installations should use the Better Viewlift link above.

