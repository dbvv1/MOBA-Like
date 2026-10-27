# Ashen Furrow：成套内容

当前已有两名英雄、近远程兵、两队建筑、地表语汇、技能类别图和四种短音。新补的轮式攻城兵有两队模型、可编辑机械骨架和动作，解决了“攻城兵只是放大枪兵”的源缺口。完整一局最缺的仍是连续场景层、建筑摧毁状态、关键局内/结算声音与英雄职业身份。

## 统一风格与机位

暖石路、冷暗林缘、青绿守望与赭红入侵；低模大体块，单位靠武器和轮廓区分。建筑沿 KayKit 256² atlas，角色沿现有平色材质，攻城车保木/金属、以车厢侧板和顶板承载队色。中央 `|z|<4.8m` 留给战斗，植被集中路肩与外围。场景显示色方向为暗林 `#284c43`、叶 `#46764d`、暖石 `#b6aa78`、青绿 `#39a98d`、赭红 `#bd6443`；这组显示色与glTF线性材质参数分开。

正常机位为垂直FOV 45°、偏移 `(0,24,18)`，拍摄基线 **1280×720**（capture `c3b6f237`），并查800×600。按关注点处垂直轴计算：

| 对象 | 名义高度 | 720高 | 600高 |
|---|---:|---:|---:|
| 英雄 | 2.28m | 42.20px | 35.16px |
| 近战兵 | 1.20m | 21.55px | 17.96px |
| 塔 | 5.30m | 107.29px | 89.41px |

以上是透视计算值；实际剪影还受朝向、动作、血条与遮挡影响。源阵容、游戏机位都用同一尺度，不以近景精细程度决定兵群可读性。

## 五组标准件

[`standard-set.json`](../asset-pipeline/content-set/standard-set.json) 固定14个文件、原源/许可、SHA与归一参数，共680,900 B。各模型为米制、Y-up、+Z，现源已归一，默认父级变换为identity。

| 标准件 | 实际asset路径 | 规格与预算 | 当前差距 |
|---|---|---|---|
| Veyra青绿 | `asset-pipeline/heroes/veyra-release/exported/veyra-teal.glb` | 2.28m/15骨；idle、walk、attack、hurt、death；1,189三角/6材质/181,652B；本件上限1,500三角/200KB | 普通守卫躯干、拥挤遮手、已有death脚底穿地 |
| 赭红枪盾兵 | `asset-pipeline/battle/exported/melee-rust.glb` | 1.2m/15骨/五动作；attack .7s、death 1.0s；1,042三角/5材质/164,608B；上限1,500/180KB | 小视距职业差异、受击反应 |
| 赭红投石塔 | `asset-pipeline/battle/exported/tower-rust.glb` | 5.3m、地锚0；静态；2,921三角/4材质/160,320B；上限3,500/180KB | 机械出手、受损/摧毁/残骸 |
| 石路/林缘 | `asset-pipeline/battle/exported/{lane-ground,tree,rock}.glb`；`asset-pipeline/ground-surfaces/{exported/grass-geometries.json,source/edge-layout.json}` | 12m路26三角；树50、石40；全路肩30簇/210草实例/40,170三角/3批；草<.5m | 平涂宽路、外围围合、一树一石的重复 |
| 出手音画/UI | `asset-pipeline/icons/exported/dark/directional-projectile.svg`；`asset-pipeline/combat-vfx/source/trace_02.png`；`assets/audio/battle/{swing,cast,hit,shield}.ogg` | 类别图32/48px；trace用于普攻释放；四音按真实出手/技能提交/伤害/护盾映射 | 法术身份、塔/结构/局末/交易声音 |

这些上限是保持本件成本的工程预算。现有17个GLB共2,828,572 B；每文件各计一次共33,926三角，场景还需乘实例并计阴影pass。路肩是整批提交，实际draw call、纹理共享与帧时由运行构建测量。

## 新内容：轮式攻城兵

[`content-set/siege`](../asset-pipeline/content-set/siege/README.md) 包含 `exported/siege-{teal,rust}.glb`、packed `.blend`、源许可和 `build.py`。使用已取得的Kenney Fantasy Town 2.0cart/双轮，配KayKit Medieval Hexagon原有独立catapult头，保留原图集。两队每件1,884三角、3材质、6机械骨、约226KB；静止体量1.340×1.219×1.332m，动作最高约1.77m。

队色已从小点缀扩大到现有车厢侧/顶板，归一前320宽源阵容里能分青绿和赭红，轮式剪影也区别于枪兵。派生车厢现已去牵引杆并纵向归一，静态半径0.6984m，轮与投射头尺寸不变。动作包含普通五动作与独立prepare/release/recover；v11可采样已有权威周期，旧版本使用release-first attack，死亡只表现机构松垂/侧倾。源里有11个严格零面积三角，保留并计入面数；完整破损形态仍缺。

接线使用同一个loader和generic小兵克隆链；新模型scale=1，视觉血条锚1.85m，v11轮骨按实际位移独立采样，投射臂保持权威相位；旧版本保原walk速度比。普通兵15骨与英雄上身mask保持原状。模拟半径、导航、伤害和事件归原玩法。

## 完整一局的内容覆盖

| 类别 | 已有 | 还要补 |
|---|---|---|
| 英雄 | Veyra/Morrow各两队、五动作与武器 | 职业身体造型、施法身份、拥挤时的出手主形 |
| 兵线 | 近战/远程各两队；新轮式攻城源 | 新攻城兵的真实拥挤波线、动作与死亡辨识 |
| 结构 | 双基地、四塔、双兵营静态件 | 机械出手、损伤、摧毁、残骸及基地结算状态 |
| 环境 | 路、树岩簇、草簇、背景色/雾 | 出生地—塔前—中场—敌基的连续地表与围合 |
| 技能/状态 | 现有程序效果、释放纹理、护盾/控制提示 | 每招动作/特效/声音统一，空放/命中关联 |
| 战斗/局内音频 | 四种Kenney CC0短音；003已接basicAttackHit | 结构摧毁、死亡/复活、升级、购买成功/失败 |
| 环境/音乐/结算 | 暂无配套源 | 少量授权环境/曲目和独立胜负提示 |
| UI | 六类别图、装备文字/价格、生命/冷却、结算公告 | 装备物品图、交易与胜负音画反馈 |

野区、中立单位和扩英雄池不属于当前单线切片。

## 保留的来源选择

- 建筑/树石沿KayKit Medieval Hexagon固定`84fa4e91`，角色/路为本仓资源专属CC0，Veyra施法使用已保存的UAL1 CC0。路肩来自Kenney Nature Kit两草型。原图、原模型、许可和修改配方在各素材目录。
- 当前英雄保15骨完整源。已取得的Quaternius Female Ranger为唯一替代：65骨、无本作五动作，需遮体、眼贴图引用修复、rest-aware动作映射和focus挂点；先与现源同机位比较。
- 连续地表已有固定候选`f439f52`的两张1024²WebP及原图/prompt，优先接续原作者。当前基础战斗与Q以远端`003884b`为基线，capture为`c3b6f237`。
- Nature官方Drive已拒的License、BirchTree_1、Bush_Large对象，以及既有角色403、TripoSR/SG权重TLS/工具blocked保持停止。恢复条件是原限制解除或用户提供合法原包；本包未新取源。

## 重做与验证

`python3 asset-pipeline/content-set/normalize.py` 重出尺寸/轴/脚底合同；按作者名义尺寸等比处理完整scene，保骨架与动作。`siege/build.py`重建两队源与运行件，改变风格规则仍回同一配方。

当前已通过源锁/许可/原图、GLB重建一致、实际Three加载/独立骨架、9动作半帧脚底与相位端点检查；真实seed61移动回位及原后杆穿腿复现点已修。剩余近战矛/盾与车体/轮接触留作实屏观察，未宣称整段零接触。旧Cycles源图的SHA保留在receipt，车厢返工后以新游戏实屏复评；**实际游戏光照、完整波线、听感和完整一局质量仍待根接收验收**。验收固定720/600机位、同段音画与开局→推塔→死亡复活→购买→基地结算，并由非作者列最大三处差距。参照采用[LoL基础玩法](https://www.leagueoflegends.com/en-us/how-to-play/)与[Clarity in League](https://www.leagueoflegends.com/en-us/news/dev/clarity-in-league/)的可读性；素材、地图和界面保持本项目合法来源。
