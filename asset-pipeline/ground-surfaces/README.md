# 路肩局部簇候选：保住战斗留白

**有限采用：局部路肩接地层。** 2026-10-26 作者及根协调者分别看过实际同镜头 05/06 原图，确认路肩不再纯直线割裂、草簇不抢人物/技能虚线；收益有限，不宣称大片地表材质或品类质量完成。实际渲染源 `5b2faac`，基线 `a7d6605`，完整回执见 `review/receipt.json`。与旧 `6cab9b3` 拒绝候选独立；这里没有满铺石、叶纹理，也不继续调整旧图对比度。

## 为什么换路线

旧候选的问题是纹样遍布大面积空间、周期苔斑和技能虚线竞争；新假设用少量不等距路肩簇提供局部层次，中央 9.6 米绝不加细节，外侧大草地也不满铺。没有连续光晕、厚地块、噪声或独立展示台。

输入为 [Kenney Nature Kit](https://kenney.nl/assets/nature-kit) 2.1 的 `grass_large`、`grass_leafsLarge` 原 OBJ，两个几何形状分别为 224／144 三角形。官方页和包内许可均为 CC0；从既有共享研究 ZIP 复用，精确 URL、ZIP 与文件 SHA-256 在 `source/provenance.json`，原 OBJ/MTL 和 License 直接保留。没有复制包里的岩石，没有改 battle 资产 manifest。

上游原文件含 CRLF 与尾部空白；原字节另存 `original-source-bytes.zip`，可读文本只规范换行/空白。导出前同时核原字节、可读副本 hash 与 token 等价，不为通过 diff-check 丢掉原始身份，也不改许可词句。

[Quaternius Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) 的免费模型也是 CC0，但定制草／树 shader 和引擎工程在 Source 版；[作者及用户问答](https://www.reddit.com/r/gameassets/comments/1eiazah/)明确模型与预览 shader 的区别。因此没有把华丽预览当作免费模型已进当前引擎的效果，也没有购买或建账号。Kenney 源选中的是宽低模形状，与现有树的面密度相近；不是声称整个资产库最好。核实：2026-10-26。

## 可回改源与消费者

`source/edge-layout.json` 是可逐簇改的作者源：各簇 x/z、长宽、seed 和有限色板独立。改某簇不重生其他簇或草形；增加层次先改布局，不加密全场。`export.py` 先核原始身份，再导出只含位置／法线的固定几何；没有从颜色猜 normal。`ground-surfaces.ts` 直接使用该布局和几何，`battlefield.ts` 只有 import＋持有/释放两处接缝，原地表材质与路面保持。

30 簇、210 个草实例和 330 个平面三角形，最多 3 个不透明绘制批次，合计 40,170 三角形。**当前按整批包围球裁剪，并非逐实例裁剪；这些实际产品镜头下三个整批可见，所以屏外实例仍提交，不能把屏内草簇数当 GPU 成本。** 不加贴图、透明 overdraw、动态光、投影阴影、风动画或逐帧 CPU 更新。几何受原场景灯光，贴片接收阴影，草高小于 0.5 米；中心留白逐顶点核。位置/法线/颜色/实例矩阵静态缓冲估计 75,576 B，构建 JS gzip 增约 7.4 KB。GPU draw 的实际时间和最低设备成本仍要测，不拿实例化或小文件替代性能证据。

```sh
python3 asset-pipeline/ground-surfaces/export.py
python3 asset-pipeline/ground-surfaces/test_export.py
npm test
npm run build:web
```

本假设两轮实际产品比较已用完，不继续微调。

纯装饰三批次关闭自己的 `raycast`，不进入 `aim` 的实例／三角形相交计算；既有英雄拾取与地面指令平面不变。它们仍付对象遍历、绘制提交和顶点成本，“没有风动画”不等于零 CPU 成本。

首轮 `d2509a5` 已在真实基本战斗完成八点：战斗中心与原版清晰度相同，但脱离路沿的浅色椭圆底片像花床，作者拒绝此版。第二轮只把原簇接到路沿，并让底片与原草地同色连续相接；草形、密度、亮度与路中线不改。此轮是该假设最后一次完整比较，不以自动脚本成功替代判断。
