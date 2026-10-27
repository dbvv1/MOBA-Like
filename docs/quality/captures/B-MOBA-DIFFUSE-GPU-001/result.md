# B-MOBA-DIFFUSE-GPU-001 · 首塔漫反射 GPU 对比

**状态：blocked。baseline 原生命令退出 1，按卡面“任一命令非零立即停”未执行 stylized-diffuse，因此没有改后图，也不构成品质结论。**

## 来源与构建

- 固定提交：`8ac7340ca3b6148e8158e7e252f1f52edb6e5494`，拍摄时 `sourceDirty=false`。
- 一次干净构建：`npm ci`、`npx tsc -p tsconfig.capture.json`、`npm test`（52 个测试文件、365 项全过）、`npx vite build --config vite.capture.config.ts`。
- 拍摄 bundle：33 个静态文件，SHA-256 `661dc5d08290b048f7d3ff15737cb2999ac2303bb6462f17b29dca5a194abf00`；服务端字节复核通过（`served-files-verified-against-local-artifact`）。

## 预检与租约

- 启动前只读接收端 `state/*.json`：当时运行的 A-RESUME-CONTRACT-SOURCES 与 A-TESTMON-PATCH-READER 均为文本任务，任务卡无 GPU／浏览器要求；其余 MOBA 卡不在运行。无 `chrome.exe` 进程；用户 Edge 不在本任务范围。按既有元数据，本卡是当时我方唯一 GPU 任务。
- 租约根用既有共享运行根（`workRoot`），未新建任务专用根；启动前根下无 `capture.lock`／`gpu.lock`，未抢占或删除任何锁。
- 本次 run 原子取得 `capture.lock` 后拍摄；结束时 `ownerMatched=true`、`released=true`，锁已释放。

## baseline 实跑

```text
node --import tsx tools/capture.mjs --require-gpu --task-id B-MOBA-DIFFUSE-GPU-001 \
  --lease-root <既有共享运行根> --shot first-tower --seed 61 --input idle --t 101 \
  --frames 1 --repeat 2 --lighting baseline
```

- 退出码 1；`report.capturePassed=false`、`report.passed=false`。
- 原始 renderer：`ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)`；vendor `Google Inc. (NVIDIA)`；unmasked `true`；`rendererClass=gpu`。
- 两次重复的状态、机位、渲染器、光照配置一致：`stateHash=45ddcfd7f7a45536`、`virtualFrame=6060`、`simTick=3030`、`t=101`、`contentVersion=11`、camera `(-28,24,18)→(-28,0,0)`、FOV 45、1280×720。
- 失败点：第 2 次重复在 frame 0 的 RGBA 与第 1 次不同（`80f4484f…` 对 `3cca7b98…`），逐帧重复门槛不通过。这是既有像素重复问题在此提交上的再现，不是本次光照改动造成（本卡未执行改后版本）。
- 两次 PNG 均实际解码为 1280×720；逐帧 JSON 已保留。
- 未补跑、未加诊断、未修改 baseline 或阈值。

## 清理回执

- 浏览器为本进程自有 ChildProcess 句柄：PID 53328，父 runner PID 52228，`exit(code=0, signal=null)` 已由句柄观察。
- connection/server 均记录关闭；preview 端口 1872 关闭后实际拒绝连接（`listening=false`、`portState=refused`、`exitProven=true`）。
- 实际启动安全事实（来自 `ChildProcess.spawnargs`）：headless、无 `--no-sandbox`、无 `--disable-setuid-sandbox`、无 `--enable-unsafe-swiftshader`、无 `--use-angle`、Playwright bundled Chromium、无自选 executable。报告中的 `launch` 只是请求配置，不能替代这些实际 argv 事实。
- 以上仅覆盖本任务自有句柄，不外推全机进程或 GPU 已空闲。

## 未完成与恢复条件

- `--lighting stylized-diffuse` 未执行，无改后 PNG／JSON／lifecycle；before-after 同状态比较无法成立。
- 需先由代码卡使同渲染器逐帧 RGBA 可复现（旧卡 B-MOBA-HEADLESS-GPU-001 亦因此 blocked），再从同一固定干净提交重跑本卡两条命令；不得复用本次失败帧冒充通过，也不得放宽重复门槛。
- 本卡未做非作者盲判；GPU 拍摄接线与清理已实测，画面品质仍未评。

## 产物

- `manifest.json`：来源、bundle、固定参数、renderer、两次重复、失败原因、清理回执及全部归档文件 SHA-256。
- `baseline/run-8ac7340ca3b6-idle-VCcuTl/`：原 `report.json`、两次 PNG／逐帧 JSON（字节不变；源目录文件名过长，归档为 `r1-00000.*`／`r2-00000.*`，原相对名见 manifest `originalFile`）、9 个 lifecycle 事件。
