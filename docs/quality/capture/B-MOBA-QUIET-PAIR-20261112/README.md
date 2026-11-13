# B-MOBA-QUIET-PAIR-20261112 收集产物

本目录汇总三批产物，来源以各目录 `paths.json` 的 `sourceRoot` 为准：根 `paths.json` 对应最初接收批次的 `outputs/B-MOBA-QUIET-PAIR-20261112/da56173-swiftshader/`（即本目录根下的 `build-web-receipt/`、`default-pair/`、`quiet-pair/`、`default-smoke/` 和 `run-receipt.json`），`b8a3770-full-r2/paths.json` 对应 `outputs/B-MOBA-QUIET-PAIR-20261112/b8a3770-full-r2`，`cb025e89-default-r3/paths.json` 对应 `outputs/B-MOBA-QUIET-PAIR-20261112/cb025e89-default-r3`。`outputs/` 被仓库 `.gitignore` 忽略，原文件名也超过 Windows 路径上限，因此收集时把它们搬到这里，并缩短机位目录名。
原路径与新路径的对应、每个文件的原始 SHA-256 见各目录的 `paths.json`。脱敏范围以其中 `sanitized` 标记为准：`b8a3770-full-r2` 有 16 个、`cb025e89-default-r3` 有 5 个文件的本机绝对路径被替换为 `<repo>`／`<receiver-run>`／`<ms-playwright>`；最初接收批次只有根 `default-smoke/report.json` 脱敏（根 `paths.json` 用 `publishedSha256` 与 `note` 记录）。其余文件字节与原产物一致；产物内部引用的路径仍是原路径，按 `paths.json` 对照。
最初接收批次没有重跑模型、构建、拍摄或 smoke；本单元随后在固定 `base_ref` `cb025e89` 上另行新执行了一次 default 完整流程 smoke，单独产出 `cb025e89-default-r3/`（见下节）。执行结论、失败原因和后续动作以卡片“当前结果”为准。

## 2026-11-13 补收与 default 完整 smoke

- `cb025e89-default-r3/`：在固定 `base_ref` `cb025e89` 的独立干净 worktree 上新执行一次 default 完整流程 smoke，通过，外层 exit 0。构建来源、Node／Chromium／renderer、真实起止 UTC、浏览器与 preview 关闭、终局 tick 0→9010、restart／输入／存档恢复／HUD 断言和帧数组都在该目录；详见其 `README.md`、`environment.json` 和 `paths.json`。
- `collection-backfill-20261113.json`：接收端指出的 `b8a3770-full-r2` 47 项收集欠项已只从原磁盘产物补入；59 项现全部在位，缺文件为空。43 项非脱敏文件字节与映射 SHA-256 一致；16 项脱敏文件保留原字节哈希、目标字节以 `<repo>`／`<receiver-run>`／`<ms-playwright>` 替换本机绝对路径。没有重执行旧命令或重造退出回执。

