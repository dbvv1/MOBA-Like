# B-MOBA-DIFFUSE-GPU-001 revision-3f89df2 · 首塔漫反射 GPU 对比

**状态：blocked。新源码上的 baseline 原生命令退出 1，按卡面“任一命令非零立即停”未执行 stylized-diffuse。没有改后图，也没有 before-after 或品质结论。**

## 来源与构建

- 新固定提交：`3f89df2bcfcaca1dde86cc1412d1649090a09d60`，tree `66207211aa8cf9ca178ec5f08ca1fe7658e268a2`，拍摄时 `sourceDirty=false`、工作树干净。
- 该提交只固定并行下载后的跨资产 GLB 构造顺序；本卡不评其原因或修复，只做受控实跑。
- 构建在原生忽略目录中的干净 detached checkout 完成，结果分支工作树源码未改动；旧 `7968512` 归档文件逐字节保留。
- 一次干净构建：`npm ci`（81 packages）、`npx tsc -p tsconfig.capture.json`（退出 0）、`npm test`（53 个测试文件、373 项全过）、`npx vite build --config vite.capture.config.ts`（退出 0）。
- 拍摄 bundle：33 个静态文件，SHA-256 `0c339a1a19c96e5800c883fcb0a1731e83014cf773dcab80487c20ebbb8a7c28`；开始前对 33 个静态文件的服务端字节复核通过（`served-files-verified-against-local-artifact`）。第 2 次重复在 frame 0 断言失败（`tools/capture.mjs` 的逐帧 RGBA 比较）后异常进入 catch，结束复核与构建未变更断言均未执行；该绑定只证明开始前复核。

## 预检与租约

- 启动前只读接收端 `state/*.json`：同时运行的 A-RESUME-CONTRACT-SOURCES-20261028 为 explore 文本任务且任务卡写明“无 GPU”；B-MOBA-CLIENT-SMOKE-001 已 cancelled（本机图形验证已撤销）；本卡是当时我方唯一 GPU 任务。
- 既有共享运行根下无 `capture.lock`／`gpu.lock`；未新建任务专用根，未抢占或删除任何锁。
- 启动前本机无 `chrome.exe`；用户 Edge 进程未停止、未操作。以上只覆盖我方任务元数据与本卡自有调用，不外推全机 GPU 空闲。
- 本次 run 原子取得 `capture.lock`，结束时 `ownerMatched=true`、`released=true`，锁已释放。

## baseline 实跑

```text
node --import tsx tools/capture.mjs --require-gpu --task-id B-MOBA-DIFFUSE-GPU-001 \
  --lease-root <既有共享运行根> --shot first-tower --seed 61 --input idle --t 101 \
  --frames 1 --repeat 2 --lighting baseline
```

- 退出码 1；`report.capturePassed=false`、`report.passed=false`。
- runId：`run-3f89df2bcfca-idle-gtjcpZ`；lease owner PID 94800，`runtimeStartedAt=2026-10-27T23:22:15.392Z`、`createdAt=2026-10-27T23:22:17.755Z`。
- 原始 renderer：`ANGLE (NVIDIA, NVIDIA GeForce RTX 5070 (0x00002F04) Direct3D11 vs_5_0 ps_5_0, D3D11)`；vendor `Google Inc. (NVIDIA)`；unmasked `true`；`rendererClass=gpu`；浏览器 `156.0.8078.4`。
- 两次重复的状态、机位、视口、renderer 与光照配置一致：`stateHash=45ddcfd7f7a45536`、`virtualFrame=6060`、`simTick=3030`、`t=101`、camera `(-28,24,18)→(-28,0,0)`、FOV 45、1280×720（buffer 1280×720、pixelRatio 1）、`lighting.active=baseline`。
- 失败点：第 2 次重复在 frame 0 的 RGBA 与第 1 次不同（`384f3cd2…` 对 `f896e602…`），逐帧重复门槛不通过。这是同一渲染器上在此提交再现的像素重复问题；本卡未执行改后版本，因此不判断它与光照候选的关系。
- 两次 PNG 均实际解码为 1280×720；逐帧 JSON、report 与 9 个 lifecycle 事件已保留。控制台只有两条既有的 `PCFSoftShadowMap has been removed` 警告，不是本次失败点。
- 未补跑、未加诊断、未修改 baseline 或阈值。

## 清理回执

- 浏览器为本进程自有 ChildProcess 句柄：PID 84524，父 runner PID 94800，`exit(code=0, signal=null)` 已由句柄观察。
- connection/server 均记录关闭；preview 端口 5293 关闭后实际拒绝连接（`listening=false`、`portState=refused`、`exitProven=true`）。
- 实际启动安全事实（来自 `ChildProcess.spawnargs`）：headless、无 `--no-sandbox`、无 `--disable-setuid-sandbox`、无 `--enable-unsafe-swiftshader`、无 `--use-angle`、Playwright bundled Chromium、无自选 executable。报告中的 `launch` 只是请求配置，不能替代这些实际 argv 事实。
- `lease.released=true`、`ownerMatched=true`。以上仅覆盖本任务自有句柄，不外推全机进程退出或 GPU 已空闲。

## 未完成与恢复条件

- `--lighting stylized-diffuse` 未执行，无改后 PNG／JSON／lifecycle；before-after 同状态比较无法成立，画面品质未评。
- 按卡面要求不补跑、不诊断、不调阈值。条件化恢复路径：
  1. 先由代码卡（新开卡或既有代码卡，且该卡确实修改导致重复的源码，不只是补回执的拍摄卡）使同一渲染器逐帧 RGBA 可复现；旧卡 B-MOBA-HEADLESS-GPU-001 只是同因 blocked 的拍摄卡，修复完成后再按下一固定干净提交重拍，不能承担源码修复。修复落在构建源码按第 2 条，只在拍摄工具按第 3 条。
  2. 若修复改到构建源码：从包含修复的下一固定干净提交（下一轮 `base_ref`，取代码卡产生的固定干净提交，而非 `3f89df2`）重建一次，再重跑本卡两条命令并重做证据归档。
  3. 若修复只在拍摄工具：以含修复的提交作为下一轮唯一干净 `base_ref`，从该提交做一次构建并运行两条命令；因 `capture.js` 内联 `sourceCommit`，bundle 哈希必然不同于 `3f89df2` 的 `0c339a1a…`，这是预期的，只要 before/after 共用这一次构建即满足同 source/tree/bundle，manifest 记录 `sourceCommit` 为该修复提交及其新 bundle 哈希，不声称构建源仍是 `3f89df2`，也不用跨 checkout 的 runner。只有在先改工具（增加独立 build-source 字段并放宽 `verifyCaptureSource` 的等值要求）之后，才允许分开记录构建源与 runner 源，并注明这是工具改动的一部分。
- `3f89df2` 只作为本轮受测源，不作为下一次重跑的默认源码。
- 旧 `7968512` 的 blocked 结论与其缺失的第 1 次 owner 比较保持原样，不补造；本卡仍为 blocked。
- 本次结果交 dot-B 判断；不预报新 GPU 通过，也不据此判品质。

## 产物

- `manifest.json`：来源、tree、bundle、固定参数、renderer、两次重复、失败原因、清理回执及全部归档文件 SHA-256。
- `baseline/run-3f89df2bcfca-idle-gtjcpZ/`：原 `report.json`、两次 PNG／逐帧 JSON（字节不变；源目录文件名过长，归档为 `r1-00000.*`／`r2-00000.*`，原相对名见 manifest `originalFile`）、9 个 lifecycle 事件。
- 本目录只新增 revision-3f89df2 证据；旧 `baseline/run-8ac7340ca3b6-idle-VCcuTl/`、原 `manifest.json` 与 `result.md` 未改动。
