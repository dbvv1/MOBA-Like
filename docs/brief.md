# MOBA-Like 设计任务书

设计变化直接改本文件；进度和阻塞写在 a1dbv TASKS。

## 目标

一局约 10 分钟的单线 MOBA：玩家操控一名英雄，和机器人一起推掉对方基地。品质重点有三项：技能出手和命中的手感、团战中看得懂谁在做什么、机器人的决策像人。

## 第一个可玩版本

- **地图**：一条兵线，双方各一座基地、两座塔、一个兵营。野区以后再加。
- **英雄**：先做 1 名，双方用同一英雄镜像对局；模拟层按 3v3 设计，实体数量和 AI 不写死。每名英雄 3 个技能加 1 个大招。第 1 名英雄至少包含指向技能、位移、持续效果和控制；方向弹道、范围和护盾随第 2 名英雄补齐。
- **对局**：小兵波次、塔的仇恨规则、金币与经验、等级成长、少量装备、胜负结算。
- **操作**：俯视角 3D；右键移动，QWER 施放，A 加左键攻击移动；镜头可锁定或拖边移动。

## 要跑通的 a1dbv 模块

| 模块 | a1dbv 页面 | 在本案例验证什么 |
|---|---|---|
| 技能与效果 | [05 §7](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#7-战斗与技能先统一结算再决定-gas) | 定义、施放、效果、表现分层；效果堆叠、时钟、快照、净化与免疫在真实对局里是否够用 |
| 战斗可读性 | [05 战斗质量](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#战斗质量让玩家读懂承诺接触与下一步)、[04 打击反馈](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/04-client-modules.md#打击感与反馈先让命中有含义再让重击有分量) | 预警、命中和受击在多单位同屏时是否仍看得懂 |
| 英雄与小兵 AI | [05 §3](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#3-状态机与行为树先定义打断关系)、[追击与让路](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#追击与让路有路径不等于走得自然) | 补兵、换血、撤退、推塔、集火；用无画面对局评估。效用打分选意图 a1dbv 还没有专节，跑通后回填 05 §3 |
| 镜头与输入 | [05 §8](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#8-相机先让玩家看懂并控得住再增加镜头语言)、[04 菜单与改键](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/04-client-modules.md#接入手柄暂停与多人菜单) | 俯视镜头、施放指示、改键与设置保存 |
| 局内成长 | [05 局内奖励](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#reward-choice) | 借用其中的奖励节奏判断；等级与装备曲线 a1dbv 还没有专节，跑通后回填 |
| 性能 | [04 性能诊断](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/04-client-modules.md#压低卡顿与设备耗用) | 满兵线、技能齐放时的帧时间与归因 |
| 制作链（可玩版合入后） | [3D](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/3d.md)、[动画](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/animation.md)、[技能特效](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/materials.md#把候选交成整招而不是一段漂亮特效)、[音频](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/audio.md)、[2D 图标](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/2d.md) | 英雄模型与动作、整招特效、技能音效、技能图标从制作到接入，再做一次修改 |

## 技术默认

- **TypeScript + Vite，Three.js 渲染**，与 Star-Rush 共用渲染经验。
- **模拟**：30 Hz 固定逻辑帧，渲染插值。只接受输入命令，按“种子 + 命令序列”可复现；对局结束输出状态哈希。Riot 为 League 服务器做确定性，最初是为了用录制的输入做快速、可重复的测试，后来又用于赛事中把对局恢复到之前的时间点（Chronobreak）。
- **寻路**：[recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)，即 Recast/Detour 的 WebAssembly 版本，Unreal 的导航网格用同一套算法；小兵用 Detour crowd 做群体避让。
- **英雄 AI**：效用打分选意图（补兵、换血、撤退、推塔、支援），再由状态机执行；难度靠反应延迟、技能命中误差和决策噪声区分，不靠数值作弊。
- **素材**：优先许可清楚的 CC0 低多边形角色与动作包，再用 a1dbv 制作链补缺和统一风格。
- 换掉任何一项，在本节写一句理由。

### 可显式选择的 v9 单位阶段

`--content-version 9` 在单位阶段入口统一读取资格、目标与射程，先收集意图并提交全部移动，再结算已经承诺的普攻，最后统一标记死亡并发放奖励。移入射程要等下一单位阶段，移出射程不取消本阶段已经承诺的攻击；双方致命攻击可以互杀。护盾先吸收伤害，同一目标的敌方攻击者按稳定实体 ID 处理，以有效伤害首次跨过零血量的攻击获得原有击杀奖励，而不是改成最大贡献分配；后续已承诺挥击仍消耗攻击间隔，但不计尸体伤害。经验范围采用共同移动后的位置，已在本阶段死亡的旁观英雄不获得小兵范围经验；阵亡击杀者可得已承诺击杀的经验，但升级不会让死者恢复正生命值。

这只改变单位阶段，不把技能、弹道与塔的其他阶段宣称为全局同时结算或完全公平；旧 v1/v2/v7/v8 回放保留原行为。CLI 与网页默认仍为 v8，v9 供显式比较。原无英雄波线曾仅因遍历次序自行形成优势；v9 的同一对称波线保持位置与血量对称，直到时限也不自行决出胜负，需要英雄参与推进。

## 合入门槛

能玩、`npm test`、构建和 `npm run smoke` 通过、没有新增异常，就合入 `main`；可玩的集成版不留在候选分支，没达标的指标写进“当前差距”在 `main` 上继续改。

模拟层的合入门槛只有两条：`npm run sim -- --games 200 --seed 1` 0 异常、0 卡死（有移动目标、未受控也未施法的单位静止不超过 10 秒），同一种子和命令序列重放两次状态哈希一致。镜像胜率、高低难度胜率（目标 80%）、对局时长（目标 8–12 分钟）和技能施放／命中／伤害占比是调参报告：每次改数值前后跑一遍对照，结果写进“当前差距”，不阻塞合入。

## 当前差距

- 2026-10-26，`sim` 新对局默认 v8：正常 200 局（seed 1 起）有 1 局超时（seed 136），时长中位数 709.43 秒；高低难度 182/200（91%），中位数 543.77 秒；镜像 500 局（seed 201 起）蓝方 278/500，95% 区间 [51.22%, 59.90%] 未覆盖 50%，中位数 709.53 秒。三批无新增异常或卡死；这些未达标项继续校准，不宣称已解决。
- v8 继承 v7 的存活外塔锚点资格与原退路；另外在自身死亡、已知敌人死亡或移除时清理目标首次识别计时，复活近距重见后重新等待既有难度反应时。现模拟没有战争迷雾，死亡属于现有全状态信息；这是感知记忆生命周期，不是所有行动的统一反应锁，也不保证锚点无威胁。显式 v1/v2/v7 的行为与回放保持。
- 显式 v9：正常 200 局仍有 1 局超时，但变为 seed 13，中位数 708.27 秒；高低难度 168/200（84%），中位数 551.03 秒；镜像 500 局蓝方 256/500，95% 区间 [46.83%, 55.56%] 覆盖 50%，中位数 682.43 秒。三批无异常或卡死、各 3 次回放哈希相同；这次超时仍是调参差距，不能把旧 seed 136 结束或镜像统计改善说成所有问题已解决。
- 历史对照：默认升级前 v2 正常 200 局同样有 seed 136 超时，高低难度 176/200（88%）；74% 属于未采用的 v3 恢复候选。v7 三批胜负与上述 v8 相同，但部分时长和技能统计不同，不能混用完整报告。

## 里程碑

1. **可玩**（当前）：浏览器打开即可操控 1 名英雄对 1 名机器人英雄打完一局，小兵、塔、基地、成长和胜负完整，占位美术即可；手感与画面进入待人工验收。顺序：先做模拟层和无画面 `sim`，再接占位几何渲染和操作，最后换正式素材。
2. **第二次需求修改**：加第 2 名英雄，并把一个已有技能从指向改为方向弹道。按 [05 §11](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#11-给-ai-第二次修改的最小契约) 记下改了哪些文件、哪些资源要重做、回放和数据是否仍兼容。
3. **扩展**：3v3、第 3 名英雄、野区，在第 2 步完成后再定。

## 不做

联网对战、匹配排位、商城、皮肤、反作弊。以后要联网，在确定性模拟上做帧同步，另开里程碑；届时再处理浏览器之间浮点数学结果不一致的问题。

**依据**：Riot Games，[Determinism in League of Legends: Introduction](https://www.riotgames.com/en/news/determinism-league-legends-introduction)（2017-06-20，[一手]，2026-10-26 读原文）；[recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)、[Recast/Detour](https://github.com/recastnavigation/recastnavigation)（[一手]，2026-10-26 核仓库）。验收区间是本案例的初始目标，首轮模拟后按实际数据校准。
