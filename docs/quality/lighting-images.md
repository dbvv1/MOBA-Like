# 本轮灯光图来源

- `lighting-before.png`：上一候选链 `baecaf56e131a9bfebbbcf1a65427c45b002b19f` 的真实 canvas 原图，取[首次运行 frame 16](https://github.com/dbvv1/MOBA-Like/blob/56b52f8d6e534ac17732d59e656a73706ca26d69/docs/quality/captures/B-MOBA-HEADLESS-GPU-001/before/run-baecaf56e131-idle-3euSNi/frames-r1/00016.png)，不是 Site v12。
- `lighting-candidate.png`：灯光候选 `069b74bc410eec318a1effb0a05a7acc619b5bcc` 的真实 canvas 原图，取[首次运行 frame 16](https://github.com/dbvv1/MOBA-Like/blob/56b52f8d6e534ac17732d59e656a73706ca26d69/docs/quality/captures/B-MOBA-HEADLESS-GPU-001/after/run-069b74bc410e-idle-lJOhYy/frames-r1/00016.png)；当前品质判断为不采用。
- `lighting-ai-target.png`：根据本作同机位画面生成的 AI 灯光方向图；包含几何／尺寸漂移，不是实机证据。

两张实图均为 first-tower / seed 61 / idle / frame 16，1280×720，NVIDIA RTX 5070／Chromium 156，同相机与状态 `4a4767ad53dba0d9`。原始 PNG 未裁剪、调色或重绘；只分发游戏画布，不含桌面、终端、账户信息或私人记录。模型与 HDR 的来源许可沿本仓对应素材说明。

[原始报告与失败记录](https://github.com/dbvv1/MOBA-Like/blob/56b52f8d6e534ac17732d59e656a73706ca26d69/docs/quality/captures/B-MOBA-HEADLESS-GPU-001/result.md)保留：三次重复拍摄均未通过；本页的静态盲评不把它改成拍摄验收通过。旧软件帧状态 `019550cb1f074a83` 不同，未用于本次 GPU 同状态对照。
