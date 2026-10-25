# 角色供给预检入口

当前只完成候选与许可入口核对，尚无通过资产验收的供给起点。下一次实际验证优先选 Quaternius Animated Knight：单个近战角色及配件，比 52 模型全集更贴近镜像英雄切片；先验证其 Idle／Walk／Run／Attack／Death，再决定技能动作缺口。此选择依据官方内容说明，不代表品质排名或动作已存在于下载文件。

| 官方候选 | 页面可读事实 | 对当前切片的取舍 |
|---|---|---|
| [Animated Knight](https://quaternius.com/packs/knightcharacter.html) | 2018-07；CC0；FBX、OBJ、Blend；骑士与剑、头盔等配件 | 优先小样；角色风格更接近近战英雄，实际包内结构待验 |
| [Ultimate Animated Character](https://quaternius.com/packs/ultimatedanimatedcharacter.html) | 2019-11；52 模型；CC0；FBX、OBJ、Blend | 比本次一名镜像英雄所需范围大，不下载全集 |
| [Mini Characters](https://kenney.nl/assets/mini-characters) | 1.0，2024；25 文件；CC0；标注 Animation | 小人轮廓值得比较；网页没有证明战斗动作覆盖 |
| [Animated Characters Protagonists](https://kenney.nl/assets/animated-characters-protagonists) | 1.0，2020；8 文件；CC0；现代人物主题 | 美术主题较远，且具体骨架／动作接口未验 |

来源核实：2026-10-25 UTC，浏览工具读取上述官方页面；[作者发布页](https://quaternius.itch.io/lowpoly-animated-knight)列 Idle、Death、Jump、Roll、Run、Walk、Attack，仍属说明而非解析结果。版本未给修订号的候选只能以成功下载后的 SHA-256 冻结，不能把网页月份当文件版本。

[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)允许复制、修改、分发和商用；不授予商标、专利或第三方人格权，不保证无第三方权利。官方资产页声明 CC0，但本轮未取得包内许可，不把页面许可替代包内核对。[Kenney 导入文档](https://kenney.nl/knowledge-base/game-assets-3d/importing-characters-and-animations)说明该系列模型、皮肤、动画可分文件；适用范围有限，不能据此断言 Mini Characters 结构相同。

## 恢复后的最小实际实验

所有源文件、依赖配置、脚本和派生物留在本目录；不读取或改写模拟工程接口。无引擎集成依赖。

1. 取得一个作者提供的小包，记录下载 URL、日期、字节数及 SHA-256，保留原始许可；只提取一个角色、必要贴图与动作。`source/` 保持原字节；`derived/` 才放转换结果。
2. 用已有 Blender 4.3.2 的后台 Python API 实际加载源 Blend 或 FBX，报告网格顶点／三角形、材质及纹理路径、骨骼层级、蒙皮权重、Action 名称与帧范围。记录单位、对象变换、世界包围盒及朝向；不要凭文件扩展名判通过。禁用源文件 Python 自动执行。
3. 首版导出 GLB 后重新导入，验证实际网格、蒙皮与动作。选一个明确命名的衣甲材质做蓝队配色，只改该材质 Base Color；若为图集则先核 UV 和颜色区域再决定配方，不整张替换导致肤色变化。
4. 二改前后比较拓扑、顶点、骨骼静止矩阵、蒙皮、动作关键帧／采样姿态和未改材质；把允许变化列表限定为选中材质。分别保存可编辑 Blend 与运行候选 GLB；导出器可能重排数据，跨格式不能仅比文件哈希。
5. 脚本正常路径、缺失源、损坏源和不符合骨架／动作接口都要实际跑；缺失输入应非零退出。取得真实源文件前不提交猜测字段的“通过”脚本。

这份配方不是已实现脚本。当前没有源资产、哈希、首版、二改或验收产物。工具探测 `blender --version` 成功（4.3.2）；未安装依赖、未付费、未下载权重。实际游戏集成、动画观感、团战可读性、运行性能均未知。
