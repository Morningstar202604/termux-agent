
## 测试说明
- `m5_regression.py`：安全加固回归（打码/权限/danger 审批/超时拒绝/命名/工具清单）10 项
- `p0_queue_test.py`：P0 排队验收（并发：第一轮挂审批时第二轮应 queued，审批放行后自动执行）
- 运行前提：`--mock` 服务 + `/tmp/faketermux/` 25 个 termux 桩（被系统清空后需重建）
- `p1_jobs_test.py`：P1 定时任务验收（创建 interval 任务 → 触发执行 → 启停 → 条件拒绝 → 删除 → 持久化）8 项
- `mcp_demo_server.py`：MCP 最小 demo 服务器（stdio JSON-RPC），用于验证 agentd 的 MCP 客户端
- P1 其他：相关记忆检索/参数校验/离线语音见源码单测与 termux/voice.md
