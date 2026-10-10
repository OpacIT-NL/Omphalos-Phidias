'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const { Auth } = require('./auth');

const TABLES = [
  ['users',['id','username','password_hash','created_at']],
  ['sessions',['token_hash','user_id','csrf_token','expires_at']],
  ['login_limits',['key','attempts','expires_at']],
  ['automation_sessions',['token_hash','user_id','kind','expires_at']],
  ['automation_login_limits',['key','attempts','expires_at']],
  ['acl_groups',['id','name','system','created_at']],
  ['acl_group_members',['group_id','user_id']],
  ['acl_core_grants',['principal_type','principal_id','permission']],
  ['acl_project_grants',['project_id','principal_type','principal_id','permission']],
  ['acl_meta',['key','value']],
  ['database_credentials',['id','name','host','port','username','password','database_name','created_at','updated_at']],
  ['credentials',['id','type','name','host','port','domain','username','password','private_key','database_name','permissions','extra_json','created_at','updated_at']],
  ['vault_meta',['key','value']],
  ['application_keys',['project_id','key_hash','encrypted_key','created_at']]
];
const DELETE_ORDER = [...TABLES].reverse();
const mysqlOptions = config => ({ host: config.host, port: Number(config.port)||3306, user: config.username, password: config.password, database: config.database, waitForConnections: true, connectionLimit: 4, queueLimit: 0, charset: 'utf8mb4' });
async function ensureMySQL(connection) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY,username VARCHAR(64) NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT NOT NULL,csrf_token VARCHAR(255) NOT NULL,expires_at BIGINT NOT NULL,INDEX(expires_at)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS login_limits (\`key\` VARCHAR(255) PRIMARY KEY,attempts INT NOT NULL,expires_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS automation_sessions (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT NOT NULL,kind VARCHAR(16) NOT NULL,expires_at BIGINT NOT NULL,INDEX(expires_at)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS automation_login_limits (\`key\` VARCHAR(255) PRIMARY KEY,attempts INT NOT NULL,expires_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS acl_groups (id BIGINT PRIMARY KEY,name VARCHAR(255) NOT NULL UNIQUE,system TINYINT NOT NULL DEFAULT 0,created_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS acl_group_members (group_id BIGINT NOT NULL,user_id BIGINT NOT NULL,PRIMARY KEY(group_id,user_id)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS acl_core_grants (principal_type VARCHAR(16) NOT NULL,principal_id BIGINT NOT NULL,permission VARCHAR(64) NOT NULL,PRIMARY KEY(principal_type,principal_id,permission)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS acl_project_grants (project_id VARCHAR(64) NOT NULL,principal_type VARCHAR(16) NOT NULL,principal_id BIGINT NOT NULL,permission VARCHAR(64) NOT NULL,PRIMARY KEY(project_id,principal_type,principal_id,permission)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS acl_meta (\`key\` VARCHAR(255) PRIMARY KEY,\`value\` TEXT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS database_credentials (id CHAR(36) PRIMARY KEY,name VARCHAR(100) NOT NULL UNIQUE,host VARCHAR(255) NOT NULL,port INT NOT NULL,username VARCHAR(255) NOT NULL,password TEXT NOT NULL,database_name VARCHAR(255) NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS credentials (id CHAR(36) PRIMARY KEY,type VARCHAR(32) NOT NULL,name VARCHAR(100) NOT NULL,host VARCHAR(255) NOT NULL,port INT NULL,domain VARCHAR(255) NOT NULL,username VARCHAR(255) NOT NULL,password TEXT NOT NULL,private_key MEDIUMTEXT NOT NULL,database_name VARCHAR(255) NOT NULL,permissions TEXT NOT NULL,extra_json LONGTEXT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,UNIQUE KEY credential_type_name(type,name)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS vault_meta (\`key\` VARCHAR(255) PRIMARY KEY,\`value\` TEXT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS application_keys (project_id CHAR(36) PRIMARY KEY,key_hash CHAR(64) NOT NULL,encrypted_key TEXT NOT NULL,created_at BIGINT NOT NULL) ENGINE=InnoDB`
  ];
  for (const statement of statements) await connection.query(statement);
}
function sqliteRows(db, table, columns) { return db.prepare(`SELECT ${columns.map(column=>`"${column}"`).join(',')} FROM "${table}"`).all(); }
async function writeMySQLFromSQLite(db, config) {
  const connection = await mysql.createConnection(mysqlOptions(config));
  try {
    await ensureMySQL(connection); await connection.beginTransaction();
    for (const [table] of DELETE_ORDER) await connection.query(`DELETE FROM \`${table}\``);
    for (const [table, columns] of TABLES) {
      const rows = sqliteRows(db, table, columns); if (!rows.length) continue;
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
class MySQLAuth extends Auth {
  constructor(cacheFile, config, options) { super(cacheFile, options); this.mysqlConfig=config; this.cacheFile=cacheFile; this.flushPromise=Promise.resolve(); this.flushTimer=null; this.suspended=true; this.rawDB=this.db; }
  static async open(config, options={}) { const file=path.join(os.tmpdir(),`phidias-mysql-auth-${process.pid}-${crypto.randomUUID()}.sqlite`); const auth=new MySQLAuth(file,config,options); await readMySQLIntoSQLite(config,auth.rawDB); auth.initializeApplicationKeyVault(); auth.installTracking(); auth.suspended=false; return auth; }
  installTracking() {
    const owner=this, raw=this.rawDB;
    this.db=new Proxy(raw,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);return new Proxy(statement,{get(st,p){if(p==='run')return(...args)=>{const result=st.run(...args);if(/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)/i.test(sql))owner.queueFlush();return result;};const value=st[p];return typeof value==='function'?value.bind(st):value;}});};if(property==='exec')return sql=>{const result=target.exec(sql);if(/\b(?:INSERT|UPDATE|DELETE|REPLACE|COMMIT)\b/i.test(sql))owner.queueFlush();return result;};const value=target[property];return typeof value==='function'?value.bind(target):value;}});
  }
  queueFlush(){if(this.suspended)return;if(this.flushTimer)clearTimeout(this.flushTimer);this.flushTimer=setTimeout(()=>{this.flushTimer=null;this.flush().catch(()=>{});},10);this.flushTimer.unref?.();}
  async flush(){if(this.flushTimer){clearTimeout(this.flushTimer);this.flushTimer=null;}this.flushPromise=this.flushPromise.then(()=>writeMySQLFromSQLite(this.rawDB,this.mysqlConfig));return this.flushPromise;}
  close(){this.flush().catch(()=>{}).finally(()=>{try{this.rawDB.close();}catch{}fs.rmSync(this.cacheFile,{force:true});});}
}
async function openAuth(config,{secureCookies=false,keyFile=null}={}) { if((config.provider||'sqlite')==='mysql')return MySQLAuth.open(config.mysql,{secureCookies,keyFile});return new Auth(config.database,{secureCookies,keyFile}); }
async function migrateAuth(auth, target, sqliteFile) {
  await auth.flush?.();
  if(target.provider==='mysql'){await writeMySQLFromSQLite(auth.rawDB||auth.db,target.mysql);return;}
  const destination=new Auth(sqliteFile,{secureCookies:target.secureCookies});
  try{copySQLite(auth.rawDB||auth.db,destination.db);}finally{destination.close();}
}
module.exports={TABLES,MySQLAuth,openAuth,migrateAuth,writeMySQLFromSQLite,readMySQLIntoSQLite,copySQLite};
