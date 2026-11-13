# OpenCode Subagent Navigator

[English](README.md) | [简体中文](README.zh-CN.md)

一个 Tampermonkey 用户脚本，为 OpenCode 网页版添加子会话入口和悬浮子 Agent 列表。

> 非官方社区项目，与 OpenCode 团队无隶属关系，也未获其背书或赞助。

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开[用户脚本安装链接](https://raw.githubusercontent.com/WantexZard/opencode-subagent-navigator/main/opencode-subagent-navigator.user.js)，确认安装。
3. 打开或刷新 OpenCode 网页。

脚本会先检查页面是否像 OpenCode，再启动功能。为支持自托管的 OpenCode 地址，脚本匹配范围较宽；如有需要，可编辑脚本中的 `@match`，限制为自己的地址。

## 功能

- 为 `task_revive` 和 `task_message` 卡片添加打开子会话的链接。
- 显示悬浮子 Agent 列表，优先列出运行中或重试中的会话。
- 使用同源链接导航；页面路由可用时交由 OpenCode 前端接管。
- 不修改 OpenCode 服务端或配置，不调用模型，也不会向外部服务发送数据。

## 验证与兼容性

- **作者本人已在自己的 OpenCode 环境中实际使用验证，运行正常、符合预期。**
- 也曾在 Chromium 中基于 OpenCode **1.19.5** 和模拟页面/API 进行测试。
- 尚未确认其他 OpenCode 版本或浏览器的兼容性。脚本依赖 OpenCode 网页结构和 API，上游改动可能需要相应更新。
- SPA 快速切换依赖页面路由拦截同源链接；若不可用，会退回浏览器常规导航。
- 页面可见时，运行状态约每 5 秒刷新一次。

## 隐私

脚本只在浏览器中读取当前页面和同源 OpenCode API 响应，不会向外部服务发送数据。

## 许可证

MIT，详见 [LICENSE](LICENSE)。

## 更新记录

### 1.5.3

- 修复手动缩放后展开面板的问题，并保持面板底边定位。
- 调整面板缩放和滚动行为。
- 按会话目录和 workspace 分组查询运行状态。
