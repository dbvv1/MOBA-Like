# 轮式攻城兵

两队投射器已接入本候选的现有资产loader与小兵消费者。它用短车厢/双轮和投石机构替代原来的放大枪兵，碰撞、导航、半径、数值与伤害事件保持原规则。

## 原源、形体与成本

- **Kenney Fantasy Town Kit 2.0**：复用已有官方ZIP，SHA `1a7530c09f4d2fa2cdee259876f089334f8b1f27fa86a0c4f54ef86cdd8676ef`，3,854,691 B。`source/kenney/cart.glb`包含完整车厢及两个独立轮；外链`Textures/colormap.png`一并保留，逐字节与原ZIP成员核对。
- **KayKit Medieval Hexagon 1.0**：固定`84fa4e91`，取仓库已有`building_tower_catapult_{green,red}`中的独立turret/arm两节点，排除塔身。原塔源和已采用塔GLB不变。
- 两包均CC0；许可、原字节与文件SHA见`source/provenance.json`及`LICENSE.txt`。此次无新下载。输入先以车厢×1.5、机械头×1.15等比放置，保原木/金属atlas；已有车厢侧板/顶板部分面沿现角色队色。派生车厢切掉后牵引杆/停车支脚并封口，再仅沿纵向×2/3归一；轮与机械头维持原尺寸，原输入文件不变。

`source/siege-{teal,rust}.blend`包含packed图、6骨rig和9动作；`exported/`为自包含GLB。每件约226KB、**1,884三角 / 3材质primitive / 6骨 / 2内嵌图**，含原几何11个严格零面积三角。两张内嵌PNG与原图字节一致。若两队分别解码512²+256² atlas，RGBA8+mips约3.33MiB；实际GPU成本待运行测量。

静止体量约 **1.340宽×1.219高×1.332长 m**，+Z前向、y=0接地；动作最大高约1.77m。运行scale=1，血条视觉锚1.85m。静态车厢约0.975宽×1.001长m，水平最大半径0.6984m；投射臂有独立活动包络。原后杆穿腿复现点（seed61，tick3030，#36/#43）的三角交点为0。残余近战短矛/盾与车厢/轮接触属于实屏观察项；武器接触不等于静态长杆穿腿，完整波线仍需机位复评。

## 动作与事件

| 动作 | 长度 | 当前接法 |
|---|---:|---|
| idle | 1.0s | 静置 |
| walk | .6s/一周 | 源轮周约2.20427m；v11按实际累计位移独立采样轮轨，攻击回位期间也滚动；0速停轮；v10保原walk速度比 |
| attack_prepare / release / recover | 13/30、5/30、17/30s | v11采样现有castStarted/resolved周期；取消与终局的准备不进入释放 |
| attack | .73333s | v10等旧版本在真实basicAttack后直接播放释放+回位 |
| hurt | .4s | 已有源；当前小兵伤害消费者未接 |
| death | 1.0s | 实际minionDied触发松垂/侧倾，立即退出选取，沿原有界尾段回收 |
| attack_cycle_preview_only | 35/30s | 仅用于源动作对照 |

六骨为`Root/Carriage/Wheel_L/Wheel_R/Turret/Arm`，单骨刚性权重，Root无位移。普通兵15骨与英雄上身mask保持原状。动画不发弹丸、命中、奖励或其他模拟事件。死亡已有机械姿态，完整破损/碎裂形态仍缺。

## 接线位置

- `src/render/battle-assets.ts`：同一个loader登记两GLB，沿原失败回收和共享资源生命周期。
- `src/render/battlefield.ts`：siege独立ID、scale=1、血条锚；同一个SkeletonUtils克隆链/独立mixer；v11机械三段替代旧步兵帧7/11重定时。v11轮轨与机械臂相位独立，攻击不受移动速度影响；v10保退出walk恢复timeScale=1。
- `tests/client/siege-assets.test.ts`：实际PNG/GLB加载、尺寸/半径、三段端点、取消/终局、走转攻击、死亡/选取/释放与下载失败；真实seed61移动回位与相邻兵三角检查。

## 重做

```sh
BLENDER_USER_CONFIG=/tmp/moba-siege-blender-config blender -b --factory-startup \
  --disable-autoexec --threads 2 --python-exit-code 1 \
  --python asset-pipeline/content-set/siege/build.py
python3 asset-pipeline/content-set/siege/test_source.py
node --test asset-pipeline/content-set/siege/test_consumer.mjs
```

Blender4.3.2与现项目依赖；持续修改回`build.py`，它会覆盖派生Blend。`manifest.json`锁输出SHA，两次重建的运行GLB一致。源/图/许可3项、Three骨架/动作8项和客户端接线8项检查覆盖当前工程合同。源测试跳过图解码，客户端测试另实际解码PNG。

`reports/source-preview.json`及三张Cycles图保留归一前的源SHA，只用于队色和动作方向对照，不代表当前车厢。实际游戏以1280×720/800×600、45°与(0,24,18)机位，检查两队走/攻/死、拥挤波线、血条与光照；声音和完整一局品质统一由根接收，非作者决定采用。
