# dsh-aigc-family

DeepSeek Harness 的 AI 创作插件家族 —— **一个内核 + 六个壳**，全部按次从虾盘云钱包扣费（充值进你自己的账户）。

## 为什么是一个仓

七个包共用同一份内核（钱包、网关调用、上游错误翻译、异步任务轮询）。按包拆七个仓的话，
改一句错误文案要改七遍、发七个版——2026-11-09 已经因为「403 模型无权限被误报成密钥失效」
在三个项目里各修过一次，所以这次把公共逻辑锁进 `dsh-aigc-core`，其余只留工具定义。

## 包一览

| 包 | latest | 功能 | 价格 |
|---|---|---|---|
| [`dsh-aigc-core`](./dsh-aigc-core) | 0.1.0 | 共用内核：钱包 / 网关 / 错误翻译 / 轮询。零依赖 | 免费 |
| [`dsh-song`](./dsh-song) | 0.1.1 | 一句话出歌，一次 2 首 MP3 | ¥1.2/次 |
| [`dsh-t2i`](./dsh-t2i) | 0.1.1 | 文生图（t2i = text-to-image） | ¥0.03/张 |
| [`dsh-aigc-studio`](./dsh-aigc-studio) | 0.1.1 | 全家桶：图 / 歌 / 传参考音频 / 钱包 | 按项 |
| [`dsh-poster`](./dsh-poster) | 0.1.1 | 海报 · 封面 · 缩略图，5 套画幅预设 | ¥0.03/张 |
| [`dsh-video-lab`](./dsh-video-lab) | 0.1.1 | 文生视频，出 MP4 | ¥2.9–6.9/条 |
| [`dsh-merit`](./dsh-merit) | 0.1.0 | 功德计数器，纯本地不花钱 | 免费 |

## 装法与钱包

```bash
dsh plugin add dsh-song        # 装哪个填哪个
```

所有收费包共用同一个钱包，三种补法：
1. 环境变量 `XIAPAN_API_KEY=sk-...`
2. 写进 `~/.dsh/aigc-wallet.json` 的 `apiKey`
3. 调任一包的 `<包>_wallet` 工具 `action=adopt` 传入已有密钥

充值统一导流到 [虾盘云](https://api.u-claw.org.cn/)（¥1 ≈ 50 万额度）。

## 错误怎么读（三类，别搞混）

| 提示 | 真相 | 动作 |
|---|---|---|
| 这个模型没给这把密钥开权限 | 白名单没开 | 发模型名给客服，**别换密钥、别充值** |
| 余额不足 | 没钱了 | 充值 |
| 凭证无效或已失效 | 余额透支也会报这句 | 先查余额，正常才换密钥 |

## 本地开发

```bash
# 内核改动后，六个包靠 npm link 或 workspace 联调
mkdir -p node_modules && ln -sfn ../dsh-aigc-core node_modules/dsh-aigc-core
node --check dsh-song/index.js
```

MIT
