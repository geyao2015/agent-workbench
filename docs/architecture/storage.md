# 存储与数据库

**状态：方案已定，待实现。** 本文件是数据存储的唯一事实源：数据分类、事实源、表结构、兼容规则与迁移顺序。事件与 reducer 契约见 [protocol.md](protocol.md)，选型理由见 [decision.md](../product/decision.md)。

## 1. 目标与非目标

目标：

- 本地与部署共用 Postgres：本地 Docker 起库，部署接托管 pg，只换连接串。
- 会话、事件、知识库、产品迭代文档、prompt 版本统一落库。
- 大对象走 `Storage` 抽象，DB 只存引用。

非目标：

- 不做配置中心；配置继续用 `.env` 与本地文件。
- runtime 模式仍放进程内，不落库（单用户展示，不处理多端并发不一致）。
- 不建日志分析平台；日志库只服务调试与审计查询。
- 不做多租户与权限。

## 2. 数据分类与事实源

| 类别 | 内容 | 事实源 |
| --- | --- | --- |
| 配置 | `.env`、端口、模型 Key | 本地文件 |
| 运行时状态 | 当前 runtime 模式、活跃 run、追加队列 | 进程内存 |
| 领域数据 | thread / run / event / approval / span | DB |
| 文本内容 | KB 文档、PRD、技术方案、发版记录、prompt | DB |
| 大对象 | diff、日志包、附件 | `Storage`，DB 存 key |
| 派生数据 | FTS 索引、物化快照 | DB 内，可重建 |
| 服务端日志 | 请求日志、错误日志 | 独立日志库 |

规则：

- 产品内容以 DB 为源，仓库不再保存 PRD、技术方案与发版记录；git 只记录代码与工程文档。
- `data/docs` 降级为 bootstrap seed，只在初始化和测试时导入。
- 事件日志是运行时唯一状态源；物化快照由事件派生，可随时重建。

## 3. 表结构

### 3.1 运行时

```sql
threads(id pk, kind, title, created_at, updated_at)
runs(id pk, thread_id, kind, status, parent_run_id, source_run_id,
     runtime_mode, provider, model, title, created_at, completed_at,
     input_tokens, output_tokens, cost_usd)
events(run_id, seq, id, type, ts, payload_json,
       pk(run_id, seq), unique(id))
approvals(id pk, run_id, scope, tool_call_id, stage_id, status, risk,
          args_json, resolved_at)
spans(trace_id, span_id pk, parent_span_id, run_id, name, kind,
      start_ts, end_ts, status, attributes_json)
run_snapshots(run_id pk, last_seq, snapshot_json)
artifacts(id pk, run_id, kind, title, mime, size, hash, storage_key, stage_id)
```

### 3.2 文本内容

```sql
documents(id pk, namespace, category, origin, title, current_version,
          created_at, updated_at)
document_versions(doc_id, version, hash, content, created_at,
                  pk(doc_id, version))
document_tags(doc_id, tag, pk(doc_id, tag))
chunks(id pk, doc_id, version, ordinal, locator, content, terms tsvector)
-- terms 由应用层 bigram 分词派生，GIN 索引倒排
```

- `category`：`kb` / `prd` / `tech_design` / `release_notes`；`origin`：`seed` / `upload` / `generated`。
- 一套模型覆盖知识库与产品迭代文档，版本、分类与引用能力复用。
- chunk 落库而非每次现切：`citation.added` 已带 `chunkId` / `locator`，切分算法调整后旧引用仍需可回溯。
- `documents.id` 由文档元数据显式声明，不从文件名或路径推导；`current_version` 必须指向 `document_versions` 中已存在的行，同一文档版本号唯一。
- 历史版本只读保留；检索索引只覆盖 `current_version`，历史版本仅供查阅与审计（理由见 [decision.md §4](../product/decision.md#知识库文档模型)）。
- 全文检索不依赖编译扩展：应用层做中文 bigram 分词写入 `terms`，pg 侧用 `to_tsvector('simple', ...)` 与 GIN 倒排；不引入 `zhparser` / `pg_bigm`，托管 pg 可直接迁移。
- seed 期一个逻辑文档的多个版本存为独立文件，按 `<docId>@<version>.md` 命名，由元数据记录 `currentVersion`；落库后文件名不再参与标识。

### 3.3 产品迭代

```sql
iterations(id pk, code, goal, status, base_branch, feature_branch,
           started_at, shipped_at)
features(id pk, iteration_id, title, status, ord)  -- pending / in_progress / done
iteration_links(iteration_id, doc_id, role,
                pk(iteration_id, doc_id, role))  -- prd / tech_design / release_notes
```

- `code` 即迭代版本号（如 `1.3.0`）；`feature_branch` 是迭代的功能分支，发版段以它合并到 `base_branch` 为输入。
- feature 只记录标题、状态与顺序，不存 assignee、估点或排期。

### 3.4 prompt 版本

```sql
prompts(id pk, name, active_version)
prompt_versions(prompt_id, version, content, params_json, model, created_at,
                pk(prompt_id, version))
```

prompt 有 active 指针与评测绑定，生命周期不同于普通文档，单独建模。

### 3.5 日志

```sql
log_entries(id pk, ts, level, source, run_id, message, attrs_json)
```

写入独立日志库（独立 database），与业务库隔离，避免与事件写入争锁；保留策略见 §7。

## 4. 数据库约定

本地与部署是同一方言，规则只约束写法，不做跨方言兼容：

- id 全部应用生成字符串（现有 `run_*` / `thread_*` 已如此），禁用自增与 `serial`。
- 时间统一 epoch ms 的 `bigint`，不用 `timestamptz`，避免时区语义分叉。
- 布尔用原生 `boolean`；JSON 用 `jsonb`，必要时加 `jsonb_typeof` 约束。
- 查询经 Kysely；只有倒排、聚合等表达力不足时才用 `sql` 模板，且只出现在 repository 实现里。
- 全文检索（bigram + `tsvector`）与向量只出现在 repository 实现里，不泄漏到业务层。
- schema 用版本化迁移文件，启动时执行，不在代码里建表。
- 大对象只存 `storage_key` / `mime` / `size` / `hash`，读写经 `Storage` 接口。

## 5. 目录形态

```
.env                    配置（DATABASE_URL 等）
data/kb/seed/*.md       启动 seed 与测试夹具
.data/blobs/<sha256>    大对象，内容寻址去重
```

数据库不在仓库目录：本地由 `docker compose` 管理数据卷，部署连托管 pg；测试用独立 database / schema，不与开发库共用。

迁移完成后移除 `.data/threads`、`.data/artifacts` 与 `data/bench/results.json`；生成产物不再与源内容同目录。

## 6. 迁移顺序

1. `Storage` 与 repository 接口：文件实现收到接口后，行为不变。
2. 运行时落库：threads / runs / events，导入现有 `.data/threads` 数据，快照改为派生。
3. 文本内容落库：documents / chunks 与倒排索引，`data/docs` 改为 seed import。
4. 产品迭代落库：iterations / features / iteration_links 与 PRD / 技术方案 / 发版记录，知识库增加迭代分类。
5. prompt 版本、spans、日志库与 artifacts 接入 `Storage`。

每步退出条件：可运行、旧数据可导入、读写路径有单测、typecheck 通过。

## 7. 待定

- 连接池：应用侧 `pg` Pool 与部署侧 pgbouncer 的取舍，部署时确认。
- 向量检索：BM25 / 倒排召回不足时再引入 `pgvector`。
- 日志保留期与是否提供查询界面。
- 现有 `.data/threads` 导入时是否保留每个 run 的完整事件原文。
