# 技能语义占位图标

四个可接入、可编辑的原创图标：`targeted`（指向）、`displacement`（位移）、`persistent-effect`（持续效果）、`control`（控制）。准星、前进楔形、环绕水滴、锁止形状提供不同轮廓，不依赖颜色区分。它们是能力类别占位，不指定英雄技能名、按键、伤害或持续时间。

## 使用和修改

从 `exported/bright/` 或 `exported/dark/` 选同名 SVG；也可直接用对应 `-32.png`／`-48.png`。SVG 为透明背景、64 × 64 viewBox，外边缘保留留白。bright 适合浅背景，dark 适合深背景。应用方负责容器背景及技能映射；这里没有修改游戏运行时。

`source/` 的四个 SVG 是唯一几何源，可在矢量编辑器中改路径。`recipe.json` 控制两套主题：深色背景版保留几何与尺寸，改用浅描边、亮青填充，并将笔画从 4 加粗为 4.5。源中的深蓝代表轮廓、青色代表重点、浅灰代表内部分隔；不要在导出副本上独立修图。

```sh
python3 -m venv asset-pipeline/icons/.venv
asset-pipeline/icons/.venv/bin/pip install -r asset-pipeline/icons/requirements.txt
asset-pipeline/icons/.venv/bin/python asset-pipeline/icons/export.py
asset-pipeline/icons/.venv/bin/python asset-pipeline/icons/test_export.py
```

导出时在本地生成、Git 忽略的 `exported/preview.png` 以实际 32／48 像素并排展示两套图标。导出需要 Python 3.11+、系统 Cairo 及 requirements 中的依赖；使用已交付 SVG／PNG 不需这些工具。无时间戳、网络取材或随机生成；同一渲染依赖环境内可逐字节重建。测试核尺寸、透明边缘、viewBox、重建一致、非法参数及缺失输入失败。

## 来源与接入边界

为 MOBA-Like 以代码编写原创几何，未使用外部图标、商标、角色或图像生成模型。保留这些源文件作为修改起点；本目录不声明第三方 CC0，也不改变仓库许可。

这是一套占位资源，不是最终美术。已查看离线 PNG；实际游戏接入、玩家识别率和无障碍表现仍未验证。
