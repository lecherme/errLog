## Context

全新 Web 应用，无现有代码库。三类核心技术挑战决定了主要架构决策：

1. **文件资产管理**：原始 PDF 和批改照片是不可恢复资产，存储须独立于代码部署，并具备独立的备份和恢复路径
2. **多步骤批改流程**：涉及 AI 调用、文件处理和人工确认的有状态工作流，中途中断不能丢失已确认的业务事实
3. **Provider 可替换性**：Auth、Storage、Database 的具体 Provider 尚未确定，架构须保证核心 Domain Model 不依赖特定 Provider

参见 proposal.md 了解产品动机；各 Spec 文件定义具体行为要求。

## Goals / Non-Goals

**Goals:**
- 确定认证、文件存储、AI 集成、PDF 处理的技术方向，使实现任务可独立展开
- 明确核心数据实体及其关系，保证多用户/多孩子的扩展路径
- 建立 Auth / Storage / Database 的 Provider 边界，使未来更换 Provider 的影响限制在基础设施层

**Non-Goals:**
- 选定具体 Auth / Storage / Database Provider 或 AI 模型版本
- 数据库字段级 Schema 设计
- UI 组件库选型
- Backup / Recovery 的具体实现机制
- MVP 以外的功能（薄弱点分析、重新组卷、多用户管理等）

## Provider 边界原则

以下原则贯穿 D2–D4，在各决策中具体体现：

- **Database**：关系型数据库，PostgreSQL 优先；具体 Provider 未确定
- **Auth**：Business User Identity 与 Provider Identity 分离；具体 Auth Provider 未确定
- **Storage**：业务对象引用稳定 Asset Identity，不依赖 Provider URL；具体 Storage Provider 未确定
- Provider-specific SDK 和实现细节限制在各自 Service（AuthService / StorageService / Persistence）边界内，不进入 Domain 层
- 更换 Provider 不应要求修改核心 Domain Model 或重新定义 Business Identity / Asset Identity
- 不追求 Provider 零成本替换，而是把迁移影响限制在基础设施实现和必要的数据迁移范围

## Decisions

### D1: 应用架构——Node.js + Next.js App Router 模块化单体（PDF Processing 除外）

**决策**：采用 Node.js + Next.js（App Router）作为核心业务应用，承载 UI、Auth、业务工作流、Storage/Database 协调。内部维持清晰模块边界，至少区分：

- **UI / Web**：Next.js App Router 路由、Server Components、Client Components、Route Handlers、Server Actions
- **Domain / Business Logic**：核心业务规则和工作流
- **Auth**：身份验证，Provider SDK 调用收拢于此
- **Storage**：文件资产读写，Provider SDK 调用收拢于此
- **AI Integration**：AI Task Contract 实现，模型调用收拢于此
- **Persistence**：数据读写，数据库 SDK 调用收拢于此

**PDF Processing 修订**：PDF 页面渲染、题目区域裁切、订正卷 PDF 组装**不**在 Next.js 进程内实现，而是作为独立的 Python 服务（见 D11），通过 Provider-neutral 的 `PdfProcessingPort` 接口被 Domain / Business Logic 层调用。这是唯一从"单一进程"中拆出的模块；Auth、Storage、AI Integration、Persistence 仍在 Next.js 进程内，各自的 Provider SDK 调用收拢在对应 Service 边界内。

**理由**：MVP 规模不需要微服务复杂度，Auth/Storage/AI/Persistence 维持进程内模块边界即可满足 Provider 可替换性要求。PDF Processing 是例外——服务端 PDF 页面渲染在 Node.js 生态（`pdfjs-dist` 依赖原生 `canvas` 绑定，社区已知存在多个渲染/构建相关问题）成熟度不如 Python 生态（`PyMuPDF`），且 D8 确定的自托管 Docker 部署方式使得与 Python 服务同机 docker-compose 共部署的成本很低，不需要为了"避免跨进程复杂度"而勉强留在 Node.js 内实现。具体边界和调用协议见 D11。

**部署单元说明**：Application Runtime（D8）现在由 Next.js 容器和 D11 定义的 Python PDF Processing 容器共同组成，两者通过 docker-compose 在同一台机器上共部署，仍是一个逻辑上的 MVP 部署拓扑，不是完整的独立微服务架构。

**替代方案**：独立 API 服务 + SPA 前端。更灵活，但 MVP 阶段增加了跨进程部署和认证 session 共享的配置复杂度，本项目未采用。

---

### D2: 认证——无密码 OTP，Business User 与 Provider Identity 分离

**认证方式**：无密码认证，支持邮箱 OTP 和短信 OTP；MVP 只允许预配置的邮箱 / 手机号登录，不开放公开注册。具体 OTP 服务商实现阶段决定。

**身份模型**：维护稳定的 Business User（内部 UUID），Provider Identity 独立关联：

```
User (id: UUID, ...)
  └── Identity (userId, provider, providerSubject, identifier)
       例如：provider='email', identifier='foo@example.com'
            provider='phone', identifier='+8613800000000'
```

Domain 层所有业务归属引用 User.id，不引用任何 Auth Provider 的用户标识。AuthService 集中处理所有 Provider SDK 调用，Domain 层不直接调用认证 Provider。

**MFA 兼容性**：当前身份模型不阻碍未来添加 TOTP 第二认证因素。TOTP enrollment、MFA 管理 UI 不属于 MVP，暂不实现或展开数据模型。

**理由**：稳定 User.id 确保 Child、GradingSession、ErrorQuestion 等业务数据的归属关系不因 Auth Provider 变更而需要重写；更换 Auth Provider 时，只需更新 Identity 记录的映射关系和 AuthService 实现，Domain 数据不需要迁移。

---

### D3: 文件存储——对象存储形态，稳定 Asset Identity，独立备份路径

**存储技术形态**：采用对象存储（Object Storage）作为持久文件存储形态：

- **应用实例 / 容器自身文件系统**：随容器生命周期销毁，与代码部署强耦合，不适合用于需要持续访问的文件资产
- **独立持久卷 / NAS 等外部存储**：可满足生命周期隔离要求，但在跨设备访问（手机 + 电脑）、独立备份策略配置、未来迁移和云化部署方面需要额外工程投入
- **对象存储**：天然支持跨设备访问，文件生命周期完全独立于应用部署，备份和访问策略可独立配置，与稳定 Asset Identity 抽象自然契合

具体对象存储 Provider 未确定，实现阶段决定。

**Asset 模型**：文件资产在领域层表示为 Asset（含稳定内部 id 和逻辑存储键），业务对象引用 Asset，不直接保存或依赖 Provider URL。Provider URL / signed URL 由 StorageService 在基础设施边界按需解析，不落入业务数据库字段。

**资产分类**：

| 类型 | 示例 | 特性 |
|------|------|------|
| 不可恢复原始资产 | 原始 PDF、批改照片 | 不可丢失，须独立备份路径 |
| 纯派生资产 | 干净题目图片 | 可从原始 PDF + 确认区域确定性重建 |
| 快照依赖输出 | 订正卷 | 须保存 generation snapshot，见 D7 |

**原始资产架构要求**：

- **独立备份路径**：必须具备独立于代码部署的备份和恢复路径；仅依赖对象存储的持久化不等于已备份
- **防自动覆盖**：AI 重算、重新生成等自动化流程不得覆盖或删除原始资产
- **部署隔离**：应用重新部署、回滚、代码清理不得影响原始资产

具体备份机制（版本控制、跨 bucket 复制、快照等）属于基础设施实现决策。

---

### D4: 核心数据模型——四个领域实体，按业务语义关联 User / Child

```
User（认证账号）
  └── Identity[]（Provider 标识）
  └── Child（学习数据主体）

WorksheetArchive（卷子档案）        由 User 管理
  └── 关联原始 PDF 的 Asset

GradingSession（批改任务）          归属 Child
  ├── 批改照片 Asset（支持多张）
  ├── 人工确认的错题列表（概念关系）
  └── 人工确认的题目区域（概念关系，含页码和边界坐标）

ErrorQuestion（错题）               归属 Child
  ├── 来源 GradingSession
  ├── 题目区域（人工确认后的原始事实）
  └── 知识点标签（含 AI 草稿与人工确认值的溯源信息，见下方）

CorrectionWorksheet（订正卷）       归属 Child
  ├── 关联 ErrorQuestion 集合
  └── Generation Snapshot（见 D7）
```

**AI 草稿与人工确认值的溯源原则**：对于 AI 生成后可由人工确认/修改的值（如知识点标签），系统必须能够区分 AI 生成草稿与人工确认后的权威值，并保证人工确认后的值优先于 AI 生成值；后续 AI 重算不得自动覆盖人工确认结果。具体 Schema 实现（字段结构、表设计）留至实现阶段。

**AI 自动派生值的降级原则**：对于不需要人工确认的 AI 派生值（如题型分类），系统采用自动降级而非 Human Gate：AI 无法确定时使用默认值，不新增人工操作步骤。

核心领域模型不依赖任何 BaaS Provider 的数据结构。数据库字段级 Schema 留至实现阶段。

**多用户 / 多孩子扩展**：模型不依赖永久单用户或单孩子假设；MVP 只有一个 User 和一个 Child，不实现管理界面。

---

### D5: AI 集成——三个 Task Contract，区分 Human Gate 与自动降级

AI 能力定义为三个独立 Task Contract，业务流程依赖 Contract 而非具体模型。

**需要 Human Gate 的 AI 结果**（须经人工审核后方可成为业务事实）：

| Task | 输入 | 候选输出 | 人工操作 | 失败兜底 |
|------|------|------|------|------|
| 错题识别 | 批改照片 | 错题编号列表 | 确认/增删 | 手动输入题号 |
| 区域定位 | PDF 页面渲染 + 目标题号 | 边界坐标 | 预览/修正 | 手动框选 |
| 知识点标签 | 题目图片 | 知识点标签 | 确认/修改 | 空值，可手动填写 |

```
AI Output（候选草稿）→ Human Review → Confirmed Business Fact
                                       （不被后续 AI 重算覆盖）
```

**允许自动派生并降级的 AI 结果**（不新增 Human Gate）：

| Task | 输入 | 输出用途 | 失败处理 |
|------|------|------|------|
| 题型分类 | 题目图片 | 决定答题空间大小 | 使用默认答题空间，不阻塞流程 |

MVP 实现时可用同一个多模态模型完成全部任务，但这是实现选择，不是架构约束。具体 AI 模型实现阶段决定。

---

### D6: 批改流程——服务端持久化，已确认事实不可被自动覆盖

采用可恢复的服务端工作流：每个人工确认节点完成后立即持久化确认结果。

以下操作不得导致已确认业务事实丢失或被自动覆盖：

- 刷新页面或关闭浏览器
- 重新登录 / 跨设备继续操作
- AI 重算
- 派生资产重新生成

具体状态机设计、状态字段、异步 Job 等实现细节不在此展开。

---

### D7: 订正卷——基于 Generation Snapshot 满足可重复获取要求

**Spec 要求的 Design 解释**：Spec 要求"再次获取同一份订正卷，无需重新执行识别和人工确认流程"。Design 将"同一份"解释为：基于生成时已确认的事实，输出与首次生成一致，不重新执行任何 AI 或人工确认步骤。

**Generation Snapshot**：为满足上述要求，系统在生成时须保存使该次输出可确定性重现的最小生成事实集合：

- 人工确认的错题列表及顺序
- 人工确认的题目区域坐标
- 题型分类结果或使用的默认值（答题空间决策依据）
- 其他影响本次输出的已确认排版信息

**实现选择**（均可，具体由实现阶段决定）：
- 以缓存 PDF 直接存储并提供，或
- 保存 generation snapshot 后按需确定性重新生成

**与纯派生资产的区别**：干净题目图片（从原始 PDF + 确认区域确定性重建）属于纯派生资产；订正卷输出依赖生成时的排版决策，须单独保存快照，不能等同于纯派生资产处理。

**答题空间**：当系统能够确定题目类型时，答题空间与题型匹配；无法确定时使用默认空间，不阻塞生成。

### D8: Application Runtime 部署——MVP 早中期家庭 mini PC，Database 采用自建 PostgreSQL + 独立 OSS 备份

**决策**：Next.js Application Runtime 在 MVP 早中期部署于家庭 mini PC，使用 Docker 运行；通过安全的公网入口机制提供 HTTPS 访问（具体机制待单独选型，此处不默认 Cloudflare Tunnel 或任何特定方案）。实现不得依赖家庭环境的特有条件（如固定本地路径、假设持久本地磁盘存放关键数据、假设固定公网 IP）——Docker workload 须保持可在未来直接迁移到香港或其他云 region 运行，无需重写。Application Runtime 的容器构成包括 Next.js 主应用容器和 D11 定义的 Python PDF Processing Service 容器，两者共同构成同一个可丢弃/可迁移的部署单元。

Database 采用**自建 PostgreSQL（mini PC 本地）+ 独立 OSS 数据库备份**，不使用 Managed PostgreSQL 作为当前 MVP 方案；阿里云 RDS PostgreSQL 保留为未来用户量增长、需要 HA/PITR 时的 migration target，不是当前默认。理由：当前阶段仅个人使用、早期用户很少，不为尚不存在的 HA/PITR 需求提前承担固定成本；自建方案零边际成本，且复用 D10 已选定的 Storage Provider（不新增 Provider 决策面）。

**三层区分（不要混同，这是本次决策的关键澄清）**：

1. **Logical lifecycle isolation（已实现）**：PostgreSQL 运行在独立 Docker container + 独立 persistent volume 中；Next.js / Python PDF Processing Service 的 deploy、rebuild、restart、container 替换，不得删除或重建这个 volume。
2. **Failure-domain limitation（MVP 阶段明确接受的 trade-off，不是已解决的问题）**：PostgreSQL 与 Application Runtime 当前仍部署在同一台 mini PC 上，共享主机、SSD、电源等物理故障域——**没有实现运行时层面的物理故障域隔离**。mini PC 或其 SSD 整机故障时，本地 volume 本身无法幸免。
3. **Disaster recovery isolation（通过独立备份路径实现，而非物理隔离）**：定时 `pg_dump` 将数据库备份上传到独立的 OSS backup path（复用 D10 已选定的阿里云 OSS），使 mini PC / SSD 完全故障后仍可在新 PostgreSQL 实例上恢复。备份提供的是 **recovery path**，不是高可用（HA），也不是物理隔离；两次备份之间产生的数据变更存在丢失风险（见下方 RPO）。

**MVP RPO/RTO 要求**：
- **RPO ≤ 6 小时**：当前数据量小，采用较高频率的 `pg_dump`（非每日一次），具体调度周期留至实现任务确定；不引入 WAL archiving/PITR（超出当前阶段需求）。
- **Backup retention policy**：须定义备份保留策略（保留多少个历史备份/多长时间），避免备份无限堆积，也避免因保留窗口过短导致无可用恢复点；具体保留窗口留至实现任务确定。
- **Backup 可观测性**：备份上传的成功/失败必须可观测（日志、告警或至少可人工核查的记录），不能是静默运行、出问题也不知道的定时任务。
- **Backup 不得只存在于 mini PC**：本地保留 dump 文件仅作为过渡，最终必须落地到独立的 OSS backup path，满足 D3 的独立备份路径要求。
- **Restore test 必须实际执行**：不能只验证"dump 文件存在"，必须真正执行一次恢复流程——在一个干净的 PostgreSQL 实例中从最近备份恢复，并校验关键业务数据（如错题、题目区域坐标等）确实可读、内容正确。这是自建备份方案最容易被忽视的失败模式，必须作为明确任务验证，而不是假设"备份存在=可以恢复"。
- **Schema 可移植性**：数据库 migration/schema 保持标准 PostgreSQL 可移植性（不使用当前自建环境特有的扩展或非标准配置），为未来迁移到 Managed PostgreSQL（如阿里云 RDS）做准备，迁移时只需要 `pg_dump`/`pg_restore` 即可，不需要重写 Schema。

**架构原则（长期有效）**：
- Application Runtime 是可丢弃、可重建、可迁移的单元。
- Database 中的权威业务事实（人工确认的错题、题目区域坐标、知识点权威值、Generation Snapshot 等持久业务状态）与 Object Storage 中的不可恢复原始资产（D3：原始 PDF、批改照片），两者的生命周期都必须与 Application Runtime 解耦——它们是不同的资产类型，不应混同，但对"须独立于 Application Runtime 生命周期"这一要求是一致的。
- mini PC 故障、重装、迁移不得导致上述持久业务状态或原始资产丢失。
- 香港或其他云 region 保留为 Application Runtime **未来**的迁移目标，不是当前 MVP 的默认部署位置。

**Smoke Test Gate（两层，均为待完成的验证项，不视为已验证事实）**：
1. **当前阶段**：验证"大陆浏览器 → 所选公网入口机制 → 家庭 mini PC"这条入站链路的真实稳定性（家庭宽带上行带宽、断线重连、所选入口机制在大陆网络环境下的实际表现）。
2. **当前阶段（出站，备份路径）**：验证"mini PC → OSS 备份上传"的真实稳定性（家庭宽带上行带宽是否足以支撑定时 `pg_dump` 备份上传、失败重试机制是否可靠）。
3. **未来阶段**（迁移云 region 时）：重新验证"大陆浏览器 → 云端 Next.js"的延迟和稳定性，作为迁移决策的前置条件。

**AI Provider Region 验证要求（保留，验证目标随部署阶段变化）**：AI Provider 选型必须核实其官方是否支持从**当前实际出站来源**调用——MVP 早中期这个来源是家庭宽带的大陆出口 IP，而非香港/云端 IP（公网入口 Tunnel 只代理入站访问，不改变 Next.js 主动发起的出站连接的源地址）；未来迁移后需针对新的出站来源重新核实。

---

### D9: 文件上传机制与存储安全模型

**决策**：批改照片、原始 PDF 采用 **Browser Direct Upload**：浏览器直接向 Object Storage 上传文件数据，通过 Next.js / StorageService 基于当前 User 与业务上下文动态签发短期、限定范围的上传凭证（presigned URL 或临时凭证），不经 Next.js 服务器中转文件内容。

**理由**：本项目上传的原始 PDF（扫描件，常达数十 MB）和批改照片（多张累计可达数十至上百 MB）容易触发常见 serverless 运行时的请求体大小上限；服务端中转还会造成双倍带宽成本。浏览器直传规避了这一具体限制，且主流对象存储 SDK 已原生支持分片上传和断点续传。

**安全边界**（Next.js / StorageService = Authorization / Control Plane，Object Storage = File Data Plane；浏览器绕过的只是大文件的数据中转，不是后端权限控制）：
- Object Storage bucket 保持 private，不得 public-write；原始 PDF、批改照片等私有资产也不得默认 public-read。
- 浏览器不得持有长期 Storage Credential（AccessKey/SecretKey）。上传权限遵循最小权限原则：短有效期、只允许指定操作（如 PUT/multipart upload）、只允许指定 object key/upload scope；不得包含 bucket list、任意对象读取、删除，或覆盖其他资产的权限。
- 下载/查看私有资产须先经过服务端 Auth + Ownership/Authorization Check，再由 StorageService 签发短期 signed GET URL；不能仅凭知道对象存储地址直接访问资产。

**上传生命周期**（至少语义上区分，具体状态字段/Schema 留至实现阶段）：申请上传 → 服务端授权 → Browser 直传 → 服务端验证 → Asset 可用。Browser 报告"上传成功"不能直接成为权威业务事实；服务端必须确认对象实际存在，并按需验证 size、content type、checksum/metadata，再将 Asset 标记为可用。

**原始资产不可覆盖语义**（呼应 D3 的防自动覆盖要求）：
- object key 由服务端生成稳定且不可预测的唯一标识（如 UUID），不由 Browser 自由指定最终存储路径。
- 原始资产默认不得通过重新上传覆盖已有对象；需要重新上传时应创建新的 Asset/object，而非覆盖原始对象。
- AI 重算、PDF Processing、派生资产重新生成等自动化流程不得拥有覆盖或删除原始资产的能力。

**与 Backup/Recovery 的关系**：Direct Upload 只解决上传通道问题，不等同于已完成 D3 要求的备份设计。原始资产上传后仍须满足 D3 全部要求（private access、防自动覆盖/误删、独立于应用部署的持久化、独立 backup/recovery path）；Storage Provider 提供 versioning/跨区域复制/快照等能力不等于系统已完成备份设计，须在基础设施实现阶段实际配置并验证恢复路径。

**留至实现阶段**：multipart upload、断点续传、presigned URL/STS 临时凭证具体方案与有效期、单文件大小限制、checksum 算法、失败重试策略，根据最终选定的 Storage Provider 决定。

**Storage Provider 硬性筛选条件**（用于后续 Storage Provider 选型，此处不锁定具体 Provider）：大陆浏览器可稳定直传、支持安全的临时上传授权机制、支持 private object access，并具备实现 backup/recovery 和防误删策略所需的基础能力。

---

### D10: Storage Provider——阿里云 OSS（MVP Implementation Choice）

**决策**：Storage Provider 选定**阿里云 OSS**。这是 StorageService 边界内的 **MVP 实现选择**，不改变 D3/D9 定义的 Provider-neutral Domain / StorageService 边界——阿里云 OSS 的 SDK、Bucket、Object Key 等 Provider-specific 类型只存在于 StorageService 实现内部，不得泄漏进入 Domain Model（Domain 层继续只引用 D3 定义的 Asset 抽象）。

**选型依据**：在"大陆浏览器可稳定直传、STS/presigned URL 最小权限、versioning、独立 backup/recovery path"等约束下，阿里云 OSS 与腾讯云 COS 在大多数维度功能对等；决定性差异是**跨账号 replication**——阿里云官方文档明确支持["跨账号跨区域复制"](https://help.aliyun.com/zh/oss/user-guide/cross-account-cross-region-replication)，可实现目标账号独立于主 Storage 账号的隔离备份；腾讯云 COS 的 `PutBucketReplication` 已确认是持续自动生效的原生 replication 规则，但其官方文档未明确支持跨独立顶级账号的目标桶（Role 参数格式更像同账号下的主子账号关系），需要额外自建定时任务才能达到同等隔离效果。WORM/Object Lock **不作为本次选型的硬性筛选条件**（腾讯云 COS 的 Object Lock 仅白名单开放，但这不构成否决腾讯云的理由）。

**MVP 落地约束**：
- **Region**：优先选择中国大陆 region；最终 region 根据实际用户地理位置和 D8 定义的 smoke test 结果确认，不预先锁定具体大陆城市 region。
- **Bucket**：private，不做 public-read/public-write。
- **上传凭证**：延续 D9 的最小权限模型——小文件可用 presigned URL；大文件/multipart upload 优先使用 STS 临时凭证（可精确限定 action 列表与 object key/prefix，不含 list/delete）；浏览器不持有长期 AccessKey/SecretKey。
- **原始资产不可覆盖**：服务端生成唯一 object key，不允许覆盖已有对象（延续 D9）。
- **上传验证**：浏览器上传完成后，服务端必须验证对象实际存在及 size/content-type/checksum 等 metadata，才将 Asset 标记为可用（延续 D9 的上传生命周期）。
- **误删/覆盖防线**：开启 Bucket Versioning 作为第一道防线。
- **独立 backup/recovery path**：优先使用 OSS 官方支持的跨账号 + 跨区域复制实现，满足 D3 的独立备份路径要求。
- **WORM**：不作为 MVP 必须项，留作后续可选的 defense-in-depth 加固手段。

---

### D11: PDF Processing Service——独立 Python 服务，Provider-neutral 调用边界

**决策**：PDF 页面渲染、题目区域裁切、图像处理、订正卷 PDF 组装，由独立的 **Python PDF Processing Service** 实现，作为单独的 Docker container，与 Next.js 在 D8 定义的家庭 mini PC 上通过 docker-compose 共部署。

**调用边界（Provider-neutral）**：

```
Application Workflow → PdfProcessingPort → Infrastructure HTTP Adapter → Python PDF Processing Service
```

- Domain / Application Logic 只依赖 `PdfProcessingPort`（或等价的 Service interface），不直接依赖 HTTP、Python service 的具体 endpoint，或 PyMuPDF 等实现细节。
- HTTP 协议、请求/响应结构、PyMuPDF 类型等实现细节只存在于 Infrastructure 层的 Adapter 实现内，不得泄漏进入 Domain Model 或 Application Workflow。

**Python Service 职责边界（严格限定为计算型处理）**：

Python Service **只负责**：
- PDF 页面渲染为图片
- 题目区域（bbox）裁切
- 图像处理
- 订正卷 PDF 生成

Python Service **不负责**（这些能力继续留在 Next.js，Next.js 是业务状态和授权的唯一 authority）：
- Auth / 用户权限判断
- Database 业务状态
- AI Provider orchestration
- Storage 授权（access control 决策）
- 最终业务 workflow 状态迁移

**技术选型**：第一版优先使用 **PyMuPDF** 完成渲染、裁切、PDF 组装；仅当出现 PyMuPDF 无法满足的具体图像处理需求时，才引入 Pillow/OpenCV，不预先为"生态完整性"引入未使用的依赖。

**Storage 访问的最小权限约束**：原始 PDF 位于 private OSS Bucket（D10）。Python Service **不得持有长期 OSS AccessKey/SecretKey**。输入（原始 PDF 读取）和输出（裁切图片、订正卷 PDF 写入 OSS）须通过以下方式之一实现最小权限：
- 由 Next.js / StorageService 签发短期、限定 object key 范围的临时读取/写入凭证，供 Python Service 直接对接 OSS；或
- Python Service 不直接访问 OSS，由 Next.js 负责下载输入文件并传给 Python Service、接收处理结果后再上传回 OSS。

具体传输方式（凭证注入 vs Next.js 中转）留至实现阶段，但必须满足最小权限原则，不因为"内部服务"而放宽。

**内部 HTTP API 设计约束**（具体协议/字段留至实现阶段，以下是必须覆盖的问题）：
- **request/job identity**：每次调用须有可追踪的请求/任务标识，便于日志关联和重试判断
- **timeout**：Next.js 侧对调用设置合理超时，避免无限等待
- **retry / idempotency**：失败重试不得产生重复的部分输出或不一致状态；接口设计需支持幂等调用
- **临时文件清理**：Python Service 处理过程中产生的临时文件，处理完成或失败后必须清理，不得无限堆积
- **输入文件大小限制**：明确拒绝超出处理能力的输入，而非无限尝试
- **malformed/corrupt PDF**：明确的错误响应，不导致进程崩溃或状态不明
- **service unavailable**：Next.js 侧须能识别 Python Service 不可用，并将其作为明确的失败状态呈现给业务流程，而不是静默挂起
- **临时文件不得被当作持久资产**：Python Service 产生的中间文件只是处理过程的临时产物，唯一的持久化路径是通过 Next.js/StorageService 写回 OSS 成为 Asset（呼应 D3/D9）
- **失败传播**：Python Service 调用失败不得被业务 workflow 静默吞掉或直接推进到"成功"状态；必须显式传播失败，交由 D6 定义的持久化工作流处理（保留已确认事实，允许人工重试）

**同步 vs 异步**：MVP 采用**同步 HTTP 请求/响应**。当前 Specs 的 PDF 规模（单份试卷、少量错题、家庭单账号使用）和批改流程本身已含人工确认步骤（用户预期有等待），不构成需要引入消息队列/异步任务系统的规模压力。**不预先引入 MQ/Redis/Celery 等基础设施**；若未来量级增长导致同步调用不可行，可作为独立的演化路径处理，当前不实施。

**与 D8 的关系**：Python Service 容器与 D8 定义的 Application Runtime 生命周期原则一致——它同样是可丢弃、可重建的计算单元，不持有需要独立于 Runtime 存活的持久业务状态或原始资产；所有需要持久化的输出（裁切图片、订正卷）最终落地到 D3/D10 定义的 Object Storage，而非停留在 Python Service 自身。

---

### D12: Auth Provider 实现选择——短信 OTP 已确定，Email OTP 走 Selection Gate

**短信 OTP**：确定采用**阿里云号码认证服务(PNVS)—短信认证**，作为 MVP Implementation Choice。依据：标准 SMS 签名服务明确要求企业资质，个人实名认证账号无法报备（阿里云、腾讯云官方文档均已确认）；PNVS 短信认证是阿里云专为个人实名认证开发者提供的免资质验证码产品，不需要申请签名/模板，满足当前账号主体（大陆个人实名认证）的约束。

**Email OTP**：不在 design 阶段锁定 Provider，走 **Selection Gate**（实现阶段执行的经验性选型，而非设计阶段假设的结论）：
1. 优先实测**阿里云邮件推送(DirectMail)**和**腾讯云 SES**：当前个人实名认证账号能否正常开通、能否完成 sender/domain verification、向 qq.com/163.com/126.com 及至少一个国际邮箱发送 OTP 的送达时间与是否进入垃圾箱、基本稳定性。
2. 实测通过的国内 Provider 中选择一个作为 MVP 实现。
3. 若国内 Provider 均因账号资质或其他原因不可用，再评估海外 ESP（如 SendGrid/Resend/AWS SES）作为 fallback。

**Provider Boundary（两者共同遵守）**：Email OTP 与 SMS OTP 是两个独立的 Provider 边界，不因为都属于"Auth"而绑定同一厂商，也不与 Storage Provider（D10）绑定。Domain / AuthService 不依赖任何具体 Email/SMS Provider 的类型；Provider-specific SDK/config 只存在于 AuthService 的 adapter/infrastructure 实现内。

---

### D13: AI Provider Selection Gate——基于固定评测样本的可重复经验性选型

**背景**：D5 定义了四个 AI Task Contract（错题识别、区域定位、知识点标签、题型分类），但不预设具体模型。选型不能仅凭通用 benchmark 或厂商自评数字（不代表本项目的具体场景：中文小学数学试卷、几何图形、教师手写批改标记），必须通过一次可重复的经验性评测（Selection Gate）在实现阶段确定 MVP 默认模型。

**当前候选（第一轮，非最终锁定，Gate 执行时重新核实可用性）**：通义千问 Qwen-VL 系列、Moonshot Kimi 当前可用多模态模型。若第一轮均不能满足要求，再评估智谱 GLM、DeepSeek 或其他候选，不预先扩大范围。

**AI Provider Region 验证**：沿用 D8 定义的原则——任何候选模型是否可从当前 Application Runtime 实际出站来源（当前是家庭宽带大陆出口 IP）调用，须在 Gate 执行时用官方文档重新核实。海外主流 Provider（OpenAI/Anthropic/Gemini）当前对中国大陆的访问限制状态是会随时间变化的外部事实，不在 design 中固化为架构假设——design 只保留"验证要求"本身。

**Evaluation 方法（Gate 必须满足以下结构，避免主观印象判断）**：
1. **固定的 representative evaluation samples**（至少覆盖）：
   - 中文小学数学试卷
   - 印刷文字与数学公式
   - 几何图形
   - 圈、叉、勾、手写批改等不同教师标记
   - 单题、多题、跨页等典型情况
2. **按 D5 的四个 Task Contract 分别评估**，不要求单一模型赢下全部任务：错题识别、区域定位/bbox、知识点标签、题型分类。
3. **至少记录的指标**：task correctness、bbox/定位质量、结构化 JSON contract 成功率、latency、API 成本、failure/retry 行为。
4. **输入与期望结果固定且可重复运行**——同一组样本和期望结果可以重新跑一遍来验证任何模型切换，不依赖每次人工凭印象判断。
5. **Provider Boundary**：Provider-specific SDK、model name、request/response mapping 只能存在于 AI Integration / Adapter 层；Domain 和 workflow 只依赖 D5 定义的 Task Contract 接口。
6. **输出**：Selection Gate 完成后必须产出一份简短 decision record——测试了哪些模型、基于什么样本和指标、为什么选择当前 MVP 默认模型（或按任务分开选择的模型组合）、已知限制。

## Risks / Trade-offs

- **AI 识别准确率**：批改风格不统一影响错题识别结果。→ 人工确认是强制节点，不依赖 AI 输出正确。
- **PDF 渲染一致性**：不同工具生成的 PDF 内部结构差异大，区域裁切效果可能不稳定。→ 人工边界修正提供兜底。
- **多照片与 PDF 页面对应**：多张批改照片与 PDF 多页的对应在复杂排版下容易出错。→ MVP 阶段将对应关系确认保留为人工步骤，AI 仅做推荐。
- **原始资产保护**：备份机制属于基础设施层决策，若实现阶段未正确配置隔离，原始资产存在误删风险。→ 部署阶段须验证备份路径与应用部署流程相互独立。
- **Generation Snapshot 完整性**：若快照信息记录不完整，无法保证重新生成结果的语义一致性。→ 实现阶段须明确 snapshot schema，并在首次生成时完整记录所有排版决策依据。

## Migration Plan

全新应用，无存量数据迁移。初次部署须满足：

1. 对象存储（阿里云 OSS）配置完成，具备独立于代码部署的访问权限
2. 原始资产备份路径（OSS 跨账号复制）已配置，并与应用部署流程验证相互隔离
3. Auth 配置完成：短信 OTP（阿里云 PNVS）已确定；Email OTP Selection Gate（D12）已执行并选定实现；预配置邮箱/手机号已录入 allowlist（User/Child 记录由首次 OTP 登录自动创建，不作为手工部署前置项）
4. 自建 PostgreSQL 容器 + 独立 persistent volume 已部署；定时 `pg_dump` → OSS 备份任务已配置并验证上传成功；至少完成一次 restore test
5. AI API 连通性已验证（D13 Selection Gate 执行完成）
6. Python PDF Processing Service 容器已随 Next.js 共部署并验证可用（D11）

## Open Questions

- **Email OTP Provider 选型**：见 D12 Selection Gate。
- **AI 模型选型**：见 D13 Selection Gate。
- **UI 组件库**：shadcn/ui + Tailwind（已确认，implementation choice，不改变架构约束）。
- **公网入口 / Tunnel 机制及 ICP 备案合规问题**：D8 定义的 unresolved implementation gate，选定具体家庭宽带公网入口方案时须单独核实（大陆出站 Web 服务合法性、域名/ICP 备案要求、所选 tunnel/reverse proxy 的条款与大陆访问稳定性、HTTPS/源站暴露问题）。
- **pg_dump 具体调度周期与备份保留窗口**：D8 已定义 RPO ≤ 6h 约束，具体 cron 周期和保留天数留至实现任务确定。
- Generation Snapshot 的具体 schema：实现阶段决定
- 题库浏览与管理界面是否纳入 MVP：待后续 change 决定
