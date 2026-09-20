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
  └── Child[]（学习数据主体，一个 User 下可有多个）
  └── currentChildId（可变指针，默认指向上次使用的 Child；创建/切换规则见 child-profile capability）

WorksheetArchive（卷子档案）        由 User 管理，家庭级共享
  └── 关联原始 PDF 的 Asset
  └── PdfTypeDetectionAttempt[]（append-only 检测历史，见 D19；当前生效判定取最新一条 attempt——
      completed 则用其 detectedInputType，pending/failed 或无记录则视为 unknown，不回退使用更早的
      completed 记录）
  （不归属任何 Child；同一份 PDF 档案可被不同 Child 的 GradingSession 复用）

GradingSession（批改任务）          归属 Child
  ├── 创建时从 currentChildId 读取并绑定，此后不可变，不因 currentChildId 后续变化而改变
  ├── 批改照片 Asset（支持多张）
  ├── 人工确认的错题列表（概念关系）
  └── 人工确认的题目区域（概念关系，含页码和边界坐标）

ErrorQuestion（错题）               归属 Child
  ├── childId 完全继承自其所属 GradingSession，创建/提交时 SHALL NOT 读取 currentChildId
  ├── 来源 GradingSession
  ├── 干净原题区域（来自原始 PDF，人工确认后的原始事实；可能缺失）
  ├── 作答证据区域（来自批改照片，记录孩子作答与批改标记）
  ├── 知识点标签（含 AI 草稿与人工确认值的溯源信息，见下方）
  ├── 错因建议快照与人工确认值（aiSuggestionSnapshot / confirmedCause，独立保存，见 D17）
  └── 重做记录集合、当前复习状态、重做次数（RedoAttempt[] / currentReviewStatus / redoCount，均为推导投影，见 D18）

CorrectionWorksheet（订正卷）       归属 Child
  ├── childId 从生成时所选 ErrorQuestion 集合推导（集合内 childId 须一致），生成时 SHALL NOT 读取 currentChildId
  ├── 关联 ErrorQuestion 集合
  └── Generation Snapshot（见 D7）
```

**干净原题区域与作答证据区域是两个独立概念**：`ErrorQuestion` 的题目区域信息由两个独立字段构成——干净原题区域（来自原始 PDF，PDF 页面坐标空间的边界坐标，可能缺失）与作答证据区域（来自批改照片，记录孩子作答和批改标记）。二者 SHALL NOT 相互替代或混用；干净原题区域缺失时，系统 SHALL NOT 用作答证据区域的内容填充该字段。

作答证据区域的概念模型由 D16 确定：`kind`（候选上下文区域 | 整照片兜底）+ 始终包含的原始批改照片引用；只有 `kind = 候选上下文区域` 时才包含照片坐标空间中的区域坐标。精确的数据库字段类型/表设计留至实现阶段，但概念模型和两区域的对齐机制已在 D16 确定，不再是未决问题。

**AI 草稿与人工确认值的溯源原则**：对于 AI 生成后可由人工确认/修改的值（如知识点标签），系统必须能够区分 AI 生成草稿与人工确认后的权威值，并保证人工确认后的值优先于 AI 生成值；后续 AI 重算不得自动覆盖人工确认结果。具体 Schema 实现（字段结构、表设计）留至实现阶段。

**AI 自动派生值的降级原则**：对于不需要人工确认的 AI 派生值（如题型分类），系统采用自动降级而非 Human Gate：AI 无法确定时使用默认值，不新增人工操作步骤。

核心领域模型不依赖任何 BaaS Provider 的数据结构。数据库字段级 Schema 留至实现阶段。

**多用户 / 多孩子扩展**：一个 User 下 SHALL 可以有多个 Child；User 持有一个可变指针 `currentChildId`，默认指向上次使用的 Child，仅在用户主动新建或切换孩子档案时改变。三类 Child 归属实体的绑定规则彼此不同、不共用同一条读取规则：

- `GradingSession`：创建时从 `currentChildId` 读取一次并永久绑定，此后不可变，不因 `currentChildId` 之后的变化而改变。
- `ErrorQuestion`：childId 完全继承自其所属 `GradingSession`，创建或提交时 SHALL NOT 读取 `currentChildId`。
- `CorrectionWorksheet`：childId 从生成时所选的 `ErrorQuestion` 集合推导——集合内所有 `ErrorQuestion` 的 childId SHALL 一致，取该值作为订正卷的 childId；生成时 SHALL NOT 读取 `currentChildId`，即使生成那一刻 `currentChildId` 已经切换到其他孩子，只要所选错题集合内部一致，订正卷仍归属该一致的孩子；若集合内 childId 不一致，系统 SHALL 拒绝生成。

`currentChildId` 本身须满足：SHALL 始终指向发起请求的 User 自己拥有的 Child，SHALL NOT 被设置或提交为其他 User 拥有的 Child；首个孩子档案创建后 SHALL 立即成为 `currentChildId`；只要该 User 拥有至少一个 Child，`currentChildId` SHALL 始终指向一个有效的、属于该 User 的 Child。创建 `GradingSession` 时，服务端 SHALL 重新校验待绑定的 childId 确实归属发起请求的 User，SHALL NOT 直接信任客户端提交的 childId。

`WorksheetArchive` 保持 User 级家庭共享，不因当前 Child 上下文而具有 Child 归属，可被不同 Child 的 `GradingSession` 复用。孩子档案的创建、切换、onboarding 行为由新增的 `child-profile` capability 定义；MVP 不实现孩子档案的独立登录、删除、合并或家庭成员邀请等完整管理能力。

---

### D5: AI 集成——六个 Task Contract，区分 Human Gate 与自动降级

AI 能力定义为六个独立 Task Contract，业务流程依赖 Contract 而非具体模型。

**需要 Human Gate 的 AI 结果**（须经人工审核后方可成为业务事实）：

| Task | 输入 | 候选输出 | 人工操作 | 失败兜底 |
|------|------|------|------|------|
| 区域定位 | PDF 页面渲染 + 目标题号 | 边界坐标 | 预览/修正——仅在"整页题目分割未能为已知题号提供可用框"的定向修复场景触发，不再是正常入口（见 D20） | 失败落入 `locality_retry`（D20 调度顺序）；仍失败则标记该题"未解决"，不提供从零手绘完整边界的入口 |
| 整页题目分割 | `full_page` 模式：批改照片或已确认的 PDF 页面渲染 → `QuestionBoxCandidate[]`（数量不定，可能为空）；`locality_retry` 模式：批改照片或已确认的 PDF 页面渲染 + 大致位置/区域 hint → 零个或一个候选修复框（判别式响应类型，两模式不共用同一列表形状，精确接口见 D20） | 点选框体以确认错题；点击遗漏题目大致位置触发修复调度（按 D20 定义的顺序调用区域定位或 `locality_retry`） | 批改照片输入（无 PDF 路径）：单题级——补框仍失败→标记该题"未解决"，不创建错题记录，其余错题不受影响；整体无法产生可靠结果→标记该照片不可用，提示重新拍摄/替换（该输入源本身可能确实不可用）。PDF-render 输入（PDF-backed 路径）：`full_page` 结果为空或不可靠 SHALL NOT 视为整批终态——家长仍可逐题点击大致位置触发修复调度；单题修复耗尽后按单题级标记"未解决"；恢复选项按失败原因区分（重试/重新选择 PDF 页面/更换批改照片），见 D20 |
| 知识点标签 | 题目图片 | 知识点标签 | 确认/修改 | 空值，可手动填写 |

```
AI Output（候选草稿）→ Human Review → Confirmed Business Fact
                                       （不被后续 AI 重算覆盖）
```

**允许自动派生并降级的 AI 结果**（不新增 Human Gate）：

| Task | 输入 | 输出用途 | 失败处理 |
|------|------|------|------|
| 题型分类 | 题目图片 | 决定答题空间大小 | 使用默认答题空间，不阻塞流程 |

**非阻塞 AI 建议型结果**（默认作为标注清楚的 AI 建议展示，不要求人工确认才能被查看，也不因未确认而阻塞任何流程；人工可选择确认/修改或直接忽略；不是 Human Gate，也不是自动降级，是第三种流转模式）：

| Task | 输入 | 候选输出 | 人工操作 | 失败/低置信度处理 |
|------|------|------|------|------|
| 错题识别 | 批改照片 | 可能做错的题号列表（非权威信号，仅用于驱动整页题目分割结果的预高亮，见 D20） | 无独立确认动作——最终确认由整页题目分割的点选/取消选择完成，不针对错题识别本身单独确认 | 结果为空、失败，或无法与分割框可靠、唯一地关联 → 不驱动预高亮，直接静默退化为纯点选，不阻塞流程 |
| 错因分析 | 干净原题区域（视输入模式，可能缺失）+ 作答证据区域（候选裁切或整照片兜底，仅发送该模式所需的最小必要输入） | 结构化主分类（taxonomy v1，见 D17）+ 简短解释 + 置信度 | 可选确认/修改（不要求；确认后生成独立 `confirmedCause`，不覆盖 `aiSuggestionSnapshot`） | 本地预检失败或置信度未达门槛 → `unavailable`（状态，非分类），不阻塞任何流程 |

MVP 实现时可用同一个多模态模型完成全部任务，但这是实现选择，不是架构约束。具体 AI 模型实现阶段决定。

**理由**：六个 Task Contract 覆盖三种不同的结果流转语义——Human Gate（区域定位、整页题目分割、知识点标签：候选输出直接决定题库数据、可打印订正卷内容，错误代价高，须经人工确认才能成为业务事实）、自动降级（题型分类：只影响答题空间等派生展示/排版行为，不改变题目内容、孩子作答或其他权威业务事实；分类错误仍可能降低可用性，但系统有明确默认空间兜底，因此其风险是有界的，为此增加强制人工确认的摩擦大于收益）、非阻塞建议（错题识别、错因分析：两者的确认语义并不相同——错题识别不设独立 Human Gate，因为其输出只用于非权威预高亮，最终权威选择已经由用户对整页分割框集合的确认完成，再要求确认一次题号列表属于重复摩擦；错因分析是非阻塞建议，允许用户自愿确认/修改形成独立的 `confirmedCause`（见 D17），但不要求每次都完成确认，失败或未确认不得阻塞错题保存、查看、打印或重做）。拆成独立 Task Contract 而非单一万能 AI 接口，是因为这六种能力的输入输出形状（1:1 目标定位 vs 1:N 数量不定的分割结果 vs 分类标签 vs 结构化多字段判断）、置信度语义、以及 D13 Selection Gate 的评测/选型需求（正式 Gate / 探索轨道 / 非阻塞轨道 / 修复支持轨道，彼此互不影响对方的通过/否决判定；不同任务甚至可以分别选择不同 Provider，见 D13 第 6 点）互不相同，勉强合并成一个接口会让契约定义自相矛盾（这一论证已在 D15 中用于说明"整页题目分割"为何不能并入"区域定位"，本条把它提炼为 D5 层面的通用原则）。三种流转语义、而非单一统一规则，是因为不同结果的风险与效用比例不同：对高风险结果强制放松确认（自动采信）会让潜在错误直接进入业务数据；对低风险/有界风险的结果强制加严确认（一律 Human Gate）则会制造不必要的操作摩擦，两者都不成立，只能按具体契约的风险/效用比例分别选择语义。

**替代方案**：单一万能 AI Task Contract（一个接口处理全部六种能力）——已否决，理由见上（契约定义自相矛盾）；全部结果统一走 Human Gate——已否决，会让题型分类这类有界风险的派生值也背上确认负担；全部结果统一自动降级/自动采信——已否决，会让区域定位、整页分割、知识点标签这类直接决定订正卷内容或题库数据的结果未经把关就成为业务事实，与 D6 冲突；用单一连续置信度分数统一驱动"是否需要确认"而不按任务类型分类——已否决，不同任务的置信度量纲不可比，且 Provider 自报分数本身不可直接采信（见 D19/D17 已确立的原则），会让确认要求变得不可预测、难以在 spec 中固定描述。

---

### D6: 批改流程——服务端持久化，已确认事实不可被自动覆盖

采用可恢复的服务端工作流：每个人工确认节点完成后立即持久化确认结果。

以下操作不得导致已确认业务事实丢失或被自动覆盖：

- 刷新页面或关闭浏览器
- 重新登录 / 跨设备继续操作
- AI 重算
- 派生资产重新生成

具体状态机设计、状态字段、异步 Job 等实现细节不在此展开。

**AI 建议快照的保护范围（比"已确认事实"更宽的一条规则）**：错因分析这类默认展示、不要求确认即可被查看的 AI 建议，一旦已经展示给家长，其快照（`aiSuggestionSnapshot`）SHALL NOT 被后续任何自动重新分析静默覆盖或替换——即使这条建议从未被人工确认过。若未来支持重新分析，须生成新的版本记录，不得改写已展示的历史快照；MVP 是否提供主动重新分析入口本身尚未决定，不在此预先假定存在。完整机制见 D17。

**理由**：当某个 AI 输出按照 D5 的契约语义可能进入权威业务事实时，它必须先作为候选，只有经过该契约规定的人工确认后才能成为权威事实——这不要求全部 AI 调用都增加确认步骤：题型分类属于自动降级的派生值，不因没有 Human Gate 而违反本原则；错题识别和未经确认的错因建议保持非权威建议状态，同样不违反本原则。D6 保护的是"候选→确认事实"这条边界，以及已展示快照的可追溯性，而不是要求所有 AI 输出都必须被确认。这条边界之所以必要，是因为 AI 输出已知不完美（D13 整套 Selection Gate 机制的存在本身就证明了这一点——不同 Provider 在同一任务上的表现需要经验性评测才能确定，隐含着非平凡的错误率是预期中的常态），而本项目的下游产物（打印出的订正卷、题库中用于跨周/跨月重做追踪的记录）生命周期长、事后静默纠正的代价高，因此需要一个可追溯到真实人工决定的节点，而不是依赖推断。"自动重算不得覆盖已确认事实"：若允许后续同一 AI 能力的重新计算（如 D13 切换 Provider 后的重跑、或失败重试）覆盖家长已经做出的确认，等同于让自动化推翻人工的最终决定，使"人工确认"这一整套机制形同虚设；这也是可恢复工作流（本决策开篇"中途中断不能丢失已确认的业务事实"）的直接推论——从家长的角度看，被自动覆盖和数据丢失没有区别。"未确认但已展示的建议快照也不得静默变化"：这条把保护范围从"已确认事实"扩展到"已经进入家长认知的内容"——即使从未被确认，一旦展示给家长，它就已经是家长记忆里"系统当时说了什么"的一部分；如果后台重新分析悄悄换了结果，家长既不知道自己看到的已经过期，也无法追溯变化，这比一条明确标注"未确认"的建议本身更损害对产品的信任。这三条规则在 D14（预选≠确认）、D16（候选区域确认语义）、D17（`aiSuggestionSnapshot` 保护）、D18（`RedoAttempt`/`correctionAudit` 的追加式历史）、D20（预高亮非事实、区域定位/`locality_retry` 候选需确认）中分别落地为具体的领域规则，本条只陈述这些具体规则背后共享的通用原则，不重复定义它们各自的字段/场景细节。

**替代方案**：仅保护"已确认事实"，未确认的 AI 建议快照可被最新结果随时静默替换——已否决，会让家长已经看到的内容在后续访问时"悄悄变了"，破坏对展示内容的信任；客户端本地缓存确认状态、不要求服务端立即持久化——已否决，与"刷新页面/关闭浏览器/重新登录/跨设备继续操作不得丢失已确认事实"直接冲突，批改流程本身可能跨设备/跨会话中断；允许自动重算覆盖已确认事实但保留历史版本供追溯（软覆盖+可回滚）——已否决，即使历史版本仍然存在，自动改变当前权威值仍违反"自动流程不得替换人工确认事实"的原则，家长打印/查看时看到的仍是被自动改变后的当前值，除非主动翻历史才能发现变化；用锁定/解锁机制代替"不可覆盖"规则，允许家长解锁后被系统重新覆盖——MVP 未采用，理由是它增加状态机复杂度和误解锁风险，而当前需求可由更简单的规则满足：自动流程永不覆盖，家长若要更新只能通过自己的新一次明确人工操作完成；未来如果需要显式的重新分析/重新确认入口，可由独立 Change 设计，本条不预先永久禁止。

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
- 批改照片与 PDF 页面渲染图之间的页面配准（基于 OpenCV 特征匹配+单应性矩阵估计），及题目区域的坐标映射（PDF 侧 bbox → 照片侧候选上下文区域，见 D16）
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

**背景**：D5 定义了六个 AI Task Contract（错题识别、区域定位、整页题目分割、知识点标签、题型分类、错因分析），但不预设具体模型。选型不能仅凭通用 benchmark 或厂商自评数字（不代表本项目的具体场景：中文小学数学试卷、几何图形、教师手写批改标记），必须通过一次可重复的经验性评测（Selection Gate）在实现阶段确定 MVP 默认模型。

**当前候选（第一轮，非最终锁定，Gate 执行时重新核实可用性）**：通义千问 Qwen-VL 系列、Moonshot Kimi 当前可用多模态模型。若第一轮均不能满足要求，再评估智谱 GLM、DeepSeek 或其他候选，不预先扩大范围。

**AI Provider Region 验证**：沿用 D8 定义的原则——任何候选模型是否可从当前 Application Runtime 实际出站来源（当前是家庭宽带大陆出口 IP）调用，须在 Gate 执行时用官方文档重新核实。海外主流 Provider（OpenAI/Anthropic/Gemini）当前对中国大陆的访问限制状态是会随时间变化的外部事实，不在 design 中固化为架构假设——design 只保留"验证要求"本身。

**Evaluation 方法（Gate 必须满足以下结构，避免主观印象判断）**：
1. **固定的 representative evaluation samples**（至少覆盖）：
   - 中文小学数学试卷
   - 印刷文字与数学公式
   - 几何图形
   - 圈、叉、勾、手写批改等不同教师标记
   - 单题、多题、跨页等典型情况
2. **按契约/模式分别评估，不要求单一模型赢下全部任务**：本 Gate 覆盖的评估对象是六个 Task Contract 在其各自适用模式下的表现，Gate 归属见下表：

   | Task Contract | 模式/输入 | Gate 归属 |
   |------|------|------|
   | 整页题目分割 | `full_page`，PDF 页面渲染输入 | **正式 Gate**（digital_native calibration/held-out per D19 数据集 B；scanned/mixed-or-ambiguous 探索） |
   | 整页题目分割 | `full_page`，批改照片输入 | 探索轨道（P1(4)/D15，不变） |
   | 整页题目分割 | `locality_retry`，任一输入源 | 修复 pipeline 轨道（观察性，见 D19/D20，不进入任何 Gate 判定） |
   | 知识点标签 | — | **正式 Gate** |
   | 题型分类 | — | **正式 Gate** |
   | 错题识别 | — | 非阻塞预高亮建议轨道（离线人工真值评测，见下） |
   | 区域定位 | — | 修复支持轨道（硬治理仍强制，结果不判定 MVP 通过/否决，见下） |
   | 错因分析 | — | 既有非阻塞评测轨道（完整评测方法见 D17） |

   正式 Gate 判定 SHALL 仅覆盖上表标记为"正式 Gate"的三项（整页题目分割的 `full_page`+PDF-render 模式、知识点标签、题型分类）；其余五项均不构成候选模型通过/否决正式 Gate 的依据。
3. **至少记录的指标**：task correctness、结构化 JSON contract 成功率、latency、API 成本、failure/retry 行为。整页题目分割（`full_page`，任一输入源）的漏框率/框不准率/false-positive/duplicate/merge-error 率精确定义见 D19，评测 SHALL 使用该定义，不得另行定义；`locality_retry` 模式单独记录其修复触发后的成功率，不与 `full_page` 的原始 Gate 分数混合。区域定位在修复支持轨道下记录修复成功率（对已知缺号补出可用框的比例）与失败行为，不使用"正常路径 bbox 质量"的措辞。**错题识别的离线评测**（Selection Gate 阶段）SHALL 使用人工标注的批改照片 ground truth（哪些题目实际做错），不依赖任何真实家长行为数据（该数据在开发阶段不存在）；至少记录：false pre-highlight rate（不该被预选的题被建议预选的比例）、correct pre-highlight recall/coverage（真实错题中被正确建议预选的比例）、unavailable/abstention rate、structured-output success、latency/cost/failure-retry。上线后观测的"家长取消 AI 预选比例"等生产体验指标 SHALL NOT 替代或混入本 Gate 的离线评测结果，两者在 decision record 中分别列示。
4. **输入与期望结果固定且可重复运行**——同一组样本和期望结果可以重新跑一遍来验证任何模型切换，不依赖每次人工凭印象判断。
5. **Provider Boundary**：Provider-specific SDK、model name、request/response mapping 只能存在于 AI Integration / Adapter 层；Domain 和 workflow 只依赖 D5 定义的 Task Contract 接口。
6. **输出**：Selection Gate 完成后必须产出一份简短 decision record——测试了哪些模型、基于什么样本和指标、为什么选择当前 MVP 默认模型（或按任务分开选择的模型组合）、已知限制。

**非阻塞评测轨道的治理原则**：某个 Task Contract 走非阻塞评测轨道，意味着该能力表现不佳不否决其他正式契约、不阻止 MVP 交付——但这不等于该轨道可以随意选择一个质量很差的 Provider。走该轨道的 Provider 仍须满足：官方支持从当前实际出站来源调用（D8/本 D13 通用要求）、结构化 Contract 输出合规、遵守隐私最小输入原则。若某个输入模式下没有满足这些硬约束的可靠候选，该模式 SHALL 保持 `unavailable`，SHALL NOT 为了"声称功能存在"而选择无法稳定遵守 Contract 的 Provider。

**修复支持轨道的治理原则**：区域定位不再决定 MVP 正式通过/否决，但其 Provider 选型仍须满足官方支持/实际出站可达/结构化 Contract 输出合规等硬约束（同上）；其修复成功率与失败行为仍须被记录，供实现阶段判断修复路径的实际可用性，不因"非正式判据"而免于评测。

---

### D14: 批改照片与 PDF 页面对应——有候选时预选+人工确认，无候选时人工选页，单页自动

**决策**：多页 PDF 场景下，系统尝试为每张批改照片生成页面对应候选。

- **有可靠候选**：系统预选该候选页面并展示给家长；家长须执行明确的确认动作（确认或更换为其他候选）后，该对应关系才成为已确认业务事实。**预选状态本身不是已确认事实**，在家长确认之前不得被区域定位、订正卷生成等下游步骤当作确定值使用。
- **无可靠候选**：系统进入完整 PDF 页面缩略图/页码列表的异常选择路径，由家长手动选择对应页面。
- **单页 PDF**：系统自动对应，不要求家长操作（单页没有候选歧义）。

"可靠候选"的判定标准由 D13 AI Provider Selection Gate 的评测结果，以及 P1(9) 后续确定的三层验收范围共同决定；具体可靠性数值留待真实第三方测试集建立后确定，本决策不预先假定任何具体阈值。**判定标准尚未建立、或某次结果未达标时，一律按"无可靠候选"处理**，进入上述异常选择路径。

家长确认后的页面对应关系不得被后续 AI 重算自动覆盖。

**本决策范围**：只确定"批改照片对应哪一个 PDF 页面"这一层关系。题目区域坐标与照片作答区域之间的空间对应属于另一个决策范围，不在此展开，也不预先定义坐标语义。

**理由**：第三方试卷是封闭容器、无题库可检索，页面对应必须显式建立；容器通常只有个位数页，预选+确认的成本足够低，延续"AI 自动、人工修异常"的原则，同时保留"预选≠确认"的边界，不把 AI 尚不确定的结果当成事实。

**替代方案**：AI 预选后直接采用、不要求家长确认——违反 D6"人工做最终决定"，且抹掉"预选≠确认"的区分，被否；纯人工选页、无 AI 参与——与自动优先原则冲突，被否；全自动无确认——排版差异下不可靠，被否。

---

### D15: 无原始 PDF 的批改任务——功能边界与降级语义

**决策**：批改任务未关联原始 PDF 时，系统不拒绝该任务，进入明确降级的路径，边界如下：

**可以做的**：
- 对批改照片尝试自动整页切题（见新增的"整页题目分割" Task Contract，独立于现有"区域定位"契约——比较见下），以可点击框体呈现，家长点选确认错题，不要求家长从零画框。
- 保存作答证据区域（孩子的作答、计算过程、批改标记）。
- 尝试 AI 错因建议（非阻塞，见 D5 相关分类；具体机制见 P1(6)）。

**不能做的**：
- 干净原题区域（该字段明确标记缺失，不用作答证据区域填充，见 D4/question-bank spec）。
- 生成订正卷（correction-worksheet spec 的 fail-closed 规则）。
- 与数字原生 PDF 同等的正式自动切题验收标准（纯照片切题按 P1(9) 归入独立探索性轨道，不共用阈值）。

**失败语义**：整页题目分割的失败分两个层级，处理方式不同：
- **单题级**：家长点击遗漏题目大致位置后，系统尝试重新分割/补框；若该题仍无法可靠切分，系统 SHALL 将该题在当前 GradingSession 中标记为"未解决"，SHALL NOT 为其创建 ErrorQuestion；家长可重新拍摄/替换照片，或明确放弃该题；其余已可靠切分并确认的错题不受影响。
- **整照片级**：若整张照片未能产生任何可靠题目框，或整体切题结果不可用，系统 SHALL 将该照片整体标记为不可用，提示家长重新拍摄或替换照片。

两种情况下，系统均 SHALL NOT 静默跳过、SHALL NOT 生成不可靠的题目框、SHALL NOT 要求家长手动画出完整边界。

**Task Contract 设计**：新增独立的"整页题目分割"Task Contract，而非扩展现有"区域定位"契约——两者输出基数（1:N vs 1:1）和失败兜底语义不同，勉强合并会让 D5/D13 的契约定义自相矛盾。本 Decision 定义了该契约在无 PDF 降级路径下的输入（批改照片）及其失败语义；该契约现已扩展至 PDF 页面渲染输入，并成为有 PDF 主路径的正常入口——具体机制见新增的 D20（P1(11) 已定案）。本节描述的无 PDF 路径失败语义保持不变，D20 的 PDF-backed 路径复用同一套"单题级/整照片级"失败处理原则。

**替代方案**：拒绝无 PDF 的批改任务（问题 11 已否决）；用照片区域代替干净原题区域（本次讨论已否决，两者是独立概念）；扩展现有区域定位契约支持整页模式（已比较，因输出基数、失败语义、验收轨道三方面都不同而被否）。

**范围声明**：未来"补交 PDF 回填关联"的 C 路径不在本 Decision 范围内，留给后续 Change。

**P1(11) 已定案**：现有"错题识别"契约与决定 1 的"整页分割+点选"交互模型之间的关系已确定——有 PDF 场景下采用整页题目分割为正常入口，错题识别降级为非阻塞预高亮信号，区域定位降级为定向修复，详见新增的 D20。Group 4/7 的具体任务编排仍由 P1(10) 承接，本次不展开。

---

### D16: 作答证据候选区域——页面配准+保守上下文余量，图像处理服务而非 AI Task Contract

**决策**：当批改任务关联原始 PDF 时，系统在已确认的照片↔页面对应关系（D14）基础上，对 PDF 渲染页与批改照片做页面配准，将已确认的干净原题区域映射到照片坐标空间，并在映射结果周围加保守的上下文余量，形成作答证据候选区域。该区域的目标是让家长通常能看到题目附近的作答、计算过程和批改痕迹，不要求精确框出每一笔手写内容，MVP 不新增独立检测所有手写笔迹边界的 AI 能力。保守上下文余量的具体大小同样通过真实样本校验确定，须可配置，不作为不可追溯的硬编码常数。

**归属**：页面配准与区域映射是确定性图像处理算法（特征匹配+单应性矩阵估计），不是 AI Task Contract——不存在"选哪个 AI Provider"的维度，不适用 D13 Selection Gate 的评测方法论。归属 D11 Python PDF Processing Service（引入 OpenCV，触发 D11 已预留的条件）。

**回退语义**：页面配准失败、置信度不足，或映射后的候选区域明显不足以覆盖题目上下文时，系统 SHALL 回退为使用整张原始批改照片作为作答证据，并在数据中显式标记为"整照片兜底"（不依赖字段为空的隐式判断），不阻塞错题保存，不要求家长从零画框。"明显不足"的具体判定阈值留待真实数据确定，本决策不预设数值；判定标准未建立或未达标时一律按回退处理（呼应 D14 的既有模式）。

**人工操作**：家长可对候选区域的边界做小幅调整（拖动边界），系统不提供从零画框的入口；整照片兜底状态下无区域可编辑。

**持久化与确认语义**：候选区域或整照片兜底在生成阶段只是候选结果，SHALL NOT 被视为已确认业务事实；只有当家长在确认该错题时明确确认该候选区域（或整照片兜底），才成为已确认业务事实。确认后，任何自动重新配准、重新映射，或其他自动计算 SHALL NOT 静默覆盖已确认的区域——**这条不是"AI 重算不得覆盖"**（页面配准是确定性图像处理，不是 AI），而是延续 D6"已确认事实不可被自动覆盖"的通用原则，适用范围覆盖所有自动化流程，不限于 AI 重算。

**范围声明**：不依赖 P1(11) 是否将"整页题目分割"扩展到有 PDF 场景——本机制只依赖已确认的干净原题区域和已确认的照片↔页面关系，与 P1(11) 的契约设计相互独立，将来若 P1(11) 决定扩展，两者是否有复用空间届时再评估，不在此预判。

**替代方案**：独立检测所有手写笔迹边界——MVP 阶段被否，增加一个新 AI 能力和新失败模式；作为新 AI Task Contract 走 D13 Gate——因不存在 Provider 选型维度而被否。

---

### D18: 重做复习闭环——题目级独立状态，订正卷是可选入口而非前提

**决策**：
- `ErrorQuestion` 创建（保存到题库）时没有任何 `RedoAttempt` 记录；因记录集合为空，其复习状态和重做次数**投影**为"尚未检查"/0。系统 SHALL NOT 把这两个值当作创建时"初始化"的独立字段——它们始终是从 `RedoAttempt` 集合推导出的只读投影；若实现出于性能保存了缓存，该缓存 SHALL NOT 成为事实源，必须能随时从 `RedoAttempt` 集合重建。

**`RedoAttempt` 模型**：每条记录包含：
- `originalResult`（已改正 | 仍然做错）——创建后不可变；
- `completedAt`——不可变；
- `correctionWorksheetId`（可选）——不可变；
- `correctionAudit[]`——始终存在的 append-only 集合，可以为空；每条纠正事件含 `correctionRequestId`、`fromResult`、`toResult`、`correctedAt`；
- `effectiveResult`——只读投影：`correctionAudit` 为空时等于 `originalResult`；否则等于最后一条 `correctionAudit` 的 `toResult`。

不使用"直接更新 `result` 字段"这种设计，也不使用"第一次纠正用单独字段、多次后才切换为数组"这种随纠正次数变化 schema 的设计——始终统一用 `correctionAudit[]` 表示纠正历史，避免事实源随情况变化。

`currentReviewStatus` SHALL 从最新一条 `RedoAttempt` 的 `effectiveResult`（不是 `originalResult`）推导；无记录时为"尚未检查"。`redoCount` = `RedoAttempt` 记录数量（纠正事件不计入）。

- 只有家长或孩子明确提交一次重做结果时，系统才创建一条新的 `RedoAttempt` 记录。每次提交 SHALL 携带一个 `redoSubmissionId`：同一个 `redoSubmissionId` 的重复请求 SHALL 只创建一条 `RedoAttempt`；两次**真实**的重做——即使结果相同——SHALL 使用不同的 `redoSubmissionId`，因此 SHALL 各自创建一条记录（`redoCount` 相应增加两次）。提交携带 `correctionWorksheetId` 时，服务端 SHALL 在创建记录前校验：该 `CorrectionWorksheet` 确实包含这道 `ErrorQuestion`、两者归属同一个 Child、发起请求的调用者对该资源有权访问；任一校验失败 SHALL 拒绝该请求，SHALL NOT 直接信任客户端提供的任意 id。

**纠正误标记**：家长或孩子可以纠正该错题**最新一条** `RedoAttempt` 的当前有效结果——具体做法是向其 `correctionAudit[]` 追加一条新的纠正事件（`fromResult` = 纠正前的 `effectiveResult`，`toResult` = 纠正后的值），SHALL NOT 修改 `originalResult`、`completedAt`、`correctionWorksheetId`，SHALL NOT 触碰更早的 `RedoAttempt`，SHALL NOT 新建一条 `RedoAttempt`（`redoCount` 不变），SHALL NOT 触发新的错因分析或改变 `aiSuggestionSnapshot`/`confirmedCause`。纠正 SHALL NOT 记录操作者角色。

纠正请求 SHALL 携带 `correctionRequestId`（同一 id 的重试 SHALL NOT 重复生成审计事件）和 `expectedEffectiveResult`（或等价的乐观并发版本号）——表示提交者认为纠正前的当前有效结果是什么。服务端 SHALL 校验该记录当前的 `effectiveResult` 与 `expectedEffectiveResult` 一致才执行纠正；不一致时（例如一条迟到的旧纠正请求，在此期间该记录已被更新的纠正请求改变）SHALL 拒绝该请求并要求调用方刷新后重试，SHALL NOT 静默按旧的预期状态覆盖回去。若该记录当前的 `effectiveResult` 本身就已经等于目标 `toResult`，重复提交 SHALL 视为成功但 SHALL NOT 产生新的审计事件——但这条"已处于目标结果可 no-op"的规则 SHALL NOT 替代 `correctionRequestId` 去重和 `expectedEffectiveResult` 并发校验，三者共同生效。

- `CorrectionWorksheet` 是重做的可选入口之一，不是创建重做状态的前提；标记为"缺少干净原题"的纯照片错题无法生成订正卷（P1(4)/9.5），但 SHALL 仍完整参与 `RedoAttempt` 的记录、推导、纠正机制。

**重做前展示时机（决定 14）——PDF-backed 与纯照片错题分开处理**：

- **PDF-backed 错题**：支持"直接重做"（应用内展示干净原题，隐藏历史作答证据和错因）与"复习后重做"（先展示历史作答证据和错因）两种应用内入口，二者均为单次重做会话的临时选项。
- **纯照片错题（缺少干净原题）**：系统 SHALL NOT 提供基于干净原题的应用内"直接重做"体验——没有可展示的、不含历史痕迹的题目视图；系统 SHALL NOT 通过裁剪或遮盖笔迹来伪造一个"干净"版本呈现给用户（当前 MVP 不具备这项能力）。用户仍可选择：(a) 在应用外的材料上实际重做后，直接从题库详情页提交结果；或 (b) 先查看现有照片和错因（等同于"复习后重做"）再重做并提交。界面 SHALL 明确提示"缺少干净原题，无法提供无历史痕迹的题目视图"。纯照片错题仍完整参与 `RedoAttempt` 状态记录，只是应用内题目展示能力降级，不影响其重做/纠正数据模型。

提交本次重做结果后，系统 SHALL 自动解除对历史作答证据和历史错因的默认隐藏（若之前处于隐藏状态），页面可同时展示本次结果与历史内容——这 SHALL NOT 被表述或实现为"历史作答与本次作答的比较"：系统只保存本次的人工判定结果，不采集、不虚构本次重做后的新作答内容。

**与 D17 的关系**：本决策不修改 `aiSuggestionSnapshot`/`confirmedCause`，只读取展示；提交或纠正重做结果均 SHALL NOT 触发新的错因分析或改变这两个既有字段。

**范围声明**：不引入重新拍摄订正卷、自动关联题目或 AI 自动判断对错。

**替代方案**：直接更新 `RedoAttempt.result`——已否决，会让"最初提交的是什么"这个原始事实丢失；纠正字段随纠正次数变化 schema（先单字段后数组）——已否决，事实源不应随情况切换形态；纯照片错题假装拥有与 PDF-backed 相同的应用内直接重做体验——已否决，MVP 没有伪造干净原题的能力，不能声称有。

---

### D17: 错因分析——非阻塞 AI 建议，taxonomy v1、本地预检与异步事务边界

**决策**：错因分析是 D5 定义的第三种流转模式（非阻塞 AI 建议 + 可选人工升级），具体机制如下。

**Taxonomy v1**（code 含义固定不变，新增分类须通过新 `taxonomyVersion` 追加，SHALL NOT 静默重分类历史记录）：
- `calculation_error`：计算或运算错误
- `concept_error`：概念理解错误
- `problem_understanding_error`：审题或题意理解错误
- `solution_method_error`：解题方法、公式或步骤选择错误
- `other`：无法合理归入以上类别，SHALL 必须携带非空解释，SHALL NOT 为避免 `other` 而强行归类
- `unavailable` 是分析状态，不是分类，SHALL NOT 携带任何 `primaryCategory`

是否对历史记录重新分析，留待未来单独决定，本决策不预设。

**输入模式**（三种，互斥、覆盖全部可达组合，分别独立评测/校准，不共用阈值）：
1. `clean_question_plus_candidate_evidence_region`——干净原题区域 + 候选上下文作答区域（PDF-backed，D16 未回退）
2. `photo_only_candidate_region`——批改照片上分割出的候选区域，无干净原题区域（无 PDF 降级路径，P1(4)）
3. `full_photo_fallback`——干净原题区域仍存在，作答证据回退为整张照片（PDF-backed，D16 已回退）

**输入预检——必须在本地可信环境完成**：调用 AI Provider 之前，系统 SHALL 在 Application Runtime 或自托管 Python Processing Service（D11）内完成预检，判断：照片是否模糊/关键内容不可读；作答或批改痕迹是否被遮挡或缺失；`full_photo_fallback` 模式下能否可靠定位目标题目（可复用 D16 已计算的配准可靠性信号，不必重新发明）；输入是否足以同时理解题目和孩子的实际作答。预检 SHALL NOT 调用任何第三方 AI Provider；预检失败时 SHALL NOT 向 Provider 发送任何图片、裁切或文本内容，直接返回 `unavailable`。这条预检本身是确定性/本地判断，跟 D16 的定位一样不是 AI Task Contract 的一部分，是该 Contract 调用前的本地门槛。

**输出与 provenance**：Provider 调用成功且置信度达到该输入模式的校准门槛时，产出 `primaryCategory`（taxonomy v1 code）+ `explanation`（简短自由文本，`other` 时必须非空）+ 内部校准后的置信度/可靠性信号。持久化为 `aiSuggestionSnapshot`，分别记录以下 provenance 字段（不合并成一个含糊的版本号）：`providerModelIdentifier`、`contractVersion`、`taxonomyVersion`、`inputMode`、`generatedAt`、`confidence`（内部校准信号，非 Provider 原始自报分数的直接转发）、`primaryCategory` + `explanation`。

**人工确认**：`confirmedCause` 保存 `category`、`explanation`（SHALL 始终非空，不只是 `other` 时才要求）、`taxonomyVersion`、`confirmedAt`；若该确认源自对某个 AI 建议的确认或修改，SHALL 同时保存 `sourceSuggestionSnapshotId`，指向对应的 `aiSuggestionSnapshot`。家长/孩子修改确认值 SHALL NOT 改变原始 `aiSuggestionSnapshot`，两者始终独立保存。`category` SHALL 按其声明的 `taxonomyVersion` 校验有效性，不接受不属于该版本的 code。`confirmedCause` 一旦存在，SHALL NOT 被后续自动重新分析覆盖；已展示的 `aiSuggestionSnapshot` 同样 SHALL NOT 被自动重新分析静默覆盖或替换（呼应 D6 扩展）。

**异步触发与事务边界**：`ErrorQuestion` 的持久化事务 SHALL NOT 等待错因分析完成。错题的保存、查看、重做、打印 SHALL 独立于错因分析结果，不因分析未开始、进行中、Provider 超时/失败、队列故障或长期不可用而失败或长时间等待。分析作为该持久化事务完成后触发的异步/可恢复任务，具体队列/调度机制留至实现阶段（可用 durable job、transactional outbox、定期 reconciliation 等任一方式实现，本决策不绑定具体队列产品）。`ErrorQuestion` 保存成功后，即使投递该异步任务本身失败（网络中断、进程崩溃等），系统 SHALL 保证该任务最终仍会被触发或被后续 reconciliation 补上，SHALL NOT 因这个时间窗口而永久丢失分析机会。进程崩溃、worker 重启或调用超时后，SHALL NOT 让分析状态永久停留在"进行中"——必须有恢复机制（如超时后转入可重试状态、或由 reconciliation 任务重新拾取）。

**暂时性失败与最终 `unavailable` 的区分**：内部状态机 SHALL 区分"暂时性执行失败"（网络错误、Provider 超时、限流、worker 中断等）与"最终判定为无法给出可靠建议"。暂时性失败 SHALL 进入可重试状态，不得被立即当作语义上的 `unavailable` 记录下来。`unavailable` SHALL 仅在以下情形使用：
(a) 本地预检判定输入不足；
(b) AI 结果置信度低于该输入模式已校准的可靠性阈值；
(c) 按既定重试策略重试耗尽后，仍无法产生可靠建议。

面向家长的展示可以简化为"分析中 / 暂时无法判断 / 已生成建议"（未开始、进行中、可重试中等内部状态在展示上都可归为"分析中"），但内部状态 SHALL 保留足够信息支持恢复和重试判断，不能把这些状态压缩成同一个不可区分的值。

**幂等性**：重复投递、worker 重试或并发执行 SHALL NOT 产生重复的 `aiSuggestionSnapshot`。每次分析尝试 SHALL 携带一个稳定的 attempt/idempotency 标识；迟到或过期的执行结果 SHALL NOT 覆盖已经存在的更新快照，也 SHALL NOT 改变已存在的 `confirmedCause`。

**评测方法（非阻塞轨道专属指标，不复用 bbox/定位类指标，且不能只看单一"precision"数字）**：按三种输入模式分别记录：
- **危险的错误建议比例**：模型给出了看似可靠的建议（未落入 `unavailable`），但该建议与人工标注的参考错因不一致的比例——这是最危险的失败模式（自信地给出错误诊断）。
- **正确建议覆盖率**：给出了与参考错因一致的可靠建议，占全部样本的比例。
- **误判为 `unavailable` 的比例**：本应能给出正确建议、却被系统判为 `unavailable` 的比例（错失机会）。
- **最终 `unavailable` 比例及原因分布**：整体 `unavailable` 占比，以及分别来自"预检拦截""置信度不足""重试耗尽"三类原因的占比。
- `explanation` 是否忠实于题目和实际作答内容，是否编造不存在的解题步骤（幻觉检查）。
- 结构化输出成功率（是否符合 taxonomy code + 字段结构）。
- 覆盖率、延迟、成本、失败/重试行为。

参考错因 SHALL 由人根据题目和孩子实际作答标注，SHALL NOT 用模型自身置信度当 ground truth。阈值继续留待真实标注集校准，不在此编造数值。

**置信度/可靠性信号的校准**：Provider 自报的分数（如有）SHALL NOT 直接当作可信的最终置信度；系统 SHALL 用人工标注样本，按三种输入模式分别校准"suggested vs unavailable"的判定门槛。若 Provider 不提供可校准的置信度信号，Application 可基于评测结果自行构造可靠性判定（如输出一致性、复现率等代理指标），但 SHALL NOT 伪造一个看似精确的概率数字。某输入模式的门槛尚未建立、或实测结果不可靠时，该模式一律返回 `unavailable`。

**非阻塞轨道的 Provider 治理**：错因分析表现差不否决其他正式 Gate 判据（D13 现为三项：整页题目分割 `full_page`+PDF-render 模式、知识点标签、题型分类），也不阻止 MVP 交付——但走该轨道的 Provider 仍须满足官方支持、实际出站可达、结构化 Contract 输出合规、隐私最小输入等硬约束（呼应 D13 的通用治理原则）。某输入模式下没有满足这些约束的可靠候选时，该模式保持 `unavailable`，SHALL NOT 为了"声称功能存在"而选择无法稳定遵守 Contract 的 Provider。

**最小必要输入**：存在候选作答区域时，仅发送干净原题区域（若存在）和该候选区域；SHALL NOT 额外发送整张照片或整份 PDF 页面。仅 `full_photo_fallback` 模式、且预检确认目标题目可靠可定位时，才发送整张照片；预检认定无法可靠定位时，在调用前直接返回 `unavailable`（呼应上方预检条款）。

**范围声明**：MVP 是否提供主动重新分析入口尚未决定，本决策不预先假定存在；是否对历史记录进行重新分析同样留待未来单独决定。

---

### D19: PDF 类型检测——可追溯检测记录驱动分层切题验收范围，非断言式 UI

**决策**：`WorksheetArchive` 上传后，系统在本地异步检测其 PDF 类型，产出 `digital_native` / `scanned` / `unknown` 三态判定，供区域定位契约的分层验收（见下）和 UI 提示使用。检测不阻塞上传本身。

**检测记录模型（可追溯，非单一可变字段）**：`WorksheetArchive` 持有一个 append-only 的 `PdfTypeDetectionAttempt[]` 集合。

- 每次新的检测或重新检测 SHALL 创建一条新的 attempt；已有 attempt SHALL NOT 被删除或被新结果覆盖。
- 单条 attempt 的合法状态迁移仅有两条：`pending → completed`、`pending → failed`；两者均为终态，到达终态后该 attempt 的终态字段（`detectedInputType`、终态达成时间、`failureReason` 等）SHALL NOT 再被修改。
- `failed` 后的重试 SHALL 创建一条新的 attempt，SHALL NOT 将旧的 `failed` attempt 改回 `pending` 复用。
- "append-only"修饰的是 attempt 集合与已达终态的历史记录，不是说单条 attempt 永远停留在 `pending`——单条 attempt 完成从 `pending` 到终态的一次性迁移是模型允许的正常行为。
- 每条 attempt 至少含：`attemptId`（稳定标识）、`status`（pending/completed/failed）、`detectedInputType`（仅 completed 时有值）、`detectionVersion`、`createdAt`、终态达成时间、可选 `detectionBasis`/`confidence`、`failureReason`（仅 failed）。
- 是否需要更细粒度的内部事件审计（状态迁移时间线等）留至实现阶段内部决定，本决策不绑定具体 event-store 方案；对外只承诺 `PdfTypeDetectionAttempt[]` 这层粒度的可追溯性。

**当前生效判定**：系统 SHALL 取按创建时间排序的**最新一条** attempt 判定当前有效状态：

- 最新 attempt 为 `completed` → 当前有效类型 = 该 attempt 的 `detectedInputType`；
- 最新 attempt 为 `pending` 或 `failed` → 当前有效类型 = `unknown`——即使存在更早的 `completed` attempt，也 SHALL NOT 跳过这条更新的 pending/failed 状态去复用旧结果；
- 不存在任何 attempt → 当前有效类型 = `unknown`。

历史 `completed` attempt 始终保留、可查询，用于追溯"某检测版本下曾判定为何种类型"，但 SHALL NOT 被用来绕过更新的、仍处于 pending/failed 的检测状态而继续激活 `digital_native` 专属分支。

**职责边界**：PDF 结构/文字层提取、页面图像分析、字体与矢量对象检测、逐页一致性分析等检测逻辑 SHALL 完全归属 D11 Python PDF Processing Service。Next.js 只负责触发检测任务、持久化/读取 `PdfTypeDetectionAttempt[]`、渲染 UI 提示，SHALL NOT 自行实现任何 PDF 结构判断逻辑。

**Fail-closed 判定原则**：

- 只有满足已校准并针对当前 `detectionVersion` 冻结的充分证据时，检测器才输出 `digital_native`；
- 信号不足、矛盾、混合，或证据强度低于已冻结阈值时，检测器 SHALL 输出 `unknown`；
- 检测器评测 SHALL 记录 confusion matrix（人工真值 × 检测输出）；
- `scanned/mixed-or-ambiguous`（人工真值）→ `digital_native`（检测输出）这一格 SHALL 被单独标记为最高风险误判类别，是 calibration 阈值选择的首要约束目标；
- 具体阈值/误判率由人工标注 calibration set 校准后冻结，本决策不编造数值。

**检测器自身的 calibration/held-out**：

- 人工真值标签仅三类：`digital_native`、`scanned`、`mixed-or-ambiguous`；`mixed-or-ambiguous` 描述文件客观上具有的混合/矛盾信号特征，是人工可标注的文件特征类别；`unknown` 是检测器的**输出状态**，SHALL NOT 被用作人工真值标签。
- 拆分为 calibration 子集（确定并冻结某 `detectionVersion` 的阈值）+ 独立 held-out 子集（评估最终分类效果、产出 confusion matrix），两者不复用同一样本。
- `detectionVersion` 与其阈值 SHALL 在 held-out 评估运行前冻结；held-out 结果 SHALL NOT 触发同版本内的反复调参——需要调整时 SHALL 产出新的 `detectionVersion`，重新走 calibration → 冻结 → held-out 流程。

**mixed/ambiguous 的双重评测角色**：mixed/ambiguous 在生产环境按 `unknown` 保守处理。在评测中承担两个独立目的：

1. 检测器自身的 confusion matrix 评测（上一条）；
2. 作为整页题目分割（`full_page`，PDF-render 模式）的一个独立探索性子集，实际运行该模式并记录与 scanned 子集相同的指标（漏框率、框不准率、false-positive、duplicate/over-segmentation、merge-error）、逐份失败情况、以及是否触发"单份崩盘"判定——不能只收集样本观察检测器行为而不运行分割。该子集结果不进入 digital_native 正式 Gate 的通过/否决判定。数据集 B 的 mixed/ambiguous 子集 SHALL 复用数据集 A 的 PDF 资产，但 SHALL NOT 默认其已满足整页分割评测所需的标注——只有在另行补齐整页题目分割专属的人工 ground truth（页面上**全部**真实题目及其正确边界、每道题的必要内容完整性判断依据、false-positive 判定依据、duplicate/over-segmentation 判定依据、merge-error 判定依据、逐份 PDF 的崩盘判断依据）后，才能将该 PDF 纳入数据集 B 的 mixed/ambiguous 子集评测。

**区域定位与整页题目分割的指标定义**（D19/6.2/6.3 三处共用，不得各自变体）：

*区域定位*：
- 漏框率——指定目标题号未能产生可用 bbox 的比例；
- 框不准率——产生了 bbox，但题干/选项/公式/表格/图形等必要内容缺失，或 bbox 明显切入相邻题目的比例；多余空白本身可接受，不计入框不准。

*整页题目分割*：
- 漏框率——人工标注的真实题目中，没有任何候选框覆盖到的比例；
- 框不准率——有候选框但必要内容不完整、或明显切入相邻题目的比例；
- false-positive/spurious-box rate——框出实际不存在题目的比例；
- duplicate/over-segmentation rate——同一题目被重复/过度切分的比例；
- merge-error rate——多道题目被合并进同一个框的比例。

**单份不崩盘**：digital_native 正式轨道在 calibration 阶段冻结：整体漏框率/框不准率通过阈值；"正常清晰样本"的资格定义；单份 PDF"崩盘"的判定规则（具体数值不在本决策编造，calibration 阶段确定）。held-out Gate SHALL 同时验证：(a) 整体指标达标；(b) 没有任何符合资格的单份 digital_native PDF 触发崩盘判定。scanned、mixed-or-ambiguous、纯照片三条探索轨道只记录各自的逐样本崩盘情况用于观察，SHALL NOT 构成本 Gate 的正式否决依据。

**样本集结构**（四个命名数据集）：

- **A — PDF 类型检测器数据集**：人工真值 `digital_native`/`scanned`/`mixed-or-ambiguous`；calibration + held-out。
- **B — 整页题目分割数据集（`full_page`，PDF-render 模式）**：`digital_native` 子集（calibration + held-out，正式 Gate）；`scanned` 子集（探索，同一套指标）；`mixed-or-ambiguous` 子集（探索，复用 A 的 PDF 资产但须另行补齐整页分割专属 ground truth，见上）。标注内容为页面上**全部**真实题目清单 + 每道题的正确边界 + 内容完整性判断依据 + false-positive/duplicate/merge-error 判定依据 + 单份崩盘判定依据（与旧的"单一目标题号+单一边界"标注不同，不是简单更名沿用）。`QuestionBoxNumberAssociation`（见 D20/task 3.7）可复用本数据集的 PDF 与题目框资产，但须另行补齐每个框对应的人工题号标签；无题号或题号不规则的样本保留为该任务自身的 `unavailable`/`ambiguous` ground truth，不得排除。
- **C — 整页题目分割数据集**：批改照片，探索性；样本单位为一张照片；须由人工标注该照片上的全部真实题目及其正确边界，才能计算漏框率、框不准率、false-positive/spurious-box rate、duplicate/over-segmentation rate、merge-error rate 这五项指标。
- **D — Cross-page / out-of-scope 压力测试集**：单独收集，不进入任何正式 Gate 判定；A–C 不要求覆盖跨页情形。

**UI 展示原则**：分类是内部记录，不要求向家长暴露 `detectedInputType`/`detectionVersion`/`confidence` 等技术细节。产品 UI 仅需：

- 当前有效判定为 `pending`（即最新 attempt 为 pending）→ "正在分析文档，自动切题暂按尽力而为处理"；
- 当前有效判定为 `unknown`（含 failed、无 attempt、或最新 attempt completed 但 detectedInputType=unknown）→ "暂时无法确认文件类型，自动切题将按尽力而为处理"；
- 当前有效判定为 `scanned` → "系统检测该文件可能为扫描版，自动切题将按尽力而为处理"；
- 当前有效判定为 `digital_native` → 无需额外技术提示。

所有提示 SHALL 使用非断言措辞，SHALL NOT 将自动检测结果表述为用户已确认的事实。

**异步可靠性**：检测 SHALL 异步执行，不阻塞上传完成；检测任务 SHALL durable/可重试；重复触发 SHALL 幂等（不产生重复的进行中检测）；进程中断 SHALL NOT 导致某条 attempt 永久停留在 `pending`（需超时转可重试或由 reconciliation 拾取并创建新 attempt，具体队列产品不指定）；`failed` SHALL 可重试（产生新 attempt）。当前有效判定为 `pending`/`unknown` 期间，系统 SHALL NOT 让该 WorksheetArchive 进入 `digital_native` 专属的正式产品分支。

**Scope 范围**：本决策定义的分层验收，作用于**整页题目分割契约的 `full_page` + PDF-render 输入模式**在 PDF-backed 路径下的评测方法论（P1(11) 定案后，该模式取代区域定位成为 PDF-backed 路径的正常识别/定位机制，见 D20）。错题识别、知识点标签/题型分类不按本决策拆分；整页题目分割的批改照片输入模式继续按 P1(4)/D15 既有的探索轨道评测；区域定位降级为定向修复后不再是本决策分层验收的对象，其自身评测方法见 D13 修复支持轨道。这不代表这些流程完全不受扫描质量影响，只代表它们不属于本决策的分桶范围。

**归属**：检测本身是确定性/启发式判断，非 AI Task Contract，不适用 D13 Selection Gate。

本决策全部落地后，P2(4)（`specs/worksheet-archive/spec.md` 未区分 PDF 类型）并入本 Decision，关闭为 Consistent。

---

### D20: PDF-backed 路径的整页分割主入口、预高亮增强与定向修复语义

**决策**：有 PDF 主路径下，错题识别与题目区域确定的正常入口是"整页题目分割（`full_page` 模式，PDF-render 输入）+ 用户点选/取消选择"，不是"错题识别产出题号列表 + 逐题区域定位"。这是 MVP 的正式主流程与最低成功标准（P1(11) 定案）。

**主流程**：
1. D14 完成批改照片↔PDF 页面确认；
2. 对已确认页面渲染运行整页题目分割 `full_page` 模式，产出该页全部题目框；
3. 家长通过点击/取消点击这些框确定错题集合；家长明确确认后的框集合才成为已确认业务事实（沿用 D6 通用原则）。

**两种 invocation mode 的判别式接口**（避免实现方无法区分"全页结果"与"局部补框结果"）：

```
full_page:
  Request:  { image }              // 批改照片 或 已确认的 PDF 页面渲染
  Response: { mode: "full_page", candidates: QuestionBoxCandidate[] }  // 可为空数组，不为 null

locality_retry:
  Request:  { image, hint: approximatePoint | regionHint }
  Response: { mode: "locality_retry", candidate: LocalRepairCandidate | null }  // 零个或一个
```

两种响应类型 SHALL 在实现层判别式区分（如带 `mode` 标签的联合类型），不得共用同一个未加区分的列表形状。**正式 Gate 只评 `full_page` + PDF-render 输入的原始输出；`locality_retry` 模式单独作为修复能力评测，不混入原始 Gate 分数**（见 D13/D19）。

**`full_page` 空结果的语义——不是批次终态**：对 PDF-render 输入，`full_page` 返回空列表或结果不可靠时，SHALL NOT 被视为整批/整页不可用的终态，也 SHALL NOT 静默转入任何 fixture、题号列表或手动画框。系统 SHALL 明确展示"整页自动分割不可用"提示，并保留家长通过点击题目大致位置逐题触发修复调度（见下）的能力——即使起点是零个候选框，家长仍可逐题点击建立错题集合。只有当某道题在其自身的修复调度（区域定位/`locality_retry`）耗尽后仍无法生成可靠框时，才将**该题**标记为"未解决"；其余题目不受影响，家长可继续确认已成功的题目。

**AI 预高亮是非阻塞增强，不是正常流程的硬依赖**：
- 错题识别继续分析批改照片，产出候选题号（非权威信号，见 D5 第三类）；
- 新增确定性步骤 `QuestionBoxNumberAssociation`（归属 D11，非 AI Task Contract，不调用第三方 Provider）：
  - 输入：该 PDF 页面的文字层/结构信息 + 整页分割 `full_page` 模式产出的题目框集合；
  - 输出：每个框一条记录 `{boxId, questionNumberCandidate?, associationStatus: reliable | ambiguous | unavailable, associationVersion, evidence?, confidence?}`；
  - 数字原生 PDF 优先使用文字层与文字位置信息；scanned/mixed/unknown 可尽力而为使用本地 OCR 或结构信号，不作为正式承诺；
  - 仅当某题号的关联结果满足：`reliable` 且一对一（该题号只关联到一个框，该框也只关联到该题号，无重复/无冲突）时，才允许驱动预高亮；重复题号、无题号、多框争用同一题号、一框匹配多题号，或置信度不足，均 SHALL NOT 预高亮相关框；
  - 关联结果 SHALL 仅是候选信号，SHALL NOT 视为已确认业务事实；
  - `associationVersion` 与阈值的冻结/校准规则沿用 D19 已建立的 calibration→冻结→held-out 模式（具体任务见 task 3.7）。
- 满足以上条件时，将错题识别猜测的题号与该关联结果匹配，对应框展示为"AI 建议选中"（非断言 UI 用语，如"AI 猜测可能做错"），SHALL NOT 视为已确认事实。
- 家长 SHALL 明确确认最终选中的框集合，无论是否存在预高亮。
- 错题识别失败、结果为空、题号无法关联，或关联置信度不足时，系统 SHALL 直接退化为纯点选（无预高亮），SHALL NOT 阻塞流程，SHALL NOT 退回要求家长编辑题号列表作为正常入口。

**预高亮的页面级前置信号——不依赖 D16 的执行时序**：D16 只服务于**已确认**题目区域到照片作答证据区域的映射，发生在单题确认之后，职责不变，本决策不改变它。预高亮发生在任何单题被确认之前，因此本决策使用的是一个独立的**页面级**配准可靠性/版式一致性信号——可复用 D11 已有的配准能力（与 D16 底层算法同源），但在预高亮场景下作为页面级、confirmation 前即可获得的信号单独调用（具体实现任务见 task 3.8），不依赖任何单题区域已被确认这一前提，也不依赖 D16 Requirement 本身已执行。当该页面级信号不足，或 `QuestionBoxNumberAssociation` 的关联结果存在冲突/不唯一时，系统 SHALL 关闭预高亮，仅展示全部 `full_page` 分割框供家长点选，并提示"系统无法可靠匹配批改标记，请手动确认做错的题目"，SHALL NOT 静默高亮任何框。该信号 SHALL 依赖 D14 已确认的页面对应关系，SHALL NOT 依赖 D16 已执行。

**区域定位降级为定向修复（已知题号场景）**：
- 触发条件：错题识别给出某题号的可靠猜测，且 `QuestionBoxNumberAssociation` 未能为该题号找到对应框（即整页分割疑似漏掉了该题）；
- 系统可对该题号调用区域定位（输入不变：PDF 页面渲染 + 目标题号），尝试补出候选框；
- 补出的框仍需家长确认，不自动加入已确认集合；
- 区域定位 SHALL NOT 再作为每道错题的默认/正常路径，仅在缺框修复场景下触发。

**整页题目分割新增局部重试模式（未知题号场景）**：
- 覆盖"家长发现某处漏框，但系统未必知道对应题号"的情况；
- 通过 `locality_retry` 模式实现（见上方判别式接口）；给定大致位置 hint，系统尝试在该位置附近重新分割/补出一个候选框，遵循 D15 已确立的"不要求家长从零手画完整边界"原则；
- 该模式对 PDF-render 输入与既有的批改照片输入均适用（PDF-backed 与无 PDF 路径复用同一套局部重试语义，仅输入源不同）；
- 若局部重试仍失败，系统 SHALL 将该题标记为"未解决"，SHALL NOT 阻止家长继续处理其余错题（沿用 D15 既有失败语义）。

**漏框修复调度顺序——题号与点击位置必须空间相符**：家长点击遗漏题目的大致位置后：
1. 系统检查是否存在**唯一**一个 `reliable` 且尚未匹配到 `full_page` 结果中任何框的题号；
2. 若存在唯一缺号，系统进一步判断该题号的文字位置/关联证据（`QuestionBoxNumberAssociation` 的 `evidence`）与预计区域，是否与家长点击的 `approximatePoint`/`regionHint` **空间相容**，且该相容判断达到已校准的可靠性标准（可复用上方页面级配准信号，具体阈值同样通过人工标注样本校准冻结，不在此编造数值）；
3. 只有当步骤 1（唯一缺号）与步骤 2（空间相容且达标）**同时满足**，系统才优先调用区域定位（该题号 + 已确认 PDF 页面渲染）尝试补出候选框；
4. 任一条件不满足（无唯一缺号，或题号存在但与点击位置不相容/相容判断未达标），系统 SHALL 直接调用 `locality_retry`（该点击位置 + hint），SHALL NOT 仅凭"全页只剩一个已知缺号"就忽略点击位置直接触发区域定位；
5. 区域定位调用失败/结果不可用时，也可继续调用 `locality_retry`；
6. 两种机制产生的都只是候选框，SHALL 仅供家长确认，SHALL NOT 自动写入最终选中/已确认集合；
7. 系统 SHALL NOT 仅因为"错题识别给出了某个题号"或"全页只剩一个缺号"就直接调用区域定位——必须同时满足唯一缺号与空间相容两个条件。

**按失败原因区分的恢复选项**：单题修复（区域定位/`locality_retry`）耗尽仍失败时，系统 SHALL 根据可能原因提供对应的恢复入口，而不是笼统建议"更换照片"：
- **重试**：始终可用——家长可再次点击同一位置，重新触发修复调度。
- **重新选择 PDF 页面**：当怀疑 D14 确认的页面本身对应错误时可用——引导家长重新执行页面确认。
- **更换/重拍批改照片**：仅当问题源于批改照片本身的质量（模糊、与页面匹配失败、影响预高亮或后续 D16 作答证据提取）时展示——SHALL NOT 被描述或暗示为修复纯 PDF `full_page`/`locality_retry` 分割失败本身的办法（PDF 页面渲染是确定性输入，重新上传同一份 PDF 不会改变分割结果）。
- 以上均 SHALL NOT 提供从零手绘完整边界的入口。

**持久化与确认语义**：家长确认后的框集合 SHALL NOT 被后续任何自动重新分割、重新关联或 AI 重算静默覆盖（沿用 D6/D16 已有原则）。

**归属澄清**：D14 仅解决"批改照片对应哪一页 PDF"；D16 仅解决"已确认题目区域→照片作答证据区域"的空间映射，且发生在预高亮之后；两者均不覆盖"整页分割产出的框→题号"这一对应关系，也不覆盖"预高亮前的页面级一致性判断"，因此 `QuestionBoxNumberAssociation` 与本决策的页面级前置信号都是新增能力，不是复用既有机制冒充。

**范围声明**：本决策关闭 P1(11) 的开放问题，确定有 PDF 主路径统一采用整页分割为正常入口；纯照片路径的既有失败语义（D15）不变，仅其"整页题目分割"契约的局部重试模式定义被本决策进一步明确（对两条路径通用）。Group 4/7 的具体任务编排留给 P1(10)。

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
3. Auth 配置完成：短信 OTP（阿里云 PNVS）已确定；Email OTP Selection Gate（D12）已执行并选定实现；预配置邮箱/手机号已录入 allowlist（User 记录由首次 OTP 登录自动创建；Child 档案通过 child-profile onboarding 在首次登录后由用户创建，不由登录流程静默生成，也不作为手工部署前置项）
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
