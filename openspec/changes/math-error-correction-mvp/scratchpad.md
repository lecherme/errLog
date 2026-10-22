## math-error-correction-mvp Refinement Scratchpad

Tracks openspec-refine issues and working decisions for the `math-error-correction-mvp` change.
This is a working document, not a spec artifact.

## Current Implementation Handoff

- This section is the authoritative current handoff; later historical refinement notes
  may contain superseded point-in-time wording.
- Handoff verified: 2026-10-22 (Asia/Shanghai).
- Planning baseline: completed and committed in `aff5550317f99a9acf82fc6c480d617fa18198e5`;
  later planning amendments (e.g. refine P1(12): design D21 + task 1.5; P1(15): task 1.4
  scope) are tracked through Git history, not by this SHA.
- Implementation workflow is committed in `431413ee4484814002db0fe4022d1c87fe1a256e`;
  the cross-agent review handoff was added in `f14fc6f` (H1), made a default gate with
  a contract channel in `f1a6d44` (H2), and gained the delivery channel and guarded push
  in `681fe533` (H3).
- Implementation progress: 5/89 tasks (1.5 checked in the S1.5 closing batch).
- Application skeleton: S1.1 `e02c65f`, S1.2 `c960445`, S1.3 `d297b45`, S1.4 `ef84170`
  (tasks 1.1–1.4), all committed and pushed.
- Active Stage Contract: S1.5 (task 1.5 only) — contract handoff revision 6 Codex `OK`;
  user-approved 2026-10-22 with Q1–Q7 = A (supersedes the revision 2 approval).
- Active Implementation Checkpoint: see "Implementation Checkpoint" section below.
- Repository-local remote CI configuration observed at handoff: none committed (the
  S1.5 workflow exists only in the uncommitted worktree); every new session must re-check
  actual remote CI/check status rather than trust this snapshot.
- Git state observed before this checkpoint edit: HEAD `681fe533`, synchronized with
  `origin/experiment/install-opsx-refine`; the worktree holds the uncommitted S1.5
  work listed below; every new session must re-inspect branch/HEAD/upstream/worktree.
- Next action: follow the Implementation Checkpoint below.
- Historical snapshots further below in this file (e.g. "Not yet written into any
  artifact", "These are not yet reflected in any artifact", "No implementation code
  exists; this is planning-artifact refinement only") are point-in-time
  refinement-process records, not current status — current status is this handoff block
  plus the actual proposal/spec/design/tasks content.

## Implementation Checkpoint

- Stage ID: S1.5
- OpenSpec task IDs: 1.5
- stageState: ready_for_safe_commit
- Last updated: 2026-10-22 (Asia/Shanghai)
- User approval: Stage Contract S1.5 revision 6 approved by the user 2026-10-22, after
  Codex contract review `OK` (contract run `20261020T093943Z-2a7d227d`, request
  `0006-contract-request.json`, `contractSha256`
  `sha256:3e0a0a4b5b3531838cd54b191f74986bae45d401147ef90e7be367ed20f90233`).
  The earlier revision 2 approval (2026-10-21) is superseded. Choices:
  - **Q1 = A**: ESLint + eslint-config-next (exact-version devDependencies, flat
    `apps/web/eslint.config.mjs`, `npm run lint`);
  - **Q2 = A**: one Node version, 24.21.0, pinned in `.node-version`; `scripts/ci.sh`
    fails on any other version (the local gate needs Node 24.21.0);
  - **Q3 = A**: `node --test 'test/*.test.mjs'`, all four current test files; fewer
    than four files fails;
  - **Q4 = A**: gitleaks + OSV-Scanner, official images pinned by digest;
  - **Q5 = A**: after the first push the user checks, in the GitHub UI, the final
    conclusion of the `ci` workflow run (push event) for the exact pushed commit SHA;
    only `success` for that SHA counts as passed;
  - **Q6 = A**: time-boxed report-only exception for GHSA-vfj7-8cjw-p6xm only (one
    `osv-scanner.toml` entry, `ignoreUntil` 2026-11-20, exact `--config`, guards and
    the no-config self-check), accepted under the contract's threat model;
  - **Q7 = A**: the paired transitive upgrades (`baseline-browser-mapping`
    2.11.28→2.11.30, `caniuse-lite` 1.0.30001815→1.0.30001817) plus the `semver`
    `devOptional` flag change are approved together.
- Allowed paths: exactly the "Exact paths allowed to change" list of the approved
  contract below (15 paths).
- Work completed (under revision 2, kept): failing evidence F0 (`scripts/ci.sh` absent →
  exit 127); pins resolved (actions/checkout v7.0.1, actions/setup-node v7.0.0,
  actionlint 1.7.12, gitleaks v8.30.1, osv-scanner v2.6.0, images by digest; Node 24.21.0
  tarball checksum-verified in the session scratchpad, not installed globally); eslint
  9.39.5 + eslint-config-next 16.4.0 with `lint`/`typecheck` and
  `apps/web/eslint.config.mjs`; `scripts/ci-tools/`; `.node-version`; `scripts/ci.sh`;
  `.github/workflows/ci.yml`. Local passes: `workflow`, `openspec`, `python`, `web`,
  `node-tests` (85/85, no Git config), `secrets` (19 commits + worktree, no leaks).
- Work completed (under revision 6, 2026-10-22): sub-step 5a: `osv-scanner.toml` (one
  entry), `scripts/ci.sh dependencies` exception guards, OSV fixed-version check, exact
  `--config` scan, no-config self-check (exit code captured) and report-only line;
  `node-tests` fails on fewer than four test files; `docs/ci.md`, README "CI", the
  workflow-doc pointer and the SSDF rows/gaps. Local results (Node 24.21.0):
  `scripts/ci.sh all` exit 0 (116 s), and each check passes on its own; failing evidence
  for every check (workflow A1–A9/P1–P4, openspec, node-tests, web lint/type, python,
  secrets, dependencies D1–D11, compose C1–C4) fails as required; compose cleanup leaves
  no `errlog-ci-*` resource and `errlog-dev` resources are unchanged; no synthetic
  password in any log; scope gate: changed paths ⊆ allowed paths, web lockfile delta =
  new packages + the Q7 pair + `semver` flag.
- Independent stage review (fresh read-only general-purpose sub-agent, round 1): PASS,
  no blocking findings. Non-blocking fixes applied: SSDF PO.5 status `implemented` and
  remote-CI wording limited to what is configured; the then-existing project-name
  override documented in `docs/ci.md` (removed by the B1 fix below); C1–C3 evidence
  regenerated by a kept script; `secrets`, `openspec`, `workflow` re-run after the doc
  edits (exit 0). Not changed: temp `HOME`/tree copies are left in `/tmp` when a check
  fails (cosmetic). `scripts/ci.sh` must be committed as 100755.
- Implementation handoff revision 1 (run `20261022T015811Z-37fcaebd`): Codex `FAIL`, one
  blocking finding B1 (the project-name override could point a run at an existing or
  concurrent `errlog-ci-*` project, whose objects the exit trap would then remove).
  User authorized 2026-10-22 a fix of B1 only (fix round 1 of at most 2) and the
  reclassification of the two non-material deviations.
- B1 fix (round 1): `scripts/ci.sh compose` no longer accepts a project name from the
  environment; it generates `errlog-ci-<GitHub run id or local>-<128 random bits>` and,
  before the exit trap is installed, fails if any container, volume, network or image is
  labelled with or named after that project (a Docker listing error also fails), so a run
  only ever removes what it created. `docs/ci.md` and SSDF PO.5 wording updated.
  Evidence: the rev1 script with the override on a synthetic existing project removed its
  containers, data volume and image (failing first); the fixed guard refuses a full
  existing project and each object kind alone with every object unchanged, fails closed
  when Docker is unreachable, and real runs alone and two concurrently pass with the
  existing project unchanged and nothing left behind. `scripts/ci.sh all` exit 0
  (125 s, Docker state identical, no password in the log); scope gate: 14 changed paths,
  all allowed.
- Implementation and evidence notes (reclassified from "contract deviations" after the
  Codex review; none needs user approval): the `osv-scanner.toml` guard pins
  `ignoreUntil` to exactly the contract date 2026-11-20, so extending it needs a change
  to `scripts/ci.sh`; the workflow failing cases ran on temp copies with an empty `.git`
  directory (actionlint needs one), and the secrets case planted its synthetic string in
  a temporary untracked worktree directory that was removed afterwards. The contract
  deviations list is now empty.
- Independent re-review (round 2): PASS, no blocking findings; its doc-wording fix
  applied (`docs/ci.md`: only the run-id part of the name comes from the environment; the
  check-to-build window is named), `secrets` re-run exit 0.
- Implementation handoff revision 2 (`targeted_fix`, request
  `0002-review-ready.json`): Codex `PASS`, verified `valid` 2026-10-22; B1 closed.
- Closure (2026-10-22): task 1.5 checked (`tasks.md` differs from HEAD only by that
  checkbox; progress 5/89); `openspec validate --strict` valid; `secrets` exit 0; final
  scope gate: 15 changed paths, all allowed, nothing staged, `scripts/ci.sh` mode 755
  (must be committed as 100755).
- Work remaining: safe-commit `check` of this batch (stage files, `tasks.md` and this
  checkpoint), delivery commit-ready, then the user-approved commit and the separate push
  gate; after the push the user reports the `ci` run conclusion for the exact pushed SHA.
- Tests not yet run: remote CI (first run after the push).
- Blockers: none.
- Next action: run safe-commit `check`, publish delivery commit-ready, and stop for the
  user's separate commit approval.

### Approved Stage Contract S1.5 (revision 6, verbatim)

The fenced block is the exact `contractText` of the approved contract request.

````markdown
# Stage Contract S1.5 — 初始远程 CI（GitHub Actions）（revision 6 草案）

## 相对 revision 5 的变更（Codex B4，第 1 轮）
- B4：Q3-A 及其 rationale 改为以 `node --test 'test/*.test.mjs'` 运行全部四个现有测试文件，少于四个文件即失败；Q3 决定范围（四个文件），R2 决定 Node 24 兼容的 glob 写法。

## 相对 revision 4 的变更（revision 5，B3 已解决）
- B3：现行批准、checkpoint 与操作引用统一指向当前 revision；Q7 排除项为整体批准；无 config 自检显式捕获退出码（守卫 5）。

## 相对 revision 2 的变更（user_revision）
来源：revision 2 经 Codex `OK`、用户于 2026-10-21 批准（Q1–Q5 = A）后开始实施；实施中依赖扫描 baseline 发现一项无修复版本的真实漏洞，按 revision 2 "停止并报告用户"，实施已停止；用户随后要求就该 blocker 与已发现的实施偏差修订本合同。revision 2 的批准不延伸到本 revision：当前 revision（revision 6）需要新的 Codex `OK` 与用户的重新批准（含 Q1–Q5 的再次确认与 Q6、Q7）。已完成的工作保留在工作树中，本 revision 发布前不修改任何实现文件。
- R1 braces（Q6）：为 GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 定义逐项、限时的 report-only exception 及其自动失效条件（见"依赖漏洞 exception"）；其他 finding 与工具错误仍 fail closed。
- R2 node-tests：命令由 `node --test test/` 改为 `node --test 'test/*.test.mjs'`：Node 24 不再接受目录参数（`Cannot find module …/test`）；运行同样四个文件，范围不减少。
- R3 传递升级（Q7）：新增 ESLint 依赖使两个既有传递依赖升级，须由用户明确批准或拒绝（revision 4 起作为一对整体决定）；原合同的"既有依赖不升级"排除项不被视为已允许它们。
- R4 ESLint 9 支持状态：记录事实与后续升级触发条件（见"工具链事实与前置条件"）。
- R5 Node 24.21.0 本地前置条件：如实记录当前环境，并要求 `docs/ci.md` 说明新环境如何准备 Node 24.21.0。
- 路径：`.gitleaks.toml` 移除（secret baseline 无发现，无需忽略项）；`.gitignore` 移除（已有的 `node_modules/` 规则已覆盖 `scripts/ci-tools/node_modules/`）；`osv-scanner.toml` 改为本 exception 的确定文件。

## 已完成的工作（revision 2 下，保留）
- 失败证据 F0：入口不存在时 `scripts/ci.sh all` 退出 127。
- 固定（取发布满两周的最新版）：actions/checkout v7.0.1、actions/setup-node v7.0.0（均为完整 SHA）、actionlint 1.7.12、gitleaks v8.30.1、osv-scanner v2.6.0（镜像按 digest）。
- 文件：`apps/web` 的 eslint 9.39.5、eslint-config-next 16.4.0、`lint`/`typecheck`、`eslint.config.mjs`；`scripts/ci-tools/`（openspec 1.10.0、yaml 2.9.1）；`.node-version`；`scripts/ci.sh`；`ci.yml`。
- 本地（Node 24.21.0）已通过：`workflow`、`openspec`、`python`、`web`（未改产品代码）、`node-tests`（85/85，无 Git 配置）、`secrets`（19 个 commit 与工作树，无发现）。
- 未完成：`dependencies`（被 R1 阻塞）、`compose`、其余失败与清理证据、文档、完整 gate、reviewer、handoff。

## Stage ID
S1.5

## OpenSpec task IDs
1.5（仅此一项）

## Expected outcome
1. 仓库获得唯一一条 GitHub Actions 验证 pipeline `.github/workflows/ci.yml`，由 `push` 与 `pull_request` 触发，只覆盖 Group 1（1.1–1.4）结束时真实存在的代码与配置。
2. 唯一文档化的本地入口 `scripts/ci.sh`：`scripts/ci.sh all` 依次运行全部检查，`scripts/ci.sh <check>` 运行单项；CI 的每个 job 只执行 `scripts/ci.sh <check>`，不存在只在 CI 中出现的命令，也不存在更弱的本地替代。
3. `docs/ci.md` 记录检查清单、本地入口、所选扫描工具、首次 baseline 及阻塞策略（什么使运行失败、什么仅报告、原因）。
4. `docs/security/ssdf-profile.md` 只把实际达到的控制更新到实际状态。
5. task 1.5 勾选；本阶段不新增任何用户可见行为。

## Requirement / Scenario / Design 追溯
- tasks.md 1.5 全文（检查 (a)–(j)、D21 供应链约束、(i)(j) baseline 规则、单一 pipeline、禁止 Playwright/E2E 占位、13.2 不属本 pipeline），以及其 Verify 条款：workflow 定义须通过可本地运行的静态检查（`actionlint` 或等价工具）；每个 CI 等价检查在最终树上本地通过；勾选只需该本地验证加标准独立 review，推送后的首次远程运行是 post-push 复验，不是本 task commit 的前提。
- design.md D21（同一验证链、两个执行位置、命令等价、只验证真实存在的能力、数据与凭据、最小 GITHUB_TOKEN、action 锁定 SHA、禁用 pull_request_target、扫描阻塞策略依 baseline、远程失败处理）；D22（E2E 由 4.1 首次接入，1.5 不预建占位）。
- docs/implementation-workflow.md "CI"（本地 gate 与 post-push 远程 CI 分层）、"Session continuity and recovery"（远程 CI 状态检查）、"Cross-agent review handoff"（delivery channel）。
- docs/security/ssdf-profile.md：PO.3、PO.5、PS.1、PW.8、RV.1 行与 "Current gaps"。
- D21 明确本决策不对应任何 proposal/capability spec Requirement；本阶段不改变产品语义。

## Dependencies
- 1.1–1.4 已提交并推送（HEAD `681fe533`，与 upstream 一致）；H1–H3 工作流工具已推送。
- 远程为 GitHub（`origin` 为 github.com 仓库）。仓库 Actions 是否启用属于用户的仓库设置，见 Q5。
- 本地：Docker 29.4.3、Compose v5.1.3、OpenSpec 1.10.0；宿主 Node 为 v20.20.2，而 `apps/web/Dockerfile` 使用 node 24.21.0，见 Q2。宿主没有 gh、gitleaks、osv-scanner。
- Node 24.21.0（R5）：宿主没有 Node 版本管理器，也没有全局安装 Node 24。本阶段的本地验证只使用会话临时目录中的官方发行包 `node-v24.21.0-linux-x64.tar.xz`，其 SHA-256 已按 nodejs.org 的 `SHASUMS256.txt` 校验（未校验该文件的 GPG 签名），仅通过该进程的 `PATH` 使用；不声称已全局安装。`docs/ci.md` 必须说明新环境如何准备 Node 24.21.0（读取 `.node-version` 的版本管理器，或官方发行包加 `SHASUMS256.txt` 校验，可选验证其签名），以及 `scripts/ci.sh` 在版本不符时失败。

## 已发现的需求缺口与需用户决定的问题（开始实施前必须确定）
- G1（Q1）：1.5 (c) 要求 "Next.js lint"，但 Next.js 16.4 已无 `next lint`，仓库也没有 ESLint；lint 只能通过新增 ESLint 工具链实现。
- G2（Q2）：命令等价要求本地与 CI 运行同一 Node；宿主 Node 20.20.2 与镜像 Node 24.21.0 不一致。
- G3（Q3）：(b) 只点名两个 safe-commit 测试文件，但 `test/` 下另有两个 stage-handoff 测试文件，已是本地 gate 的一部分。D21 与 task 1.5 禁止 CI 弱于本地 gate，因此本合同内只有 Q3-A（全部四个文件）可实施；只运行两个须先经 OpenSpec/workflow refine。
- G4（Q4）：(i)(j) 需要选定工具。
- G5（Q5）：bootstrap——远程 CI 尚不存在，本阶段 commit 推送后才产生第一次运行；宿主没有 gh，远程结果如何读取需用户决定。
以上均不改变产品语义；如用户选择的选项需要修改 OpenSpec 文本，则先回到 refine，不在本阶段擅自修改 tasks/design。

## 设计
### 检查清单（每项一个 `scripts/ci.sh` 子命令，对应一个 CI job）
- `openspec`：(a) `openspec validate "math-error-correction-mvp" --strict`，CLI 固定为 README 记录的 `@fission-ai/openspec@1.10.0`，经 `scripts/ci-tools/package.json` + `package-lock.json`（含 integrity）`npm ci --ignore-scripts` 安装，从 `scripts/ci-tools/node_modules/.bin` 调用；不使用全局安装或无锁 `npx`。
- `node-tests`：(b) `node --test 'test/*.test.mjs'` 运行 `test/` 下全部四个测试文件（两个 safe-commit 测试文件与两个 stage-handoff 测试文件；Q3-A）。这是现有本地 gate 命令 `node --test test/` 在 Node 24 上的等价形式（R2）：glob 由 Node 展开，匹配同样的四个文件；证据须列出实际运行的四个文件与测试总数（当前 85），少于四个文件即视为失败。在隔离环境中运行：临时 `HOME`、`GIT_CONFIG_GLOBAL=/dev/null`、`GIT_CONFIG_NOSYSTEM=1`，使本地复现 runner 的"无全局 Git 配置"状态；如测试需要提交身份，入口只设置合成的 `GIT_AUTHOR_*`/`GIT_COMMITTER_*`（`ci@example.invalid`），不修改测试文件。若测试在干净环境下需要修改测试文件才能通过，停止并报告。
- `web`：(c) 在 `apps/web` 中 `npm ci --ignore-scripts`（与 Dockerfile 相同），然后 `npm run lint`（Q1）、`npm run typecheck`（`next typegen && tsc --noEmit`）、`npm run build`。
- `python`：(h) 在与 compose 相同的 `python:3.13.16-slim-bookworm` 镜像中，以只读挂载对 `services/pdf-processing/app.py` 做语法/编译检查（`PYTHONPYCACHEPREFIX` 指向容器内临时目录，不写仓库）。不创建、不占位、不声称 Group 3 PDF Processing Service 测试套件。
- `compose`：(d)(e)(f)(g) 与三容器健康/连通，全部在一次性 Compose 项目中：
  1. 项目名 `errlog-ci-<GITHUB_RUN_ID 或随机后缀>`；入口拒绝 `errlog-dev` 及任何不以 `errlog-ci-` 开头的名字，并拒绝已设置的 `COMPOSE_PROJECT_NAME`；
  2. 每次运行生成随机合成 `POSTGRES_PASSWORD`（只在该进程环境中，从不打印、不写文件、不进日志或证据）；`ERRLOG_WEB_PORT` 取一个空闲的 loopback 端口，避免与本地 `errlog-dev` 的 3100 冲突；
  3. `docker compose -p <ci> config --quiet`（d）；`docker compose -p <ci> build`（e）；
  4. `up -d --wait db`；用与 compose `db` 相同的 `postgres:18.6-bookworm` 新库执行 `npm run db:migrate`（f），再次执行须报告无待运行迁移；`test:db`；`test:dev-seed`（g，只读挂载 `db/seed`，按 README 命令）；
  5. `up -d --wait` 三服务全部 healthy，然后运行 README 的五条按服务名连通检查；
  6. `trap` 中执行 `docker compose -p <ci> down -v --rmi local --remove-orphans`，无论成败都清理；只清理该项目自身资源，绝不 `prune`，绝不触碰 `errlog-dev` 或 `errlog-dev_pgdata`。
- `secrets`：(i) 基础 secret scanning（Q4），扫描完整 Git 历史与当前工作树；CI checkout 使用 `fetch-depth: 0`。
- `dependencies`：(j) 依赖漏洞扫描（Q4），覆盖届时存在的全部 lockfile：`apps/web/package-lock.json`、`scripts/ci-tools/package-lock.json`；Python 目前没有依赖清单，`docs/ci.md` 如实记录。
- `workflow`：对 `.github/workflows/` 的两层静态检查，本地与 CI 运行同一命令、同一镜像：
  1. actionlint（task 1.5 Verify 条款）：以官方 actionlint 容器镜像运行，镜像按 digest 固定（实施时从官方发布解析，版本与 digest 记录在 `docs/ci.md` 与 `scripts/ci.sh`）；只读挂载仓库，解析 YAML 并校验 workflow schema、触发器、`runs-on`、`permissions`、`${{ }}` 表达式与上下文、job 依赖及 action 输入；镜像内自带的 shellcheck 集成若可用，则一并检查 `run:` 脚本，实际启用情况如实记录。任何 actionlint 报告或工具错误都使检查失败。
  2. 仓库专属策略检查（actionlint 不覆盖）：每个 `uses:` 必须是 40 位十六进制 commit SHA（附版本注释）；存在顶层与每个 job 的 `permissions: contents: read`；不出现 `pull_request_target`、`secrets.`、`continue-on-error`、`|| true`；每个 job 的 `run:` 只调用 `scripts/ci.sh <check>`（checkout/setup 等 `uses:` 步骤除外）。
- `all`：按 workflow → openspec → node-tests → python → web → secrets → dependencies → compose 顺序运行，任一失败立即以非零退出，并打印失败的检查名。

### 扫描工具与阻塞策略框架（Q4；具体策略在首次 baseline 后写入 docs/ci.md）
- 外部工具只以容器镜像运行，镜像按 digest 固定（实施时从官方发布解析并记录版本），本地与 CI 使用同一镜像；不通过 curl 下载未校验的二进制。
- 实施时先在当前仓库运行一次，记录 baseline（发现数、类别、文件，不记录 secret 值本身）。
- 默认策略：任何发现都使运行失败。不使用整目录或通配忽略，不设凭空的严重度阈值。
- 已记录的 baseline：secret scanning 无发现，因此没有 `.gitleaks.toml`；依赖扫描发现一项真实漏洞，唯一处理方式见下一节，其余任何 finding 都使运行失败。
- 依赖扫描今后若再发现真实漏洞：运行失败，停止并报告用户；不得静默忽略，也不得在没有新的合同 revision 与用户批准时增加 exception。
- 工具自身失败（镜像拉取失败、漏洞数据库或 OSV API 不可达、配置解析错误）使运行失败（fail closed），从不视为通过。
- 唯一的 report-only 项是下一节的单个 advisory exception；没有其他 report-only 项。

### 依赖漏洞 exception（R1，Q6-A 时生效）
- 范围：仅 advisory `GHSA-vfj7-8cjw-p6xm`（别名 `CVE-2026-93687`）：`braces` ≤ 3.0.3 的递归 AST 遍历缺少深度限制，深度嵌套的 brace 模式可耗尽调用栈并以未捕获的 `RangeError` 终止 Node 进程（CWE-674，High，CVSS 8.7）。截至本 revision，3.0.3 是 `braces` 的最新发布版本，OSV 记录为 `last_affected: 3.0.3`，没有修复版本。
- 准确依赖路径（两条，均由本阶段新增的开发工具引入；已提交的 `apps/web/package-lock.json` 中不存在 `braces`）：
  1. `apps/web/package-lock.json`：`eslint-config-next@16.4.0` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces@3.0.3`；
  2. `scripts/ci-tools/package-lock.json`：`@fission-ai/openspec@1.10.0` → `fast-glob` → `micromatch` → `braces@3.0.3`。
  两个 lockfile 中 `node_modules/braces` 均为 `version 3.0.3`、`dev: true`。
- 如实记录：`apps/web/Dockerfile` 是单阶段镜像，执行 `npm ci --ignore-scripts` 时安装全部依赖（含 devDependencies），因此 `braces@3.0.3` 存在于构建出的 Web 镜像的 `node_modules` 中；不得声称它不在镜像里。lockfile 中没有任何生产依赖链指向 `braces`（`next`、`react`、`pg` 均不依赖它），但本阶段不验证、也不声称运行时从不加载它。
- 形式：`osv-scanner.toml` 中恰好一个 `[[IgnoredVulns]]` 条目，`id = "GHSA-vfj7-8cjw-p6xm"`，`ignoreUntil` 为 2026-11-20（批准后 30 天内），`reason` 写明上述事实。不使用通配、包级或严重度级忽略；不修改其他 vulnerability 的门禁。
- 配置绑定（B1）：OSV-Scanner 的目录内 `osv-scanner.toml` 只作用于所在目录，不传播到子目录，因此根目录的文件不会自动作用于 `apps/web/` 与 `scripts/ci-tools/` 中的 lockfile。检查固定为 `osv-scanner scan source --config=/repo/osv-scanner.toml --recursive /repo`（`--config` 把该文件全局应用于本次扫描的全部 lockfile），不依赖工作目录或目录内配置的自动发现；任何嵌套目录中出现另一个 `osv-scanner.toml` 也使检查失败。
- report-only：每次 `dependencies` 检查都打印该 exception（advisory、路径、到期日），使其在日志中可见；它不是静默忽略。
- `scripts/ci.sh dependencies` 的守卫，任一条件不满足即失败：
  1. `osv-scanner.toml` 只含这一个条目，且 id 正是该 advisory；
  2. 每个出现 `node_modules/braces` 的 lockfile 中，它都是 `3.0.3` 且 `dev: true`；它出现在任何生产依赖位置、版本改变，或出现在这两个之外的 lockfile 中都会失败（迫使重新评估）；
  3. 通过 OSV API 读取该 advisory：一旦任何受影响范围出现 `fixed` 事件（即存在修复版本），检查失败，要求移除 exception 并升级；读取失败亦失败；
  4. `ignoreUntil` 到期后 osv-scanner 不再忽略该 advisory，检查失败；
  5. 自检（持久，在 `scripts/ci.sh` 中每次运行）：再以不带 `--config` 的 JSON 输出扫描一次，结果必须恰好是该 advisory，出现在 `apps/web/package-lock.json` 与 `scripts/ci-tools/package-lock.json` 两个 lockfile 中、均为 `braces@3.0.3`；缺少任一 lockfile、出现其他 advisory 或其他包都失败。该扫描在 `set -e` 之外显式捕获退出码：只有 osv-scanner 的"发现漏洞"退出码 1 进入 JSON 解析，其他退出码（工具、网络或配置错误）与无法解析的 JSON 都失败。它证明 advisory 仍真实存在于两个嵌套 lockfile，且被放行只是因为显式的 `--config`；
  6. 其余所有 finding 与工具错误照常失败。
- 重新检查：每次依赖变更（任何 lockfile 变化都会在 CI 中触发该检查）以及任何生产部署之前都重新评估该 exception；届时的部署 stage 须把它列为前置检查项。一旦出现兼容的修复版本，就在新的 stage 中移除 exception 并升级依赖。
- 不修改、不 patch 第三方源码或 `node_modules`；不使用 `overrides`/`resolutions` 强制指向不存在的修复版本；不降级或替换 `eslint-config-next`、`@fission-ai/openspec`（lint 与固定的 OpenSpec CLI 都是 task 1.5 的要求）。
- Q6-B（保持阻塞）时：不创建 `osv-scanner.toml`，S1.5 停在 `dependencies` 检查，直到上游发布修复版本。

### 工具链事实与前置条件（R3、R4）
- 传递升级（Q7）：新增 `eslint-config-next` 引入的 `browserslist` 要求 `baseline-browser-mapping ^2.11.29` 与 `caniuse-lite ^1.0.30001816`，因此 npm 把两个既有传递依赖升级为 `baseline-browser-mapping` 2.11.28 → 2.11.30、`caniuse-lite` 1.0.30001815 → 1.0.30001817（`next` 本身要求 `^2.9.19`、`^1.0.30001579`，两个新版本都满足）。另有 `semver` 的 `optional` 标记变为 `devOptional`，版本不变。Q7 是对这一对升级的整体决定：两项最低版本都由同一个新增的 `browserslist` 依赖范围（`^2.11.29`、`^1.0.30001816`）各自强制，保留任一旧版本都不满足其范围，因此不能只接受其中一项。Q7-A 时 lockfile 只允许这两项升级、`semver` 标记变化与新增的包；Q7-B 时须先改为不引起升级的 lint 方案，这需要新的合同 revision。
- ESLint 9 支持状态（R4）：npm 把 `eslint@9.39.5` 标记为 "no longer supported"。当前不能升级到 ESLint 10：`eslint-config-next@16.4.0` 依赖的 `eslint-plugin-react` 最新版本的 peer 范围是 `^3 … ^8 || ^9.7`，不含 10。后续升级触发条件（任一满足即开启一个独立的升级 stage）：与本仓库 Next 版本匹配的 `eslint-config-next` 及其全部插件声明支持 ESLint 10；或 ESLint 9 出现安全 advisory（依赖扫描会使运行失败）；或升级 Next 主版本。

### Workflow 约束（D21）
- 触发：`push`（所有分支）与 `pull_request`；不使用 `pull_request_target`、`workflow_run`、`schedule` 或 `workflow_dispatch`。
- 顶层 `permissions: contents: read`，每个 job 也显式声明 `permissions: contents: read`；不提升任何权限。
- `actions/checkout`、`actions/setup-node` 及其他任何 action 一律锁定到完整 commit SHA，并以注释标注版本；`actions/checkout` 使用 `persist-credentials: false`。
- runner 固定为 `ubuntu-24.04`（不用 `ubuntu-latest`）；每个 job 设 `timeout-minutes`；`concurrency` 按 ref 分组并取消同一 ref 的过时运行。
- 不使用任何仓库 secret、Environment 或凭据；所触及数据只有仓库内的合成数据和每次运行生成的合成口令。
- 不包含 Playwright、E2E job 或任何 E2E 占位；不包含 13.2 的生产冒烟 workflow；不包含签名发布、attestation、release、SAST 或容器镜像扫描。
- Node 版本：Q2-A 时由新文件 `.node-version`（`24.21.0`）统一提供，`setup-node` 读取它，`scripts/ci.sh` 在版本不一致时失败。

## Sub-steps
1. 用户批准后写 S1.5 Implementation Checkpoint（`in_progress`，含本合同全文），替换已过时的 S1.4 checkpoint/handoff 段落。（已在 revision 2 下完成；revision 6 获批后，checkpoint 改为记录 revision 6 的批准与 Q1–Q7 的选择（Q7 为对这一对升级的整体决定），并逐字替换为 revision 6 全文。）
5a.（按 revision 6）Q6-A 时：写 `osv-scanner.toml` 的单个条目、`scripts/ci.sh dependencies` 的守卫与 report-only 打印；完成 R1 的失败证据；然后继续 `compose` 及其余步骤。
2. 失败证据先行：在没有 `scripts/ci.sh` 时调用入口失败；每个检查在植入的合成缺陷下失败（见 Test requirements）。
3. 加入 ESLint（Q1）与 `lint`/`typecheck` 脚本，更新 lockfile；`scripts/ci-tools/` 固定 OpenSpec。
4. 编写 `scripts/ci.sh`、`.github/workflows/ci.yml`。
5. 运行扫描工具得到 baseline，写入阻塞策略与（若需要）逐项忽略配置。
6. 写 `docs/ci.md`、README 的 CI 小节、`docs/implementation-workflow.md` CI 节的一句指向说明、`ssdf-profile.md` 状态更新。
7. 本地完整 gate：`scripts/ci.sh all` 通过；scope gate；`errlog-dev` 资源前后快照一致。
8. 独立只读 reviewer → implementation handoff（Codex PASS）→ 勾选 1.5 → 复验 → checkpoint `ready_for_safe_commit`。
9. safe-commit `check` → delivery commit-ready → 停止；之后按 delivery 流程分别取得 commit 与 push 批准（见 "交付"）。

## Exact paths allowed to change
- `.github/workflows/ci.yml`（新）
- `scripts/ci.sh`（新，可执行位 100755）
- `scripts/ci-tools/package.json`（新）
- `scripts/ci-tools/package-lock.json`（新）
- `.node-version`（新，仅 Q2-A）
- `apps/web/package.json`（仅新增 `lint`、`typecheck` 脚本与 Q1 所需 ESLint devDependencies，精确版本）
- `apps/web/package-lock.json`（仅新增 ESLint 依赖所需的新包，以及 Q7-A 批准的两项传递升级与 `semver` 标记变化）
- `apps/web/eslint.config.mjs`（新，仅 Q1-A）
- `osv-scanner.toml`（新，仅 Q6-A；恰好一个 `GHSA-vfj7-8cjw-p6xm` 条目）
- `docs/ci.md`（新）
- `README.md`（新增 CI 小节）
- `docs/implementation-workflow.md`（仅 CI 节一句指向 `docs/ci.md` 与 `scripts/ci.sh`）
- `docs/security/ssdf-profile.md`（仅 PO.3、PO.5、PS.1、PW.8、RV.1 行与 "Current gaps"）
- `openspec/changes/math-error-correction-mvp/scratchpad.md`（checkpoint 与 handoff 段落）
- `openspec/changes/math-error-correction-mvp/tasks.md`（仅 1.5 复选框）

## Explicitly excluded
- 任何产品代码与行为：`apps/web/app/**`、`apps/web/db/**`、`services/**`、`compose.yaml`、Dockerfile、`.dockerignore`（如 lint 需要修改产品代码才能通过，停止并报告）。
- Playwright、E2E job/占位、`stage-reviewer` agent 定义（属于 4.1）；Python lint/type-check/pytest、contract tests、AI eval、SAST、容器镜像扫描、镜像 digest 固定（属于后续 Groups）。
- 13.2 生产冒烟 workflow、GitHub Environment、任何 secret；签名、attestation、release pipeline。
- GitHub 仓库设置（Actions 开关、分支保护、required checks）、gh 安装、调用 GitHub API 写操作；合并到 main、PR 创建。
- 升级或修改既有依赖版本（Q7-A 作为一对整体批准的两项传递升级除外）；`overrides`/`resolutions`；修改或 patch 第三方源码；修改 `tools/**`、`test/**`、`.claude/**`、`CLAUDE.md`、`.safe-commit.json`、`docs/safe-commit*`。
- 其他 OpenSpec 文本（proposal、design、specs、其余 tasks）；task 1.6 及以后。
- `.agent-handoffs/` 中任何既有文件。

## Test requirements
- 本地完整 gate：`scripts/ci.sh all` 在最终树上通过（退出 0），并分别记录每个检查的结果。
- 失败证据（均在会话临时目录或临时 Compose 项目中进行，不提交、不修改仓库文件，或在验证后逐字节恢复）：
  - `workflow`（actionlint 层）：临时副本中 malformed YAML（缩进/映射错误、未闭合引号）、无效 Actions construct（未知顶层或 job 键、`runs-on` 缺失、无效 `permissions` 值、引用不存在的上下文或语法错误的 `${{ }}` 表达式、`needs` 指向不存在的 job）→ 各自由 actionlint 报告并失败；
  - `workflow`（策略层）：临时副本中把一个 `uses:` 改为 tag、加入 `pull_request_target`、删除 `permissions`、加入 `continue-on-error` → 各自失败；
  - `openspec`：临时副本中破坏一个 spec 场景 → 失败；
  - `node-tests`：植入一个失败断言 → 失败；运行记录列出四个测试文件与总数；
  - `web`：植入 lint 错误、类型错误 → 分别失败；
  - `python`：植入语法错误 → 失败；
  - `compose`：项目名 `errlog-dev` 或非 `errlog-ci-` 前缀被拒绝且未启动任何容器；一个失败的迁移/测试使检查失败且 trap 仍完成清理；
  - `secrets`：在临时目录放入合成的、格式真实但无效的 token → 失败（该值不进入仓库、证据或 handoff，只记录"检测到 1 条、规则 ID"）；
  - `dependencies`：对一个含已知漏洞版本的合成 lockfile（临时目录）→ 失败（证明 exception 不覆盖其他 advisory）；漏洞数据库不可达 → 失败而非通过；没有 `osv-scanner.toml` → 因该 advisory 失败；带 `osv-scanner.toml` 但去掉 `--config`（临时副本）→ 该 advisory 在两个嵌套 lockfile 中都被报告并失败，带精确 `--config` 时通过；嵌套目录放入另一个 `osv-scanner.toml` → 失败；临时副本中 `ignoreUntil` 已过期 → 失败；`osv-scanner.toml` 增加第二个条目或改为其他 id → 守卫失败；`braces` 版本改变或 `dev` 标记移除（临时 lockfile 副本）→ 守卫失败；守卫指向一个已有修复版本的 advisory（临时副本）→ 失败；OSV API 不可达 → 失败。
- 清理证据：每次 `compose` 检查后，`errlog-ci-*` 的容器、网络、卷、本地镜像为零；`errlog-dev` 项目资源（容器/卷/网络）运行前后快照一致，`errlog-dev_pgdata` 未被创建或修改。
- 合成口令不出现在任何输出、文件、证据、checkpoint 或 handoff 中（实施后扫描确认）。
- 既有测试不修改、全部通过；`openspec validate --strict` valid；进度 5/89（勾选后）。
- 远程 CI 无法在 commit 前运行（见 "Bootstrap"），因此本地 gate 是 commit 的前置条件；远程首次运行是 post-push 复验。

## Contract-test requirements
不适用：五个命名边界均未涉及（Contracts affected: none）。

## AI-eval requirements
不适用：本阶段无 AI 能力。

## User-journey E2E requirements
- Applicability：not-applicable——开发工具链与 CI 配置，不新增或改变任何用户可见行为、路由或 UI；且 task 1.5 与 D22 明确禁止在 1.5 加入 Playwright、E2E job 或占位。
- E2E worker：none；其余 E2E 字段均为不适用。

## Security / privacy / trust-boundary impact
- 新信任边界：GitHub Actions runner 与第三方 action/镜像。控制：最小 `contents: read`、action 锁定 SHA、actionlint 与扫描镜像锁定 digest、`persist-credentials: false`、无 `pull_request_target`、无 secret；fork PR 运行在只读 token 下，无 secret 可泄露。
- CI 只触及仓库内合成数据和每次运行生成的合成口令；不使用真实凭据、真实儿童数据或照片。
- 一次性 Compose 项目隔离：名称前缀守卫 + 仅清理自身项目，保护本地 `errlog-dev` 与其卷。
- 扫描报告只记录规则 ID、路径与计数，不记录 secret 值；handoff 中不出现 URL、口令、环境转储或原始终端输出。
- 依赖扫描需要访问公开漏洞数据库与 OSV API（网络）；不可达时失败关闭。
- 已知残余风险（Q6-A，按改正后的威胁模型，B2）：`braces@3.0.3`（GHSA-vfj7-8cjw-p6xm）作为开发依赖存在于工作区与 Web 镜像中。`pull_request` 运行检查的是 PR 控制的仓库内容：ESLint 配置、OpenSpec 文件、被 lint 或校验的文件路径与内容都可能由 PR 构造，一律视为不可信；因此精心构造的 PR 数据可以到达使用 `braces` 的开发工具（`fast-glob`/`micromatch`），触发栈耗尽。影响边界：CI job 不持有 secret，`GITHUB_TOKEN` 只有 `contents: read`，checkout 不保存凭据，runner 是一次性的；主要影响是使该 CI 运行崩溃或失败（拒绝服务），不涉及凭据泄露或写权限。注意：PR 本身已能在这些 job 中执行任意代码（例如 ESLint 配置是 JavaScript），所以 `braces` 并不扩大该 job 的权限，但这不使 PR 内容变得可信。本地：维护者对不可信的 PR checkout 运行 `scripts/ci.sh` 同样会执行该 PR 的代码；`docs/ci.md` 须提醒只在可信 checkout 上运行。用户须按此威胁模型接受或拒绝 Q6-A。

## Evidence of completion
- `scripts/ci.sh all` 本地通过的结构化摘要（每个检查：命令、退出码、耗时、关键计数）；失败证据与清理证据（见 Test requirements）。
- `docs/ci.md` 记录：扫描 baseline 摘要与阻塞策略；Q6 exception 的 advisory、两条路径、`dev: true`、镜像包含 devDependencies 的事实、到期日、守卫与移除条件；Q7 两项传递升级；ESLint 9 状态与升级触发条件；新环境准备 Node 24.21.0 的方法；所有 action SHA 与镜像 digest（含 actionlint）及其版本记录在 workflow 注释与 `docs/ci.md`；actionlint 对最终 `ci.yml` 无报告。
- scope gate：实际变更 ⊆ Allowed paths。
- 独立 reviewer PASS；Codex implementation PASS；delivery commit-ready/push-ready 的 Codex PASS 与用户的两次独立批准。
- 推送后首次远程 CI 运行的结果（见 Bootstrap）作为 post-push 复验记录到下一次 session 的 checkpoint/handoff，而非本阶段勾选的前提。

## Bootstrap（尚无远程 CI）
- 远程 CI 只在本阶段 commit 推送后首次运行，不能作为该 commit 的前置条件（D21、workflow "CI"）；本地 `scripts/ci.sh all` 即 pre-commit gate。
- 推送后：用户按 Q5 的方式读取该 HEAD 的 CI 结论。记录的结果必须同时标明：准确的已推送 commit SHA（与 delivery push-result 记录的 commit 一致）、workflow 名称 `ci`、触发事件 `push`、以及该运行的最终 conclusion；只有该 SHA 的运行 conclusion 为 `success` 才记为 `passed`。其他 commit 的运行、重跑前的旧结论或未完成的运行都不能替代。`passed` 之前，任何依赖本阶段的 stage 不得开始；`failed`、`cancelled`、`pending`/`running`、`unknown` 都不视为通过。
- 首次远程失败进入修复：新的 Stage Contract 或用户明确批准的定向修复，各有测试、review 与 safe-commit 周期；不 amend、不绕过、不 force-push。
- 若仓库的 Actions 未启用，推送后不会产生运行：记录为 `unknown`，由用户决定启用或其他处理；不把"无运行"当作通过。

## 交付（H3 后的默认门禁）
- 本阶段是 H3 后第一个走 delivery channel 的 stage：check → commit-ready → 停止；Codex PASS + 用户批准 → commit → commit-result 与 push-ready → 停止；Codex PASS + 用户单独批准 → 单独运行 delivery `verify`（须 valid）→ 以 push-ready 的 endpoint hash 与 target ref 执行 guarded push → push-result → 停止。commit 与 push 不在同一命令批次。

## Rollback approach
- commit 前：变更仅在工作树中；在用户授权下逐文件恢复（不使用 Git 变更命令绕过）。临时 Compose 项目已由 trap 清理；残留只按精确的 `errlog-ci-*` 名称清理。
- commit/push 后：用新的 stage（revert 式的前向修复，经 safe-commit）删除或修正 workflow；不 force-push、不改写历史。如需立即停止远程运行，由用户在 GitHub 仓库设置中暂停 Actions。

## Open questions
见 handoff 的 openQuestions：Q1 ESLint、Q2 Node 版本、Q3 node-tests 范围（合同内只有 A 可实施）、Q4 扫描工具、Q5 远程 CI 结果读取（Q1–Q5 已于 revision 2 选 A，须随 revision 6 再次确认）；Q6 braces advisory 的处理；Q7 对两项传递升级整体批准或拒绝。
````

Last updated: 2026-10-14. Checkpoint:
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
- **Next step**: no open issues remain in this scratchpad. safe-commit was approved,
  committed (`aff5550317f99a9acf82fc6c480d617fa18198e5`), and pushed — see the Current
  Implementation Handoff section at the top of this file for the current status; this
  line is a historical record of that round, not the current next action.
- P1(12): **Consistent** — landed 2026-10-10; `design.md` gained D21, `tasks.md` gained 1.5;
  no proposal/spec change; `openspec validate --strict` passed.
- P1(13): **Consistent** — landed 2026-10-12; `design.md` gained D22 (+ D21 cross-refs);
  `tasks.md` 1.5/4.1/4.7/7.7/13.2/13.4/13.6 updated; `CLAUDE.md` and
  `docs/implementation-workflow.md` gained the user-journey E2E rules; no proposal/spec
  change; task total 89 unchanged; `openspec validate --strict` passed.
- P1(15): **Consistent** — landed 2026-10-14; `tasks.md` 1.4 rewritten (local-dev fixture
  data precondition) and 2.5 gained a positive caller-context verify clause; no
  proposal/design/spec change; 3/89 unchanged; `openspec validate --strict` passed.

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
- **Workflow/SSDF → Design/Tasks (process traceability)**: ran 2026-10-10. CI required by `docs/implementation-workflow.md` (CI section) and pointed to by `docs/security/ssdf-profile.md` "Group 1 CI"/"Group 1 skeleton" triggers had no owning design decision or task — P1(12).
- **Workflow → Design/Tasks (user-journey E2E governance)**: ran 2026-10-12. No rule, design decision, or task owned Scenario-derived, persistent, UI-driven product E2E, its test data/adapter isolation, or its CI integration — P1(13).
- **Spec → Implementation readiness (S1.3 Stage Contract Q4)**: ran 2026-10-12. child-profile requires creating, listing, and switching multiple Children, but no artifact defined any user-recognizable Child display field — P1(14).

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

#### P1(12): No design decision or task owns the CI required by the implementation workflow and SSDF profile
- **Status**: Consistent
- **Files & locations**:
  - `tasks.md` — Group 1 (1.1–1.4); no CI task anywhere in the prior 88 tasks
  - `design.md` — Decisions D1–D20; no CI/verification-chain decision
- **Evidence**: `docs/implementation-workflow.md` CI section: "Once a Group's technical skeleton and CI are established, these local commands must be the same (or equivalent) commands CI will run"; `docs/security/ssdf-profile.md` PS.1/RV.1 Trigger "Group 1 CI", PO.3 Trigger "Group 1 skeleton". A search of tasks/design/proposal/specs for CI, GitHub/Actions, secret/dependency scanning, lint/type-check/pytest found no owning item. Remote `origin` is `github.com`.
- **Expected state**: one design decision defines the local-gate/remote-CI verification chain; one Group 1 task establishes the initial CI, traced to it.
- **Impact**: creating CI inside 1.1 would exceed that task's scope; not creating it leaves the workflow and SSDF CI requirements with no owner.
- **Recommended artifact**: `design.md` (new D21) + `tasks.md` (new 1.5).
- **Suggested fix**: add D21 "本地验证与远程 CI 使用同一验证链" before Risks / Trade-offs; add 1.5 after 1.4 citing D21; 1.1–1.4 unchanged.
- **User decision needed?**: No — direction, scope (incl. migration/seed checks and Actions supply-chain constraints), and three-file edit set approved by the user 2026-10-10.
- **Notes**: found 2026-10-10 during pre-implementation recovery; landed 2026-10-10. proposal/specs unchanged — CI changes no user-visible behavior. `docs/security/ssdf-profile.md` unchanged: its existing Gap/Trigger wording is accurate and now resolves to task 1.5; its row statuses update only when 1.5 is implemented.

#### P1(13): Automated product user-journey E2E has no governance, design anchor, or task ownership
- **Status**: Consistent
- **Files & locations**:
  - `CLAUDE.md` — Implementation stage workflow (Stage Contract fields; "fitting integration/E2E/eval approach")
  - `docs/implementation-workflow.md` — Flow, Stage Contract template, CI coverage chain; no E2E section
  - `design.md` — D21 mentions "integration/E2E" only generically; no E2E decision
  - `tasks.md` — 4.7/7.7/13.2 "Run and record … walkthrough"; 7.7/13.2 "real sample worksheet"; 13.4 covers only the 1.4 seed; 13.6 states no test method
- **Evidence**: no rule required Scenario-derived, persistent, UI-driven E2E; no rule forbade DB/internal-API driving in general; no failure-evidence, test-data, or test-adapter production-isolation requirement; "real sample" wording conflicted with SECURITY.md/D21's no-real-child-data rule; no defined owner for the first Playwright infrastructure.
- **Expected state**: D22 states the technical principles (no agent orchestration); the workflow holds the procedure, E2E worker / stage reviewer separation, the mandatory E2E Test Summary, PASS/FAIL/BLOCKED rules, evidence hygiene, CI-without-LLM, and the fallback; CLAUDE.md holds concise mandatory rules; tasks assign ownership.
- **Impact**: without it, user-visible stages could close on manual walkthroughs or throwaway scripts, CI could not regress user journeys, and test adapters could leak into production as auth/upload bypasses.
- **Recommended artifact**: `design.md` (D21 cross-refs + new D22), `tasks.md` (1.5, 4.1, 4.7, 7.7, 13.2, 13.4, 13.6), plus `CLAUDE.md` and `docs/implementation-workflow.md`.
- **Suggested fix**: as landed (see Notes).
- **User decision needed?**: No — all decisions made by the user 2026-10-12: extend 13.4 (no new task, total stays 89); storage test double chosen by 4.1's Stage Contract under D22 constraints; UI assertions authoritative, read-only DB checks supplementary and declared; 1.4 identity as labeled pre-journey precondition until login exists; 13.2 via `workflow_dispatch` + protected Environment with manual approval and an approval-gated cleanup runbook; Chromium only, desktop + mobile viewport; retries = 0; 4.7 clarified as pipeline integration; one fresh stage reviewer (never the E2E worker), after the full local gate; E2E pre-review fix loops don't consume reviewer fix rounds but stop after two failed attempts on the same blocker; `.only` always zero (never approvable; `forbidOnly`, any `.only` = FAIL); `.skip`/`.fixme` zero by default, exceptions only when approved item by item (refined 2026-10-12 after reviewer finding); integrity `n/a` only with reason, reviewer-confirmed; `.claude/agents/e2e-worker.md` + `stage-reviewer.md` created by 4.1; `.artifacts/e2e/` gitignored evidence directory, CI artifacts 7-day retention; flow order checkbox → post-checkbox validation → `ready_for_safe_commit`.
- **Notes**: found and landed 2026-10-12. proposal/specs/SECURITY.md/ssdf-profile.md unchanged — no product semantics change; SSDF rows update only when the controls exist. Task total unchanged (89), progress 1/89; 1.1 untouched. No Playwright/CI/agent/test file created by this refine. `openspec validate --strict` passed after the edits.

#### P1(14): Child has no user-recognizable display field, yet child-profile requires listing and switching multiple Children
- **Status**: Consistent
- **Files & locations**:
  - `specs/child-profile/spec.md` — "新建与切换孩子档案" ("SHALL 提供简单的列表和切换入口"; Scenario "多孩子时切换当前孩子": "从列表中选择另一个孩子")
  - `design.md` — D4 entity diagram (`Child[]` had no attributes) and "多用户 / 多孩子扩展"
  - `tasks.md` — 5.7 ("create the first Child"), 5.9 ("simple list")
- **Evidence**: no artifact defined a name/displayName or any other field by which a user could tell Children apart; surfaced as S1.3 Stage Contract Q4 (the schema could not define `child` columns without inventing product semantics).
- **Expected state**: Child has a required, user-entered `displayName`: leading/trailing whitespace trimmed per an application-defined whitespace rule, the normalized result non-empty, and the normalized value persisted and displayed; shown in the Child list, the current-Child display, and the switch entry; non-unique within a family; identity, switching, and all ownership/binding use the stable UUID, never the name; no rename/delete/avatar/birthday/full profile management in MVP; no unapproved maximum length; persistence carries a matching non-blank defensive constraint whose exact expression and space/tab/newline tests are decided by the S1.3 Stage Contract.
- **Impact**: 5.9's list/switch was unimplementable as specified, and S1.3 could not finalize the `child` table without a unilateral product decision.
- **Recommended artifact**: `specs/child-profile/spec.md`, `design.md` (D4), `tasks.md` (5.7, 5.9).
- **Suggested fix**: as landed — new child-profile Requirement "孩子档案显示名称" with three Scenarios (blank/whitespace-only rejected; normalized name shown in list/current/switch; duplicate names allowed, switching by id); D4 diagram line `Child.displayName` nested under `Child[]` plus a "孩子档案显示名称" paragraph with rationale and rejected alternatives (does not equate the semantics to any specific SQL expression); 5.7/5.9 wording and verify clauses (ordinary spaces, tab/newline, normalized value saved and displayed, duplicate names distinct).
- **User decision needed?**: No — decided by the user 2026-10-12: persist the normalized (trimmed) value, not raw input; a dedicated Requirement with three Scenarios; task 1.4 unchanged (its Stage Contract supplies a synthetic non-empty displayName); duplicate names allowed, UUID for identity/switching/ownership; no rename/delete/avatar/birthday/other profile management in MVP; DB uses text + a non-blank defensive constraint, no max length.
- **Notes**: found and landed 2026-10-12. proposal unchanged (its "检查/创建孩子档案……支持新建/切换" already covers the capability); other five specs unchanged; tasks 1.3/1.4/5.8 text unchanged; no checkbox changed (89 tasks, 2 checked). No implementation, checkpoint, or dependency change.

#### P1(15): task 1.4 acceptance claims workflow proof that only 2.5/4.1 can supply
- **Status**: Consistent
- **Files & locations**:
  - `tasks.md` — 1.4 (whole task); 2.5 (verify clause)
  - consistent and unchanged: `tasks.md` Group 4 intro, 4.1 ("Identity uses 1.4's dev identity as an explicitly labeled pre-journey precondition, not login E2E"), 5.4, 13.4, 1.5(g); `design.md` D22 "驱动与断言" and Migration Plan item 3
- **Evidence**: 1.4 read "inserting one allowlisted User/Identity/Child row for manual end-to-end testing … verify the seeded identity can be used to drive the workflow manually ahead of real Auth (Group 5) being built". When 1.4 runs no workflow, route, or caller context exists, so the clause could only be met by a direct SQL substitute (Codex S1.4 contract review revision 1, B1). "manual end-to-end testing" conflicts with D22/`CLAUDE.md` (manual walkthroughs are never product E2E). "allowlisted" has no referent: no allowlist or OTP mechanism exists before Group 5 (5.4, Migration Plan). 2.5 verified only rejections, so no task proved that the seeded identity works as a caller context.
- **Expected state**: 1.4 creates and verifies a local-dev fixture data precondition only (one synthetic User/Identity/Child with a valid `currentChildId`; idempotent; ownership constraints satisfied; synthetic, no real credential); its Identity is a dev fixture, not an allowlist entry, login path, or production auth path. 2.5 owns the first caller-context/ownership access proof, including the positive case; 4.1 owns the first browser user journey.
- **Impact**: S1.4 could not satisfy its own acceptance without overlapping 2.5 or faking workflow proof; the positive caller-context case was owned by no task.
- **Recommended artifact**: `tasks.md` (1.4, 2.5).
- **Suggested fix**: as landed — 1.4 rewritten as the local-dev fixture data precondition with verify (a)–(d) and an explicit hand-off to 2.5/4.1; 2.5 verify gains "a request carrying the 1.4 seeded identity's caller context for an asset that identity owns is issued a signed URL (the first proof that the seeded identity works as a caller context)", keeping both rejection checks.
- **User decision needed?**: No — decided by the user 2026-10-14: 1.4 only creates and verifies the seed data precondition; 2.5 owns the first caller-context/ownership proof (option A: add the positive case); 4.1 owns the first browser journey; the seeded Identity is a local dev fixture / preconfigured dev entry, never called a real allowlist.
- **Notes**: found 2026-10-14 by Codex S1.4 contract review revision 1 (B1, N1); landed 2026-10-14. proposal/design/specs unchanged; other tasks unchanged; no checkbox changed (89 tasks, 3 checked). Observation, not fixed here: no task names allowlist storage/checks explicitly (implied by 5.4) — revisit when refining Group 5. The stale S1.3 handoff/checkpoint block at the top of this file is left for the S1.4 Stage Contract. No implementation, checkpoint, or dependency change.

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
