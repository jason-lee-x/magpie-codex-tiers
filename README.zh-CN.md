# Magpie Codex Tiers

[English](README.md) | 简体中文

为 [Magpie](https://github.com/yetone/magpie) 提供 Codex `service_tier` 管理：按模型设置档位，并在收到额度重置预告时临时切换到 Fast 或 Ultrafast。

## 功能

- 全局默认档位和按模型规则；模型名支持模糊搜索。
- 四种档位：保持（保留客户端原值）、移除（删除 `service_tier`）、Fast（`priority`）、Ultrafast（`ultrafast`）。后端是否支持对应档位由供应商决定。
- 从 [didcodexreset.com](https://didcodexreset.com) 获取重置预告，按系统时区显示时间和倒计时。
- 可选自动临时提速，优先于插件中的全局和模型规则；检测到额度重置或预告到期后恢复原规则。
- 显示临时生效状态和低可见度的恢复记录。
- 中、英、日三种界面语言，跟随 Magpie 明暗主题。

只处理 `gpt-*` 模型的 `chat` / `responses` 请求；模型名可以带供应商前缀。其他模型和协议原样放行。插件不会主动请求 Codex 额度 API。

## 安装

需要支持 middleware、Bun hooks 和插件页面的 Magpie 版本，以及 Magpie 可用的 Bun 运行环境。

安装固定版本：

```bash
magpie plugin add "github:jason-lee-x/magpie-codex-tiers#v1.0.0"
```

```bash
magpie plugin on magpie-codex-tiers
```

升级后重新打开插件页面。固定 tag 的安装需要显式安装新 tag 才会升级。Magpie 安装时禁用包的生命周期脚本，本仓库已直接包含全部可运行资源。

GitHub 插件发现依赖仓库的 `magpie-plugin` topic。安装与发现规范参见 [Magpie 插件发布文档](https://github.com/yetone/magpie/blob/main/site/public/docs/plugins.html)。

## 使用

在 Magpie 的插件页面打开 **Codex 档位**：

1. 在「全局」选择未匹配模型规则时使用的档位，默认「保持」。
2. 在「按模型设定 service_tier」添加模型，设置单独的档位。
3. 在「收到预告时」选择关闭、Fast 或 Ultrafast；默认关闭自动提速。
4. 「预告刷新」控制预告接口请求间隔，可选 1–120 分钟，默认 5 分钟。

「来源」和「数据来自」按钮复制链接，随后可自行粘贴到浏览器。页面受 Magpie iframe 沙箱限制，复制失败时会直接显示链接供手动复制。

## 预告与额度检测

预告来自第三方接口 `https://didcodexreset.com/api/status.json`，并非 OpenAI 的保证。自动模式会在收到有效预告后立即启用临时档位。插件以本地额度变化作为恢复信号，并以预告截止时间兜底。

预告刷新和额度检测是两个独立流程：

- 预告刷新控制第三方接口的网络请求频率，临时提速期间也遵守所选间隔；关闭自动提速时仍会获取预告。
- 成功响应的有效期为所选刷新间隔加 30 分钟失败宽限；失败请求不会续期。中间件会独立检查预告截止时间和数据有效期。
- 公开预告缓存在本地 `codex-tiers-status.json`，避免宿主重启后丢失刷新时序；缓存不包含本地额度读数。
- 自动模式开启后，hook 每分钟检查 Magpie 的本地 `quotas.json`；请求到达也会触发检查。检测及时性取决于 Magpie 何时更新该文件。
- 页面每 5 秒读取插件状态，更新生效徽标和提示。

额度变化属于启发式判断，不能证明某次变化来自全站重置；正常额度窗口重置也可能触发恢复。账号数据缺失或未更新时，只能依靠后续读数或截止时间恢复。多账号环境中，任一已有基线账号出现符合条件的变化即可触发恢复，不要求所有账号同时重置。

## 配置

配置存储在 Magpie 的 `plugins.json` 中，推荐通过插件页面修改。默认选项：

```json
{
  "models": [],
  "defaultTier": "keep",
  "reset": {
    "enabled": false,
    "tier": "ultrafast",
    "refreshMin": 5,
    "phase": "idle"
  }
}
```

`models` 中的规则格式为 `{ "model": "gpt-5.1-codex", "tier": "priority" }`。合法档位是 `keep`、`none`、`priority`、`ultrafast`。

`reset.enabled`、`reset.tier` 和 `reset.refreshMin` 是用户设置；其余重置状态由 hook 管理，不应手动编辑。Magpie 的 options 写入为整体替换，命令行设置时应保留完整对象。

hook 写入前会重新检查重置状态是否变化，并原子替换配置文件。但 Magpie 没有提供双方共享的事务或 compare-and-swap API，宿主和 hook 在最后一次读取到 rename 之间仍可能发生极短的并发写入冲突。已复现的异步旧状态覆盖问题有回归测试覆盖，跨进程写入仍不具备完整事务保证。

Magpie 内置分组的 Fast 规则在 `onProvider` 之后应用，可能覆盖插件写入的 `service_tier`。不要依赖两者叠加后的插件优先级。

## 隐私与权限

- 声明 `usage:summary`，只用于提供模型搜索候选。
- Bun hook 在本机读取 `plugins.json` 和 `quotas.json`，并更新自身的 `options.reset`。Bun hook 具备宿主文件和网络能力，安装前应审查源码。
- 配置定位先验证宿主工作目录中的插件安装归属，再尝试 XDG/home 标准位置。当前 Magpie 的宿主实现因此支持 portable 安装，但这不是稳定公开的配置路径 API。
- 额度和账号标识仅用于本地判断，不发送给预告站点。预告站点会收到普通 HTTPS 请求及常规连接元数据。
- 不上传提示词、响应、API key 或额度数据；无遥测。
- 源码仓库不包含本地配置、真实账号、日志、截图或调试产物。

## 开发与验证

运行环境使用 ES modules，无第三方运行时依赖。测试仅使用合成数据和临时隔离配置，不读取真实账号配置。

```bash
npm test
```

```bash
npm pack --dry-run
```

## 许可证

[MIT](LICENSE)。独立社区插件，与 OpenAI 和预告数据站点无隶属关系。
