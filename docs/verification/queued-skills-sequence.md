# v12 前摇排队：输入、受理与释放的连续验证

**修改指令缓冲时，先跑真实 Controls 到 Simulation 的六段连续回归，再分别验玩家看到的取消与释放。** 本测试接受已有交回，并补齐两个独审发现的缺口：Esc 后先点击有效地面，确认旧 W 模式确实撤下，再按 Q；重放除玩法 hash 外直接比较表现事件，避免状态相同掩盖反馈丢失。

## 运行与覆盖

```sh
npx vitest run tests/client/queued-skills-sequence.test.ts
npm test -- --maxWorkers=1 --no-file-parallelism
```

测试使用生产 `createControls`、真实 Detour 与 `contentVersion: 12` Simulation。v12 是 `candidate.html?commands=buffer-v1` 的显式旁置，不是默认版本；本次只接收测试与说明，不改变游戏入口、规则、资源或部署。

- 普攻前摇中 Q→W→Stop：已受理的排队技能可以合法取消，不能把 accepted 当成 released。
- W 瞄准→Esc→有效地面点击→Q：先核瞄准从 W 变为空且点击不发命令，再核新 Q 真正释放。
- 同槽两次 Q：只消耗一次施法机会、只产生一次 Q 释放。
- Q 被后来的 W 替换：按原单槽合同仅 W 释放。
- Stop 后恢复输入，Q 前摇内排 W：W 在 Q 释放当 tick 接续。
- 普攻前摇内死亡→复活→新 Q：死亡清队，复活后的新输入才释放。

每 tick 记录输入、命令、CommandResult、cast 事件、法力／冷却与位置。全新 Simulation 重放同一命令带，每 tick 比较权威状态 hash 和受理结果；按 1／2／5 tick 取快照时比较玩法投影及当步事件，cadence 1 覆盖全部事件。法力被记录并重放比较，没有独立费用 oracle，不将其称为精确消耗规则的独立验证。

## 证据边界

输入来自合成 EventTarget 与固定 aim，不是浏览器键鼠；夹具预置位置、关闭回血，死亡段把初始 HP 设为 1，致死与复活仍由真实模拟推进。命令直接经 legacy `Simulation.step(SimCommand[])`，不覆盖当前 `LocalMatch` 的席位／tick／重试信封。原有 `command-buffer`、`bindings-consumer` 与 `command-frame` 各自测试仍保留。

SHA 是本次诊断输出，不是写死在测试中的黄金值；运行时会打印完整命令带与关键 tick。下表按上方六段排序，便于同版本复跑对账，不用摘要替代语义断言。

| 段 | tick 数 | commandBand SHA-256 | fullTrace SHA-256 |
|---|---|---|---|
| 1 | 30 | `0c57c566c138ff82f853823f623dfe696b0cfade938af6560efab8788d7bde62` | `b0dcc4b38cb4adf4f78a4d0603915d641e6a075e843487d23c363ac90748de17` |
| 2 | 7 | `e45c21099afcf1e26934bc61836836476cc9ace685edfb2da53ae3e0f4ee9637` | `d79e401653a903b4835bbe8ef2ac21f7a5b6ea57fa673f05e806e3a1a737458d` |
| 3 | 18 | `4d8c31e89cc1369430774b203d720d2aa4a85633e0267e89cb5c7e9e5dc55d22` | `8227d4c2d2aa6500a77a894a36c4e0d0d4381cf7dd55fb440c17dab194422301` |
| 4 | 13 | `4f816355aee5116457d62ac8ac18fafaf56b94a6400a3909f591e3bc9e56a0fe` | `ab9e97470f34b8392eec89682c3296cb293f1bf5c00478e44082784a767051c4` |
| 5 | 11 | `c9c59cb6fa9312987ac6bd891f31dea2ccb9ae2e5b57394f9274c8c76d06879b` | `ba72b262f3468889edde98c1ca991e6c71f4d556af1615dacfdeac03975fee87` |
| 6 | 224 | `a4c89aad6d0e8d4a2ef863544a83b079b1867b50a62952e89a3ac7a72c0f7a40` | `d99645aa7ad2b06a45185c58248996b067fb00ca2a1970ba1d8aec197080e8fa` |

## 接收

2026-11-09 在 `5254991` 上复验：Node 24.22.1，锁定依赖；六段通过，完整 88 文件／574 项通过，模拟构建与网页类型／构建通过。原交回报告的 audio-skill 单项失败本次未复现，不据此宣称所有平台均已修复。网页构建仍有大 chunk 提示。

独立审查接收修后的测试范围。浏览器 smoke、屏幕延迟、画面、声音与手感未运行；原品质分、旁置候选合入门槛和网站版本不变。原调用终态未知，本次接收不释放其槽位或重派。

来源：[原交回与历史运行记录](https://github.com/dbvv1/MOBA-Like/blob/50fda5627dd113fe2b4019d766d71309d5c26701/docs/verification/queued-skills-sequence.md)；现行规则见 [brief](../brief.md) 与 [feel](../feel.md)。

候选整合保留上述可观察取消回归，并以生产 `commandFrame` 信封运行主序列和三种重放，逐 tick 对比完整 presentation events。
