// Tests for the task 1.4 local-dev fixture seed (run: npm run test:dev-seed).
//
// Database cases run only against a disposable, already-migrated test database. The
// connection string is read from ERRLOG_SCHEMA_TEST_DATABASE_URL only (never
// DATABASE_URL) and is never printed. Every database case runs in its own transaction
// that is always rolled back, so no rows are left behind; nothing is ever committed.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import pg from "pg";
import { FIXTURE, seedDevIdentity } from "./dev-seed.mjs";

const FOREIGN_KEY = "23503";
const CLI = fileURLToPath(new URL("./dev-seed.mjs", import.meta.url));

let client;

before(async () => {
  const connectionString = process.env.ERRLOG_SCHEMA_TEST_DATABASE_URL;
  assert.ok(
    connectionString,
    "ERRLOG_SCHEMA_TEST_DATABASE_URL must point at a disposable, migrated test database",
  );
  client = new pg.Client({ connectionString });
  await client.connect();
});

after(async () => {
  if (client) await client.end();
});

async function q(sql, params = []) {
  return (await client.query(sql, params)).rows;
}

// Runs fn inside a transaction that is always rolled back.
async function rolledBack(fn) {
  await client.query("BEGIN");
  try {
    await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

async function snapshot() {
  return {
    app_user: await q("SELECT id, current_child_id FROM app_user ORDER BY id"),
    identity: await q(
      "SELECT id, user_id, provider, provider_subject, identifier FROM identity ORDER BY id",
    ),
    child: await q("SELECT id, user_id, display_name FROM child ORDER BY id"),
    grading_session: await q("SELECT id FROM grading_session ORDER BY id"),
  };
}

async function count(table) {
  return (await q(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
}

// Inserts a partial or altered fixture to exercise the inconsistent-state checks.
async function insertFixtureIdentity(subject = FIXTURE.providerSubject) {
  const userId = (await q("INSERT INTO app_user DEFAULT VALUES RETURNING id"))[0].id;
  await q(
    "INSERT INTO identity (user_id, provider, provider_subject, identifier) VALUES ($1, $2, $3, $4)",
    [userId, FIXTURE.provider, subject, FIXTURE.identifier],
  );
  return userId;
}

async function addCurrentChild(userId, displayName) {
  const childId = (
    await q("INSERT INTO child (user_id, display_name) VALUES ($1, $2) RETURNING id", [
      userId,
      displayName,
    ])
  )[0].id;
  await q("UPDATE app_user SET current_child_id = $2 WHERE id = $1", [userId, childId]);
}

async function assertRejectedWithoutWrites(pattern) {
  const before = await snapshot();
  await assert.rejects(seedDevIdentity(client), pattern);
  assert.deepEqual(await snapshot(), before);
}

test("fixture values are synthetic and normalized", () => {
  assert.equal(FIXTURE.provider, "dev-seed");
  assert.equal(FIXTURE.providerSubject, "dev-seed:dev-parent");
  assert.match(FIXTURE.identifier, /@example\.test$/);
  assert.equal(FIXTURE.childDisplayName, "Dev Child");
  assert.equal(FIXTURE.childDisplayName.trim(), FIXTURE.childDisplayName);
});

test("(a) first run creates exactly one User, Identity and current Child", () =>
  rolledBack(async () => {
    const before = { app_user: await count("app_user"), identity: await count("identity"), child: await count("child") };
    const result = await seedDevIdentity(client);
    assert.equal(result.status, "created");
    assert.deepEqual(
      { app_user: await count("app_user"), identity: await count("identity"), child: await count("child") },
      { app_user: before.app_user + 1, identity: before.identity + 1, child: before.child + 1 },
    );
    const [row] = await q(
      `SELECT u.id AS user_id, u.current_child_id, i.id AS identity_id, i.provider,
              i.provider_subject, i.identifier, c.id AS child_id, c.user_id AS child_user_id,
              c.display_name
         FROM identity i
         JOIN app_user u ON u.id = i.user_id
         JOIN child c ON c.id = u.current_child_id
        WHERE i.provider = $1 AND i.identifier = $2`,
      [FIXTURE.provider, FIXTURE.identifier],
    );
    assert.deepEqual(row, {
      user_id: result.userId,
      current_child_id: result.childId,
      identity_id: result.identityId,
      provider: FIXTURE.provider,
      provider_subject: FIXTURE.providerSubject,
      identifier: FIXTURE.identifier,
      child_id: result.childId,
      child_user_id: result.userId,
      display_name: FIXTURE.childDisplayName,
    });
    assert.notEqual(row.display_name, "");
    assert.equal(row.display_name.trim(), row.display_name);
  }));

test("(b) a second run reports the existing fixture and changes no data", () =>
  rolledBack(async () => {
    const first = await seedDevIdentity(client);
    const afterFirst = await snapshot();
    const second = await seedDevIdentity(client);
    assert.equal(second.status, "existing");
    assert.deepEqual(
      { userId: second.userId, identityId: second.identityId, childId: second.childId },
      { userId: first.userId, identityId: first.identityId, childId: first.childId },
    );
    assert.deepEqual(await snapshot(), afterFirst);
  }));

test("an Identity whose User has no current Child is rejected without writes", () =>
  rolledBack(async () => {
    await insertFixtureIdentity();
    await assertRejectedWithoutWrites(/inconsistent/);
  }));

test("an Identity with a different provider_subject is rejected without writes", () =>
  rolledBack(async () => {
    const userId = await insertFixtureIdentity("dev-seed:someone-else");
    await addCurrentChild(userId, FIXTURE.childDisplayName);
    await assertRejectedWithoutWrites(/inconsistent/);
  }));

test("a current Child with a different display_name is rejected without writes", () =>
  rolledBack(async () => {
    const userId = await insertFixtureIdentity();
    await addCurrentChild(userId, "Renamed Child");
    await assertRejectedWithoutWrites(/inconsistent/);
  }));

// Test-only probe of 1.4 (c): the seed itself never writes grading_session. This shows
// the seeded rows satisfy the 1.3 ownership constraints; it is not a caller-context check.
test("(c) the seeded User and Child satisfy the 1.3 ownership constraints", () =>
  rolledBack(async () => {
    const sessionsBefore = await count("grading_session");
    const seeded = await seedDevIdentity(client);
    assert.equal(await count("grading_session"), sessionsBefore);

    const accepted = await q(
      "INSERT INTO grading_session (user_id, child_id) VALUES ($1, $2) RETURNING user_id, child_id",
      [seeded.userId, seeded.childId],
    );
    assert.deepEqual(accepted, [{ user_id: seeded.userId, child_id: seeded.childId }]);

    const otherUser = (await q("INSERT INTO app_user DEFAULT VALUES RETURNING id"))[0].id;
    // A constraint error aborts the transaction, so the rejected insert gets a savepoint.
    await client.query("SAVEPOINT mismatched");
    await assert.rejects(
      client.query("INSERT INTO grading_session (user_id, child_id) VALUES ($1, $2)", [
        otherUser,
        seeded.childId,
      ]),
      (err) => err.code === FOREIGN_KEY && err.constraint === "grading_session_child_fkey",
    );
    await client.query("ROLLBACK TO SAVEPOINT mismatched");
  }));

// Starts a TCP listener that counts connections and closes each one immediately.
async function sentinelServer() {
  let connections = 0;
  const server = createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    connections: () => connections,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runCli(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
  });
}

test("(d) the CLI refuses without ERRLOG_DEV_SEED_DATABASE_URL and connects nowhere", async () => {
  const sentinel = await sentinelServer();
  try {
    const decoy = `postgres://decoy:decoy-secret-value@127.0.0.1:${sentinel.port}/decoy`;
    const { code, output } = await runCli({
      PATH: process.env.PATH,
      DATABASE_URL: decoy,
      ERRLOG_SCHEMA_TEST_DATABASE_URL: decoy,
      PGHOST: "127.0.0.1",
      PGPORT: String(sentinel.port),
    });
    assert.notEqual(code, 0);
    assert.match(output, /ERRLOG_DEV_SEED_DATABASE_URL/);
    assert.doesNotMatch(output, /decoy-secret-value/);
    assert.equal(sentinel.connections(), 0);
  } finally {
    await sentinel.close();
  }
});

test("(d) the CLI never prints its connection string, even when connecting fails", async () => {
  const sentinel = await sentinelServer();
  try {
    const url = `postgres://dev:dev-secret-value@127.0.0.1:${sentinel.port}/dev`;
    const { code, output } = await runCli({ PATH: process.env.PATH, ERRLOG_DEV_SEED_DATABASE_URL: url });
    assert.notEqual(code, 0);
    assert.equal(sentinel.connections(), 1);
    assert.doesNotMatch(output, /dev-secret-value/);
    assert.doesNotMatch(output, /postgres:\/\//);
  } finally {
    await sentinel.close();
  }
});
