
## 测试说明
- `m5_regression.py`：安全加固回归（打码/权限/danger 审批/超时拒绝/命名/工具清单）10 项
- `p0_queue_test.py`：P0 排队验收（并发：第一轮挂审批时第二轮应 queued，审批放行后自动执行）
- 运行前提：`--mock` 服务 + `/tmp/faketermux/` 25 个 termux 桩（被系统清空后需重建）
