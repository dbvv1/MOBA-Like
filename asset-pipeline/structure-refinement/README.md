# 既有军事建筑的石材收边小样

三件标准建筑族：塔、兵营、基地，各保留青绿／赭红变体。当前是 **有界工艺候选，未完成游戏机位盲评／浏览器 smoke，不代表画质提升**。先在 `first-tower` 检查 320px 缩图仍有可见收益，否则停止此手段，不扩采用。

## 风格与接口

保留现行 KayKit 军事结构、投石器、旗形、屋顶、开口及低塔脚，不采用此前被否决的圆柱宝石塔／绿顶盒子兵营。原 `battle/exported` GLB 和全部原图集像素不改；源来自本仓已经取得的 KayKit Medieval Hexagon CC0 包，固定来源与许可见 [battle README](../battle/README.md)。未取第三方新资源、未调用付费或生成网关。

脚本只在原 building_ 主体中选两侧均为石材、长度至少 0.18m、夹角至少55°的封闭边，且两相邻面端点UV连续的边，做0.025m单段倒角；塔／兵营／基地分别排除135／162／715条UV接缝边，实际倒角44／114／258条边。石材／木材／其余面的粗糙度分别0.90／0.74／0.82，保留原图集颜色。材质类别按原图集的面中心颜色判定，可能误分深色石材和阴影色，须在实图检查；没有把算法分类当人工标注。非主体的投石器、旗、旗杆和塔脚顶点保持；倒角主体几何发生变化，**不是完整几何无损**。边缘焊接保留 Blender 的 loop UV 数据，但新增倒角面会插值 UV，atlas 像素一致不等于 UV 映射逐像素不变。

不改任何碰撞、导航、名义高度、角色、路面、灯光或模拟。正常页面／capture 都仅在显式 `structures=stonework-v1` 时替换六个结构 GLB；省略参数仍选择原资源。失败遵循原加载器错误与释放合同，不静默把失败当采用。

## 制作与成本

从仓库根运行：

```
blender -b --factory-startup --threads 2 --python-exit-code 1 --python asset-pipeline/structure-refinement/tools/build.py
```

Blender 4.3.2，源 GLB＋`style.json` 是可重跑输入，没有新增贴图、模型权重或外部依赖。`manifest.json` 固定源文件hash、导出hash、部件名和实际预算。两队共2,044,500B GLB：塔约3.71k三角／197KB；兵营约5.51k／305KB；基地约10.07k／520KB。主体最多三材质槽，通常比源多两次 draw；额外阴影/AO pass成本尚未实测。比原建筑增加几何和传输成本，**不称性能优化或零退化**。首次工程草稿给所有硬边倒角成本过高，现已收窄为长石边；这只是工程收敛，不计游戏机位的有意义二改。

## 验证边界与下一次比较

CPU 检查真实 GLTFLoader 消费者、六件源/输出hash、原atlas像素、每个原部件存在、逐部件包围盒偏移≤倒角宽度、未动部件顶点、实际GLB三角数及UV有限/范围、默认选路和资源恰好释放一次。它们不证明开口形状／法线／UV接缝／采样结果没有退步。

先同一 `first-tower` 机位：seed1、t10、input=march、frames1、forest-light-v1，baseline 与 stonework-v1 各双重复；保留 renderer 原始信息与软件类别。必须在原尺寸及320px并排确认塔体层次、塔冠／玩家可读性、过细闪点、UV接缝和软件成本。若首塔两位非作者都判优，再补 `spawn`、`spawn-to-tower`，确认兵营／基地同族效果与实际游戏启动／重开。无实图前不变默认、不计记分卡覆盖率。

方法依据：[Riot Clarity in League](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/) 的层级、低噪声与识别特征原则（2026-10-30读取）；a1dbv 3D制作链已有实测选择用Blender脚本处理规整件。本小样不能填补当前第一差距中的石土大色块、地表连续性和塔基过渡。

本树已完成485项CPU测试、模拟/网页/capture构建、3局seed1模拟及3次回放一致（首局hash `a1afe49381f7dfa4`）、6GLB同配方重建字节一致；非作者另跑18项加载/结构/capture-world检查通过。未执行浏览器、GPU、音频、完整玩家体验或美术盲判。capture runner的 `--check-live` 仅验证返回默认后的操作，不能代替 stonework 开关下的正常游玩 smoke。
