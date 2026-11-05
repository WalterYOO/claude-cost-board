# Claude Code Cost Board

一个单文件 HTML 成本看板：打开即可查询本机 Claude Code 的历史花费，时间粒度和分组维度可自由切换。

```
make          # 构建 cost-board.html
make open     # 构建并打开
```

等价于 `python3 build.py && open cost-board.html`。其他目标：`make test`、`make clean`。

生成后的 `cost-board.html` 不依赖网络、CDN 或后端，可以直接双击打开。

## 数据从哪来

主数据源是 ECC 的 cost-tracker 写入的：

```
~/.claude/metrics/costs.jsonl
```

每行是某会话在一次 Stop 时的**累计快照**。`build.py` 读取它，按会话排序后做差分，得到带时间戳的事件；同时读取 `~/.claude/projects/*/*.jsonl` 补项目名和会话标题。

`data.snapshot.json` 是同一份数据的调试副本，页面上不需要它。

## 两种金额口径

数据里存在累计重置（同一会话的累计值下降）。看板同时展示两种口径，顶部常驻差额：

| 口径 | 含义 | 用途 |
|---|---|---|
| `segments`（默认） | 所有 segment 的 baseline + 正向增量 | 实际累计消耗，包含重置前的历史段 |
| `latest` | 每会话只取最后一个 segment 的累计 | 与 `/ecc:cost-report` 一致 |

切换按钮在顶部 reconciliation 条右侧。所有总额都是运行时计算的，没有写死。

## 三套 provider 价目表

顶部「计价」条可以在四者之间切换，所有金额、图表、卡片、排行、详情和 CSV 会一起重算：

| 计价 | 说明 |
|---|---|
| ECC 原始 | `costs.jsonl` 里记录的 `estimated_cost_usd`，不重计价 |
| Claude | 按 Claude 当前价目表；默认 Sonnet 5.5 |
| Codex | 按 OpenAI/Codex 当前价目表；默认 GPT-5.3 Codex |
| DeepSeek | 按 V4.1 Flash / V4 Pro 峰谷价；支持自动 / 全峰 / 全谷 |

重要语义：

- 价格只按事件里的四类 token 重算，不改变会话、筛选和口径。
- 模型不属于该 provider 时，按该价目表的默认模型反事实计价；界面显示原生覆盖率和回退提示。当前数据没有 Claude/Codex 模型，所以这两版是 100% 回退计价。
- 跨模型事件和 baseline 无法拆分 token 来源，按 Stop 行模型整段计价，并标为「计价歧义」，不计入原生覆盖率。
- DeepSeek 自动峰谷按事件 Stop 时刻归属（UTC 周一至周五 01:00–04:00、06:00–10:00），不是官方逐请求计算，也未扣中国法定节假日；全峰/全谷是权威上下界。
- 未建模上下文长度分档、缓存 TTL、批处理折扣和其他快速/优先模式（`gpt-5.3-codex-fast` 已单独建模）。价格是估算，不是账单。

价目表、来源和版本在 `pricing.js`，构建时内嵌进 HTML。

## 怎么用

- **趋势**：时间粒度可选自动 / 小时 / 天 / 周 / 月 / 季度 / 年；按项目或模型堆叠。
- **看板**：列维度可选项目 / 模型 / 时间桶；会话维度是排行列表。
- **筛选**：时间范围、项目、模型、关键词、低置信度开关。
- **详情**：点击卡片或排行行，查看会话的 segment、每轮花费、token 和 transcript 路径。
- **导出**：按当前筛选导出 CSV。
- **状态**：所有筛选写入 URL hash，可收藏或分享同一视图。
- **主题**：自动 / 浅色 / 深色，记忆在 localStorage。

## 刷新数据

- 推荐：重新运行 `python3 build.py`。
- 也可以在页面上点「选择成本文件」或直接拖入**完整的** `costs.jsonl`。
  - 只支持完整替换，不做追加或合并。
  - 如果新文件会话数明显少于当前数据，会二次确认，避免误拖子集。
  - 新文件中已有会话的项目名/标题会按 session id 从内嵌元数据回填。

## 已知限制

- **金额是估算**：`estimated_cost_usd` 来自 ECC 的硬编码价目表；未识别模型会按 Sonnet（$3/$15）估算，不等于真实账单。页面统一显示 `≈ US$` 并标记这些模型。
- **首行归因**：每个会话第一条快照可能代表此前很长一段时间的累计；当前约占总量 23.7%，页面标为低置信度，可关闭「含低置信度」排除。
- **数据覆盖**：部分历史会话的 transcript 已被清理，项目名由目录名推断；「全部」只代表当前 `costs.jsonl` 的范围。
- **时间分辨率**：事件来自 Stop 快照，不是逐条 API 请求；小时级视图按轮归因，会有偏差。
- **隐私**：生成的 HTML 含本机路径和会话标题，分享前请检查。

## 文件

| 文件 | 作用 |
|---|---|
| `build.py` | 解析、差分、生成 HTML（仅标准库） |
| `pricing.js` | 三套 provider 价目表与重计价逻辑（浏览器/Node 共用） |
| `template.html` | 单文件页面模板，含内联 CSS/JS |
| `cost-board.html` | 生成物，可直接打开 |
| `data.snapshot.json` | 生成的数据快照，便于排查 |
| `tests/test_build.py` | 构建与数据边界用例（重置、重复、异常、跨模型、XSS、模板注入） |
| `tests/test_pricing.js` | 价目表、模型匹配、峰谷边界、歧义与覆盖率用例 |
| `DESIGN.md` / `REVIEW.md` | 设计稿与 codex 审核意见 |

## 测试

```
make test
```

等价于：

```
python3 -m unittest discover -s tests -v
node tests/test_pricing.js
```

Node 仅用于测试；`build.py` 仍然只依赖 Python 标准库。
