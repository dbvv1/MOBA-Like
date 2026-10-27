# 出生地到首塔：可重复拍摄入口

**用独立 `capture.html` 拍同状态环境，再比较整层改动。** 此入口复用候选的真实地图、资产、模拟与渲染，不替换材质，不将工具通过当成画面品质完成。普通游戏入口、存档、玩家控制和公开网站不变。

## 云端普通 UI 操作（无需 DevTools）

用固定、干净提交构建 `npx vite build --config vite.capture.config.ts`，由 HTTPS 或 localhost 提供（需要 Web Crypto），在 **dot 云端浏览器** 打开该构建的：

```text
capture.html?shot=first-tower&seed=61&t=101&input=idle&frames=20
```

首次验证可把 `t=101` 换成 `t=10`，但开始后在同一页完成，不为了每一帧重新导航。按顺序：

1. 等顶部阶段经过构建文件核对、导航、WebGL 场景/资源、虚拟预推进、渲染预热，最后显示“准备就绪 · 帧 0/19”。虚拟进度每 60 帧更新；预热不推进虚拟时间。失败显示具体错误并停止，不能把停在某阶段直接归因为 GPU 或后台节流。
2. 点 **下一帧**：应变成 `1/19`；点 **前进 15 帧**：应变成 `16/19`。两者逐个调用同一 `__shotNext(frame)` 合同。批次忙时按钮禁用，旧确认报错；剩余不足 15 帧只走到末帧，显示 `done`，推进按钮禁用，保存仍可用。默认 `frames=1` 只有静帧，需在开始 URL 显式给足帧数。
3. 点 **保存当前 PNG 与元数据**：生成同名 PNG / JSON 并请求下载。若浏览器拦截多文件自动下载，直接点下方 **下载 PNG**、**下载元数据 JSON**，不必改浏览器安全设置。网页只报告“已生成”，不冒充已写入磁盘；收到两文件后仍须核对 PNG 尺寸、JSON 帧号、`pngSha256`、source / bundle / renderer。
4. JSON 包含完整构建文件清单及摘要、原始 renderer、当前状态/机位、虚拟时间、PNG SHA-256 和唯一 runId。文件名含 renderer 类别/安全短名/原串哈希、seed、input、虚拟帧、序列帧和源提交；同页再次保存会增加序号。页面下载链接保留到下一次保存或离开页面。旧链接旁标明旧帧，前进不会偷偷替换它。
5. 点 **返回普通游戏** 或 Escape 退出；pagehide、context loss、准备失败会终止后续工作、释放导航/渲染器、关闭等待端口并回收下载 URL。普通游戏没有此控制台。

PNG 直接来自实际 `world.canvas`，绘图缓冲必须为 **1280×720**。导出在同一任务内依次 `renderOnly()` → 读取并深拷贝该帧元数据 → `canvas.toBlob('image/png')` 发起位图复制，中间没有 await；没有调用 `draw/next`、推进模拟、复制窗口截图或用 2D 重绘。编码期间所有逐帧确认被锁住，null/安全异常/取消不输出假成功。画布 CSS 同样固定 1280×720，窄窗口可滚动查看，避免旧 canvas 截图消费者受页面滚动条挤压而缩图。

独立构建额外生成 `capture-bundle.json`：它记录排除自身的全部静态文件 SHA-256（避免自引用），与 CLI 的 `captureBundleIdentity` 规则一致。页面核 source 标记、当前入口模块路径和清单的实际服务字节；缺失、重定向、不一致则失败。此校验不是信任根/数字签名，也不是 GPU 或像素重复认证；接收方仍须对照交付的固定提交与 bundle 摘要。未生成该清单的普通 Vite 开发入口不用于此取证路径。

协作等待改为可取消的 MessageChannel task，避免依赖嵌套零时延 timer；虚拟步数、顺序及最终模拟状态不变。它只是调度选择，**没有证据表明它修复了此前无响应，也不保证后台/软件渲染一定完成**。相关官方原文：[HTML toBlob 算法](https://html.spec.whatwg.org/multipage/canvas.html#dom-canvas-toblob)、[WebGL drawing buffer](https://registry.khronos.org/webgl/specs/latest/1.0/#2.2)、[MDN MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel)。

## 命令行消费者（仅在环境许可时）

```sh
npm ci
npx tsc -p tsconfig.capture.json
npm test
npm run build:web
npx vite build --config vite.capture.config.ts
node --import tsx tools/capture.mjs --require-gpu --check-live
```

最后一条启动本地预览、四个机位各拍两次，要求同一 renderer 的 RGBA、模拟哈希、相机和虚拟时刻完全相同，并实际点退出、验证普通入口推进和右键移动。默认使用 Playwright 的 Chromium；已安装的受信浏览器可用绝对路径环境变量 `MOBA_CAPTURE_CHROMIUM` 显式指定。启动失败不更换二进制、不关闭浏览器 sandbox。真实 GPU 仍须读原始 renderer；`gpu` 仅表示驱动报告了硬件家族，不是独立硬件认证。

软件环境可显式加 `--software` 并去掉 `--require-gpu`，用来查构图和回归，不用于灯光或材质定稿。`unknown` 不是 GPU；`--require-gpu` 会拒绝未知、软件或只有 masked renderer 的报告。

构建产物在 `outputs/capture-build/`，不是普通 `web-dist/`，**不部署此拍摄构建来替代玩家版本**。独立配置继承正式 Vite 的资产规则与插件，额外加入 capture 入口；后续正式配置变化也要复验该构建。网页元数据记录构建时的提交与脏树标记，消费者核对当前提交；可交接证据必须从固定、干净提交重建，脏树只供开发。

## 四个机位

固定 1280×720、pixel ratio 1。三个近景沿用当前游戏 45° 镜头，机位不是对 LoL 构图已达标的声称；实际画幅仍须首次浏览器出图后检查。

| `shot` | 用途 | 位置 / 看向（x, y, z） |
|---|---|---|
| `gameplay` | 正常锁定角色镜头，观察沿路尺度 | 跟随角色，24 米高、z 后移 18；45° |
| `spawn` | 基地、出生地与兵营过渡 | (-94, 24, 19.2) / (-94, 0, 1.2)；45° |
| `first-tower` | 己方外塔、通路与路肩 | (-28, 24, 18) / (-28, 0, 0)；45° |
| `spawn-to-tower` | 最大差距总览：出生地—内塔—外塔的完整环境 | (-65, 62, 46.5) / (-65, 0, 0)；45° |

`first-tower` 在这里明确指己方外塔，不是敌方第一座塔。正常视角和总览应同时保留，不能只凭远景看不见细节就判品质提高。

## 请求与逐帧合同

专用静态构建可打开 `capture.html?shot=spawn&seed=1&t=10&input=march`。没有 `shot`、名称错误、重复参数或越界数字会停止并显示错误，不默默换机位。

- `seed`：0–4294967295，默认 1。当前版本 11、Veyra 对 Veyra、普通对手 AI 及其 seed 1002 与该候选普通客户端一致。
- `t`：0–120 秒，默认 10，四舍五入到最近 1/60 秒；同时报告请求时间、实际虚拟时间、逻辑 tick 和插值 `alpha`。
- `input=idle|march`：默认 `march`，仅在第一逻辑步通过普通 `move` 命令前往 (-18, 1.2)。不瞬移、不改血量、不使用拍摄专用规则；不证明真实玩家键鼠操控。
- `frames`：1–3600，默认 1。从 t 开始，每次确认推进 1/60 秒。调用 `window.__shotNext(frame)`，旧确认报错，最后一帧返回 false，不再推进。

入口不启动 rAF、声音或玩家控制器。预推进每个 1/60 秒都调用真实视觉更新，逻辑每 1/30 秒逐步取快照与事件；为加快离线拍摄，预推进不提交 GPU draw。到目标状态后仅渲染 12 帧，不推进模拟、动作、反馈或相机。该方式适用于当前没有时间累积后处理的渲染器；以后加入 TAA/自动曝光等时间历史时，须补历史收敛/运动历史测试，不能直接沿用旧像素证明。

`window.__shot.ready` 在 GPU 完成当前帧后置 true。元数据含原始 renderer/vendor/version、分类、分辨率、相机、状态哈希、draw calls/三角形/资源计数。文件名含分类、renderer 的安全缩写与原串哈希；完整原串在逐帧 JSON，不把 unknown 改写成 gpu。音频不捕获，画面保留场内血条但没有玩家 HUD。

```sh
# 同一输入带录 120 帧；每帧由消费者确认后才继续
node --import tsx tools/capture.mjs --shot gameplay --t 10 --frames 120 --repeat 2 --require-gpu
```

`--out` 指定归档父目录，默认 `outputs/capture/`。**每次调用原子创建新的 `run-<源版本>-<input>-<随机标识>/`**，终端打印 `MOBA_CAPTURE_RUN`；图片、逐帧 JSON、该次 `report.json` 全部写进这个新目录。相同参数、并发运行、从长序列改成短序列也不会覆盖前一轮或留下旧尾帧；同一 run 内的重复文件直接报错，不覆盖。逐帧与报告保留 runId、源版本、input、bundle SHA-256，报告还保存实际静态文件清单。

本地和 `--base` 外部入口都要求先准备当前固定 checkout 的 `outputs/capture-build`：开始与结束逐文件核对服务返回的字节哈希，拒绝缺文件、重定向、未知或不一致的 bundle；页面还必须报告相同的 sourceCommit/脏树状态，否则失败。只读服务端版本标签不能通过验收。结束时也检查本地构建没有被同时改写。`--repeat 1` 只拍一遍，报告明确不做重复比较。

只比较同一分辨率、状态、机位和 renderer 类别；每轮先看完整环境与正常视角，再把改前、改后、目标图并排交非作者判断。Escape 或页面顶部“返回普通游戏”返回普通游戏并释放拍摄资源。

## 当前验证边界

CPU 检查覆盖真实模拟/导航的确定性与进度回调、每 tick 消费、静态预热、1/15 帧确认与末帧、stale/重复点击、导出 bitmap-copy 调用顺序和同帧元数据、bundle 路径/字节校验、取消及资源释放。按钮测试用 DOM/renderer doubles，不是实际 WebGL 像素证据。

本次控制台实现没有运行浏览器，真实云端按钮与下载仍须随后验证；不重试被拒的 exec Chromium/socket，不以用户本机 GUI 回退。此前已取得的云端软件 WebGL 帧不等于本次按钮通过；后续导航无响应的原因仍未确定。硬件 GPU、重复像素、画面品质、玩家操控与声音均不由本单元声称通过。
