# 同一局的内容标准件

规格与缺口见 [`docs/content-production.md`](../../docs/content-production.md)。`standard-set.json`锁定五组/14个现有文件的来源、许可、SHA、尺寸、动作和消费者；`siege/`是新增轮式攻城源。

```sh
python3 asset-pipeline/content-set/normalize.py
python3 -m unittest discover -s asset-pipeline/content-set -p 'test_*.py'
```

标准Python、离线。输出`reports/normalized-set.json`：真实GLB的面数/材质/骨数/时间轴，以及米、Y-up、+Z、完整scene父级的等比缩放与脚底偏移。源已归一时输出identity；未知轴、换源、缺动作和超预算直接失败。修改名义尺寸不改bind、骨名、模拟radius，也不用挥击AABB缩人物。

接线复用`loadBattleAssets()`，单位经`SkeletonUtils.clone`获得独立骨架/mixer。归一parent包住完整scene；`reviewLineup`只用于源阵容摆位。普攻trace、Q程序弹道、技能类别图和四音各沿自己的事件语义，来源许可不混为一张通用CC0。

工程检查和Cycles源图的验证范围统一记在内容正文末节；真实游戏接收由案例owner完成。
