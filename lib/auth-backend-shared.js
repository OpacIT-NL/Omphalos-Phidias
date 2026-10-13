'use strict';

// Keep a single schema for migrations and the live MySQL backend. Identifiers
// are quoted because MySQL 8 reserves names which older MySQL/MariaDB releases
// accepted (notably SYSTEM).
const TABLES = [
  ['users', ['id', 'username', 'password_hash', 'created_at']],
  ['sessions', ['token_hash', 'user_id', 'csrf_token', 'expires_at']],
  ['login_limits', ['key', 'attempts', 'expires_at']],
  ['automation_sessions', ['token_hash', 'user_id', 'kind', 'expires_at']],
  ['automation_login_limits', ['key', 'attempts', 'expires_at']],
  ['acl_groups', ['id', 'name', 'system', 'created_at']],
  ['acl_group_members', ['group_id', 'user_id']],
  ['acl_core_grants', ['principal_type', 'principal_id', 'permission']],
  ['acl_project_grants', ['project_id', 'principal_type', 'principal_id', 'permission']],
  ['acl_meta', ['key', 'value']],
  ['database_credentials', ['id', 'name', 'host', 'port', 'username', 'password', 'database_name', 'created_at', 'updated_at']],
  ['credentials', ['id', 'type', 'name', 'host', 'port', 'domain', 'username', 'password', 'private_key', 'database_name', 'permissions', 'extra_json', 'created_at', 'updated_at']],
  ['vault_meta', ['key', 'value']],
  ['application_keys', ['project_id', 'key_hash', 'encrypted_key', 'created_at']]
];

const MYSQL_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS `users` (`id` BIGINT NOT NULL AUTO_INCREMENT,`username` VARCHAR(64) NOT NULL UNIQUE,`password_hash` TEXT NOT NULL,`created_at` BIGINT NOT NULL,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `sessions` (`token_hash` CHAR(64) NOT NULL,`user_id` BIGINT NOT NULL,`csrf_token` VARCHAR(255) NOT NULL,`expires_at` BIGINT NOT NULL,PRIMARY KEY (`token_hash`),INDEX (`expires_at`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `login_limits` (`key` VARCHAR(255) NOT NULL,`attempts` INT NOT NULL,`expires_at` BIGINT NOT NULL,PRIMARY KEY (`key`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `automation_sessions` (`token_hash` CHAR(64) NOT NULL,`user_id` BIGINT NOT NULL,`kind` VARCHAR(16) NOT NULL,`expires_at` BIGINT NOT NULL,PRIMARY KEY (`token_hash`),INDEX (`expires_at`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `automation_login_limits` (`key` VARCHAR(255) NOT NULL,`attempts` INT NOT NULL,`expires_at` BIGINT NOT NULL,PRIMARY KEY (`key`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `acl_groups` (`id` BIGINT NOT NULL AUTO_INCREMENT,`name` VARCHAR(255) NOT NULL UNIQUE,`system` TINYINT NOT NULL DEFAULT 0,`created_at` BIGINT NOT NULL,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `acl_group_members` (`group_id` BIGINT NOT NULL,`user_id` BIGINT NOT NULL,PRIMARY KEY (`group_id`,`user_id`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `acl_core_grants` (`principal_type` VARCHAR(16) NOT NULL,`principal_id` BIGINT NOT NULL,`permission` VARCHAR(64) NOT NULL,PRIMARY KEY (`principal_type`,`principal_id`,`permission`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `acl_project_grants` (`project_id` VARCHAR(64) NOT NULL,`principal_type` VARCHAR(16) NOT NULL,`principal_id` BIGINT NOT NULL,`permission` VARCHAR(64) NOT NULL,PRIMARY KEY (`project_id`,`principal_type`,`principal_id`,`permission`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `acl_meta` (`key` VARCHAR(255) NOT NULL,`value` TEXT NOT NULL,PRIMARY KEY (`key`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `database_credentials` (`id` CHAR(36) NOT NULL,`name` VARCHAR(100) NOT NULL UNIQUE,`host` VARCHAR(255) NOT NULL,`port` INT NOT NULL,`username` VARCHAR(255) NOT NULL,`password` TEXT NOT NULL,`database_name` VARCHAR(255) NOT NULL,`created_at` BIGINT NOT NULL,`updated_at` BIGINT NOT NULL,PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `credentials` (`id` CHAR(36) NOT NULL,`type` VARCHAR(32) NOT NULL,`name` VARCHAR(100) NOT NULL,`host` VARCHAR(255) NOT NULL,`port` INT NULL,`domain` VARCHAR(255) NOT NULL,`username` VARCHAR(255) NOT NULL,`password` TEXT NOT NULL,`private_key` MEDIUMTEXT NOT NULL,`database_name` VARCHAR(255) NOT NULL,`permissions` TEXT NOT NULL,`extra_json` LONGTEXT NOT NULL,`created_at` BIGINT NOT NULL,`updated_at` BIGINT NOT NULL,PRIMARY KEY (`id`),UNIQUE KEY `credential_type_name` (`type`,`name`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `vault_meta` (`key` VARCHAR(255) NOT NULL,`value` TEXT NOT NULL,PRIMARY KEY (`key`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'CREATE TABLE IF NOT EXISTS `application_keys` (`project_id` CHAR(36) NOT NULL,`key_hash` CHAR(64) NOT NULL,`encrypted_key` TEXT NOT NULL,`created_at` BIGINT NOT NULL,PRIMARY KEY (`project_id`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
];

async function addAutoIncrementIfMissing(connection, table) {
  const [rows] = await connection.query(
    'SELECT `EXTRA` AS `extra` FROM `information_schema`.`COLUMNS` WHERE `TABLE_SCHEMA`=DATABASE() AND `TABLE_NAME`=? AND `COLUMN_NAME`=\'id\'',
    [table]
  );
  if (!String(rows[0]?.extra || '').toLowerCase().includes('auto_increment')) {
    await connection.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`id\` BIGINT NOT NULL AUTO_INCREMENT`);
  }
}

async function ensureMySQL(connection) {
  for (const statement of MYSQL_SCHEMA) await connection.query(statement);
  // Older migrations created these columns without AUTO_INCREMENT. Repair
  // them so user and group inserts continue to work after the switch.
  await addAutoIncrementIfMissing(connection, 'users');
  await addAutoIncrementIfMissing(connection, 'acl_groups');
}

module.exports = { ensureMySQL, TABLES, MYSQL_SCHEMA };
