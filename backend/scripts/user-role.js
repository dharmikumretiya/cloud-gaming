import { createDatabase } from '../src/database.js';

const [input, role, ...extra] = process.argv.slice(2);
if (!input || !['admin', 'player'].includes(role) || extra.length) {
  console.error('Usage: npm run user:role -- <username> <admin|player>');
  process.exitCode = 1;
} else {
  const db = createDatabase();
  try {
    const username = input.trim().toLowerCase();
    const user = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (!user) throw new Error('Account not found. Create the account on the website first.');
    await db.user.update({ where: { id: user.id }, data: { isAdmin: role === 'admin' } });
    console.log(`${username} is now a ${role}. Refresh the website to see the change.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await db.$disconnect(); }
}
