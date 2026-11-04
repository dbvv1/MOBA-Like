# 局内交易与升级提示音源

四个可编辑短音候选：购买成功、购买失败、升级、复活就绪。补充内容清单里的局内提示缺口，不替换战斗混音，也不改 `assets/audio/battle`、`src/audio` 或 HUD。本批只是离线 WAV 与映射元数据，未接线、未试听、未采用。

## 文件

| 文件 | 内容 |
|---|---|
| `purchase-ok.wav` | 上行两音，0.22 s |
| `purchase-denied.wav` | 下行两音，0.22 s |
| `level-up.wav` | 上行三音，0.55 s |
| `respawn-ready.wav` | 单次上扬滑音，0.50 s |
| `recipe.json` | 唯一配方：频率、分段、泛音、增益、5 ms 包络、峰值预算、事件映射与两版主频比例 |
| `generate.py` | 确定性 Python 波形生成器；同时写 `manifest.json` |
| `manifest.json` | 生成结果：格式、每段时长／峰值／字节数／SHA-256、当前与上一版频率、事件映射、未验项 |
| `test_generate.py` | 规格、边界、去重、拒收与二改测试 |

四段均为 48 kHz、单声道、PCM16 WAV；峰值统一落在 −9.1 dBFS（验收上限 −9.0 dBFS）。每个分段首尾各有 5 ms 起落保护，整段首尾再叠加一层 5 ms 起落；因此首段起点和末段终点的合成包络是两个线性因子的乘积，首末采样为 0。

## 命令

```sh
python3 asset-pipeline/ui-event-audio/generate.py          # 重建四段 WAV 与 manifest
python3 asset-pipeline/ui-event-audio/generate.py --check  # 只比对，不写文件
python3 -m unittest discover -s asset-pipeline/ui-event-audio -p 'test_*.py'
```

只用 Python 标准库。配方没有随机源、系统时间、模型、网络或现成音频；同一环境内重跑逐字节一致。`--check` 会重算并比对四段 WAV 与 `manifest.json`。

## 事件映射

元数据的 `event` 段规定每个声音只能由**实际已提交的结果**触发。HUD 文本、血条／法力条填充、剩余复活秒数、按钮可用状态和金币数字都是显示投影，不得通过比较它们的变化来猜事件。

| cue | 已提交触发源 | 明确禁止的推断 |
|---|---|---|
| `purchase-ok` | 本地玩家的 `buyItem` 命令结果为 `accepted: true` | 点击按钮、金币减少、已拥有装备的按钮变为禁用、AI 商店命令 |
| `purchase-denied` | 本地玩家商店发起的 `buyItem` 结果为 `accepted: false`，原因随事件携带（`notEnoughGold`／`alreadyOwned`／`unknownItem`） | 按钮禁用、金币低于价格、重复点击或 HUD 提示计时 |
| `level-up` | 模拟 `grantXp()` 中本地玩家 `hero.level` 已提交的增量 | HUD 等级文字、血条／法力条比例或任何 UI 侧重绘 |
| `respawn-ready` | 模拟 `updateRespawns()` 中本地玩家 `alive` 由 false 提交为 true | HUD 的 `Respawn in 0s` 或客户端倒计时到零 |

表中后两行的已提交转换目前存在于模拟，但尚未以 `PresentationEvent` 暴露。接线前需先在模拟层提交正式事件；不得由渲染／UI 侧比较等级数字或倒计时代替。一次经验发放跨多级时只播一次升级提示并携带最终等级；复活只对本人一次转换播一次。本卡不新增事件、不改模拟与 UI。

## 波形与二改

成功与失败使用相反方向的两音形：`purchase-ok` 594 → 792 Hz，`purchase-denied` 468 → 351 Hz。升级为 471 → 593 → 706 Hz 三个依次上行的短音；复活为 270 → 540 Hz 的单个柔和滑音。配方另有少量二、三次泛音，增益与泛音都可在 `recipe.json` 调整。

第二版把全批主频比例统一为 0.9（第一版为 1.0），所有分段频率同比降低，时长、音数／方向、事件身份和 −9.1 dBFS 峰值预算保持不变。`manifest.json` 的 `revisions` 与 `revisionResult` 保存两版的时长、频率、轮廓与 SHA-256：四段时长一致、轮廓一致、载荷全部重建。第二版不是听感优化结论，只是本批候选的规格修改。

## 来源与范围

配方与四段 WAV 为本仓库原创的确定性合成结果，不含第三方音频、采样库、模型权重或商业游戏素材；与仓库内其他原创程序生成素材一致，按 CC0 1.0 Universal 释出（https://creativecommons.org/publicdomain/zero/1.0/）。数值是按任务预算给出的候选，不声称最佳听感。

## 待听问题

以下都要在真实接入、完整混音和设备上判断，本批没有答案：

- 购买成功／失败在战斗音乐与技能音同播时，能否只靠上行／下行轮廓分辨；失败声是否过重、像受击。
- 升级三音是否与命中、技能释放混淆；三个短音是否显得拖。
- 复活滑音是否会被误读为技能或危险提示；尾音是否够清楚。
- 连续多次购买失败是否烦扰；四声在低音量、单声道和普通扬声器下是否仍可辨。
- 接入现有 25 ms 起音间隔和混音总线后，是否盖住必要的命中／危险提示；四段 −9.1 dBFS 峰值下实际响度层次是否合适。

已实际运行：`generate.py --check`；13 项单元测试（格式／时长／峰值／首尾 5 ms、四段字节互异且非静音、manifest 与文件一致、确定性重建、非法频率／缺参数／非法比例拒收、0.9 二改的时长与身份保持及实际音高下移）。未验：未接线、未开声音设备、未试听；四声可辨性、与战斗／音乐重叠时的遮挡、音量层次、真实设备解码与采用决定都留给 dot 另行验收。本批不宣称听感或品质达标。
