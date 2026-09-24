# 口袋 Agent（agentd）—— 手机本地智能体服务

重构后的核心：**Python 单进程**（FastAPI + agent 循环），替代旧实现的
goose(Rust) + Node 双服务器。前端为 `web/`（Vite + React + TS），构建产物 `web/dist`
直接由 agentd 托管，手机端零 Node 依赖。

## 架构

```
浏览器 / APK 壳 ──HTTP+SSE──▶ agentd (FastAPI, :8787, 默认仅本机)
                                 ├─ Agent 循环（openai 兼容 function calling）
                                 ├─ 工具层：shell / files / phone(termux-api)
                                 ├─ 审批门（服务端强制，写/危险操作需确认）
                                 └─ SQLite（会话/消息，重启不丢上下文）
                                  └─▶ LLM API（豆包/DeepSeek/千问/Kimi/智谱/硅基流动…）
```

## 运行

```bash
# 开发（本机）
python -m agentd.main --mock --port 8787     # 离线演示，不消耗 API
python -m agentd.main --port 8787            # 真实模式（先在页面配置 LLM）

# 手机（Termux）
bash termux/install.sh
bash termux/start.sh
```

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/chat` | `{session_id?, message}` → SSE 事件流 |
| POST | `/api/approval` | `{session_id, tool_call_id, decision: allow_once\|allow_always\|deny}` |
| POST | `/api/stop` | 中断当前回复 |
| GET/POST/DELETE | `/api/sessions[/{id}]` | 会话管理 |
| GET | `/api/sessions/{id}/messages` | 会话消息历史 |
| GET/PUT | `/api/settings` | 设置（GET 时 API Key 打码） |
| GET | `/api/providers` | 国产 LLM 厂商预设 |
| GET | `/api/tools` | 工具清单与风险分级 |
| GET | `/api/health` | 健康检查 |

SSE 事件：`session` → `thinking`/`text`（流式）→ `tool_start` → `approval`（可选）→
`tool_update` → `done`/`error`。

## 安全设计（与旧实现的关键差异）

- 默认只监听 `127.0.0.1`；`--lan` 时所有 `/api/*` 校验 `Authorization: Bearer <token>`；
- 工具按危险度分级：`safe`（只读，免确认）/ `write` / `danger`。
  `approve` 模式下后两类必须用户在界面确认，服务端不再自动放行；
- 审批超时可配（`server.approval_timeout`，默认 120s），超时自动拒绝并回填
  「审批超时，已自动拒绝」；
- API Key 只存本地 `config.json`（0600），任何接口不回传明文；
- shell 工具输出截断、超时限制；文件工具路径白名单（仅主目录与存储目录）。

## 工具（M2：30 个，全部经 termux-api）

### 系统
| 工具 | 说明 | 风险 |
|---|---|---|
| `get_battery` | 电池电量/充电状态 | safe |
| `send_notification` | 通知栏消息 | write |
| `show_toast` | 屏幕悬浮提示 | write |
| `vibrate` | 震动 | write |
| `set_torch` | 手电筒开关 | write |
| `get_volume` / `set_volume` | 查询/设置音量 | safe / write |
| `set_brightness` | 屏幕亮度 | write |

### 通信
| 工具 | 说明 | 风险 |
|---|---|---|
| `send_sms` | 发短信（多号码） | write |
| `read_sms` | 读最近短信（隐私，需确认） | write |
| `make_call` | 拨打电话 | danger |

### 隐私 / 剪贴板
| 工具 | 说明 | 风险 |
|---|---|---|
| `get_location` | 当前位置（隐私，需确认） | write |
| `get_clipboard` / `set_clipboard` | 读写剪贴板 | safe / write |

### 传感器 / 语音
| 工具 | 说明 | 风险 |
|---|---|---|
| `list_sensors` / `read_sensor` | 传感器列表/读数 | safe |
| `tts_speak` | TTS 语音朗读 | write |
| `speech_to_text` | 语音转文字 | write |

### 网络 / 媒体 / 文件
| 工具 | 说明 | 风险 |
|---|---|---|
| `get_wifi_info` / `scan_wifi` | WiFi 信息/扫描 | safe |
| `set_wifi` | WiFi 开关 | write |
| `take_photo` | 拍照保存 | write |
| `share_text` | 系统分享面板 | write |
| `download_file` | 下载文件 | write |
| `open_target` | 打开文件/链接 | write |

另有文件类与 shell：`list_dir`/`read_file`（safe）、`write_file`（write）、
`delete_file`/`run_shell`（danger）——合计 30 个。
termux-api 未安装时返回结构化错误，由模型转告用户执行 `pkg install termux-api`。

## M2 新增能力

- **会话自动命名**：新会话首条消息自动生成 ≤14 字标题（真实 LLM 一次小请求，失败回退截断）；
- **记忆摘要**：每轮结束后滚动生成会话摘要存 `memory` 表，下一轮作为 system 消息注入，
  长对话不丢前情（`_trim` 裁剪时保护 system 消息）；
- **mock 模式自然语言触发**：消息含 电池/短信/定位/剪贴板/传感器/通知/工具 等词即走对应工具链路；
- **设置面板「手机能力」清单**：展示 30 个工具与风险分级（`GET /api/tools`）。

## M3 美术重构（品牌 + 双主题）

- **品牌**：口袋 Logo（渐变圆角方块 + 白色∪口袋 + 智能点），图标源
  `web/public/icons/icon.svg`，导出 48/96/192/512/32 PNG；
- **PWA**：`manifest.webmanifest`（name「口袋 Agent」、standalone、portrait、
  theme/background #0f1115、192 any + 96 maskable），`index.html` 挂 manifest 与 SVG favicon；
- **明暗双主题**：`styles.css` 设计 token 化（`html[data-theme=dark|light]`，默认跟随系统），
  `theme.ts` 持久化到 localStorage（key `pa-theme`，值 dark/light/system），`main.tsx`
  首帧 applyTheme 防闪烁，App 监听系统主题变化（system 模式）；
- **图标库**：`components/icons.tsx` 内联 SVG（会话/设置/发送/停止/删除/关闭/加减/电池/文件夹/通知/剪贴板/chevron），
  替换全部文字符号与内联路径；
- **设置面板分组**：外观（主题三卡选择）/ 模型 / 权限与安全 / 手机能力。

## 前端开发

```bash
cd agentd/web
npm install
npm run dev        # 开发模式（/api 代理到 8787）
npm run build      # 产出 dist/，agentd 直接托管
```

> 说明：M1/M2 前端用纯 CSS + 设计 token（零构建风险、更轻），未引入 Tailwind；
> M3 延续该路线，仅新增明暗 token 集与内联图标库，无额外运行时依赖。
