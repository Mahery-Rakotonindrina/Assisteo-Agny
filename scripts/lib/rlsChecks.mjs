// The Row Level Security of the shared budget (migration 0009_households.sql)
// and of the loans (0010_loans.sql),
// tested as Supabase runs it: each query as the "authenticated" role with a
// user id, or as the server ("service_role"). `client.query(text, params)`
// must return { rows }. Returns the problems found (empty: all good).
import { randomUUID } from "node:crypto";

export async function runRlsChecks(client) {
  const problems = [];
  const [anna, ben, carla] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, email, name] of [
    [anna, "anna.rabe@example.com", "Anna Rabe"],
    [ben, "ben@example.com", null],
    [carla, "carla@example.com", null],
  ]) {
    await client.query("insert into auth.users (id, email, created_at, raw_user_meta_data) values ($1, $2, now(), $3)", [id, email, name ? { full_name: name } : {}]);
  }

  /** Runs `queries` in a transaction as `role` (and user), then rolls back or commits. */
  async function as(role, user, queries, { keep = true } = {}) {
    await client.query("begin");
    try {
      await client.query(`set local role ${role}`);
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
      const result = await queries();
      await client.query(keep ? "commit" : "rollback");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
  const server = (sql, params) => as("service_role", null, async () => (await client.query(sql, params)).rows);
  const user = (who, sql, params) => as("authenticated", who, async () => (await client.query(sql, params)).rows);
  const visitor = (sql, params) => as("anon", null, async () => (await client.query(sql, params)).rows);
  // For what must be refused: rolled back, so a hole doesn't spoil the next checks.
  const tryUser = (who, sql, params) => as("authenticated", who, async () => (await client.query(sql, params)).rows, { keep: false });
  const tryVisitor = (sql, params) => as("anon", null, async () => (await client.query(sql, params)).rows, { keep: false });

  async function check(label, run) {
    try {
      const failure = await run();
      if (failure) problems.push(`${label}: ${failure}`);
    } catch (error) {
      problems.push(`${label}: ${error.message}`);
    }
  }
  /** The query must fail, with a message matching `pattern`. */
  async function refused(label, run, pattern = /./) {
    try {
      await run();
      problems.push(`${label}: allowed`);
    } catch (error) {
      if (!pattern.test(error.message)) problems.push(`${label}: refused for another reason (${error.message})`);
    }
  }
  const count = async (who, sql, params) => (await user(who, sql, params)).length;

  // ---- Set up: Anna creates a household and invites Ben ---------------------------
  await refused("a client can't create a household itself", () => tryUser(anna, "select public.create_household($1, 'Famille')", [anna]), /permission denied/);
  await refused("a client can't join without the server", () => tryUser(carla, "select public.join_household($1, 'AAAAAA')", [carla]), /permission denied/);
  await refused("a client can't insert a household directly", () => tryUser(carla, "insert into public.households (owner_id, data) values ($1, '{}')", [carla]));
  const [{ hid }] = await server("select public.create_household($1, 'Famille Rabe') as hid", [anna]);
  await refused("one household per account", () => server("select public.create_household($1, 'Encore')", [anna]), /already_member/);

  const [{ invite }] = await server("select public.create_household_invite($1, $2) as invite", [anna, hid]);
  await check("the code has 6 signs from the alphabet", () => (/^[234679ACDEFGHJKMNPQRTUVWXY]{6}$/.test(invite.code) ? null : `got ${invite.code}`));
  await refused("only the owner makes a code", () => server("select public.create_household_invite($1, $2)", [ben, hid]), /not_owner/);
  await check("nobody reads the codes directly", async () => {
    for (const who of [anna, ben, carla]) {
      try {
        const rows = await user(who, "select code from public.household_invites");
        if (rows.length) return "rows visible";
      } catch (error) {
        if (!/permission denied/.test(error.message)) throw error;
      }
    }
    return null;
  });

  await refused("a wrong code is refused", () => server("select public.join_household($1, 'QQQQQQ')", [ben]), /invalid_code/);
  await server("select public.join_household($1, $2)", [ben, invite.code.toLowerCase()]);
  await refused("joining twice is refused", () => server("select public.join_household($1, $2)", [ben, invite.code]), /already_member/);

  // An expired code, and a revoked one.
  await client.query("insert into public.household_invites (code, household_id, created_by, expires_at) values ('XXXXXX', $1, $2, now() - interval '1 minute')", [hid, anna]);
  await refused("an expired code is refused", () => server("select public.join_household($1, 'XXXXXX')", [carla]), /expired/);
  await server("select public.revoke_household_invites($1, $2)", [anna, hid]);
  await refused("a revoked code is refused", () => server("select public.join_household($1, $2)", [carla, invite.code]), /invalid_code/);
  await refused("a member reusing a revoked code is refused", () => server("select public.join_household($1, $2)", [ben, invite.code]), /already_member/);
  await refused("a member reusing an expired code is refused", () => server("select public.join_household($1, 'XXXXXX')", [ben]), /already_member/);

  // ---- Only the server calls the functions -------------------------------------------
  const [{ live }] = await server("select public.create_household_invite($1, $2) as live", [anna, hid]);
  const serverOnly = [
    ["household_state", "select public.household_state($1)", [anna]],
    ["create_household", "select public.create_household($1, 'Famille')", [carla]],
    ["create_household_invite", "select public.create_household_invite($1, $2)", [anna, hid]],
    ["revoke_household_invites", "select public.revoke_household_invites($1, $2)", [anna, hid]],
    ["join_household", "select public.join_household($1, $2)", [carla, live.code]],
    ["update_household", "select public.update_household($1, $2, '{}')", [anna, hid]],
    ["remove_household_member", "select public.remove_household_member($1, $2, $3)", [anna, hid, ben]],
    ["delete_household", "select public.delete_household($1, $2)", [anna, hid]],
    ["household_return_expenses", "select public.household_return_expenses($1, $2)", [hid, ben]],
  ];
  for (const [name, sql, params] of serverOnly) {
    // Even with the owner's own id: the server alone checks who is asking.
    await refused(`a signed-in client can't call ${name}`, () => tryUser(anna, sql, params), /permission denied/);
    await refused(`a visitor can't call ${name}`, () => tryVisitor(sql, params), /permission denied/);
  }
  await refused("a visitor can't call is_household_member", () => tryVisitor("select public.is_household_member($1)", [hid]), /permission denied/);
  await check("the household survived the refused calls", async () => ((await count(ben, "select 1 from public.household_members")) === 2 ? null : "members changed"));

  // ---- A full household ----------------------------------------------------------------
  await check("a household takes 12 members, not 13", async () => {
    const people = Array.from({ length: 13 }, () => randomUUID());
    for (const id of people) await client.query("insert into auth.users (id, email, created_at) values ($1, $2, now())", [id, `${id}@example.com`]);
    const [{ big }] = await server("select public.create_household($1, 'Grande famille') as big", [people[0]]);
    const [{ code }] = await server("select public.create_household_invite($1, $2) as code", [people[0], big]);
    for (const id of people.slice(1, 12)) await server("select public.join_household($1, $2)", [id, code.code]);
    try {
      await server("select public.join_household($1, $2)", [people[12], code.code]);
      return "a 13th member joined";
    } catch (error) {
      return /household_full/.test(error.message) ? null : `refused for another reason (${error.message})`;
    } finally {
      await server("select public.delete_household($1, $2)", [people[0], big]);
    }
  });

  // ---- Reading ----------------------------------------------------------------------
  await user(anna, "insert into public.expenses (id, data, updated_at) values ('perso-1', '{\"amountMga\": 1000}', now())");
  await user(anna, "insert into public.household_expenses (household_id, id, data, updated_at) values ($1, 'shared-1', '{\"amountMga\": 2000}', now())", [hid]);

  await check("a non-member reads nothing of the household", async () => {
    const seen = [
      await count(carla, "select 1 from public.households"),
      await count(carla, "select 1 from public.household_members"),
      await count(carla, "select 1 from public.household_expenses"),
    ];
    return seen.some(Boolean) ? `saw ${seen.join("/")} rows` : null;
  });
  await check("a member reads the household, its members and shared expenses", async () => {
    const seen = [await count(ben, "select 1 from public.households"), await count(ben, "select 1 from public.household_members"), await count(ben, "select 1 from public.household_expenses")];
    return seen.join("/") === "1/2/1" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("a member never reads another member's personal expenses", async () => ((await count(ben, "select 1 from public.expenses")) ? "Anna's expenses visible" : null));
  await check("a member's state lists the members, without the code", async () => {
    const [{ state }] = await server("select public.household_state($1) as state", [ben]);
    if (state?.members?.length !== 2) return "members missing";
    return state.invite ? "a member sees the code" : null;
  });
  await check("the owner sees the live code in the state", async () => {
    const [{ invite: fresh }] = await server("select public.create_household_invite($1, $2) as invite", [anna, hid]);
    const [{ state }] = await server("select public.household_state($1) as state", [anna]);
    return state?.invite?.code === fresh.code ? null : "no code";
  });

  // ---- Writing ----------------------------------------------------------------------
  await user(ben, "insert into public.household_expenses (household_id, id, data, updated_at) values ($1, 'shared-2', '{\"amountMga\": 3000}', now())", [hid]);
  await check("a member can't change another member's shared expense", async () => {
    const changed = await user(ben, "update public.household_expenses set data = '{\"amountMga\": 1}' where id = 'shared-1' returning id");
    return changed.length ? "changed" : null;
  });
  await refused("a member can't upsert over another member's shared expense", () =>
    tryUser(ben, "insert into public.household_expenses (household_id, id, data, updated_at) values ($1, 'shared-1', '{}', now()) on conflict (household_id, id) do update set data = excluded.data", [hid]),
  );
  await refused("a member can't write in another's name", () => tryUser(ben, "insert into public.household_expenses (household_id, id, user_id, data, updated_at) values ($1, 'fake', $2, '{}', now())", [hid, anna]));
  await refused("a non-member can't write to the household", () => tryUser(carla, "insert into public.household_expenses (household_id, id, data, updated_at) values ($1, 'intruder', '{}', now())", [hid]));
  await refused("a non-member can't write in a member's name", () => tryUser(carla, "insert into public.household_expenses (household_id, id, user_id, data, updated_at) values ($1, 'intruder', $2, '{}', now())", [hid, ben]));
  await check("a non-member can't change a shared expense", async () => ((await user(carla, "update public.household_expenses set data = '{}' returning id")).length ? "changed" : null));
  await refused("a non-member can't upsert over a shared expense", () =>
    tryUser(carla, "insert into public.household_expenses (household_id, id, user_id, data, updated_at) values ($1, 'shared-1', $2, '{}', now()) on conflict (household_id, id) do update set data = excluded.data", [hid, carla]),
  );
  await check("a visitor reads and writes nothing", async () => {
    for (const sql of ["select 1 from public.households", "select 1 from public.household_members", "select 1 from public.household_expenses", "select 1 from public.expenses"]) {
      try {
        if ((await visitor(sql)).length) return `rows visible: ${sql}`;
      } catch (error) {
        if (!/permission denied/.test(error.message)) throw error;
      }
    }
    try {
      await visitor("insert into public.household_expenses (household_id, id, user_id, data, updated_at) values ($1, 'anon', $2, '{}', now())", [hid, ben]);
      return "a visitor wrote";
    } catch {
      return null;
    }
  });
  await check("the owner's expense is untouched by the others", async () => {
    const rows = (await client.query("select data, user_id from public.household_expenses where id = 'shared-1'")).rows;
    return rows[0]?.data?.amountMga === 2000 && rows[0]?.user_id === anna ? null : "changed";
  });
  await check("a member can't delete a row (tombstones only)", async () => ((await user(ben, "delete from public.household_expenses where id = 'shared-2' returning id")).length ? "deleted" : null));
  await check("a member can't rename the household", async () => ((await user(ben, "update public.households set data = '{}' returning id")).length ? "renamed" : null));
  await refused("a member can't rename it through the server either", () => server("select public.update_household($1, $2, '{}')", [ben, hid]), /not_owner/);
  await check("a member can't remove the owner", async () => ((await user(ben, "delete from public.household_members where user_id = $1 returning user_id", [anna])).length ? "removed" : null));
  await refused("a member can't remove another member through the server", () => server("select public.remove_household_member($1, $2, $3)", [ben, hid, anna]), /not_owner|not_member/);
  await check("the owner can't leave without deleting the household", async () => ((await user(anna, "delete from public.household_members where user_id = $1 returning user_id", [anna])).length ? "left" : null));

  // ---- Leaving ----------------------------------------------------------------------
  await server("select public.remove_household_member($1, $2, $1)", [ben, hid]);
  await check("a leaver's shared expenses are tombstoned", async () => {
    const rows = (await client.query("select deleted_at from public.household_expenses where id = 'shared-2'")).rows;
    return rows[0]?.deleted_at ? null : "still live";
  });
  await check("a leaver reads nothing anymore", async () => ((await count(ben, "select 1 from public.household_expenses")) ? "still visible" : null));
  await check("a leaver gets their shared expenses back as personal ones", async () => {
    const rows = await user(ben, "select data from public.expenses where id = 'shared-2' and deleted_at is null");
    return rows[0]?.data?.amountMga === 3000 && rows[0]?.data?.kind === "expense" ? null : "not given back";
  });

  // An account deleted while a member: its deletion isn't blocked.
  const [{ invite: again }] = await server("select public.create_household_invite($1, $2) as invite", [anna, hid]);
  await server("select public.join_household($1, $2)", [carla, again.code]);
  await user(carla, "insert into public.household_expenses (household_id, id, data, updated_at) values ($1, 'carla-1', '{}', now())", [hid]);
  await check("deleting a member's account still works", async () => {
    await client.query("delete from auth.users where id = $1", [carla]);
    return (await client.query("select 1 from public.household_members where user_id = $1", [carla])).rows.length ? "still a member" : null;
  });

  await check("the owner deletes the household, with everything in it", async () => {
    await server("select public.delete_household($1, $2)", [anna, hid]);
    const left = (await client.query("select (select count(*) from public.household_members)::int + (select count(*) from public.household_expenses)::int + (select count(*) from public.household_invites)::int as n")).rows[0].n;
    return left ? `${left} rows left` : null;
  });
  // ---- Loans (migration 0010_loans.sql): always personal --------------------------
  await user(anna, "insert into public.loans (id, data, updated_at) values ('loan-1', '{\"amountMga\": 50000}', now())");
  await check("each one reads only their own loans", async () => {
    const seen = [await count(anna, "select 1 from public.loans"), await count(ben, "select 1 from public.loans")];
    return seen.join("/") === "1/0" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("nobody changes someone else's loan", async () => ((await user(ben, "update public.loans set data = '{}' where id = 'loan-1' returning id")).length ? "changed" : null));
  await refused("nobody writes a loan in someone else's name", () => tryUser(ben, "insert into public.loans (user_id, id, data, updated_at) values ($1, 'loan-2', '{}', now())", [anna]), /row-level security/);
  await check("a visitor reads no loans", async () => {
    try {
      return (await tryVisitor("select 1 from public.loans")).length ? "loans visible" : null;
    } catch (error) {
      return /permission denied/.test(error.message) ? null : error.message;
    }
  });
  await check("the owner gets their shared expenses back too", async () => ((await count(anna, "select 1 from public.expenses where id = 'shared-1' and deleted_at is null")) ? null : "not given back"));
  return problems;
}
