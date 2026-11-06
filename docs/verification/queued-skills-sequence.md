# v12 前摇排队：真实 Controls 输入到规则释放的连续证据

任务：`B-MOBA-QUEUED-SKILLS-20261106`。只新增
`tests/client/queued-skills-sequence.test.ts` 与本文件；生产 `src/`、旧测试与存档夹具只读，
未改模拟规则、技能数值、UI 文案或渲染。

结论先说：

- 一段由生产 `createControls` 的 `keydown`／`pointerdown` 处理后的真实输入，经
  `SimCommand` 进入真实 `Simulation`（`contentVersion 12`，真实烘焙 Detour lane），
  六个连续段全部按现行 v12 合同复现，`npm test` 中本文件 6/6 通过。
- 逐 tick 的 `finalHash` 在全新 `Simulation` 重放中逐项一致；按 1/2/5 tick 采样
  `snapshot()` 不改变任一 tick 的玩法 hash、最终 hash 或同一 tick 的玩法投影。
- 本轮未发现“按键已受理却无规则释放”或“同槽重复释放”的新缺陷。`Stop` 与死亡是
  现行合同明确的“受理但不出手”：前者当 tick 清队并取消普攻，后者清队清前摇；
  两者都在证据里单独标出，不当作释放失败。
- 这是 CPU／DOM 时序证据，不是屏幕首反馈、输入延迟、动画衔接、音频同步或真人手感
  验收；这些项目未运行、未评价。
- 原交回 `50fda56` 使用 legacy 有序命令路径。整合复验改为生产
  `Simulation.commandFrame(commands)` → `step(frame)`，主跑与三种重放均走现行信封路径，
  并逐 tick 比较完整 presentation events。此处仍不经过 `LocalMatch` 的玩家过滤／bot 混入，
  也不新增非法席位／tick／重试的对抗校验；真实客户端装配另由既有 client 回归覆盖。

## 固定输入与只读依据

| 项 | 实际使用 |
|---|---|
| 内容版本 | `contentVersion: 12`（现行 catalog；Veyra Q 为方向弹道，`castTime 0.15s`；W 为 0 前摇方向冲刺；普攻 `windupFraction 0.25`） |
| 输入层 | 生产 `src/input/controls.ts` 的 `createControls`：真实 keydown／pointerdown 监听、技能瞄准模式、Esc 取消、`S` 停止、右键上下文攻击 |
| 命令层 | 生产 `src/input/commands.ts` 的 `commandForCast`／`commandForRightClick` |
| 模拟层 | 生产 `src/sim/simulation.ts`；队列在 `applyCommand` 入单槽、`consumeCommandBuffers` 在普攻／施法释放后消费 |
| 导航 | `tests/helpers.ts` 的 `testNavigation()`，加载 `src/sim/nav/lane.navmesh` 的真实 `DetourNavigation`，不用假 `findPath` |
| DOM 替身 | 与 `tests/client/targeting-controls.test.ts` 相同的方式：`EventTarget` 作为 window／canvas，只提供 `focus`；不触真实浏览器 |
| 规则来源 | `docs/brief.md`“v12 旁置：下一条指令缓冲”、`docs/feel.md`“指令缓冲旁置候选（v12）”（最后合法输入替换前条、stop 立即清队、死亡清队、释放当 tick 重验） |

测试只维护比赛夹具（英雄位置、`hpRegen=0`、死亡场景把蓝方 HP 预置为 1）。没有调用
私有方法、没有直接写 `cast`／事件／`cast.id`，成功释放均由 `Simulation.step` 的
`applyCommand` 路径产生。死亡场景的致死伤害来自红方英雄真实普攻投射物，预置 HP 只
用于把死亡时刻放进蓝方 7 tick 前摇内。

## 原覆盖与新增差量

原用例中，`command-buffer`／`basic-attack-cycle`／`abilities` 三个模拟层文件都从
`Simulation.step([...])` 直接发命令；`tests/client/targeting-controls.test.ts` 经
`createControls` 的按键／点击产生命令（`contentVersion 8`），但命令止于 enqueue spy、
未送入真实 `Simulation`；`tests/command-frame.test.ts` 走命令信封。

已有 client 用例覆盖了 `Controls`→命令→v10 `Simulation` 的单条受理：
`tests/client/bindings-consumer.test.ts`（`contentVersion 10`）把 `createControls`
产出的命令直接交给真实 `Simulation`，对 `cast`／`attackMove`／`stop`／右键 `attack`
断言 `accepted`，并在 30 tick 后与全新 `Simulation` 比较快照。新增差量不是“命令第一次
进入真实 `Simulation`”，而是 v12 单槽排队在前摇内的受理／替换／取消与释放当 tick 的
逐 tick 时序：

| 原用例 | 已有覆盖 | 未覆盖的连续段 |
|---|---|---|
| `tests/command-buffer.test.ts`（9 个用例） | 直接命令：Q→W 接续、普攻前摇内排队、最后合法输入替换、合法 move 覆盖、stop 清队、死亡／眩晕／缺蓝丢弃、消耗时目标死亡丢弃 buffered attack／冷却丢失丢弃 cast、取消前摇不追旧目标且不重复消耗 move 预算（`cancelled windup cannot chase old target then consume a second move budget`）、`LocalMatch` 存档重放后队列保持且同一续跑、排队 move 在普攻释放当 tick 起步而非晚一 tick | 真实 DOM 输入序列、按键与点击到命令的映射、同槽重复 Q、不同槽 Q→W、瞄准取消后重新 Q、前摇内死亡→复活→新输入 |
| `tests/basic-attack-cycle.test.ts` | v11 普攻前摇／提交／取消边界（直接命令） | v12 前摇中的真实输入队列（该文件为 v11 合同） |
| `tests/abilities.test.ts` | 直接命令的 Q／W／E 起手、法力、冷却、命中 | 施法前摇期间的新输入、输入层取消瞄准 |
| `tests/client/targeting-controls.test.ts` | `createControls` 的瞄准模式、Esc／stop／右键清理、左键产出 cast 命令 | 本文件止于 enqueue spy；命令真正进入 `Simulation` 后的 v12 排队与逐 tick 释放／取消时序 |
| `tests/client/bindings-consumer.test.ts` | `contentVersion 10`：`createControls` 产出的命令直接交给真实 `Simulation`，`cast`／`attackMove`／`stop`／右键 `attack` 断言单条 `accepted`，30 tick 后与全新 `Simulation` 快照一致 | v12 单槽排队；前摇内受理、替换、Stop／死亡清队，以及释放当 tick 的逐 tick 释放／取消时序 |
| `tests/command-frame.test.ts` | 帧级输入信封、席位与重复 retry | 非本单元范围；本文件直接向 `Simulation.step(SimCommand[])` 发 legacy 有序命令（历史回放路径）；现行客户端经 `LocalMatch.step` → `commandFrame` 信封进入模拟，本测试未覆盖信封校验 |

新增文件不复用直接命令脚本，而是用同一组 `Controls` 实例连续产生输入；六个 `it`
分别覆盖任务列出的段，且每段都做逐 tick 记录与全新 `Simulation` 重放。第 5 段把第
1、2、4 段的动作串成一条连续输入带（同槽重复 Q 由第 3 段单独覆盖），专门检查 Stop
后是否立即恢复控制、Q 前摇内再次排队。

## 逐 tick 记录格式

`QueuedState` 每 tick 保存：

- `inputs`：玩家实际触发的 DOM 标记，例如 `key:q`、`click:0:<x>,<z>`、`click:2:<entityId>`；
- `directCommands`：非玩家按钮来源的命令（仅死亡场景 tick 1 的红方普攻），避免把对手
  命令记成玩家点击；
- `commands`：本 tick 送入 `Simulation.step` 的完整命令数组；
- `results`：`CommandResult[]`，逐条保留 `accepted`／`queued`／`reason`；
- `events`：本 tick 的 `castStarted`／`castResolved`／`castCancelled`，以及命中的
  `basicAttack`／`basicAttackHit`／`heroDamaged`／`goldAwarded`；
- `mana`、`cooldowns`、`position`、`targetId`、`castSlot`、`basicAttack`、
  `queuedCommand`、`alive`、`hp`；
- `hash`：该 tick 完整权威状态的 FNV-1a 64 位 `finalHash()`；
- `projection`：`snapshot()` 的玩法投影，用于采样比较。

三层证据不混写：

| 层 | 本文件中的字段 | 说明 |
|---|---|---|
| 按钮／按键 | `inputs` | 只证明 Controls 处理了 DOM 事件；W／Esc 可以合法地不产生命令 |
| 受理 | `results` 的 `accepted`／`queued` | 只证明 `Simulation` 接收入队或立即执行，不代表已释放 |
| 正式释放 | `events` 的 `castStarted`／`castResolved`／`castCancelled` | 只有该层算技能真正起手／完成／取消 |

测试 stdout 会打印每个场景的 `commandBandSha256`、`fullTraceSha256`、最短命令带和
关键 tick 摘要（`[queued-skills]` 前缀），可直接重跑复核。

## 六个连续段与结果

以下 tick 为 `Simulation.state.tick`，均为 30 Hz。

### 1. 普攻前摇中 Q → W → Stop（`ticks=30`，通过）

夹具：蓝 Veyra `(0,0)`、红 Veyra `(5,0)`，双方 `hpRegen=0`。

| tick | 玩家输入 | 命令／受理 | 规则事件与状态 |
|---|---|---|---|
| 1 | 右键点红方（entity 10） | `attack` accepted | `castStarted basicAttack id=1`，`commitTick=8`，`windupTicks=7` |
| 2 | `q` + 左键 `(4,0)` | `cast Q` accepted, `queued=true` | 队列为 Q；法力 330；无 Q 释放 |
| 3 | `w` + 左键 `(0,4)` | `cast W` accepted, `queued=true` | 单槽被 W 替换；法力 330；无 Q／W 释放 |
| 4 | `s` | `stop` accepted | `castCancelled basicAttack id=1 reason=stop`；队列清空，目标清空，普攻前摇取消 |
| 5–30 | 无 | 无 | 无 Q／W `castStarted`／`castResolved`；Q／W 冷却仍为 0；`veyra.q`／`veyra.w` `casts=0` |

结论：Q、W 都被“受理入队”，但随后被 Stop 按合同清掉，因此没有释放；这不是
“按键受理却丢释放”的缺陷。若没有 Stop，Q 会先入队、W 替换 Q，最终只执行 W（见第 4 段）。

### 2. W 方向瞄准取消后新 Q（`ticks=7`，通过）

| tick | 玩家输入 | 命令／受理 | 规则事件与状态 |
|---|---|---|---|
| 1 | `w` | 无命令 | 仅进入 W 瞄准模式；W 冷却 0 |
| 2 | `Escape` | 无命令 | 瞄准取消；W 冷却仍 0；队列为空 |
| 3 | `q` + 左键 `(5,0)` | `cast Q` accepted（非 queued） | `castStarted Q id=1`；法力 330 → 290.267；`cooldowns.Q=134` |
| 7 | 无 | 无 | `castResolved Q id=1` |

结论：W 的按键与 Esc 只影响瞄准态，不产生命令、不占队列、不花法力；取消后的 Q 是
唯一被受理并被规则释放的技能。

### 3. 前摇中两次同槽 Q（`ticks=18`，通过）

| tick | 玩家输入 | 命令／受理 | 规则事件与状态 |
|---|---|---|---|
| 1 | 右键点红方 | `attack` accepted | `castStarted basicAttack id=1`，`commitTick=8` |
| 2 | `q` + 左键 `(4,0)` | `cast Q` accepted, `queued=true` | 队列 Q |
| 3 | `q` + 左键 `(4,0)` | `cast Q` accepted, `queued=true` | 同槽替换，仍只有一条 Q；法力 330 |
| 8 | 无 | 无 | 普攻 `castResolved id=1`；同 tick `castStarted Q id=2`（前摇释放后接续） |
| 13 | 无 | 无 | `castResolved Q id=2` |

结论：同槽重复输入只消费一次，Q 只有一次 `castStarted`／`castResolved`，
`veyra.q.casts=1`，没有重复释放。

### 4. 前摇中不同槽 Q → W（`ticks=13`，通过）

| tick | 玩家输入 | 命令／受理 | 规则事件与状态 |
|---|---|---|---|
| 1 | 右键点红方 | `attack` accepted | `castStarted basicAttack id=1`，`commitTick=8` |
| 2 | `q` + 左键 `(4,0)` | `cast Q` accepted, `queued=true` | 队列 Q |
| 3 | `w` + 左键 `(0,4)` | `cast W` accepted, `queued=true` | 后到的合法 W 替换 Q；队列 W |
| 8 | 无 | 无 | 普攻 `castResolved id=1`；同 tick `castStarted W id=2` 与 `castResolved W id=2`（W 0 前摇）；位置 `(0,7)`；法力 330 → 300.267；Q 冷却 0，W 冷却 239 |

结论：现行合同是“最后一条合法输入替换前条”，因此被替换的 Q 完全不出手，W 立即释放；
没有 Q、W 同时释放或 Q 漏释放的重复事件。

### 5. 一条连续输入带：前摇取消后立即恢复，Q 前摇内 W 接续（`ticks=11`，通过）

同一 `Controls` 实例、同一场比赛里连续完成第 1、2、4 段的动作（同槽重复 Q 由第 3 段单独覆盖）：

| tick | 玩家输入 | 命令／受理 | 规则事件与状态 |
|---|---|---|---|
| 1 | 右键点红方 | `attack` accepted | `castStarted basicAttack id=1`，`commitTick=8` |
| 2 | `q` + 左键 `(4,0)` | `cast Q` accepted, `queued=true` | 队列 Q |
| 3 | `w` + 左键 `(0,4)` | `cast W` accepted, `queued=true` | 队列被 W 替换 |
| 4 | `s` | `stop` accepted | `castCancelled basicAttack id=1 reason=stop`；队列清空；无 Q／W 释放 |
| 5 | `w` | 无命令 | 仅瞄准；说明 Stop 后输入仍可用 |
| 6 | `Escape` | 无命令 | 取消瞄准 |
| 7 | `q` + 左键 `(4,0)` | `cast Q` accepted（非 queued） | `castStarted Q id=2`；法力 330 → 290.267；`cooldowns.Q=134`；无旧队列残留 |
| 8 | `w` + 左键 `(0,4)` | `cast W` accepted, `queued=true` | Q 前摇中排队 W；法力 290.533 |
| 11 | 无 | 无 | `castResolved Q id=2`；同 tick `castStarted W id=3` 与 `castResolved W id=3`；位置 `(0,7)`；法力 261.333；Q 冷却 130，W 冷却 239 |

结论：Stop 只结束上一段前摇和队列，不夺走后续输入；下一个 Q 在 tick 7 立即受理，
Q 前摇中的 W 在释放 tick 接续，Q／W 各只释放一次。该连续带没有出现“停不下来”
“旧队列偷执行”或“排队 W 丢失”。

### 6. 前摇完成前死亡，复活后新 Q（`ticks=224`，通过）

夹具：蓝 `(0,0)`、红 `(1,0)`，`hpRegen=0`，蓝 HP 预置 1。

| tick | 玩家输入／直接命令 | 命令／受理 | 规则事件与状态 |
|---|---|---|---|
| 1 | 红方 `attack` 蓝方（直接命令，非玩家点击） | accepted | `castStarted basicAttack id=1`（红方，`commitTick=8`） |
| 4 | 右键点红方 | `attack` accepted | 蓝方 `castStarted basicAttack id=2`，`commitTick=11`，玩家仍存活 |
| 5 | `q` + 左键 `(4,0)` | `cast Q` accepted, `queued=true` | 队列 Q；蓝方前摇仍在 |
| 8 | 无 | 无 | 红方普攻 `castResolved id=1`，生成真实投射物 |
| 9 | 无 | 无 | 投射物命中：`basicAttackHit` + `heroDamaged`（`hpDamage=1`）；`castCancelled basicAttack id=2 reason=dead`；队列清空；无 Q `castStarted` |
| 219 | 无 | 无 | 复活于 `(-94,1.2)`，HP／法力恢复，队列为空、无施法 |
| 220 | `q` + 左键 `(-90,1.2)` | `cast Q` accepted（非 queued） | `castStarted Q id=3`；法力 330 → 290.267；`cooldowns.Q=134` |
| 224 | 无 | 无 | `castResolved Q id=3` |

结论：死亡发生在 `commitTick=11` 之前，清掉排队 Q 与进行中的普攻前摇，没有伪造释放；
复活后的新 Q 由真实按键＋点击受理并正常释放。

## 最短可复现命令带与完整 SHA-256

命令带为 seed、内容版本、席位、夹具描述与“每 tick 非空命令”；不含渲染状态。
`fullTraceSha256` 覆盖逐 tick 的 inputs／commands／directCommands／results／events／状态／hash。
实际打印值如下（完整 64 位十六进制）：

| 段 | ticks | commandBandSha256 | fullTraceSha256 |
|---|---|---|---|
| Q→W→Stop | 30 | `0c57c566c138ff82f853823f623dfe696b0cfade938af6560efab8788d7bde62` | `b0dcc4b38cb4adf4f78a4d0603915d641e6a075e843487d23c363ac90748de17` |
| W 瞄准取消→Q | 7 | `e45c21099afcf1e26934bc61836836476cc9ace685edfb2da53ae3e0f4ee9637` | `0ff3e2bad1b21bc769e05a24118ef5a1842d9b80f96d9eaab30cb1d2ad8ad14f` |
| 同槽 Q→Q | 18 | `4d8c31e89cc1369430774b203d720d2aa4a85633e0267e89cb5c7e9e5dc55d22` | `8227d4c2d2aa6500a77a894a36c4e0d0d4381cf7dd55fb440c17dab194422301` |
| 不同槽 Q→W | 13 | `4f816355aee5116457d62ac8ac18fafaf56b94a6400a3909f591e3bc9e56a0fe` | `ab9e97470f34b8392eec89682c3296cb293f1bf5c00478e44082784a767051c4` |
| 连续带（含 Stop 恢复与 Q 中排 W） | 11 | `c9c59cb6fa9312987ac6bd891f31dea2ccb9ae2e5b57394f9274c8c76d06879b` | `2f10046f7425b6960e33e2d9cbead56941fce6c111678f2c375410f693cc5706` |
| 死亡→复活→Q | 224 | `a4c89aad6d0e8d4a2ef863544a83b079b1867b50a62952e89a3ac7a72c0f7a40` | `d99645aa7ad2b06a45185c58248996b067fb00ca2a1970ba1d8aec197080e8fa` |

对应命令带（`stableStringify` 规范化后实际内容）：

```json
{"commands":[{"commands":[{"heroId":9,"targetId":10,"type":"attack"}],"tick":1},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":2},{"commands":[{"direction":{"x":0,"z":1},"heroId":9,"point":null,"slot":"W","targetId":null,"type":"cast"}],"tick":3},{"commands":[{"heroId":9,"type":"stop"}],"tick":4}],"contentVersion":12,"fixture":"veyra blue (0,0) vs veyra red (5,0), hpRegen 0","heroIdsByTeam":[["veyra"],["veyra"]],"heroesPerTeam":1,"seed":1,"tickRate":30}
```

```json
{"commands":[{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":3}],"contentVersion":12,"fixture":"veyra blue (0,0) vs veyra red (5,0), hpRegen 0","heroIdsByTeam":[["veyra"],["veyra"]],"heroesPerTeam":1,"seed":1,"tickRate":30}
```

```json
{"commands":[{"commands":[{"heroId":9,"targetId":10,"type":"attack"}],"tick":1},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":2},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":3}],"contentVersion":12,"fixture":"veyra blue (0,0) vs veyra red (5,0), hpRegen 0","heroIdsByTeam":[["veyra"],["veyra"]],"heroesPerTeam":1,"seed":1,"tickRate":30}
```

```json
{"commands":[{"commands":[{"heroId":9,"targetId":10,"type":"attack"}],"tick":1},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":2},{"commands":[{"direction":{"x":0,"z":1},"heroId":9,"point":null,"slot":"W","targetId":null,"type":"cast"}],"tick":3}],"contentVersion":12,"fixture":"veyra blue (0,0) vs veyra red (5,0), hpRegen 0","heroIdsByTeam":[["veyra"],["veyra"]],"heroesPerTeam":1,"seed":1,"tickRate":30}
```

```json
{"commands":[{"commands":[{"heroId":9,"targetId":10,"type":"attack"}],"tick":1},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":2},{"commands":[{"direction":{"x":0,"z":1},"heroId":9,"point":null,"slot":"W","targetId":null,"type":"cast"}],"tick":3},{"commands":[{"heroId":9,"type":"stop"}],"tick":4},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":7},{"commands":[{"direction":{"x":0,"z":1},"heroId":9,"point":null,"slot":"W","targetId":null,"type":"cast"}],"tick":8}],"contentVersion":12,"fixture":"veyra blue (0,0) vs veyra red (5,0), hpRegen 0","heroIdsByTeam":[["veyra"],["veyra"]],"heroesPerTeam":1,"seed":1,"tickRate":30}
```

```json
{"commands":[{"commands":[{"heroId":10,"targetId":9,"type":"attack"}],"tick":1},{"commands":[{"heroId":9,"targetId":10,"type":"attack"}],"tick":4},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":5},{"commands":[{"direction":{"x":1,"z":0},"heroId":9,"point":null,"slot":"Q","targetId":null,"type":"cast"}],"tick":220}],"contentVersion":12,"fixture":"veyra blue (0,0) hp=1 vs veyra red (1,0), hpRegen 0","heroIdsByTeam":[["veyra"],["veyra"]],"heroesPerTeam":1,"seed":1,"tickRate":30}
```

注意死亡段 tick 1 的 `heroId:10` 命令是对手红方的直接命令，不是玩家按钮；tick 4、5、220
才是玩家的真实右键／Q 点击。测试摘要的 digest 同时打印 `inputs`、`commands` 与
`directCommands`，读者可按 `inputs` 为空、`directCommands` 非空区分两者。

## 重放与采样结果

每个场景都执行三次全新 `Simulation` 重放，采样周期分别为 1／2／5 tick：

- 每个重放在每个 tick 断言 `finalHash()` 等于原记录的 `hash`；
- 每个重放完整比较每次 `step` 返回的 `accepted`／`queued`／`reason`；
- 每个重放逐 tick 深度比较 `snapshot().events`，含顺序和完整 payload；
- 在 `tick % cadence === 0` 时取 `snapshot()` 玩法投影，与主记录同 tick 投影深度相等；
- 三次重放的最终 `finalHash()` 与该段最后记录相等。

结果：六段全部通过，未出现任何 tick 分歧。`snapshot()` 只读；按 1／2／5 tick 采样
没有改变玩法 hash、状态或事件。该结论只说明渲染采样不会影响玩法结果，不代表真实浏览器
每帧耗时或输入延迟。

## 缺陷与合同冲突

- 新增连续段没有暴露“按键已受理、规则却漏释放”或“重复释放”的新缺陷；因此本单元
  没有留下失败用例，也没有改生产代码。
- 两处“受理但不出手”是现行合同明确行为，不是缺陷：
  - `Stop` 在普攻前摇中立即清空单槽队列并取消普攻，证据为第 1 段 tick 4；
  - 死亡在普攻前摇完成前清空队列并取消前摇，证据为第 6 段 tick 9 的
    `castCancelled basicAttack reason=dead`。
- 未自行引入“最后输入优先”之外的新规则；替换语义直接来自 `docs/brief.md`、
  `docs/feel.md` 和 `src/sim/simulation.ts` 的 v12 分支。未发现文档与实现冲突。
- 测试摘要中 `results` 的 `queued` 是 `CommandResult.queued` 的投影，
  不代表释放；正式释放只看 `events` 的 `cast*`。

## 实际运行与未运行

已运行：

- `./node_modules/.bin/vitest run tests/client/queued-skills-sequence.test.ts`：
  6 个用例全部通过，退出码 0。
- 修正本文覆盖描述后，同命令追加 `tests/command-buffer.test.ts`、
  `tests/client/bindings-consumer.test.ts` 重跑：3 个文件 23 项全部通过
  （6／9／8），退出码 0；六段 `commandBandSha256`／`fullTraceSha256` 与上表一致。
- `npm test`（仓库脚本 `vitest run`）：88 个测试文件，574 项，573 通过、1 失败，
  退出码 1；新增文件 6/6 通过。唯一失败为
  `tests/client/audio-skill.test.ts > critical palette failure falls back to cast...`，
  `expected [] to deeply equal ['cast.ogg']`。把新增测试文件移出后单独重跑该文件仍
  同样失败，且该失败与本文件无共享夹具，属既有、未修改范围的失败；按任务要求保留，
  未修断言、未改该测试或生产代码。
- `unit-test npm` 包装器拒绝本项目 runner，返回
  `unsupported_npm_test_script: retain the project runner, coverage and explicit concurrency`；
  随后按仓库 `package.json` 原入口直接运行 `npm test`，未改测试选择或并发设置。

未运行：

- 浏览器 smoke、截图、Canvas／WebGL、GPU、音频与任何可见窗口操作；
- 真人试玩、逐帧画面／动画衔接、输入到屏幕延迟、手感与音画同步评价。
  本文件只是 CPU／DOM 连续时序证据，不能替代这些验收。

## 既有产品整合复验

原回交两文件复用于既有战斗整合分支，未重启原任务或改写原结果分支。仅将主跑／重放接到生产 `commandFrame`，补足逐 tick 事件比较；六组原命令带及完整 trace SHA-256 不变。原交回的本机测试数字保留为历史，不等同于当前整合构建；当前组合测试、构建及未过门槛见 [产品整合记录](death-trial-integration.md)。
