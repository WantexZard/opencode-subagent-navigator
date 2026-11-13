# OpenCode Subagent Navigator

[English](README.md) | [简体中文](README.zh-CN.md)

A small Tampermonkey userscript that adds direct links to OpenCode subagent sessions and a floating panel for browsing them.

> Unofficial community project. It is not affiliated with, endorsed by, or sponsored by the OpenCode team.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the [install script](https://raw.githubusercontent.com/WantexZard/opencode-subagent-navigator/main/opencode-subagent-navigator.user.js) and confirm installation.
3. Open or refresh your OpenCode web app.

The script checks for an OpenCode-like page before activating. It supports self-hosted OpenCode instances on custom hosts; its broad userscript match is needed for those hosts. If you prefer, restrict the `@match` line in the script to your own address pattern.

## What it does

- Adds an “Open subagent session” link to `task_revive` and `task_message` cards.
- Shows a floating list of subagent sessions, prioritizing running or retrying sessions.
- Uses the page's same-origin links for navigation, allowing OpenCode's client router to handle clicks when available.
- Does not modify the OpenCode server or configuration, call a model, or send data to an external service.

## Compatibility and limitations

- Verified by the maintainer in their own OpenCode setup and working as expected there. It was also tested with OpenCode **1.19.5** in Chromium using a simulated API/page.
- Other OpenCode versions and browsers are not confirmed. The script relies on OpenCode's page structure and API; upstream changes may require updates.
- SPA navigation depends on the site's router intercepting same-origin links. Ordinary browser navigation remains the fallback.
- Activity status refreshes about every five seconds while the page is visible.

## Privacy

The script reads the current page and same-origin OpenCode API responses in your browser. It does not transmit data to external services.

## License

MIT. See [LICENSE](LICENSE).

## Changelog

### 1.5.3

- Fix panel expansion after manual resizing while keeping its bottom edge anchored.
- Refine panel resizing and scrolling behavior.
- Group activity-status checks by session directory/workspace.
