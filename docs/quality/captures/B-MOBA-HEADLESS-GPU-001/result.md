# 首塔同机位 GPU 实帧（B-MOBA-HEADLESS-GPU-001）

## 结论

两个固定版本都在本机 NVIDIA GPU 上完成了真实渲染并留下了完整 run 目录，但**没有通过本卡的重复门槛**：三次 `--repeat 2` 原生拍摄都在第二次重复的首个不一致帧被 `tools/capture.mjs` 的逐帧 RGBA 断言中止，`report.json` 均为 `passed=false`。因此本单元不能按“两个完整 report 都 passed、4 张 frame16 全图齐全”交付，回 blocked。另有一个独立的基线问题：frame 16 的实际 `stateHash` 与卡面指定值不一致（见下）。

本结果只说明拍摄尝试和失败点，不是灯光盲判、画面品质或玩家手感结论。

## 版本与命令

- 改前：`baecaf56e131a9bfebbbcf1a65427c45b002b19f`；改后：`069b74bc410eec318a1effb0a05a7acc619b5bcc`。两者分别从本仓导出为独立干净 checkout，构建前后 `git status --porcelain` 为空，报告 `sourceDirty=false`。
- 每版依次执行：`npm ci` → `npx tsc -p tsconfig.capture.json` → 相关 capture 测试 → `npx vite build --config vite.capture.config.ts` → 原生拍摄命令：

```sh
node --import tsx tools/capture.mjs --shot first-tower --seed 61 --t 101 \
  --input idle --frames 20 --repeat 2 --require-gpu \
  --out outputs/B-MOBA-HEADLESS-GPU-001
```

- 测试：改前 5 个 capture 测试文件 65 项通过；改后 6 个文件 81 项通过（含 `tests/client/lighting.test.ts`）。另在改后 checkout 跑完整 `npm test`：52 个文件 348 项通过。
- 浏览器：Playwright 自带 Chromium `156.0.8078.4`（chromium-1248），headless。实际启动 argv 已从进程命令行核验：有 `--headless`、无 `--headed`、无 `--software`、无 `--use-angle`、无 `--enable-unsafe-swiftshader`；未使用 `--check-live`，未改浏览器或系统安全设置。`chromiumSandbox: true` 与 `ignoreDefaultArgs: ['--enable-unsafe-swiftshader']` 按原生脚本保留。
- renderer 原串（三次运行一致）：`ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)`；vendor `Google Inc. (NVIDIA)`；`unmasked=true`；分类 `gpu`。这只是驱动报告硬件家族，不是独立硬件认证。

## 拍摄结果

| 版本 | run | report | 第 1 次 20 帧 | 第 2 次帧数 | 首个不一致帧 | 该帧像素差异 |
|---|---|---|---|---|---|---|
| 改前 | `run-baecaf56e131-idle-3euSNi` | failed | 完整 | 1 | frame 0 | 4 像素（6 字节），最大差 5，(952–954,341)、(986,353) |
| 改前（诊断重跑） | `run-baecaf56e131-idle-9vRPTA` | failed | 完整 | 3 | frame 2 | 6 像素（9 字节），最大差 1，(960,333)、(984–986,353)、(984,354–355) |
| 改后 | `run-069b74bc410e-idle-lJOhYy` | failed | 完整 | 1 | frame 0 | 4 像素（6 字节），最大差 5，(982–983,369)、(984,354)、(986,353) |

- 不一致帧的 `stateHash`、相机、虚拟时间和分辨率两侧完全相同，差异都落在场内单位血条边缘；不是状态、机位或时间不一致。
- 诊断证据：同一页面连续两次截图逐字节相同；一个最小 WebGL 控制场景在 3 个全新页面间逐字节相同；两次独立 before 进程的第 1 次 20 帧只有 7 帧相同。这些结果指向“逐文档初始化/材质与绘制顺序在 GPU 上不稳定”，而不是截图时机或硬件不支持。未改渲染或 capture 代码去规避。
- 两次改前运行（一次正式、一次诊断重跑）都保留，未删失败记录。

## 指定比较帧与状态基线

frame 16 的实际值为：`virtualFrame=6076`、`simTick=3038`、`t=101.26666666666667`、`alpha=0`、`contentVersion=11`、`warmupFrames=12`、相机 `(-28,24,18)` → `(-28,0,0)`、FOV 45、1280×720、pixelRatio 1；这些与卡面一致。

但 `stateHash` 实际为 `4a4767ad53dba0d9`，卡面指定基线为 `019550cb1f074a83`；改前、改后三次运行都是实际值。故不能声称已复现“原软件实帧”的同一状态，也不能把本批 GPU 图与那组基线直接当作同状态比较。

当前能解码的 frame 16 全图为 3 张（两次改前第 1 次、一次改后第 1 次），尺寸均 1280×720；第二次重复都在 frame 16 之前中止，所以第 4 张不存在。

## 产物与可复核项

- `before/`、`after/` 下每个 run 目录保留 `report.json`、全部 PNG 与逐帧 JSON；每个 run 根另有本单元生成的 `manifest.json`。
- 原生逐帧目录名包含 renderer 的 63 字符安全缩写与原串的 10 字符哈希（完整原串见 `manifest.renderer.raw` 与逐帧 JSON 的 `renderer` 字段），收集到本路径后超过 Windows 260 字符限制、Git 无法索引；交付时缩短为 `frames-r1` / `frames-r2`。原生目录名保存在 `manifest.frameDirectories`，逐帧 JSON 的 `file` 字段保持原生相对路径（用 `manifest.frames[].originalFile` 对照）；PNG 与逐帧 JSON 字节未改。`report.json` 的 `shots[].file` 同样保留原生路径。
- `manifest.json` 记录来源 SHA、bundle 摘要、每个相对文件的 SHA-256、shot/seed/input/请求时间与实际时间/frame/virtualFrame/simTick/stateHash/camera/viewport，以及 renderer 原串、vendor、version、unmasked、`rendererClass` 与同值 `class`。原三分法按实际记录保留。
- 对交付目录的独立校验：3 个 run、全部文件哈希与 manifest 引用一致，所有 PNG 可解码且为 1280×720，跨 run 同一 renderer 与浏览器版本，`class` 全部为 `gpu`、`unmasked=true`；`report.passed` 全部为 false。三个 manifest 的 `frames[]` 中 `frame=16` 记录的 `stateHash` 均为 `4a4767ad53dba0d9`。
- 唯一的内容改动：`report.json` 错误栈中的本机绝对 checkout 路径替换为 `<capture-checkout>`；PNG 字节未改动，失败记录未删除、未重标。

## 未执行 / 未验证

- 未运行含 `page.mouse` / `page.keyboard` 的固定版 `npm run smoke`；本卡明确不运行、不改写，完整 smoke 缺口保留。
- 未改灯光、玩法、默认入口、网站、接收端脚本或计划任务；未做灯光盲判、品质或手感结论。
- 未提交、未推送；由接收端按任务状态处理。

## 恢复条件

1. 让每次重复的逐文档初始化与绘制顺序可复现（例如固定资源/材质创建顺序，或每次重复使用可复现的独立初始化），使原生 `--repeat 2` 的 20 帧逐帧 RGBA 相等。这需要改 capture 工具或渲染初始化，超出本卡“只补拍摄证据”的范围，应另派代码卡。
2. 核对 frame 16 的 `stateHash` 基线：卡面 `019550cb1f074a83` 与当前两个固定版本的 `4a4767ad53dba0d9` 来源不同，需要确认比较对象或更新基线。
3. 上述任一项未解决前不重复空跑；解决后按原文命令重跑 before → after。

## 安全回执（补充）

本节只读复核既有任务元数据、会话工具记录、运行目录中的 wrapper／DEBUG／result 记录和接收端 `execution.json` 后补写；复核时刻为 `2026-10-27T18:42:08Z`，最后复查 `2026-10-27T18:44:38Z`（当前检查，不作为历史证据）。未启动浏览器、未调用 GPU、未重拍、未模拟键鼠、未改代码，未删除任何旧记录。拍摄复现失败与进程／锁退出分别判定，本节不改变原 blocked 结论。

### 1. UTC 顺序：领取、预检、浏览器启动与结束

| UTC | 事项 | 依据 |
|---|---|---|
| 17:14:34.872Z | 接收端领取（claim，ready） | 接收端日志 |
| 17:15:03.268Z | 派发单元 1（dispatch，PID 83692） | 接收端日志；`execution.startedAt` 17:15:03.352Z |
| 17:15:15–17:18:09 | 只读预检：任务元数据、GPU 相关卡状态、运行根锁、进程与视频控制器 | 会话工具记录 |
| 17:19:33.578Z | 预检探针 #1 命令开始 | 会话工具记录 |
| 17:19:36.536Z | 预检锁创建；owner PID 12676，进程启动 17:19:33.941Z | 当时 `owner.json`（已随锁删除，内容由会话记录保留） |
| 17:19:43.722Z | 预检探针 #1 进程以 exit 1 结束：finally 中 `browser.process()` TypeError，未写 `probe-result.json`、未执行 `lock.release()`；浏览器已启动但 PID／退出未记录 | 会话工具记录 |
| 17:19:51.047Z | 复核 owner PID 12676 已不存在 | tasklist／Get-Process 输出 |
| 17:19:58.078Z | 释放预检锁 | 一次性释放脚本输出 |
| 17:20:07.341Z–17:20:28.125Z | 预检探针 #2（成功；浏览器 PID 见 §4） | 会话工具记录、`probe-result.json` |
| 17:21:33.566Z | 改前拍摄 wrapper 开始 | 会话工具记录 |
| 17:21:44.968Z（`<launching>`） | 改前浏览器启动；主进程 PID 45132 | `DEBUG=pw:browser`：`<launched> pid=45132` 17:21:45.128Z |
| 17:22:12.134Z | 改前浏览器退出，`exitCode=0`，`signal=null` | `DEBUG=pw:browser` |
| 17:22:20.701Z | wrapper 结果落盘（锁已释放） | `capture-wrapper-before.json` |
| 17:23:02.501Z | 改前诊断重跑 wrapper 开始 | 会话工具记录 |
| 17:23:11.771Z（`<launching>`） | 浏览器启动；主进程 PID 88460 | `DEBUG`：`<launched> pid=88460` 17:23:11.876Z |
| 17:23:35.726Z | 浏览器退出，`exitCode=0` | `DEBUG=pw:browser` |
| 17:23:42.902Z | wrapper 结果落盘（锁已释放） | `capture-wrapper-before2.json` |
| 17:25:08.077Z | blob 诊断第 1 次：静态 import `pngjs` 失败，未取得锁、未启动浏览器 | 会话工具记录 |
| 17:25:13.912Z–17:25:44.830Z | blob 诊断第 2 次（浏览器 + preview；无 PID／退出记录） | `probe-blob-result.json` |
| 17:26:26.203Z–17:26:57.554Z | early 诊断第 1 次（控制台输出保留；JSON 结果文件随后被第 2 次覆盖） | 会话工具记录、结果输出 |
| 17:27:18.850Z–17:27:49.611Z | early 诊断第 2 次（无 PID／退出记录） | `probe-early-result.json` |
| 17:28:26.775Z–17:28:45.860Z | minimal WebGL 诊断（无 PID／退出记录） | `probe-minimal-webgl.json` |
| 17:29:17.983Z–17:29:47.029Z | context 诊断（无 PID／退出记录） | `probe-contexts-result.json` |
| 17:30:54.857Z | 改后拍摄 wrapper 开始 | 会话工具记录 |
| 17:31:06.537Z（`<launching>`） | 浏览器启动；主进程 PID 57576 | `DEBUG`：`<launched> pid=57576` 17:31:06.678Z |
| 17:31:35.409Z | 浏览器退出，`exitCode=0` | `DEBUG=pw:browser` |
| 17:31:44.238Z | wrapper 结果落盘（锁已释放） | `capture-wrapper-after.json` |
| 17:37:44.209Z | 收尾进程检查：全机 chrome=0；无 capture／vite node；运行根无 gpu.lock | 会话工具记录 |
| 18:05:41.983Z | 单元会话结束；`execution.json` 登记子树 1312 个进程均为 exited | `execution.json` |
| 18:08:40.792Z | 接收端将单元标为 blocked | 接收端日志 |
| 18:42:08Z、18:44:38Z | 本次复核的当前检查：chrome=0、capture／vite node=0、无 gpu.lock | 只读进程／目录检查 |

三次拍摄的浏览器启动时刻取自 `DEBUG=pw:browser` 的 `<launching>` 行，主 PID 与启动确认见同次 `<launched>` 行，退出来自 `<process did exit>` 行（表中 17:21:44.968Z、17:23:11.771Z、17:31:06.537Z 为 `<launching>` 时刻，对应 `<launched>` 时刻分别为 17:21:45.128Z、17:23:11.876Z、17:31:06.678Z）；其余诊断没有等价的 DEBUG 行，只有命令起止与结果输出／落盘时间，不能当成逐次浏览器启动／退出时间。

诊断目的：before 第二次重跑用于检验逐帧重复差异是否可复现；blob 比较 canvas `toBlob` 与元素截图；early 检查早期帧和同页连续截图；minimal 用最小 WebGL 场景检查跨页面确定性；context 比较两次独立新建 context 的页面（每次新建 context、各一页）。这些只服务失败定位，不是新的拍摄门槛或品质结论。

### 2. “唯一我方 GPU 任务”预检与任务级锁

- 17:15:27 读取接收端 `state/*.json`：当时 running 的 A-CI-PROJECTION-READER 与 B-GENRE-REFERENCE 在各自卡面明确“无 GPU／不打开浏览器”；B-MOBA-CLIENT-SMOKE 任务卡 status 为 cancelled，接收端 state 为 idle（attempt 1，retryNote 为 termination_unconfirmed，未在运行）；B-CASE-GPU-BASELINE、B-FPS-SHOT-QUALITY、B-SR-DRIVING-COMPARISON、B-STAR-RUSH-SMOKE 等旧游戏卡为 cancelled。按这份只读元数据与卡面声明，本卡是当时我方唯一 GPU 卡；领取／派发标签本身不作为运行状态证据。
- 17:17:37–17:18:01 定向检索接收端脚本与运行根：未发现现成的共享 GPU 互斥入口；运行根下没有 lock／mutex 目录；17:18:09 tasklist 未见 chrome／chromium。接收端脚本里只有自身的 `receiver.lock`（调度 tick 用），没有 GPU 锁入口。
- 因此按任务第 2 条，在接收端已知、各重试实例共享的本卡运行根使用**任务级锁**：`<runs>/B-MOBA-HEADLESS-GPU-001/gpu.lock`，`mkdir` 原子创建，`owner.json` 以 `wx` 写入 task、purpose、pid、processStartIdentity、48 位十六进制随机 owner token、createdAt；release 读取 `owner.json`，比较 token 后递归删除，token 不符即拒绝。该锁只保护本卡的 headless GPU 使用，不冒充跨任务全局调度。
- 只有预检探针 #1 的 owner 记录被会话输出保留：PID 12676、进程启动 17:19:33.941Z、createdAt 17:19:36.536Z、purpose 为预检探针。17:19:51 复核该 PID 已不存在后，17:19:58 用一次性 `release-own-probe` 脚本释放。该脚本读取 owner、校验 PID 不存在和 48 位 token 形状后 `rm`；**没有用单独持有值做 token 相等比较**，所以这一次的 owner-token 匹配只能算部分证明。
- 后续拍摄与诊断都走 `lock.release(ownerToken)`，token 不符会抛错；各 wrapper 与 blob／early／minimal／context 诊断 result 的 `lockReleased=true` 证明释放时 token 比较通过；预检 #2 的 `probe-result.json` 字段为 `lockRelease=true`。但这些 `owner.json` 已删除，**这些锁的 owner PID、进程启动身份和 createdAt 没有保留**，不能事后补造。
- 17:37:44 与 18:42:08、18:44:38 三次只读检查运行根均无 `gpu.lock`；没有抢锁、覆盖或回收不明旧锁，也未改接收端配置。

### 3. 实际 argv 的安全相关 flags

- 报告里的 `launch` 是**请求配置**（`headless: true`、`chromiumSandbox: true`、`ignoreDefaultArgs` 移除 `--enable-unsafe-swiftshader`、`channel: chromium`、无 `executablePath`），不是实际 argv 证据。
- 三次拍摄 wrapper 用 Win32_Process 轮询抓到的**实际 argv**（只保留结论，不上传完整命令行）：`--headless` 存在；`--no-sandbox`、`--disable-setuid-sandbox`、`--enable-unsafe-swiftshader`、`--use-angle`、`--headed`、`--software` 均不存在；`unsafeSwiftshader=false`；未使用自选 executable，实际可执行文件是 Playwright 自带的 chromium-1248 `chrome.exe`；user-data-dir 在本次私有运行空间内且每次不同。
- 三份 wrapper 的 `ownPidsBefore` 均为空，`ownPidsSeen` 分别为 10／12／10，`ownPidsRemaining` 均为空，`lockSafeToRelease=true`、`lockReleased=true`；`childExitCode=1` 是逐帧断言导致的拍摄子进程退出码，不是浏览器异常退出（浏览器均为 `exitCode=0`）。
- 预检探针 #2 的 `hasUnsafeSwiftshader=false`，实际 argv 同样无上述不安全 flag。
- 边界：argv 是进程轮询样本，不是完整命令行存档；`chromiumSandbox: true` 是启动请求，实际 argv 只是“没有 sandbox 禁用 flag”，不等于独立的 OS 沙箱状态认证。

### 4. 自有 browser／preview 链的退出复核

| 活动 | 记录的 PID／启动／退出 | 退出后检查 | 锁 | 判定 |
|---|---|---|---|---|
| 改前 `3euSNi` | 主 PID 45132；启动 17:21:44.968Z（进程创建 17:21:44.974Z）；退出 17:22:12.134Z，`exitCode=0` | `ownPidsRemaining=[]`；17:37:44 全机 chrome=0 | released，`lockSafeToRelease=true` | 已退出（直接） |
| 改前诊断 `9vRPTA` | 主 PID 88460；启动 17:23:11.771Z（进程创建 17:23:11.775Z）；退出 17:23:35.726Z，`exitCode=0` | `ownPidsRemaining=[]`；17:37:44 全机 chrome=0 | released | 已退出（直接） |
| 改后 `lJOhYy` | 主 PID 57576；DEBUG `<launching>` 17:31:06.537Z（`<launched>` 17:31:06.678Z）；退出 17:31:35.409Z，`exitCode=0` | `ownPidsRemaining=[]`；17:37:44 全机 chrome=0 | released | 已退出（直接） |
| 预检 #2 | 主 PID 65196，子进程 28104／86128／58492／70636；启动／退出 UTC 未记录 | `remainingOwnPids=[]`、`allExitObserved=true` | `lockRelease=true` | 已退出（进程清单直接，时间未知） |
| 预检 #1 | owner node PID 12676，启动 17:19:33.941Z；浏览器 PID 未记录；进程 17:19:43.722Z 以 exit 1 结束 | owner 17:19:51 已不存在；`browser.close()` 已尝试但退出结果未记录，无退出后检查 | 17:19:58 一次性脚本释放 | owner 已退出；browser 未证明 |
| blob 诊断 #2 | 无浏览器 PID／启动／退出记录（命令起止见 §1） | 无 | `lockReleased=true` | 未证明 |
| early 诊断 #1 | 无浏览器 PID／启动／退出记录（命令起止见 §1）；JSON 结果文件被第 2 次覆盖 | 无 | `lockReleased=true`（控制台输出保留；JSON 结果文件被第 2 次覆盖） | 未证明 |
| early 诊断 #2 | 无浏览器 PID／启动／退出记录（命令起止见 §1） | 无 | `lockReleased=true` | 未证明 |
| minimal 诊断 | 无浏览器 PID／启动／退出记录（命令起止见 §1） | 无 | `lockReleased=true` | 未证明 |
| context 诊断 | 无浏览器 PID／启动／退出记录（命令起止见 §1） | 无 | `lockReleased=true` | 未证明 |

- 父子关联：预检 #2 记录主 PID 65196 的 parent 56580（探针 node）和子进程 28104／86128／58492／70636 的 parent=65196；三次拍摄的记录只保留 fresh PID 列表与 DEBUG 主 PID，未保存 ParentProcessId，父子关系只能由 Playwright `<launched>` 主 PID 与 wrapper 的 fresh 集合推定，不能逐条列出。
- 改后的 `execution.json` 登记里有 PID 57576，但创建时间为 17:32:11.636Z，晚于该浏览器退出（17:31:35.409Z），不能归为同一进程（PID 复用或登记对象不同，记录不足以判断）；预检 #2 的 65196／58492 登记创建时间也在 17:39／17:40Z，同样不是当时的探针进程。这两项的退出以 DEBUG／wrapper／探针自身的进程清单为准，不用登记表补证。
- preview：三次拍摄与 blob／early／context 诊断都经 `vite preview` 绑定 127.0.0.1 临时端口；**端口没有记录**。`tools/capture.mjs` 的子进程已退出（其 finally 关闭 server 未报 `Cleanup failed`），17:37:44 与 18:42:08／18:44:38 也未发现 capture／vite node；但没有按端口复查监听，所以“监听消失／是否被接管”只能算间接，未直接证明；也没有发现被接管的记录。
- 归属：wrapper 在启动前快照全机 chrome，`ownPidsBefore=[]`，只把随后新增的 PID 归为本进程；预检探针用启动后的实时进程清单。用户自己的 Edge、桌面和其他任务不在本次排除或清理范围，也没有被停止。
- 本单元没有按进程名或浏览器类型批杀任何对象；记录中没有额外的 kill 命令。17:37:44 的全机 chrome=0 和 `execution.json` 的 1312 个登记进程全部 exited（18:05:41.979Z）是收尾证据，但不能替代逐次释放锁前的检查。

### 5. 结论与缺口

- **状态口径**：已退出＝有直接退出证据；仍存活＝当前检查发现；未知＝释放锁时缺独立退出或监听证据。按此口径：三次拍摄已退出；预检 #2 已退出；预检 #1 的 owner 已退出、浏览器未知；blob／early／minimal／context 的诊断链未知；当前检查（18:42:08Z、18:44:38Z）未见仍存活的 chrome 进程或 capture／vite node。
- **拍摄复现**：仍失败。三次 `report.passed=false`，只有 3 张 frame16 全图，第 4 张因第二次重复提前中止不存在；不因本回执升级为品质通过。
- **安全退出（已证明部分）**：三次拍摄的浏览器主进程有 DEBUG 直接退出证据（`exitCode=0`）和 wrapper `ownPidsRemaining=[]`；预检 #2 有进程清单剩余为空的证据；预检 #1 的 owner 进程已退出。全机在 17:37:44、18:42:08 与 18:44:38 均未见 chrome 进程或 capture／vite node，运行根无任务锁；未单独检查其他 GPU 进程／GPU 占用。
- **仍未知／缺证**：blob、early（两次）、minimal、context 四类诊断的浏览器／预览退出没有被当时的独立进程或监听检查证明；所有 preview 的临时端口没有记录，无法复核“监听消失／被接管”；除预检 #1 外，拍摄与其余诊断锁的 owner PID／启动身份未保留；预检锁释放未做持有 token 相等比较；`execution.json` 中改后浏览器 PID 与预检 #2 PID 的创建时间与运行记录不符，登记表不能作为这两项的退出证据。
- **判定**：当前未发现本任务自有的存活 browser／preview 进程或任务锁，也未单独检查其他 GPU 进程／GPU 占用；但按“缺证保持 blocked”的要求，不能把安全退出写成全部已证明，整体仍随拍摄失败保持 blocked。未新建 GPU 调用，未重拍，未改代码。
- **闭合缺口需要**：下次执行在运行根保留每次活动的 owner PID／启动身份／token 校验结果、浏览器 PID／启动／退出 UTC、preview 端口与关闭结果、退出后进程与监听复查；不得事后补造时间，也不得把本次当前检查当作当时证据。
