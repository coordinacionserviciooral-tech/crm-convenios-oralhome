import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const schema = await readFile(
  new URL("../supabase/schema.sql", import.meta.url),
  "utf8",
);
const documentSchema = await readFile(
  new URL("../supabase/documents.sql", import.meta.url),
  "utf8",
);
const ids = {
  admin: "00000000-0000-4000-8000-000000000001",
  commercial: "00000000-0000-4000-8000-000000000002",
  consult: "00000000-0000-4000-8000-000000000003",
  blocked: "00000000-0000-4000-8000-000000000004",
};
async function setup() {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`,
  );
  await db.exec(schema);
  for (const [name, id] of Object.entries(ids)) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id,
      `${name}@example.com`,
    ]);
    await db.query(
      "update public.profiles set role=$1,is_active=$2 where id=$3",
      [
        {
          admin: "administrador",
          commercial: "comercial",
          consult: "consulta",
          blocked: "consulta",
        }[name],
        name !== "blocked",
        id,
      ],
    );
  }
  await db.exec(
    `insert into public."Aliados"("Compañia",tarifa,actividades) values('Test Company','{"2017":50,"2026":125.5}','[{"fecha":"2026-10-15","nota":"Preserve","cumplida":false}]');`,
  );
  return db;
}
async function asUser(db, name) {
  await db.exec(
    `reset role; set request.jwt.claim.sub='${ids[name] || ""}'; set role ${name === "anon" ? "anon" : "authenticated"};`,
  );
}
test("migration can be rerun without losing agreements, roles or history", async () => {
  const db = await setup();
  const before = (await db.query('select * from public."Aliados"')).rows;
  await db.exec(schema);
  assert.deepEqual(
    (await db.query('select * from public."Aliados"')).rows,
    before,
  );
  assert.equal(
    (await db.query("select count(*)::integer n from profiles where is_active"))
      .rows[0].n,
    3,
  );
  await db.close();
});
test("database blocks anonymous and inactive access and enforces consultation read-only", async () => {
  const db = await setup();
  await asUser(db, "anon");
  await assert.rejects(
    db.query('select * from public."Aliados"'),
    /permission denied/,
  );
  await asUser(db, "blocked");
  assert.equal(
    (await db.query('select * from public."Aliados"')).rows.length,
    0,
  );
  await asUser(db, "consult");
  assert.equal(
    (await db.query('select * from public."Aliados"')).rows.length,
    1,
  );
  await assert.rejects(
    db.exec(`insert into public."Aliados"("Compañia") values('Forbidden')`),
    /row-level security|No autorizado/,
  );
  assert.equal(
    (
      await db.query(
        `update public."Aliados" set "Producto"='Forbidden' returning *`,
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    db.exec('delete from public."Aliados"'),
    /permission denied/,
  );
  await db.close();
});
test("commercial may edit but cannot archive, restore, manage users or spoof creator", async () => {
  const db = await setup();
  await asUser(db, "commercial");
  const edited = await db.query(
    `update public."Aliados" set "Producto"='Allowed', created_by=$1 returning *`,
    [ids.consult],
  );
  assert.equal(edited.rows[0].Producto, "Allowed");
  assert.equal(edited.rows[0].created_by, null);
  assert.equal(edited.rows[0].updated_by, ids.commercial);
  await assert.rejects(
    db.exec(`update public."Aliados" set archived_at=now()`),
    /administrador|row-level security/,
  );
  assert.equal(
    (
      await db.query(
        `update profiles set role='administrador' where id=$1 returning *`,
        [ids.commercial],
      )
    ).rows.length,
    0,
  );
  await asUser(db, "admin");
  await db.exec(`update public."Aliados" set archived_at=now()`);
  await asUser(db, "commercial");
  assert.equal(
    (await db.query(`update public."Aliados" set archived_at=null returning *`))
      .rows.length,
    0,
  );
  await db.close();
});
test("admin archive and restore are audited; last admin cannot be removed", async () => {
  const db = await setup();
  await asUser(db, "admin");
  await db.exec(
    `update public."Aliados" set archived_at=now(); update public."Aliados" set archived_at=null;`,
  );
  assert.ok(
    (
      await db.query(`select action from audit_logs where entity='Aliados'`)
    ).rows.some((r) => r.action === "ARCHIVE"),
  );
  assert.ok(
    (
      await db.query(`select action from audit_logs where entity='Aliados'`)
    ).rows.some((r) => r.action === "RESTORE"),
  );
  await assert.rejects(
    db.query(`update profiles set is_active=false where id=$1`, [ids.admin]),
    /último administrador/,
  );
  await db.close();
});
test("alert claims prevent duplicates and allow retries; only server may claim", async () => {
  const db = await setup();
  await asUser(db, "admin");
  await assert.rejects(
    db.exec(
      `select claim_crm_alert('key',1,'gestion','2026-10-15',8,'am','test@example.com','{}')`,
    ),
    /permission denied/,
  );
  await db.exec("reset role; set role service_role;");
  const sql = `select claim_crm_alert('key',1,'gestion','2026-10-15',8,'am','test@example.com','{}') as claim`;
  assert.equal((await db.query(sql)).rows[0].claim.attempts, 1);
  assert.equal((await db.query(sql)).rows[0].claim, null);
  await db.exec(`update alert_log set status='failed' where alert_key='key'`);
  assert.equal((await db.query(sql)).rows[0].claim.attempts, 2);
  await db.exec(`update alert_log set status='sent' where alert_key='key'`);
  assert.equal((await db.query(sql)).rows[0].claim, null);
  await db.close();
});

test("cron uses the Vault digest and never exposes it to CRM users", async () => {
  const db = await setup();
  await db.exec(`create schema vault; create table vault.decrypted_secrets(name text, decrypted_secret text);
    insert into vault.decrypted_secrets values ('oralhome_cron_secret','test-secret');`);
  await asUser(db, "admin");
  await assert.rejects(
    db.query("select public.crm_cron_secret_digest()"),
    /permission denied/,
  );
  await db.exec("reset role; set role service_role;");
  const { createHash } = await import("node:crypto");
  assert.equal(
    (await db.query("select public.crm_cron_secret_digest() as digest")).rows[0]
      .digest,
    createHash("sha256").update("test-secret").digest("hex"),
  );
  await db.close();
});

test("documents remain private; consultation cannot upload and archived attachments cannot be permanently deleted", async () => {
  const db = await setup();
  await db.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to anon,authenticated,service_role;
 grant select,insert,delete on storage.objects to authenticated; grant select on storage.objects to anon; grant all on storage.objects to service_role;`);
  await db.exec(documentSchema);
  await db.exec(documentSchema);
  const id = "00000000-0000-4000-8000-000000000010",
    path = `1/${id}/contrato.pdf`;
  await asUser(db, "admin");
  await db.query(
    `insert into storage.objects(bucket_id,name,owner_id,metadata) values('crm-convenios-documentos',$1,$2,'{"size":100}')`,
    [path, ids.admin],
  );
  await db.query(
    `insert into agreement_documents(id,agreement_id,original_name,storage_path,media_type,size_bytes) values($1,1,'contrato.pdf',$2,'application/pdf',100)`,
    [id, path],
  );
  assert.equal(
    (await db.query("select count(*)::integer n from agreement_documents"))
      .rows[0].n,
    1,
  );
  await asUser(db, "consult");
  assert.equal(
    (await db.query("select count(*)::integer n from storage.objects")).rows[0]
      .n,
    0,
  );
  await assert.rejects(
    db.query(
      `insert into storage.objects(bucket_id,name,owner_id,metadata) values('crm-convenios-documentos',$1,$2,'{"size":100}')`,
      ["1/00000000-0000-4000-8000-000000000011/test.pdf", ids.consult],
    ),
    /row-level security/,
  );
  await asUser(db, "blocked");
  assert.equal(
    (await db.query("select count(*)::integer n from agreement_documents"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (await db.query("select count(*)::integer n from storage.objects")).rows[0]
      .n,
    0,
  );
  await asUser(db, "admin");
  await db.query(
    "update agreement_documents set archived_at=now() where id=$1",
    [id],
  );
  await asUser(db, "commercial");
  assert.equal(
    (await db.query("select count(*)::integer n from agreement_documents"))
      .rows[0].n,
    0,
  );
  assert.equal(
    (
      await db.query("delete from storage.objects where name=$1 returning *", [
        path,
      ])
    ).rows.length,
    0,
  );
  await asUser(db, "admin");
  assert.equal(
    (await db.query("select count(*)::integer n from storage.objects")).rows[0]
      .n,
    1,
  );
  await db.query(
    "update agreement_documents set archived_at=null where id=$1",
    [id],
  );
  assert.deepEqual(
    (
      await db.query(
        "select action from audit_logs where entity='agreement_documents' order by id",
      )
    ).rows.map((r) => r.action),
    ["UPLOAD_DOCUMENT", "ARCHIVE_DOCUMENT", "RESTORE_DOCUMENT"],
  );
  await asUser(db, "anon");
  await assert.rejects(
    db.query("select * from agreement_documents"),
    /permission denied/,
  );
  assert.equal(
    (await db.query("select count(*)::integer n from storage.objects")).rows[0]
      .n,
    0,
  );
  await db.close();
});

test("document links reject ownership theft, mismatched sizes and archived agreement uploads; cleanup only removes unlinked uploads", async () => {
  const db = await setup();
  await db.exec(`create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,service_role; grant select,insert,delete on storage.objects to authenticated;`);
  await db.exec(documentSchema);
  const id = "00000000-0000-4000-8000-000000000020",
    path = `1/${id}/contrato.pdf`;
  await asUser(db, "admin");
  await db.query(
    `insert into storage.objects(bucket_id,name,owner_id,metadata) values('crm-convenios-documentos',$1,$2,'{"size":100}')`,
    [path, ids.admin],
  );
  await asUser(db, "commercial");
  const insert = `insert into agreement_documents(id,agreement_id,original_name,storage_path,media_type,size_bytes) values($1,1,'contrato.pdf',$2,'application/pdf',$3)`;
  await assert.rejects(
    db.query(insert, [id, path, 100]),
    /No autorizado|row-level security/,
  );
  await asUser(db, "admin");
  await assert.rejects(db.query(insert, [id, path, 101]), /pertenece/);
  assert.equal(
    (
      await db.query("delete from storage.objects where name=$1 returning *", [
        path,
      ])
    ).rows.length,
    1,
  );
  await db.exec('update public."Aliados" set archived_at=now()');
  await assert.rejects(
    db.query(
      `insert into storage.objects(bucket_id,name,owner_id,metadata) values('crm-convenios-documentos',$1,$2,'{"size":100}')`,
      [path, ids.admin],
    ),
    /row-level security/,
  );
  await db.close();
});

test("tariff acknowledgement is server controlled and only additions or value changes stop renewal", async () => {
  const db = await setup();
  try {
    const migration = await readFile(
      new URL("../supabase/renewal-alerts.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(
      `update public."Aliados" set "Responsable_cliente"='New contact',tariff_reviewed_at=now();`,
    );
    assert.equal(
      (await db.query(`select tariff_reviewed_at from public."Aliados"`))
        .rows[0].tariff_reviewed_at,
      null,
    );
    await db.exec(
      `update public."Aliados" set tarifa=tarifa || '{"2027":140}'::jsonb;`,
    );
    const acknowledged = (
      await db.query(`select tariff_reviewed_at from public."Aliados"`)
    ).rows[0].tariff_reviewed_at;
    assert.ok(acknowledged);
    await db.exec(
      `update public."Aliados" set tarifa=tarifa-'2017',tariff_reviewed_at=null;`,
    );
    assert.deepEqual(
      (await db.query(`select tariff_reviewed_at from public."Aliados"`))
        .rows[0].tariff_reviewed_at,
      acknowledged,
    );
  } finally {
    await db.close();
  }
});

test("invited user activation is service-only, validates the active administrator and records the actor atomically", async () => {
  const db = await setup();
  try {
    const migration = await readFile(
      new URL("../supabase/admin-users.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(`set role authenticated;`);
    await assert.rejects(
      db.query("select activate_crm_invited_user($1,$2,$3,$4)", [
        ids.blocked,
        ids.admin,
        "Test Invite",
        "comercial",
      ]),
      /permission denied/,
    );
    await db.exec(`reset role;`);
    await assert.rejects(
      db.query("select activate_crm_invited_user($1,$2,$3,$4)", [
        ids.blocked,
        ids.consult,
        "Test Invite",
        "comercial",
      ]),
      /Administrador no autorizado/,
    );
    await db.query("select activate_crm_invited_user($1,$2,$3,$4)", [
      ids.blocked,
      ids.admin,
      "Test Invite",
      "comercial",
    ]);
    const profile = (
      await db.query(
        "select full_name,role,is_active from profiles where id=$1",
        [ids.blocked],
      )
    ).rows[0];
    assert.deepEqual(profile, {
      full_name: "Test Invite",
      role: "comercial",
      is_active: true,
    });
    assert.equal(
      (
        await db.query(
          "select user_id from audit_logs where action='CREATE_USER'",
        )
      ).rows[0].user_id,
      ids.admin,
    );
    await assert.rejects(
      db.query("select activate_crm_invited_user($1,$2,$3,$4)", [
        ids.blocked,
        ids.admin,
        "Override",
        "administrador",
      ]),
      /ya est/,
    );
  } finally {
    await db.close();
  }
});
