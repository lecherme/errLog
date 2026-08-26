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

### D1: 应用架构——Node.js + Next.js App Router 模块化单体

**决策**：采用 Node.js + Next.js（App Router）全栈单体，单一部署单元。内部维持清晰模块边界，至少区分：

- **UI / Web**：Next.js App Router 路由、Server Components、Client Components、Route Handlers、Server Actions
- **Domain / Business Logic**：核心业务规则和工作流
- **PDF Processing**：PDF 页面渲染为图片、题目区域裁切、订正卷 PDF 组装；PDF 处理逻辑不散落于 Web / API 层，仅通过明确接口被 Domain / Business Logic 层调用
- **Auth**：身份验证，Provider SDK 调用收拢于此
- **Storage**：文件资产读写，Provider SDK 调用收拢于此
- **AI Integration**：AI Task Contract 实现，模型调用收拢于此
- **Persistence**：数据读写，数据库 SDK 调用收拢于此

**理由**：MVP 规模不需要微服务复杂度；模块边界的目标是避免核心业务代码直接耦合具体基础设施 Provider，而不是现在就拆成独立服务。Node.js 生态（`pdfjs-dist`、`sharp`、`pdf-lib` 等）可满足当前 Spec 要求的 PDF 操作；AI 集成基于外部 API，Node.js SDK 已足够。

**演化路径**（非 MVP 目标）：若 PDF Processing 或 AI Integration 因性能瓶颈、异步任务需求或 Python 生态优势需要独立部署，可沿现有模块边界将其提取为独立服务；这是可演化路径，当前不实施。

**替代方案**：独立 API 服务 + SPA 前端。更灵活，但 MVP 阶段增加了跨进程部署和认证 session 共享的配置复杂度。

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

## Risks / Trade-offs

- **AI 识别准确率**：批改风格不统一影响错题识别结果。→ 人工确认是强制节点，不依赖 AI 输出正确。
- **PDF 渲染一致性**：不同工具生成的 PDF 内部结构差异大，区域裁切效果可能不稳定。→ 人工边界修正提供兜底。
- **多照片与 PDF 页面对应**：多张批改照片与 PDF 多页的对应在复杂排版下容易出错。→ MVP 阶段将对应关系确认保留为人工步骤，AI 仅做推荐。
- **原始资产保护**：备份机制属于基础设施层决策，若实现阶段未正确配置隔离，原始资产存在误删风险。→ 部署阶段须验证备份路径与应用部署流程相互独立。
- **Generation Snapshot 完整性**：若快照信息记录不完整，无法保证重新生成结果的语义一致性。→ 实现阶段须明确 snapshot schema，并在首次生成时完整记录所有排版决策依据。

## Migration Plan

全新应用，无存量数据迁移。初次部署须满足：

1. 对象存储 Provider 配置完成，具备独立于代码部署的访问权限
2. 原始资产备份路径已配置，并与应用部署流程验证相互隔离
3. Auth Provider 配置完成，预配置邮箱 / 手机号已录入
4. 数据库初始化，初始 User 和 Child 记录已创建
5. AI API 连通性已验证

## Open Questions

- Auth Provider 选型（邮件 / 短信服务商）：实现阶段决定
- 对象存储 Provider 选型：实现阶段决定
- Database Provider 选型：实现阶段决定，PostgreSQL 优先
- AI 模型选型：实现阶段决定
- PDF 页面渲染库：实现阶段决定
- UI 组件库：实现阶段决定
- Generation Snapshot 的具体 schema：实现阶段决定
- 题库浏览与管理界面是否纳入 MVP：待后续 change 决定
