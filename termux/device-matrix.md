# 口袋 Agent · 真机矩阵与排障手册

> 目标设备：Android 手机 + Termux。本文档是"装机前须知 + 装机后验证清单"，
> 照着勾一遍即可确认环境就绪。列出的行标 ⏳ 表示需在真机上确认，尚未实测。

---

## 1. 兼容性矩阵

| 维度 | 要求 | 说明 |
|---|---|---|
| Android 版本 | Android 8.0+（推荐 10+） | agentd 纯 Python，浏览器端要求 Chromium 内核（Chrome/Edge/夸克等均支持 PWA） |
| Termux | 从 F-Droid 安装（不要用 Play 商店版，已停更） | `pkg install git python termux-api` |
| termux-api | ≥ 0.52 | 30 个手机能力都走它；`termux-setup-storage` 授权存储后可读写 /sdcard |
| LLM 厂商 | 豆包/DeepSeek/千问/Kimi/智谱/硅基流动（OpenAI 兼容） | 设置里选厂商填 Key，无需第三方代理 |
| 系统要求 | 无 root、无特殊权限 | 所有能力走 termux-api 官方通道 |

## 2. 手机能力 → 前提对照

| 能力 | 需要 | 备注 |
|---|---|---|
| 电量/通知/吐司/震动/手电/音量/亮度/TTS/剪贴板 | termux-api 即可 | 通知可能要求关闭电池优化 |
| 短信读写、电话 | termux-api + 短信/电话权限弹窗 | 首次调用会弹系统授权 |
| 定位 | termux-api + 位置权限 | GPS 冷启动 10-30s，走 network 更快 |
| 语音转文字 | termux-api + 麦克风权限 | 依赖系统语音服务 |
| WiFi 扫描 | termux-api + 位置权限 | Android 10+ 扫描 WiFi 需位置权限 |
| 拍照 | termux-api + 相机权限 | 输出默认存 ~/storage/pictures |
| 下载/打开文件 | termux-api + 存储权限 | `termux-setup-storage` |
| 执行 shell | 仅 agentd 本身 | danger 级，默认需审批 |

## 3. 装机验证清单（⏳ 待真机勾选）

- [ ] `pkg install git python termux-api` 成功，`termux-api` 命令存在
- [ ] `bash termux/install.sh` 完成，无编译、无报错
- [ ] `bash termux/start.sh` 启动，日志显示 `监听 127.0.0.1:8787`
- [ ] 浏览器打开 `http://127.0.0.1:8787`，页面显示品牌界面
- [ ] 「添加到主屏幕」后从主屏图标启动，独立全屏运行
- [ ] 断网/飞行模式下重开应用，界面能秒开（Service Worker 壳）
- [ ] 设置里填真实 LLM Key 并保存，状态变「已就绪」
- [ ] 问一句"查看电池电量"，工具卡显示完成并回填结果
- [ ] 让它"读一下最近短信"，弹审批卡 → 允许一次 → 显示短信
- [ ] 让它"发一条通知"，通知栏真的出现
- [ ] 让它"拨打10086"，审批卡出现（danger 标注）→ 拒绝 → 不产生通话
- [ ] 让它"读剪贴板"，内容正确
- [ ] 新会话首条消息后，会话列表标题自动命名
- [ ] 杀掉 agentd 重启，重新打开页面历史消息还在
- [ ] 输入框回车发送、Shift+回车换行、输入中可随时停止

## 4. 常见问题排障

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面显示"服务未配置" | 未填 LLM Key/模型 | 设置 → 选厂商 → 填 Key → 保存 |
| 工具报"termux-api 未安装" | 没装 termux-api | `pkg install termux-api` |
| 短信/定位等首次无响应 | 系统权限弹窗被忽略 | 系统设置 → 应用 → Termux → 权限，手动授权 |
| WiFi 扫描为空 | Android 10+ 需要位置权限 | 给 Termux 位置权限（粗略即可） |
| 通知发不出 | 系统电池优化杀了后台 | 系统设置 → 电池 → 关闭 Termux 优化 |
| 页面能开但发消息 401 | 设置了令牌但浏览器没带 | 重新在设置里保存一次令牌（会写入 localStorage） |
| 想局域网用手机 A 访问手机 B | B 需 `--lan` + 令牌 | B：设置令牌 → `start.sh 8787 --lan`；A 浏览器填 B 的 IP:8787 |
| 手机休眠后服务连不上 | Termux 被系统冻结 | `termux-wake-lock` 保持唤醒；或关掉系统电池优化 |
| 重启手机后服务没了 | agentd 不会自启 | 重新 `bash termux/start.sh`（可用 termux-boot 开机自启） |
| 审批一直不弹 | 权限模式是「全自动」 | 设置 → 工具权限 → 改为「逐次审批」 |

## 5. 已实测（本机 Linux 模拟）

以下链路已在本机用 23 个 termux 桩命令全量验证：电池、短信读写+审批、
定位+审批、剪贴板、传感器、通知、TTS、语音、WiFi、拍照、拨号+审批、
会话自动命名、记忆摘要落库、审批超时自动拒绝、SSE 流式、--lan 鉴权。
⏳ 真机 termux-api 实参对照待逐项勾选（见第 3 节清单）。
