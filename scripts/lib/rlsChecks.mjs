// The Row Level Security of the shared budget (migration 0009_households.sql)
// of the loans (0010_loans.sql), of the features offered for a while (0011),
// of the loan links and household loans (0012), of the plants (0013), of the shop (0022), of the health measures (0024), of the home inventory (0014),
// with the plans created from the Admin a subscription may hold (0015), of the family seats (0016, 0019), of the photo quota (0020), of the lists and parcels shared with the household (0023),
// tested as Supabase runs it: each query as the "authenticated" role with a
// user id, or as the server ("service_role"). `client.query(text, params)`
// must return { rows }. Returns the problems found (empty: all good).
import { randomUUID } from "node:crypto";

export async function runRlsChecks(client) {
  const problems = [];
  // Every table of the public schema has row security: without it, the app's public key reads (and may write) it.
  const open = await client.query("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1");
  for (const { relname } of open.rows) problems.push(`${relname}: row level security is off (every table of the public schema needs it)`);
  const [anna, ben, carla] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, email, name] of [
    [anna, "anna.rabe@example.com", "Anna Rabe"],
    [ben, "ben@example.com", null],
    [carla, "carla@example.com", null],
  ]) {
    await client.query("insert into auth.users (id, email, created_at, raw_user_meta_data, email_confirmed_at) values ($1, $2, now(), $3, now())", [id, email, name ? { full_name: name } : {}]);
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
  // ---- Home inventory (migration 0014_home_items.sql): always personal -----------
  await user(anna, "insert into public.home_items (id, data, updated_at) values ('home-1', '{\"name\": \"Frigo\"}', now())");
  await check("each one reads only their own home items", async () => {
    const seen = [await count(anna, "select 1 from public.home_items"), await count(ben, "select 1 from public.home_items")];
    return seen.join("/") === "1/0" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("nobody changes someone else's home item", async () => ((await user(ben, "update public.home_items set data = '{}' where id = 'home-1' returning id")).length ? "changed" : null));
  await check("nobody deletes someone else's home item", async () => ((await user(ben, "delete from public.home_items where id = 'home-1' returning id")).length ? "deleted" : null));
  await refused("nobody writes a home item in someone else's name", () => tryUser(ben, "insert into public.home_items (user_id, id, data, updated_at) values ($1, 'home-2', '{}', now())", [anna]), /row-level security/);
  await check("a visitor reads no home items", async () => {
    try {
      return (await tryVisitor("select 1 from public.home_items")).length ? "home items visible" : null;
    } catch (error) {
      return /permission denied/.test(error.message) ? null : error.message;
    }
  });
  // ---- Plants (migration 0013_plants.sql): always personal -------------------------
  await user(anna, "insert into public.plants (id, data, updated_at) values ('plant-1', '{\"name\": \"Monstera\"}', now())");
  await check("each one reads only their own plants", async () => {
    const seen = [await count(anna, "select 1 from public.plants"), await count(ben, "select 1 from public.plants")];
    return seen.join("/") === "1/0" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("nobody changes someone else's plant", async () => ((await user(ben, "update public.plants set data = '{}' where id = 'plant-1' returning id")).length ? "changed" : null));
  await refused("nobody writes a plant in someone else's name", () => tryUser(ben, "insert into public.plants (user_id, id, data, updated_at) values ($1, 'plant-2', '{}', now())", [anna]), /row-level security/);
  await check("a visitor reads no plants", async () => {
    try {
      return (await tryVisitor("select 1 from public.plants")).length ? "plants visible" : null;
    } catch (error) {
      return /permission denied/.test(error.message) ? null : error.message;
    }
  });
  // ---- Shop (migration 0022_shop.sql): always personal ------------------------------
  await user(anna, "insert into public.shop (id, data, updated_at) values ('sale-1', '{\"kind\": \"sale\"}', now())");
  await check("each one reads only their own shop records", async () => {
    const seen = [await count(anna, "select 1 from public.shop"), await count(ben, "select 1 from public.shop")];
    return seen.join("/") === "1/0" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("nobody changes someone else's shop record", async () => ((await user(ben, "update public.shop set data = '{}' where id = 'sale-1' returning id")).length ? "changed" : null));
  await refused("nobody writes a shop record in someone else's name", () => tryUser(ben, "insert into public.shop (user_id, id, data, updated_at) values ($1, 'sale-2', '{}', now())", [anna]), /row-level security/);
  await check("a visitor reads no shop records", async () => {
    try {
      return (await tryVisitor("select 1 from public.shop")).length ? "shop visible" : null;
    } catch (error) {
      return /permission denied/.test(error.message) ? null : error.message;
    }
  });
  // ---- Health measures (migration 0024_mesures_sante.sql): always personal ---------
  await user(anna, "insert into public.health_measures (id, data, updated_at) values ('measure-1', '{\"kind\": \"weight\", \"weight\": 64.5}', now())");
  await check("each one reads only their own health measures", async () => {
    const seen = [await count(anna, "select 1 from public.health_measures"), await count(ben, "select 1 from public.health_measures")];
    return seen.join("/") === "1/0" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("nobody changes someone else's health measure", async () => ((await user(ben, "update public.health_measures set data = '{}' where id = 'measure-1' returning id")).length ? "changed" : null));
  await check("nobody removes someone else's health measure", async () => ((await user(ben, "delete from public.health_measures where id = 'measure-1' returning id")).length ? "removed" : null));
  await refused("nobody writes a health measure in someone else's name", () => tryUser(ben, "insert into public.health_measures (user_id, id, data, updated_at) values ($1, 'measure-2', '{}', now())", [anna]), /row-level security/);
  await refused("a health measure too big is refused", () => tryUser(anna, "insert into public.health_measures (id, data, updated_at) values ('measure-big', jsonb_build_object('note', repeat('x', 5000)), now())"), /health_measures_data_size/);
  await refused("a health measure id too long is refused", () => tryUser(anna, "insert into public.health_measures (id, data, updated_at) values (repeat('m', 65), '{}', now())"), /health_measures_id_length/);
  await check("a visitor reads no health measures", async () => {
    try {
      return (await tryVisitor("select 1 from public.health_measures")).length ? "health measures visible" : null;
    } catch (error) {
      return /permission denied/.test(error.message) ? null : error.message;
    }
  });
  // ---- Features offered for a while (migration 0011): the server's alone ---------
  await server("insert into public.feature_grants (email, feature, ends_at, created_by) values ('anna.rabe@example.com', 'garage', now() + interval '7 days', 'owner')");
  const hidden = async (label, run) =>
    check(label, async () => {
      try {
        return (await run()).length ? "rows visible" : null;
      } catch (error) {
        return /permission denied/.test(error.message) ? null : error.message;
      }
    });
  await hidden("a visitor reads no offered features", () => tryVisitor("select 1 from public.feature_grants"));
  await hidden("an account doesn't read its own offered features", () => tryUser(anna, "select 1 from public.feature_grants"));
  await refused("a visitor can't offer a feature", () => tryVisitor("insert into public.feature_grants (email, feature, ends_at) values ('x@example.com', 'garage', now() + interval '1 day')"), /row-level security|permission denied/);
  await refused("an account can't offer itself a feature", () => tryUser(ben, "insert into public.feature_grants (email, feature, ends_at) values ('ben@example.com', 'garage', now() + interval '1 day')"), /row-level security|permission denied/);
  await refused("an offer always ends after it starts", () => server("insert into public.feature_grants (email, feature, starts_at, ends_at) values ('x@example.com', 'garage', now(), now())"), /check constraint/);
  await check("the owner gets their shared expenses back too", async () => ((await count(anna, "select 1 from public.expenses where id = 'shared-1' and deleted_at is null")) ? null : "not given back"));
  // ---- Loan shares and household loans (migration 0012_loan_sharing.sql) ---------
  const hash = (sign) => sign.repeat(64);
  const shareSql = "insert into public.loan_shares (token_hash, user_id, person, snapshot) values ($1, $2, 'rakoto', '{\"v\": 1}')";
  await server(shareSql, [hash("c"), anna]);
  await hidden("a visitor reads no loan share", () => tryVisitor("select 1 from public.loan_shares"));
  await check("another account doesn't read someone's shares", async () => ((await count(ben, "select 1 from public.loan_shares")) ? "visible" : null));
  await check("the owner reads their own shares", async () => ((await count(anna, "select 1 from public.loan_shares")) === 1 ? null : "not visible"));
  await refused("an account can't write a share itself (the server checks the plan)", () => tryUser(anna, shareSql, [hash("d"), anna]), /permission denied|row-level security/);
  await refused("nobody writes a share in someone else's name", () => tryUser(ben, shareSql, [hash("e"), anna]), /permission denied|row-level security/);
  await refused("an account can't change a share's copy", () => tryUser(anna, "update public.loan_shares set snapshot = '{}'"), /permission denied/);
  await refused("a visitor can't write a share", () => tryVisitor(shareSql, [hash("f"), anna]), /permission denied|row-level security/);
  await check("another account can't stop someone's link", async () => ((await user(ben, "delete from public.loan_shares returning token_hash")).length ? "deleted" : null));
  await refused("one live link per person", () => server(shareSql, [hash("1"), anna]), /duplicate key|unique/);
  await refused("only a sha256 is stored, never the token", () => server(shareSql, [hash("z"), anna]), /check constraint/);

  const [{ home }] = await server("select public.create_household($1, 'Famille Rabe') as home", [anna]);
  const [{ invite: homeCode }] = await server("select public.create_household_invite($1, $2) as invite", [anna, home]);
  await server("select public.join_household($1, $2)", [ben, homeCode.code]);
  const dora = randomUUID();
  await client.query("insert into auth.users (id, email, created_at, email_confirmed_at) values ($1, 'dora@example.com', now(), now())", [dora]);
  const loanSql = "insert into public.household_loans (household_id, id, data, updated_at) values ($1, $2, $3, now())";
  const loanRow = (amountMga) => ({ kind: "loan", direction: "lent", person: "Voisin", amountMga, at: 1759900000000 });
  const repaymentRow = (loanId, amountMga, at) => ({ kind: "repayment", loanId, amountMga, at });
  await user(anna, loanSql, [home, "hloan-a", loanRow(60000)]);
  await user(ben, loanSql, [home, "hloan-b", loanRow(40000)]);
  // Each one writes a repayment on the other's loan: a row of their own.
  await user(ben, loanSql, [home, "hrep-b1", repaymentRow("hloan-a", 20000, 1760000000000)]);
  await user(anna, loanSql, [home, "hrep-a1", repaymentRow("hloan-b", 10000, 1760000000000)]);
  await check("the members read all the household's loans and repayments", async () => {
    const seen = [await count(anna, "select 1 from public.household_loans"), await count(ben, "select 1 from public.household_loans")];
    return seen.join("/") === "4/4" ? null : `saw ${seen.join("/")} rows`;
  });
  await check("a non-member doesn't read the household's loans", async () => ((await count(dora, "select 1 from public.household_loans")) ? "visible" : null));
  await hidden("a visitor reads no household loan", () => tryVisitor("select 1 from public.household_loans"));
  await check("a member can't change another's loan", async () => ((await user(ben, "update public.household_loans set data = '{}' where id = 'hloan-a' returning id")).length ? "changed" : null));
  await refused("a non-member can't write to the household's loans", () => tryUser(dora, loanSql, [home, "intruder", loanRow(1)]), /row-level security/);
  await refused("a member can't write a household loan in another's name", () =>
    tryUser(ben, "insert into public.household_loans (household_id, id, user_id, data, updated_at) values ($1, 'fake', $2, '{}', now())", [home, anna]), /row-level security/);
  await check("a member can't delete a household loan (tombstones only)", async () => ((await user(anna, "delete from public.household_loans where id = 'hloan-a' returning id")).length ? "deleted" : null));
  // Repayments: written by whoever got or paid back, and kept by their author (audit F5: nobody acts in another's name).
  await check("a member can't change another's repayment", async () => ((await user(anna, "update public.household_loans set data = '{}' where id = 'hrep-b1' returning id")).length ? "changed" : null));
  await check("a member can't remove another's repayment (a tombstone is a change)", async () => ((await user(anna, "update public.household_loans set deleted_at = now() where id = 'hrep-b1' returning id")).length ? "removed" : null));
  await refused("a member can't take over another's repayment by writing the same id", () => tryUser(anna, "insert into public.household_loans (household_id, id, data, updated_at) values ($1, 'hrep-b1', '{}', now()) on conflict (household_id, id) do update set data = excluded.data, user_id = excluded.user_id", [home]), /row-level security/);
  await refused("an author can't hand their repayment to another member", () => tryUser(ben, "update public.household_loans set user_id = $1 where id = 'hrep-b1'", [anna]), /row-level security/);
  await refused("a non-member can't note a repayment on the household's loan", () => tryUser(dora, loanSql, [home, "hrep-d0", repaymentRow("hloan-a", 1, 1760000000000)]), /row-level security/);
  await check("an author changes their own repayment", async () => ((await tryUser(ben, "update public.household_loans set updated_at = now() where id = 'hrep-b1' returning id")).length === 1 ? null : "refused"));
  // Migration 0021: the lender, or the author, removes a repayment through the function; nobody else.
  await user(ben, loanSql, [home, "hrep-b2", repaymentRow("hloan-a", 3000, 1760000000000)]);
  await user(ben, loanSql, [home, "hrep-b3", repaymentRow("hloan-a", 2000, 1760000000000)]);
  await user(anna, loanSql, [home, "hrep-a2", repaymentRow("hloan-a", 1000, 1760000000000)]);
  const removeRepayment = async (who, id) => (await user(who, "select public.household_remove_repayment($1) as ok", [id]))[0]?.ok;
  const tombstoned = async (id) => (await client.query("select deleted_at from public.household_loans where id = $1", [id])).rows[0]?.deleted_at !== null;
  await check("a non-member removes no repayment", async () => ((await removeRepayment(dora, "hrep-b2")) === false && !(await tombstoned("hrep-b2")) ? null : "removed"));
  await check("a member can't remove a repayment on another's loan written by a third (not the lender, not the author)", async () => ((await removeRepayment(ben, "hrep-a2")) === false && !(await tombstoned("hrep-a2")) ? null : "removed"));
  await check("the lender removes a repayment another member noted on their loan", async () => ((await removeRepayment(anna, "hrep-b2")) === true && (await tombstoned("hrep-b2")) ? null : "not removed"));
  await check("the author removes their own repayment", async () => ((await removeRepayment(ben, "hrep-b3")) === true && (await tombstoned("hrep-b3")) ? null : "not removed"));
  await check("removing leaves the row as it was (a tombstone only)", async () => {
    const { rows } = await client.query("select user_id, data from public.household_loans where id = 'hrep-b2'");
    return rows[0]?.user_id === ben && rows[0].data.amountMga === 3000 ? null : "row changed";
  });
  await check("a repayment already removed answers false", async () => ((await removeRepayment(anna, "hrep-b2")) === false ? null : "true again"));
  await check("a loan is not a repayment: the function leaves it", async () => ((await removeRepayment(anna, "hloan-a")) === false ? null : "removed a loan"));
  await check("the author removes their own repayment on their own loan", async () => ((await removeRepayment(anna, "hrep-a2")) === true ? null : "not removed"));
  await refused("a visitor can't call household_remove_repayment", () => tryVisitor("select public.household_remove_repayment('hrep-b1')"), /permission denied/);
  await refused("a signed-in client can't call household_return_loans", () => tryUser(anna, "select public.household_return_loans($1, $2)", [home, ben]), /permission denied/);

  // Ben leaves: his loan comes back to him with the repayment Anna wrote on it; his repayment on Anna's loan stays.
  await server("select public.remove_household_member($1, $2, $1)", [ben, home]);
  await check("a leaver gets their household loans back as personal ones, with every repayment", async () => {
    const data = (await user(ben, "select data from public.loans where id = 'hloan-b' and deleted_at is null"))[0]?.data;
    const ok = data?.amountMga === 40000 && data.kind === undefined && data.repayments?.length === 1 && data.repayments[0].id === "hrep-a1" && data.repayments[0].amountMga === 10000;
    return ok ? null : `got ${JSON.stringify(data)}`;
  });
  await check("a leaver's loans and the repayments on them leave the household", async () => {
    const live = (await client.query("select id from public.household_loans where household_id = $1 and deleted_at is null order by id", [home])).rows.map((row) => row.id).join(",");
    return live === "hloan-a,hrep-b1" ? null : `live: ${live}`;
  });
  // Dora joins, notes a repayment on Anna's loan and lends herself, then deletes her account:
  // her repayment stays (the family's money), read only; her own loan leaves the household.
  const [{ invite: doraCode }] = await server("select public.create_household_invite($1, $2) as invite", [anna, home]);
  await server("select public.join_household($1, $2)", [dora, doraCode.code]);
  await user(dora, loanSql, [home, "hrep-d1", { ...repaymentRow("hloan-a", 5000, 1760100000000), authorName: "Dora" }]);
  await user(dora, loanSql, [home, "hloan-d", loanRow(7000)]);
  await server(shareSql, [hash("9"), dora]);
  await client.query("delete from auth.users where id = $1", [dora]);
  await check("a deleted account's repayment on another's loan stays, with its author's name", async () => {
    const rows = (await client.query("select user_id, data, deleted_at from public.household_loans where id = 'hrep-d1'")).rows;
    return rows[0] && rows[0].user_id === null && rows[0].deleted_at === null && rows[0].data.authorName === "Dora" ? null : `got ${JSON.stringify(rows[0])}`;
  });
  await check("a deleted account's own household loan leaves the household", async () => {
    const rows = (await client.query("select deleted_at from public.household_loans where id = 'hloan-d'")).rows;
    return rows[0]?.deleted_at ? null : "still live";
  });
  await check("nobody changes a row whose author is gone", async () => {
    for (const who of [anna, ben]) if ((await user(who, "update public.household_loans set data = '{}' where id = 'hrep-d1' returning id")).length) return "changed";
    return null;
  });
  await check("the members still read it", async () => ((await count(anna, "select 1 from public.household_loans where id = 'hrep-d1'")) === 1 ? null : "not visible"));
  await refused("nobody writes a row without an author", () =>
    tryUser(anna, "insert into public.household_loans (household_id, id, user_id, data, updated_at) values ($1, 'nobody', null, '{}', now())", [home]), /row-level security/);
  await check("deleting an account deletes its links", async () => ((await client.query("select 1 from public.loan_shares where user_id = $1", [dora])).rows.length ? "still there" : null));

  await server("select public.delete_household($1, $2)", [anna, home]);
  await check("deleting the household gives each one their loans back, every repayment kept", async () => {
    const data = (await user(anna, "select data from public.loans where id = 'hloan-a' and deleted_at is null"))[0]?.data;
    const amounts = (data?.repayments ?? []).map((item) => item.amountMga).join(",");
    return data?.amountMga === 60000 && amounts === "20000,5000" ? null : `got ${JSON.stringify(data)}`;
  });

  // ---- Plans created from the Admin (migration 0015_offres_creees.sql) ---------
  await check("a subscription holds a created plan by its short id", async () => {
    try {
      await server("insert into public.subscriptions (email, plan) values ('famille@example.com', 'famille')");
      return null;
    } catch (error) {
      return error.message;
    }
  });
  await refused("a subscription's plan is a short lowercase id", () => server("insert into public.subscriptions (email, plan) values ('x@example.com', 'Famille !')"), /check constraint/);
  await hidden("an account doesn't read the subscriptions", () => tryUser(anna, "select 1 from public.subscriptions"));
  // ---- Family seats (migration 0016): read by the subscriber and the person, written by the server ----
  const seatSql = "insert into public.family_seats (owner_id, owner_email, member_email) values ($1, 'anna.rabe@example.com', $2)";
  await server(seatSql, [anna, "ben@example.com"]);
  /** As a signed-in account whose session carries its e-mail (auth.jwt()). */
  const withEmail = (who, email, sql) =>
    as("authenticated", who, async () => {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, email, role: "authenticated" })]);
      return (await client.query(sql)).rows;
    }, { keep: false });
  await check("the subscriber reads their seats", async () => ((await count(anna, "select 1 from public.family_seats")) === 1 ? null : "not visible"));
  await check("the invited person reads their own seat", async () => ((await withEmail(ben, "ben@example.com", "select 1 from public.family_seats")).length === 1 ? null : "not visible"));
  await check("another account reads no seat", async () => ((await withEmail(carla, "carla@example.com", "select 1 from public.family_seats")).length ? "visible" : null));
  // Migration 0019: the e-mail of the session must be confirmed, and an invitation waits for its answer.
  const eve = randomUUID();
  await client.query("insert into auth.users (id, email, created_at) values ($1, 'eve@example.com', now())", [eve]);
  await server(seatSql, [anna, "eve@example.com"]);
  await check("an unconfirmed e-mail reads no seat, even its own", async () => ((await withEmail(eve, "eve@example.com", "select 1 from public.family_seats")).length ? "visible" : null));
  await check("email_confirmed() is true for a confirmed e-mail and false for another", async () => {
    const [yes] = await withEmail(ben, "ben@example.com", "select public.email_confirmed() as ok");
    const [no] = await withEmail(eve, "eve@example.com", "select public.email_confirmed() as ok");
    return yes?.ok === true && no?.ok === false ? null : `got ${yes?.ok}/${no?.ok}`;
  });
  await refused("a visitor can't call email_confirmed()", () => tryVisitor("select public.email_confirmed()"), /permission denied/);
  await check("a new seat is an invitation: not accepted yet", async () => {
    const rows = (await client.query("select accepted_at from public.family_seats where member_email = 'ben@example.com'")).rows;
    return rows.length === 1 && rows[0].accepted_at === null ? null : "accepted at once";
  });
  await refused("the invited person can't accept by themselves", () => tryUser(ben, "update public.family_seats set accepted_at = now() where member_email = 'ben@example.com'"), /permission denied/);
  await refused("the subscriber can't accept for the person", () => tryUser(anna, "update public.family_seats set accepted_at = now()"), /permission denied/);
  await server("update public.family_seats set accepted_at = now() where member_email = 'ben@example.com'");
  await server("delete from public.family_seats where member_email = 'eve@example.com'");
  await hidden("a visitor reads no seat", () => tryVisitor("select 1 from public.family_seats"));
  await refused("an account can't give itself a seat", () => tryUser(carla, seatSql, [anna, "carla@example.com"]), /permission denied|row-level security/);
  await refused("the subscriber can't write a seat directly (the server checks the plan)", () => tryUser(anna, seatSql, [anna, "dora@example.com"]), /permission denied|row-level security/);
  await check("the subscriber can't delete a seat directly", async () => {
    try {
      return (await tryUser(anna, "delete from public.family_seats returning id")).length ? "deleted" : null;
    } catch (error) {
      return /permission denied/.test(error.message) ? null : error.message;
    }
  });
  await refused("one seat per person", () => server(seatSql, [anna, "ben@example.com"]), /duplicate key|unique/);
  await refused("no seat for oneself", () => server(seatSql, [anna, "anna.rabe@example.com"]), /check constraint/);
  // ---- Photo storage (migration 0020): a limit per account, kept by the database ----
  const photoSql = "insert into storage.objects (bucket_id, name, metadata) values ('scans', $1, $2)";
  const limit = Number((await client.query("select public.photo_quota_bytes() as bytes")).rows[0].bytes);
  await check("the quota is set (a few hundred MB)", () => (limit >= 50_000_000 && limit <= 5_000_000_000 ? null : `got ${limit}`));
  await check("the bucket keeps a size limit for one file", async () => {
    const { rows } = await client.query("select file_size_limit from storage.buckets where id = 'scans'");
    return Number(rows[0]?.file_size_limit) > 0 && Number(rows[0].file_size_limit) <= 5_242_880 ? null : `got ${rows[0]?.file_size_limit}`;
  });
  await check("an account under its quota adds a photo", async () => ((await tryUser(anna, photoSql + " returning id", [`${anna}/s1/preview.jpg`, { size: 150000 }])).length === 1 ? null : "refused"));
  await server(photoSql, [`${anna}/s1/preview.jpg`, { size: limit }]);
  await refused("an account at its quota can't add a photo", () => tryUser(anna, photoSql, [`${anna}/s2/preview.jpg`, { size: 150000 }]), /row-level security/);
  await check("an account at its quota can still write over a photo it has (shrinking frees space)", async () => ((await tryUser(anna, photoSql + " returning id", [`${anna}/s1/preview.jpg`, { size: 20000 }])).length === 1 ? null : "refused"));
  // Writing over a file changes its size: empty files grown one by one would get round a check on adding only.
  const growSql = "update storage.objects set metadata = $1 where bucket_id = 'scans' and name = $2 returning id";
  await server(photoSql, [`${anna}/e1/preview.jpg`, { size: 0 }]);
  await refused("an account at its quota can't grow a file by writing over it", () => tryUser(anna, growSql, [{ size: 2097152 }, `${anna}/e1/preview.jpg`]), /row-level security/);
  await check("a file may shrink or stay the same size at the quota", async () => ((await tryUser(anna, growSql, [{ size: 0 }, `${anna}/e1/preview.jpg`])).length === 1 ? null : "refused"));
  await check("an account adds an empty file", async () => ((await tryUser(ben, "insert into storage.objects (bucket_id, name, metadata) values ('scans', $1, $2) returning id", [`${ben}/g1/preview.jpg`, { size: 0 }])).length === 1 ? null : "refused"));
  await server(photoSql, [`${ben}/g1/preview.jpg`, { size: 0 }]);
  await check("a file grows within the quota, up to it", async () => ((await tryUser(ben, growSql, [{ size: 2097152 }, `${ben}/g1/preview.jpg`])).length === 1 ? null : "refused"));
  await refused("a file can't grow past the quota by itself", () => tryUser(ben, growSql, [{ size: limit + 1 }, `${ben}/g1/preview.jpg`]), /row-level security/);
  await check("another account has its own quota", async () => ((await tryUser(ben, photoSql + " returning id", [`${ben}/s1/preview.jpg`, { size: 150000 }])).length === 1 ? null : "refused"));
  await refused("a photo goes in one's own folder only", () => tryUser(ben, photoSql, [`${anna}/s3/preview.jpg`, { size: 1 }]), /row-level security/);
  await refused("a visitor can't call photo_quota_ok()", () => tryVisitor("select public.photo_quota_ok('x/y.jpg')"), /permission denied/);

  // ---- Lists and parcels shared with the household (migration 0023_partage_foyer.sql) ---------
  const [erin, finn, gaby] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, email] of [
    [erin, "erin@example.com"],
    [finn, "finn@example.com"],
    [gaby, "gaby@example.com"],
  ]) {
    await client.query("insert into auth.users (id, email, created_at, email_confirmed_at) values ($1, $2, now(), now())", [id, email]);
  }
  const [{ family }] = await server("select public.create_household($1, 'Famille Erin') as family", [erin]);
  const [{ invite: familyCode }] = await server("select public.create_household_invite($1, $2) as invite", [erin, family]);
  await server("select public.join_household($1, $2)", [finn, familyCode.code]);
  const shareSqlOf = "insert into public.household_shares (household_id, id, kind, data, updated_at) values ($1, $2, $3, $4, now())";
  const sharedList = (id, done) => ({ id, title: "Courses", kind: "shopping", items: [{ id: "i1", text: "Riz", done }], createdAt: 1, updatedAt: 1 });
  await user(erin, shareSqlOf, [family, "list:l1", "list", sharedList("list:l1", false)]);
  await user(erin, shareSqlOf, [family, "parcel:p1", "parcel", { id: "parcel:p1", sourceId: "p1", title: "Robe" }]);
  await check("a member reads the household's shared lists and parcels", async () => ((await count(finn, "select 1 from public.household_shares")) === 2 ? null : "not visible"));
  await check("a non-member reads no shared list nor parcel", async () => ((await count(gaby, "select 1 from public.household_shares")) ? "visible" : null));
  await hidden("a visitor reads no shared list", () => tryVisitor("select 1 from public.household_shares"));
  await refused("a non-member can't share into the household", () => tryUser(gaby, shareSqlOf, [family, "list:intruder", "list", sharedList("list:intruder", false)]), /row-level security/);
  await check("a non-member can't tick a shared list", async () => ((await user(gaby, "update public.household_shares set data = '{}' where id = 'list:l1' returning id")).length ? "changed" : null));
  await refused("a member can't share in another's name", () =>
    tryUser(finn, "insert into public.household_shares (household_id, id, kind, user_id, data, updated_at) values ($1, 'list:fake', 'list', $2, '{}', now())", [family, erin]), /row-level security/);
  await refused("a share's id says its kind", () => tryUser(erin, shareSqlOf, [family, "parcel:x", "list", {}]), /check constraint/);
  await check("a member ticks an item on another's shared list", async () =>
    (await user(finn, "update public.household_shares set data = $1, updated_at = now() where id = 'list:l1' returning id", [sharedList("list:l1", true)])).length === 1 ? null : "refused");
  await check("ticking leaves the list its author's", async () => {
    const rows = (await client.query("select user_id, kind, data from public.household_shares where id = 'list:l1'")).rows;
    return rows[0]?.user_id === erin && rows[0].kind === "list" && rows[0].data.items[0].done === true ? null : `got ${JSON.stringify(rows[0])}`;
  });
  await check("a member can't take a list over (the author stays)", async () => {
    await user(finn, "update public.household_shares set user_id = $1 where id = 'list:l1'", [finn]);
    const rows = (await client.query("select user_id from public.household_shares where id = 'list:l1'")).rows;
    return rows[0]?.user_id === erin ? null : "taken over";
  });
  await check("a member can't stop another's sharing (the tombstone is ignored)", async () => {
    await user(finn, "update public.household_shares set deleted_at = now() where id = 'list:l1'");
    const rows = (await client.query("select deleted_at from public.household_shares where id = 'list:l1'")).rows;
    return rows[0]?.deleted_at === null ? null : "stopped";
  });
  await check("a member can't change another's shared parcel (read only)", async () => ((await user(finn, "update public.household_shares set data = '{}' where id = 'parcel:p1' returning id")).length ? "changed" : null));
  await check("nobody deletes a share (tombstones only)", async () => ((await user(erin, "delete from public.household_shares where id = 'parcel:p1' returning id")).length ? "deleted" : null));
  await check("the author stops sharing their parcel", async () => {
    await user(erin, "update public.household_shares set deleted_at = now(), updated_at = now() where id = 'parcel:p1'");
    const rows = (await client.query("select deleted_at from public.household_shares where id = 'parcel:p1'")).rows;
    return rows[0]?.deleted_at ? null : "still shared";
  });
  for (const name of ["household_return_shares", "household_member_left_shares", "household_closing_shares", "household_shares_guard", "household_shares_author_gone"]) {
    const args = name === "household_return_shares" ? "($1, $2)" : "()";
    const params = name === "household_return_shares" ? [family, finn] : [];
    await refused(`a signed-in client can't call ${name}`, () => tryUser(erin, `select public.${name}${args}`, params), /permission denied|trigger functions can only be called as triggers/);
  }

  // Finn shares a list, then leaves: it comes back to him as a personal list, and leaves the household.
  await user(finn, shareSqlOf, [family, "list:f1", "list", { ...sharedList("list:f1", false), householdId: family, userId: finn }]);
  await server("select public.remove_household_member($1, $2, $1)", [finn, family]);
  await check("a leaver gets their shared lists back as personal ones (same id, no household)", async () => {
    const data = (await user(finn, "select data from public.lists where id = 'f1' and deleted_at is null"))[0]?.data;
    return data?.id === "f1" && data.title === "Courses" && data.householdId === undefined && data.userId === undefined ? null : `got ${JSON.stringify(data)}`;
  });
  await check("a leaver's shares leave the household", async () => ((await client.query("select deleted_at from public.household_shares where id = 'list:f1'")).rows[0]?.deleted_at ? null : "still live"));
  await check("a leaver reads the household's lists no more", async () => ((await count(finn, "select 1 from public.household_shares")) ? "visible" : null));

  // What the app really sends (services/rowSync.ts): an upsert with its own user_id.
  const upsertSql =
    "insert into public.household_shares (household_id, kind, user_id, id, data, updated_at, deleted_at) values ($1, $2, $3, $4, $5, now(), $6) on conflict (household_id, id) do update set user_id = excluded.user_id, data = excluded.data, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at";
  const [{ invite: gabyCode }] = await server("select public.create_household_invite($1, $2) as invite", [erin, family]);
  await server("select public.join_household($1, $2)", [gaby, gabyCode.code]);
  await user(erin, shareSqlOf, [family, "list:l2", "list", sharedList("list:l2", false)]);
  await user(erin, shareSqlOf, [family, "parcel:p2", "parcel", { id: "parcel:p2", sourceId: "p2", title: "Sac" }]);
  await check("the app's upsert ticks another's list, the author stays", async () => {
    await user(gaby, upsertSql, [family, "list", gaby, "list:l2", sharedList("list:l2", true), null]);
    const rows = (await client.query("select user_id, data, deleted_at from public.household_shares where id = 'list:l2'")).rows;
    return rows[0]?.user_id === erin && rows[0].data.items[0].done === true && rows[0].deleted_at === null ? null : `got ${JSON.stringify(rows[0])}`;
  });
  await check("the app's upsert of another's list with a tombstone stops nothing", async () => {
    await user(gaby, upsertSql, [family, "list", gaby, "list:l2", sharedList("list:l2", true), new Date().toISOString()]);
    return (await client.query("select deleted_at from public.household_shares where id = 'list:l2'")).rows[0]?.deleted_at === null ? null : "stopped";
  });
  await refused("the app's upsert can't change another's parcel", () => tryUser(gaby, upsertSql, [family, "parcel", gaby, "parcel:p2", { id: "parcel:p2", title: "Changé" }, null]), /row-level security/);
  await refused("a share's data is kept small", () => tryUser(gaby, shareSqlOf, [family, "list:big", "list", { id: "list:big", text: "x".repeat(210000) }]), /check constraint/);

  // The owner removes Gaby straight under the RLS of 0009 (not through the server): her shares leave too.
  await user(gaby, shareSqlOf, [family, "parcel:g2", "parcel", { id: "parcel:g2", sourceId: "g2", title: "Montre" }]);
  await check("the owner removes a member", async () => ((await user(erin, "delete from public.household_members where user_id = $1 returning user_id", [gaby])).length === 1 ? null : "not removed"));
  await check("a member removed by the owner: her shares leave the household", async () => ((await client.query("select deleted_at from public.household_shares where id = 'parcel:g2'")).rows[0]?.deleted_at ? null : "still shared"));

  // An account deleted: its shares leave the household, read only, without an author.
  const hugo = randomUUID();
  await client.query("insert into auth.users (id, email, created_at, email_confirmed_at) values ($1, 'hugo@example.com', now(), now())", [hugo]);
  const [{ invite: hugoCode }] = await server("select public.create_household_invite($1, $2) as invite", [erin, family]);
  await server("select public.join_household($1, $2)", [hugo, hugoCode.code]);
  await user(hugo, shareSqlOf, [family, "list:h1", "list", sharedList("list:h1", false)]);
  await user(hugo, shareSqlOf, [family, "parcel:h2", "parcel", { id: "parcel:h2", sourceId: "h2", title: "Casque" }]);
  await client.query("delete from auth.users where id = $1", [hugo]);
  await check("a deleted account's shares leave the household, without an author", async () => {
    const rows = (await client.query("select id, user_id, deleted_at from public.household_shares where id in ('list:h1', 'parcel:h2') order by id")).rows;
    return rows.length === 2 && rows.every((row) => row.user_id === null && row.deleted_at) ? null : `got ${JSON.stringify(rows)}`;
  });
  await check("a member's last tick on a list whose author is gone is taken, the list stays stopped", async () => {
    await user(erin, upsertSql, [family, "list", erin, "list:h1", sharedList("list:h1", true), null]);
    const rows = (await client.query("select user_id, deleted_at from public.household_shares where id = 'list:h1'")).rows;
    return rows[0]?.user_id === null && rows[0].deleted_at ? null : `got ${JSON.stringify(rows[0])}`;
  });
  await check("nobody changes a parcel whose author is gone", async () => ((await user(erin, "update public.household_shares set data = '{}' where id = 'parcel:h2' returning id")).length ? "changed" : null));

  // The household deleted: every member's lists come back.
  const [{ invite: gabyAgain }] = await server("select public.create_household_invite($1, $2) as invite", [erin, family]);
  await server("select public.join_household($1, $2)", [gaby, gabyAgain.code]);
  await user(gaby, shareSqlOf, [family, "list:g1", "list", sharedList("list:g1", false)]);
  await server("select public.delete_household($1, $2)", [erin, family]);
  await check("deleting the household gives each member their shared lists back", async () => ((await count(gaby, "select 1 from public.lists where id = 'g1' and deleted_at is null")) === 1 ? null : "not back"));

  return problems;
}
