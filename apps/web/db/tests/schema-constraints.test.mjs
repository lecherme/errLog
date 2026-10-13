// Schema constraint tests for the task 1.3 migration (run: npm run test:db).
//
// Run only against a disposable, already-migrated test database. The connection string
// is read from ERRLOG_SCHEMA_TEST_DATABASE_URL only (never DATABASE_URL) and is never
// printed. As a further safeguard every write happens inside one transaction that is
// rolled back at the end, so no rows are left behind.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";

const NOT_NULL = "23502";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const CHECK = "23514";

let client;
let savepoint = 0;

before(async () => {
  const connectionString = process.env.ERRLOG_SCHEMA_TEST_DATABASE_URL;
  assert.ok(
    connectionString,
    "ERRLOG_SCHEMA_TEST_DATABASE_URL must point at a disposable, migrated test database",
  );
  client = new pg.Client({ connectionString });
  await client.connect();
  await client.query("BEGIN");
});

after(async () => {
  if (!client) return;
  await client.query("ROLLBACK");
  await client.end();
});

async function q(sql, params = []) {
  return (await client.query(sql, params)).rows;
}

async function rejects(sql, params, code, target) {
  const name = `sp${++savepoint}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    assert.equal(err.code, code, `expected SQLSTATE ${code}, got ${err.code}: ${err.message}`);
    if (code === NOT_NULL) assert.equal(err.column, target);
    else assert.equal(err.constraint, target);
    return;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  assert.fail(`expected SQLSTATE ${code} (${target}) but the statement succeeded`);
}

async function newUser() {
  return (await q("INSERT INTO app_user DEFAULT VALUES RETURNING id"))[0].id;
}

async function newChild(userId, displayName = "Child") {
  return (
    await q("INSERT INTO child (user_id, display_name) VALUES ($1, $2) RETURNING id", [
      userId,
      displayName,
    ])
  )[0].id;
}

async function newArchive(userId, name = "Worksheet") {
  return (
    await q("INSERT INTO worksheet_archive (user_id, name) VALUES ($1, $2) RETURNING id", [
      userId,
      name,
    ])
  )[0].id;
}

async function newSession(userId, childId, archiveId = null) {
  return (
    await q(
      "INSERT INTO grading_session (user_id, child_id, worksheet_archive_id) VALUES ($1, $2, $3) RETURNING id",
      [userId, childId, archiveId],
    )
  )[0].id;
}

async function newErrorQuestion(sessionId, childId) {
  return (
    await q(
      "INSERT INTO error_question (grading_session_id, child_id) VALUES ($1, $2) RETURNING id",
      [sessionId, childId],
    )
  )[0].id;
}

async function newWorksheet(childId) {
  return (
    await q("INSERT INTO correction_worksheet (child_id) VALUES ($1) RETURNING id", [childId])
  )[0].id;
}

test("migration has been applied", async () => {
  const rows = await q(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
  );
  assert.deepEqual(
    rows.map((r) => r.table_name),
    [
      "app_user",
      "child",
      "correction_worksheet",
      "correction_worksheet_item",
      "error_question",
      "grading_session",
      "identity",
      "pgmigrations",
      "worksheet_archive",
    ],
  );
});

test("only standard PostgreSQL: no extension beyond plpgsql, no enum, no trigger", async () => {
  assert.deepEqual(await q("SELECT extname FROM pg_extension"), [{ extname: "plpgsql" }]);
  assert.deepEqual(await q("SELECT typname FROM pg_type WHERE typtype = 'e'"), []);
  assert.deepEqual(await q("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal"), []);
});

test("child.display_name rejects empty, whitespace-only and untrimmed values", async () => {
  const user = await newUser();
  const sql = "INSERT INTO child (user_id, display_name) VALUES ($1, $2)";
  const invalid = [
    "",
    " ",
    "   ",
    "\t",
    "\n",
    " \t\n",
    "\r",
    "\v",
    "\f",
    " a",
    "a ",
    "\ta",
    "a\t",
    "\na",
    "a\n",
    "\ra",
    "a\v",
    "\fa",
  ];
  for (const value of invalid) {
    await rejects(sql, [user, value], CHECK, "child_display_name_normalized_check");
  }
  await rejects(sql, [user, null], NOT_NULL, "display_name");
});

test("child.display_name keeps internal whitespace and allows duplicate names", async () => {
  const user = await newUser();
  for (const value of ["a", "小明", "a b", "a\tb", "a\nb", "a  b"]) {
    const id = await newChild(user, value);
    const [row] = await q("SELECT display_name FROM child WHERE id = $1", [id]);
    assert.equal(row.display_name, value);
  }
  const first = await newChild(user, "Sam");
  const second = await newChild(user, "Sam");
  assert.notEqual(first, second);
});

test("child.display_name boundary: non-ASCII whitespace is left to the application rule", async () => {
  // The database guards only space/tab/LF/CR/VT/FF; the application-defined
  // normalization (task 5.7) is responsible for wider Unicode whitespace.
  const user = await newUser();
  await newChild(user, "　a　");
});

test("app_user.current_child_id may only point at the User's own Child", async () => {
  const owner = await newUser();
  const other = await newUser();
  const own = await newChild(owner);
  const foreign = await newChild(other);
  const sql = "UPDATE app_user SET current_child_id = $2 WHERE id = $1";
  await rejects(sql, [owner, foreign], FOREIGN_KEY, "app_user_current_child_fkey");
  await rejects(
    sql,
    [owner, "00000000-0000-4000-8000-000000000000"],
    FOREIGN_KEY,
    "app_user_current_child_fkey",
  );
  await q(sql, [owner, own]);
  await q(sql, [owner, null]);
});

test("identity is unique per provider subject and per provider identifier", async () => {
  const a = await newUser();
  const b = await newUser();
  const sql =
    "INSERT INTO identity (user_id, provider, provider_subject, identifier) VALUES ($1, $2, $3, $4)";
  await q(sql, [a, "email", "subject-1", "parent@example.test"]);
  await rejects(sql, [b, "email", "subject-1", "other@example.test"], UNIQUE, "identity_provider_subject_key");
  await rejects(sql, [b, "email", "subject-2", "parent@example.test"], UNIQUE, "identity_provider_identifier_key");
  await q(sql, [b, "phone", "subject-1", "parent@example.test"]);
  await rejects(sql, [a, null, "s", "i"], NOT_NULL, "provider");
  await rejects(sql, [a, "email", null, "i"], NOT_NULL, "provider_subject");
  await rejects(sql, [a, "email", "s", null], NOT_NULL, "identifier");
  await rejects(
    sql,
    ["00000000-0000-4000-8000-000000000000", "email", "s", "i"],
    FOREIGN_KEY,
    "identity_user_id_fkey",
  );
});

test("worksheet_archive.name rejects blank values; uploaded_at defaults", async () => {
  const user = await newUser();
  const sql = "INSERT INTO worksheet_archive (user_id, name) VALUES ($1, $2)";
  for (const value of ["", " ", "\t", "\n", " \t\n\r\v\f"]) {
    await rejects(sql, [user, value], CHECK, "worksheet_archive_name_not_blank_check");
  }
  await rejects(sql, [user, null], NOT_NULL, "name");
  const id = await newArchive(user, " Week 1 ");
  const [row] = await q("SELECT name, uploaded_at FROM worksheet_archive WHERE id = $1", [id]);
  assert.equal(row.name, " Week 1 ");
  assert.ok(row.uploaded_at instanceof Date);
});

test("grading_session binds a Child and optional archive of the same User", async () => {
  const owner = await newUser();
  const other = await newUser();
  const childA = await newChild(owner, "A");
  const childB = await newChild(owner, "B");
  const foreignChild = await newChild(other);
  const archive = await newArchive(owner);
  const foreignArchive = await newArchive(other);
  const sql =
    "INSERT INTO grading_session (user_id, child_id, worksheet_archive_id) VALUES ($1, $2, $3)";
  await rejects(sql, [owner, foreignChild, null], FOREIGN_KEY, "grading_session_child_fkey");
  await rejects(sql, [owner, childA, foreignArchive], FOREIGN_KEY, "grading_session_worksheet_archive_fkey");
  await newSession(owner, childA, null);
  // Two Children of one User may share one WorksheetArchive (User-level archive).
  await newSession(owner, childA, archive);
  await newSession(owner, childB, archive);
});

test("error_question inherits its GradingSession's Child", async () => {
  const user = await newUser();
  const childA = await newChild(user, "A");
  const childB = await newChild(user, "B");
  const session = await newSession(user, childA);
  const sql = "INSERT INTO error_question (grading_session_id, child_id) VALUES ($1, $2)";
  await rejects(sql, [session, childB], FOREIGN_KEY, "error_question_grading_session_fkey");
  await newErrorQuestion(session, childA);
  // Once questions reference the session, its child_id can no longer change.
  await rejects(
    "UPDATE grading_session SET child_id = $2 WHERE id = $1",
    [session, childB],
    FOREIGN_KEY,
    "error_question_grading_session_fkey",
  );
});

test("correction_worksheet cannot mix Children's error questions", async () => {
  const user = await newUser();
  const childA = await newChild(user, "A");
  const childB = await newChild(user, "B");
  const questionA = await newErrorQuestion(await newSession(user, childA), childA);
  const questionB = await newErrorQuestion(await newSession(user, childB), childB);
  await rejects(
    "INSERT INTO correction_worksheet (child_id) VALUES ($1)",
    ["00000000-0000-4000-8000-000000000000"],
    FOREIGN_KEY,
    "correction_worksheet_child_id_fkey",
  );
  const worksheet = await newWorksheet(childA);
  const sql =
    "INSERT INTO correction_worksheet_item (correction_worksheet_id, error_question_id, child_id) VALUES ($1, $2, $3)";
  await rejects(sql, [worksheet, questionB, childA], FOREIGN_KEY, "correction_worksheet_item_error_question_fkey");
  await rejects(sql, [worksheet, questionB, childB], FOREIGN_KEY, "correction_worksheet_item_worksheet_fkey");
  await q(sql, [worksheet, questionA, childA]);
  await rejects(sql, [worksheet, questionA, childA], UNIQUE, "correction_worksheet_item_pkey");
});
