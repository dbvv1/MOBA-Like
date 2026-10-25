# 可运行的配色二改预检

已用 **自有合成夹具** 跑通 Blender 4.3.2：两个网格（合计 16 顶点／24 三角形）、两根骨骼、两个材质和两段真实使网格变形的动作。只将 `Accent` 从红色改蓝色；源字节、拓扑、UV、蒙皮、骨架、动作关键帧／采样变形及另一个材质保持。首版与二改 GLB 都能重新导入。**第三方角色尚未取得，角色供给起点仍缺；这些方块不能代表真人形动作或美术品质。**

从仓库根运行（只需已安装的 Blender 4.3.2 和 Python 3，无 pip/npm 依赖）：

```sh
blender -b --factory-startup --disable-autoexec --python-exit-code 1 --python asset-pipeline/scripts/preflight.py -- --source asset-pipeline/source/fixture.blend --output asset-pipeline/derived --source-kind own_synthetic_fixture
python3 asset-pipeline/scripts/test_preflight.py
```

从程序重新生成源夹具：

```sh
blender -b --factory-startup --disable-autoexec --python-exit-code 1 --python asset-pipeline/scripts/make_fixture.py -- asset-pipeline/source/fixture.blend
```

重新保存 Blend 的字节哈希可能随 Blender 序列化改变；以本次 `derived/report.json` 的源／派生哈希为准，不把重新生成的哈希不同视为几何不同。

| 文件 | 角色 |
|---|---|
| `scripts/make_fixture.py`、`source/fixture.blend` | 自有、可重新生成的源夹具；源许可见 `source/LICENSE.txt`，CC0 |
| `scripts/preflight.py` | 实际调用 Blender 解析、改色、导出并重导入的脚本；仅支持单骨架 Blend、非贴图连接的 Principled Base Color |
| `derived/first.glb` | 未改色的首版导出 |
| `derived/blue.blend`、`derived/blue.glb` | 可继续编辑的二改工程和 GLB |
| `derived/report.json`、`derived/test-results.json` | 本地生成、Git 忽略的运行结果；测试日志也留在忽略的 `.test-work/` |

源单位为米、Z 向上，夹具手臂向 +X；包围盒为 `[-0.3,-0.2,0]` 至 `[1.1,0.2,1.4]`，glTF 导出转换为 Y 向上。重导入恢复同样包围盒。GLB 顶点因面法线／UV 接缝从 16 拆为 48，三角形不变；动作名增加骨架后缀且关键帧烘焙，不要求跨格式字节或 FCurve 数相同。导入时保持 30 fps，避免默认 24 fps 使动作帧号变化；比较两次 GLB 的结构与采样变形，并核源与导出的动作帧范围、骨数、三角形和尺寸。

未改部分的严格比对发生在同格式的二改前后；这不是任意 Blend→GLB 无损转换证明。脚本对缺失／损坏源、缺动作、缺目标材质真实非零退出；失败重跑会移除旧通过报告，可能保留旧或部分输出文件，只有本次退出 0 且存在匹配哈希的报告才是通过；动作抽样为首、中、末三处，并非完整运动质量检查。Blender 无 Draco 库提示不影响未压缩导出，本轮不验证压缩。没有渲染、试听或运行游戏；动画观感、真实角色蒙皮、俯视可读性及游戏集成均未知。无付费、无依赖安装、无模型权重下载；全部源与派生资产约 200 KB，CPU 后台单轮约两秒（不含调查和编码）。

## 第三方选择与剩余缺口

暂选 **KayKit Adventurers** 作为下一次独立来源验证对象：官方 GitHub 包描述四个人形冒险者和战斗相关动作／配件，比骷髅主题更贴近当前镜像英雄。官网当前版与 GitHub 1.0 的内容描述存在差异，下载后必须固定 commit 和文件 SHA-256，不能混用两版数量。该候选没有通过真实资产解析。

| 官方来源 | 可读证据与取舍 |
|---|---|
| [KayKit Adventurers 官方 GitHub](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)／[作者发布页](https://kaylousberg.itch.io/kaykit-adventurers) | 不同作者的独立来源；仓库描述四角色、75 动作、FBX／glTF、CC0。作者当前发布页表示基础移动动作及额外免费动作包；本轮不将其等同于仓库 1.0。官方文件树 API 云端请求 403，未取得源码或 LICENSE.txt |
| [KayKit Skeletons 官方 GitHub](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0) | 官方描述四个骷髅、90+ 动作、CC0；题材较偏，不为本次扩下载量 |
| [Quaternius Animated Knight](https://quaternius.com/packs/knightcharacter.html) | 2018-07；官方列 CC0、FBX／OBJ／Blend、骑士和配件。原候选未验，保留作对照 |
| [Quaternius Ultimate Animated Character](https://quaternius.com/packs/ultimatedanimatedcharacter.html) | 2019-11；52 模型、CC0；范围较大；其官方页云端取回 403，停止 |
| [Kenney Mini Characters](https://kenney.nl/assets/mini-characters)／[Protagonists](https://kenney.nl/assets/animated-characters-protagonists) | 官方列 CC0；分别 1.0／2024／25 文件和 1.0／2020／8 文件。Mini 战斗动作覆盖未知，Protagonists 主题偏现代；后者官方页云端取回 403，停止 |

以上均为官方页面调查，核实日期 2026-10-25 UTC；不按宣传或星数作品质排名。[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)允许修改、分发及商用，不授予商标／专利／第三方人格权，也不保证无第三方权利。本轮没有第三方源文件、包内许可或哈希，精确请求结果保留在历史版本的 `source-status.json`，不作为运行资产提交。三次被拒的取回动作均保持停止，没有改走镜像或不同传输方式取得同一资产。

恢复后只需接续原任务：取得一个官方角色与所需动作及包内许可，冻结来源，再依据其材质和骨架接口适配现有脚本。若素材是图集，当前单色配方会拒绝连接的 Base Color；不能整张替换而改变肤色，也不能假设动作包与角色骨架自动兼容。
