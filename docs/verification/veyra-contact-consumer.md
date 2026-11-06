# Veyra death-contact 源候选：真实动画消费者的 CPU 验证

日期：2026-11-06。基线：`7e1986f`（已接收 `asset-pipeline/veyra-death-contact/` 源候选）。

**结论：已接收的 `veyra-teal` / `veyra-rust` 源重建 GLB 在现有生产动画消费者中保留了死亡接触修正，不需要改源代码。** 本卡只验 CPU 骨骼/蒙皮结果；游戏默认仍未采用候选，画面、死亡接地观感、默认切换和配套出图都未验证，留给 dot-B 判断。

本卡没有修改运行资源、源模型、渲染代码或默认选择。只新增：

- `tests/client/veyra-contact-consumer.test.ts`（5 个测试）
- `docs/verification/veyra-contact-consumer.md`（本文件）

## 消费者实际调用链（读自源码）

- `src/render/battle-assets.ts::loadBattleAssets()` 只用 `import.meta.glob('../../asset-pipeline/heroes/veyra-release/exported/*.glb')` 和 `heroManifest.assets[].file`。它看不到 `veyra-death-contact/`，因此默认对局仍播放旧 heroes release 的死亡 clip；本验证不改变该事实。
- `asset-pipeline/presentation/adapter.js::createPresentation()` 已经支持按英雄定义注入资产：`assets.byDefinition?.[hero.definitionId] ?? assets`，再按 `hero.team === 0 ? selected.blue : selected.amber` 建角色。测试正是通过这个既有入口把夹具换成两阵营候选 GLB，没有复制动画器，也没有改 adapter。
- `character()` 用 `SkeletonUtils.clone` 克隆骨架，克隆材质，保留共享只读几何；随后 `createMotion(root, asset, motionOptions)` 并 `motion.sample({time:0})`。
- `sync(snapshot)` 从快照写外根 `actor.root.position` 的 x/z；按相邻 tick 位移选择 `motion.play('walk'|'idle')`；观察到 alive→dead 时记录 `deathStarted`；调用 `motion.sample({time:actor.visualTime, deathElapsed, ...})`。
- `advance(seconds, alpha)` 在同步模式下取 `time = max(actor.visualTime, latestTime - (1-alpha)/tickRate)`，推进 `motion.advance()` 后再 `motion.sample({drawn:true})`；死亡演员在 `deathDuration + 1` 秒后才隐藏。
- `asset-pipeline/presentation/reactions.js::reactionClip()` 从 `asset.animations` 按名字取 clip，把全部轨时间平移 `-min(start)`，时长取 `end - start`。`motion.js` 要求 `idle/walk/attack/hurt/death` 五个源 clip 都存在。
- `asset-pipeline/presentation/motion.js::createMotion()` 按骨名分区：`death → full`，`hurt → upper`（默认）或 `full`，`attack → upper`，`idle/walk → lower + upper`；所有 action 为 `LoopOnce`、`clampWhenFinished = true`、`paused = true`。
- 播放倍率：没有全局倍速。`advance(seconds)` 只把秒数累加进 `baseTime`；死亡 `action.time = min(clips.death.duration, deathElapsed)`；攻击时间由 `attackSample()` 从权威 resolve 时间映射；adapter 同步模式用 `tickRate` 做位置/时间插值。
- mesh 变换：世界空间取法沿用消费者自身的 `SkinnedMesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld)`；外根 x/z 来自快照且 Y 固定为 0，内部 `Root` 骨骼承担动画位移。
- 死亡采样固定 `weight = 1`，`action.time = min(clips.death.duration, deathElapsed)`；因此超过时长仍停在最后一帧（冻结）。
- 外根由快照独占。生产消费者只在 `rawHurt > 0 || attackWeight > 0` 时扫描蒙皮顶点，把内部 `Root` 向上补到平地；采样开始时先 `rigRoot.position.sub(offset)` 清掉上次修正。**死亡分支不跑这个修正**，所以候选的接触修正是 clip 里的 `Root.position` Y 轨道本身，不是另一个补丁。
- `motion.dispose()` 只做 `mixer.stopAllAction()` + `mixer.uncacheRoot(root)`；`adapter` 的 actor dispose 只释放本实例克隆的材质和骨架，共用源 GLB 由调用方的 `disposeCharacterAssets` 单独释放。测试在源几何/材质上挂 dispose 计数，销毁 A、创建/销毁 C 以及最终 `view.dispose()` 后计数仍为 0。

## 死亡 Root 变换与坐标口径

- 源包 `tools/glb_contact.py` 的口径：GLB `+Y` 向上、地面 `Y = 0`；用世界空间线性混合蒙皮；body 集排除 `battle-wood` / `battle-focus`，以及 `battle-gold`/队伍材质中 `Hand_L` 的法器；脚以 `Foot_L` / `Foot_R` 为支配骨。
- 死亡动作有 31 个 key，时间 `1/30 … 31/30 s`。`Root.translation` Y 基线首键 `-0.005000`，末键 `0.733078`；候选只在前 16 个非零 offset key（源帧 2–17，key 1–16）上加 `0…0.051798 m`。key 0 与 key 17–30 不变，X/Z 不变。
- `reactionClip()` 平移 `-1/30 s`，所以生产 `deathElapsed = t` 对应源时间 `t + 1/30`；百分比采样 0/25/50/75/100% 正好是源帧 1 / 8.5 / 16 / 23.5 / 31。
- 角色外根由 `sync` 从快照写 x/z，不由动画写 Y；`Root` 是 `GuardRig` 下的骨骼，Y lift 是局部变换。生产消费者在死亡时不加额外 Root 修正，故候选的 lift 一比一进入世界空间。
- 直接用 `THREE.AnimationMixer` 采原始未平移的 `death` clip（源帧时间），与生产 `createMotion.sample({deathElapsed})` 的世界空间 body/foot 最低点逐帧一致（测试断言 1e-5 m 内）。

## 生产消费者采样结果

用真实 `createMotion` + CPU `SkinnedMesh.getVertexPosition` 在 61 个源采样点（31 个整数帧 + 30 个半帧）上测得，teal 与 rust 数值相同：

| 指标 | 基线 heroes release | 候选 `veyra-death-contact/exported` |
|---|---|---|
| 最低 body 点 | **-0.051905 m**（帧 13.5，`Foot_L`） | **-0.0001825 m**（帧 31，`Hand_R` 支撑） |
| 最低 foot 点 | -0.051905 m | **-0.0001274 m**（帧 15.5，`Foot_L`） |
| 最高 body 点 | +0.001179 m | **+0.0146014 m**（帧 17.5） |
| 首帧 body | ≈0 | ≈0（与基线同键） |
| 末帧 body | -0.0001825 m | -0.0001825 m（offset 为 0） |

候选值分别对上源包 `check_contact.py --tolerance 0.005` 的 `-0.000182468`、`-0.000127392`、`+0.014601497`（差 ≤1e-7 m），基线最低点对上 `--mode reproduce` 的 `-0.051905152`。这同时证明消费者与源包使用同一坐标口径。

测试还断言：

- 每个采样点的候选 body 不低于基线（允许 1e-6 m 浮点误差），没有把接触问题藏到别处。
- 全部 61 个采样点的 body 在 -0.01…+0.02 m 内，foot ≥ -0.005 m。
- 每个候选 death `Root.position` Y key 经 `createMotion` + mixer 后等于“基线 Y + manifest offset”，最大误差 **8.7e-8 m**。
- 100%（`deathDuration = 0.99999997 s`）与真实最后一帧同姿态；`deathElapsed = duration + 5 s` 仍冻结在末帧，Root Y 不再变化。

这些数字是 CPU 蒙皮结果，不是 GPU 画面，也不是“死亡接地观感”验收。

## 骨骼 / NORMAL / 权重 / 非死亡动作

- **骨骼**：两边均为 15 根骨，`name:parent` 排序集合完全一致（`Root:GuardRig`、`Torso:Root`、四肢与 `Foot_L/Foot_R` 等）。候选容器重排了节点和 joint 顺序，因此测试从不按 traversal index 比较。
- **NORMAL**：每个 skinned mesh 都有 NORMAL 且数量等于 POSITION；按材质名分组的法线记录逐项一致。
- **权重**：按“骨名 = 权重”比较非零蒙皮影响，候选重排 `JOINTS_0` 索引不影响结论；每个材质的顶点数、三角数和完整顶点记录候选与 heroes-release 基线一致；合计 teal 2119 顶点 / 1189 三角面，rust 2137 顶点 / 1197 三角面（团队材质 `battle-rust` 比 `battle-teal` 多 18 顶点 / 8 三角面，其余材质一致）。
- **非死亡动作**：`idle/walk/attack/hurt` 的 clip 名、时长、轨道名集合与逐 key 数值一致（1e-5 m 内）；通过生产 `createMotion` 驱动四类姿势后，15 根骨的世界矩阵差为 0（断言 <1e-9），`inspect()` 的 clip/weight/time 摘要也一致。死亡之外的姿势没有相对原包漂移。

## runtime-fallback 分离

`runtime-fallback/exported/*.glb` 是独立的二进制补丁证据，不是可编辑源导出：

- `runtime-fallback/manifest.json`：`kind = "runtime-fallback"`，`editableSource.status = "superseded"`；候选 manifest 则是 `kind = "source-rebuilt-candidate"`、`editableSource.status = "produced"`。
- 本卡测试夹具只用 `veyra-death-contact/exported/*.glb`；fallback 的 SHA-256 与候选不同，测试只固定其独立 provenance，不把它喂给生产消费者，也不把它当作源模型。
- fallback 自身的 61 点接触结果由源包 `tests/test_checks.py` 的 `RuntimeFallbackTests` 覆盖（本次 32 个 Python 测试全过）；本卡没有重复把它当作消费者夹具。

## 实例隔离

用真实 `createPresentation` 驱动一个由 `makeSim(10, 61).snapshot()` 派生的合成时间线：

1. A（teal，id 9）与 B（rust，id 10）同时存在；两人 `Root` 骨骼对象、骨架对象都不同，材质分别含 `battle-teal` / `battle-rust`。
2. A 在 tick 1 死亡，B 持续移动：A 的 action 为 `death`，`inspect()` 只有 `death.full`（weight 1）；B 为 `walk`，只有 `walk.lower` / `walk.upper`，没有 death。A 的 `Root.position.y` 到 1.0 s 时约 0.733078，B 不是死亡姿态。
3. tick 3 销毁 A：`hero-9` 从场景移除，B 继续走；源几何/材质 dispose 计数仍为 0。
4. tick 4 新建 C（teal，id 11）：C 的 `Root`、骨架、骨骼对象与 B 均不同，C 初始为 `idle`，不继承 A 的死亡状态。
5. tick 5–6 C 死亡而 B 继续移动：C 为 `death.full`，B 仍为 `walk`。把 B 的最终骨骼世界矩阵与“同一时间线只有 B”的参考 presentation 对比，差 <1e-9；两者的 action clip/weight/time 也一致，说明 A 的死亡和 C 的创建/死亡都没有串到 B。
6. 两个 presentation 都 `dispose()` 后，源几何/材质 dispose 计数仍为 0；共用源没有被实例销毁误释放。

## 运行命令与结果

在 Node 22.23.2、`three@0.186.1`、`vitest@3.2.4`（均由仓库 `package-lock.json` 固定的已有依赖；用 `npm ci --offline --ignore-scripts` 从本机缓存安装，未联网、未新增依赖）下实际执行：

| 命令 | 结果 |
|---|---|
| `npx vitest run tests/client/veyra-contact-consumer.test.ts` | **5 passed**，exit 0 |
| `npm test` | 88 个测试文件：**87 passed / 1 failed**；573 个测试：**572 passed / 1 failed**，exit 1 |
| `npm run build` | exit 0 |
| `python asset-pipeline/veyra-death-contact/tests/check_contact.py --mode reproduce` | passed；基线 worst -0.051905 @ 13.5（`Foot_L`） |
| `python asset-pipeline/veyra-death-contact/tests/check_contact.py --tolerance 0.005` | passed；两个阵营 61 点 |
| `python -m unittest discover -s asset-pipeline/veyra-death-contact/tests -v` | **32 tests OK** |

失败项是既有且无关的 `tests/client/audio-skill.test.ts > critical palette failure falls back to cast…`（`expected [] to deeply equal ['cast.ogg']`）。单独运行该文件同样失败，错误与本次新增的动画消费者测试无关；没有改断言或跳过。`unit-test npm` 包装器以 `unsupported_npm_test_script` 拒绝本仓库的 `vitest run` 入口，因此按项目原始入口运行 `npm test`。

## 未验证 / 待人工

- **游戏默认采用：未做。** `src/render/battle-assets.ts` 仍只 glob `heroes/veyra-release/exported/*.glb`；候选没有被默认对局加载。采用所需的 manifest/lock 更新见 `asset-pipeline/veyra-death-contact/README.md` Adoption 步骤，未在本卡执行。
- **生产接口可达性：无阻塞。** `createMotion` / `createPresentation` 都能在现有导出下直接调用，`byDefinition` 注入点已存在，不需要新增导出或改写替身。未验项是采用决定与画面对外承诺，不是接口不可达。
- **画面与死亡接地观感：未验证。** 本卡按合同不开浏览器、GPU、音频设备或桌面，不做截图/录像，也不以 CPU 接触数字代替观感。
- **默认切换、heroes recipe 端口、配套出图：待 dot-B 判断。** 需要用户手感/画面判断的项应记入 a1dbv TASKS「待人工验收」。
- **性能与大规模：未验。** 只测两个实例的 CPU 蒙皮，不推断大量角色或 GPU 成本。
- **Blender 源重导出：未重跑。** 本卡只消费已接收 GLB；源 `.blend`、`bpy` 重建和 heroes recipe 端口不在范围内。
