# 日照石径：一次基本战斗的资源

服务当前 MOBA 交战片段：石塔、兵营、基地、石径、骑士英雄与枪盾／弩兵使用一套冷青绿—暖赭红阵营语言。不是独立素材货架，也未宣称已经达到参照水平。`manifest.json` 是渲染消费者入口，旧角色适配器与模拟层不由本目录改动。

## 接入

- 自包含 GLB、Y-up、米、正面 `+Z`；地面锚点 `y=0`。按 manifest 的名义高度加载，不要再按含挥刀的 AABB 重缩放。`footprintRadius` 是接入参考，不改变模拟碰撞半径。
- `hero-{teal,rust}`：2.28 米；同一个十五骨骼合同，`idle/walk/attack/hurt/death`。所有可见几何重新制作：收腰胸甲、圆冠盔、肩甲、披风、盾、剑；不是对旧方块换色。
- `melee-*`：1.2 米、圆盾和枪；`ranged-*`：约 1.28 米、尖风帽、窄肩和横弩。枪兵改成刺击、弩兵改成短后坐，不给所有兵套剑的过顶挥击。保持同五个 clip 名。
- 塔高 5.3、兵营高 3、基地高 6 米；旗帜矩形／三角形、英雄单／双冠脊提供颜色之外的差别。建筑几何没有烘焙硬阴影；KayKit 原图集保留自身渐变着色。
- `lane-ground` 每 12 米沿 X 重复；仅包含约 12 米宽的无碰撞石路，表面 `y=0`、少量磨损片 +0.002，两端各重叠 3 cm，边缘低幅不规则但不改 nav。它没有草地盒子或侧墙：真实 renderer 的连续 `#284c43` 草地在 -0.035 承接边缘，避免重复共面草面 z-fighting。铺 18 段覆盖 X ±108（视觉端点多出 3 cm）。树岩按簇放在兵线外。
- GLB 各自自包含；建筑用同源 256² 渐变图集，角色五种共享命名材质。消费者可按纹理／材质哈希合并实例资源，角色几何已合为一个 skin。场景灯光、接触阴影、选择环和行为反馈由真实 renderer 负责。

## 来源选择与可编辑输入

[KayKit Medieval Hexagon 免费官方仓库](https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0/tree/84fa4e91af6a88989be7c99e0891cede11f2ca38)固定 commit `84fa4e91`；包内 CC0、选中源 glTF／bin／原图集和 SHA-256 见 `source/provenance.json`。免费版的炮塔、堡垒兵营、城堡在俯视下已有明确用途与共同石材／木材比例；不使用付费 extra 士兵。

实际取得并打开了独立候选 [Kenney Fantasy Town Kit 2.0](https://kenney.nl/assets/fantasy-town-kit)，含包内 CC0；比较其原始预览与同灯光下实际模块拼装。Kenney 的模块化墙屋适合村镇、三角预算更低，能自由搭形；本单元的军事语义需另造、不能拿一个民居替代炮塔／堡垒。因此当前统一选 KayKit 建筑，不混入第二套墙屋。选择依据是实际模型、工作量与交战用途，不是宣传图或下载成功；对照图只本地保存。

角色使用本仓原创 CC0 Beacon Guard 的骨架和源动作（`083183c`），新建全部可见网格与兵种出手；源 `.blend` 与派生可编辑 `.blend` 均在 `source/`。`tools/build.py` 统一比例、配色、武器和旗形；改配方后重新生成并回归。原第三方角色缺口没有伪装成已经取得。

**停止来源仍停止**：历史原记录说明 HTTP 拒绝来自服务器还是网络中介未知，并非 auto-review 拒绝；不泛化为作者全部资源被禁。以下原目标未重试，也未改走镜像、传输方式或同源重新打包：

- `https://api.github.com/repos/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0/git/trees/main?recursive=1`
- `https://quaternius.com/packs/ultimatedanimatedcharacter.html`
- `https://kenney.nl/assets/animated-characters-protagonists`

## 生成与验证

从仓库根，使用 Blender 4.3.2 与 Python 3；不联网、不安装依赖：

```sh
blender -b --factory-startup --threads 2 --python-exit-code 1 --python asset-pipeline/battle/tools/build.py
python3 asset-pipeline/battle/tests/test_assets.py
blender -b --factory-startup --threads 2 --python-exit-code 1 --python asset-pipeline/battle/tests/check_animation.py
blender -b --factory-startup --threads 4 --python-exit-code 1 --python asset-pipeline/battle/tools/preview.py -- --output /tmp/battle-preview
```

约 2.5 MB 运行 GLB；英雄约 1.1k、兵约 1k、建筑 2.9–5.7k 三角形。测试读取真实 GLB、包头、哈希、贴图自包含、透明模式、三角数、材质数、尺寸、15 骨骼及实际 clip 名，并用错哈希／假 clip 验拒绝。Blender 对六角色五动作各五个整数帧＋一个半帧做源→GLB 变形点比较；整数帧容差 0.3 mm，半帧容差 5 mm。曾发现 Bezier 转 GLB 的快速挥剑半帧约 6 cm 差异，已在可编辑派生源中按整数帧线性采样消掉源曲线独有的过冲；半帧仍允许四元数插值差异。这不是连续动作观感验收，也不保证未抽样时刻的路径完全相同。无付费、无账号、无凭据、无生成模型权重。

## 质量循环：当前还不能宣布完成

参照 [Thronefall 官方 Steam 展示](https://store.steampowered.com/app/2239150/Thronefall/) 的局部塔战：低干扰地面、暖石建筑、地形边缘、可读单位与出手；不复制地图、资产、控制方式。官方图只留本地。源场景预览不能替代真实游戏镜头、音效和操作。

1. 首版实看：大块石板网格抢注意力，像棋盘；已改为连续低噪声石路与稀疏边缘磨损。
2. 非作者并排评 v2：规则窄条和等距树列像展示台；兵种远景轮廓过近；灰褐光色使人物与地面缺少层次。
3. 针对此评改：源资产降低地面亮度、提亮暖金属；枪兵大圆盾、弩兵尖风帽／窄肩／加宽横弩；建筑加不同旗形。连续地表、非均匀树岩簇、真实灯光与选中／敌我标记由案例 owner 同片段整合。

**仍有差距**：还须在真实交战的静止与运动画面中复评兵种辨识、英雄攻击动作、暖亮建筑与冷暗地形的层级，以及脚底接触。没有用下载、单元测试、离线渲染替代这个门槛；没有将源预览当作完整战斗完成。

主战斗品质参照按产品 brief 最新约定为《英雄联盟》的基础交战响应与可读性；Thronefall 在本资源目录仅是低多边形形色光层级的辅助，不是作品品质终点。未使用 Riot 的模型、纹理、音效或品牌资源。

真实 Three.js 首帧发现浅绿矩形与每 12 米拼接的暗缝：原土台草面与外场草地同为 -0.035、材质又不一致。此次只去掉重复土台／草面／侧面，石路端点轻微重叠并打破直边；其余十四个运行 GLB 不变。相同相机的软件 WebGL 真帧已复拍，整合者与源作者实看确认这两类缺陷消失；这只闭合地表连续性，不代表整段战斗品质通过。
