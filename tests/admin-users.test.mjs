import test from "node:test";
import assert from "node:assert/strict";
import { createInvitedUser } from "../supabase/functions/admin-users/handler.js";
const input = {
  full_name: " Ana P�rez ",
  email: " ANA@example.com ",
  role: "consulta",
};
test("user creation rejects missing sessions, non-admin users and malformed roles before sending invitations", async () => {
  let invited = 0;
  const adapter = {
    authorize: async () => null,
    invite: async () => {
      invited++;
    },
  };
  assert.equal((await createInvitedUser(input, null, adapter)).status, 401);
  assert.equal(
    (await createInvitedUser(input, "consult", adapter)).status,
    403,
  );
  adapter.authorize = async () => "admin";
  assert.equal(
    (await createInvitedUser({ ...input, role: "owner" }, "admin", adapter))
      .status,
    400,
  );
  assert.equal(
    (await createInvitedUser({ ...input, email: "invalid" }, "admin", adapter))
      .status,
    400,
  );
  assert.equal(invited, 0);
});
test("admin invitation assigns each authorized role without passwords or changing existing accounts", async () => {
  for (const role of ["consulta", "comercial", "administrador"]) {
    const calls = [];
    const result = await createInvitedUser({ ...input, role }, "admin", {
      authorize: async () => "actor",
      invite: async (...args) => {
        calls.push(args);
        return { id: "new", link: "https://example.com/invite" };
      },
      activate: async (...args) => calls.push(args),
    });
    assert.equal(result.status, 201);
    assert.equal(result.invitation_url, "https://example.com/invite");
    assert.deepEqual(calls, [
      ["ana@example.com", "Ana P�rez"],
      ["new", "actor", "Ana P�rez", role],
    ]);
  }
  let activated = false;
  const duplicate = await createInvitedUser(input, "admin", {
    authorize: async () => "actor",
    invite: async () => ({ error: true }),
    activate: async () => {
      activated = true;
    },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(activated, false);
  const partial = await createInvitedUser(input, "admin", {
    authorize: async () => "actor",
    invite: async () => ({ id: "new", link: "https://example.com/invite" }),
    activate: async () => {
      throw Error("database failure");
    },
  });
  assert.match(partial.error, /no se pudo activar/);
});
