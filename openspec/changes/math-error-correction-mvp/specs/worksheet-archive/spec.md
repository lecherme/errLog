## Purpose

管理家长上传的原始 PDF 试卷档案，作为批改流程的 PDF 来源库。家长在打印试卷时将 PDF 存入档案，批改时再从档案中选取对应的卷子。

## ADDED Requirements

### Requirement: 上传并命名卷子档案
家长 SHALL 能够上传原始 PDF 文件并为其指定名称，系统 SHALL 记录上传时间并建立卷子档案。

#### Scenario: 成功上传卷子档案
- **WHEN** 家长上传一份 PDF 文件并提供名称
- **THEN** 系统创建卷子档案，记录名称和上传时间，档案在列表中可见

#### Scenario: 名称为空时不允许提交
- **WHEN** 家长上传 PDF 但未提供名称
- **THEN** 系统拒绝提交并提示家长填写名称

### Requirement: 浏览卷子档案列表
家长 SHALL 能够浏览所有已上传的卷子档案，列表 SHALL 展示名称和上传时间。

#### Scenario: 查看档案列表
- **WHEN** 家长打开卷子档案列表
- **THEN** 系统展示所有已上传的卷子档案，每条记录包含名称和上传时间

#### Scenario: 暂无档案时的空状态
- **WHEN** 家长打开卷子档案列表且尚未上传任何卷子
- **THEN** 系统展示空状态提示

### Requirement: 原始 PDF 持久化保存
原始 PDF SHALL 可靠持久化保存，其存储生命周期 SHALL 与代码部署相互隔离，不因应用重新部署或代码变更而丢失。

#### Scenario: 应用重新部署后 PDF 仍可访问
- **WHEN** 应用完成重新部署
- **THEN** 所有已上传的原始 PDF 仍然可访问，内容不变

### Requirement: 检测 PDF 类型
家长上传 PDF 后，系统 SHALL 在本地自动检测其类型，产出可追溯的检测记录集合（`PdfTypeDetectionAttempt[]`，字段与状态迁移规则见 D19），不要求家长手动标注，不阻塞或延迟上传流程本身。当前有效判定 SHALL 取最新一条 attempt：completed 时使用其 detectedInputType，pending 或 failed 时视为 unknown，即使存在更早的 completed 记录也 SHALL NOT 回退使用。

#### Scenario: 检测完成为数字原生
- **WHEN** 最新一条检测 attempt 为 completed 且 detectedInputType 为 digital_native
- **THEN** 系统不展示额外技术提示

#### Scenario: 检测完成为扫描件
- **WHEN** 最新一条检测 attempt 为 completed 且 detectedInputType 为 scanned
- **THEN** 系统展示"系统检测该文件可能为扫描版，自动切题将按尽力而为处理"

#### Scenario: 检测进行中
- **WHEN** 最新一条检测 attempt 为 pending
- **THEN** 系统展示"正在分析文档，自动切题暂按尽力而为处理"，不展示任何具体类型

#### Scenario: 检测失败或结果无法确定
- **WHEN** 最新一条检测 attempt 为 failed，或为 completed 但 detectedInputType 为 unknown
- **THEN** 系统展示"暂时无法确认文件类型，自动切题将按尽力而为处理"

#### Scenario: 更新的检测状态不被旧结果覆盖
- **WHEN** 一份档案曾有一条 completed/digital_native 的历史 attempt，随后又产生一条更新的 pending 或 failed attempt
- **THEN** 系统当前展示的有效判定为 unknown（或"检测中"提示），不使用更早的 digital_native 结果

### Requirement: 扫描件与未知类型 PDF 可正常使用
扫描件、无法确定类型、检测失败的档案 SHALL 可正常上传、命名、被选用于批改；系统 SHALL 提示自动切题效果为尽力而为，SHALL NOT 阻止选用或降低其可用功能路径。

#### Scenario: 选择非数字原生档案发起批改
- **WHEN** 家长选择一份当前有效判定为 scanned/unknown 的档案发起批改
- **THEN** 系统展示尽力而为提示，流程正常继续，不被阻止
