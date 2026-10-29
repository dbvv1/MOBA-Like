# Q／W 命令到录制帧：独立手感取证候选

入口：`capture.html?shot=gameplay&feel=skill-buffer`。固定seed1、Veyra镜像、真实出生位置、正常bot、45张60fps录制帧，30Hz模拟；不接受更换机位、时间、seed或输入。普通拍摄入口和冻结批次不换版本。

## 实际接线

当前可玩客户端的 `LocalMatch.step` 持有玩家输入历史及bot状态，内部生成稳定席位命令信封并调用 `sim.step`。本入口复用同一 LocalMatch，而不是直接写状态或复制模拟逻辑；表现仍走现有 `world.sync → world.draw(delta, alpha)`，位置插值和角色表现继续使用生产实现。未接DOM瞄准交互／快捷施法设置、完整HUD或声音，不能据此评价整套操作。

固定游戏内输入：

- 已完成录制帧0后进入Q，输入帧1，目标tick1；30Hz下一逻辑步在录制帧2处理。
- 已完成帧2后进入W，输入帧3、目标tick2；帧4处理。输入前记录mana、W冷却、存活和当前施法槽。
- 已完成帧22后重新输入W，输入帧23、目标tick12；帧24处理，作为先前拒绝后没有自动缓冲、但新输入可正常接受的对照。

`__shot.feel.inputs` 给输入ID、进入帧、目标tick及真实命令；`steps` 给每个模拟tick的真实接受／拒绝结果、拒绝原因、castStarted／castResolved等表现事件、状态hash、位置和mana。每个逻辑步都有录制帧号，不能用tick号替代。metadata是拷贝，不向外暴露可写模拟状态；命令只经LocalMatch正常入口。

CPU实测：Q在tick1接受；ready W在tick2被alreadyCasting拒绝（输入前W冷却0、资源足够、英雄存活）；Q在tick5释放，对应计划录制帧10；tick12的新W接受。直到新W输入前没有W释放。两次完整回放逐逻辑步哈希一致，并逐步对照独立建立的正常 LocalMatch 同输入结果。这里的“对应帧”是虚拟录制时序，不是已经看到了屏幕动作。

## 实拍与判读边界

未来按现有单GPU、headless、真实资源清理门槛实拍这个固定候选时：保留帧0，逐次调用 `__shotNext(expectedFrame)`，每次保存对应实际canvas PNG与完整JSON，共45张；使用原拍摄导出即可取得同帧位图/metadata。保存同轮runId、实际source/tree/bundle/renderer原文与完整退出回执，不拿旧版本或别的机位补帧。禁止批量前进15帧后冒称中间帧已录。

PNG帧号／源码／构建／输入ID关联核准后，非作者逐帧指出Q首处可见前摇与释放、W拒绝时是否存在可理解的反馈。接受或释放事件只说明模拟事实；world.draw、gl.finish均不证明浏览器合成或显示器present。无真实PNG序列时 `firstVisibleFrame=null`，录制首反馈不计算；无音轨时audio明确unknown。固定虚拟回放不测真实键鼠设备延迟，不能凭“输入到模拟1tick”宣布跟手。

本轮没有启动浏览器/GPU、未拍图或录音、未派本机卡、未合入或部署。它只补取证入口，没修W缓冲、没调技能时间、没添加玩法；首版记分卡的视觉/手感品质仍待真实图像、音轨和独立判读。
