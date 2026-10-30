'use strict';
const mysql = require('mysql2/promise');
const { Auth } = require('./auth');
const { DirectMySQLAuth } = require('./mysql-auth-direct');

const { ensureMySQL, TABLES } = require('./auth-backend-shared');
const DELETE_ORDER = [...TABLES].reverse();
const mysqlOptions = config => ({ host: config.host, port: Number(config.port)||3306, user: config.username, password: config.password, database: config.database, waitForConnections: true, connectionLimit: 4, queueLimit: 0, charset: 'utf8mb4' });
function sqliteRows(db, table, columns) { return db.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${table}"`).all(); }
async function writeMySQLFromSQLite(db, config, { preserveAutomationSessions = false } = {}) {
  return writeMySQLRows(new Map(TABLES.map(([table, columns]) => [table, sqliteRows(db, table, columns)])), config, { preserveAutomationSessions });
}
async function writeMySQLRows(rowsByTable, config, { preserveAutomationSessions = false } = {}) {
  const connection = await mysql.createConnection(mysqlOptions(config));
  try {
    await ensureMySQL(connection); await connection.beginTransaction();
    // Workflow applications write these tables directly. When explicitly
    // migrating a SQLite snapshot, preserve their live session rows.
    const tables = preserveAutomationSessions ? TABLES.filter(([table]) => !['automation_sessions', 'automation_login_limits'].includes(table)) : TABLES;
    const tableNames = new Set(tables.map(([table]) => table));
    for (const [table] of DELETE_ORDER) if (tableNames.has(table)) await connection.query(`DELETE FROM \`${table}\``);
    for (const [table, columns] of tables) {
      const rows = rowsByTable.get(table) || []; if (!rows.length) continue;
      const placeholders = rows.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',');
      await connection.query(`INSERT INTO \`${table}\` (${columns.map(column=>`\`${column}\``).join(',')}) VALUES ${placeholders}`, rows.flatMap(row=>columns.map(column=>row[column])));
    }
    await connection.commit();
  } catch (error) { try { await connection.rollback(); } catch {} throw error; }
  finally { await connection.end(); }
}
function replaceSQLiteRows(target, rowsByTable) {
  target.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
  try {
    for (const [table] of DELETE_ORDER) target.prepare(`DELETE FROM "${table}"`).run();
    for (const [table, columns] of TABLES) for (const row of rowsByTable.get(table)||[]) target.prepare(`INSERT INTO "${table}" (${columns.map(c=>`"${c}"`).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(column=>row[column]));
    target.exec('COMMIT; PRAGMA foreign_keys=ON');
  } catch (error) { target.exec('ROLLBACK; PRAGMA foreign_keys=ON'); throw error; }
}
async function readMySQLIntoSQLite(config, target) {
  const connection = await mysql.createConnection(mysqlOptions(config));
  try {
    await ensureMySQL(connection); const rows = new Map();
    for (const [table] of TABLES) rows.set(table, (await connection.query(`SELECT * FROM \`${table}\``))[0]);
    replaceSQLiteRows(target, rows);
  } finally { await connection.end(); }
}
function copySQLite(source, target) { replaceSQLiteRows(target, new Map(TABLES.map(([table,columns])=>[table,sqliteRows(source,table,columns)]))); }
async function openAuth(config,{secureCookies=false,keyFile=null}={}) { if((config.provider||'sqlite')==='mysql')return DirectMySQLAuth.open(config.mysql,{secureCookies,keyFile});return new Auth(config.database,{secureCookies,keyFile}); }
async function migrateAuth(auth, target, sqliteFile) {
  await auth.flush?.();
  if(target.provider==='mysql'){
    if (auth.exportRows) await writeMySQLRows(await auth.exportRows(), target.mysql);
    else await writeMySQLFromSQLite(auth.rawDB||auth.db,target.mysql);
    return;
  }
  const destination=new Auth(sqliteFile,{secureCookies:target.secureCookies});
  try {
    if (auth.exportRows) {
      const rows = await auth.exportRows();
      replaceSQLiteRows(destination.db, rows);
    } else copySQLite(auth.rawDB||auth.db,destination.db);
  } finally { destination.close(); }
}
module.exports={TABLES,MySQLAuth:DirectMySQLAuth,openAuth,migrateAuth,writeMySQLFromSQLite,readMySQLIntoSQLite,copySQLite};
