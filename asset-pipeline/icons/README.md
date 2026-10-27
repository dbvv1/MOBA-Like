# 技能语义图标

五个已采用的原创类别图标：`targeted`（指向）、`displacement`（位移）、`persistent-effect`（持续效果）、`control`（控制）、`directional-projectile`（方向弹道）。准星、前进楔形、环绕水滴、锁止形状提供不同轮廓；方向弹道用斜向尖头与分离轨迹点，区别于位移的横向楔形和速度线，避免只靠颜色区分。它们是能力类别，不指定英雄技能名、按键、伤害或持续时间。新增 `self-shield`（自护盾）补 Morrow W 原本只有文字的空缺；只在 self 投递、self 目标且真实 effects 含 shield 时采用，不给所有 self 技能、治疗或 W 槽猜图。

## 使用和修改

从 `exported/bright/` 或 `exported/dark/` 选同名 SVG；也可直接用对应 `-32.png`／`-48.png`。SVG 为透明背景、64 × 64 viewBox，外边缘保留留白。bright 适合浅背景，dark 适合深背景。应用方负责容器背景及技能映射；现有 HUD 通过 `presentation/icons.js` 按 catalog 的 delivery/targetType 选图，不按按键猜语义；方向型 projectile 对应新增图，仍保真实技能名、目标方式、可用与冷却状态。

`source/` 的六个顶层 SVG 是运行图的唯一几何源，可在矢量编辑器中改路径。`recipe.json` 控制两套主题：深色背景版保留几何与尺寸，改用浅描边、亮青填充，并将笔画从 4 加粗为 4.5。源中的深蓝代表轮廓、青色代表重点、浅灰代表内部分隔；不要在导出副本上独立修图。

```sh
python3 -m venv asset-pipeline/icons/.venv
asset-pipeline/icons/.venv/bin/pip install -r asset-pipeline/icons/requirements.txt
asset-pipeline/icons/.venv/bin/python asset-pipeline/icons/export.py
asset-pipeline/icons/.venv/bin/python asset-pipeline/icons/test_export.py
```

导出时在本地生成、Git 忽略的 `exported/preview.png` 以实际 32／48 像素并排展示两套图标。导出需要 Python 3.11+、系统 Cairo 及 requirements 中的依赖；使用已交付 SVG／PNG 不需这些工具。无时间戳、网络取材或随机生成；同一渲染依赖环境内可逐字节重建。测试核尺寸、透明边缘、viewBox、重建一致、非法参数及缺失输入失败。

## 来源与接入边界

原五图为 MOBA-Like 以代码编写的原创几何，原 source/export 字节保持不变。新增盾轮廓采用 [Tabler Icons shield](https://tabler.io/icons?icon=shield)，作者 Paweł Kuna，MIT；原件、完整许可与固定提交/字节身份在 `source/tabler/`。完整 MIT 通知随新的运行 SVG 保留，不将其称为 CC0。原 24 格路径按 2.4 倍、平移 (3.2,3.2) 进入原 64 格，沿现有 recipe 使用填充与描边；没有治疗十字、装饰叶片或另造英雄套图。二改仍改顶层 SVG 与同一 recipe，不在导出副本修改。

选择是补缺，不是给原五类换皮：实际 32/48 像素看过 [Game-icons/Sbed 盾](https://game-icons.net/1x1/sbed/shield.html)（CC BY 3.0）与 Tabler。前者狭长实心，后者宽盾轮廓更接近现有几何、方便沿原线宽/重点色适配。未采用 Game-icons 原件，不把许可清楚等同于视觉已胜。

保留技能文字、真实冷却和原 disabled 遮罩，不为每个状态再画一张。离线双主题 32/48 与源重建已核；[实际 HUD 观察](review/self-shield/receipt.json)中，原版 W 空图被 32px 盾补齐，800×600 正常新绘制、原冷却禁用及自然恢复保留；重启尾部 QA 守卫修正后通过两次，首轮失败照留。经非作者核收有限采用；不是英雄整套插画完成。玩家识别率和完整无障碍仍未测，不以轮廓熟悉或测试数量代替。
