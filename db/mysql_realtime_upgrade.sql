USE game_olympia;

CREATE TABLE IF NOT EXISTS server_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  server_key VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(80) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('available', 'booked', 'maintenance') NOT NULL DEFAULT 'available',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS room_settings (
  room_id INT PRIMARY KEY,
  contest_title VARCHAR(180) NOT NULL DEFAULT 'Đường lên đỉnh Olympia',
  show_logo TINYINT(1) NOT NULL DEFAULT 1,
  scoreboard_mode ENUM('names', 'scores', 'both') NOT NULL DEFAULT 'both',
  allow_negative_score TINYINT(1) NOT NULL DEFAULT 1,
  candidate_count INT NOT NULL DEFAULT 4,
  active_round ENUM('setup', 'warmup', 'obstacle', 'speed', 'finish', 'tie_breaker', 'jeopardy', 'connecting_wall', 'summary') NOT NULL DEFAULT 'setup',
  current_question_text TEXT NULL,
  current_answer TEXT NULL,
  current_media_url VARCHAR(500) NULL,
  timer_seconds INT NOT NULL DEFAULT 0,
  timer_started_at DATETIME NULL,
  timer_running TINYINT(1) NOT NULL DEFAULT 0,
  ring_delay_seconds DECIMAL(4,2) NOT NULL DEFAULT 0,
  ring_locked TINYINT(1) NOT NULL DEFAULT 1,
  star_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  star_enabled TINYINT(1) NOT NULL DEFAULT 0,
  projector_mode ENUM('clean', 'projector', 'overlay') NOT NULL DEFAULT 'projector',
  mc_notice VARCHAR(500) NULL,
  state_json JSON NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_room_settings_room
    FOREIGN KEY (room_id) REFERENCES match_rooms(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS answer_submissions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  contestant_id INT NULL,
  round_key VARCHAR(40) NOT NULL,
  question_key VARCHAR(80) NULL,
  answer_text TEXT NOT NULL,
  elapsed_ms INT NULL,
  is_correct TINYINT(1) NULL,
  awarded_points INT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_answers_room
    FOREIGN KEY (room_id) REFERENCES match_rooms(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_answers_contestant
    FOREIGN KEY (contestant_id) REFERENCES contestants(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS buzzer_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  contestant_id INT NULL,
  round_key VARCHAR(40) NOT NULL,
  elapsed_ms INT NULL,
  status ENUM('accepted', 'locked', 'foul') NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_buzzer_room
    FOREIGN KEY (room_id) REFERENCES match_rooms(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  CONSTRAINT fk_buzzer_contestant
    FOREIGN KEY (contestant_id) REFERENCES contestants(id)
    ON UPDATE CASCADE
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS speed_media_sequences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_set_id INT NOT NULL DEFAULT 1,
  speed_stt INT NOT NULL,
  media_url VARCHAR(500) NOT NULL,
  duration_seconds DECIMAL(6,2) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  INDEX idx_speed_sequences_set_stt (question_set_id, speed_stt),
  CONSTRAINT fk_speed_sequence_question_set
    FOREIGN KEY (question_set_id, speed_stt) REFERENCES speed_questions(question_set_id, stt)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tie_breaker_questions (
  stt INT AUTO_INCREMENT PRIMARY KEY,
  question_set_id INT NOT NULL DEFAULT 1,
  question VARCHAR(500) NOT NULL,
  answer VARCHAR(150) NOT NULL,
  media_path VARCHAR(500) NULL,
  INDEX idx_tie_breaker_questions_question_set (question_set_id),
  CONSTRAINT fk_tie_breaker_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS jeopardy_clues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_set_id INT NOT NULL DEFAULT 1,
  category VARCHAR(120) NOT NULL,
  point_value INT NOT NULL,
  clue_text VARCHAR(500) NOT NULL,
  answer VARCHAR(150) NOT NULL,
  is_opened TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_jeopardy_clues_question_set (question_set_id),
  CONSTRAINT fk_jeopardy_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS connecting_wall_sets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_set_id INT NOT NULL DEFAULT 1,
  title VARCHAR(150) NOT NULL,
  time_limit_seconds INT NOT NULL DEFAULT 150,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_connecting_wall_sets_question_set (question_set_id),
  CONSTRAINT fk_wall_sets_question_set
    FOREIGN KEY (question_set_id) REFERENCES question_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS connecting_wall_cells (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wall_id INT NOT NULL,
  group_no INT NOT NULL,
  word_text VARCHAR(80) NOT NULL,
  group_answer VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_wall_cells_set
    FOREIGN KEY (wall_id) REFERENCES connecting_wall_sets(id)
    ON UPDATE CASCADE
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS import_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  file_name VARCHAR(240) NOT NULL,
  format_key ENUM('q2t_standard', 'lct3') NOT NULL,
  status ENUM('uploaded', 'imported', 'failed') NOT NULL DEFAULT 'uploaded',
  message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO server_slots (server_key, display_name, is_primary, status, sort_order)
SELECT seed.server_key, seed.display_name, seed.is_primary, seed.status, seed.sort_order
FROM (
  SELECT 'server-1' AS server_key, 'Server 1' AS display_name, 1 AS is_primary, 'available' AS status, 1 AS sort_order
  UNION ALL SELECT 'server-2', 'Server 2', 1, 'available', 2
  UNION ALL SELECT 'server-3', 'Server 3', 1, 'available', 3
  UNION ALL SELECT 'server-4', 'Server 4', 1, 'available', 4
  UNION ALL SELECT 'server-5', 'Server 5', 1, 'available', 5
  UNION ALL SELECT 'server-6', 'Server 6', 1, 'available', 6
  UNION ALL SELECT 'server-backup-a', 'Server phụ A', 0, 'available', 7
  UNION ALL SELECT 'server-backup-b', 'Server phụ B', 0, 'available', 8
) seed
WHERE NOT EXISTS (SELECT 1 FROM server_slots)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  is_primary = VALUES(is_primary),
  sort_order = VALUES(sort_order);

INSERT INTO finish_packages (stt, name)
VALUES
  (1, 'Goi 20 diem'),
  (2, 'Goi 40 diem')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO finish_questions (question_set_id, stt, question, answer_a, answer_b, answer_c, answer_d, answer, point)
SELECT question_set_id, stt, question, answer_a, answer_b, answer_c, answer_d, answer, 40
FROM finish_questions
WHERE point = 30
ON DUPLICATE KEY UPDATE
  question = VALUES(question),
  answer_a = VALUES(answer_a),
  answer_b = VALUES(answer_b),
  answer_c = VALUES(answer_c),
  answer_d = VALUES(answer_d),
  answer = VALUES(answer);
