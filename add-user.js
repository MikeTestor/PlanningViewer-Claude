/**
 * User management script for Planning Viewer
 *
 * Usage:
 *   node add-user.js              — add or update a user
 *   node add-user.js --list       — list all users
 *   node add-user.js --delete     — delete a user
 */

const bcrypt   = require('bcryptjs');
const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function askPassword(rl, question) {
  // Node readline doesn't support hidden input natively, so we just prompt clearly
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  const args  = process.argv.slice(2);
  const users = loadUsers();

  if (args.includes('--list')) {
    if (users.length === 0) {
      console.log('No users found.');
    } else {
      console.log('\nRegistered users:');
      users.forEach(u => console.log(`  • ${u.username}`));
      console.log('');
    }
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  if (args.includes('--delete')) {
    if (users.length === 0) { console.log('No users to delete.'); rl.close(); return; }
    console.log('\nRegistered users:');
    users.forEach((u, i) => console.log(`  ${i + 1}. ${u.username}`));
    const answer = await ask(rl, '\nEnter username to delete: ');
    const idx = users.findIndex(u => u.username === answer.trim());
    if (idx === -1) {
      console.log(`User "${answer.trim()}" not found.`);
    } else {
      users.splice(idx, 1);
      saveUsers(users);
      console.log(`User "${answer.trim()}" deleted.`);
    }
    rl.close();
    return;
  }

  // Add / update user
  console.log('\n— Add or update a user —\n');
  const username = (await ask(rl, 'Username: ')).trim();
  if (!username) { console.log('Username cannot be empty.'); rl.close(); return; }

  const password = (await askPassword(rl, 'Password: ')).trim();
  if (!password) { console.log('Password cannot be empty.'); rl.close(); return; }

  const confirm = (await askPassword(rl, 'Confirm password: ')).trim();
  if (password !== confirm) { console.log('Passwords do not match.'); rl.close(); return; }

  const hash    = bcrypt.hashSync(password, 10);
  const existing = users.findIndex(u => u.username === username);

  if (existing !== -1) {
    users[existing].password = hash;
    console.log(`\nPassword updated for "${username}".`);
  } else {
    users.push({ username, password: hash });
    console.log(`\nUser "${username}" added.`);
  }

  saveUsers(users);
  rl.close();
}

main().catch(err => { console.error(err); process.exit(1); });
