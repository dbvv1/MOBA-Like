# MOBA-Like

原创网页 MOBA：操控一名英雄与机器人对战，推掉对方基地。

开发中，第一个可玩版本完成后补充运行和操作说明。设计目标见 [docs/brief.md](docs/brief.md)。

## 无画面对局

```sh
npm ci
npm run sim -- --games 200 --seed 1
npm test
npm run build
```

`sim` 新对局默认采用 v8 规则。可用 `--content-version 1`、`2` 或 `7` 运行旧规则；回放记录自身版本，不随默认值改变。
