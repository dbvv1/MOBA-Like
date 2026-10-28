# B-MOBA-DIFFUSE-GPU-001 · 既有运行声明与回执追溯

**性质：只读追溯。未启动构建、安装、测试、浏览器、GPU 或拍摄；未补跑、未诊断、未改代码；未执行清理。GPU 与画面品质均未判定。**

本目录只回答已发生事实：`revision-3f89df2` 原归档保了什么、原 baseline 调用的原始字段与清理回执是什么、a1 卡转述的运行审查员“复跑两条命令均通过”声明能追到哪些原始证据。

结论分三层：

1. 原归档完整：`revision-3f89df2` 原归档（不含本 `review-evidence/`）共 16 个文件，manifest 记录的 15 个文件 SHA-256 与字节数全部与磁盘一致；只有 `baseline` run `run-3f89df2bcfca-idle-gtjcpZ`，没有 `stylized-diffuse` 产物，也没有第二个 run 目录。
2. 原 baseline 调用在现有归档范围内证据齐全且自洽：命令退出 1，`report.passed=false`、`report.capturePassed=false`，两次 repeat 的 frame 0 RGBA 不同；该 runId 的预检、租约、实际启动 flags、自有进程退出、connection/server 关闭、preview 拒连与 ownerMatched/released 回执均已有记录。限制：结束时的 served-file 复核与“构建未变更”断言未执行，bundle 哈希只证明运行前绑定（见 §3.3）。
3. 审查声明只有转述，没有原始证据：未定位到审查员声称的额外调用的 runId、时间、源码/构建身份、report、逐帧图片、lifecycle 或清理回执。按卡面记为 **“声明未经原始证据验证；额外运行及其清理未知”**。这不等于已证明额外运行没有发生。

## 1. 数据源与定位

只核对下列明确定位的数据源；未广泛扫描文件系统、私人会话目录、对话或内部 transcript。

| 编号 | 类型 | 明确定位 | 读取与导出 |
|---|---|---|---|
| S1 | 公开文档 | a1dbv 仓库 `docs/collaboration/local-jobs/B-MOBA-DIFFUSE-GPU-001.md`，commit `e17b197ecf3b3d4a58d96d3b7cd759a22c2da24f`（历史卡，section“当前结果”） | 只读；只摘要转述，不导出全文 |
| S2 | 公开文档 | 同上文件，commit `df47c465afd6c1a1e30790a228c8bb8993bb6980`（本轮卡面，section“已核事实”） | 只读；只摘要转述 |
| S3 | 获准读取的结构化执行记录 | 接收端任务运行记录 `u1-a0-2026-10-27T231508425Z/execution.json` 的 `result.text`（`RECEIVER_RESULT` 摘要）；以及 `u1-a0-2026-10-27T205727160Z/execution.json` 的同类字段 | 只做 JSON 解析；不导出会话、`native.stdout.jsonl`、`scratch` 或 transcript |
| S4 | 仓库内已提交产物 | 本仓库 `docs/quality/captures/B-MOBA-DIFFUSE-GPU-001/revision-3f89df2/`（HEAD `8a824802f771ab6a18381517c51966a754a20ec0`） | 只读；哈希核对，不导出原文件副本 |
| S5 | 仓库内旧档 | 本仓库 `docs/quality/captures/B-MOBA-DIFFUSE-GPU-001/` 根目录（`7968512` 旧证据） | 只读；哈希核对 |

公开仓库中提及本卡的只有上述卡面与 `docs/collaboration/TASKS.md` 的一行状态，没有独立的审查结果文件。S3 是接收端最终结果摘要，不是审查员的原始输出。S1/S2 的声明确切表述：

- S1：“运行审查员另称其复跑两条命令均通过，与归档失败记录不一致，属审查侧补跑、未经接收端独立复核。”
- S2：“a1 历史卡另转述运行审查员声称两条命令复跑通过，但未经独立复核。”

## 2. 原归档完整性核对

- 目录：`docs/quality/captures/B-MOBA-DIFFUSE-GPU-001/revision-3f89df2/`
- 原归档（不含本 `review-evidence/`）文件总数 16：9 个 `lifecycle` JSON、2 个 PNG、2 个逐帧 JSON、`report.json`、`manifest.json`、`result.md`；当前该目录含本 `review-evidence/` 共 18 个文件。
- `manifest.json` 的 `files[]` 列 15 项（manifest 不自列），逐项重算 SHA-256 与字节数，**15/15 一致**；manifest 自身当前 SHA-256 为 `885d7f2d80c33e1ffc8ecd421013f534f21bdf22a0b7d054a57d602eaebebf3f`。
- run 目录只有一个：`baseline/run-3f89df2bcfca-idle-gtjcpZ`。全目录搜索 `*stylized*` 为 0 个文件；没有第二个 `run-*` 目录。
- 旧档 `7968512` 侧同样校验：manifest 列 15 项，15/15 哈希与字节数一致；其 manifest SHA-256 为 `a3919eb61b106914f9aa92bac23f2f03b6404c9c51ca41d258532503413adf04`。本次未改动旧档。
- 工作树 HEAD `8a824802f771ab6a18381517c51966a754a20ec0`；已跟踪文件无改动（`git diff` 为空，`git status --porcelain --untracked-files=no` 为空）。`git status --porcelain` 在写入本 `review-evidence/` 前为空，当前仅列出未跟踪的 `review-evidence/` 目录：`?? docs/quality/captures/B-MOBA-DIFFUSE-GPU-001/revision-3f89df2/review-evidence/`。

## 3. 原调用：命令级与调用内 repeat 分开

### 3.1 两次命令（invocation）

| 序号 | lighting | 状态 | 退出码 | runId | 说明 |
|---|---|---|---|---|---|
| 1 | `baseline` | stopped-after-failure | 1 | `run-3f89df2bcfca-idle-gtjcpZ` | 两次 repeat 在 frame 0 RGBA 不同，按卡面停止 |
| 2 | `stylized-diffuse` | not-executed | null（未运行） | 无 | 第一条失败后未执行；无产物、无回执 |

命令级开始/结束时间未单独落盘。该 run 的可核对时间窗由 lifecycle 回执给出：runner-started `2026-10-27T23:22:17.753Z` → lease-release `2026-10-27T23:22:48.825Z`；manifest 归档时间 `2026-10-27T23:23:43.793Z` 不是命令结束时间。

### 3.2 调用内 repeat

| repeat | frame | stateHash | PNG SHA-256 | RGBA SHA-256 | 逐帧 JSON SHA-256 |
|---|---|---|---|---|---|
| 1 | 0 | `45ddcfd7f7a45536` | `9533ab2e77619705194b2d741fb83321f4f6c408e6e470d092ca16a4322caf11` | `384f3cd20fa35f9abeed10ef8ff6d25114e45153bb21b8f51791078c09b3208f` | `2125fde728e92973930fd789f4172ecc18795672d9e2efac9b55a27ee6795256` |
| 2 | 0 | `45ddcfd7f7a45536` | `f62d1d753f19a02741dfd3ad82d5c15f634755254e9d3d763d78d14404ddf6f8` | `f896e602f26eaca357c9e66b77489d78adae17d294e986cc37f685ef26525486` | `2b5a4541654c1e76a42264220731172e6d5f180ffaaa49a7491bae1024c95508` |

两次 repeat 的 state/camera/renderer/lighting/viewport 相同，只有 RGBA 不同；这正是 `report.json` 中的失败点。PNG 均解码为 1280×720（归档记录）。

### 3.3 原始报告字段

- `report.json` SHA-256 `38a6ebc1eebe6000eac78c753da1fd2eeca90762189604a1c0b69c2907a2ea80`，25,330 字节。
- `passed=false`、`capturePassed=false`；`sourceCommit=3f89df2bcfcaca1dde86cc1412d1649090a09d60`、`runnerSourceCommit` 同值、`sourceDirty=false`；`runId=run-3f89df2bcfca-idle-gtjcpZ`；`parameters={lighting:"baseline", shots:["first-tower"], seed:"61", t:"101", input:"idle", frames:"1", repeat:2}`。
- 两条 warning 均为既有的 `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed`；一条 error 为 frame 0 重复像素不一致。
- `qualityAcceptance="not-performed; capture infrastructure is not lighting/material or player-control approval"`：原报告明确不构成光照/材质或品质验收。
- `manifest.source.bundleEndVerification="not-executed"`：因 repeat frame 0 断言失败，结束时的 served-file 复核和“构建未变更”断言均未执行；`bundleSha256=0c339a1a19c96e5800c883fcb0a1731e83014cf773dcab80487c20ebbb8a7c28`（33 个文件）只是运行前的 `served-files-verified-against-local-artifact` 绑定（`manifest.source.bundleBinding`），不能当作全程核验过的构建身份。

## 4. 逐命令预检与共享租约（仅原 run）

- `manifest.preflight` 记录于 baseline 命令启动前（`checkedAt` 文本：“immediately before the baseline command; lease createdAt 2026-10-27T23:22:17.755Z”）。
- 方法：只读接收端 `state/*.json` 与任务卡；检查既有共享根锁和 `chrome.exe`。
- 当时我方并发任务：`A-RESUME-CONTRACT-SOURCES-20261028` 为运行中、任务卡写明无 GPU；`B-MOBA-CLIENT-SMOKE-001` 为 idle/cancelled、本机图形验证已撤销。本卡为当时我方唯一 GPU 任务。
- 既有共享根锁：启动前为空；`chrome.exe` 进程数 0；用户 Edge 未停止、未操作。
- 范围声明：只覆盖任务元数据与本次自有调用，不是全机 GPU 或进程认证。
- 该锁在 `run-3f89df2bcfca-idle-gtjcpZ` 取得，并在该 run 结束时 `ownerMatched=true`、`released=true`。
- `stylized-diffuse` 未执行，因此没有第二条命令的预检或租约记录。

## 5. 实际启动 flags 与清理回执（绑定 gtjcpZ）

实际 flags 来自 `ChildProcess.spawnargs` 的 `spawnEvidence`，不是 `launch` 请求配置：

- `executable=playwright-bundled`、`headless=true`、`headed=false`、`noSandbox=false`、`disableSetuidSandbox=false`、`unsafeSwiftshader=false`、`useAngle=null`、`software=false`。
- `launch` 只是请求配置（含 sandbox 与 `ignoreDefaultArgs` 等），不能替代上述实际 argv 事实；本证据不导出完整 argv、executable 路径或 endpoint。

与该 runId 绑定的自有资源回执：

- 浏览器：自有 `ChildProcess` 句柄，PID `84524`，父 runner PID `94800`，`registeredAt=2026-10-27T23:22:27.133Z`；`exit(code=0, signal=null)` 于 `2026-10-27T23:22:48.629Z` 由 exit event 观察。
- connection/server：`connectionClosed=true`、`serverClosed=true`。
- preview：PID `94800`、端口 `5293`，`closedAt=2026-10-27T23:22:48.822Z`、`listening=false`、`portState=refused`、`exitProven=true`。
- 租约：`released=true`、`ownerMatched=true`，观察于 `2026-10-27T23:22:48.825Z`。
- 范围：仅覆盖本次自有句柄；`osProcessTree=not-observed`、`globalGpuAvailability=not-assessed`，不外推全机进程退出或 GPU 空闲。

9 个 lifecycle 事件的 runId 均为 `run-3f89df2bcfca-idle-gtjcpZ`，顺序为 runner-started → lease-acquired → preview-start-requested → preview-listening → browser-start-requested → browser-process-observed → browser-close-observed → preview-close-observed → lease-release-observed。

## 6. 审查声明与“额外调用”追溯（请求补充的第 2 项）

### 6.1 声明

S1/S2 转述：运行审查员声称 `baseline` 与 `stylized-diffuse` 两条命令复跑均通过；S2 同时注明未经独立复核。该声明没有给出 runId、时间、源码、构建或产物位置。

### 6.2 逐项字段（缺失值一律写“未提供”，不补造）

| 字段 | 声称的 baseline 额外调用 | 声称的 stylized-diffuse 额外调用 |
|---|---|---|
| runId | 未提供 | 未提供 |
| 开始时间 | 未提供 | 未提供 |
| 结束时间 | 未提供 | 未提供 |
| sourceCommit | 未提供 | 未提供 |
| tree | 未提供 | 未提供 |
| runnerSourceCommit | 未提供 | 未提供 |
| sourceDirty | 未提供 | 未提供 |
| bundle 哈希 | 未提供 | 未提供 |
| 构建身份 | 未提供 | 未提供 |
| 退出码 | 未提供 | 未提供 |
| report / PNG / 逐帧 JSON | 未提供 | 未提供 |
| lifecycle / 清理回执 | 未提供 | 未提供 |

### 6.3 已做的核查

- 原归档（8a82480 口径）16 个文件只包含一个 run（gtjcpZ）；没有额外 run 目录，也没有 `stylized-diffuse` 文件。
- 旧档 `7968512` 与本轮 revision 目录均未出现第二组 `report.json` 或 lifecycle。
- 本任务 worktree 没有未归档的原生输出目录（`outputs/`、`dist/`、`node_modules/`）；但 `revision-3f89df2` 的 16 个已归档原文件仍在此 worktree 的 `docs/quality/captures/...` 下（8a82480 归档口径，未改动，本目录加入后共 18 个文件）。因此“无 `outputs/` 等目录”不能读成“本 worktree 无任何拍摄产物”，更不能外推为其他目录或机器的证据。
- 公开仓库没有独立审查结果文件；获准读取的 S3 只含接收端最终摘要，不含审查员原始输出。
- 因此额外调用既不能确认，也不能否定。

### 6.4 结论

**声明未经原始证据验证；额外运行及其清理未知。** 原 gtjcpZ 的预检、租约、flags、进程退出与清理回执不能替代声称的额外调用对应 runId 的回执。

## 7. 缺口与冲突

缺口：

1. 原审查的原始输出（三路审查明细、openIssues、审查员运行记录）未以公开或获批文件定位；目前只有 S1/S2/S3 的转述/摘要。该项单独列为缺口，不推断审查是否实际执行。
2. 声称的额外两次调用缺少第 6.2 节全部字段。
3. 声称的额外调用缺少 report、逐帧 PNG/JSON、退出码、lifecycle、connection/server/preview/lease 回执。
4. 声称的额外调用缺少逐命令预检与共享租约证据；无法判断其是否与既有共享锁互斥。
5. 无法定位额外调用发生的位置（本机其他目录、其他机器或未落盘）；本 worktree 没有未归档的输出目录（`outputs/`、`dist/`、`node_modules/`），这不构成全机证据，也不覆盖额外调用可能使用的其他目录或机器。
6. `stylized-diffuse` 没有任何 before/after 产物，前后对比与品质结论不可评。

冲突：

- S1/S2 的“两条命令复跑均通过”与 S4 的原始归档（baseline 退出 1、repeat RGBA 不一致、stylized-diffuse 未执行）不一致。该冲突未解决；现存原始证据只支持 blocked，不支持通过。

### 处置建议（不构成验收）

1. 原卡结论维持 **blocked**；本证据不改变原 baseline 的失败结论。
2. 若要以“通过”采用该声明，须先取得 §6.2 全部字段并绑定到具体 runId；原 gtjcpZ 的回执不能替代声称的额外调用回执。
3. 不补跑旧声明；恢复路径见原卡“下一步”——先由代码卡修复重复根因，再从下一固定干净提交重跑。
4. 最终验收与是否授权新的 GPU 运行仍归 dot-B；本目录不作出通过判定。

## 8. 导出与保全

- 原 16 个文件与旧档未改动：哈希与 manifest 一致。被跟踪文件无改动（`git diff` 为空，`git status --porcelain --untracked-files=no` 为空）；`git status --porcelain` 仅显示本次新增的未跟踪 `review-evidence/` 目录。新增文件仅在 `review-evidence/`。
- 本目录不包含完整 argv、wsEndpoint、nonce、租约根绝对路径、DEBUG 原日志、凭据、对话或 transcript；runId、PID、端口与时间取自已公开归档。
- 不宣布 GPU 或品质通过；`openIssues` 为空或审查 pass 不当作验收。最终验收、是否重新授权 GPU 运行与发布由 dot-B 决定。
