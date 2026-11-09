# dsh-merit

DeepSeek Harness 的**功德计数器**：AI 干活时敲两下木鱼，本地记账。

```bash
dsh plugin add dsh-merit
```

| 工具 | 干什么 |
|---|---|
| `dsh_merit_knock` | 敲一次（或 N 次），累加功德 |
| `dsh_merit_status` | 看总功德、今天多少、最近 7 天 |

**完全本地**：数据存 `~/.dsh/merit.json`，不联网、不花钱、不传任何东西出去。

配合 `dsh-woodfish`（木鱼界面插件）用，一个管面子一个管里子。

MIT
