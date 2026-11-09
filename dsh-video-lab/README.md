# dsh-video-lab

DeepSeek Harness 的**文生视频**插件：一句描述出短视频，提交→轮询→下载 MP4。

```bash
dsh plugin add dsh-video-lab
```

| 模型 | 价格 |
|---|---|
| `doubao-seedance-2-0-mini-260615`（默认） | ¥2.9 / 条 |
| `doubao-seedance-2-0-fast-260128` | ¥4.9 / 条 |
| `doubao-seedance-2-0-260128` | ¥6.9 / 条 |

接口：`POST /v1/video/generations` + 轮询 `GET /v1/video/generations/{id}`（实测口径同 `uking-aigc` 的 gen-video）。

MIT
