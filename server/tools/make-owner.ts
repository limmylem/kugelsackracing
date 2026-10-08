// Makes the owner's account on this computer: an admin, with every control on the admin and editor pages — no email
// to confirm, nothing to wait for. An account with that email already: made the owner. None: made (the name and
// password given), then made the owner. Logged in the admins' log as the owner, like ADMIN_EMAIL's.
//
//   npm run owner -w @kr/server -- --email you@example.com --password 'at least 10 characters' --name YourName
//   docker compose exec server node server/tools/make-owner.ts --email you@example.com --password '…' --name YourName
//
// It needs the server's settings (server/.env, or Docker Compose's): DATABASE_URL and BETTER_AUTH_SECRET.
// Only ever run by someone with the database in their hands; it refuses staging and production (there, the owner is
// ADMIN_EMAIL, confirmed by email).

import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { createAuth } from '../src/auth.ts';
import { makeOwner } from '../src/owner.ts';
import { sql } from 'drizzle-orm';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? null : null; };
const email = arg('email')?.trim().toLowerCase() ?? '', password = arg('password'), name = arg('name')?.trim() ?? null;
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { console.error('Usage: make-owner.ts --email you@example.com [--password \'…\' --name YourName] (the password and name only to make a new account)'); process.exit(2); }

const config = loadConfig();
if (config.env === 'staging' || config.env === 'production') { console.error('Not here: online, the owner is ADMIN_EMAIL (its email confirmed). This is for the game on your own computer.'); process.exit(2); }
const { db, pool } = openDb(config.databaseUrl, { max: 2 });
try {
  const had = (await db.execute(sql`select id from users where lower(email) = ${email} and not coalesce(is_anonymous, false)`)).rows.length > 0;
  if (!had) {
    if (!password || password.length < 10 || !name) { console.error('There\'s no account with that email yet: give --password (at least 10 characters) and --name (3–20 letters, digits, spaces, - or _) to make it.'); process.exit(2); }
    const auth = createAuth({ config: { ...config, requireEmailVerification: false }, db, mailer: { async send() {} }, onGuestLinked: async () => {}, onUserDeleted: async () => {} });
    // (the same sign-up as the account page's: the name checked, the terms accepted; an adult's birth date — only
    // whether it passes the age check is kept, never the date)
    await auth.api.signUpEmail({ body: { email, password, name, acceptTerms: config.termsVersion, birthDate: '1990-01-01' } as any });
  }
  const owner = await makeOwner(db, email, config.termsVersion);
  if (!owner) { console.error('Couldn\'t make that account the owner.'); process.exit(1); }
  console.log(`${owner.name} (${email}) is the owner: an admin, with every control. ${had ? 'Sign in as usual.' : 'Sign in with that email and password.'} The admin page is /admin/.`);
} finally { await pool.end(); }
