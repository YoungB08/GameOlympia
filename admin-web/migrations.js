const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean)
    .filter((statement) => !statement.toUpperCase().startsWith("USE "));
}

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, "utf8");
  const statements = splitStatements(sql);
  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function ensureRealtimeSchema() {
  await addColumnIfMissing("question_sets", "set_code", "VARCHAR(40) NULL UNIQUE AFTER id");
  await ensureDefaultQuestionSet();
  await ensureCoreQuestionSetScope();

  const filePath = path.join(__dirname, "..", "db", "mysql_realtime_upgrade.sql");
  if (fs.existsSync(filePath)) {
    await runSqlFile(filePath);
  }

  await ensureExtensionQuestionSetScope();
  await ensureContestantLoginCodes();
  await addColumnIfMissing("match_rooms", "server_slot_id", "INT NULL AFTER id");
  await addColumnIfMissing("match_rooms", "quick_token", "VARCHAR(80) NULL UNIQUE AFTER room_code");
  await pool.query("UPDATE question_sets SET set_code = CONCAT('SET-', id) WHERE set_code IS NULL OR set_code = ''");
  await pool.query("UPDATE match_rooms SET quick_token = CONCAT(room_code, '-QUICK') WHERE quick_token IS NULL OR quick_token = ''");
  await ensureNonNullOperationalData();
  await ensureRoomServerSlots();
}

async function addColumnIfMissing(tableName, columnName, definition) {
  if (!(await tableExists(tableName))) return;
  if (await columnExists(tableName, columnName)) return;
  await pool.query(`ALTER TABLE ${quoteName(tableName)} ADD COLUMN ${quoteName(columnName)} ${definition}`);
}

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0].count) > 0;
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName],
  );
  return Number(rows[0].count) > 0;
}

async function constraintExists(tableName, constraintName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.table_constraints
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = ?`,
    [tableName, constraintName],
  );
  return Number(rows[0].count) > 0;
}

async function indexExists(tableName, indexName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [tableName, indexName],
  );
  return Number(rows[0].count) > 0;
}

async function primaryKeyColumns(tableName) {
  const [rows] = await pool.query(
    `SELECT column_name
     FROM information_schema.key_column_usage
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND constraint_name = 'PRIMARY'
     ORDER BY ordinal_position ASC`,
    [tableName],
  );
  return rows.map((row) => row.column_name);
}

async function ensureDefaultQuestionSet() {
  await pool.query(
    `INSERT INTO question_sets (id, set_code, name, access_password, visibility, is_active)
     VALUES (1, 'SET-DEFAULT', 'Bộ đề mặc định Game Olympia', 'admin', 'private', 1)
     ON DUPLICATE KEY UPDATE
       set_code = COALESCE(set_code, VALUES(set_code)),
       name = COALESCE(name, VALUES(name)),
       is_active = 1`,
  );
  await pool.query("UPDATE question_sets SET set_code = CONCAT('SET-', id) WHERE set_code IS NULL OR set_code = ''");
}

async function ensureScopedColumn(tableName, afterColumn = "id", nullable = false) {
  if (!(await tableExists(tableName))) return false;
  await addColumnIfMissing(tableName, "question_set_id", `INT NULL AFTER ${quoteName(afterColumn)}`);
  await pool.query(
    `UPDATE ${quoteName(tableName)}
     SET question_set_id = 1
     WHERE question_set_id IS NULL
        OR question_set_id NOT IN (SELECT id FROM question_sets)`,
  );
  const nullability = nullable ? "NULL DEFAULT NULL" : "NOT NULL DEFAULT 1";
  await pool.query(`ALTER TABLE ${quoteName(tableName)} MODIFY COLUMN question_set_id INT ${nullability}`);
  await ensureIndex(tableName, `idx_${tableName}_question_set`, ["question_set_id"]);
  return true;
}

async function ensureIndex(tableName, indexName, columns, unique = false) {
  if (!(await tableExists(tableName)) || (await indexExists(tableName, indexName))) return;
  await pool.query(`ALTER TABLE ${quoteName(tableName)} ADD ${unique ? "UNIQUE " : ""}INDEX ${quoteName(indexName)} (${columns.map(quoteName).join(", ")})`);
}

async function dropForeignKeyIfExists(tableName, constraintName) {
  if (!(await tableExists(tableName)) || !(await constraintExists(tableName, constraintName))) return;
  await pool.query(`ALTER TABLE ${quoteName(tableName)} DROP FOREIGN KEY ${quoteName(constraintName)}`);
}

async function ensurePrimaryKey(tableName, columns) {
  if (!(await tableExists(tableName))) return;
  const current = await primaryKeyColumns(tableName);
  if (current.length === columns.length && current.every((column, index) => column === columns[index])) return;
  await pool.query(`ALTER TABLE ${quoteName(tableName)} DROP PRIMARY KEY, ADD PRIMARY KEY (${columns.map(quoteName).join(", ")})`);
}

async function ensureForeignKey(tableName, constraintName, columns, referencedTable, referencedColumns, onDelete = "CASCADE") {
  if (!(await tableExists(tableName)) || (await constraintExists(tableName, constraintName))) return;
  await pool.query(
    `ALTER TABLE ${quoteName(tableName)}
     ADD CONSTRAINT ${quoteName(constraintName)}
     FOREIGN KEY (${columns.map(quoteName).join(", ")})
     REFERENCES ${quoteName(referencedTable)} (${referencedColumns.map(quoteName).join(", ")})
     ON UPDATE CASCADE
     ON DELETE ${onDelete}`,
  );
}

async function ensureScopedQuestionTable(tableName, primaryColumns, afterColumn = "stt") {
  if (!(await ensureScopedColumn(tableName, afterColumn))) return;
  await ensurePrimaryKey(tableName, ["question_set_id", ...primaryColumns]);
  await ensureForeignKey(tableName, `fk_${tableName}_question_set`, ["question_set_id"], "question_sets", ["id"], "CASCADE");
}

async function ensureCoreQuestionSetScope() {
  await ensureScopedColumn("match_rooms", "id");
  await ensureForeignKey("match_rooms", "fk_match_rooms_question_set", ["question_set_id"], "question_sets", ["id"], "RESTRICT");

  await dropForeignKeyIfExists("obstacle_rows", "fk_obstacle_rows_key");
  await dropForeignKeyIfExists("obstacle_rows", "fk_obstacle_rows_key_set");
  await dropForeignKeyIfExists("speed_media_sequences", "fk_speed_sequence_question");
  await dropForeignKeyIfExists("speed_media_sequences", "fk_speed_sequence_question_set");

  await ensureScopedQuestionTable("warmup_questions", ["stt"]);
  await ensureScopedQuestionTable("obstacle_keys", ["stt"]);

  if (await ensureScopedColumn("obstacle_rows", "stt")) {
    await ensurePrimaryKey("obstacle_rows", ["question_set_id", "stt", "row_no"]);
    await ensureForeignKey("obstacle_rows", "fk_obstacle_rows_key_set", ["question_set_id", "stt"], "obstacle_keys", ["question_set_id", "stt"], "CASCADE");
  }

  await ensureScopedQuestionTable("speed_questions", ["stt"]);
  await ensureScopedQuestionTable("finish_questions", ["stt", "point"]);
}

async function ensureExtensionQuestionSetScope() {
  if (await ensureScopedColumn("media_assets", "id", true)) {
    await ensureForeignKey("media_assets", "fk_media_question_set", ["question_set_id"], "question_sets", ["id"], "SET NULL");
  }

  if (await ensureScopedColumn("speed_media_sequences", "id")) {
    await ensureIndex("speed_media_sequences", "idx_speed_sequences_set_stt", ["question_set_id", "speed_stt"]);
    await ensureForeignKey("speed_media_sequences", "fk_speed_sequence_question_set", ["question_set_id", "speed_stt"], "speed_questions", ["question_set_id", "stt"], "CASCADE");
  }

  if (await ensureScopedColumn("tie_breaker_questions", "stt")) {
    await ensureForeignKey("tie_breaker_questions", "fk_tie_breaker_question_set", ["question_set_id"], "question_sets", ["id"], "CASCADE");
  }

  if (await ensureScopedColumn("jeopardy_clues", "id")) {
    await ensureForeignKey("jeopardy_clues", "fk_jeopardy_question_set", ["question_set_id"], "question_sets", ["id"], "CASCADE");
  }

  if (await ensureScopedColumn("connecting_wall_sets", "id")) {
    await ensureForeignKey("connecting_wall_sets", "fk_wall_sets_question_set", ["question_set_id"], "question_sets", ["id"], "CASCADE");
  }
}

async function ensureContestantLoginCodes() {
  if (!(await tableExists("contestants"))) return;
  await addColumnIfMissing("contestants", "login_code", "VARCHAR(40) NULL AFTER room_id");
  await pool.query("UPDATE contestants SET login_code = CAST(id AS CHAR) WHERE login_code IS NULL OR login_code = ''");
  await ensureIndex("contestants", "uq_contestants_room_login_code", ["room_id", "login_code"], true);
}

async function ensureRoomServerSlots() {
  if (!(await tableExists("match_rooms")) || !(await tableExists("server_slots"))) return;
  await ensureIndex("match_rooms", "idx_match_rooms_server_slot", ["server_slot_id"]);
  await pool.query(
    `UPDATE match_rooms r
     JOIN server_slots s ON s.display_name = r.server_name
     SET r.server_slot_id = s.id
     WHERE r.server_slot_id IS NULL`,
  );
  await pool.query(
    `UPDATE match_rooms r
     LEFT JOIN server_slots s ON s.id = r.server_slot_id
     SET r.server_slot_id = NULL
     WHERE r.server_slot_id IS NOT NULL
       AND s.id IS NULL`,
  );
  await pool.query(
    `UPDATE match_rooms r
     JOIN (
       SELECT id, display_name
       FROM server_slots
       ORDER BY is_primary DESC, sort_order ASC, id ASC
       LIMIT 1
     ) s
     SET r.server_slot_id = s.id,
         r.server_name = s.display_name
     WHERE r.server_slot_id IS NULL`,
  );
  await pool.query(
    `UPDATE match_rooms r
     JOIN server_slots seed ON seed.id = r.server_slot_id
     JOIN server_slots local_slots ON local_slots.id <> seed.id
       AND local_slots.sort_order = seed.sort_order
       AND local_slots.server_key NOT IN (
         'server-1',
         'server-2',
         'server-3',
         'server-4',
         'server-5',
         'server-6',
         'server-backup-a',
         'server-backup-b'
       )
     SET r.server_slot_id = local_slots.id,
         r.server_name = local_slots.display_name
     WHERE seed.server_key IN (
       'server-1',
       'server-2',
       'server-3',
       'server-4',
       'server-5',
       'server-6',
       'server-backup-a',
       'server-backup-b'
     )`,
  );
  await pool.query(
    `UPDATE server_slots s
     SET s.status = 'booked'
     WHERE s.status <> 'maintenance'
       AND EXISTS (
         SELECT 1
         FROM match_rooms r
         WHERE r.server_slot_id = s.id
           AND r.status IN ('scheduled', 'live', 'paused')
       )`,
  );
  await pool.query(
    `UPDATE server_slots s
     SET s.status = 'available'
     WHERE s.status = 'booked'
       AND NOT EXISTS (
         SELECT 1
         FROM match_rooms r
         WHERE r.server_slot_id = s.id
           AND r.status IN ('scheduled', 'live', 'paused')
       )`,
  );
  await ensureForeignKey("match_rooms", "fk_match_rooms_server_slot", ["server_slot_id"], "server_slots", ["id"], "SET NULL");
}

async function modifyColumnIfExists(tableName, columnName, definition) {
  if (!(await tableExists(tableName)) || !(await columnExists(tableName, columnName))) return;
  await pool.query(`ALTER TABLE ${quoteName(tableName)} MODIFY COLUMN ${quoteName(columnName)} ${definition}`);
}

async function ensureNonNullOperationalData() {
  if (await tableExists("question_sets")) {
    await pool.query("UPDATE question_sets SET set_code = CONCAT('SET-', id) WHERE set_code IS NULL OR set_code = ''");
    await pool.query("UPDATE question_sets SET name = CONCAT('Bộ đề ', id) WHERE name IS NULL OR name = ''");
    await pool.query("UPDATE question_sets SET access_password = '' WHERE access_password IS NULL");
    await pool.query("UPDATE question_sets SET visibility = 'private' WHERE visibility IS NULL OR visibility = ''");
    await pool.query("UPDATE question_sets SET is_active = 1 WHERE is_active IS NULL");
    await modifyColumnIfExists("question_sets", "set_code", "VARCHAR(40) NOT NULL");
    await modifyColumnIfExists("question_sets", "name", "VARCHAR(150) NOT NULL");
    await modifyColumnIfExists("question_sets", "access_password", "VARCHAR(100) NOT NULL DEFAULT ''");
    await modifyColumnIfExists("question_sets", "visibility", "ENUM('private', 'public') NOT NULL DEFAULT 'private'");
    await modifyColumnIfExists("question_sets", "is_active", "TINYINT(1) NOT NULL DEFAULT 1");
  }

  if (await tableExists("match_rooms")) {
    await pool.query("UPDATE match_rooms SET question_set_id = 1 WHERE question_set_id IS NULL OR question_set_id NOT IN (SELECT id FROM question_sets)");
    await pool.query("UPDATE match_rooms SET server_name = 'Server 1' WHERE server_name IS NULL OR server_name = ''");
    await pool.query("UPDATE match_rooms SET purpose = 'Test' WHERE purpose IS NULL OR purpose = ''");
    await pool.query("UPDATE match_rooms SET room_code = CONCAT('ROOM-', id) WHERE room_code IS NULL OR room_code = ''");
    await pool.query("UPDATE match_rooms SET quick_token = CONCAT(room_code, '-QUICK') WHERE quick_token IS NULL OR quick_token = ''");
    await pool.query("UPDATE match_rooms SET login_password = 'admin' WHERE login_password IS NULL OR login_password = ''");
    await pool.query("UPDATE match_rooms SET recovery_password = 'admin' WHERE recovery_password IS NULL OR recovery_password = ''");
    await pool.query("UPDATE match_rooms SET status = 'scheduled' WHERE status IS NULL OR status = ''");
    await pool.query("UPDATE match_rooms SET scheduled_from = COALESCE(scheduled_from, created_at, NOW()) WHERE scheduled_from IS NULL");
    await pool.query("UPDATE match_rooms SET scheduled_to = DATE_ADD(scheduled_from, INTERVAL 2 HOUR) WHERE scheduled_to IS NULL OR scheduled_to <= scheduled_from");
    await modifyColumnIfExists("match_rooms", "question_set_id", "INT NOT NULL DEFAULT 1");
    await modifyColumnIfExists("match_rooms", "server_name", "VARCHAR(80) NOT NULL DEFAULT 'Server 1'");
    await modifyColumnIfExists("match_rooms", "purpose", "VARCHAR(120) NOT NULL DEFAULT 'Test'");
    await modifyColumnIfExists("match_rooms", "room_code", "VARCHAR(40) NOT NULL");
    await modifyColumnIfExists("match_rooms", "quick_token", "VARCHAR(80) NOT NULL");
    await modifyColumnIfExists("match_rooms", "login_password", "VARCHAR(100) NOT NULL DEFAULT 'admin'");
    await modifyColumnIfExists("match_rooms", "recovery_password", "VARCHAR(100) NOT NULL DEFAULT 'admin'");
    await modifyColumnIfExists("match_rooms", "status", "ENUM('draft', 'scheduled', 'live', 'paused', 'finished', 'cancelled') NOT NULL DEFAULT 'scheduled'");
    await modifyColumnIfExists("match_rooms", "scheduled_from", "DATETIME NOT NULL");
    await modifyColumnIfExists("match_rooms", "scheduled_to", "DATETIME NOT NULL");
  }

  if (await tableExists("contestants")) {
    await pool.query("UPDATE contestants SET login_code = CAST(id AS CHAR) WHERE login_code IS NULL OR login_code = ''");
    await pool.query("UPDATE contestants SET display_name = CONCAT('Thí sinh ', id) WHERE display_name IS NULL OR display_name = ''");
    await pool.query("UPDATE contestants SET school = '' WHERE school IS NULL");
    await pool.query("UPDATE contestants SET avatar_url = '' WHERE avatar_url IS NULL");
    await pool.query("UPDATE contestants SET seat_no = id WHERE seat_no IS NULL OR seat_no <= 0");
    await pool.query("UPDATE contestants SET score = 0 WHERE score IS NULL");
    await pool.query("UPDATE contestants SET is_active = 1 WHERE is_active IS NULL");
    await modifyColumnIfExists("contestants", "login_code", "VARCHAR(40) NOT NULL");
    await modifyColumnIfExists("contestants", "display_name", "VARCHAR(100) NOT NULL");
    await modifyColumnIfExists("contestants", "school", "VARCHAR(150) NOT NULL DEFAULT ''");
    await modifyColumnIfExists("contestants", "avatar_url", "VARCHAR(500) NOT NULL DEFAULT ''");
    await modifyColumnIfExists("contestants", "seat_no", "INT NOT NULL DEFAULT 0");
    await modifyColumnIfExists("contestants", "score", "INT NOT NULL DEFAULT 0");
    await modifyColumnIfExists("contestants", "is_active", "TINYINT(1) NOT NULL DEFAULT 1");
  }
}

function quoteName(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

module.exports = { ensureRealtimeSchema };
