# dsh-song

DeepSeek Harness 的出歌插件：**一句描述进去，两首成品 MP3 出来**。

```bash
dsh plugin add dsh-song
```

| 工具 | 干什么 | 价格 |
|---|---|---|
| `dsh_song_create` | 文生歌（带人声歌词）或纯音乐，异步提交→轮询→下载 | **¥1.2 / 次（一次 2 首）** |

## 用之前

需要一个虾盘云钱包（按次扣费，不是订阅）：

1. 设置 `XIAPAN_API_KEY=sk-...`，或
2. 密钥写进 `~/.dsh/aigc-wallet.json` 的 `apiKey` 字段，或
3. 装 `@hfshfg/dsh-aigc` 用它的 `dsh_aigc_wallet` 开户

余额为 0 时上游会报 `Invalid token`——那不是密钥坏了，去充值：https://api.u-claw.org.cn

## 例子

> 用 dsh_song_create 写一首「下班回家路上的民谣，木吉他，温暖男声」

出 2 首，每首 2 分钟左右，落到 `~/Downloads/dsh-song/`。

## 报错怎么读

| 报错 | 真正原因 | 怎么办 |
|---|---|---|
| `这个模型没给这把密钥开权限` | 模型白名单没开 | 把模型名发客服，**别换密钥、别充值** |
| `余额不足` | 没钱了 | 充值 |
| `凭证无效或已失效` | 余额透支也会这样 | 先查余额，余额正常才换密钥 |

MIT · 内核走虾盘云网关，模型可用性以 `GET /v1/models` 为准。
