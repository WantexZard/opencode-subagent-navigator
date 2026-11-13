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
- Discovers subagent names from the session data and OpenCode agent list; you do not need to hard-code your own agent names.
- Uses OpenCode's rendered/configured colors when available. Custom agents without a resolvable color get a consistent fallback color; labels are derived from the agent name.
- Uses the page's same-origin links for navigation, allowing OpenCode's client router to handle clicks when available.
- Does not modify the OpenCode server or configuration, call a model, or send data to an external service.

## Compatibility and limitations

- Verified by the maintainer in their own OpenCode setup and working as expected there. It was also tested with OpenCode **1.19.5** in Chromium using a simulated API/page.
- Other OpenCode versions and browsers are not confirmed. The script relies on OpenCode's page structure and API; upstream changes may require updates.
- SPA navigation depends on the site's router intercepting same-origin links. Ordinary browser navigation remains the fallback.
- Activity status refreshes about every five seconds while the page is visible.

## Privacy

The script reads the current page and same-origin OpenCode API responses in your browser. It does not transmit data to external services.

## 中文说明

这是一个 Tampermonkey 用户脚本：为 `task_revive` / `task_message` 卡片添加子会话入口，并提供可查看运行状态的悬浮子 Agent 列表。适用于 OpenCode 网页版，可用于自托管地址。安装方式同上，点击脚本安装链接并确认即可。

脚本会从会话数据和 OpenCode Agent 列表动态发现子 Agent 名称，不需要手动把自己的 Agent 名字写进脚本。能读取 OpenCode 页面或配置中的颜色时会优先采用；自定义 Agent 颜色无法解析时使用稳定的回退色，标签名称由 Agent 名称生成。

作者本人已在自己的 OpenCode 环境中实际使用验证，运行正常、符合预期；也曾在 Chromium 中基于 OpenCode 1.19.5 和模拟页面/API 进行测试。尚未确认其他版本或浏览器兼容性。脚本只读取当前页面及同源 OpenCode API，不向外部服务发送数据。本项目为非官方社区工具，与 OpenCode 团队无隶属关系。

## License

MIT. See [LICENSE](LICENSE).

## Changelog

### 1.5.3

- Fix panel expansion after manual resizing while keeping its bottom edge anchored.
- Refine panel resizing and scrolling behavior.
- Group activity-status checks by session directory/workspace.
