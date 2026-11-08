## Play Ashen Furrow

The home entry uses the v11 game with forest lighting: clearer tower volume, shadows and grounding. The previous [v11 lighting](https://dbvv1-moba-like.pretty-llama-9945.chatgpt.site/candidate.html?lighting=baseline) and [legacy v10 game](https://dbvv1-moba-like.pretty-llama-9945.chatgpt.site/legacy-v10.html) remain in the **Game versions** links. The v11 game includes the attack windup / projectile / contact cycle, siege models, continuous terrain, editable keyboard controls and local Continue saved match. Player and bot inputs share stable-seat, next-tick ordering; compatible local saves remain readable. This is offline play, not online multiplayer. Command buffering remains an explicit trial, not the default.

# MOBA-Like

开发中的原创网页 MOBA：操控一名英雄与机器人对战，沿兵线推进并摧毁对方基地。设计目标见 [docs/brief.md](docs/brief.md)。

[在线试玩 Ashen Furrow](https://dbvv1-moba-like.pretty-llama-9945.chatgpt.site/)。使用桌面键盘与鼠标；已有可恢复的本机存档时，选择 **Continue saved match** 续玩。想先试一局而保留旧档，选择 **Play without saving · keep old save**；试玩期间也不要点 **New match**，该按钮会重新进入可保存的新局并尝试替换旧档。

## 运行

需要 Node.js 22.12 或更新版本，以及桌面浏览器。WebGL 2 用于完整 3D 画面。

```sh
npm ci
npm run dev
```

打开终端显示的本地地址。3D 不可用时，页面会提示 **Canvas2D recovery is active** 并切换到简化画面，仍可操作对局；完整 3D 需要支持 WebGL 2 的浏览器与图形环境。

构建并预览网页版本：

```sh
npm run build:web
npm run preview:web
```

网页产物在 `web-dist/`；`npm run build` 单独构建无画面模拟工具，输出到 `dist/`。

## 操作

以下是默认键位；HUD 与 **Controls & help** 显示当前实际键位。

- **Next match hero → New match**：选择 Veyra 或 Morrow 后开启新局并替换本机检查点；更改选择不会修改当前对局。Morrow 的 W 为立即施放的自身护盾，Q 为方向弹道，E/R 为地面技能；技能名与操作提示随英雄切换。对手仍为 Veyra。

- **右键敌人**：指定目标，追入射程后普攻；不是攻击命中保证。
- **右键地面／友方单位**：移动；点无敌敌方建筑不会自动走进其脚下。
- **Q / W / E / R** 或技能按钮：选择技能，再左键地面或敌人施放；自身技能立即施放。
- **A，再左键地面**：攻击移动，沿途自动获取敌人。
- **S**：停止当前移动或攻击指令；**Esc**：取消瞄准。
- **Space**：锁定镜头到英雄；取消 HUD 的 **Lock camera** 后，把指针移到画面边缘移动镜头。
- **装备按钮**：花费金币购买；技能和购买是否合法由对局规则决定。
- **Controls & help → Keyboard settings**：更改四个技能、攻击移动、停止与锁定镜头的键位。选择某一行后按新键；占用键可重新选择，或明确点 **Swap** 交换。**Save & apply** 成功后才生效并保存在本浏览器；失败保留旧操作，留在面板重试或取消。**Cancel** 放弃草稿，**Restore defaults** 先恢复默认草稿，再保存才生效。Esc 在捕获中取消捕获，再按一次取消整个编辑。
- **New match**：重新开局并替换本机检查点，保留已保存的键位。要续玩旧局，请刷新后选 **Continue saved match**，不要点 New match。
- **暂停与返回**：打开键位设置或切到后台标签页时对局暂停；关闭设置后焦点回到菜单入口，点击战场继续操作。
- **Save match**：保存当前对局；也会每 10 秒模拟时间自动保存。刷新后选择 **Continue saved match** 继续；启动时的 **New match · replace save** 会以新局替换旧检查点，**Play without saving · keep old save** 则保留旧档、不保存当前局。只在同一浏览器保存；看见保存成功提示后再刷新，规则升级后可能需要开新局，详见[本机续玩](docs/local-save.md)。

界面显示生命、法力、等级、金币与技能冷却；阵亡后等待复活，基地被摧毁后结束对局。

## 无画面对局

```sh
npm ci
npm run sim -- --games 200 --seed 1
npm test
npm run build
```

`sim` 与网页新对局采用 v11 规则：普攻先准备再释放，远程弹体接触后才造成伤害；释放前移动或 Stop 可取消，释放后可走位或接技能，已发弹体继续飞行。小兵接战时仍会彼此让出有限空间。可用 `--content-version 1`、`2`、`7`、`8`、`9` 或 `10` 运行旧规则。回放记录自身版本，不随默认值改变。


指令缓冲试玩：打开 `candidate.html?commands=buffer-v1`，施法或普攻前摇中输入下一条技能／移动／攻击，释放当帧接续；最后一条合法输入覆盖，S 停止清除队列。无参数候选保持原操作。

镜头＋Q/W 试玩：`candidate.html?commands=buffer-v1&audio=critical-v1&camera=hold-follow-v1&lighting=forest-light-v1`。取消永久锁定后，按住 Space 回看自己，松开继续自由观察；Q/W 使用不同释放提示音。不能加载3D时自动切换带提示的Canvas2D恢复画面。
