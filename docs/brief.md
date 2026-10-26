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
| 制作链 | [3D](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/3d.md)、[动画](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/animation.md)、[技能特效](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/materials.md#把候选交成整招而不是一段漂亮特效)、[音频](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/audio.md)、[2D 图标](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/assets/2d.md) | 英雄模型与动作、整招特效、技能音效、技能图标从制作到接入，再做一次修改 |

## 技术默认

- **TypeScript + Vite，Three.js 渲染**，与 Star-Rush 共用渲染经验。
- **模拟**：30 Hz 固定逻辑帧，渲染插值。只接受输入命令，按“种子 + 命令序列”可复现；对局结束输出状态哈希。Riot 为 League 服务器做确定性，最初是为了用录制的输入做快速、可重复的测试，后来又用于赛事中把对局恢复到之前的时间点（Chronobreak）。
- **寻路**：[recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)，即 Recast/Detour 的 WebAssembly 版本，Unreal 的导航网格用同一套算法；小兵用 Detour crowd 做群体避让。
- **英雄 AI**：效用打分选意图（补兵、换血、撤退、推塔、支援），再由状态机执行；难度靠反应延迟、技能命中误差和决策噪声区分，不靠数值作弊。
- **素材**：优先许可清楚的 CC0 低多边形角色与动作包，再用 a1dbv 制作链补缺和统一风格。
- 换掉任何一项，在本节写一句理由。

## 自动验收目标

**这些是逐步校准的目标，不是合入门槛。** 能玩、`npm test` 和构建通过、没有新增异常，就合入 `main`；没达标的指标写进下面的“当前差距”，在 `main` 上继续改。不要把可玩的版本长期留在候选分支。

`npm run sim -- --games 200 --seed 1` 的目标：

- 0 异常，0 卡死：有移动目标、未被控制也未在施法的单位，静止不超过 10 秒；
- 镜像对局按阵营统计：用多个种子跑满 500 局以上，蓝方胜率的 95% 置信区间应覆盖 50%，用来检查地图对称；
- 高难度对低难度机器人胜率不低于 80%；
- 对局时长中位数在 8–12 分钟（模拟时间）；
- 同一种子和命令序列重放两次，状态哈希一致；
- 输出每个技能的施放次数、命中率和伤害占比，作为数值修改前后的对照。

验收时显式启用目标检查，统计报告始终保留，任何适用项失败都返回非零；不带开关的探索运行成功不代表目标已通过：

```sh
npm run sim -- --games 200 --seed 1 --verify-targets normal
npm run sim -- --games 500 --seed 201 --verify-targets mirror
npm run sim -- --games 200 --seed 1 --blue-difficulty high --red-difficulty low --verify-targets difficulty
```

三个 profile 分别检查正常链、镜像对称和高低难度；单个 profile 通过不代替另外两组。镜像按连续不同种子运行，未终局始终留在分母；回放检查需实际执行，`--replay-count 0` 不能通过验收。

## 当前差距

- 2026-10-26：200 局里 1 局超时（seed 136），高难度对低难度胜率 74%（目标 80%）。

## 里程碑

1. **可玩**：1 名玩家英雄对 1 名机器人英雄，小兵、塔、基地、成长和胜负完整；自动和浏览器验收通过，手感与画面进入待人工验收。顺序：先做模拟层和无画面 `sim`，再接占位几何渲染和操作，最后换正式素材。
2. **第二次需求修改**：加第 2 名英雄，并把一个已有技能从指向改为方向弹道。按 [05 §11](https://github.com/dbvv1/a1dbv/blob/main/domains/game-dev/05-gameplay-architecture.md#11-给-ai-第二次修改的最小契约) 记下改了哪些文件、哪些资源要重做、回放和数据是否仍兼容。
3. **扩展**：3v3、第 3 名英雄、野区，在第 2 步完成后再定。

## 不做

联网对战、匹配排位、商城、皮肤、反作弊。以后要联网，在确定性模拟上做帧同步，另开里程碑；届时再处理浏览器之间浮点数学结果不一致的问题。

**依据**：Riot Games，[Determinism in League of Legends: Introduction](https://www.riotgames.com/en/news/determinism-league-legends-introduction)（2017-06-20，[一手]，2026-10-26 读原文）；[recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js)、[Recast/Detour](https://github.com/recastnavigation/recastnavigation)（[一手]，2026-10-26 核仓库）。验收区间是本案例的初始目标，首轮模拟后按实际数据校准。
