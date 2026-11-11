# 镜头＋Q/W 旁置验收（单份结论）

## 范围与当前结论

基于 main `dea84c4` 整合 `7a2234e7`，保留 v12 前摇及单槽下一指令；不改模拟、数值、导航或内容。默认首页仍为 v11＋forest lighting，只增加旁置链接与渲染失败恢复。此单元的 **CPU／构建与最小浏览器门槛已通过，可旁置发布；未据此换默认**。真实镜头手感、Q/W 分辨／遮蔽、同机位与盲评尚未完成。

## 旁置数量

保守按三个待完整验收单元管理：quiet 材质（替代已退役的 `lighting=stylized-diffuse`）；`commands=buffer-v1`；本次镜头＋Q/W 整合。整合取代原独立 critical 音频候选；camera/audio 的四路参数只是同一单元隔离对照，不是另开候选。forest lighting 已是默认，baseline 与 legacy-v10 是历史对照，不新增候选。不得再叠加第四个未经完整验收的单元。

## 可复验门槛

- 本轮明确规定 **从 ready 开始实际前进至少 300 tick（30Hz，10秒模拟时间）**。这是本轮最小门槛，不伪称旧 smoke 已有此规定；旧脚本只检查相对 +5/+6 tick。无需达到完整整局或视觉品质通过。
- 默认 `/` 与 `/candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1` 各自使用新浏览器 context，展开右上角 Runtime diagnostics，读取只读DOM `#debug-state` 的 `ready/backend/fallbackReason/acceptance`（与原诊断接口共用同一状态读取函数，不需读取应用global），收集 `pageerror`；必须前进≥300且无未捕获错误。
- `tests/client/browser-smoke/minimum-side-release.mjs` 仅导出供现有云浏览器使用的检查函数，不启动浏览器。浏览器由协调者串行执行；同模块另外导出 `inspectInvalidLightingFallback` 与 `inspectUnavailableWebGLFallback`，分别用非法lighting和仅禁止WebGL getContext验证实际失败恢复及可见提示，不用显式Canvas选择替代失败分支。
- 无 WebGL2 时自动使用 Canvas2D；也可追加 `renderer=canvas2d` 验证该真实运行路径。Canvas2D 有单位、基础地景、指向选取、移动／施法、HUD与固定步长循环，但没有3D效果、插值与临时跟随，不作为镜头或美术采纳依据。
- 初始化异常先恢复默认 forest 渲染与永久镜头模式，仍失败再用 Canvas2D；提示保持可见，重开重新尝试。中止／销毁不生成新回退 owner；world所有已成功取得的owner及renderer在后半初始化fit失败时也统一释放，再允许重试。`lighting=invalid` 可验证解析失败→默认渲染提示；网络资产失败或 WebGL 不可用由同一路径处理。模拟／导航初始化失败不冒充“渲染回退成功”。

## 已有实测与保留缺口

关闭 camera/audio 后，基线与整合各自真实 `LocalMatch`、normal bot、同一输入脚本运行600 tick；v11及v12各20个逐30 tick哈希完全相同，见 [原始曲线](quality/side-release-replay.json)。v11终值 `d1ccc04ecefae8e2`、v12终值 `f5b9aaa4fe8cbb8d`（以JSON为准）。这不是只比较两次当前代码；基线从独立 `dea84c4` worktree导入。

真实 client→Controls→LocalMatch 四路镜头/音频开关矩阵另记录18个逻辑步的输入命令及状态hash，四路总指纹均为 `79094097679de8da`，见[客户端原始指纹](quality/side-release-client-inputs.json)；world/audio/nav受控，不是浏览器设备证据。此矩阵证明开关不改变实际客户端产生的命令序列，600tick跨基线证明模拟回放保持。

v12 Q在tick10开始、tick14释放，前摇内输入的W在tick14开始并释放，接续间隔 **0 tick／0 ms**；v11同输入不接受该前摇内W。该机制已在旧基线v12中，整合未改模拟。本轮全量79个测试文件／511项通过，生产Web构建通过。首轮6项测试失败为包装后的旧依赖注入名和jsdom文件URL适配问题，修正后全量重跑通过。300 tick Canvas2D CPU测试只证明接线，不能替代浏览器记录。

实际云浏览器在准确运行构建 `e9ab955` 使用同一context的新标签，均从initialTick=0推进：默认v11达344，整合v12达2449，最后W操作后达3033；requiredTicks=300、ready/reached/running为true。两路均自然WebGL初始化失败后转Canvas2D，非空场景与恢复提示可见。默认Q显示扣蓝/冷却；整合W实际按键＋点击后Mana358→329、冷却7.9秒。选择不保存新局且保留既有存档；未重置存储。未见未捕获异常或运行失败，但控制台有被捕获的THREE WebGL创建错误，不记“错误日志为空”。提示与旧存档panel局部重叠、不阻断操作，后续布局可收紧。自有标签关闭、托管preview stopped、原启动会话exit0。Canvas不支持该临时跟随画面，声音未实际试听，故本结论仅接受旁置功能门槛，镜头、音色品质及换默认仍待完整验收。

## 固定分辨率出图整合

接收 `codex/fixed-capture-20261103` 的 `1b6c6fcd`，与已接受的镜头＋Q/W 旁置共同整合，普通路由回归所用准确构建为 `7deee23d7efa765f66ee5eba2778eafc230eac4b`。这是出图能力接入，不新增玩法旁置单元，也不切换默认。固定出图以 `npx vite build --config vite.capture.config.ts` 生成 `outputs/capture-build/`，入口 `/capture.html?shot=first-tower&seed=61&t=101&input=idle&frames=20`；等待 `window.__shot.ready || window.__shot.error`，成功后读取 `pngDataUrl`，目标为1280×720、dpr1、backend=webgl2，逐帧仍用 `__shotNext`。缺少WebGL2会明确报错，不能拿普通路由的Canvas回退冒充固定出图成功。

整合源审、72项相关测试、5项capture测试、相关typecheck、capture构建与普通生产构建通过。准确普通构建在云浏览器默认路由推进397tick，camera/audio双开路由推进352tick，均initialTick=0、ready/reached/running=true，达到300tick共同门槛。两路自然进入Canvas2D回退；预期的已捕获THREE初始化错误保留，未见额外运行异常。预览进程正常退出，原启动会话exit0。

本次尚未取得MOBA固定出图的WebGL2实际PNG，未对该入口实拍；同环境Star已实测无法创建WebGL，但不替代MOBA自身实测。1280×720非空像素、实际renderer、完整smoke、同机位图与非作者盲评仍待完成；镜头舒适度和Q/W实际试听仍未评，不据这些构建或Canvas证据换默认。仅合入源码，不宣称托管网站已更新。

## quiet 材质已有候选重放（旁置门槛通过）

在与远端 `7710c4a6` 同树的固定出图整合上接续保全的 `e91d555`／`1ca8bf4`。沿用已有三张WebP、六建筑受保护石材区及五标准件消费者，不再生成素材；仅 opt-in `materials=quiet-family-v1`。普通入口仍走既有恢复包装；纹理或建筑接线失败退回默认并提示，取消不启动下一轮默认资产请求。固定出图保持脱离DOM的1280×720 DPR1/WebGL2 PNG，标准件身份与四个游戏机位分开，临时镜头与Q/W源保留。

本轮85文件／550项CPU测试、web及capture类型检查和构建通过；14个v12手感同输入场景的summary与逐tick traces和当前main同树逐项一致，不宣称手感改善或设备延迟。普通浏览器共同门槛已通过，真实shader、固定图、声音试听或盲评仍未完成。当前三待完整验收单元为 quiet 材质、v12 指令缓冲、镜头＋Q/W。旧 stylized-diffuse 公开参数已退役：统一解析器拒绝，普通页恢复默认并提示，capture直接报错；旧源码及资产保全用于历史研究。首页与旁置页加入quiet试验链接，不叠加第四单元，也不撤镜头Q/W及v12。仅接受旁置功能，不切换默认。素材已有不等于本作材质已达标。

非作者差量审查发现并修复：quiet失败必须显式恢复提示；五标准件在缺少动作clip等后置构造异常时清理已分配路肩和克隆骨架。真实GLB缺clip故障断言覆盖自有geometry/material/skeleton释放与共享源不释放；未以CPU修复补填shader或画面通过。

关闭材质、镜头、声音的600tick同脚本v11/v12回放，与main `7710c4a6` 同tree基线逐30tick哈希、最终hash及释放事件JSON逐字节相同。旧stylized参数退出及默认恢复提示由路由测试覆盖。

准确构建 `d6f31ee684babb539c7ed64d3f7fd5228380edd3`（tree `99aa43bc858375a0b7f10a0f78a6adda94464bc3`）由非作者云浏览器复核：43个服务文件与干净构建逐hash一致；默认initial0→653tick，quiet旁置initial0→470tick，均ready/reached/running且超过300tick。自然WebGL失败后Canvas2D和可见恢复提示正常；未见额外未捕获应用异常，保留已捕获THREE初始化错误，浏览器扩展metadata错误另列。旧stylized入口实际显示retired并恢复默认Canvas，仅检退休行为不宣称该路已跑满300tick。选择不保存，旧存档保留；自有标签关闭、预览stopped、原启动进程exit0。此证据没有呈现quiet材质，不能作材质画面、固定PNG或盲评通过；托管站点部署另行核实。

## 权威赏金派生接口（CPU 与普通入口门槛通过）

接收 `a295da7e` 并收窄为 `goldAwarded` 事件：五类奖励原因在原金币记账后发出，零赏金不发；被动收入、购物和经验不混作奖励。事件不进入权威状态、输入或存档，快照复制位置。保留音频消费者忽略金币事件这一接缝，撤销无关的异步样本加载改写；旧存档只为精确源指纹增加等价映射。兼容工具删除未校验身份的 `--baseline` 输入，只从指定 Git commit 对象提取旧源。

非作者复核后，558 项测试及 sim/web/capture 类型检查和构建通过；新增 8 用例在旧 `0811894` 为 7 失败／1 通过，在修订版全过，含真实零赏金基地击杀、队友 60 奖励和自然终局。固定旧源 Git 对象与新版按 8 个支持版本各跑 3600 tick，逐 tick state/hash、正常 bot 输入及过滤新事件后的旧事件顺序／payload 一致，各版本实际产生 2–8 次金币事件。非法工具参数明确失败，公开内容与提交身份扫描通过。

准确运行源 `40f920f573844c837fa6e8d9d905cdd26191a323`、tree `f6d9bac4742249c7c7d72c46587e3eeefbb21945` 为 clean；43 个服务文件与构建逐 hash 一致。非作者云浏览器默认 v11 从 0 到 469 tick，原镜头＋Q/W 的 v12 旁置从 0 到 445 tick，ready/reached/running 均真。两路自然 Canvas 回退及提示可见，未见额外未捕获应用异常，保留预期被捕获的 THREE 错误；标签关闭、预览停止、原进程 exit 0。最终交付只在该受检运行树上追加本段结论。未接可见金币提示、未新增旁置、未部署；不据此宣称画面、声音或奖励可读性改善。

## 恢复提示与存档面板遮挡修复（2026-11-03）

原 Canvas 回退提示与本机存档面板同处 left 18 / top 105，后者覆盖前者。现有首页与候选页改为共享纵向布局；面板仍自行清理，恢复提示跨重开保留。长内容使用有界可键盘滚动区域，区域键盘事件不冒泡到游戏快捷键、不阻止浏览器默认滚动。未改模拟、旧存档、候选数量或玩法。

非作者复核并修正了滚动区域按 Space 误触镜头的问题；最终运行源 `e1aa97c10eefb8bcb767d5d5895779289a6cd121`、tree `e617218ea5d3639007a876ef48ce228d7f8d8f09` 的全量 87 文件／561 测试与 clean Web 构建通过。实际浏览器默认从 0 到 302 tick、原 Q/W 入口从 0 到 599 tick，均自然 Canvas 回退；恢复提示底 153.78125、存档面板顶 161.78125，间距 8 px，当前窗口内面板底 266.95。保留旧档后重载仍分别显示 1:02／0:42，面板只有一份；焦点在状态区域按 Space／Q 未改变镜头锁定或进入技能瞄准。服务 43 文件逐 hash 一致，未见额外未捕获应用错误，自有标签关闭、预览停止、进程退出 0。

本轮只接受上述既有遮挡修复。窄屏、实际超长文本滚动、无存档路径、替换存档的新局及运行错误覆盖层未完成浏览器验收；不据 DOM 测试代填，也不声称画面或听感品质通过。

同轮 Site v21 线上复验：部署源对应 Git `0d7a86741b4c0d737e8465712d29f9d740c2cc50`，默认 443／QW 332 tick 均从零推进，ready/reached/running 为真、自然 Canvas 回退，未见额外应用异常。两路恢复提示与存档面板仍为上述 8 px 间距；保留旧档后重载仍显示 0:19／0:31，状态区域按 Space 未锁镜头。此次只补线上事实，网站运行源码未再改变；上述窄屏、超长滚动、无存档及品质未验范围不变。

## 新局启动失败时保留旧存档（2026-11-03）

实际 client 生命周期夹具复现：原 New match 在导航加载前清空旧存档，随后导航 HTTP 503 时旧字节已丢失。改为完整初始化、首帧绘制、HUD 与诊断建立成功后，才通过现有存档写入接口替换；不先删除旧档。写入仍比较最初读取的完整字节，启动期间被其他写者改变时拒绝替换。规则、状态哈希、存档格式与候选数量不变。

非作者源码复核通过；12 项生命周期测试覆盖导航与首帧失败、异步启动取消／恢复、重复重开、无锁、外部存档变化、存储拒写后重试和原对话框 new／preserve 分支。全量 87 文件／568 测试及 clean Web 构建通过。准确受检源码 `35ef606df0b4312c0ee26d76e51194ae883893d0`、tree `8331ef3f00c334de15fb8ac26a0b39dabb239645`，43 个服务文件与构建逐 hash 一致。

非作者普通浏览器默认从 0 到 835 tick、原 Q/W 入口从 0 到 444 tick，均 ready/reached/running、自然 Canvas 回退且未见额外应用异常；选择保留旧档，重载仍显示原 1:02／0:42。自有标签关闭、预览停止、进程 exit 0。浏览器未执行破坏性替换：当前没有已支持的隔离存档 context，不清除原用户存档；失败与替换事务的证明仅来自上述真实 client／存储 CPU 夹具，不冒充实际浏览器验收。未据此升级画面、听感或窄屏品质。

同轮 Site v22（运行源 `002ae06b67ec1196d773738e039bf0660fc25cf6`）线上默认／QW 从零推进 398／342 tick，均自然 Canvas 回退，未见额外应用异常；选择 preserve 后重载仍显示原 0:19／0:31 存档。未执行 New match、清档或替换；自有标签关闭。此线上检查没有新增破坏性事务、窄屏或品质验收，网站运行源码不再变动。

## 整合角色加载取消边界（2026-11-11，CPU）

既有镜头＋Q/W＋角色路线在取消后仍可能继续发起不相关下载：角色批次返回后加载 combat 纹理，或 terrain 返回后加载 status 纹理；后一请求若停滞，会拖住旧 world 的释放。现于每个加载边界先接管已返回资源，再检查取消，复用现有逆序清理；不启动默认回退、不挂载旧画布。未新增超时、资产、旁置或默认变化，已经发出的请求仍须返回后才清理。

`tests/client/world-source-lifecycle.test.ts` 使用实际 19 份 GLB、生产 pin／parser／world／presentation 消费者，覆盖角色、combat、terrain 后取消，以及损坏 Morrow 字节后释放候选并恢复可同步快照的基线 View。旧源 `4156c7d` 为 2 失败／2 通过；修复后 4 项通过。最终全量 99 文件／721 项通过，sim 构建、Web 类型检查及构建、capture 类型检查及构建通过，公开内容及提交身份扫描无发现。GPU renderer／post 为测试替身；GLB 内 PNG 实际解码，独立纹理仅验证文件存在，未作浏览器解码。没有启动浏览器、部署或补填 WebGL2、画面、听感、镜头舒适度及非作者盲评。
