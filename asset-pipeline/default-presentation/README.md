# 只读快照 → Three 资产表现

`createPresentation` 将真实 `Simulation.snapshot()` 接到现有角色 GLB、阵营几何标记和地图轮廓；不包含 renderer、输入、模拟推进或新游戏框架。模块只读快照，全部写入自己的 Three 对象。

## 游戏入口接线

从本目录安装锁定依赖，应用打包器须解析 `three` 和 `three/addons/`：

```sh
npm --prefix asset-pipeline/presentation ci --ignore-scripts --no-audit --no-fund
npm --prefix asset-pipeline/presentation test
```

```js
import {loadCharacterAssets, createPresentation, disposeCharacterAssets} from './asset-pipeline/presentation/adapter.js';
import {abilityViewModel} from './asset-pipeline/presentation/icons.js';
const assets = await loadCharacterAssets(); // GLTFLoader，URL 相对模块定位已有 GLB
const view = createPresentation({catalog: simulation.catalog, assets});
scene.add(view.root);
view.sync(simulation.snapshot());
// 每次模拟步进后：view.sync(simulation.snapshot());
// 每个绘制帧：view.advance(renderDeltaSeconds, accumulator / fixedStepSeconds);
// renderer.render(scene, camera);
const buttons = abilityViewModel(simulation.snapshot().heroes[0], simulation.catalog);
// 换对局或回放倒退先 view.reset()；离开场景 scene.remove(view.root); view.dispose();
// 所有共享消费者释放后：disposeCharacterAssets(assets);
```

初始化、`step(commands)`、相机和输入属于游戏入口。现模拟可通过获取 navmesh 字节、`createDetourNavigation(bytes)`、`new Simulation(...)` 初始化；本模块不取代模拟 owner 的入口。测试读取真实 v1/v2/v8 catalog 和真实 Simulation 快照，运动夹具使用直线路径对象，不冒充 Detour／完整对局验证。

## 表现合同

- 角色用 `SkeletonUtils.clone` 克隆：独立骨架、AnimationMixer 和材质；共用只读几何与 clip。按 team 选蓝单鳍／橙双鳍，同阵营多个实例不会共用骨骼状态。当前不同英雄仍用同一占位模型。
- 坐标从快照 `(x,z)` 原样落到 Three 地平面，单位米。只从相邻逻辑 tick 的位移选择 idle/walk；朝向读取snapshot.facing，旧无facing快照才回退为移动方向；观察到alive→dead时播放同源death并保持一秒，随后隐藏；初始就是dead不补造死亡动作，复活首tick取消旧动作并回idle。攻击／受击只消费当步权威events，不从冷却、castSlot、HP差或目标猜命中。
- `sync` 同 tick 幂等；倒退 tick 要显式 `reset()`；`advance(seconds, alpha)` 在最近两个快照端点间插值位置，并用 `latestTime-(1-alpha)/tickRate` 采动作，避免多逻辑步catch-up后又把整段delta算一次。alpha取固定步长累加器比例0–1；位置/动作都晚一逻辑tick，visibility累加器reset时动作时间单调夹住直到模拟追上。仅单独资产预览可省略alpha，按delta推进动作并直接取最新位置；对局运行中的游戏入口始终传alpha；终局固定快照后只让已有视觉尾段按delta结束，不再推进模拟。死亡／复活和首次出现重置插值起点，倒退需 reset，重复 render 不改端点。地图边界、兵线宽、结构位置与半径取 catalog／snapshot；塔／基地／兵营／小兵是分类几何，不是最终场景美术。对象根的 `userData.simEntityId` 可供输入层拾取后找到模拟实体。
- `abilityViewModel` 从 catalog 的能力定义取语义，不固定 QWER 映射。v1 首英雄覆盖四类；v2 的方向弹道没有专用图标，返回 `icon:null`，由 UI 显示技能名而非沿用错误指向图标。冷却原字段是 tick，输出同时保留 `cooldownTicks` 和按 `rules.tickRate` 换算的秒。死亡、眩晕、施法、冷却、法力只提供已知禁用原因；目标、距离、朝向等合法性仍由模拟裁决。
- `view.dispose()` 只释放自己克隆的材质／骨架和地图几何，不释放共用 GLB 源。所有消费者释放后，由持有 `assets` 的调用方用 `disposeCharacterAssets(assets)` 统一释放源几何、材质、骨架和纹理。加载器等待两项结束，任一失败或缺必需 clip 时清理已加载源。

纯 Three 数值测试不创建 WebGL：核真实 GLB 的独立克隆、整角色变换、快照不变、状态移除、重置、释放与图标语义。原可玩版已有软件WebGL 2验收；本次完整事件动作的浏览器接入与动作观感仍待验。报告仅放本地忽略的 `reports/`。


## 资源共享与显式预算

同一角色内部仅在骨骼对象序列与逆绑定矩阵逐项相同时共享 skeleton；保留每个 mesh 的 bindMatrix。原来共用同一个源材质的 mesh 在该角色内共用一份克隆材质，不同源材质不合并；不同角色的材质、骨架和 mixer 仍独立。需要给同一角色的某个 mesh 单独改材质时，调用方应另行 clone 并负责该新材质释放。资源由角色集合统一释放，不逐 mesh 销毁共享对象。

`resources.js` 提供只读 `resourceInventory({roots, clips})` 与 `assertResourceBudget(inventory, limits)`。将所有共享源及消费者根一并传入，按对象身份去重 geometry/material/skeleton，按实际 ArrayBuffer 身份去重 typed-array backing bytes；同一缓冲的多个切片不会重复计算整块内存。clip 的 times/values 和骨架矩阵包含在统计中。`typedArrayViewBytes` 是不同视图长度之和，可能重叠，不可当总内存；`typedArrayBackingBytes` 包含视图保留的整个底层缓冲。

预算必须由调用方显式给出，例如 `{geometries: sourceInventory.geometries}` 可阻止克隆意外复制几何。未知指标、空预算、不合法上限及超额均抛错。纹理只统计直接材质属性引用数量，不估算图像、shader uniform 内纹理、GPU 上传、mixer/JS 对象或驱动内存；它不是设备显存预算或帧率保证。Node 测试同时核实际 GLB 全部 clip 的蒙皮点、共享去重、错误预算及多消费者释放；输出走 stdout，保存时放本地 `reports/`。


## 加载取消与所有权

`loadCharacterAssets(customLoad, {signal})` 接受可选 AbortSignal；使用默认 GLTFLoader 时可传 `undefined` 作为第一个参数。预先取消不启动加载；中途取消立即拒绝并释放已完成部分，未完成源稍后返回时也释放。它是**消费取消与资源回收**，不承诺底层 GLTFLoader 网络 I/O 会中断；传输层真正中断由 customLoad 自己实现。成功返回后所有权已转移，之后取消 signal 不销毁仍被消费者使用的源，仍由调用方在全部 view 退出后统一 dispose。每次加载须交付本次调用拥有的源，不把其他存活消费者的共享源交给它回收。


## 动画 bounds 与拾取

英雄克隆中的 SkinnedMesh 使用 `frustumCulled=false`，源 GLB、地图与普通实体代理不改。Three 首次计算的 idle 球不能覆盖后续 walk 姿态；少量英雄先选择不依赖该缓存做剔除，代价是离屏英雄也可能被提交绘制，不声称更快。没有每绘制帧扫描所有蒙皮顶点。

每个克隆 skinned mesh 的 `raycast` 包装器在真正的 `Raycaster.intersectObject(s)` 派发时计算当前姿态 box，再从 box 得到保守 sphere，然后调用原 Three raycast。此时只做一次全顶点 bounds 扫描；调用方仍须先通过 `sync/advance` 更新世界矩阵。相比预采样 clip 的静态界，避免了未采样旋转极值／后续姿态超界的假保守保证；相比逐帧动态界，将这项 CPU 工作放在实际拾取时。大量角色或高频拾取应另评估粗代理／完整保守界，不把该策略推广成通用性能结论。

Node 回归用真实 idle→walk，构造包含逃出旧球顶点的正交相机 Frustum，证实旧球会误剔除；同时经真正 Raycaster 派发验证更新后的 bounds 与原 Three 几何交点一致。GPU 绘制、离屏成本和用户视觉表现仍待实际环境验证。

## 原创 reaction 供给

蓝方改用[Beacon Guard 可复现五动作源](../characters/beacon-guard/README.md)；橙方保留双鳍几何/材质，仅在骨骼对象归属、顺序、层级、local/world矩阵、每个蒙皮的bind/inverse绑定逐项等价时复用hurt/death轨道。不是通用重定向。新reaction轨的第一键归零，既有idle/walk/attack不重写。death由alive下降沿驱动，hurt/attack消费权威events；不从HP差或冷却制造受击。尸体视觉不改变sim存活、HUD、碰撞或复活时间。

## 当步事件 → 分层动作

每次 `step` 后都调用 `sync(snapshot)`；`snapshot.events` 是当步批次，不是历史日志。
`motion-state.js` 按 `(tick, ordinal)` 去重，重复快照不重播；跳过整个逻辑步会漏事件，
本模块不会补造。`reset()` 清空游标及视觉状态。`castStarted` 按 catalog.castTime
采前摇并保持，只有实际 `castResolved` 才播放挥击/恢复；Resolved 表示 delivery 提交，
不是命中。`basicAttack` 是已承诺出手，没有更早事件就不画虚构前摇。
`castCancelled` 只取消同 castId 的视觉动作。`heroDamaged.hpDamage>0` 才触发 hurt；
仅 shieldAbsorbed 不假装身体受伤。死亡清掉攻击/受击，复活从 idle 开始。终局停止walk；尚未resolve的前摇使用仅表现层visualStopAt有限淡出，不冒造模拟取消/命中，已resolve的恢复、hurt/death尾段按原有限时长结束。

优先级是 death > hurt > attack > idle/walk。受击暂时遮住攻击，但不更改模拟施法、移动
或伤害；下身仍按真实位移走路，角色外根的位置由 snapshot/插值独占。所有源轨第一键归零；
按八个上身骨、七个下身骨拆轨，源和派生轨只读、每份资产缓存共享，mixer/action逐角色独立。

**第二次需求修改：受击仍要保持走路腿部。** 默认 `hurtRegion:'upper'` 使用同一hurt源的
上身轨；旧全身反应可用下列选项复现，不用重画/导出另一份GLB。也可只调整视觉strike时长，
真实resolve时刻与游戏命中不变：

```js
const view = createPresentation({catalog, assets,
  motionOptions: {hurtRegion: 'full', strike: .3, recovery: 17/30}});
```

`motion-test.mjs` 对真实源核全身/上身差量、腿部姿态、阶段时长、实际施法/塔伤害/英雄普攻
事件接线和取消；纯Three检查不代替动作观感。活跃attack/hurt混合期间，消费者逐蒙皮顶点求
本地最低点，仅向上补内部Root以维持平地接触；不改移动外根，不在idle/walk时做该扫描。
该CPU开销随可见角色/顶点数增长，不能外推大规模或GPU性能。旧resourceInventory只统计
传入的root/clip；若只传原GLTF clips，不含此处缓存的派生轨，也不是完整JS堆预算。

`motionState()` 返回实际挂接角色与生效AnimationAction的clip/track数/weight/time副本，
供严格smoke核E施放后的真正 `attack.upper` 动作；它不接受写入模拟或控制动画的指令。
