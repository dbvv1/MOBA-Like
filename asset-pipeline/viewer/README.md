# 原创角色浏览器消费预览

用独立页面检查当前三套角色 GLB 的 Three.js 加载和动作播放，不接模拟，也不定义技能／命中时刻。页面提供蓝／橙／长刃版本、idle／walk／attack 切换与暂停；使用同一 `gltf.scene` 整根及 AnimationMixer，沿用已锁定的 Three.js 依赖。

从仓库根运行：

```sh
npm --prefix asset-pipeline/validation ci --ignore-scripts --no-audit --no-fund
python3 -m http.server 8080 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8080/asset-pipeline/viewer/`。需支持 WebGL 2 的浏览器；无 GPU 的云端 Chromium 可使用 `--use-angle=swiftshader --enable-unsafe-swiftshader`。仅在本地回环接口服务，不作为部署入口。

源页面、脚本和运行所需 GLB 保留在仓库，截图与检查报告放本地 `reports/` 并由 Git 忽略。此入口不是游戏或完整动画状态机；步行为原地动作，真实移动滑步、命中时点、动作衔接及最终美术仍需实际游戏接入验证。

## 浏览器回归

```sh
npm --prefix asset-pipeline/viewer ci --ignore-scripts --no-audit --no-fund
npm --prefix asset-pipeline/viewer test  # 仅 HTTP 与文件检查，不创建浏览器
# 使用已安装的 Chromium；也可按 Playwright 官方方式安装其匹配浏览器。
CHROMIUM_PATH=/usr/bin/chromium npm --prefix asset-pipeline/viewer run smoke
```

当前已验证静态语法与 Node 回环 HTTP 正常／失败路径；真实浏览器因执行环境启动／连接限制尚未验证。

smoke 自行启动临时回环 HTTP 服务，逐一加载三版本／三动作，比较固定时刻的实际画布像素、检查暂停／继续和非法参数拒绝；浏览器、控制台或资产请求失败即非零退出。截图与 JSON 仅保存到忽略的 `reports/`。该脚本必须在允许 Chromium 创建本地套接字的执行环境运行；仅 Node 静态检查不能替代 WebGL 验证。
