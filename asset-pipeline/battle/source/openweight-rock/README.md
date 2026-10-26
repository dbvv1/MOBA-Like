# 开放权重岩簇候选（TripoSG）

服务基本战斗的路外 `rock` 装饰：用开放权重图生 3D 得到低矮风化岩簇，替换现有 KayKit
`rock_single_C` 派生件。候选尚未接入；`exported/rock.glb`、`manifest.json` 的 `rock`
条目、其余 14 个运行 GLB 都未改动。本页记录已做过的输入与工具准备、实际环境结果和
恢复条件，不代表生成成功或品质达标。

## 当前状态（2026-10-27）

**阻塞：拿不到官方权重，也没有可用的 TripoSG 依赖环境；推理一次都没跑。**
因此没有原始生成 mesh、没有 Blender 采用源、没有旧/新同视角图，也没有质量结论。

1. **权重访问被网络阻断。** 本机到 `huggingface.co` 的 TLS 握手在 ClientHello 后
   收不到 ServerHello；同样请求走 Python `ssl` 是 `UNEXPECTED_EOF_WHILE_READING`。
   `huggingface_hub.snapshot_download("VAST-AI/TripoSG")` 实际返回
   `LocalEntryNotFoundError`，根因 `ConnectError: EOF occurred in violation of
   protocol`。同一时段 GitHub、PyPI、`download.pytorch.org` 均正常，说明不是账号或
   文件问题，而是本网络对 Hub 的访问被拒。补充实测查询：Hugging Face 上
   `VAST-AI/TripoSG` 返回 404（该组织名下没有此仓库）；ModelScope 上能取得
   `VAST-AI-Research/TripoSG`（license=mit，约 7.9 GB，含 `model_index.json`、
   transformer/vae/image_encoder_dinov2 的 safetensors，模型卡链接回官方 GitHub）
   与 `stabilityai/TripoSR`（MIT，`model.ckpt` 约 1.68 GB）。这些是替代分发／镜像，
   不是本次使用的来源，其 revision 与文件 hash 也未核；按任务“不换镜像、代理或
   下载站”的约定没有使用。
2. **依赖环境不完整。** 官方 `requirements.txt` 未钉版本的 `diso` 只有 sdist，
   构建时要编译 CUDA 扩展；本机没有 CUDA Toolkit（`cuda_runtime.h` 不存在），
   `diso==0.1.4` 构建失败，`TripoSGPipeline` 导入终止在
   `ModuleNotFoundError: No module named 'diso'`。官方 `requirements.txt` 里
   `numpy==1.22.3` 也不支持 Python 3.13，实际需要另建 3.10/3.11 环境。
3. **显存条件。** 官方要求 >8 GB。实测 RTX 5070 共 12227 MiB：桌面程序占用时
   剩 5115 MiB，释放后剩 11035 MiB。没有为腾显存关闭他人进程，也没有跑推理，
   所以“8 GB 能否跑通”仍未知。

恢复条件：在允许访问官方 Hub 的网络取得 `VAST-AI/TripoSG` 权重并记录 revision/hash；
另装 CUDA Toolkit 12.8（或提供可用的预编译 `diso`）。二者满足后按下面命令继续。

低成本回退 TripoSR 也在 Hugging Face 权重处被同一阻断：官方源码与权重均为 MIT，
commit `107cefdc244c39106fa830359024f6a2f1c78871`，默认约 6 GB 显存；权重发布在
`stabilityai/TripoSR`，ModelScope 上另有同名副本（MIT，`model.ckpt` 约 1.68 GB），
属于替代分发／镜像，按约定未使用、revision/hash 未核。没有跑它，也没有为了跑通改换
fork、镜像或下载站。

权重可达后按上游方式跑时必须带 `--no-remove-bg`：默认路径会调用
`remove_background`／`rembg`，那是本任务禁止引入的背景模型。输入合同是已合成的灰底
RGB（把 alpha 合到中性灰底、不带 alpha 通道），不是本仓库的 RGBA 原图：

```sh
python run.py <gray-bg-rgb.png> --output-dir <out> --no-remove-bg
```

不安装、不下载、不初始化 `rembg` 或 RMBG；该路径需在权重可达后另行验证。

## 已准备的文件

| 文件 | 作用 |
|---|---|
| `source/openweight-rock/input/rock-cluster.png` | 1024²、8-bit RGBA 的自制输入；真实 alpha，单物体，无文字/发光/旗帜/硬阴影 |
| `source/openweight-rock/input/make_input.py` | 确定性重画脚本；三块不等高、约 1.5:1 宽的切面岩体，暖灰石＋少量暗绿苔斑与细裂 |
| `source/openweight-rock/README.md` 的权利说明 | 输入、模型、权重与输出权利分开记录 |
| `tools/openweight-rock/png_rgba.py` | 无第三方依赖的 RGBA PNG 读取与 alpha 合同；空/全不透明/过小 alpha 明确报错 |
| `tools/openweight-rock/run_triposg.py` | 薄调用 `TripoSGPipeline`；只吃本地权重，不下载权重，不导入/初始化 RMBG；保留原始 mesh；核源 checkout 的 HEAD 等于固定 commit |
| `tests/test_openweight_input.py` | 输入合同与坏输入拒绝（5 项，纯 Python） |

输入图 SHA-256：`6139b5ba738ee39848bf0ef2358477e42607e65ee53aace19c768c92b0d31b9f`。
含抗锯齿边缘的全 alpha 前景覆盖约 22.2% 画布（其中全不透明像素 21.5%，1–254 的软边
像素 0.67%）；裁剪与报告都用 `a > 0` 的包围盒 742×504（宽高比 1.47），全不透明核心
的 bbox 为 736×496。
生成后仍需在 Blender 里缩到名义高 1.1 m。若生成件保持输入的宽高比，投影半宽约
0.81 m；深度不受输入剪影约束，若深度≈宽度则最大半径约 1.15 m，仍低于 1.2 m 上限，
但必须按全部顶点复算，不能用包围盒单轴代替。

## 实际跑过的环境探测

| 项 | 结果 |
|---|---|
| GPU | NVIDIA GeForce RTX 5070，12227 MiB，驱动 617.14 / CUDA UMD 13.4 |
| PyTorch | `2.9.1+cu128`，`torch.cuda.is_available()=True`，capability `(12, 0)` |
| CUDA / cuDNN | 12.8 / 9.10.2 |
| 冒烟矩阵乘 | 4096² fp16 连续 5 次，约 3.4 ms/次；峰值分配 232 MiB |
| 推理 | 未运行（权重与 `diso` 均不可用） |
| 源码 | TripoSG commit `fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c`（固定） |
| 依赖（实测安装） | diffusers 0.41.0、transformers 5.20.2、trimesh 5.2.0、numpy 1.26.4、Pillow 12.3.0、scikit-image 0.25.2、torchvision 0.24.1+cu128 |

`transformers` 已到 5.x，导入时提示 `BitImageProcessor` 需要 torchvision（已装）而回退；
官方 `requirements.txt` 只钉了 `numpy==1.22.3`，其余依赖未钉；上表是实测 import 成功的
组合（numpy 1.26.4 + scikit-image 0.25.2 + transformers 5.20.2 等）。恢复时固定这套
（或明确偏离官方 pin 并先验证），不能把 `pip install -r requirements.txt` 后“能 import”
当成功——那会把 numpy 降回 1.22.3，就不再是 `run.json` 记录的实测组合。

## 恢复后的制作顺序

1. 放进官方权重，记录 revision 与每个权重文件的 SHA-256；RMBG 不下载。
2. 建 Python 3.10/3.11 环境，装 `torch==2.9.1+cu128`、CUDA Toolkit 12.8；按实测组合
   固定 `numpy==1.26.4`、`diffusers==0.41.0`、`transformers==5.20.2`、`trimesh==5.2.0`、
   `Pillow==12.3.0`、`scikit-image==0.25.2`、`torchvision==0.24.1+cu128`，再补官方
   `requirements.txt` 的其余未钉依赖（不要让它的 `numpy==1.22.3` 覆盖上表）。把源码
   checkout 到固定 commit `fc5c4099…` 并放到 `PYTHONPATH`。
3. 运行（相对仓库根，`--source-dir` 指向上面那个 checkout）：
   ```sh
   python asset-pipeline/battle/tools/openweight-rock/run_triposg.py \
     --weights <本地官方权重目录> --revision <hub revision> \
     --source-dir <固定 commit 的 TripoSG checkout> \
     --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
     --out-dir asset-pipeline/battle/source/openweight-rock/generated
   ```
   产物为 `prepared-input.png`（alpha 校验后按 `a > 0` 包围盒裁剪并白底合成）、未改动
   的 `raw.glb` / `raw-mesh.npz`，以及记录输入/权重/耗时/峰值显存/源 HEAD 的
   `run.json`。脚本会核 `--source-dir` 的 `git rev-parse HEAD` 必须等于 `fc5c4099…`，
   不一致即失败；输入 alpha 不合格时也以明确错误退出，不会改走背景模型。
4. 后处理另存：减面到 ≤2,000 三角形、≤2 材质、GLB ≤500 KB；无贴图或一张 ≤512²
   图集；粗糙非金属；保存可编辑 Blender 源。重导后逐条核对：
   - 朝向仍为 `+Z`，正面不是背面；
   - 按全部顶点把最低点落到 `y=0`，缩到名义高 1.1 m，并用所有顶点（不只包围盒
     单轴的半宽）复算最大 footprint 半径 ≤1.2 m；
   - 保持可重打光：不烘焙硬阴影、不把环境光遮蔽烘进顶点色或贴图；
   - 无透明大面、无特效面片、无外链纹理；
   - 不把细节噪声或面数增加当成品质提升。

   再对同一件做一次局部二改（例如降低最高石尖）验证能重导。
5. 只在通过资产检查、消费者测试、web build 和真实 Three 交战同视角旧/新对比后，
   才替换 `exported/rock.glb` 并更新 `manifest.json` 的 `rock` 条目。manifest 只改
   `sha256` / `bounds` / `bytes`（`triangles` 若与实际几何不符也须改正），并保留
   `id: rock`、`url`、`kind: decoration`、`forward: +Z`、`groundY: 0` 五个字段；
   名义高与 footprint 预算按合同不动。现有 `tools/build.py` 的全量入口仍会从 KayKit
   重导 rock，接入时只改 rock 的源读取入口，其他生成函数与其余 14 个 GLB 不动；
   否则重跑会覆盖新件。

## 权利说明

- TripoSG 代码 MIT，commit 固定为 `fc5c4099…`；权重按上游模型卡为 MIT。本次没能
  打开 Hub 复核模型卡，故这一条只按任务给定信息记录，未独立验证。
- RMBG-1.4 不在本链路里，不随输入或输出分发。
- 输入图由本仓库脚本原创生成，按 CC0-1.0 提供；它不是 KayKit 资产。
- 生成输出是另一层权利，生成后单独记录；不自动标成 KayKit CC0，也不因输入是
  CC0 就推定输出无约束。
- 不提交模型权重、缓存、私人日志或本机路径。

## 验证

已跑：

```sh
PYTHONUTF8=1 python asset-pipeline/battle/tests/test_assets.py
python asset-pipeline/battle/tests/test_openweight_input.py
```

前者 5 项通过（Windows 默认 GBK 读含非 ASCII 的 manifest 会报 UnicodeDecodeError，
需 `PYTHONUTF8=1`；这是既有测试的宿主编码问题，未改测试）；后者 5 项通过，含空
alpha、全不透明 alpha、过小前景和坏 PNG 的拒绝。`run_triposg.py` 只验过 `--help`
与输入预处理（prepared 890×890），完整推理未验证。

未验证：权重下载、TripoSG 推理、简化/重导、GLB 合同、Three 加载与释放、真实交战
截图对比、性能与最终品质。
