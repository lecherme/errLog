## Purpose

管理家庭账号下的孩子档案及 currentChildId 上下文，确保需要 Child 归属的学习数据按照各自绑定规则明确归属具体孩子，且归属不受后续 currentChildId 切换影响。

## ADDED Requirements

### Requirement: 孩子档案的创建与 onboarding
认证用户首次进入应用时，若尚无任何孩子档案，系统 SHALL 引导用户创建至少一个孩子档案，且在创建前 SHALL NOT 允许进入需要孩子归属的功能（批改流程、题库、订正卷）。

#### Scenario: 首次登录且无孩子档案
- **WHEN** 认证用户首次进入应用且尚无任何孩子档案
- **THEN** 系统引导创建第一个孩子档案，创建完成前不能进入需要孩子归属的功能

#### Scenario: 已有孩子档案时跳过引导
- **WHEN** 认证用户登录且已存在至少一个孩子档案
- **THEN** 系统不展示创建引导，直接进入应用

### Requirement: 默认使用当前孩子，无需重复选择
系统 SHALL 为每个 User 维护 `currentChildId`，登录后默认使用上次使用的孩子，不要求用户在每次操作前重新选择。`currentChildId` 仅在用户主动新建或切换孩子档案时改变。

#### Scenario: 默认进入上次使用的孩子
- **WHEN** 已有孩子档案的用户再次登录
- **THEN** 系统默认选中上次使用的孩子，不要求用户重新选择

#### Scenario: 未主动切换时当前孩子保持不变
- **WHEN** 用户在同一或跨设备的多次操作中未执行新建或切换孩子的动作
- **THEN** `currentChildId` 保持不变

### Requirement: 新建与切换孩子档案
用户 SHALL 能够在现有孩子档案基础上新建第二个及以上孩子档案；新建的孩子档案 SHALL 成为当前孩子。存在多个孩子档案时，系统 SHALL 提供简单的列表和切换入口。

#### Scenario: 新建第二个孩子档案
- **WHEN** 用户在已有至少一个孩子档案的情况下新建一个孩子档案
- **THEN** 系统创建新的孩子档案并将其设为当前孩子

#### Scenario: 多孩子时切换当前孩子
- **WHEN** 存在多个孩子档案的用户从列表中选择另一个孩子
- **THEN** 系统将该孩子设为 `currentChildId`

### Requirement: 孩子档案不等同于独立登录身份
孩子档案 SHALL 仅用于业务数据归属，SHALL NOT 具有独立的登录凭证或认证身份。MVP SHALL NOT 实现孩子档案的独立登录/OTP、删除、合并或家庭成员邀请等能力。

#### Scenario: 孩子无需独立登录即可被操作
- **WHEN** 家庭账号下的任何使用者标记孩子相关的数据或状态
- **THEN** 系统不要求该使用者以孩子身份单独登录或认证

### Requirement: GradingSession 创建时绑定当前孩子
`GradingSession`（批改任务）在创建时 SHALL 从 `currentChildId` 读取一次并绑定归属，该归属 SHALL 在创建后保持不变，不因 `currentChildId` 后续变化而改变。

#### Scenario: 批改任务创建时绑定当前孩子
- **WHEN** 用户在 `currentChildId` 指向某个孩子的情况下创建一次批改任务
- **THEN** 系统将该批改任务归属该孩子，并持久化该归属

#### Scenario: 切换当前孩子不影响已创建批改任务的归属
- **WHEN** 某次批改任务创建之后，用户切换了当前孩子
- **THEN** 该批改任务的归属保持为创建时绑定的孩子，不随后续切换改变

### Requirement: ErrorQuestion 继承所属批改任务的孩子归属
`ErrorQuestion`（错题）的孩子归属 SHALL 完全继承自其所属 `GradingSession`，创建或提交时 SHALL NOT 读取 `currentChildId`。

#### Scenario: 错题继承批改任务的孩子归属
- **WHEN** 批改任务完成确认并保存错题
- **THEN** 每道错题归属其所属批改任务创建时绑定的孩子

#### Scenario: 提交时当前孩子已切换，错题归属仍不变
- **WHEN** 批改任务创建后、错题提交前，用户切换了当前孩子（可能又切回）
- **THEN** 保存的错题仍归属该批改任务创建时绑定的孩子，与提交那一刻的 `currentChildId` 无关

### Requirement: CorrectionWorksheet 的孩子归属从错题集合推导
`CorrectionWorksheet`（订正卷）的孩子归属 SHALL 从生成时所选的 `ErrorQuestion` 集合推导：集合内所有 `ErrorQuestion` 的孩子归属 SHALL 一致，订正卷归属该一致的孩子；生成时 SHALL NOT 读取 `currentChildId`。若所选集合包含归属不同孩子的错题，系统 SHALL 拒绝生成。

#### Scenario: 订正卷归属从错题集合推导，不受当前孩子切换影响
- **WHEN** 用户选择一组同属一个孩子的错题生成订正卷，且生成那一刻 `currentChildId` 已经切换到另一个孩子
- **THEN** 订正卷仍归属该组错题共同所属的孩子，与生成时的 `currentChildId` 无关

#### Scenario: 混合不同孩子的错题被拒绝
- **WHEN** 用户选择的错题集合包含归属不同孩子的错题
- **THEN** 系统拒绝生成订正卷

### Requirement: 原始 PDF 档案家庭级共享，不因当前孩子上下文获得孩子归属
`WorksheetArchive`（卷子档案）SHALL 保持 User 级家庭共享，SHALL NOT 因某次上传或使用时的 `currentChildId` 而获得孩子归属，可被同一 User 下不同孩子的 `GradingSession` 复用。

#### Scenario: 同一份 PDF 档案被不同孩子复用
- **WHEN** 两个不同孩子的批改任务都选择了同一份已上传的 PDF 卷子档案
- **THEN** 系统允许两次复用，该 PDF 档案不因任一孩子的使用而被视为专属于该孩子

### Requirement: 当前孩子指针的归属与有效性
系统 SHALL 保证 `currentChildId` 始终指向该 User 自己拥有的 Child，SHALL NOT 允许将其设置或提交为其他 User 拥有的 Child。首个孩子档案创建完成后 SHALL 立即成为当前孩子，无需额外操作。只要该 User 拥有至少一个 Child，`currentChildId` SHALL 始终指向一个有效（属于该 User 且存在）的 Child。创建 `GradingSession` 时，服务端 SHALL 重新校验待绑定的 childId 确实归属发起请求的 User，SHALL NOT 直接信任客户端提交的 childId。

#### Scenario: currentChildId 必须归属本人
- **WHEN** 系统为某 User 设置或读取 `currentChildId`
- **THEN** 该值必须指向该 User 自己拥有的 Child，不能指向其他 User 的 Child

#### Scenario: 拒绝提交其他 User 的 Child ID
- **WHEN** 客户端提交的 childId 不属于发起请求的 User
- **THEN** 系统拒绝该请求，不创建或修改任何数据

#### Scenario: 首个孩子创建后立即成为当前孩子
- **WHEN** 用户创建第一个孩子档案
- **THEN** 该孩子档案立即成为当前孩子，无需额外的切换操作

#### Scenario: 已有孩子时 currentChildId 必须有效
- **WHEN** 某 User 已拥有至少一个 Child
- **THEN** 该 User 的 `currentChildId` 始终指向一个属于该 User 且存在的有效 Child

#### Scenario: 服务端重新校验批改任务的孩子归属
- **WHEN** 客户端发起创建 GradingSession 的请求
- **THEN** 服务端重新验证该请求对应的 childId 确实归属发起请求的 User，而不是直接信任客户端提交的值
