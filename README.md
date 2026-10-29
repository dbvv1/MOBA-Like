## Play the integrated candidate

The normal home entry keeps the existing v10 game. Choose **Try the combat / terrain / keyboard / continue candidate**, or [play the online candidate](https://dbvv1-moba-like.pretty-llama-9945.chatgpt.site/candidate.html), for the integrated v11 attack windup / projectile / contact cycle, independent siege models, continuous terrain, editable keyboard controls and local Continue saved match. Optional diffuse lighting is at [`candidate.html?lighting=stylized-diffuse`](https://dbvv1-moba-like.pretty-llama-9945.chatgpt.site/candidate.html?lighting=stylized-diffuse). This is an offline side-by-side trial, not a replacement for the default game. In this source revision, candidate player and bot inputs share stable-seat, next-tick ordering; verified compatible local saves remain readable. This is not online multiplayer.

# MOBA-Like

开发中的原创网页 MOBA：操控一名英雄与机器人对战，沿兵线推进并摧毁对方基地。设计目标见 [docs/brief.md](docs/brief.md)。

## 运行

需要 Node.js 22.12 或更新版本，以及支持 WebGL 2 的桌面浏览器。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。若页面提示 WebGL 2 不可用，需要使用支持它的浏览器与图形环境。

构建并预览网页版本：

```sh
npm run build:web
npm run preview:web
```

网页产物在 `web-dist/`；`npm run build` 单独构建无画面模拟工具，输出到 `dist/`。

## 操作

以下是默认键位；HUD 与 **Controls & help** 显示当前实际键位。

- **Next match hero → Restart**：选择 Veyra 或 Morrow 后开启新局；更改选择不会修改当前对局，直接 Restart 保留上次选择。Morrow 的 W 为立即施放的自身护盾，Q 为方向弹道，E/R 为地面技能；技能名与操作提示随英雄切换。对手仍为 Veyra。
- **Next match hero → New match**：选择 Veyra 或 Morrow 后开启新局并替换本机检查点；更改选择不会修改当前对局。Morrow 的 W 为立即施放的自身护盾，Q 为方向弹道，E/R 为地面技能；技能名与操作提示随英雄切换。对手仍为 Veyra。

- **右键敌人**：指定目标，追入射程后普攻；不是攻击命中保证。
- **右键地面／友方单位**：移动；点无敌敌方建筑不会自动走进其脚下。
- **Q / W / E / R** 或技能按钮：选择技能，再左键地面或敌人施放；自身技能立即施放。
- **A，再左键地面**：攻击移动，沿途自动获取敌人。
- **S**：停止当前移动或攻击指令；**Esc**：取消瞄准。
- **Space**：锁定镜头到英雄；取消 HUD 的 **Lock camera** 后，把指针移到画面边缘移动镜头。
- **装备按钮**：花费金币购买；技能和购买是否合法由对局规则决定。
- **Controls & help → Keyboard settings**：更改四个技能、攻击移动、停止与锁定镜头的键位。选择某一行后按新键；占用键可重新选择，或明确点 **Swap** 交换。**Save & apply** 成功后才生效并保存在本浏览器；失败保留旧操作，留在面板重试或取消。**Cancel** 放弃草稿，**Restore defaults** 先恢复默认草稿，再保存才生效。Esc 在捕获中取消捕获，再按一次取消整个编辑。
- **Restart**：重新开局，保留已保存的键位；打开键位设置和切到后台标签页时对局暂停。关闭设置会把键盘焦点交回菜单入口；点击战场继续操作。
- **New match**：重新开局并替换本机检查点。切到后台标签页时对局暂停。
- **Save match**：保存当前对局；也会每 10 秒模拟时间自动保存。刷新后选择 **Continue saved match** 继续；**Play without saving · keep old save** 保留旧档但不保存当前局。只在同一浏览器保存，规则升级后可能需要开新局，详见[本机续玩](docs/local-save.md)。

界面显示生命、法力、等级、金币与技能冷却；阵亡后等待复活，基地被摧毁后结束对局。

## 无画面对局

```sh
npm ci
npm run sim -- --games 200 --seed 1
npm test
npm run build
```

`sim` 与网页新对局采用 v11 规则：普攻先准备再释放，远程弹体接触后才造成伤害；释放前移动或 Stop 可取消，释放后可走位或接技能，已发弹体继续飞行。小兵接战时仍会彼此让出有限空间。可用 `--content-version 1`、`2`、`7`、`8`、`9` 或 `10` 运行旧规则。回放记录自身版本，不随默认值改变。

