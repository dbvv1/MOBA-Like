# MOBA 手感规格与首轮实测

基线：main `8ade2d1012370692de31f3883a85338171dbcab3`，运行实现 `9777b840`，候选 v11；默认 v10 不变。2026-10-29。以下数字来自真正调用 `Simulation.step(sim.commandFrame(inputs))` 的 CPU 回放，不是把 catalog 常量抄成测量。

## 管线与测量边界

DOM `pointerdown/keydown` → 队列 → rAF 的 `FixedClock`（30 Hz）→ `LocalMatch.step` 的稳定席位信封 → 模拟 → 每 tick `world.sync / sound.sync` → 每渲染帧 `world.draw(delta, alpha)`。`FixedClock` 返回剩余时间比例；角色位置插值、相机跟随在 draw 中推进。源码检查不是输入到像素延迟实测。

目前右键只有 pointerdown 生成命令；pointermove 只更新指针，没有按住右键持续重发。技能除 self 外为按键进入瞄准后左键确认，没有按下／松开施法双模式。命令在下一逻辑步消费，而非每个渲染帧直接移动角色。锁定／边缘相机和回中存在；真实相机响应帧数未测。

运行：`node --import tsx tools/measure-feel.ts`。原始逐 tick 输入、接受结果、位置、朝向、动作、冷却和事件在 [feel-baseline.json](quality/feel-baseline.json)。两次独立运行输出逐字相同。固定 seed 1、30 Hz，使用已有测试初始化工具把两英雄放到 (0,0)/(5,0)，不修改战斗参数、不派 bot 输入；真实生产导航、模拟和信封仍工作。这是隔离 CPU timing fixture，不是正常整局实机、GPU 或键鼠测量。停止／转向场景输入分别在 tick 8／7，首次移动 tick 1；输入 tick 是执行前确定的逻辑 tick，没有真实设备时间戳。

## 瞄准结束时撤销旧操作指令（战斗候选）

沿已有输入与 HUD 修复“模式已取消，文字还要求左击”的不一致。设置、页面隐藏、失焦、Stop 或切到自身技能结束瞄准时，只在当前仍显示该次瞄准信息时撤下，后来到达的拒绝原因与终局结果保留；仍在瞄准时保持可读，恢复后须重新选技能，旧点击不会施法。正常确认后的排队回执和 Escape 取消结果仍按原流程显示。

死亡也结束本次尚未确认的瞄准。每个真实模拟步取回快照后、呈现与 HUD 更新前，由 Controls 检查当前生命和对局状态；死亡或自然终局撤销 Q／攻击移动的目标模式，死亡期间不接收新的目标模式，复活后须重新选择。只清行动意图，不禁用整个 Controls，因此死亡期间仍可操作镜头。条件撤销仍只清自己的旧提示。

采用 [Firefly Lasso 实玩提炼的有效期方法](https://github.com/dbvv1/a1dbv/blob/main/docs/research/2026-10-23-game-worth-trying.md#firefly-lasso先让反馈读得到再看重开后是否改变动作)：先撤销已失效信息，不靠延长全部提示解决问题。复用原 `setMode` 生命周期，不改模拟、技能排队、改键或界面布局。

真实 client、Controls、HUD 与 Simulation 的无画面回归复现并核对上述中断→返回→重新选技能。新增场景只设置致命交战的开局，随后由真实 bot 击杀、正常计时复活：原版 Q／攻击移动的旧点击分别产生一条实际命令，修复后均为零；v11／v12 死亡当步清理、死亡中按键、复活后重新选择与自然终局也通过回归。渲染、音频、导航和对话框设备行为仍为替身。修改只保留于既有 `dot-b/death-existing-combat-trial-20261106`，未合 main、未部署；真实浏览器焦点、视觉可读性与屏幕阅读器播报待验。2026-11-07。

## 规格与测值

| 项 | 标杆／目标与来源 | 本作取值及理由 | 实际 CPU 结果（Veyra / Morrow） | 差距 |
|---|---|---|---|---|
| 起步 | 右键当帧开始响应；a1 手感规范 | 下一逻辑 tick 执行，固定模拟 | tick 1 命令当 tick 首次位移；7 / 6.8 世界单位每秒 | 屏幕首帧待测，不能填 0ms |
| 转向 | 点击另一方向当帧反馈 | 点地 0.2 秒后改向 | tick 7 当 tick 朝向改为 (-.26963,.96296) / (-.26246,.96494)，位置改变 | 视觉插值响应待测 |
| 停止 | 停止键立即停 | stop 不滑行 | tick 8 当 tick 距离 0，两英雄一致 | 视觉停止帧待测 |
| 持续右键 | 按住跟随光标 | 当前只处理按下 | CPU 命令无法覆盖 DOM hold；源码缺持续输入 | 未满足；不伪造屏幕测量 |
| 移速换算 | LoL 325–355 游戏单位/秒，社区 wiki 待游戏核值 | 当前 7 / 6.8 世界单位/秒，既有地图尺度 | 真实位移×30 得 7 / 6.8 | 没有 LoL 单位→本作单位映射；禁止以“米”直接比 ±20% |
| 普攻前摇 | 每英雄比例不同；计时=1/攻速 | 配置周期 .85/.95 秒，比例25%/30%；保留既有远程身份 | 起手1→释放8 / 10；7 / 9 tick = 233.33 / 300 ms | 起点可测，不等于已有同英雄标杆 |
| 连续周期 | 由攻速决定 | tick 量化原周期 | 起手1,27,53 / 1,30,59；26 / 29 tick = 866.67 / 966.67 ms；前摇占实测周期26.92% /31.03% | 仅本作量化，不宣称标杆±20% |
| 释放到接触 | 弹体飞行不等于已命中 | 5单位隔离目标，既有弹道 | 释放8→命中16 / 10→18，均8 tick=266.67ms | 不能当任意射程常数 |
| 可取消边界 | a1规范引用LoL：释放前1 tick不可取消，释放后再锁1 tick；原文待核 | 既有 v11 合同在提交前可取消，提交后可走位 | 释放前一 tick及释放tick的move均取消；释放后下一tick可移动 | 与规范的锁定窗口不一致，待有效标杆录像确认后取舍 |
| 恢复／后摇 | 伤害提交后可走 A；动画与冷却分开量 | 不用动画锁移动 | 释放后1 tick move 距离 .23333/.22667；下次起手相对释放19/20 tick | 动画恢复时长未测；19/20是冷却余段，不冒称动画后摇 |
| 施法承诺 | 技能可移动性按技能定义 | Q站定，move保留目的地 | Q起手1→释放5=4 tick/133.33ms；tick2 move接受，tick5才首次移动 | 移动目的地被保留，不代表所有命令排队 |
| 指令缓冲 | 施法中下一条合法技能应排队、结束时执行 | 当前没有通用技能缓冲 | Q中tick2发未冷却W：alreadyCasting拒绝；到tick22无W事件；move仍在Q释放时执行 | **已复现最大操控缺口：不同命令处理不一致，技能丢弃而非缓冲** |
| 快捷／按松施法 | 两模式与指示器 | 指示器及按键+左击，self直接施放 | CPU只验证技能命令，不测UI | 双模式未具备 |
| 反馈同帧 | 移动、施放、命中、击杀等画面／声音／镜头同帧 | 只读事件触发表现，4种音频样本 | 无视频/音轨，全部待测 | 当前capture不录音且不含HUD，不能补成同帧证据 |
| 非作者／人感 | 同段标杆与本作录像并排 | 未取得 | 待测／待用户试玩 | 不称“实测达标、未经人感” |

标杆来源：[Movement speed](https://wiki.leagueoflegends.com/en-us/Movement_speed)、[Basic attack](https://wiki.leagueoflegends.com/en-us/Basic_attack)、[Attack speed](https://wiki.leagueoflegends.com/en-us/Attack_speed)。这是社区维护 wiki，不是 Riot 游戏内测量。2026-10-29 本轮读取前两页被 robots 拒绝，未改用镜像；上表只追溯 a1dbv `f4b4e801` 的规范转引，没有独立核实。没有选定英雄／攻速／装备／录像帧率与单位映射，不能声称任意数值符合 ±20%。

下一手感单元只追**施法中合法下一技能的缓冲与提交边界**；先保留上述可复现输入，取得真实帧对照，再决定取消窗，不在本轮改玩法。

## 指令缓冲旁置候选（v12，2026-10-29）

入口 `candidate.html?commands=buffer-v1`，无参数仍为 v11，主页仍为 v10。玩家与机器人共用模拟层单槽队列；只在施法或普攻准备占用中排队，最后一条**合法**的 move／attackMove／attack／cast 替换前条；非法输入不覆盖。stop 是立即取消普攻与清队的逃生输入，buyItem 不占队列。排队时不支付技能资源，释放当 tick 重验存活、控制、目标、距离、法力和冷却，失败即丢弃，不自动重试。死亡／眩晕清队。普攻准备中移动改为发射后当 tick 移动，想取消这次普攻用 stop；这是明确的操作取舍。

同一 `tools/measure-feel.ts`、同种子1、同英雄/位置/输入，分别以参数11/12运行；原场景保留，额外增加只有Q→W、不含随后move覆盖的隔离对照，两版均运行。原始逐tick日志：[v11](quality/feel-command-buffer-before.json)、[v12](quality/feel-command-buffer.json)。

| 同一输入场景 | v11 | v12 |
|---|---|---|
| Q tick1，ready W tick2，之后不再输入（两英雄） | W `alreadyCasting`，21tick内不执行 | W接收入队；Q释放tick5同时开始W，释放到消费间隔0tick |
| Q tick1，W及move同在tick2，move排在后（原首测脚本） | W拒绝，move在tick5移动 | W先入队、随后被合法move覆盖；tick5移动，无偷执行W |
| Veyra普攻tick1，tick7提前move | tick7取消普攻且移动 | 保留普攻、tick8发射并移动 |
| Morrow普攻tick1，tick9提前move | tick9取消普攻且移动 | 保留普攻、tick10发射并移动 |
| move恰好在发射tick8／10输入 | 取消尚未提交的普攻 | 本tick发射并移动，单tick位移≤速度/30 |

普攻前摇仍233.33／300ms、连续周期866.67／966.67ms，未改参数。队列保存在权威英雄状态且纳入hash；存档仍按输入重放重建队列，v12独立浏览器槽避免覆盖旧候选存档。旧v1/v2固定fixture和旧v11默认回放须继续通过。

相位边界：输入阶段直接施法会参与本tick的advanceCasts；释放后接续的非零前摇技能在本tick只开始，下一tick才扣第一个前摇tick，不重复推进其他英雄。比如普攻tick8释放后接Q：tick8开始、tick13释放；这是当前固定阶段合同，相比同tick输入阶段直接Q晚1tick提交，仍需手感对照。零前摇W在tick5开始并提交。

本轮只证明CPU指令与状态时序变化；不是屏幕首反馈帧、动画衔接、音频同步或真人手感验收。下一步同输入实机smoke及逐帧反馈对照，默认版本不切换。


## 关键声音有界保留候选（2026-10-30）

显式 `candidate.html?commands=buffer-v1&audio=critical-v1`；不带 `audio`、未知值或重复参数保留原音频。模拟、技能参数和音色不变，未换默认。固定源码树 `bb541287`，完整合同见 [audio-critical](audio-critical.md)。

| 同组实际事件输入 | 原消费者 | 旁置消费者实际计划 | 仍缺的体验证据 |
|---|---|---|---|
| Q tick1、W tick2，v12 tick5 两次释放 | 合并为一次 cast | 两次起播相隔 25ms | 同音色是否可分辨、与画面协调性未试听 |
| 同 tick 命中与 W 释放 | 只播 hit | hit 优先，W 延后 25ms | 不把计划间隔当设备延迟 |
| 慢帧补算内 Q/W 与后续 Q 命中 | 命中被节流吞掉 | 0/25/50ms 有界计划 | 软件慢帧不代表目标设备帧率 |

496 项测试、模拟回放与真实浏览器开始／暂停恢复／静音／重开通过，旧 AudioContext 关闭；关闭候选仍只计划一次。关键事件最多 4 个未来计划、最远 100ms，25ms 起播间隔和 8 声部上限保留，超限会有明确丢弃原因，不承诺所有过载声音都保留。

原生 OfflineAudioContext 在 48kHz 下重建两个能量起始 0/1200 sample，混合峰值 0.23021、未裁剪。这不是实时录音、实际听感或输入到设备延迟；浏览器仍带默认 `--mute-audio`。单独同步 UI 实验的 native stop 在计划起播前 25ms 返回，普通慢软件点击较晚，不能外推成同样及时。真实主观试听、音画同步与标杆对照仍待验，不填达标分。

## 临时跟随镜头候选（2026-11-02）

在 `candidate.html?camera=hold-follow-v1`，解开 HUD 的永久 Lock camera 后，按住现有 focus 绑定（默认 Space）跟随自己的呈现位置，松开从当前镜头位置恢复自由滚屏，不跳回先前远处，也不改永久锁定／存档偏好。基线仍是 Space 永久锁定；未知／重复参数不启用。可与已有 commands 路由组合，未改变模拟、英雄运动或施法。

采用前比较了两处成熟输入清理机制，只提炼机制，没有复制源码：

| 固定实现 | 状态／调用顺序与取舍 | 本候选接入 |
|---|---|---|
| [Phaser KeyboardPlugin `02d8931b`](https://github.com/phaserjs/phaser/blob/02d8931b626d9764c133cbb3fbf99966c03c757c/src/input/keyboard/KeyboardPlugin.js#L224-L227)；[resetKeys](https://github.com/phaserjs/phaser/blob/02d8931b626d9764c133cbb3fbf99966c03c757c/src/input/keyboard/KeyboardPlugin.js#L853-L867) | BLUR、场景 PAUSE／SLEEP 清按键状态，而非等待可能丢失的 keyup；场景／插件拥有状态与解绑，主动清理会放弃仍物理按住的输入 | 沿原 Controls 生命周期清临时 held；恢复须新按下，不从 repeat 恢复 |
| [Unity Input System `54b1581a` InputManager](https://github.com/Unity-Technologies/InputSystem/blob/54b1581acb600c1f00998505af19a644795ef9b8/Packages/com.unity.inputsystem/InputSystem/Runtime/InputManager.cs#L3952-L4027) | 按后台政策重置／暂时禁用设备，恢复请求同步，不能把 IgnoreFocus 当后台仍有事件；设备级状态成本比一个网页按键大 | 不复制设备管理器，只分离永久模式和临时输入所有权；失焦／隐藏／编辑接管清 held 与旧边缘滚屏指针 |

本例一层临时状态足够：`camera-follow.ts` 保永久 locked 与瞬时 held，world 沿原插值角色跟随；Controls 记录实际按下键，keyup 即使目标变为编辑框或修饰键变化也能释放。HUD 显式切换永久模式终止临时跟随，原键 repeat 不夺回；设置暂停／重开／销毁结束旧所有权。固定 capture 拒绝 held，不改机位与 viewport。没有引入通用相机栈或回正动画。

本轮是源码／CPU 候选：真实 client、Controls、模拟与 DOM 接线使用受控渲染／音频／导航；world 轨迹使用真实 Three 变换及受控 renderer／资产。已核自由滚屏→临时跟随移动呈现根→释放保当前位置→继续滚屏，保永久锁定与 capture；这不是浏览器图像、输入延迟或主观镜头验收。生产构建完成后仍须实际云浏览器操作／手感比较，尚未上线，不提升模块成熟度。两处来源核实 2026-11-02。

## 镜头与 Q/W 整合候选：正常操作验收

基线为 `dea84c4fde58ec7ebb05dc0adae70f4ee2dce45c`；仅合入已分别源审的声音 `3b8275cdf46ec848dfa8a3b4cc8e5ae20595079e` 和镜头 `cb818773da66e6a8ee77a4576339f33457fba32d`。没有加入待验结构或材质。两单元的源审不等于分别游玩通过；下列整合行为、镜头手感、听感均待实际验收，CPU／DOM／PCM 不能替代。模拟与内容未改，v12 的前摇及单槽下一指令队列保留；网站默认与 legacy 不换。

所有对照用同一构建的 `candidate.html`，保相同英雄、音量及其他参数：

- v12 对照（camera/audio 都 baseline）：`candidate.html?commands=buffer-v1`
- 只开声音（camera baseline）：`candidate.html?commands=buffer-v1&audio=critical-v1`
- 只开镜头（audio baseline）：`candidate.html?commands=buffer-v1&camera=hold-follow-v1`
- 双开拟发布候选：`candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1`

以上“不带 audio”的对照也关闭关键声音调度。若要单独判断本次 Q/W 音色二改，用原基线 `dea84c4` 与整合构建各自的 `candidate.html?commands=buffer-v1&audio=critical-v1`：两者都保 25ms 调度间隔，前者 Q/W 同用原 cast，后者使用两片衍生音；不要把调度差异归因为音色改善。

**镜头先走一段完整操作，而不是只按一次 Space。** 取消 HUD 永久锁定，鼠标移回画布边缘自由观察；按住现有 focus 绑定（默认 Space）回看自己；松开后画面留在当前位置，可继续边缘滚屏；随后右键移动、Q 确认目标，并在前摇中输入 W，观察 Q 释放后 W 正常接续。再比较只开声音与双开、v12 对照与只开镜头，分别核镜头与音频没有互相夺取输入。补试按住期间改永久锁定、进入改键设置、失焦／返回及重开；永久偏好不被临时跟随改写，不需要再次按键才能解卡。若松开仍跟随、恢复跳回旧观察点、焦点或改键后卡键、移动／施法中断，退回该镜头单元；能正常操作后再判断回看速度、构图与自由观察是否舒服。

**声音在同段实际交战中比较。** 先以同英雄、同路线、同一组 Q→W 操作比较前后两版，再在小兵／敌方技能混入时重复；分别用 Veyra 与 Morrow，检查 Q/W 起音与音色能否分辨、是否盖住命中／受伤／危险提示、反复施放是否刺耳。声音只说明对应槽位已释放，不表达命中成功；Veyra W 冲刺与 Morrow W 护盾不可混作相同技能含义。若只能靠两声时间差猜槽位、听不清必要信号或产生错误命中预期，退回声音配方／混音同单元，不通过增加音量或继续堆音色掩盖问题。最终以双开路线重走自由观察→回看→释放→移动／连招，并核暂停、关声音、重开无旧声补播，再决定采用、返工或退回；不能从单开通过推断双开通过。

## 旁置门槛的同脚本实测（2026-11-02）

600 tick CPU对照保留v11/v12各20个状态哈希，开关关闭与dea84c4逐项一致。脚本Q在tick10开始／14释放；v12前摇内W在tick14开始并释放，接续0 tick（0ms），v11拒绝该W。前摇和单槽队列本轮未改；不把CPU数值当屏幕或设备延迟。初始化失败恢复及浏览器300 tick最小验收统一记录在[单份结论](side-release-acceptance.md)，实际操作和试听仍按上节完整流程判断。

### quiet 材质重放的手感不变检查（2026-11-03）

与main `7710c4a6` 同tree基线使用现有 `tools/measure-feel.ts` 的v12、seed1同脚本，两个英雄合计14场景summary和逐tick traces完全一致；起停、转向、普攻前摇／发射边界及Q→W排队未改。这是CPU隔离场景回归，不是手感改善、实际试听或输入到屏幕延迟。
