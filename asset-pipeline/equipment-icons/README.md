# 装备图标

三件装备的原创功能图标：`sunsteel_blade`（剑）、`warden_plate`（胸甲）、`wayfarer_boots`（靴）。三形各有可分离的轮廓：剑是竖向长刃加横护手，胸甲是宽肩甲带颈线与腰带，靴是高筒转向前的鞋头；32px 下不靠文字或颜色也能区分。图标不编码价格、属性或冷却，装备文字与数值仍由现有 HUD／catalog 提供。

## 使用和修改

从 `exported/bright/` 或 `exported/dark/` 取同名 SVG，或直接用对应的 `-32.png`／`-48.png`。SVG 为透明背景、64 × 64 viewBox，图形外缘保留透明留白。bright 适合浅背景，dark 适合深背景。`source/` 的三个顶层 SVG 是唯一几何源，可在矢量编辑器中改路径；不要在导出副本上独立修图。

`recipe.json` 沿用 `asset-pipeline/icons/recipe.json` 的亮／暗配色与 64 格坐标系，并做了一次统一描边二改：源 SVG 保留 `stroke-width="4"` 的几何身份，导出时两套主题都改为 `4.5`。只改线宽，不移动、不替换路径；物品 ID、价格和属性不在本目录定义，也没有被这项资产工作改动。

```sh
node asset-pipeline/equipment-icons/export.mjs
node --test asset-pipeline/equipment-icons/test_export.mjs
```

导出先在同级临时目录生成 3 件 × 2 主题的 SVG、32／48px PNG 和预览，全部成功后才替换 `exported/`；缺源或渲染失败时保留旧批。输出目录内的其他普通文件会保留。`exported/preview.png` 是按实际像素并排的 480 × 400 预览，只用于检查，不是运行时资产。

PNG 渲染使用本机已装的 `@napi-rs/canvas` 0.1.100（经 `npm root -g` 找到，例如 mermaid-cli 附带的那份）。换机器时若模块不可直接解析，用 `EQUIPMENT_ICONS_CANVAS` 指向模块目录，或设置 `NODE_PATH`；找不到时导出以退出码 2 报「PNG renderer @napi-rs/canvas not found」并保留旧批。本机没有安装 CairoSVG，因此没有复用原技能图标的 Python 导出链；原 `asset-pipeline/icons/` 的源与导出器未改动。

## 实际输出

| 图标 | 源文件 | 32px alpha 包围盒（左、上、右、下开区间） | 48px alpha 包围盒 |
|---|---|---|---|
| Sunsteel Blade | `source/sunsteel-blade.svg` | (8, 4, 24, 28) | (13, 6, 35, 42) |
| Warden Plate | `source/warden-plate.svg` | (4, 6, 28, 28) | (7, 8, 41, 41) |
| Wayfarer Boots | `source/wayfarer-boots.svg` | (7, 4, 27, 27) | (11, 5, 40, 40) |

两套主题的几何相同，包围盒一致；PNG 实际尺寸分别为 32 × 32 和 48 × 48，四角 alpha 为 0。所有图标在 32px 和 48px 下均保留至少 4px 透明边。

## 测试

`test_export.mjs` 覆盖：

- 源 SVG 的 64 × 64 viewBox、`stroke-width="4"`、无 `<text>`，以及配方两主题统一为 4.5；
- 二改后所有路径 `d` 与源逐字一致，只允许颜色和描边宽度变化；
- 非法尺寸、描边宽度、颜色、主题集合被拒绝；CLI 对缺配方／非法配方返回 2 且不创建输出；
- 渲染器缺失时明确报缺项；
- 两次导出的运行文件逐字节一致，PNG 尺寸、透明角与边缘留白正确，已提交输出与新建一致；
- 缺一个源文件时整批失败并保留旧输出；首次失败不留最终目录；
- 输出指向作者源、作者目录或其父目录时拒绝执行。

## 来源与许可

三个图标是 MOBA-Like 为这三件装备原创编写的 SVG 几何，没有采用、描摹或改绘任何商业游戏图标，也没有第三方图标源需要署名。配色与主题字段复用本仓既有技能图标的配方；图形路径为本次新写。本目录不接 HUD；与现有技能图标同框、玩家识别率和具体装备控件仍在后续案例接入时验收。作者在 32px 自检时的主要待复核点是胸甲与既有 `self-shield` 盾图的轮廓接近，以及靴在更小显示尺寸下可能读成容器；这两点需要非作者在 32px 原尺寸并排确认。
