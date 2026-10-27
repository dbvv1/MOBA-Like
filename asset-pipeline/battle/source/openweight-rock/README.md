# 开放权重岩簇候选（TripoSG / TripoSR）

服务基本战斗的路外 `rock` 装饰：用开放权重图生 3D 得到低矮风化岩簇，替换现有 KayKit
`rock_single_C` 派生件。候选尚未接入；`exported/rock.glb`、`manifest.json` 的 `rock`
条目、其余 14 个运行 GLB 都未改动。本页记录输入、工具、许可路径和实际环境结果，不代表
生成成功或品质达标。

## 当前状态（2026-10-27，接收端续修）

**仍阻塞：接收端拿不到官方权重；推理一次都没跑。** 本轮只补 TripoSR 离线输入与源码身份合同，
不代表模型依赖已经闭合。真实执行仍缺：
官方权重、能在隔离 CUDA 环境构建/加载 `torchmcubes` 的工具链（见状态 4），以及在已有
12 GB 的 RTX 5070 上跑真实推理并记录峰值。TripoSR 低成本路线有独立薄调用脚本，
TripoSG 官方 nonflash 窄对照路径有可审的最小 `diso` 延迟导入 patch（基 SHA 与 patch
hash 见下）。TripoSR 新增两个文件的精确 patch，修正 `tsr.utils` 顶层 rembg 导入及
DINO config 隐式 Hub 读取；rembg 是库，不等同于 RMBG-1.4 权重。两路线都不下载背景模型。仍没有原始生成 mesh、没有 Blender
采用源、没有旧/新同视角图，也没有质量结论。

1. **本机官方 Hub TLS 未建立。** 接收端记录 ClientHello 后未收到 ServerHello，
   Python `ssl` 为 `UNEXPECTED_EOF_WHILE_READING`，`snapshot_download` 抛
   `LocalEntryNotFoundError`，内层 `ConnectError: EOF occurred in violation of protocol`。
   这是接收端报告，仓库未附完整请求日志；不足以判断服务器权限拒绝、证书错误或网络策略。
   其他站点可达也不能证明根因。云端于 2026-10-26 可读
   [官方模型卡](https://huggingface.co/VAST-AI/TripoSG)（MIT）；先前“仓库不存在”的
   断言撤回，不能把 TLS EOF 当作仓库 404。云端读页面不证明本机能下载权重。
   2026-10-27 复测 `https://huggingface.co/VAST-AI/TripoSG` 仍是 schannel 握手失败
   （未取得 HTTP 状态），因此没有做权重下载。
   保持同一官方来源和 TLS 验证；不换镜像、代理、凭据，不关闭验证。仅在已确认未执行且
   有网络恢复新证据时作一次受限同源检查；若出现明确平台拒绝，停止该动作并记录恢复条件。
2. **TripoSG 依赖。** 官方 `requirements.txt` 未钉版本的 `diso` 只有 sdist，构建时要
   编译 CUDA 扩展；本机没有 CUDA Toolkit（`cuda_runtime.h` 不存在），`diso==0.1.4`
   构建失败。但非 flash 提取不需要 `diso`：官方 `use_flash_decoder=False` 分支走
   `hierarchical_extract_geometry` 和 `scikit-image.measure.marching_cubes`。上游在
   `inference_utils.py` 顶层 import `diso`，用本页记录的窄 patch 延迟到 flash 函数后，
   任务 venv（无 `diso`）已实测能导入 `TripoSGPipeline` 与 `hierarchical_extract_geometry`，
   并用 dummy SDF 在 GPU 上跑通小尺寸 nonflash 提取（`diso` 未加载，输出 6,104 面，
   峰值 1.7 MiB；不是真实模型推理）。
   `diso` 的 [上游 LICENSE](https://github.com/SarahWeiii/diso/blob/main/LICENSE) 与
   PyPI 均为 CC BY-NC 4.0，不随 TripoSG MIT 改变；产品路径不用 flash，也不推断生成输出
   继承该许可。
3. **显存条件。** 官方要求 >8 GB。实测 RTX 5070 共 12227 MiB：桌面程序占用时
   剩 5115 MiB，释放后剩 11035 MiB。没有为腾显存关闭他人进程，也没有跑推理，
   所以“8 GB 能否跑通”仍未知。
4. **TripoSR 提取依赖未装成。** 官方 `torchmcubes`（MPL-2.0，git `a9ac95a…`）是
   编译扩展。本机有 host MSVC 14.44，但没有 CUDA Toolkit / `nvcc` / `cuda_runtime.h`。
   在任务 venv 实测：先缺 CMake/pybind11，补齐后 CMake 报
   `NO CUDA INSTALLATION FOUND, TRYING TO INSTALL CPU VERSION ONLY!`，随后因已装
   `torch 2.9.1+cu128` 的 Caffe2 需要 CUDA 库而配置失败。没有换 torch、没有另造提取
   框架。恢复条件：在任务隔离的 CUDA torch 环境装 CUDA Toolkit 12.8 的 user-space
   compiler/headers/libraries，使官方 `torchmcubes` 可构建并与该 torch 的 ABI/版本匹配。
   `run_triposr.py` 在 `torch.cuda.is_available()` 为 False 时直接退出，所以 CPU-only
   torch 环境只能用于单独构建/验证 `torchmcubes`，构建产物不能在该环境运行 runner；
   权重仍需 HF。

恢复条件：本机标准 TLS 能完成官方 Hub 握手并取得公开模型的固定 revision；另在任务
隔离的 CUDA torch 环境里使 CUDA 扩展可构建。TLS EOF 的具体根因仍未知，不能擅自安装证书、
改系统安全或要求新凭据。

## 原独立审查 8 条逐项回应

下列是接收端 Workflow 独立复审在上一轮修正后留下的 8 条（不是首轮的 8 条；复审原文由
接收端取回，未入仓）。逐项状态如下：

| # | 原问题 | 本轮处理 | 证据 |
|---|---|---|---|
| 1 | 把 HF 404 误挂到官方 Hub | 已撤回该断言；只记录本机 TLS EOF，并说明云端能读官方模型卡不等于本机能下载 | 本节状态 1；2026-10-27 复测仍为握手失败，未出现 HTTP 404 |
| 2 | 接入步骤未要求改 manifest 的 `source`/`license` | 接入步骤明确同步改 hash/bounds/bytes/triangles/source/license/provenance，保留五个运行字段；若最终许可不是 CC0-1.0，同时把 `test_assets.py` 的全资产许可断言改成显式允许值并保留其余检查（当前尚未接入，未先改测试） | 下文“恢复后的制作顺序”第 5 步 |
| 3 | TripoSR 回退的 rembg 导入与裁剪/灰底合同 | 灰底 RGB 合同保留；仅跳过 `run.py` 不够，`tsr.utils` 仍顶层 import rembg。本轮 `triposr-offline.patch` 把它延迟到实际抠图分支；runner 严核两个补丁文件，不放行任意 dirty | CPU 合同和官方小源码 patch 检查通过；真实 TSR 成功导入仍待 torchmcubes/CUDA，不能把先前缺模块失败当闭合 |
| 4 | `--weights` 示例与帮助把权重目录和源码 checkout 混用 | docstring、`--weights` help 和 README 命令统一为“权重目录（含 `model_index.json`）+ `--source-dir` 源码 checkout” | `run_triposg.py --help` |
| 5 | `run.json` 未记录实际依赖版本 | `runtime.packages` 记录 diffusers/transformers/numpy/Pillow/trimesh/scikit-image/torchvision/diso，未安装项写 `null`；TripoSR sidecar 另记 torchmcubes | `package_versions()`；`test_package_versions_mark_missing` |
| 6 | `--source-dir` 只核 HEAD，未绑定实际 import | 导入后核 `pipeline_triposg`、`inference_utils` 和 TripoSR `tsr.system` 的 `__file__` 都在已核 checkout 下，否则明确失败 | `verify_imported_modules`；`test_import_must_come_from_verified_checkout` |
| 7 | 缺少可复现的后处理/转换脚本 | 新增 `postprocess.py`：减面、接地、缩到 1.1 m、单粗糙非金属材质、GLB 导出、全顶点 footprint/三角面/材质/字节合同检查；材质与贴图数从导出 GLB 的 JSON chunk 实测，不写死；写 `postprocess.json` | 合成 20,480 面网格实跑：减到 2,000 面、36,956 B、高 1.1 m、半径 0.331 m、实测 1 材质 / 0 贴图 / OPAQUE；带贴图与 3 材质导出被拒绝 |
| 8 | 缺旧/新差距二改与云端补图退路 | 制作顺序第 5 步和“验证”补：取同视角旧/新图后列最大 1–2 处差距并对同一件二改复评；本机取不到实际游戏图时保留工程候选，明确由云端产品 owner 补真图，离线 Blender 图不算运行品质 | 下文“恢复后的制作顺序”第 5 步 |

## 两条生成路线

先在任务环境里核 TripoSR：`torchmcubes`（MPL-2.0）能在 CUDA torch 下构建/加载时，它是
首选的低成本路线（官方源码与权重 MIT，默认单图约 6 GB）。TripoSG nonflash 只作许可已清
的窄对照/后备，不先于 TripoSR 执行。

### TripoSR（首选低成本路线；torchmcubes/CUDA 依赖可构建时）

适用条件：任务隔离环境里的 CUDA torch 能构建/加载官方 `torchmcubes`，且能取得官方权重。
满足时先跑这条路线；依赖链仍不可用才转下一节的 TripoSG nonflash 窄对照，不另造提取框架。

官方源码与权重均为 MIT；源码固定 `107cefdc244c39106fa830359024f6a2f1c78871`，权重
`stabilityai/TripoSR`。`run_triposr.py` 不调用 `run.py`：

```sh
python asset-pipeline/battle/tools/openweight-rock/run_triposr.py \
  --weights <本地 TripoSR 权重目录（config.yaml + model.ckpt）> \
  --revision 5b521936b01fbe1890f6f9baed0254ab6351c04a \
  --source-dir <固定 commit 且已应用下述 patch 的 TripoSR checkout> \
  --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
  --out-dir asset-pipeline/battle/source/openweight-rock/generated-triposr
```

输入合同对应上游 `--no-remove-bg`：真实 alpha 只用于离线裁剪/合成，最终交给模型的是
中性灰 0.5 底的 RGB，不带 alpha；`rembg` 不安装、不导入、不初始化，`tsr.bake_texture`
（xatlas）也不导入。这里是 runner 与已审 patch 的合同，不是已取得真实 TSR 导入成功的结果。
提取仍用官方 `torchmcubes`，不另写 marching cubes。它当前因缺 CUDA Toolkit 不能构建
（见状态 4），这条路线仍为依赖阻塞。

#### 本地配置与精确 source patch

固定上游的 `tsr/models/tokenizers/image.py` 在构造 tokenizer 时还调用
`hf_hub_download("facebook/dino-vitb16", "config.json")`，没有 revision。
只备齐 TripoSR 的两个权重文件再设 `HF_HUB_OFFLINE=1`，空 Hub cache 仍会失败。
本轮不预热用户 cache，也不下载 DINO 权重：随工具提供官方 **454 B config.json** 原字节，
patch 改为 `from_json_file` 读取 runner 指定的本地路径，缺失或错 hash 直接失败。

- DINO：`facebook/dino-vitb16`，revision `f205d5d8e640a89a2b8ef0369670dfc37cc07fc2`；
  `config/dino-vitb16-config.json`，SHA-256
  `b87c0270b97db085fd82cf114a761fd0f62ae7914fbd407c752a2260646b689c`。
  [固定官方文件](https://huggingface.co/facebook/dino-vitb16/blob/f205d5d8e640a89a2b8ef0369670dfc37cc07fc2/config.json)、
  [固定模型卡](https://huggingface.co/facebook/dino-vitb16/blob/f205d5d8e640a89a2b8ef0369670dfc37cc07fc2/README.md)
  标 Apache-2.0；文件未修改，许可证随附于 `config/LICENSE-Apache-2.0.txt`。
- TripoSR 权重 revision：`5b521936b01fbe1890f6f9baed0254ab6351c04a`；
  runner 要求确切的 `config.yaml`（987 B，SHA-256
  `74ca708ce086bf68e97709ea6b3d91f14717921c04691e84043f0eb8fcc68e62`）与 `model.ckpt`，checkpoint 1,677,246,742 B，SHA-256
  `429e2c6b22a0923967459de24d67f05962b235f79cde6b032aa7ed2ffcd970ee`。
  本轮未取得/读取这个 checkpoint；这是固定官方元数据，不是下载成功证据。
- 源码基 commit：`107cefdc244c39106fa830359024f6a2f1c78871`。
  patch：`tools/openweight-rock/patches/triposr-offline.patch`，SHA-256
  `99167c33aebec64285c97b40c6e4bf75d2d7bdc332f3015865863fd0eccd5b14`。
  仅改 `tsr/utils.py` 的 rembg 延迟导入，以及 `tsr/models/tokenizers/image.py` 的本地 config 读取；
  不改网络、模型结构、权重或提取器。

| 源码路径 | 上游文件 SHA-256 | 补后文件 SHA-256 |
|---|---|---|
| `tsr/utils.py` | `d9d1a645fef7ea489615bff3471fd01a4941a2c0e138c5dff5daae619563279b` | `ec1f673845cfd7568440e51ed9a8947b08a6fb72d5534b0f25856f5cbc2c4394` |
| `tsr/models/tokenizers/image.py` | `f6da23124dfabe6a1f8d0d27693d0cece6574de68be15487a77781b6a9d73195` | `32a12f638e85e73701622dad7092d276119173512d5afbb72dbb4b5d627ebd9c` |

在**专用、无其他改动**的固定源码 checkout 应用，不提交 patch 到上游 checkout；Git 工作树
须保留 LF 字节（Windows 专用 checkout 用 `core.autocrlf=false`）。从产品仓库复制 patch 的绝对
路径给下列占位，不移动或改写用户已有源码：

```sh
git -C <TripoSR源码目录> apply --check <triposr-offline.patch的路径>
git -C <TripoSR源码目录> apply <triposr-offline.patch的路径>
```

runner 在 torch/TSR import、CUDA 初始化和输出创建前验证 DINO config、固定 HEAD、两文件
前后 SHA、恰好两个未暂存修改路径；错源版本、漏 patch、额外 dirty/untracked、暂存改动及
隐藏修改的 index flags 都拒绝；整个 source checkout 内被 ignore 的额外文件（包括根目录依赖同名文件与旧字节码）也拒绝，
请用独立无缓存 checkout。runner 在所有上游/重依赖导入前设置进程级
`sys.dont_write_bytecode=True`，不生成 `__pycache__`；不删除用户已有文件或改系统设置。它不自动打 patch，不将 dirty 树冒称 clean 上游。
`--dino-config` 可改存放路径，不能换 config 身份；运行记录只收 repo/revision/相对文件名/hash，
不写用户本机路径。真实 import 后还核 `tsr.system`、`tsr.utils`、tokenizer 与已加载 tsr 模块
是否来自同一 checkout，支持 namespace package，模型加载后复核 rembg 未导入。

本轮云端只读取 DINO 454 B config 与 TripoSR 987 B config 等小源码/元数据，仅说明这些小文件可取得；**不代表接收端 schannel TLS 恢复**。
无真实 TSR 导入、权重推理、mesh、GLB 接入或品质采用结论。

### TripoSG nonflash（许可已清的窄对照/后备）

适用条件：TripoSR 的依赖链仍不可用，或需要同输入的官方 nonflash 窄对照，且官方权重
可取得。它是窄对照/后备，不是默认先跑的产品路线。

上游固定 commit `fc5c4099…` 的官方非 flash 分支走
`hierarchical_extract_geometry` → `scikit-image` marching cubes，代码路径不依赖 `diso`。
`patches/triposg-nonflash.patch` 只做一件事：把 `triposg/inference_utils.py` 顶层的
`from diso import DiffDMC` 移进 `flash_extract_geometry` 的 `try` 块，非 flash 路径不再
触发 CC BY-NC 依赖。

- 基 commit：`fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c`
- patch：`tools/openweight-rock/patches/triposg-nonflash.patch`
- patch SHA-256：`32bec58f6c3cd4dd06fdeb50ba19be3f148d3d0dcf7d81f08b8ef55223589b71`
- runner 不把打过 patch 的树称为 clean 上游：它要求 checkout HEAD 等于基 commit、
  `git diff HEAD` 的字节 hash 等于上面的 patch hash、且没有未跟踪文件；`run.json`
  记录 `baseCommit`、`patched: true`、patch 文件名与 hash。
- 已实测（任务 venv，没有装 `diso`）：`git apply --check` 通过，应用后
  `git diff` 的 hash 与 patch hash 相同；`from triposg.pipelines.pipeline_triposg import
  TripoSGPipeline` 与 `hierarchical_extract_geometry` 导入成功，`'diso' in sys.modules`
  为 False。
- 仍未实测：12 GB 实机峰值显存与真实推理，因为没有权重。flash 模式只作对照，不是产品路径。

## 已准备的文件

| 文件 | 作用 |
|---|---|
| `source/openweight-rock/input/rock-cluster.png` | 1024²、8-bit RGBA 的自制输入；真实 alpha，单物体，无文字/发光/旗帜/硬阴影 |
| `source/openweight-rock/input/make_input.py` | 确定性重画脚本；三块不等高、约 1.5:1 宽的切面岩体，暖灰石＋少量暗绿苔斑与细裂 |
| `source/openweight-rock/README.md` 的权利说明 | 输入、代码、权重、依赖与输出权利分开记录 |
| `tools/openweight-rock/png_rgba.py` | 无第三方依赖的 RGBA PNG 读取、alpha 合同与 RGB PNG 写出；空/全不透明/过小 alpha 明确报错 |
| `tools/openweight-rock/run_triposg.py` | TripoSG 薄调用：nonflash 为默认；只吃本地权重；核基 commit + 已审 patch；核实际 import 路径；断言非 flash 没导入 `diso`；保留原始 mesh；不下载权重/背景模型 |
| `tools/openweight-rock/patches/triposg-nonflash.patch` | 官方 `fc5c4099` 上的最小 `diso` 延迟导入 patch（SHA-256 `32bec58f…`） |
| `tools/openweight-rock/run_triposr.py` | TripoSR 薄调用：核固定本地 DINO config、精确两文件 patch、权重身份及真实 import 路径；灰底 RGB；不下载 |
| `tools/openweight-rock/patches/triposr-offline.patch` | 固定 `107cefdc` 上的 rembg 延迟导入 + 本地 DINO config 窄修 |
| `source/openweight-rock/config/` | 官方 454 B DINO config 原字节及 Apache-2.0 许可证；没有权重 |
| `tools/openweight-rock/postprocess.py` | 可重复的 raw→final 转换：减面、接地/缩放、单材质、从导出 GLB 实测材质/贴图/alphaMode 的合同检查、GLB 与 sidecar |
| `tools/openweight-rock/test_runner.py` | 42 项 CPU-only 检查：保留原 20 项，新增本地 DINO/权重/模块身份 9 项与真实小 Git fixture 13 项；不导入 TSR |
| `tests/test_openweight_input.py` | 输入合同与坏输入拒绝（5 项，纯 Python） |

输入图 SHA-256：`6139b5ba738ee39848bf0ef2358477e42607e65ee53aace19c768c92b0d31b9f`。
含抗锯齿边缘的全 alpha 前景覆盖约 22.2% 画布（其中全不透明像素 21.5%，1–254 的软边
像素 0.67%）；裁剪与报告都用 `a > 0` 的包围盒 742×504（宽高比 1.47），全不透明核心
的 bbox 为 736×496。
生成后仍需缩到名义高 1.1 m。若生成件保持输入的宽高比，投影半宽约 0.81 m；深度不受输入
剪影约束，若深度≈宽度则最大半径约 1.15 m，仍低于 1.2 m 上限，但必须按全部顶点复算，
不能用包围盒单轴代替。

## 实际跑过的环境探测

| 项 | 结果 |
|---|---|
| GPU | NVIDIA GeForce RTX 5070，12227 MiB，驱动 617.14 / CUDA UMD 13.4 |
| PyTorch | `2.9.1+cu128`，`torch.cuda.is_available()=True`，capability `(12, 0)` |
| CUDA / cuDNN | 12.8 / 9.10.2；无 CUDA Toolkit，`nvcc`/`cuda_runtime.h` 不存在 |
| 主机编译器 | MSVC 14.44.35207（Visual Studio 2022 Community），未加入 PATH |
| 冒烟矩阵乘 | 4096² fp16 连续 5 次，约 3.4 ms/次；峰值分配 232 MiB |
| 推理 | 未运行（权重不可达） |
| TripoSG 源码 | commit `fc5c40990181e2a756c4e0b1c2f4d6b5202faf8c`（固定） |
| TripoSG nonflash 导入/提取 | 打 patch 后任务 venv（无 `diso`）导入成功；dummy SDF（bounds ±1，depth 4→5）提取返回 6,104 面，峰值 1.7 MiB，`diso` 未加载 |
| TripoSR 源码 | commit `107cefdc244c39106fa830359024f6a2f1c78871`（固定） |
| torchmcubes | git `a9ac95aa329957ba646e7bb057f825f5dfa77f38`，MPL-2.0；CMake 找 CUDA 失败，未构建 |
| fast-simplification | 0.2.0，MIT（后处理减面用） |
| 依赖（实测安装） | diffusers 0.41.0、transformers 5.20.2、trimesh 5.2.0、numpy 1.26.4、Pillow 12.3.0、scikit-image 0.25.2、torchvision 0.24.1+cu128 |

`transformers` 已到 5.x，导入时提示 `BitImageProcessor` 需要 torchvision（已装）而回退；
官方 `requirements.txt` 只钉了 `numpy==1.22.3`，其余依赖未钉；上表是接收端报告安装的
组合，完整 flash pipeline 导入仍因 diso 失败（numpy 1.26.4 + scikit-image 0.25.2 +
transformers 5.20.2 等）。这些版本不作为已验证可复现环境；恢复时导出实际环境并逐包核
版本（偏离官方 pin 须解释并先验证），不能把 `pip install -r requirements.txt` 后“能
import”当成功——那会把 numpy 降回 1.22.3，就不再是 `run.json` 记录的实测组合。

## 恢复后的制作顺序

1. 放进官方权重，记录 revision 与每个权重文件的 SHA-256（含 `model_index.json`、
   各组件嵌套的 `config.json` 等元数据与全部张量分片）；RMBG 不下载。runner 的
   `weights_fingerprint` 会把这些文件连同相对路径、字节数和 SHA-256 写入 `run.json`。
2. 在任务专用 prefix 建 Python 3.10 的 CUDA torch 环境（CPU-only torch 只能单独
   构建/验证 `torchmcubes`，不能运行 `run_triposr.py`），先核既有 MSVC `cl`、`nvcc`、
   `CUDA_HOME` 与 torch CUDA 版本。NVIDIA [12.8 Windows 安装文档](https://docs.nvidia.com/cuda/archive/12.8.0/cuda-installation-guide-microsoft-windows/index.html#using-conda-to-install-the-cuda-software)
   给出官方 Conda Toolkit 和版本 label；可先 dry-run `cuda=12.8` 的隔离安装方案，
   只允许 user-space compiler/headers/libraries，不装或更新驱动、不改系统 PATH/安全设置。
   若缺 host compiler，记录该独立阻塞，不静默跑系统安装器。PyTorch CUDA wheel 能运行
   不代表含 `nvcc`；pip runtime 也不是完整编译工具链，未找到经验证的 Windows
   `torchmcubes`/`diso` wheel。上表环境是历史报告，不盲钉尚未核对的组合；固定实际可
   安装的版本与 wheel/source hash，保留与上游 numpy pin 的差异。源码使用固定
   checkout 加对应路线的精确 patch，避免 editable 导入别处代码。
3. 按依赖条件选路线，优先跑 TripoSR（相对仓库根）：

   - **首选：TripoSR**（官方 `torchmcubes` 在该 CUDA torch 环境可构建/加载时）：
     ```sh
     python asset-pipeline/battle/tools/openweight-rock/run_triposr.py \
       --weights <本地 TripoSR 权重目录（config.yaml + model.ckpt）> \
       --revision 5b521936b01fbe1890f6f9baed0254ab6351c04a \
       --source-dir <固定 commit 且已应用 triposr-offline.patch 的 TripoSR checkout> \
       --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
       --out-dir asset-pipeline/battle/source/openweight-rock/generated-triposr
     ```
     产物为 `prepared-input.png`（`a > 0` 裁剪后合成到中性灰 0.5 的 RGB，无 alpha）、
     未改动的 `raw.glb` / `raw-mesh.npz`，以及记录输入/权重/耗时/峰值显存/依赖版本的
     `run.json`。revision 必须等于上面固定值，两个权重文件和 DINO config 都核大小/hash；
     输出目录必须空。`rembg` 和
     `tsr.bake_texture` 被导入时 runner 明确失败。
   - **仅当 TripoSR 依赖链仍不可用时：TripoSG nonflash 窄对照/后备**（`--source-dir`
     指向固定 commit 的 checkout，并在其上应用本页 patch；runner 会自己核 patch hash）：
     ```sh
     python asset-pipeline/battle/tools/openweight-rock/run_triposg.py \
       --weights <本地官方权重目录> --revision <完整 Hub commit> \
       --source-dir <固定 commit + 已审 patch 的 TripoSG checkout> \
       --image asset-pipeline/battle/source/openweight-rock/input/rock-cluster.png \
       --out-dir asset-pipeline/battle/source/openweight-rock/generated
     ```
     产物为 `prepared-input.png`（alpha 校验后按 `a > 0` 包围盒裁剪并白底合成）、未改动
     的 `raw.glb` / `raw-mesh.npz`，以及记录输入/权重/耗时/峰值显存/基 commit/patch/依赖
     版本的 `run.json`。revision 必须是完整 Hub commit；输出目录必须空。显式 nonflash；
     若 `diso` 被导入，runner 以明确错误退出，不把该次运行记为许可已清。12 GB 下若需降
     `--dense-octree-depth` / `--hierarchical-octree-depth`，必须把值、峰值显存和画质
     变化一起记录，不靠无限重试。
4. 后处理另存（`--raw` 取上一步首选或后备路线的 `raw.glb`）：
   ```sh
   python asset-pipeline/battle/tools/openweight-rock/postprocess.py \
     --raw asset-pipeline/battle/source/openweight-rock/generated-triposr/raw.glb \
     --out-dir asset-pipeline/battle/source/openweight-rock/final
   ```
   脚本减面到 ≤2,000 三角形、建单个粗糙非金属材质、接地并缩到名义高 1.1 m，按全部顶点
   复算最大 `sqrt(x²+z²)` ≤1.2 m；导出后从 GLB 的 JSON chunk 实测材质/贴图/图片数与
   alphaMode，材质 >2、出现贴图/图片或非 OPAQUE 材质即报错，并检查 GLB ≤500 KB，写
   `postprocess.json`。可编辑 Blender 源固定放 `source/openweight-rock/rock.blend`，从
   `raw.glb`/最终 GLB 在 Blender 里另存；本机没有 Blender，这一步未生成、未验证。重导后逐条核对：
   - 朝向仍为 `+Z`，正面不是背面；
   - 最低点 `y=0`，名义高 1.1 m，最大 footprint 半径按所有顶点复算；
   - 保持可重打光：不烘焙硬阴影、不把环境光遮蔽烘进顶点色或贴图；
   - 无透明大面、无特效面片、无外链纹理；
   - 不把细节噪声或面数增加当成品质提升。
   脚本的 `manualChecks` 列出无法从顶点自动判断的项，必须人工过一遍。再对同一件做一次
   局部二改（例如降低最高石尖），用同一脚本重导，确认可复现。
5. 只在通过资产检查、消费者测试、web build 和真实 Three 交战同视角旧/新对比后，
   才替换 `exported/rock.glb` 并更新 `manifest.json` 的 `rock` 条目。manifest 同步改
   实际 hash / bounds / bytes / triangles 以及此生成件的 `source` / `license` /
   provenance，不能保留旧 KayKit 来源标签，并保留
   `id: rock`、`url`、`kind: decoration`、`forward: +Z`、`groundY: 0` 五个字段；
   名义高与 footprint 预算按合同不动。若最终许可不是 `CC0-1.0`，把
   `tests/test_assets.py` 的全资产许可断言改为该件的显式允许值，保留其余 hash/尺寸/
   材质/自包含检查，不删断言让候选过关。
   现有 `tools/build.py` 的全量入口仍会从 KayKit 重导 rock，接入时只改 rock 的源读取
   入口，其他生成函数与其余 14 个 GLB 不动；否则重跑会覆盖新件。
   实际相机/灯光下的旧/新同视角图到手后，列最大的 1–2 处差距（例如轮廓不规则度、
   接地阴影或遮挡），针对同一件二改后同视角复评。本机若拿不到实际游戏图，保留资产
   工程候选并明确由云端产品 owner 补真图；离线 Blender 图不算运行品质。

## 权利说明

- TripoSG 代码 MIT，commit 固定为 `fc5c4099…`；权重模型卡 MIT 已由云端在 2026-10-26
  复核；本机尚未取得权重文件。
- `diso==0.1.4` 为 CC BY-NC 4.0，不是 TripoSG MIT 的一部分。产品路径不用 flash，
  也不使用 `diso`；非 flash patch 只把它的 import 延后，不改变其许可。
- TripoSR 源码与权重 MIT（commit `107cefdc…`，`stabilityai/TripoSR`）；`torchmcubes`
  为 MPL-2.0，编译/分发依赖代码须守其条款。
- `fast-simplification` 0.2.0 为 MIT，只在后处理减面时使用。
- DINO 的本地 config 单独按 Apache-2.0 记录，不将其误标 MIT；没有引入 DINO 权重。
- RMBG-1.4 不在本链路里，不随输入或输出分发；`rembg` 库同样不安装/不导入。
- 输入图由本仓库脚本原创生成，按 CC0-1.0 提供；它不是 KayKit 资产。
- 生成输出是另一层权利，生成后单独记录；不自动标成 KayKit CC0，也不因输入是
  CC0 就推定输出无约束。
- 不提交模型权重、缓存、私人日志或本机路径。

## 验证

### 本轮云端 CPU-only 离线合同（2026-10-27）

- 复用已有 Python 3.12.14 venv（numpy 2.5.4 / Pillow 13.0.0 / trimesh 5.2.0），`test_runner.py` **42/42 通过，0 skip**；没有安装依赖。
  新增 22 项覆盖固定 DINO、错 hash/缺文件、先于 heavy import/输出失败、精确 patch 路径/hash、
  checkpoint 文件名/revision/hash 拒绝、module 路径与 namespace 元数据合同，以及真实小 Git
  fixture 的错 HEAD、漏 patch、同路径错字节、额外 tracked/untracked/ignored、staged、index flags 和链接拒绝。
- 官方固定两个小源码文件：实际 `git apply --check`、apply/reverse/apply 通过，前/后文件 SHA 与
  上表一致。它们被放入**合成小 Git 仓库**测试，未 clone 完整上游；production verifier
  正确拒绝该合成 HEAD。该测试不是官方完整 checkout 验证，更不是 TSR import 成功。
- 两个独立 Python 进程真实导入同一合成小模块；每次导入后 source guard 仍通过且无
  `__pycache__`/`.pyc`。子进程明确移除环境中的 bytecode/cache 覆盖，验证 runner 自己的进程级设置，
  不是 `-B` 或测试父进程替它关闭缓存；未导入 TSR。
- 454 B 官方 config 的本地 hash 通过；新测试的 dummy checkpoint 与模块 metadata 对象只测拒绝
  和路径合同，没有替身 TSR、没有模型加载。torchmcubes/CUDA、真实 import 和推理仍待验证。
- `test_openweight_input.py` 5/5 通过；runner `--help` 与 `git diff --check` 通过。
- 本轮未运行 npm/web smoke；只改制作工具/测试与源说明，不改运行 GLB、manifest、src 或原卡。

### 接收端历史验证（本轮不重算为真实模型通过）

已跑（2026-10-27，原 20 项版本）。`test_runner.py` 必须在任务 venv（上表记录的依赖组合，含 `trimesh`
5.2.0 与 `Pillow` 12.3.0）中运行：两项后处理合同会真实导出并读取 GLB。系统 Python
没有 `trimesh`，这 2 项会以“needs the task venv”跳过，不再报错；任务 venv 中是
20/20 通过。`test_openweight_input.py` 和 `test_assets.py` 只用标准库。

```sh
# 在任务 venv 中执行第一条；后两条用任意 Python 3 即可
PYTHONUTF8=1 python asset-pipeline/battle/tools/openweight-rock/test_runner.py
PYTHONUTF8=1 python asset-pipeline/battle/tests/test_openweight_input.py
PYTHONUTF8=1 python asset-pipeline/battle/tests/test_assets.py
```

- `test_runner.py`：任务 venv 中 20 项通过（原有 5 项来源/输出保护 + 新增 15 项：
  依赖版本 1、权重指纹 1（含嵌套 `config.json`）、nonflash patch 4、TripoSR 4、
  后处理 5）。
- `test_openweight_input.py`：5 项通过，含空 alpha、全不透明 alpha、过小前景和坏 PNG
  的拒绝。
- `test_assets.py`：5 项通过（Windows 默认 GBK 读含非 ASCII 的 manifest 会报
  UnicodeDecodeError，需 `PYTHONUTF8=1`；这是既有测试的宿主编码问题，未改测试）。
- TripoSG patch：`git apply --check` 通过；应用后 `git diff HEAD` 的 SHA-256 等于
  `32bec58f…`；任务 venv（无 `diso`）导入 `TripoSGPipeline` 和
  `hierarchical_extract_geometry` 成功。用 dummy SDF 在 GPU 上跑小尺寸 nonflash 提取，
  得到 3,054 顶点 / 6,104 面，峰值 1.7 MiB，`diso` 未加载。撤销 patch 后 checkout 恢复
  干净；clean 模式也会拒绝已打 patch 的树。该提取测试不涉及真实权重或 12 GB 模型。
- 后处理：用合成 20,480 面网格跑 `postprocess.py`，输出 2,000 面、36,956 B、高 1.1 m、
  最大半径 0.331 m；从导出 GLB 实测 1 材质、0 贴图、0 图片、`alphaMode=OPAQUE` 并写入
  `postprocess.json`。另有从真实导出的 GLB 检查带贴图件和 3 材质件被合同拒绝的测试。
  该网格不是岩簇，只证明脚本可重复执行和合同检查生效。
- TripoSR 依赖：`torchmcubes` 从官方 git 构建，CMake 报无 CUDA 安装、CPU 回退又因
  `torch+cu128` 的 Caffe2 缺 CUDA 库失败；未安装成功。`run_triposr.py` 用真实输入和
  占位权重跑到依赖边界：生成 872×872、colour type 2（无 alpha）的 `prepared-input.png`，
  随后在 `tsr.system` 导入处退出，实际输出为
  `TripoSR source is not importable: No module named 'torchmcubes'.`（缺失模块名来自
  import 异常），失败路径也复核了 `rembg`/`tsr.bake_texture` 未导入。这个前置失败没有到达
  `tsr.utils`，不能证明成功导入 TSR 时不会加载 rembg；本轮已修源码合同但未补真实导入证据。
- `run_triposg.py --help`、`run_triposr.py --help` 正常；两者在解析参数前不导入 torch。
- 缺权重失败：两个 runner 用空权重目录实跑，都在权重检查处以明确错误退出
  （`model_index.json` / `config.yaml` missing），没有发起任何下载。
- `npm test`：35 个文件 / 178 项通过；`npm run build:web` 成功（仅有既有 chunk
  >500 kB 警告）。本次只改资产工具与文档，未改 `src/`、sim/nav、角色或运行 GLB。
- 未跑 `npm run smoke`：候选尚未替换 `rock.glb`，没有新的运行资产可载入。

未验证：权重下载、TripoSG/TripoSR 推理、真实 12 GB 峰值显存、Blender 重导与 `.blend`
采用源、GLB 合同在真实生成件上的结果、Three 加载与释放、旧/新交战截图对比、二改复评、
性能与最终品质。整体仍为 blocked，不是“已生成”。
