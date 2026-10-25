# 角色 GLB 检查与 Three.js 消费者

接入角色时，用 `gltf.scene` 整根移动／等比缩放，并让 `AnimationMixer` 绑定同一根。不要只变换蒙皮 mesh 而留下骨架。这里的纯 Node 消费者可复现这一操作，无需 Blender、浏览器或 GPU。

## 运行

从仓库根执行，使用 Node.js 24 和 npm：

```sh
npm --prefix asset-pipeline/validation ci --ignore-scripts --no-audit --no-fund
node asset-pipeline/validation/validate.mjs
node asset-pipeline/validation/consumer.mjs
npm --prefix asset-pipeline/validation test
node asset-pipeline/validation/consumer.mjs --mesh-only  # 故意错误，预期 exit 1
```

默认读取 `placeholder/assets/` 的 `blue.glb`、`amber.glb`、`blue-long.glb`，不会因空目录跳过。`validate.mjs --assets-dir DIRECTORY` 可检查同名候选。两个工具把 JSON 输出到 stdout；需要保存时重定向到本地忽略目录，不提交报告：

```sh
mkdir -p asset-pipeline/validation/reports
node asset-pipeline/validation/validate.mjs > asset-pipeline/validation/reports/gltf.json
node asset-pipeline/validation/consumer.mjs > asset-pipeline/validation/reports/consumer.json
```

## 检查范围与接入决定

- 锁定 `gltf-validator 2.0.0-dev.3.10`，检查容器、内嵌资源、skin 和 animation。完整 issues 不截断或降级；Error、解析异常、缺文件、外部资源请求或报告截断均 exit 1，仅 warning/info 时 exit 0。不进行网络取回。
- 当前三套占位 GLB 的 error 为 0，但均有 `NODE_SKINNED_MESH_NON_ROOT` warning，提示父节点变换不会直接控制蒙皮 mesh。`UNUSED_OBJECT` info 指无贴图材质未使用的 UV。保留告警，不为清零重造角色；官方 main 问题表的级别可能与固定发行包不同。
- 锁定 `three 0.186.1` 的 `GLTFLoader.parseAsync` 加载真实 GLB。消费者对三动作固定时刻，比较整根平移／等比缩放前后的全部蒙皮顶点和 15 根骨骼世界坐标，阈值为 `1e-5` 米；预期坐标独立按仿射式计算。mesh-only 负例检验错误操作确实被拒绝。
- 通过的是固定版本 CPU 数值路径；GPU shader、浏览器、动作衔接、非等比缩放、游戏内观感未验证。消费者不是游戏动画控制器。

依赖来源与许可（2026-10-25 核实）：[Khronos 官方 Validator](https://github.com/KhronosGroup/glTF-Validator)（Apache-2.0）、[Three.js](https://github.com/mrdoob/three.js)（MIT）；版本与 registry 完整性固定在本目录锁文件。原角色来源与许可见 `../placeholder/README.md` 和 `../placeholder/LICENSE.txt`。
