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
