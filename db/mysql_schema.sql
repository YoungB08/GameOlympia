CREATE DATABASE IF NOT EXISTS game_olympia
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE game_olympia;

CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash CHAR(64) NOT NULL,
  display_name VARCHAR(100) NOT NULL DEFAULT '',
  role ENUM('admin', 'bqt') NOT NULL DEFAULT 'admin',
  server_slot_id INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS question_sets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  set_code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  access_password VARCHAR(100) NOT NULL DEFAULT '',
  visibility ENUM('private', 'public') NOT NULL DEFAULT 'private',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS warmup_questions (
  question_set_id INT NOT NULL DEFAULT 1,
  stt INT NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer TINYINT(1) NOT NULL,
  PRIMARY KEY (question_set_id, stt),
  CONSTRAINT fk_warmup_questions_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS obstacle_keys (
  question_set_id INT NOT NULL DEFAULT 1,
  stt INT NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer VARCHAR(100) NOT NULL,
  cell_count INT NOT NULL,
  image_path VARCHAR(500) NULL,
  PRIMARY KEY (question_set_id, stt),
  CONSTRAINT fk_obstacle_keys_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS obstacle_rows (
  question_set_id INT NOT NULL DEFAULT 1,
  stt INT NOT NULL,
  row_no INT NOT NULL,
  cell_count INT NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer VARCHAR(100) NOT NULL,
  PRIMARY KEY (question_set_id, stt, row_no),
  CONSTRAINT fk_obstacle_rows_key_set
    FOREIGN KEY (question_set_id, stt) REFERENCES obstacle_keys(question_set_id, stt)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS speed_questions (
  question_set_id INT NOT NULL DEFAULT 1,
  stt INT NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer_a VARCHAR(100) NULL,
  answer_b VARCHAR(100) NULL,
  answer_c VARCHAR(100) NULL,
  answer_d VARCHAR(100) NULL,
  answer VARCHAR(50) NOT NULL,
  media_path VARCHAR(500) NULL,
  PRIMARY KEY (question_set_id, stt),
  CONSTRAINT fk_speed_questions_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finish_questions (
  question_set_id INT NOT NULL DEFAULT 1,
  stt INT NOT NULL,
  question VARCHAR(500) NOT NULL,
  answer_a VARCHAR(100) NULL,
  answer_b VARCHAR(100) NULL,
  answer_c VARCHAR(100) NULL,
  answer_d VARCHAR(100) NULL,
  answer VARCHAR(10) NOT NULL,
  point INT NOT NULL,
  PRIMARY KEY (question_set_id, stt, point),
  CONSTRAINT fk_finish_questions_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS finish_packages (
  stt INT PRIMARY KEY,
  name VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS scores (
  stt INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS match_rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_set_id INT NOT NULL DEFAULT 1,
  server_name VARCHAR(80) NOT NULL DEFAULT 'Server 1',
  purpose VARCHAR(120) NOT NULL,
  room_code VARCHAR(40) NOT NULL UNIQUE,
  quick_token VARCHAR(80) NOT NULL UNIQUE,
  login_password VARCHAR(100) NOT NULL,
  recovery_password VARCHAR(100) NOT NULL DEFAULT 'admin',
  status ENUM('draft', 'scheduled', 'live', 'paused', 'finished', 'cancelled') NOT NULL DEFAULT 'scheduled',
  scheduled_from DATETIME NOT NULL,
  scheduled_to DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_match_rooms_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contestants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  login_code VARCHAR(40) NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  school VARCHAR(150) NOT NULL DEFAULT '',
  avatar_url VARCHAR(500) NOT NULL DEFAULT '',
  seat_no INT NOT NULL DEFAULT 0,
  score INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contestants_room_login_code (room_id, login_code),
  CONSTRAINT fk_contestants_room
    FOREIGN KEY (room_id) REFERENCES match_rooms(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS media_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_set_id INT NULL,
  title VARCHAR(150) NOT NULL,
  media_type ENUM('image', 'audio', 'video', 'theme') NOT NULL,
  url VARCHAR(500) NULL,
  local_path VARCHAR(500) NULL,
  duration_seconds INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_media_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contestant_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  contestant_id INT NULL,
  event_type VARCHAR(60) NOT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_room
    FOREIGN KEY (room_id) REFERENCES match_rooms(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_events_contestant
    FOREIGN KEY (contestant_id) REFERENCES contestants(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO admins (username, password_hash, display_name, role, is_active)
VALUES ('admin', SHA2('admin', 256), 'Admin tổng quản', 'admin', 1)
ON DUPLICATE KEY UPDATE role = 'admin', is_active = 1;

INSERT INTO question_sets (id, set_code, name, access_password, visibility, is_active)
VALUES (1, 'SET-DEFAULT', 'Bộ đề mặc định Game Olympia', 'admin', 'private', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);
