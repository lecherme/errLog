## math-error-correction-mvp Refinement Scratchpad

Tracks openspec-refine issues and working decisions for the `math-error-correction-mvp` change.
This is a working document, not a spec artifact.

Last updated: 2026-09-18. Checkpoint:
- P1(1): Consistent — landed, `openspec validate --strict` passed.
- P1(2): Consistent — landed, `openspec validate --strict` passed.
- P1(3): Consistent — landed, `openspec validate --strict` passed.
- P1(8): Consistent — landed (new `child-profile` capability + D4/Migration Plan/proposal/tasks updates). See P1(8) notes for the two correction rounds.
- P1(4): Consistent — landed after three correction rounds (locked segmentation-failure semantics, narrowed Contract input, two independent region fields, correction-worksheet fail-closed, PDF-backed vs no-PDF path separation in tasks.md, "four→five" Task Contract sync). New **P1(11)** recorded (open, undecided) as a byproduct.
- P1(5): Consistent — landed (D16: page-registration/context-region as an image-processing domain service in D11, not a new AI Task Contract; explicit candidate-vs-fallback marking; confirm-before-fact semantics with non-AI overwrite protection; task 3.5's sample-based reliability calibration). No Task Contract count change this round.
- P1(6): Consistent — landed after four correction rounds (new D17: taxonomy v1, local-only pre-check, durable/async/idempotent analysis pipeline, transient-vs-final `unavailable` distinction, split provenance for `aiSuggestionSnapshot`/`confirmedCause`, non-precision-only evaluation metrics, non-blocking-track Provider governance). Sixth Task Contract added; full "四/五/六" reference sweep confirmed no gaps or bad edits.
- P1(7): Consistent — landed after three correction rounds (new D18: RedoAttempt/correctionAudit append-only model with `effectiveResult` projection, dual idempotency (`redoSubmissionId` + `correctionRequestId`/`expectedEffectiveResult` optimistic concurrency), no fabricated "current answer" comparison, photo-only display-degradation branch, `correctionWorksheetId` server-side validation). No new Task Contract or capability this round; also closed a P1(6)-era gap in D4's ErrorQuestion diagram.
- P1(9): **Consistent** — landed 2026-09-18 after two correction rounds beyond the first full draft (append-only `PdfTypeDetectionAttempt[]` model with terminal `pending→completed`/`pending→failed` transitions and a most-recent-attempt effective-judgment rule; detection ownership collapsed onto D11; fail-closed classification + confusion-matrix evaluation replacing an unprovable "never misclassify" guarantee; the detector's own calibration/held-out on human-labeled digital_native/scanned/mixed-or-ambiguous; mixed/ambiguous samples requiring separately-labeled region-localization ground truth before reuse in Dataset B; four named datasets A–D; explicit shared metric definitions; digital-native-only formal Gate scope with a frozen per-sample crash rule; minimal non-assertive UI wording). New D19; D4/D13 updated; two new `worksheet-archive` Requirements; `tasks.md` gained 3.6/4.11, rewrote 6.2, appended to 6.3. **P2(4) merged in and closed as Consistent** — see P2(4) notes. See P1(9) entry below for the full landed detail.
- P1(11): **Consistent** — landed 2026-09-18 after two correction rounds beyond the first full draft. PDF-backed path's normal entry changed from "错题识别 + 逐题区域定位" to "整页题目分割 `full_page` 模式 + 点选" (matching decision 1's literal wording and the already-established no-PDF path UX); 错题识别 reclassified from Human Gate to non-blocking pre-highlight signal (D5/D13), its offline Selection Gate metrics based on human-labeled photo ground truth, explicitly never on production parent-rejection-rate data; 区域定位 reclassified from normal path to known-number repair support (still hard-governed for Provider selection, no longer Gate-determining); new deterministic `QuestionBoxNumberAssociation` step (D11, D20, task 3.7, its own calibration/held-out split) drives pre-highlight only on reliable, strictly one-to-one matches; new page-level pre-confirmation reliability signal (D20, task 3.8) gates whether pre-highlight may show at all, explicitly independent of D16's post-confirmation timing (kept as two separate tasks/execution points, not conflated); two invocation modes (`full_page`/`locality_retry`) given discriminated request/response shapes; repair dispatch requires both a uniquely-known missing question number AND spatial compatibility with the click before preferring region localization over locality-hint retry; formal Gate narrowed to three items (整页分割 `full_page`+PDF-render, 知识点标签, 题型分类) with an explicit Gate/track table resolving an earlier draft's internal contradiction; D19 Dataset B substantively relabeled to whole-page-segmentation ground truth (full true-question list + boundaries + completeness/FP/duplicate/merge/crash bases per sample), not a rename. New D20 (after D19, before Risks); D5/D13/D15/D19 updated; `specs/grading-workflow/spec.md` replaced 4 Requirements with 4 new ones; `tasks.md` gained 3.7/3.8, updated 6.1–6.5, added a cross-reference note to 3.5. **Group 4/7's actual task reordering is explicitly left to P1(10)** — this round only fixed contract/decision shapes, not task sequencing; see P1(10) notes for the specific tasks now needing replacement.
- P1(10): **Consistent** — landed 2026-09-20 after one correction round beyond the first full draft. Three-way distinction applied: dev-only pipeline fixtures (4.3) vs. formal normal entry (Group 7's `full_page`+click-select) vs. exception recovery (region-localization/`locality_retry` repair dispatch, no manual free-hand draw). Key points: (1) deleted the last manual-box-draw remnant (D5's 区域定位 row, tasks 6.4) — contradicted decision 2's literal wording and was redundant with the already-decided "未解决" terminal state; (2) `full_page` returning empty on PDF-render input is explicitly NOT a batch-ending terminal state — UI shows "整页自动分割不可用" but per-click `locality_retry`/region-localization recovery remains available, only a specific question that exhausts repair becomes "未解决"; (3) recovery options now reason-specific — retry (always), reselect PDF page (page-correspondence doubt), replace/re-upload photo (photo-quality/matching/pre-highlight issues only) — replace-photo is never claimed to fix a pure PDF-render segmentation failure, since the render is deterministic input; (4) Group 4 renamed/reframed to "Core Upload, Page Confirmation & Pipeline Foundations" — real permanent components (upload, D14 page-confirmation, crop/worksheet pipeline) but explicitly no error-question entry point; 4.3 rewritten into a pure dev-only seed/fixture (no browser UI, not parent-reachable, isolated/tagged dev data, cleanable, disabled in production); 4.4 narrowed to D14 page-confirmation only; 4.5/4.7 rewired to consume 4.3's fixture, 4.7 downgraded to pipeline-only; 4.8 no longer claims 4.3 as its manual entry; 4.9's stale "(4.4)"/"(P1(1))" refs fixed. (5) Group 6 intro fixed (no longer claims fallback UI "already exists in Group 4"). (6) Group 7 renamed/rebuilt: 7.1 (new) builds the `full_page` click-select UI itself; 7.2 (new) wires non-blocking pre-highlight; 7.3 (new) wires the D20 repair-dispatch chain with reason-specific recovery; 7.4 (kept, clarified as an effort-reducing enhancement, NOT a hard precondition for `full_page`, which only needs "a page confirmed by any means"); 7.5 (kept, no-PDF path unchanged) gained an explicit shared-component/distinct-orchestration note; 7.6 (renumbered from old 7.3) reworded for the new recompute mechanisms; 7.7 (new) is the first real end-to-end user-journey walkthrough, explicitly scoped to NOT claim Group 8–10 functionality. (7) Full-repo reference sweep: fixed 8.1 (now consumes only Group 7's authoritative confirmed set, explicit prohibition on consuming 4.3/pre-highlight/unconfirmed-repair-candidates), 13.2 (removed stale "manual-fallback confirmation" phrasing), added 13.5 (production-isolation check for 4.3, mirroring 13.4). 8.4 checked — no stale reference found, unchanged. Actual changes: `design.md` (D5 row, D20 gained two new subsections — `full_page` empty-result semantics, reason-specific recovery menu); `specs/grading-workflow/spec.md` (new scenarios on two Requirements, no new Requirements); `tasks.md` (Group 4 header + 4.3/4.4/4.5/4.7/4.8/4.9 rewritten, Group 6 intro + 6.4 fixed, Group 7 header + full 7.1–7.7 rewritten/renumbered, 8.1/13.2 fixed, 13.5 added). `openspec validate --strict` → see below.
- P2(1): **Consistent** — landed 2026-09-20, rationale/alternatives-only addition to D5/D6 (see P2(1) entry below), no behavioral change, no P1 reopened.
- P2(2): **Consistent** — landed 2026-09-20, rewrote `correction-worksheet`'s answer-space Requirement/Scenarios and `access-control`'s authenticated-access Requirement/Scenarios to remove unbound qualifiers, plus a matching `tasks.md` 5.6 rewrite for the new negative scenario (see P2(2) entry below).
- P2(3): **Consistent** — landed 2026-09-20, no D6/spec changes needed (D6 already complete; specs correctly leave interruption-condition testing to tasks); added a single consolidated `tasks.md` 13.6 covering the four user/session interruption types (refresh/browser close-reopen/same-browser relogin/no-shared-storage cross-browser-or-device login) against a representative set of confirmed facts + the `aiSuggestionSnapshot` displayed-but-unconfirmed case + Generation Snapshot re-fetch, explicitly reusing 5.8 for `currentChildId` and explicitly out of scope for D6's AI-recompute/derived-asset-regeneration operation types (see P2(3) entry below).
- **All P1 and P2 issues from this refine round are now closed**: P1(1)–P1(11) Consistent, P2(1)–P2(4) Consistent. `math-error-correction-mvp`'s planning artifacts (proposal/specs/design/tasks) are complete per `openspec status`.
- **Final semantic review (2026-09-20)**: a full read-only re-verification of proposal/design/tasks/specs found one drift — `proposal.md` (What Changes 批改流程 bullet, 设计原则 sentence, New Capabilities 的 grading-workflow 条目) still described the retired pre-D20 "错题识别产出题号列表→逐题区域定位" flow and never mentioned the no-PDF degraded path; every other artifact had already been updated during P1(10)/P1(11) but `proposal.md` was never in either round's edit list. All three spots rewritten to describe the current D20 mechanism (整页自动切题+点选权威框集合+非阻塞预高亮+按失败原因区分的局部修复), without reintroducing the old flow or any free-hand full-boundary redraw language, and without over-promising that every failure resolves (单题修复仍失败时按"未解决"处理，不阻塞其他题). Also fixed `tasks.md` 13.6's imprecise citation — the confirmed-knowledge-tag fact now cites 8.2 (produces/confirms it) with 8.3 kept as its separate non-overwrite/provenance guarantee, not the confirmation step itself. Full-repo residue search (old flow / free-hand redraw / over-broad failure guarantees) came back clean; `openspec validate --strict` and `openspec status` re-run and passing after the fix; proposal→D20→grading-workflow spec→tasks 7.1–7.3/8.1 chain re-read end-to-end and confirmed consistent. `math-error-correction-mvp` is now ready for safe-commit.
- **Next step**: no open issues remain in this scratchpad. Next action is `safe-commit`, pending explicit user approval per this project's mandatory workflow — not started this session.

### Status Legend
- **Open**: Not yet captured consistently in OpenSpec artifacts
- **Needs refinement**: Partially captured; artifacts still need work
- **Consistent**: Artifacts are aligned with current intended behavior

### Checks Run
- **Proposal → Specs**: ran (2026-09-02). All five proposed capabilities have specs. One gap (photo↔page correspondence) — see P1(1).
- **Specs → Design**: ran (2026-09-02). Every spec requirement has design coverage at the time. No design contradicts a spec.
- **Design → Tasks**: ran (2026-09-02). Found D5 internal count contradiction (P0(1), resolved) and one uncovered design requirement (P1(2)).
- **Specs → Tasks (traceability)**: ran (2026-09-02). One requirement not verified by any task — P1(3).
- **Tasks → upstream artifacts (authorization)**: ran (2026-09-02). No unauthorized scope creep found; dev-seed tasks (1.4/5.4/13.4) are consistent with the corrected Migration Plan.
- **Change → existing system (reuse)**: ran (2026-09-02), trivially satisfied. Greenfield first change; every new capability is correctly `new-dedicated`. Updated 2026-09-17: `child-profile` (added while resolving P1(8)) is likewise `new-dedicated` — no existing main spec or shared capability covers child-context/current-child semantics.
- **Artifact document-quality**: ran (2026-09-02). Tasks carry explicit `verify …` acceptance criteria throughout. Minor rationale/wording gaps — P2(1), P2(2), P2(3).
- **Requirements interview** (`/opsx:explore`, 2026-09-09 → 2026-09-16, read-only, no artifact edits): 13 numbered product-tradeoff questions + 2 unnumbered foundational corrections, answered and confirmed by the user (see Confirmed Product Decisions below). This surfaced a materially larger scope than the original photo↔page question (P1(1)) — multi-child model, photo-only degraded flow, answer-region capture, AI error-cause, redo tracking — none of which existed in `proposal`/`specs`/`design`/`tasks` before this interview. Recorded as **P1(1) revised** + **P1(4)–P1(10)** + **P2(4)** below. These are not yet reflected in any artifact.

### Key References
- `design.md` D5 (AI Task Contracts), D8 (deployment + backup), D13 (AI Provider Selection Gate)
- `specs/grading-workflow/spec.md` "支持多张批改照片" — defers photo↔PDF-page correspondence to Design (superseded by interview decision, see P1(1))
- Proposal "Migration Plan" — User/Child auto-created on first OTP login, no manual seeding in prod

### Confirmed Product Decisions (Requirements Interview, 2026-09-09 → 2026-09-16)

Source: `/opsx:explore` read-only interview in this project's conversation history (沪学习 screenshot prompted the line of questioning). Not yet written into any artifact. Kept here verbatim-in-summary so a future session doesn't need to re-derive them from chat history.

1. **自动切题是 MVP 最低标准**：AI 整页自动切题 + 可点击框体是正常入口；用户点选选中错题；手动画框只是异常兜底，不是常规操作。
2. **两级失败容忍度**：漏框近乎零容忍；框不准（题干/选项/公式/表格/图形必须完整，多余空白可接受）容忍度更宽；漏框兜底是"点大致位置→系统补框"，不是自由画框。
3. **两层验收判定**：评测集整体率达标 **且** 不允许任何一份"正常清晰"试卷崩盘；具体百分比暂缓，等真实第三方测试集建好后再定（不是本轮 refine 要写死的数字）。
4. **PDF 类型验收范围**：数字原生 PDF = 正式验收范围；扫描件 PDF = 可上传、尽力而为、探索性测试集，不与数字原生共用阈值；是否升级为正式支持留给后续 Change（数据触发）。
5. **输入模型**：MVP 主路径 = 原始 PDF（干净原题/打印）+ 批改照片（真实作答/批改痕迹）；系统预生成题目框、建立 **PDF 题目区域 ↔ 照片作答区域** 对应；用户点选后同时保存干净原题 + 对应作答区域。**表述口径**：PDF+照片是完整功能的主路径，不是唯一输入路径；纯照片是明确的降级路径（两者不是平级并列关系）。
6. **查看错因深度**：A（MVP 硬性要求）= 保存并并排展示"干净原题+真实作答区域"，不依赖 AI；B（MVP 内非阻塞增效）= AI 自动错因分类，成功才存，失败/低置信度不阻塞任何流程；长期目标（非 MVP）= AI 可靠自动判错因。
7. **AI 错因的流转模式**：不是 Human Gate 也不是纯自动降级，是第三种——默认非阻塞 AI 建议（不要求确认、不当事实；低置信度显示"暂时无法判断"，不给误导性默认分类；已展示建议保存为快照，重算不无提示改变）+ 可选人工升级为受保护权威值（确认后重算不得覆盖）。
8. **重做回收闭环**：MVP 需要轻量闭环——题目级记录 已改正/仍然做错/尚未检查，**人工标记**（不需要重新拍照+AI 自动判题，那是未来增强）；系统保存重做次数、结果、当前复习状态。
9. **孩子档案 onboarding**：登录后先查是否有孩子档案；无则引导创建；有则默认用上次/当前孩子，不要求重复选择；只在主动新建/切换时变更当前孩子。孩子档案 ≠ 孩子登录账号，MVP 仍只有家庭账号 OTP 登录。
10. **重做标记不区分角色**：家庭账号内任何使用者都可标记"已改正"等状态；不记录、不区分是家长还是孩子标的。
11. **多孩子档案**：MVP 允许新建第二个及以上孩子档案，但只做最低能力（简单列表+切换；不含独立登录/OTP、删除、合并、家庭成员邀请、复杂权限管理）；新数据默认归属当前孩子。**这些排除项只标记"不属于当前 MVP"，不代表已排期的后续 Change**——是否将来做，尚未决定。
12. **照片↔PDF 页面对应机制**：多页 PDF → AI 推荐最可能页面，用户确认/换选候选；单页 PDF → 自动对应，无需确认；**异常兜底**：AI 无法给出可靠候选时，允许用户从完整 PDF 页面缩略图/页码列表手动选（异常路径，不是正常入口）；用户确认后的对应关系不能被 AI 自动覆盖。
13. **无 PDF、仅照片时的降级流程**：不拒绝，进入明确降级的"纯照片错题"流程——仍在照片上自动切题、可点选（不是要求手动画框）；可保存照片题目/作答区域、作答/计算过程/批改痕迹、AI 错因建议（若成功）；不能承诺干净原题/生成订正卷/完整流程能力；须标记"缺少干净原题"；未来"补交 PDF 回填关联历史照片错题"（C 路径）留给后续 Change，机制未设计。
14. **重做前历史/错因展示时机**：用户当次自选——"直接重做"（默认隐藏，可主动"查看上次错因"）vs "复习后重做"（先展示）；完成并标记结果后自动解锁对比查看；印刷订正卷本身不直接印历史/错因。
15. **纯照片自动切题的验收地位**：尽力而为，不与数字原生 PDF 共用正式验收标准；纳入独立探索性测试集；失败/低置信度须明确提示，不静默出错、不强制手绘；升级为正式支持留给后续 Change（数据触发）。

**仍未决定，不在本轮 refine 范围内**（不要在 refine 中替用户决定）：
- 自动切题的具体数值阈值（漏框率/微调比例/崩盘判定百分比）——等真实测试集。
- 一题跨多张照片 / 一张照片对应多页 PDF 的边界情形细节。
- C 路径（补 PDF 回填关联历史照片错题）的具体机制。
- "孩子模式"（孩子是否需要不要求 OTP 的简化操作入口）——因问题 8 选了"不区分角色"，此分支未讨论。
- 具体数据 Schema（错因字段结构、重做记录历史保留方式、PDF↔照片区域对齐的坐标表示）。

### Current Working Constraints / Decisions
- Refine works one issue at a time; no artifact edited without explicit user approval first (per this project's refine protocol).
- Baseline `openspec validate "math-error-correction-mvp" --strict` → passes (as of 2026-09-02; re-check after each edit).
- No implementation code exists; this is planning-artifact refinement only.
- The interview-sourced issues (P1(1) revised, P1(4)–P1(10), P2(4)) are large in scope; each will likely need edits across multiple artifacts (spec + design + tasks) rather than a single-file fix. Still address one numbered issue per iteration; a single issue may bundle its spec+design+tasks edits together as one approved change-set, consistent with how P1(1) was originally scoped (two files).

### Issue List

#### P0(1): design D5 says "三个 Task Contract" but the design elsewhere and the tasks say four
- **Status**: Consistent
- **Notes**: Resolved 2026-09-02. See prior scratchpad history (superseded by this rewrite) — D5 heading and opening line both now say "四个", consistent with D5's own tables, D13, and task 6.1. `openspec validate --strict` passes.

#### P1(1): 批改照片与 PDF 页面对应关系的机制现已确定，但尚未写入任何 artifact
- **Status**: Consistent
- **Notes**: Resolved 2026-09-16. Applied with two corrections beyond the original interview framing (both requested by the user before approval):
  1. "有可靠候选/无可靠候选"改为条件分支，而不是无条件"系统 SHALL 推荐"；"可靠候选"的判定标准显式绑定到 D13 Selection Gate / P1(9)，具体数值不在本 issue 中给出，判定标准未建立或未达标时一律按"无可靠候选"处理。
  2. 明确"AI 预选 ≠ 人工确认"——预选状态在家长确认前不得被当作已确认事实或传给下游步骤；这条边界同时体现在 `design.md` D14 正文、`specs/grading-workflow/spec.md` 的独立场景（"确认前的预选不是已确认事实"），以及 `tasks.md` 4.4/7.4 的 verify 子句里。
  3. D14 去掉了"确认区域={页面,边界坐标}默认继承……"这句——按用户要求收窄范围，D14 只管"照片对应哪个 PDF 页面"，坐标/空间对应留给 P1(5)，不在此提前定义或混用坐标语义。
  4. `tasks.md` 4.4 明确标注为"实现阶段的数据管道骨架，非最终用户正常入口"；MVP 的正常入口（AI 候选+确认）由新增的 7.4 承担；Group 4/7 的整体任务结构由 P1(10) 后续统一调整，此处不预先定论。
  实际改动：`design.md` 新增 D14（插在 D13 之后、Risks 之前）；`specs/grading-workflow/spec.md` 删除"支持多张批改照片"末句"由 Design 决定"，新增独立需求"确认批改照片对应的 PDF 页面"及五个场景；`tasks.md` 改写 4.4、新增 7.4。`openspec validate "math-error-correction-mvp" --strict` → **passed**（2026-09-16，紧接编辑之后单独运行确认）。
- **Files & locations**:
  - `specs/grading-workflow/spec.md` — "支持多张批改照片"："照片与 PDF 页面的对应关系由 Design 决定。"
  - `design.md` — Risks bullet: "多照片与 PDF 页面对应 … MVP 阶段将对应关系确认保留为人工步骤，AI 仅做推荐。"（笼统，无具体机制）
  - `tasks.md` — 4.4: "render the relevant PDF page (via the Group 3 render endpoint)" — assumes the relevant page is already known, no page-selection step
- **Evidence**: Interview 决定 12（见上）已经给出具体机制：多页 AI 推荐候选 + 人工确认；单页自动；AI 不可靠时人工从缩略图/页码列表选（异常兜底，非常规入口）；确认后不可被 AI 覆盖。当前三个文件都还停留在"由 Design 决定"/笼统 Risks 描述/隐含假设的状态，没有一个体现这个具体机制。
- **Expected state**:
  - `design.md`：新增一条编号 Decision（建议 D14，因 D6 讲的是持久化语义、不是这个具体流程步骤），写清上述机制 + 理由（容器小、闭集检索不可用、家长逐页拍照）+ 被否方案（纯人工选页——与"自动优先"原则冲突；全自动无确认——分页/排版差异下不可靠，违反"人工做最终决定"）。
  - `specs/grading-workflow/spec.md`：页面对应是用户可见行为，应上升为正式需求（而非全权交给 Design）——新增 Requirement + Scenario：多页卷子家长确认/更换 AI 推荐的页面；单页卷子不要求家长操作；AI 推荐不可靠时家长可从页面列表手动选。
  - `tasks.md` 4.4：改为"渲染 AI 推荐/家长确认的页面（含无可靠推荐时的手动选页列表兜底）…verify 推荐可被换选、确认后的对应关系不被 AI 覆盖，且该 UI 复用于问题 4.2 的多张照片场景"。
- **Impact**: 阻塞 4.4 实现（"relevant PDF page"目前无定义来源）；也是本轮访谈里第一个、也是原 `P1(1)` 的问题，其他新增问题（P1(4)–(10)）大多建立在类似的"决定已有、artifact 未跟上"模式上，处理方式可参考这条的落地方式。
- **Recommended artifact**: `design.md`（新 D14）+ `specs/grading-workflow/spec.md` + `tasks.md`（4.4）
- **Suggested fix**: 见 Expected state 三条。
- **User decision needed?**: No —机制已经在访谈中决定，这里只需要你批准具体文字/编号位置。

#### P1(2): AI Provider outbound-source / region verification required by D8 & D13 has no task step
- **Status**: Consistent
- **Notes**: Resolved 2026-09-16. `tasks.md` 6.3 strengthened per user direction beyond the original suggested fix:
  1. Outbound source is described relative to the current deployment stage ("the current Application Runtime's actual outbound source — currently the home-broadband mainland egress IP per D8"), not hardcoded as a permanent assumption; explicit re-verify-on-change clause added for future region migration.
  2. Decision record must capture four fields per candidate: verification date, official-documentation evidence/link, actual outbound test environment, actual API reachability result.
  3. Explicit fail-closed clause: official-unsupported, unreachable-from-actual-outbound-source, or ambiguous/unconfirmable support scope each independently disqualify a candidate from passing the Gate or being selected for that Task Contract.
  4. "Actually reachable" requires a real minimal API request through the actual outbound path — documentation inference alone is insufficient.
  `openspec validate "math-error-correction-mvp" --strict` → **passed**（2026-09-16，紧接编辑之后单独运行确认）。
- **Files & locations**:
  - `design.md` — D8: "AI Provider Region 验证要求 … 必须核实其官方是否支持从当前实际出站来源调用 …（当前是家庭宽带的大陆出口 IP）"
  - `design.md` — D13: "AI Provider Region 验证 … 须在 Gate 执行时用官方文档重新核实"
  - `tasks.md` — 6.3: executes the Selection Gate, records "task correctness, bbox/localization quality, structured-JSON success rate, latency, API cost, and failure/retry behavior" — no outbound-source/region reachability check
- **Evidence**: Both D8 and D13 make outbound-source reachability a mandatory Gate check. Task 6.3, the only task that executes the Gate, omits it.
- **Expected state**: Task 6.3 explicitly verifies each candidate model is officially supported / actually reachable from the current outbound source (home mainland egress IP per D8); record the finding in the decision record.
- **Impact**: Readiness gap. A model could win the Gate on quality/cost and then be unusable from the deployment's real egress path.
- **Recommended artifact**: `tasks.md` (6.3)
- **Suggested fix**: Add to 6.3: "… and verify each candidate is officially supported for, and actually reachable from, the current outbound source (home mainland egress IP per D8); record the result in the D13 decision record."
- **User decision needed?**: No.

#### P1(3): question-bank requirement "错题归属于具体孩子" is not verified by any task
- **Status**: Consistent
- **Notes**: Resolved 2026-09-17, after P1(8) landed. `tasks.md` 8.1 rewritten: field list now includes "the Child inherited from the GradingSession's childId as bound at that session's creation"; explicit SHALL NOT read `currentChildId` / SHALL NOT independently derive the Child; explicit division of labor with 5.10 (5.10 = domain invariant, 8.1 = the Question Bank commit path actually honors it). Four verify clauses: (a) all fields incl. Child saved; (b) covers *any* `currentChildId` change after GradingSession creation, not just "switched away and back" (broadened per user direction beyond the originally-approved draft); (c) commit path never queries `currentChildId`; (d) new fail-closed clause — missing/invalid/unresolvable GradingSession.childId fails the commit, never falls back to `currentChildId`, never writes an ErrorQuestion with ambiguous ownership. Does not restate child-profile's ownership/security invariants (those stay in child-profile spec / 5.8 / 5.10). `openspec validate "math-error-correction-mvp" --strict` → **passed**（2026-09-17，紧接编辑之后单独运行确认）。
- **Files & locations**:
  - `specs/question-bank/spec.md` — Requirement "错题归属于具体孩子" + Scenario "错题与孩子关联"
  - `design.md` — D4: "ErrorQuestion（错题） 归属 Child"
  - `tasks.md` — 8.1: commits ErrorQuestion records without listing Child association in its field list
- **Evidence**: No task's acceptance criteria assert that a saved ErrorQuestion is tied to a specific Child rather than only the parent User.
- **Correctness questions to confirm via P1(8) before writing 8.1's final verify clause** (user-specified, 2026-09-16):
  1. `GradingSession` 应在创建时绑定当时的当前 Child。
  2. `ErrorQuestion` 提交时应继承所属 `GradingSession` 的 Child，而不是在提交时重新读取全局当前 Child。
  3. 后续切换当前 Child 不得改变已有 `GradingSession` 或 `ErrorQuestion` 的归属。
- **Expected state**: Once P1(8) settles the above, 8.1 gets a single final edit: verify each committed `ErrorQuestion` resolves to the Child inherited from its `GradingSession` at that session's creation time (not the global current-Child pointer read at submit time).
- **Impact**: Traceability gap on a foundational requirement; fixing it before P1(8) risks a second edit once the Child-binding model lands, so deliberately deferred.
- **Recommended artifact**: `tasks.md` (8.1) — **after** `design.md`/specs/tasks for P1(8) land.
- **Suggested fix**: deferred — see Correctness questions above.
- **User decision needed?**: No (already directed: fix after P1(8)).

#### P1(4): 无 PDF、仅有批改照片时的降级流程未被任何 artifact 覆盖
- **Status**: Consistent
- **Notes**: Resolved 2026-09-18, after three correction rounds. Key points landed:
  1. **不硬编码"手动画框"兜底**：漏框恢复严格锁定为两级——单题级"点击大致位置→重新分割/补框，仍失败则标记该题'未解决'、不建 ErrorQuestion，其余错题不受影响"；整照片级"整体不可靠→标记该照片不可用，提示重拍/换照片"。两级都不静默、不生成不可靠框、不要求完整手动画框。体现在 grading-workflow spec、D15、tasks 7.5。
  2. **新 Task Contract 输入收窄为"批改照片"**（不含 PDF 页面渲染）；是否扩展到有 PDF 场景留给新记录的 **P1(11)**，本 issue 不预先决定。
  3. **干净原题区域 vs 作答证据区域是两个独立字段**，不得相互替代——D4 实体图与新段落、question-bank spec 均已体现；坐标结构/对齐机制留至 **P1(5) 的 design refinement**（按用户要求措辞，不写成"已进入实现阶段"）。
  4. **correction-worksheet fail-closed**：所选错题含"缺少干净原题"者，拒绝生成并列出清单，不静默排除生成不完整订正卷。
  5. **"上传批改照片并选择对应卷子"整句替换**为"…并可选关联对应卷子"，PDF 选择从无条件必选改为可选，新增"未选择 PDF 时进入降级路径"场景，避免与新增的降级 Requirement 自相矛盾。
  6. **`tasks.md` Group 4 明确区分 PDF-backed（4.1–4.7）与 no-PDF（4.8）两条路径**，不是互相矛盾的全局必经步骤；4.2/4.4/4.5/4.6/4.7 标注"PDF-backed path only"；4.3（纯编辑题号列表，不依赖 PDF/图像）在两条路径下复用不变；4.8 明确说明该路径没有自己的手动区域/切题 UI（因手动画框被禁止），点选式切题只能等 6.5/7.5 接入 AI 后才存在。
  7. **"四个 Task Contract"→"五个"的全量搜索与同步**：`grep` 找到 7 处（`design.md` D5 标题、D5 开篇、D13 背景段、D13 第2点；`tasks.md` 6.1、6.3、6.4），全部同步为"五个"或"四个正式 Gate + 一个探索轨道"；6.4 的措辞修正为只对比"整页题目分割"与"区域定位"的输出形状差异，不再错误概括"其余四个都是单值输出"（错题识别本身输出就是列表）。
  实际改动：`specs/grading-workflow/spec.md`（替换首条 Requirement + 新增降级 Requirement 及 6 个场景）；`specs/question-bank/spec.md`（新增两区域独立概念 Requirement）；`specs/correction-worksheet/spec.md`（新增 fail-closed Requirement）；`design.md`（D4 实体图+新段落、D5 标题/开篇/新表格行、D13 两处、新增 D15）；`tasks.md`（Group 4 说明段落、4.2/4.4/4.5/4.6/4.7 标注、新增 4.8、6.1/6.3/6.4 更新、新增 6.5、新增 7.5、新增 8.4、新增 9.5）。`openspec validate --strict` 与全量"四个/五个"搜索结果见对话记录。
- **[原始记录，保留供追溯]**
- **Files & locations**:
  - `specs/grading-workflow/spec.md` — 全部需求假设已选定原始 PDF（"上传批改照片并选择对应卷子"是必选步骤）
  - `specs/question-bank/spec.md` — "保存错题原始资产"没有"缺少干净原题"这种降级标记
  - `design.md` — D4/D5 均未提及无 PDF 场景
  - `tasks.md` — 无任何任务覆盖此路径
- **Evidence**: 决定 13（无 PDF 时进入降级"纯照片错题"流程，仍自动切题可点选，标记"缺少干净原题"，不能生成订正卷）在当前四个 artifact 里完全没有对应内容。
- **Expected state**: `grading-workflow` spec 新增"无原始 PDF 的批改任务"需求及场景；`question-bank` spec 的资产保存需求补充"缺少干净原题"标记；`design.md` 新增 Decision 描述该降级路径的边界（可以做什么/不能做什么）；`tasks.md` 新增对应任务及 verify。
- **Impact**: 这是决定 13 里明确的 MVP 能力，目前完全未落地，实现阶段无据可依。
- **Recommended artifact**: `specs/grading-workflow/spec.md` + `specs/question-bank/spec.md` + `design.md` + `tasks.md`
- **Suggested fix**: 留到处理此 issue 时展开。
- **User decision needed?**: No — decision already made in interview (点 13)。

#### P1(5): PDF 题目区域 ↔ 照片作答区域的空间对应缺少 Task Contract 与数据模型
- **Status**: Consistent
- **Notes**: Resolved 2026-09-18. 用户选择 A3 中间方案（自动生成"题目上下文作答证据区域"，不承诺精确贴合手写笔迹）后落地，关键点：
  1. **归属为图像处理领域服务，不是新 AI Task Contract**：页面配准（OpenCV 特征匹配+单应性矩阵）是确定性算法，不存在 Provider 选型维度，不适用 D13 Gate；归入 D11 Python PDF Processing Service（触发 D11 原本预留的"引入 OpenCV"条件）。**没有触发本轮之前 P1(4) 那种"四→五→六"的 Task Contract 计数连带修改**——D5/D13/6.1/6.3/6.4 均未改动。
  2. **回退到整照片必须显式标记**：作答证据区域概念模型 = `{kind: 候选上下文区域 | 整照片兜底, 原始批改照片引用（始终有）, 照片坐标空间区域坐标（仅候选上下文区域时有）}`，不依赖字段为空的隐式判断。
  3. **确认语义精确化**：候选区域/整照片兜底在生成阶段只是候选结果，家长明确确认该错题后才成为已确认业务事实；确认后任何自动重新配准/映射/计算不得静默覆盖——**明确不写"AI 重算不得覆盖"**（页面配准非 AI），而是引用 D6"已确认事实不可被自动覆盖"的通用原则。体现在 D16、grading-workflow spec 新场景、task 4.10 的 verify 里。
  4. **task 3.5 补齐可靠性校准要求**：用代表性样本（清晰/透视倾斜/裁剪不足/模糊/特征不足）验证；阈值和上下文余量都从真实样本校准配置、不现在编数值、不做不可追溯的硬编码常数；阈值未建立/未达标/结果异常时一律回退整照片。
  5. **P1(4) 遗留占位文字更新**：D4 与 question-bank spec 里"具体字段结构、坐标模型及对齐机制留至 P1(5) 的 design refinement"已替换为引用 D16 的具体概念模型，不再写"机制未决定"（精确数据库字段类型仍留给实现阶段）。
  6. **不依赖 P1(11)**：机制只依赖已确认的干净原题区域和已确认的照片↔页面关系，与 P1(11) 是否扩展"整页题目分割"到有 PDF 场景相互独立，本 issue 未替 P1(11) 做任何决定。
  7. **任务编号**：4.9（生成候选区域/整照片兜底）与 4.10（预览+小幅微调+整照片展示+用户确认）分开编号，职责不混。
  实际改动：`design.md`（D4 段落更新、D11 新增职责条目、新增 D16）；`specs/grading-workflow/spec.md`（新增"生成并预览作答证据的上下文区域"Requirement 及 5 个场景）；`specs/question-bank/spec.md`（更新占位文字、新增 1 个场景）；`tasks.md`（新增 3.5、4.9、4.10，修改 8.4 verify 列表）。`openspec validate --strict` 与 `openspec status --json` 结果见对话记录。
- **Files & locations**:
  - `design.md` D4 — `ErrorQuestion` 只有"题目区域（人工确认后的原始事实）"，没有作答区域字段
  - `design.md` D5 — 四个 Task Contract 里没有"作答区域定位"或"PDF 区域↔照片区域对齐"契约
  - `specs/question-bank/spec.md` — "保存错题原始资产"列的是"批改照片的引用"，不是逐题作答裁切
- **Evidence**: 决定 5（点选错题框时同时保存干净原题+对应作答区域）需要一个新的数据关系和/或 AI 契约，当前 D4/D5/question-bank spec 都没有对应内容。
- **Expected state**: D4 补充 ErrorQuestion 的作答区域引用；D5 视处理方式新增契约（如果需要 AI 辅助对齐）或在 D5 说明这是沿用区域定位契约的输出、不需要新契约；question-bank spec 补充作答区域字段。
- **Impact**: 决定 5 是 MVP 主路径的核心机制，当前数据模型接不住。
- **Recommended artifact**: `design.md`（D4、可能 D5）+ `specs/question-bank/spec.md`
- **Suggested fix**: 留到处理此 issue 时展开，需先确认 D4/D5 的具体改法。
- **User decision needed?**: No — but 需要在处理时确认作答区域的定位是否复用 D5 现有"区域定位"契约（同一次 AI 调用同时给题目框+作答框），还是需要独立契约；这是实现机制细节，倾向于在 design 阶段由你确认一次，不是本轮遗留的产品决策。

#### P1(6): AI 错因分析缺少 Task Contract，且 D5/D6 的二分框架容不下"非阻塞建议+可选确认"这第三种模式
- **Status**: Consistent
- **Notes**: Resolved 2026-09-18，经四轮修正落地。关键点：
  1. **第六个 Task Contract + 新增 D17**：D5 只留简表一行（三态：非 Human Gate、非自动降级、"非阻塞 AI 建议型"），完整机制（taxonomy v1、预检、异步边界、评测方法、Provider 治理、最小输入）放进新增的 D17，跟 D14/D15/D16 同样的"D5 简表 + 专属 Decision"模式，不把 D5 表格撑爆。
  2. **Taxonomy v1 五个 code**（`calculation_error`/`concept_error`/`problem_understanding_error`/`solution_method_error`/`other`）已写入 D17、question-bank spec、task 8.7 三处；`unavailable` 明确是状态不是分类；code 含义不可变、新增走新 `taxonomyVersion`、历史记录不被静默重分类。
  3. **输入预检必须在本地完成**：Application Runtime 或自托管 Python 服务（D11），绝不调用第三方 Provider；预检失败时零数据发送。写入 D17、spec、task 6.6。
  4. **真正异步、非阻塞、可恢复**：ErrorQuestion 先独立完成持久化；错因分析是后续异步任务（durable job/transactional outbox/reconciliation 任一，不绑定具体产品）；投递失败不永久丢失分析机会；进程崩溃/重启/超时不永久卡在"进行中"。写入 D17、spec、task 8.5。
  5. **区分暂时性失败 vs 最终 `unavailable`**：网络/超时/限流/worker 中断走可重试状态，不立即等同 `unavailable`；`unavailable` 只用于预检拦截/置信度不达标/重试耗尽三种情形。
  6. **幂等性**：稳定 attempt 标识；重复投递/并发不产生重复快照；迟到结果不覆盖更新快照、不改变 `confirmedCause`。task 8.5 verify 覆盖崩溃恢复、重复投递、迟到结果三类场景。
  7. **`confirmedCause` provenance 拆清楚**：`category`/`explanation`（始终非空）/`taxonomyVersion`/`confirmedAt`/`sourceSuggestionSnapshotId`（源自某条建议时记录）分别保存，不覆盖 `aiSuggestionSnapshot`；`category` 按其 `taxonomyVersion` 校验有效性。`aiSuggestionSnapshot` 的 provenance 同样拆成 `providerModelIdentifier`/`contractVersion`/`taxonomyVersion`/`inputMode`/`generatedAt`/`confidence`/`primaryCategory`/`explanation` 独立字段，不合并成含糊的版本号。
  8. **非阻塞轨道评测不只看 precision**：按三种 inputMode（`clean_question_plus_candidate_evidence_region`/`photo_only_candidate_region`/`full_photo_fallback`）分别记录"危险的错误建议比例"（自信给出错误诊断，最危险的失败模式）、"正确建议覆盖率"、"误判为 unavailable 的比例"、"最终 unavailable 比例及原因分布"，写入 D17、task 6.3/6.7；参考错因由人工标注，不用模型自身置信度当 ground truth；Provider 自报分数不直接当可信最终置信度。
  9. **非阻塞轨道的 Provider 治理原则**：表现差不否决其他四个正式契约、不阻止 MVP，但仍须满足官方支持/实际出站可达/结构化输出合规/隐私最小输入等硬约束；某 inputMode 无可靠候选时保持 `unavailable`，不为"声称功能存在"选无法遵守 Contract 的 Provider。写入 D13 新增治理段落 + D17。
  10. **明确不做的**：本轮不新增 MVP 内的手动"重新分析"入口（D17/spec/task 8.5 均显式声明"是否提供主动重新分析入口尚未决定，不在此预设"）。
  11. **五→六全量搜索确认**：`grep` 核对"四个/五个/六个/four/five/six"，D5/D13 已同步为"六个"，D13/D17 里两处"其余四个正式契约"是正确保留（不是漏改），`tasks.md` 8.7 的"five codes"指 taxonomy 而非契约数，D4 标题"四个领域实体"仍是无关的实体计数——均确认无遗漏、无误改。
  实际改动：`design.md`（D5 新增小节+表格行、D6 扩展、D13 背景/评测方法第2点/新增治理段落、新增 D17）；`specs/question-bank/spec.md`（新增完整 Requirement + 14 个场景）；`tasks.md`（6.1/6.3/6.4 同步六个契约、新增 6.6/6.7、新增 8.5/8.6/8.7）。`openspec validate "math-error-correction-mvp" --strict` → **passed**（2026-09-18，紧接编辑之后单独运行确认）。
- **Files & locations**:
  - `design.md` D5 — 只有"Human Gate"和"自动降级"两类
  - `design.md` D6 — 已确认事实不可覆盖的原则，需要扩展成"未确认建议可被静默替换，已确认建议不可被覆盖"这种更细的语义
  - `specs/question-bank/spec.md` — 知识点标签有完整的 Human Gate 描述，错因没有对应内容
- **Evidence**: 决定 6、7（错因是 MVP 内非阻塞增效；默认 AI 建议、低置信度显示"无法判断"、已展示建议不被静默替换、人工确认后升级为权威值）需要 D5 新增第三种分类,并在 D6/question-bank spec 落地这套语义。
- **Expected state**: D5 新增"非阻塞建议型"分类（区别于 Human Gate 和自动降级）；question-bank spec 新增错因相关需求和场景；tasks.md 新增对应任务。
- **Impact**: 决定 6/7 是你明确要"MVP 内尝试实现"的能力,当前框架结构性地容不下它。
- **Recommended artifact**: `design.md`（D5、D6）+ `specs/question-bank/spec.md` + `tasks.md`
- **Suggested fix**: 留到处理此 issue 时展开。
- **User decision needed?**: No。

#### P1(7): 重做/复习闭环没有数据模型、需求或任务
- **Status**: Consistent
- **Notes**: Resolved 2026-09-19，经三轮修正落地。关键点：
  1. **新增 D18**，模式沿用 D14–D17："D5/D4 简表 + 专属 Decision"，不新增 capability，全部挂在既有 `question-bank`（+ `correction-worksheet` 一条最小 Requirement）上。
  2. **`currentReviewStatus`/`redoCount` 是只读投影**，不是创建时初始化、提交后更新的独立字段；缓存（若有）必须可从 `RedoAttempt` 集合重建，不是事实源。
  3. **`RedoAttempt` 最终模型**：`originalResult`/`completedAt`/`correctionWorksheetId` 创建后不可变；`correctionAudit[]` 始终存在（可空）、append-only；`effectiveResult` 从 `correctionAudit` 推导（为空则=`originalResult`，否则=最后一条的 `toResult`）。避免了"直接改 result"和"纠正次数决定 schema 形态"两种反模式。
  4. **双重幂等 + 乐观并发**：提交用 `redoSubmissionId`（同 id 不重复建记录，不同 id 即使同结果也各计一次）；纠正用 `correctionRequestId` + `expectedEffectiveResult`（同 id 不重复审计事件；预期状态不匹配时拒绝，不静默覆盖迟到的旧纠正；已处于目标值时 no-op，但三条规则共同生效、互不替代）。
  5. **纠正不新增重做、不触发错因分析、不改 `aiSuggestionSnapshot`/`confirmedCause`**，不记录操作者角色。
  6. **纯照片错题的重做闭环是数据完整、展示降级**：完整参与 `RedoAttempt` 记录/推导/纠正机制，但没有基于干净原题的应用内"直接重做"，也不允许裁剪/遮盖笔迹伪造干净版本（MVP 无此能力）；UI 须显式提示"缺少干净原题，无法提供无历史痕迹的题目视图"；仍可在题库详情提交实际重做结果或先"复习后重做"。写入 D18、question-bank spec 展示时机 Requirement、task 8.9/8.10。
  7. **不虚构"当前作答"**：提交结果后是"解除对历史内容的隐藏"，不是"历史与当前的比较"——MVP 不采集、不保存重做后的新作答照片/内容。
  8. **`correctionWorksheetId` 服务端强制校验**：worksheet 确实包含该题、同一 Child、调用者有权访问，不信任客户端 id。
  9. **打印约束落回 `correction-worksheet` spec**（新 Requirement，不在 question-bank 重复整套模型）。
  10. **顺手补齐 P1(6) 遗漏**：D4 的 `ErrorQuestion` 实体图补上了 `aiSuggestionSnapshot`/`confirmedCause`（P1(6) 落地时忘了同步回 D4 图，这次一起修）。
  实际改动：`design.md`（D4 图 + 新增 D18）；`specs/question-bank/spec.md`（新增 3 条 Requirement，共 19 个场景）；`specs/correction-worksheet/spec.md`（新增 1 条 Requirement）；`proposal.md`（Why + What Changes）；`tasks.md`（新增 8.8–8.11、9.6）。`openspec validate "math-error-correction-mvp" --strict` → **passed**（2026-09-19，紧接编辑之后单独运行确认）。
- **Files & locations**:
  - `design.md` D4 — `ErrorQuestion` 无重做状态/次数字段
  - `proposal.md` — "Why"把薄弱点分析/复习闭环定位成"未来"，与决定 8（MVP 需要轻量重做回收闭环）不一致
  - `specs/correction-worksheet/spec.md`、`specs/question-bank/spec.md` — 均无重做结果记录需求
  - `tasks.md` — 无对应任务
- **Evidence**: 决定 8、14（题目级状态 已改正/仍然做错/尚未检查，人工标记；重做前"直接重做/复习后重做"用户自选展示时机）。
- **Expected state**: D4 新增重做状态字段；`question-bank` spec 或新增能力描述新增重做记录需求及场景；`proposal.md` "What Changes" 反映这是 MVP 能力而非纯未来目标；tasks.md 新增任务。
- **Impact**: 决定 8 是你明确定的 MVP 硬性能力，当前完全没有落地路径。
- **Recommended artifact**: `proposal.md` + `design.md`（D4） + `specs/question-bank/spec.md`（或新增 spec） + `tasks.md`
- **Suggested fix**: 留到处理此 issue 时展开。
- **User decision needed?**: No。

#### P1(8): 多孩子档案模型与 D4"MVP 只有一个 Child"直接冲突，且无 onboarding/切换流程描述
- **Status**: Consistent
- **Notes**: Resolved 2026-09-17. 经过两轮用户修正后落地，关键修正点：
  1. **绑定语义按实体分开、不共用一条规则**：`GradingSession` 创建时从 `currentChildId` 读取并永久绑定；`ErrorQuestion` 的 childId 完全继承自其 `GradingSession`，任何时候都不读取 `currentChildId`；`CorrectionWorksheet` 的 childId 从生成时所选 `ErrorQuestion` 集合推导（集合内须同一 Child），同样不读取 `currentChildId`——即使生成那一刻 `currentChildId` 已切换，只要所选错题集合内部一致，订正卷仍归属该一致的孩子；混合不同孩子的错题必须拒绝。首版方案曾把三个实体错误地合写成"都从指针读取"，已修正。
  2. **新增 `currentChildId` 安全/完整性不变量**：必须指向该 User 自己拥有的 Child；拒绝提交/设置为其他 User 的 Child；首个孩子创建后立即成为当前孩子；只要 User 有 Child，指针必须始终有效；服务端创建 `GradingSession` 时须重新校验 childId 归属，不信任客户端提交值。落在新 spec 的独立 Requirement，并写入 task 5.8/5.9/5.10 的 verify。
  3. **`WorksheetArchive` 维持选项 A**（User 级家庭共享），不因 `currentChildId` 而具有 Child 归属，可被不同孩子的 `GradingSession` 复用；`specs/child-profile/spec.md` 单独一条 Requirement 覆盖这点。
  4. **`proposal.md` Impact 原句"MVP 不实现多用户/多孩子管理能力"确认为真实冲突**（不是"隐含"），已改为明确允许多孩子档案、排除独立登录/删除/合并/邀请等完整管理能力。
  5. **`design.md` "## Migration Plan" 第 3 条**（复审时新发现，原方案未提及）：原文"User/Child 记录由首次 OTP 登录自动创建"与孩子档案 onboarding（需要用户主动创建，而非登录时静默生成）矛盾，已改为只在登录时自动建 User，Child 通过 onboarding 由用户创建；`tasks.md` 5.4 同步收窄为只负责 User 的自动创建。
  6. **只读搜索确认**（用户要求）：`proposal.md`"New Capabilities"清单是唯一列出全部 capability 名字的地方，已加第六条；`design.md` D4 标题"四个领域实体"指的是 `WorksheetArchive`/`GradingSession`/`ErrorQuestion`/`CorrectionWorksheet` 四个实体（不含 `User`/`Child`），`child-profile` 不新增第五个此类实体，标题无需改动；`tasks.md`/`.openspec.yaml`/`specs/`（glob）均无需要同步的枚举点。
  实际改动：`design.md`（D4 实体图 + "多用户/多孩子扩展"段落 + Migration Plan 第 3 条）；新建 `specs/child-profile/spec.md`（9 条 Requirement）；`proposal.md`（What Changes 新增一条、New Capabilities 新增一条、Impact 第 4 条替换）；`tasks.md`（Group 5 标题改为"Auth, Access Control & Child Profile"、5.4 收窄、新增 5.7–5.11）。`openspec validate "math-error-correction-mvp" --strict` 与 `openspec status --json`（确认 child-profile 为第六个 capability）结果见对话记录。
  **P1(3) 仍未处理**：`tasks.md` 8.1 未改动，按计划留到下一轮，使用本条确立的"继承自 GradingSession 创建时绑定的 childId"措辞。
- **Files & locations**:
  - `design.md` D4 — "多用户/多孩子扩展"："MVP 只有一个 User 和一个 Child，不实现管理界面。"；四实体分组：`WorksheetArchive` 归属 **User**（家庭共享），`GradingSession`/`ErrorQuestion`/`CorrectionWorksheet` 归属 **Child**。
  - `proposal.md` — Non-Goals 隐含单孩子假设（未直接冲突，但需要确认"多用户管理"这条 Non-Goal 的边界仍然成立）
  - `specs/` — 无任何孩子档案创建/切换/默认当前孩子的需求
  - `tasks.md` — 无对应任务
- **Evidence**: 决定 9、11（登录后检查孩子档案、默认当前孩子、允许新建第二个及以上孩子、最低能力）与 D4 现有文字直接冲突。
- **待用户确认的架构分叉（阻塞方案定稿）**：决定 11 写"新增的 PDF……归属当前孩子"，与 D4 现状"`WorksheetArchive` 归属 User（家庭共享）"冲突。
  - **选项 A（推荐）**：维持 `WorksheetArchive` 为 User 级共享库；决定 11 那句理解为"上传时的操作上下文默认是当前孩子"，不代表 PDF 资产本身要打 Child 标签。
  - **选项 B**：把 `WorksheetArchive` 也改成 Child 级私有，两个孩子用同一份卷子要分别上传。
- **已分析的三点正确性问题（用户在上一轮指定）及结论**：
  1. `GradingSession` 创建时从"当前 Child 指针"读取一次 childId 并**永久绑定**——成立。
  2. `ErrorQuestion` 提交时**继承所属 GradingSession 的 childId**，不得在提交时重新读取全局当前 Child 指针——成立，且是最容易被实现错的一点（批改流程可跨设备/跨会话中断，中途"当前 Child"可能被切换又切回）。
  3. 切换当前 Child **不改变**已有 `GradingSession`/`ErrorQuestion` 的归属——成立，是 1、2 的直接推论；要求"当前 Child 指针"（可变，建议持久化在 User 一级，因决定 9 要求"默认进入上次使用的孩子"）与"实体创建时绑定的 childId"（不可变）是两个独立概念，D4 目前未做这个区分。
  - **衍生发现**：`CorrectionWorksheet` 的 Child 归属应从其关联的 `ErrorQuestion` 集合派生，并要求这些 `ErrorQuestion` 属于同一 Child（不允许一份订正卷混合两个孩子的错题）——这条约束目前也不存在于任何 artifact。
- **Expected state**: D4 改写为"一个家庭账号可含多个 Child + 一个持久化的当前 Child 指针；`GradingSession`/`ErrorQuestion`/`CorrectionWorksheet` 创建时绑定 childId 且之后不可变；`ErrorQuestion` 继承其 `GradingSession` 的 childId；`CorrectionWorksheet` 要求其 `ErrorQuestion` 集合同属一个 Child；切换指针不影响已有绑定"；`WorksheetArchive` 按选项 A/B 之一处理（待定）；新增 spec 需求覆盖 onboarding/默认当前孩子/新建切换/归属不变量；`proposal.md` Non-Goals 加一句"多孩子档案 ≠ 多登录用户"的区分；`tasks.md` 新增对应任务（含绑定时点、切换不影响历史归属、CorrectionWorksheet 同 Child 校验的 verify）。
- **Impact**: 直接的文字冲突（design 现在明确说的是错的，按新决定）；影响面广——所有归属 Child 的实体都要重新确认"当前孩子"语义；也与 P1(3) 相交（8.1 的 verify 最终要用"继承自 GradingSession 的 childId"这一精确措辞，而非泛泛的"某个 Child"）。
- **Recommended artifact**: `design.md`（D4）+ 新/改 spec 需求 + `proposal.md`（Non-Goals 措辞）+ `tasks.md`
- **Suggested fix**: 见 Expected state；具体文字等用户对架构分叉表态后再落笔。
- **User decision needed?**: **Yes** — WorksheetArchive 归属选项 A/B 待确认；三点正确性结论待用户最终审核批准（分析已完成，方案未批准）。

#### P1(9): 三层切题验收范围（数字原生 PDF 正式 / 扫描件探索性 / 纯照片探索性）未体现在任何验收标准或评测样本定义中
- **Status**: Consistent
- **Notes**: Resolved 2026-09-18，经初版方案 + 十项修正 + 三项精确修正共两轮修正后落地。关键点：
  1. **可追溯检测记录，非单一可变字段**：`WorksheetArchive` 持有 append-only 的 `PdfTypeDetectionAttempt[]`；单条 attempt 合法迁移仅 `pending→completed`/`pending→failed`，均为终态，终态字段不可再改；重试创建新 attempt，不复用/复活旧 `failed` attempt；"append-only"修饰的是 attempt 集合与已达终态的历史记录，不是说单条 attempt 不能完成状态迁移。
  2. **当前生效判定取最新一条 attempt**：completed 用其 detectedInputType；pending/failed/无记录一律 `unknown`；不得跳过更新的 pending/failed 去复用更早的 completed/digital_native 结果——这是对初版草案"取最新 completed 记录"这一漏洞的修正。
  3. **检测职责完全收拢到 D11 Python 服务**：PDF 结构/文字层提取、页面图像分析、字体矢量对象检测、逐页一致性分析均归 D11；Next.js 只负责触发任务、持久化/读取记录、渲染 UI 提示，不实现任何 PDF 结构判断逻辑。
  4. **Fail-closed 判定替代不可证明的"绝不"断言**：只在满足已校准并冻结的充分证据时输出 `digital_native`；记录 confusion matrix；`scanned/mixed-or-ambiguous`（真值）→ `digital_native`（输出）这一格单独标记为最高风险误判类别，是 calibration 阈值选择的首要约束目标。
  5. **检测器自身也需要 calibration/held-out**：人工真值仅 `digital_native`/`scanned`/`mixed-or-ambiguous` 三类（`unknown` 是检测器输出状态，不是人工标签）；`detectionVersion` 与阈值在 held-out 评估前冻结，同版本内不得依据 held-out 结果反复调参，需要调整则产出新版本重新走 calibration→冻结→held-out。
  6. **mixed/ambiguous 双重评测角色 + 标注前置条件**：既参与检测器 confusion matrix 评测，也作为区域定位的独立探索子集实际运行；数据集 B 复用数据集 A 的 PDF 资产前，SHALL 另行补齐区域定位专属人工 ground truth（目标题号、正确题目边界、内容完整性判断、崩盘判断依据），不得默认已具备。
  7. **区域定位/整页题目分割指标精确定义**写入 D19（区域定位：漏框率、框不准率；整页题目分割：漏框率、框不准率、false-positive/duplicate/merge-error 率），并要求 D19/6.2/6.3 三处共用，不各自变体。
  8. **数字原生正式轨道"单份不崩盘"落地为可执行条款**：calibration 阶段冻结整体阈值、"正常清晰样本"资格定义、单份崩盘判定规则；held-out Gate 同时验证整体达标与无资格样本崩盘；scanned/mixed/纯照片三条探索轨道只记录逐样本崩盘情况供观察，不构成正式否决。
  9. **四个命名数据集**：A（PDF 类型检测器，calibration+held-out）/ B（区域定位，digital_native calibration+held-out 正式 Gate + scanned/mixed-or-ambiguous 探索）/ C（整页题目分割，批改照片探索，要求人工标注全部真实题目及正确边界）/ D（跨页/out-of-scope 压力测试，单独收集，不进任何正式 Gate）。
  10. **范围收窄确认**：分层验收仅作用于**区域定位**契约；错题识别（仅批改照片输入）、知识点标签/题型分类（题目裁切输入）不按本决策拆分；整页题目分割沿用既有 P1(4)/D15 探索轨道，不因本决策新增维度。
  11. **UI 最小化非断言**：仅四种状态对应提示（pending/unknown/scanned 有提示文案，digital_native 无提示），不向家长暴露 `detectedInputType`/`detectionVersion`/`confidence` 等技术字段，所有提示均非断言措辞。
  12. **异步可靠性**：检测异步、不阻塞上传、durable/可重试、幂等、崩溃后不永久卡在 pending（转可重试或由 reconciliation 拾取并创建新 attempt）。
  实际改动：`design.md`（新增 D19、D4 `WorksheetArchive` 块新增 `PdfTypeDetectionAttempt[]` 行、D13 评估方法第2点+指标清单第3点各补一句）；`specs/worksheet-archive/spec.md`（新增"检测 PDF 类型"与"扫描件与未知类型 PDF 可正常使用"两个 Requirement，共 7 个场景）；`tasks.md`（新增 3.6、新增 4.11、重写 6.2 为四数据集结构、6.3 追加检测器 confusion-matrix 执行 + 区域定位分桶执行 + 整页分割指标记录条款）。`openspec validate "math-error-correction-mvp" --strict` 与 `openspec status --json` 结果见下方本次会话记录。
- **[原始记录与历次修正对话，保留供追溯——十项修正见本条目历史版本，三项精确修正（attempt 状态迁移矛盾、生效判定漏洞、mixed/ambiguous 标注前置条件）已全部体现在上方落地要点中]**

#### P1(10): tasks.md Group 4 把手动画框当基线、AI 在 Group 7 才接入，与"自动切题是 MVP 最低标准"直接冲突
- **Status**: Consistent
- **Notes**: Resolved 2026-09-20，经一轮修正落地（完整落地细节见上方 checkpoint 记录）。核心结构：Group 4 只建真实、永久的基础组件（上传、D14 页面确认、裁切→订正卷管道），不提供任何错题确认入口；4.3 降级为纯开发期 fixture（无浏览器 UI、家长不可访问、数据隔离/可清理、生产环境不可用，13.5 校验）；Group 7 净新建 PDF-backed 的 `full_page`+点选正式入口（7.1）、非阻塞预高亮（7.2）、D20 修复调度（7.3，按失败原因区分重试/重选页面/换照片，且 `full_page` 空结果不是批次终态）、页面推荐增强（7.4，非硬依赖）、无 PDF 路径（7.5，保留并明确共享组件边界）、recompute 不覆盖已确认事实校验（7.6）、真实端到端走查（7.7，明确不冒充 Group 8–10 功能）；全仓引用扫描后修正了 8.1（只消费 Group 7 权威确认集合）、13.2（去掉"manual-fallback"措辞）。
- **[原始记录，保留供追溯]**
- **Files & locations**:
  - `tasks.md` Group 4 标题："Walking Skeleton … (manual-only paths, no AI yet)"；4.3/4.4 均以"starting from an empty list / no box in manual-only mode"为基线
  - `tasks.md` Group 7 标题："Wire AI-Assisted Paths Into Existing UI"——AI 是在手动 UI 建好之后才"接入"的增效
- **Evidence**: 决定 1（AI 自动切题+点选是 MVP 正常入口，手动画框只是异常兜底）与当前任务分组的先后顺序、措辞直接冲突——现状是"先做纯手动、AI 是后加的增强"，决定 1 要求的是"AI 是常规路径、手动是异常兜底"。
- **Expected state**: 需要重新安排 Group 4/6/7 的任务顺序或措辞，使 AI 自动切题成为"正常路径"的一部分尽早验证，手动画框明确标注为异常恢复路径而不是阶段性基线。具体重排方式建议在处理此 issue 时与你确认——是重排任务顺序，还是保留顺序但改措辞说明"Group 4 的手动实现是为了先打通数据管道，Group 7 起才是用户会看到的正常入口"。
- **Impact**: 这是本轮访谈里对现有 `tasks.md` 结构影响最大的一条，建议在处理完 P1(1)/P1(4)-(9) 之后再处理，因为具体重排依赖那些 issue 先确定新增了哪些任务。
- **Recommended artifact**: `tasks.md`（Group 4、6、7 结构）
- **Suggested fix**: 留到处理此 issue 时展开，需要先问你倾向"重排任务顺序"还是"保留顺序改措辞"。
- **User decision needed?**: Yes — 处理到这条时会问。
- **Notes**: 建议排在本轮 interview 相关 issue 的最后处理，因为它依赖其他 issue 先落地。

  **2026-09-18 更新**：P1(11) 已落地（见其记录），确定有 PDF 主路径正常入口为整页分割 `full_page`+点选、错题识别降级为非阻塞预高亮、区域定位降级为定向修复；D20 与 tasks 3.7/3.8、6.1–6.5 已按此实现。P1(10) 现在需要重排/替换的具体任务：
  - Group 4 的 **4.4**：page-picker 部分（D14）不受影响；但其"手动逐题画框"部分与决定 2 的"自动切题场景不要求从零手绘"原则冲突（同 4.8 已经不提供手动分割 UI 的先例），需要重新设计，很可能整页-分割 UI 要等 Group 6/7 才出现，Group 4 阶段不再有通用的手动多框工具。
  - Group 4 的 **4.5–4.7**：依赖 4.4 提供"已确认区域"的方式，若 4.4 的通用手动多框 UI 被移除，4.5–4.7 需要一个最小单区域路径来在 walking-skeleton 阶段继续验证裁切→订正卷 pipeline。
  - Group 7 的 **7.1**（原：把错题识别接入 4.3 的题号列表）与 **7.2**（原：把区域定位接入 4.4 的框）：其原有目标已被 D20 取代，需替换为新的"预高亮 wiring"任务和"区域定位定向修复 wiring"任务。
  - Group 7 需要新增 **PDF-backed 版 7.5**（整页分割 `full_page`+点选+预高亮+修复调度的 wiring），当前 7.5 只覆盖无 PDF 路径。
  - Group 7 的 **7.4**（D14 页面选择 AI 推荐）不受影响。

#### P1(11): 有 PDF 主路径下，现有"错题识别"/"按题号区域定位"契约与"整页分割+用户点选"模型之间的关系尚未统一
- **Status**: Consistent
- **Notes**: Resolved 2026-09-18，经两轮修正落地。关键点：
  1. **正常入口确定为整页分割+点选**：有 PDF 主路径不再是"错题识别产出题号列表→逐题区域定位"，而是"整页题目分割 `full_page` 模式（PDF-render 输入）→家长点选/取消选择"，与决定 1 的字面表述及既有无 PDF 路径 UX 一致。
  2. **错题识别降级为非阻塞预高亮信号**：移出 D5 Human Gate 表，移入非阻塞建议表；其 Selection Gate 离线评测明确使用人工标注的批改照片 ground truth（false pre-highlight rate/correct pre-highlight recall/unavailable rate 等），明确不依赖开发阶段不存在的真实家长行为数据；上线后的"家长取消预选比例"是独立的生产观测指标，不替代/不混入离线 Gate 结果。
  3. **区域定位降级为定向修复**：仅在"已知题号但整页分割未提供可用框"场景触发；仍须通过官方支持/出站可达/结构化输出等硬治理检查，但结果不再决定 MVP 正式 Gate 通过/否决，改记修复成功率。
  4. **新增确定性步骤 `QuestionBoxNumberAssociation`**（D11，非 AI Task Contract，不调用 Provider）：框↔题号关联，数据结构含 `associationStatus: reliable|ambiguous|unavailable` 等字段；只有 reliable 且一对一才驱动预高亮；有独立的人工标注 calibration/held-out 拆分（task 3.7），阈值/`associationVersion` 冻结后不得在同版本内反复调参。
  5. **新增页面级预确认可靠性信号**（task 3.8）：与 D16 的"已确认区域→照片证据映射"（task 3.5）明确区分为两个独立执行时点，不得绑定；预高亮所需信号在任何单题确认前即可获得，不依赖 D16 已执行。
  6. **两种 invocation mode 判别式接口**：`full_page`（image→`QuestionBoxCandidate[]`）与 `locality_retry`（image+hint→零个或一个 `LocalRepairCandidate`），响应类型判别式区分，不共用同一列表形状；正式 Gate 只评 `full_page`+PDF-render 原始输出，`locality_retry` 单独评修复能力。
  7. **修复调度顺序要求题号与点击位置空间相符**：唯一 reliable 缺号 **且** 与点击位置空间相容（达校准可靠标准）才优先调用区域定位；任一条件不满足直接走 `locality_retry`；不得仅凭"全页只剩一个缺号"忽略点击位置。
  8. **正式 Gate 集合修正为三项契约/模式**（整页分割 `full_page`+PDF-render、知识点标签、题型分类），用显式 Gate/track 表格解决了上一版草案"三个正式契约"与"PDF-render 整页分割也是正式"并存的自相矛盾。
  9. **D19 Dataset B 实质重写**：从"单一目标题号+单一边界"标注改为"页面全部真实题目+每道正确边界+完整性/FP/duplicate/merge-error/崩盘判定依据"，明确不是简单更名沿用；`QuestionBoxNumberAssociation` 可复用其 PDF/框资产但须另行补齐题号标签层。
  10. **P1(11)/P1(10) 边界**：本轮只完成契约/决策层最终形状（D5/D13/D15/D19/新增 D20、grading-workflow spec、task 3.7/3.8、Group 6 的 6.1–6.5）；Group 4/7 的具体任务编排（替换 7.1/7.2、PDF-backed 版 7.5、4.4/4.5–4.7 的 walking-skeleton 调整）明确留给仍 Open 的 P1(10)，不描述为已有完整任务顺序。
  实际改动：`design.md`（D5 重写三张表、D13 三处改写+新增修复支持轨道治理段、D15 两处关闭开放项、D19 三处改写、新增 D20）；`specs/grading-workflow/spec.md`（替换 4 个 Requirement 为 4 个新 Requirement，共 13 个场景）；`tasks.md`（3.5 追加交叉引用、新增 3.7/3.8、改写 6.1/6.2/6.3/6.4/6.5）。`openspec validate "math-error-correction-mvp" --strict` → 见下方验证结果。
- **[原始记录，保留供追溯]**
- **Files & locations**:
  - `design.md` D5 — "错题识别"（输入批改照片→错题编号列表）、"区域定位"（输入 PDF 页面渲染+目标题号→单一边界坐标）两个现有契约；新增的"整页题目分割"契约（P1(4)）当前只服务无 PDF 路径
  - 决定 1（访谈记录）——"AI 整页切题+点选"是通用交互原则，原话未限定于无 PDF 场景
- **Evidence**: 决定 1 不区分有无 PDF，但现有"错题识别+区域定位"两步流程是在有 PDF 场景下建立的（AI 先从照片猜错题号，再逐题在 PDF 上定位），尚未确认这套流程是否也要改为"整页分割+用户点选"，或"错题识别"是否降级为仅供参考的预高亮建议。
- **Expected state**: 待定——不预设答案，处理时需要用户在以下方向中选择（或提出其他方案）：(a) 有 PDF 场景维持现状两步流程不变，"整页题目分割"契约保持仅服务无 PDF 路径；(b) 有 PDF 场景也采用整页分割（契约输入扩展为同时支持 PDF 页面渲染），"错题识别"降级为预高亮建议、用户点选做最终确认；(c) 其他方案。
- **Impact**: 影响 D5 契约边界、D13 评估范围、`tasks.md` Group 6/7 的任务结构；与 P1(10)（Group 4/7 结构收尾）密切相关。
- **Recommended artifact**: `design.md`（D5）+ `tasks.md`（Group 6/7）+ 可能 `specs/grading-workflow/spec.md`
- **Suggested fix**: 待定，处理时先问用户倾向哪个方向，不预设答案。
- **User decision needed?**: Yes — 处理到这条时会问。
- **Notes**: 新增于 2026-09-18（处理 P1(4) 时发现）。处理顺序——排在 P1(9) 之后、P1(10) 任务结构收尾之前。

#### P2(1): design D5 and D6 lack the explicit rationale / alternatives subsection that D1–D2 and D7–D13 carry
- **Status**: Consistent
- **Notes**: Resolved 2026-09-20，经一轮措辞修正落地。仅补充 D5/D6 的"理由"与"替代方案"说明，无行为变化——不新增/修改任何 Requirement、字段、Task Contract 或 task，不重新打开任何已解决的 P1。关键点：D5 理由区分三种结果流转语义（Human Gate/自动降级/非阻塞建议）及其各自的确认摩擦-风险权衡，题型分类的风险表述改为"影响派生展示/排版、风险有界（有默认空间兜底）"而非"无正确性风险"；错题识别与错因分析的确认语义分开表述（前者无独立 Human Gate 因权威选择已由框集合确认完成，后者是非阻塞可选确认，呼应 D17 的 `confirmedCause`/`aiSuggestionSnapshot`）；D5 替代方案列出并否决单一万能接口、统一 Human Gate、统一自动采信、单一置信度分数驱动确认。D6 理由收窄为"仅当 AI 输出可能按 D5 契约语义进入权威业务事实时才需候选→确认"，明确题型分类/错题识别/未确认错因建议均不因此违反 D6，并显式交叉引用 D14/D16/D17/D18/D20 作为该通用原则的具体领域实例；D6 替代方案的"软覆盖+历史"否决理由改为"即使历史仍在，自动改变当前权威值本身就违反原则"（不再声称历史丢失），"锁定/解锁机制"改为"MVP 未采用"（不是此前被否决的方案），并明确未来若需要显式重新分析/重新确认可由独立 Change 设计。实际改动：`design.md`（D5 结尾插入理由+替代方案；D6 结尾插入理由+替代方案）。`openspec validate "math-error-correction-mvp" --strict` → 见下方本次会话记录。

#### P2(2): a few scenarios are only verifiable via their paired task, not on their own
- **Status**: Consistent
- **Notes**: Resolved 2026-09-20，经一轮措辞修正落地。`correction-worksheet` 的"计算题预留足够空间"改为按题型配置的答题区域参数（计算题配置 vs 填空题/选择题紧凑配置，前者预留纵向高度 SHALL 大于后者，具体数值留至实现阶段真实样张校准）+ 最终区域必须位于可打印区域内、不与相邻题目重叠、不被页面边界裁剪（排版实现方式如是否分页留至实现阶段，不在 spec 中规定）；三个 Scenario 全部重写，不再出现"足够/适当/较小/明显大于"这类无参照词。`access-control` 的"认证后可正常访问"拆分为独立 Requirement + 2 个 Scenario：正向场景明确要求"资源归属请求者自身账号或其有权访问的 Child + 该资源所属 capability 自身的其他前置条件已满足"三个条件同时成立才允许访问（不是"登录即放行"）；新增负向场景"已认证用户不能访问其他账号归属的资源"，沿用现有 User/Child 归属边界，未引入 Tenant 实体。因新增负向场景，同步修改 `tasks.md` 5.6：验证范围收窄为 access-control 自身的资源访问边界（不重复实现 5.5 的认证逻辑或 5.8–5.10 的 Child 归属绑定逻辑），要求直接对服务端/API 发起请求验证（正向：自身账号代表性资源在其他前置条件满足时可达；负向：请求另一 User 账号下的 WorksheetArchive/GradingSession/ErrorQuestion 被拒绝），不能只检查 UI 元素是否隐藏。9.1（已有"calculation questions receive a larger answer space, fill-in/multiple-choice questions receive a smaller answer space"）与 5.6 修改后的验证范围保持一致，均未改动 9.1 本身。全量搜索"足够空间/适当答题空间/明显大于/较小答题空间/全部数据和功能"确认无残留（结果见下方本次会话记录）。实际改动：`specs/correction-worksheet/spec.md`（Requirement 标题+正文+三个 Scenario 全部重写）；`specs/access-control/spec.md`（移除孤立场景，新增 Requirement + 2 Scenario）；`tasks.md`（5.6 重写）。design.md/proposal.md 未改动。`openspec validate "math-error-correction-mvp" --strict` → 见下方本次会话记录。

#### P2(3): D6's "跨设备继续操作 / 重新登录" durability is only exercised as "survives a page refresh"
- **Status**: Consistent
- **Notes**: Resolved 2026-09-20，经一轮措辞修正落地。判断结论：D6 本身已完整列出四类会话中断（刷新/关闭浏览器/重新登录/跨设备）且已含 `aiSuggestionSnapshot` 的更宽保护规则，不需要修改；所有 spec Scenario 同样不需要修改（这套文档一贯把"业务规则"放在 spec、"针对具体中断条件的验证"放在 tasks，D14 等既有 Scenario 本就不提刷新/设备细节）。缺口纯粹在 `tasks.md` 验证覆盖：除 5.8（`currentChildId`，已完整覆盖 logout/login + fresh device/session）外，其余已确认事实（D14 页面对应、D20/7.1 权威框集合、D16/4.10 作答证据区域、8.1 ErrorQuestion、8.3 知识点、8.6 `confirmedCause`、8.8 RedoAttempt、9.2 Generation Snapshot）均只有"持久化"表述，未显式验证跨中断存活；4.4 仅验证到"页面刷新"一级。落地方式：不逐个修改这些任务（避免在多处重复实现持久化验证逻辑），新增单一集中式任务 `tasks.md` 13.6，覆盖四类会话中断（刷新/关闭重开浏览器/同浏览器 logout→login/无共享浏览器存储的跨浏览器或跨设备登录，后者明确要求不得靠复用浏览器状态伪装），对上述代表性事实逐一验证存活+恢复到最后一个明确确认的 checkpoint；`aiSuggestionSnapshot` 额外验证恢复后是原快照/版本而非被新分析替换；Generation Snapshot 验证复用 9.2/9.3 的既有重新获取机制，不重新实现生成逻辑；知识点标签与 `confirmedCause` 作为两个独立已确认事实分别验证，不用 "and/or" 含糊处理；未确认候选/预高亮/边界拖动/未提交表单明确"允许不恢复，但恢复与否都不得被静默提升为已确认事实或进入下游权威数据"，不要求跨设备草稿同步；`currentChildId` 明确复用 5.8 的既有验证结果，不重新设计/实现。13.6 明确声明不覆盖 D6 的 AI 重算/派生资产重新生成两类操作（这两类仍由 7.6/D20、8.3/8.6、9.4 等既有任务各自验证）。实际改动：仅 `tasks.md`（新增 13.6）。`design.md`/`proposal.md`/所有 `specs/*/spec.md` 均未改动。`openspec validate "math-error-correction-mvp" --strict` → 见下方本次会话记录。

#### P2(4): `specs/worksheet-archive/spec.md` 未区分 PDF 类型，无法承载三层验收范围
- **Status**: Consistent
- **Notes**: Resolved 2026-09-18，随 P1(9) 一并落地，不是被跳过或单独处理。`specs/worksheet-archive/spec.md` 新增的"检测 PDF 类型"与"扫描件与未知类型 PDF 可正常使用"两个 Requirement（见 P1(9) 记录）直接覆盖本条目的 Expected state——扫描件/未知类型/检测失败的档案可正常上传、命名、选用，系统设定"自动切题效果为尽力而为"预期，不阻止使用。`design.md` D19 是这两个 Requirement 的设计依据。`openspec validate --strict` 结果见 P1(9) 记录/下方本次会话记录（同一批编辑一并验证）。
- **[原始记录，保留供追溯]**
- **Files & locations**: `specs/worksheet-archive/spec.md` — "上传并命名卷子档案"未对 PDF 类型作任何区分
- **Evidence**: 决定 4（数字原生 PDF = 正式验收范围；扫描件 = 尽力而为）需要在上传/归档层面有据可依，否则 P1(9) 的三层验收在 spec 层面无落点。
- **Recommended artifact**: `specs/worksheet-archive/spec.md`
- **User decision needed?**: No。

### Open Questions
- (原 P1(1) 的决策问题已在访谈中解决，见 Confirmed Product Decisions 第 12 点，不再是待答问题。)
- 具体数值阈值、C 路径机制、"孩子模式"等——见上方"仍未决定，不在本轮 refine 范围内"列表，明确不在这轮 refine 中处理。

## Future Change Candidates

### online-choice-redo-mvp

- **目标**：将多道选择类错题组织成一次可以连续完成的在线订正练习，解决现有产品中错题以零散单题卡片存在、无法方便组成一套在线复习题的问题。
- **初步范围**：
  - 第一版只支持单选题；
  - 多道错题可以组成一次在线练习；
  - 题目继续使用干净原题图片展示，保留公式、表格和图形，不要求重新结构化排版题干；
  - 在图片下提供 A–D 选择按钮；
  - 保存孩子本次选择的答案；
  - 存在可信且已经人工确认的正确答案时，可以自动判定"已改正/仍然做错"；
  - 不存在可信正确答案时，仍允许提交，但状态为"待检查"，不得让 AI 未确认答案直接成为权威判题依据。
- **未来需要设计的内容**：
  - OnlinePracticeSet/在线练习集模型；
  - `RedoAttempt` 中本次新作答证据和选择答案；
  - 正确答案来源及可信度：答案页、家长确认、AI 候选；
  - 自动判定、待检查及答案修正后的状态语义；
  - 在线练习进度保存、统一提交和结果展示。
- **明确不在当前 Change 中落地**：
  - 不修改当前 `math-error-correction-mvp` 的 proposal/spec/design/tasks；
  - 不重新打开已经完成的 P1(7)/D18；
  - 不在当前 refine 过程中创建或实现此 Change；
  - 当前优先完成 P2(1)–P2(3)、整体复核和 safe-commit。
- **后续动作**：当前 `math-error-correction-mvp` 完成并提交后，再创建独立 OpenSpec Change：`online-choice-redo-mvp`，进行单独的需求采访、spec、design 和 tasks。
