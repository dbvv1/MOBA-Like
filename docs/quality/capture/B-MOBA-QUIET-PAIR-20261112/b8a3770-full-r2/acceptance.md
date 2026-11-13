# 接收范围 · 2026-11-13

接收固定结果 `332fa5f` 中的 quiet 完整 smoke 与测试脚本修复；不把整张卡的 review_ready 当成三案换默认结论。

- quiet retry 的报告为 passed，原始帧数组 1261 个回调，tick 0 → 9010 自然终局；材料始末均 active quiet-family-v1。报告中浏览器 exit 0、previewClosed true、cleanupErrors 空。已过的静态双盲仍沿用，不重拍或重评。
- default first 已到 tick 9010，但后续初始化被存档选择挡住；default retry 在初始 readiness 超时，未完整通过。只补 default 的完整流程，不重跑 quiet。修复只触及测试的存档选择与键盘设置 details 定位，模拟、材质和测量实现不变。
- 共享宿主 SwiftShader 的 mean / p95：default first 489.49 / 550 ms，quiet retry 502.14 / 570.1 ms，约 +2.6% / +3.7%；数据不是硬件 GPU 性能结论，最终取舍还需保留宿主负载条件。
- **收集欠项**：paths.json 列 59 项，本次结果提交只有其中 12 项；6 项未脱敏文件的字节 SHA256 一致，其余现存文件按记录已脱敏。47 项未提交，包括 runner start/end/exit、若干图与日志，不能沿 README 的完整收集表宣称已取回。quiet 结束时间由报告为 04:10:16.464 UTC，外层 04:10:18 / exit 0 仅为作者汇总，尚无该原退出文件。此欠项不否决已存在的 quiet 证据，也不冻结其他案例；下一本机卡启动前核当前实际资源。

脚本接收的 CPU 验证与最终源码提交记录在提交说明。下一次接收沿本目录追加缺失原件并逐个核 SHA，不改已有报告、原帧或原哈希，不重新制造过去的退出回执。
