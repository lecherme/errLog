// Local-development-only fixture seed (task 1.4; run: npm run db:seed:dev).
//
// Inserts one synthetic local-dev fixture identity: one User with one Identity and one
// Child, the Child set as the User's current Child. Later stages consume it as a data
// precondition before real Auth exists (2.5: caller-context check; 4.1: labeled
// pre-journey precondition). The Identity is a dev fixture only: not an allowlist
// entry, not a login path, and never a production auth path. This directory is
// excluded from the web image (.dockerignore); run it through a read-only bind mount.
//
// The CLI reads its connection string from ERRLOG_DEV_SEED_DATABASE_URL only (never
// DATABASE_URL) and never prints it. Output is one JSON line of synthetic values and
// UUIDs.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const FIXTURE = Object.freeze({
  provider: "dev-seed",
  providerSubject: "dev-seed:dev-parent",
  identifier: "dev-parent@example.test",
  childDisplayName: "Dev Child",
});

function inconsistent(detail) {
  return new Error(`dev-seed fixture is in an inconsistent state: ${detail}; nothing was changed`);
}

// Runs inside the caller's transaction. Creates the fixture, or reports the existing
// one without writing anything. Any partial or altered fixture is an error, never repaired.
export async function seedDevIdentity(client) {
  const { rows: found } = await client.query(
    `SELECT i.id AS identity_id, i.user_id, i.provider_subject, u.current_child_id,
            c.display_name
       FROM identity i
       JOIN app_user u ON u.id = i.user_id
       LEFT JOIN child c ON c.user_id = u.id AND c.id = u.current_child_id
      WHERE i.provider = $1 AND i.identifier = $2`,
    [FIXTURE.provider, FIXTURE.identifier],
  );
  if (found.length) {
    const [row] = found;
    if (row.provider_subject !== FIXTURE.providerSubject) throw inconsistent("unexpected provider_subject");
    if (row.current_child_id === null) throw inconsistent("the User has no current Child");
    if (row.display_name !== FIXTURE.childDisplayName) throw inconsistent("unexpected current Child");
    return { status: "existing", ...ids(row.user_id, row.identity_id, row.current_child_id) };
  }

  const userId = (await client.query("INSERT INTO app_user DEFAULT VALUES RETURNING id")).rows[0].id;
  const identityId = (
    await client.query(
      `INSERT INTO identity (user_id, provider, provider_subject, identifier)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, FIXTURE.provider, FIXTURE.providerSubject, FIXTURE.identifier],
    )
  ).rows[0].id;
  const childId = (
    await client.query("INSERT INTO child (user_id, display_name) VALUES ($1, $2) RETURNING id", [
      userId,
      FIXTURE.childDisplayName,
    ])
  ).rows[0].id;
  await client.query("UPDATE app_user SET current_child_id = $2 WHERE id = $1", [userId, childId]);
  return { status: "created", ...ids(userId, identityId, childId) };
}

function ids(userId, identityId, childId) {
  return { provider: FIXTURE.provider, identifier: FIXTURE.identifier, userId, identityId, childId };
}

async function main() {
  const connectionString = process.env.ERRLOG_DEV_SEED_DATABASE_URL;
  if (!connectionString) {
    console.error("dev-seed: ERRLOG_DEV_SEED_DATABASE_URL is not set; refusing to run");
    process.exitCode = 1;
    return;
  }
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    try {
      const result = await seedDevIdentity(client);
      await client.query("COMMIT");
      console.log(JSON.stringify(result));
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } catch (err) {
    // pg error messages never include the connection string; print only the message.
    console.error(`dev-seed: failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

const self = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && realpathSync(process.argv[1]) === self) await main();
