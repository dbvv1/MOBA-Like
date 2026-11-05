# B-MOBA-FIXED-CAPTURE-20261105 · 四机位软件基线

固定源 `7e1986f1ca2f05f07124d34fa9fdcbd3f33bfe64`（tree `316e1a3a6da5bd40e84faba90adae3ee4ac31533`）的 gameplay、spawn、first-tower、spawn-to-tower 四机位，各拍两张。默认 `forest-light-v1` 灯光与 baseline 材质，不启用 quiet、指令缓冲或其他旁置，不改源码、不部署。

## 结果

| 项 | 结果 |
|---|---|
| 八张 PNG | 全部 1280×720、DPR 1，可解码，非空白/遮罩/错误页；每机位两拍 PNG 与 RGBA 字节一致 |
| 渲染器 | `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`，WebGL2，`rendererClass=software` |
| Chromium | Chrome for Testing `156.0.8078.4`，SHA-256 `7f0816…cfb9`（完整值见 `manifest.json`） |
| 构建 | `tsc -p tsconfig.capture.json` exit 0；`vite build --config vite.capture.config.ts` exit 0；`outputs/capture-build` 共 50 个文件，bundle SHA-256 `47b62e…58de` |
| 服务 | 同进程 Vite preview，临时 loopback 端口；开始与结束各逐文件核 50 个文件，HTTP 字节与构建哈希 0 不一致 |
| 逐拍校验 | 每张 55 项检查全过；同机位两拍的 RGBA/PNG、stateHash、camera、renderer、灯光、材质、seed、input、t、frame、virtualFrame、simTick 全部相同 |
| 错误门槛 | pageerror、console error、requestfailed、HTTP≥400、WebGL context loss 均为空；`window.mobaClient` 不存在 |
| capturePassed | `true` |
| cleanExitBaseline | `false` |
| passed | `false`（`status = "capture-complete, exit-baseline-incomplete"`） |

`cleanExitBaseline=false` 的原因是拍摄 harness 进程真实 exit 1：八张图与清理都完成后，最终构建哈希断言引用了块作用域变量 `buildFiles`（应为 `state.buildFiles`），抛出 `ReferenceError`。公开的 `harness.mjs` 已改为 `state.buildFiles`；本次失败报告、`harness.log`、`pw-browser.local.log` 与失败栈（定位到 `harness.mjs:859`）保留在本地 `attempt-05-resume-postcapture-ref/`。实际执行、含 `buildFiles` 缺陷的原始脚本在修复时被同路径覆盖，没有单独留存，因此现存脚本不能当作当次执行的原始版本。Chromium 自身 exit 0、signal null，preview 关闭后端口拒绝连接，已归属 Chromium 子进程为 0；`capture-harness-exit.json` 与 `report.json.processRecords` 保留该真实退出码。之后的 `finalize.mjs` 只读取并复核落盘证据，不启动浏览器、preview 或构建；其自身 exit 0 由调用 shell 观察，不能抵消拍摄 harness 的 exit 1。本卡要求已有同卡输出只核原调用、不重派，且产物排他写入、不覆盖、不换根重跑，因此没有为补 exit 0 重拍；该缺口按原样交回，不把旧 exit 1 改写成成功。

## 固定回放与机位

`contentVersion=11`，双方 Veyra，普通对手 bot seed 1002；玩家只在首个逻辑步 move 到 `(-18, 1.2)`，`seed=1`。视觉 60 Hz 预推进 600 帧、模拟 30 Hz 至 tick=300 / t=10，12 次 renderOnly 预热，frame=0、frames=1。无 standards/commands/camera 参数；不注入状态、不改相机、不调用 `__shotNext`。

| 机位 | 完整路径（BASE 为实际本地 origin） | position / target；FOV |
|---|---|---|
| gameplay | `BASE/capture.html?shot=gameplay&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline` | 跟随 t=10 玩家表现位置：`(-24.2333, 24, 19.2)` / `(-24.2333, 0, 1.2)`；45° |
| spawn | `BASE/capture.html?shot=spawn&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline` | `(-94, 24, 19.2)` / `(-94, 0, 1.2)`；45° |
| first-tower | `BASE/capture.html?shot=first-tower&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline` | `(-28, 24, 18)` / `(-28, 0, 0)`；45° |
| spawn-to-tower | `BASE/capture.html?shot=spawn-to-tower&seed=1&t=10&input=march&frames=1&lighting=forest-light-v1&materials=baseline` | `(-65, 62, 46.5)` / `(-65, 0, 0)`；45° |

## 证据与文件

- `capture-<机位>-<1|2>.png`：直接来自 `__shot.pngDataUrl`（实际 1280×720 WebGL 画布），不是页面或桌面截图。
- `capture-<机位>-<1|2>.json`：完整逐拍元数据，已去掉 `pngDataUrl`；含 validation、renderer/vendor/version/unmasked、camera、stateHash、render、灯光/材质/standards、viewport、PNG/RGBA 哈希。
- `manifest.json`：固定 commit/tree、源干净状态、构建/服务哈希、八图与全部参数、逐进程退出与清理、两次拍摄调用与五次中断的精确原因。
- `report.json`：分列 `capturePassed` 与 `cleanExitBaseline` 的汇总与检查表。
- `build-files.json`、`capture-bundle.build.json`：唯一一次构建的 50 个文件哈希与 bundle 清单。
- `capture-harness-exit.json`：监督父进程观察到的拍摄 harness 真实 exit 1。
- `finalize-run.json`：最终证据合成进程的输入与结论；未启动浏览器/preview/构建。
- `harness.mjs`、`supervise.mjs`、`finalize.mjs`、`windows-hide-preload.mjs`、`preload-stub-test.mjs`：本轮一次性 harness 与离线 preload 合同测试。
- `helper-crosscheck.mjs` / `.json` / `.log`：用仓库原 `tools/capture-output.ts` 的 bundle 哈希、逐文件服务校验、端口状态、spawn 证据、退出观察与错误脱敏函数，对本次唯一构建与证据做离线交叉核对（10 项全过，未启动浏览器或 preview）。公开副本仅把 `tools/capture-output.ts` 的相对导入深度按新位置改为 `../../../../`，并把脱敏测试夹具改为运行时拼装（公开源码不含字面本机路径或端点）。从该位置复跑 `<node24> helper-crosscheck.mjs` 需满足：设置 `MOBA_CAPTURE_REPO=<repo worktree>`；另建一个空临时根，把本目录的 `capture-bundle.build.json` 复制进去，并以 `MOBA_CAPTURE_OUT_ROOT` 指向该根（脚本用 `wx` 写 `helper-crosscheck.json`，不能直接用本目录或任何已有结果的根）；仓库中需保留 `outputs/capture-build`。按此实测 10/10 通过、exit 0，未替换原始证据。
- `preload-stub-test.log`、`build-tsc.log`、`build-vite.log`：stub 12 项检查（0 子进程启动）与两次构建的已脱敏日志（去 ANSI/绝对路径，命令行按各自真实调用用占位表示；stub 测试本身未以 `--import` 启动，由测试内部导入 preload）。

画质能力中 `MAX_SAMPLES`、各向异性上限、纹理格式未由拍摄页面暴露，记为 `unknown`；没有为探测额外创建 GL context。

## 本轮实际调用（仅本机，不能按公开副本原样重跑）

只复用已装 Node 24.22.1、Chrome for Testing 156.0.8078.4 及与本项目固定 `package-lock.json` 一致的依赖；本轮未安装或升级任何依赖，未使用 Python 或 3D 资产工具。`node_modules` 的每个直接依赖版本在构建前都与 `package-lock.json` 核对。

下面的命令是本轮实际调用的形态，不是从本公开目录可直接复现的流程。前置条件与限制：

- `supervise.mjs` 和 `harness.mjs` 都从 `MOBA_CAPTURE_OUT_ROOT` 解析 `harness.mjs`、`windows-hide-preload.mjs`、`preload-stub-test.mjs` 和 `preflight.json`（`supervise.mjs:22–23`、`harness.mjs:287–300`）。这些脚本在本公开副本中位于 `docs/quality/capture/B-MOBA-FIXED-CAPTURE-20261105/`；运行前必须把它们复制进新的输出根，让 `--import` 指向根内的 preload，并在根内写入含 `taskId`、`commit`、`tree` 和 `rootExistedBeforeCreation: false` 的 `preflight.json`（只能对确实新建的根这样写）。
- 输出根必须是此前不存在的独占根。`supervise.mjs` 以 `wx` 打开 `harness.log`，已存在会 `EEXIST`；`harness.mjs` 的 freshness allowlist 只接受 `preflight.json`、上述脚本、`harness.log`/`pw-browser.local.log`、两次构建日志、`preload-stub-test.log`、`build-files.json`、`capture-bundle.build.json`、gameplay 两拍文件和 `attempt-NN-*` 目录，出现 `manifest.json`、`report.json` 或其他机位图片等旧产物会被直接拒绝。因此不能在本轮已交付的本地输出根或任何旧根上重跑。
- 交付的八图由两次调用拼成：gameplay 两拍来自 attempt-04，spawn、first-tower、spawn-to-tower 来自 attempt-05。attempt-05 是续跑，环境含 `MOBA_CAPTURE_RESUME=1` 和 `MOBA_CAPTURE_PREVIOUS_RESULT=<out root>/attempt-04-gameplay-comparison-bug/capture-result.json`；不设这两项会从 gameplay 重新开始，得到不同的 attempt 划分。
- `finalize.mjs` 固定读取 `attempt-04-gameplay-comparison-bug/capture-result.json`、`attempt-05-resume-postcapture-ref/capture-result.json` 和 `attempt-05-resume-postcapture-ref/supervised-exit.json`，并逐文件复核本地的 `outputs/capture-build`。这些 attempt 目录与构建产物只留本地，不在公开副本中，所以公开副本不能按现命令重跑 finalize，它只能复核本地原始证据；新跑一轮应从该轮 `capture-result.json` 生成 report/manifest，或另写通用合成器。

```sh
export MOBA_CAPTURE_REPO="<repo worktree>"
export MOBA_CAPTURE_OUT_ROOT="<尚未存在的新输出根>"
export MOBA_CAPTURE_CHROMIUM="<existing Chrome for Testing chrome executable>"
export MOBA_CAPTURE_NODE24_VERSION="v24.22.1"
export PACKAGE_LOCK_SHA256="edefefba9571006039cd9ff4035b180fbb1a11c7bdfa6fa558ed5a98a4556b3a"

# 前置：把 supervise.mjs、harness.mjs、windows-hide-preload.mjs、preload-stub-test.mjs
# 复制进 $MOBA_CAPTURE_OUT_ROOT，并在根内写 rootExistedBeforeCreation=false 的 preflight.json。
# 交付证据的 attempt-05 是续跑（新跑一轮时去掉这两项 MOBA_CAPTURE_* 变量）：
MOBA_CAPTURE_RESUME=1 \
MOBA_CAPTURE_PREVIOUS_RESULT="$MOBA_CAPTURE_OUT_ROOT/attempt-04-gameplay-comparison-bug/capture-result.json" \
<node24> --import "<$MOBA_CAPTURE_OUT_ROOT/windows-hide-preload.mjs 的 file URL>" \
  "$MOBA_CAPTURE_OUT_ROOT/supervise.mjs"

# 仅本机：需要本轮 attempt-04/attempt-05 与 outputs/capture-build，公开副本无法执行
<node24> "$MOBA_CAPTURE_OUT_ROOT/finalize.mjs"
```

`supervise.mjs` 只启动一个 harness 子进程。非续跑（首次）调用里，harness 先跑离线 preload 合同测试（不启动任何子进程），再各执行一次 `tsc` 与 `vite build`；本轮交付的 attempt-05 是续跑（`MOBA_CAPTURE_RESUME=1`），跳过 stub/tsc/vite，只复用并复核 attempt-04 的 preload 与构建证据，随后启动唯一一个 Vite preview 与唯一一个 `chromium.launchServer()`/`connect()` 的 headless Chromium，拍其余三机位。`windows-hide-preload.mjs` 强制本轮所有 `child_process` 入口 `windowsHide=true`（含 Vite 配置内的 `execFileSync('git', …)`），并用 `syncBuiltinESMExports()` 刷新 ESM 命名导出；不改源码或全局 `NODE_OPTIONS`。Chromium 启动参数固定为 `--no-sandbox --enable-unsafe-swiftshader --use-angle=swiftshader --enable-automation --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows`，不设置 `ignoreDefaultArgs`；实际 argv 由 CDP 核到 headless、三参数与 automation。只关闭本次浏览器自身 sandbox，不动平台外层沙箱。

## 本次中断记录

八张图与清理完成后，harness 因最终构建哈希断言引用 `buildFiles` 失败；此前另有四次在任一拍摄帧之前或双拍比较处的中断。五次原因、阶段和证据目录均写入 `manifest.json.attempts`：

1. Node 24 拒绝 `--import` 的 Windows 绝对路径（需 file URL）；
2. freshness allowlist 未包含监督父进程预建的 `harness.log`；
3. stub 日志解析读到 JSON 之后的 trailer；
4. gameplay 双拍比较记录漏存 `input`（实际所有哈希/状态一致，两拍均 55/55 通过）；
5. 八拍全部完成后的 `buildFiles is not defined`。

第 4 次的两张 gameplay 原图与全部校验保持不变并复用；第 5 次补齐其余三机位，未重拍 gameplay，未执行第二次构建。原始失败报告与调试日志仅保留在被 git 忽略的本地输出根，不进入公开副本。

## 边界

只交真实软件渲染原图与可核证据，不宣称硬件 GPU、完整整局、真实键鼠操控、声音、手感、参照配准或画面品质判优通过。同机位双拍一致只说明当前确定性拍摄路径可复现，不等于跨硬件或跨版本稳定。

公开副本已脱敏：实际 loopback origin 以 `BASE` 占位，删除机器用户名、绝对路径、完整浏览器 argv、调试端点、原始 `pw:browser` 日志与外层进程命令行；保留 renderer/vendor/version、Chromium 完整版本、规定参数、相对文件名与哈希。实际完整 URL 与原始日志仅留本地。
