import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

async function freePort() {
  const socket = net.createServer();
  await new Promise((done, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", done);
  });
  const { port } = socket.address();
  await new Promise((done) => socket.close(done));
  return port;
}

export async function startTestDatabase({
  applyMigrations = true,
  legacyDoctorFixtures = false,
  through = null,
} = {}) {
  const localRoot = resolve(".local");
  await mkdir(localRoot, { recursive: true });
  const databaseDir = await mkdtemp(join(localRoot, "db-test-"));
  // embedded-postgres removes this dedicated directory on stop; check containment first.
  assert.equal(dirname(resolve(databaseDir)), localRoot);
  const port = await freePort();
  const password = randomBytes(32).toString("hex");
  const logs = [];
  const cluster = new EmbeddedPostgres({
    databaseDir,
    port,
    user: "postgres",
    password,
    authMethod: "scram-sha-256",
    persistent: false,
    createPostgresUser: false,
    initdbFlags: ["--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1", "-c", "max_connections=25"],
    onLog: (message) => {
      logs.push(message);
      if (logs.length > 20) logs.shift();
    },
    onError: (message) => {
      logs.push(String(message));
    },
  });
  const connection = {
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "eyada_phase2_test",
  };
  const pool = new pg.Pool({ ...connection, max: 4 });
  const clients = new Set();
  async function connect() {
    const client = new pg.Client(connection);
    await client.connect();
    clients.add(client);
    return client;
  }
  async function stop() {
    await pool.end();
    await Promise.all([...clients].map((client) => client.end()));
    await cluster.stop();
  }
  try {
    await cluster.initialise();
    await cluster.start();
    await cluster.createDatabase(connection.database);
    const owner = await connect();
    await owner.query(await readFile("tests/database/bootstrap.sql", "utf8"));
    await owner.query(
      await readFile("tests/database/vault-adapter.sql", "utf8"),
    );
    const migrations = (await readdir("supabase/migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .filter((name) => !through || name <= through);
    assert.ok(
      migrations.length > 0,
      "At least one version-controlled migration is required",
    );
    if (applyMigrations) {
      for (const migration of migrations) {
        await owner.query(
          await readFile(join("supabase/migrations", migration), "utf8"),
        );
      }
      if (legacyDoctorFixtures) {
        // Isolated local fixture provisioning only; never part of application migrations.
        await owner.query(
          await readFile("tests/database/legacy-clinic-fixtures.sql", "utf8"),
        );
      }
    }
    return { owner, pool, connect, stop, migrations, connection };
  } catch (error) {
    await stop();
    throw new Error(
      `Local PostgreSQL verification failed: ${error.message}\n${logs.join("").slice(-2500)}`,
      { cause: error },
    );
  }
}
