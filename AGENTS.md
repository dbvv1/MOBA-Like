# MOBA-Like 工作约定

本仓库是 [a1dbv](https://github.com/dbvv1/a1dbv) 游戏方向的作品案例：一款原创网页 MOBA 的纵切片，用来把 a1dbv 已写的技能、AI、寻路等模块跑成可玩结果。方向与优先级以 a1dbv 的[方向锚点](https://github.com/dbvv1/a1dbv/blob/main/AGENTS.md)、[作品案例约定](https://github.com/dbvv1/a1dbv/blob/main/docs/collaboration/game-taskbook.md#6-作品案例)和 [TASKS](https://github.com/dbvv1/a1dbv/blob/main/docs/collaboration/TASKS.md) 为准；本文件只管在本仓库怎么干活。要做什么见 [docs/brief.md](docs/brief.md)。

## 负责与发布

- 负责人是 a1dbv 的 dot-B。实现、资源制作和测试可通过 a1dbv 的 [local-jobs](https://github.com/dbvv1/a1dbv/blob/main/docs/collaboration/local-jobs/README.md) 交给本地模型，由 dot-B 接收。
- `main` 随时可玩：自测通过即合入，不长期停在临时分支；不强推、不改写历史。
- 提交身份用 GitHub noreply 邮箱或 Agent 平台的固定机器身份。不提交密钥、私人对话、本机路径和个人邮箱。

## 命令

建工程时提供下列脚本，之后保持这些名字：

| 命令 | 作用 |
|---|---|
| `npm ci` / `npm run dev` | 安装依赖 / 本地开发服务器 |
| `npm run build` | 生产构建 |
| `npm test` | 单元测试与模拟断言，必须无画面运行 |
| `npm run sim -- --games <N> --seed <S>` | 无画面批量对局，输出胜率、时长、技能与 AI 统计 |
| `npm run smoke` | 构建产物在无头浏览器里加载并截图 |

## 结构

- `src/sim/`：确定性模拟。固定步长；随机数只用带种子的随机源；不读系统时间，不引用 DOM、Three.js 或网络。外部只通过输入命令影响对局，同一种子加同一命令序列必须得到同一结果。
- `src/render/`、`src/ui/`、`src/input/`：只读模拟状态，只向模拟发命令。
- 寻路网格由 `tools/` 离线烘焙成文件，模拟层只加载它，不从渲染几何现场生成。
- `src/content/`：英雄、技能、单位、数值等数据定义，与实例状态分开。
- `tests/`：单元测试与模拟断言；`tools/`：资源处理和统计脚本。
- `assets/<类别>/`：每个目录一份 README，写来源、许可、生成提示或处理配方。

## 验收

1. **自动**：`npm test` 通过；改动涉及战斗、数值或 AI 时，跑 `npm run sim` 并对照 brief 的目标区间。
2. **浏览器**：`npm run smoke` 通过：开一局后无控制台错误，画布内有非背景像素，页面暴露的调试状态显示对局在推进。云端没有 GPU 时，Playwright Chromium 可用 `--use-angle=swiftshader` 走软件 WebGL，保留 sandbox，并用 `ignoreDefaultArgs: ['--enable-unsafe-swiftshader']` 精确移除 Playwright 默认追加的该参数；必须核实际进程 argv，不能只看显式 args。首次建脚本时确认该配置真能创建 WebGL 上下文，不以改安全配置绕过失败。
3. **品质**：功能通过只完成一半。每个完整体验单元按 brief 选同规模优秀公开参照，实际游玩并由非作者并排观察截图／录像，列最大差距、优化后复评；达到该参照的对应品质维度才算完成。无法实际看到／听到的项如实保留未评，不用 smoke 或代码断言代填。需要用户手感判断的记入 a1dbv TASKS“待人工验收”，这不代表品质已达标。

汇报只写实际跑过的结果；没跑的写“未验证”，一句即可。

## 写作

- README 面向玩家：是什么、怎么运行、怎么玩。不写开发经过、验证日志和免责声明。
- 设计变化改 `docs/brief.md`。案例跑通、推翻或改写了 a1dbv 某个模块的做法，回 a1dbv 更新那一页。
- 名字、英雄、地图、美术和音效原创，或使用许可清楚的素材；不照搬任何商业游戏的内容。
