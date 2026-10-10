'use strict';

// Schema creation is shared by the direct MySQL runtime backend and the
// SQLite migration utilities.  Every statement is idempotent so upgrades do
// not replace users, sessions, ACLs, or credentials.
const TABLES = [
  ['users',['id','username','password_hash','created_at']], ['sessions',['token_hash','user_id','csrf_token','expires_at']], ['login_limits',['key','attempts','expires_at']],
  ['automation_sessions',['token_hash','user_id','kind','expires_at']], ['automation_login_limits',['key','attempts','expires_at']], ['acl_groups',['id','name','system','created_at']],
  ['acl_group_members',['group_id','user_id']], ['acl_core_grants',['principal_type','principal_id','permission']], ['acl_project_grants',['project_id','principal_type','principal_id','permission']],
  ['acl_meta',['key','value']], ['database_credentials',['id','name','host','port','username','password','database_name','created_at','updated_at']],
  ['credentials',['id','type','name','host','port','domain','username','password','private_key','database_name','permissions','extra_json','created_at','updated_at']],
  ['vault_meta',['key','value']], ['application_keys',['project_id','key_hash','encrypted_key','created_at']]
];
async function ensureMySQL(connection) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id BIGINT PRIMARY KEY AUTO_INCREMENT,username VARCHAR(64) NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT NOT NULL,csrf_token VARCHAR(255) NOT NULL,expires_at BIGINT NOT NULL,INDEX(expires_at)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS login_limits (\`key\` VARCHAR(255) PRIMARY KEY,attempts INT NOT NULL,expires_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS automation_sessions (token_hash CHAR(64) PRIMARY KEY,user_id BIGINT NOT NULL,kind VARCHAR(16) NOT NULL,expires_at BIGINT NOT NULL,INDEX(expires_at)) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS automation_login_limits (\`key\` VARCHAR(255) PRIMARY KEY,attempts INT NOT NULL,expires_at BIGINT NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS acl_groups (id BIGINT PRIMARY KEY AUTO_INCREMENT,name VARCHAR(255) NOT NULL UNIQUE,system TINYINT NOT NULL DEFAULT 0,created_at BIGINT NOT NULL) ENGINE=InnoDB`,
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
module.exports = { ensureMySQL, TABLES };
