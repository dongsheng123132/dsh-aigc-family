# dsh-aigc-studio

DeepSeek Harness 的 **AI 创作全家桶**：出图、出歌、传参考音频、查钱包，一个插件四件事。

```bash
dsh plugin add dsh-aigc-studio
```

| 工具 | 干什么 | 价格 |
|---|---|---|
| `dsh_studio_image` | 文生图，落本地 PNG | ¥0.03 / 张 |
| `dsh_studio_song` | 文生歌，一次出 1–2 首 MP3 | ¥1.2 / 次 |
| `dsh_studio_upload` | 传参考音频进 Suno，换回 clipId | ¥0.045 / 次 |
| `dsh_studio_wallet` | 查余额 / 绑已有密钥 | 免费 |

安装免费，**按次从你自己的虾盘云钱包扣费**——充值进的是你自己的账户，不是共用一把钥匙。

## 用之前

任选一种：

1. 设置 `XIAPAN_API_KEY=sk-...`
2. 密钥写进 `~/.dsh/aigc-wallet.json` 的 `apiKey`
3. 直接说「用 dsh_studio_wallet 的 adopt，密钥是 sk-...」

## 上传参考音频要注意

`dsh_studio_upload` **只收公网 http(s) 音频链接**，不收本地文件——上游就是这么设计的。本地音频先传到任意图床/对象存储，再把链接给它。

## 报错怎么读（三类别搞混）

| 报错 | 真正原因 | 怎么办 |
|---|---|---|
| `这个模型没给这把密钥开权限` | 模型白名单没开 | 发模型名给客服，**别换密钥、别充值** |
| `余额不足` | 没钱了 | 充值 |
| `凭证无效或已失效` | 余额透支也会报这句 | 先查余额，余额正常才换密钥 |

MIT · 模型可用性以 `GET /v1/models` 为准（它按你这把密钥的白名单过滤，不是全网可用数）。
