# Smart Tab Manager

Firefox extension that uses Gemini to analyze your open tabs, propose tab actions, and execute them after you review the plan.

## What It Does

- Collects the tabs from your current Firefox window and sends them to Gemini as context.
- Lets you ask for tab cleanup or organization in natural language.
- Shows a proposed action plan before anything changes.
- Executes supported tab actions.

## Supported Actions

Gemini can currently propose these actions:

- Close tabs
- Focus a tab
- Pin tabs
- Unpin tabs
- Group tabs
- Ungroup tabs
- Move tabs
- Open a new tab

## Requirements

- Firefox with WebExtensions support
- A Gemini API key

## Setup

1. Open Firefox and go to `about:debugging`.
2. Choose `This Firefox`.
3. Click `Load Temporary Add-on`.
4. Select `manifest.json`.
5. Open the extension popup.
6. Enter your Gemini API key in Settings and click `Save`.

## Usage

1. Open the popup.
2. Enter a query such as `group my work tabs and close duplicate docs tabs`.
3. Click `Plan Actions`.
4. Review the proposed actions.
5. Click `Execute` if the plan looks correct.

If a plan has already been generated, the popup restores it the next time you open the extension. Click `New Query` to discard it and return to the query box.
