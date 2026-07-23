const { query, one } = require("./db");
const {
  DEFAULT_RULE_PRESET,
  RULE_PRESETS,
  deriveTimerSeconds,
  getRulePreset,
  isKnownPreset,
} = require("./rules");

const stateCache = new Map();
const warmupNoBuzzTimers = new Map();
const warmupAnswerTimers = new Map();
const SCREEN_ROLES = Object.freeze({
  STUDENT: "STUDENT",
  MC: "MC",
  SCOREBOARD: "SCOREBOARD",
  VIEWER: "VIEWER",
});
const CONTROL_SCREEN_ROLE = "CONTROL";
const SCREEN_ROLE_VALUES = new Set([...Object.values(SCREEN_ROLES), CONTROL_SCREEN_ROLE]);
const DEFAULT_AUDIO_VOLUME = 0.5;

const DEFAULT_STATE = {
  rulePreset: DEFAULT_RULE_PRESET,
  rules: getRulePreset(DEFAULT_RULE_PRESET),
  round: "setup",
  contestTitle: "Duong len dinh Olympia",
  ui: {
    showLogo: true,
    scoreboardMode: "both",
    projectorMode: "projector",
    overlayTransparent: false,
    showCandidateAnswers: false,
  },
  scoring: {
    allowNegativeScore: true,
    candidateCount: 4,
  },
  warmup: {
    mode: "individual",
    questionIndex: 0,
    activeContestantId: null,
    buzzedContestantId: null,
    autoAdvanceRequestedAt: null,
    finished: false,
  },
  timer: {
    seconds: 0,
    remaining: 0,
    durationMs: 0,
    remainingMs: 0,
    running: false,
    startedAt: null,
    startedAtMs: null,
  },
  ring: {
    locked: true,
    delaySeconds: 0,
    firstContestantId: null,
    lastStatus: {},
  },
  question: {
    key: null,
    text: "",
    answer: "",
    note: "",
    mediaUrl: "",
    visible: false,
    answerVisible: false,
    starConfirmed: false,
    starEnabled: false,
    point: 0,
  },
  history: {
    questions: [],
  },
  puzzle: {
    selectedRow: null,
    revealed: [false, false, false, false, false],
    centerSelected: false,
    imageUrl: "",
  },
  speed: {
    preloadRequested: false,
    showFirstImageBeforeTimer: false,
    imageSequence: [],
    imageDurations: [],
    timings: getRulePreset(DEFAULT_RULE_PRESET).speed.questionSeconds,
    questionIndex: 1,
  },
  finish: {
    packagePoints: getRulePreset(DEFAULT_RULE_PRESET).finish.packages,
    activePackagePoints: 20,
    activeContestantId: null,
    starLockedUntilDecision: true,
    stealWindowSeconds: 5,
    stealMode: false,
  },
  tieBreaker: {
    armed: false,
    foulContestantIds: [],
    winnerContestantId: null,
    finished: false,
  },
  jeopardy: {
    activeClueId: null,
    penaltyLockMs: 250,
  },
  connectingWall: {
    wallId: null,
    timeLimitSeconds: 150,
    cells: [],
    solvedGroups: [],
  },
  media: {
    playing: false,
    url: "",
    title: "",
    startedAt: null,
    volume: DEFAULT_AUDIO_VOLUME,
  },
  notice: "",
  answers: [],
  buzzers: [],
  candidates: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(target, patch) {
  const result = Array.isArray(target) ? [...target] : { ...target };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  });
  return result;
}

function asBool(value) {
  return value === true || value === 1 || value === "1";
}

function parseDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toMysqlDateTime(value) {
  const date = parseDateTime(value);
  if (!date) return null;
  const pad = (part, size = 2) => String(part).padStart(size, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toIsoDateTime(value) {
  const date = parseDateTime(value);
  return date ? date.toISOString() : null;
}

function normalizedScreenRole(value, fallback = SCREEN_ROLES.VIEWER) {
  const role = String(value || "").trim().toUpperCase();
  return SCREEN_ROLE_VALUES.has(role) ? role : fallback;
}

function canControlSocket(socket) {
  return socket.data.screenRole === CONTROL_SCREEN_ROLE || !socket.data.screenRole;
}

function isMp3AudioUrl(value) {
  const raw = String(value || "").trim();
  return /\.mp3(?:[?#].*)?$/i.test(raw);
}

function timerStartMs(timer = {}) {
  const explicit = Number(timer.startedAtMs);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const parsed = parseDateTime(timer.startedAt);
  return parsed ? parsed.getTime() : null;
}

function timerDurationMs(timer = {}) {
  const explicit = Number(timer.durationMs);
  if (Number.isFinite(explicit) && explicit >= 0) return Math.round(explicit);
  const seconds = Number(timer.seconds || 0);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

function timerRemainingMs(timer = {}) {
  const durationMs = timerDurationMs(timer);
  const explicit = Number(timer.remainingMs);
  const fallbackSeconds = Number(timer.remaining);
  let fallbackMs = Number.isFinite(explicit)
    ? explicit
    : (Number.isFinite(fallbackSeconds) ? fallbackSeconds * 1000 : durationMs);
  if (timer.running) {
    const startedAtMs = timerStartMs(timer);
    if (startedAtMs) fallbackMs = durationMs - (Date.now() - startedAtMs);
  }
  return Math.max(0, Math.min(durationMs || Math.max(0, fallbackMs), Math.round(fallbackMs)));
}

function normalizeTimer(timer = {}) {
  const durationMs = timerDurationMs(timer);
  const remainingMs = timerRemainingMs({ ...timer, durationMs });
  const startedAtMs = timer.running ? (timerStartMs(timer) || Date.now()) : timerStartMs(timer);
  return {
    ...timer,
    seconds: durationMs / 1000,
    remaining: Math.ceil(remainingMs / 1000),
    durationMs,
    remainingMs,
    running: Boolean(timer.running) && durationMs > 0,
    startedAt: startedAtMs ? new Date(startedAtMs).toISOString() : null,
    startedAtMs: startedAtMs || null,
  };
}

function timerSnapshot(timer = {}) {
  return normalizeTimer(timer);
}

function startTimerPatch(seconds) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const durationMs = Math.round(safeSeconds * 1000);
  const startedAtMs = Date.now();
  return {
    seconds: safeSeconds,
    remaining: Math.ceil(durationMs / 1000),
    durationMs,
    remainingMs: durationMs,
    running: durationMs > 0,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
  };
}

function stoppedTimerPatch(overrides = {}) {
  return normalizeTimer({
    seconds: 0,
    remaining: 0,
    durationMs: 0,
    remainingMs: 0,
    running: false,
    startedAt: null,
    startedAtMs: null,
    ...overrides,
  });
}

function normalizeHistoryQuestions(history) {
  const items = Array.isArray(history?.questions) ? history.questions : [];
  return {
    questions: items
      .filter((item) => item && (item.key || item.text || item.answer))
      .slice(-80)
      .map((item) => ({
        key: item.key || "",
        round: item.round || "setup",
        text: String(item.text || ""),
        answer: String(item.answer || ""),
        note: String(item.note || ""),
        mediaUrl: String(item.mediaUrl || ""),
        point: Number(item.point || 0),
        answerVisible: Boolean(item.answerVisible),
        shownAt: item.shownAt || item.startedAt || new Date().toISOString(),
      })),
  };
}

function questionHistoryPatch(current, nextPatch, nextRound) {
  if (!nextPatch.question) return null;
  const mergedQuestion = deepMerge(current.question || {}, nextPatch.question);
  const key = mergedQuestion.key || current.question?.key || "";
  if (!key || !mergedQuestion.visible) return null;
  const hasContent = [mergedQuestion.text, mergedQuestion.answer, mergedQuestion.note, mergedQuestion.mediaUrl]
    .some((value) => String(value || "").trim());
  if (!hasContent) return null;

  const history = normalizeHistoryQuestions(current.history).questions;
  const index = history.findIndex((item) => item.key === key);
  const existing = index >= 0 ? history[index] : {};
  const item = {
    ...existing,
    key,
    round: existing.round || nextRound || current.round || "setup",
    text: String(mergedQuestion.text || ""),
    answer: String(mergedQuestion.answer || ""),
    note: String(mergedQuestion.note || ""),
    mediaUrl: String(mergedQuestion.mediaUrl || ""),
    point: Number(mergedQuestion.point || existing.point || 0),
    answerVisible: Boolean(mergedQuestion.answerVisible),
    shownAt: existing.shownAt || new Date().toISOString(),
  };
  if (index >= 0) {
    history[index] = item;
  } else {
    history.push(item);
  }
  return { questions: history.slice(-80) };
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function answerMatches(expected, actual) {
  const normalizedExpected = normalizeText(expected);
  const normalizedActual = normalizeText(actual);
  if (!normalizedExpected) return null;
  const trueValues = new Set(["1", "true", "t", "yes", "y", "dung", "right", "correct"]);
  const falseValues = new Set(["0", "false", "f", "no", "n", "sai", "wrong", "incorrect"]);
  if (trueValues.has(normalizedExpected)) return trueValues.has(normalizedActual);
  if (falseValues.has(normalizedExpected)) return falseValues.has(normalizedActual);
  return normalizedExpected === normalizedActual;
}

function normalizeState(rawState) {
  const base = clone(DEFAULT_STATE);
  const merged = deepMerge(base, rawState || {});
  merged.rulePreset = isKnownPreset(merged.rulePreset) ? merged.rulePreset : DEFAULT_RULE_PRESET;
  merged.rules = deepMerge(getRulePreset(merged.rulePreset), merged.rules || {});
  if (merged.rulePreset === "olympia26") {
    merged.speed.timings = [...merged.rules.speed.questionSeconds];
    merged.finish.packagePoints = [...merged.rules.finish.packages];
    merged.finish.starLockedUntilDecision = true;
    merged.finish.stealWindowSeconds = merged.rules.finish.stealWindowSeconds;
  }
  merged.timer = normalizeTimer(merged.timer);
  merged.history = normalizeHistoryQuestions(merged.history);
  return merged;
}

function activeRules(state) {
  return deepMerge(getRulePreset(state.rulePreset || DEFAULT_RULE_PRESET), state.rules || {});
}

function clearScheduledTimer(timerMap, roomId) {
  const timer = timerMap.get(roomId);
  if (timer) clearTimeout(timer);
  timerMap.delete(roomId);
}

function questionSetIdFromRoom(room) {
  const parsed = Number(room?.question_set_id || 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function getDefaultRoom() {
  let room = await one("SELECT * FROM match_rooms ORDER BY FIELD(status, 'live', 'scheduled', 'draft'), id DESC LIMIT 1");
  if (room) return room;
  const roomCode = `ROOM-${Date.now().toString(36).toUpperCase()}`;
  const serverSlot = await one("SELECT id, display_name FROM server_slots ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1").catch(() => null);
  await query(
    `INSERT INTO match_rooms
     (question_set_id, server_slot_id, server_name, purpose, room_code, quick_token, login_password, recovery_password, status, scheduled_from, scheduled_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW(), DATE_ADD(NOW(), INTERVAL 2 HOUR))`,
    [1, serverSlot?.id || null, serverSlot?.display_name || "Server 1", "Test", roomCode, `${roomCode}-QUICK`, "admin", "admin"],
  );
  room = await one("SELECT * FROM match_rooms WHERE room_code = ?", [roomCode]);
  await ensureRoomSettings(room.id);
  return room;
}

async function getRoomByCode(roomCode) {
  return one("SELECT * FROM match_rooms WHERE room_code = ?", [roomCode]);
}

function roomStatusRank(status) {
  return { live: 1, paused: 2, scheduled: 3, draft: 4 }[String(status || "")] || 99;
}

function roomFromLoginRow(row) {
  return {
    id: row.room_id,
    question_set_id: row.question_set_id,
    server_slot_id: row.server_slot_id,
    server_name: row.server_name,
    purpose: row.purpose,
    room_code: row.room_code,
    quick_token: row.quick_token,
    login_password: row.login_password,
    recovery_password: row.recovery_password,
    status: row.room_status,
    scheduled_from: row.scheduled_from,
    scheduled_to: row.scheduled_to,
    created_at: row.room_created_at,
  };
}

function contestantFromLoginRow(row) {
  return {
    id: row.contestant_id,
    display_name: row.display_name,
    school: row.school,
    avatar_url: row.avatar_url,
    seat_no: row.seat_no,
    score: row.score,
    is_active: row.is_active,
  };
}

async function findContestantLogin(loginCode, preferredRoomId = null) {
  const code = String(loginCode || "").trim();
  if (!code) return null;
  const rows = await query(
    `SELECT c.id AS contestant_id,
            c.display_name,
            c.school,
            c.avatar_url,
            c.seat_no,
            c.score,
            c.is_active,
            r.id AS room_id,
            r.question_set_id,
            r.server_slot_id,
            r.server_name,
            r.purpose,
            r.room_code,
            r.quick_token,
            r.login_password,
            r.recovery_password,
            r.status AS room_status,
            r.scheduled_from,
            r.scheduled_to,
            r.created_at AS room_created_at
     FROM contestants c
     JOIN match_rooms r ON r.id = c.room_id
     WHERE c.is_active = 1
       AND (c.login_code = ? OR CAST(c.id AS CHAR) = ?)
       AND r.status IN ('live', 'paused', 'scheduled', 'draft')
     ORDER BY
       CASE WHEN r.id = ? THEN 0 ELSE 1 END,
       FIELD(r.status, 'live', 'paused', 'scheduled', 'draft'),
       r.scheduled_from DESC,
       r.id DESC
     LIMIT 10`,
    [code, code, Number(preferredRoomId || 0)],
  );
  if (!rows.length) return null;

  const preferred = rows.find((row) => Number(row.room_id) === Number(preferredRoomId || 0));
  if (preferred) return { room: roomFromLoginRow(preferred), contestant: contestantFromLoginRow(preferred) };

  const bestRank = roomStatusRank(rows[0].room_status);
  const bestRows = rows.filter((row) => roomStatusRank(row.room_status) === bestRank);
  const distinctRooms = new Set(bestRows.map((row) => Number(row.room_id)));
  if (distinctRooms.size > 1) {
    return { ambiguous: true, matches: bestRows.map((row) => ({ room: roomFromLoginRow(row), contestant: contestantFromLoginRow(row) })) };
  }
  return { room: roomFromLoginRow(bestRows[0]), contestant: contestantFromLoginRow(bestRows[0]) };
}

async function ensureRoomSettings(roomId) {
  await query(
    "INSERT IGNORE INTO room_settings (room_id, state_json) VALUES (?, ?)",
    [roomId, JSON.stringify(DEFAULT_STATE)],
  );
}

async function loadRoomState(roomId) {
  await ensureRoomSettings(roomId);
  const room = await one("SELECT question_set_id FROM match_rooms WHERE id = ?", [roomId]);
  const settings = await one("SELECT * FROM room_settings WHERE room_id = ?", [roomId]);
  const candidates = await query(
    "SELECT id, display_name, school, avatar_url, seat_no, score, is_active FROM contestants WHERE room_id = ? ORDER BY seat_no ASC, id ASC",
    [roomId],
  );
  const answers = await query(
    "SELECT * FROM answer_submissions WHERE room_id = ? ORDER BY id DESC LIMIT 30",
    [roomId],
  );
  const buzzers = await query(
    "SELECT * FROM buzzer_events WHERE room_id = ? ORDER BY id DESC LIMIT 20",
    [roomId],
  );

  const saved = settings && settings.state_json ? settings.state_json : {};
  const parsedSaved = typeof saved === "string" ? JSON.parse(saved) : saved;
  const state = normalizeState(parsedSaved || {});
  state.round = settings.active_round || state.round;
  state.contestTitle = settings.contest_title || state.contestTitle;
  state.ui.showLogo = asBool(settings.show_logo);
  state.ui.scoreboardMode = settings.scoreboard_mode || state.ui.scoreboardMode;
  state.ui.projectorMode = settings.projector_mode || state.ui.projectorMode;
  state.scoring.allowNegativeScore = asBool(settings.allow_negative_score);
  state.scoring.candidateCount = Number(settings.candidate_count || state.scoring.candidateCount || 4);
  state.timer.seconds = Number(settings.timer_seconds || state.timer.seconds || 0);
  state.timer.running = asBool(settings.timer_running);
  state.timer.startedAt = toIsoDateTime(state.timer.startedAt) || toIsoDateTime(settings.timer_started_at);
  state.timer = normalizeTimer(state.timer);
  state.ring.delaySeconds = Number(settings.ring_delay_seconds || state.ring.delaySeconds || 0);
  state.ring.locked = asBool(settings.ring_locked);
  state.question.text = settings.current_question_text || state.question.text;
  state.question.answer = settings.current_answer || state.question.answer;
  state.question.mediaUrl = settings.current_media_url || state.question.mediaUrl;
  state.question.starConfirmed = asBool(settings.star_confirmed);
  state.question.starEnabled = asBool(settings.star_enabled);
  state.notice = settings.mc_notice || "";
  state.candidates = candidates;
  state.answers = answers.reverse();
  state.buzzers = buzzers.reverse();
  state.questionSetId = questionSetIdFromRoom(room);
  stateCache.set(roomId, state);
  return state;
}

async function persistState(roomId, state) {
  await query(
    `UPDATE room_settings
     SET contest_title = ?,
         show_logo = ?,
         scoreboard_mode = ?,
         allow_negative_score = ?,
         candidate_count = ?,
         active_round = ?,
         current_question_text = ?,
         current_answer = ?,
         current_media_url = ?,
         timer_seconds = ?,
         timer_started_at = ?,
         timer_running = ?,
         ring_delay_seconds = ?,
         ring_locked = ?,
         star_confirmed = ?,
         star_enabled = ?,
         projector_mode = ?,
         mc_notice = ?,
         state_json = ?
     WHERE room_id = ?`,
    [
      state.contestTitle,
      state.ui.showLogo ? 1 : 0,
      state.ui.scoreboardMode,
      state.scoring.allowNegativeScore ? 1 : 0,
      state.scoring.candidateCount,
      state.round,
      state.question.text || null,
      state.question.answer || null,
      state.question.mediaUrl || null,
      state.timer.seconds || 0,
      toMysqlDateTime(state.timer.startedAt),
      state.timer.running ? 1 : 0,
      state.ring.delaySeconds || 0,
      state.ring.locked ? 1 : 0,
      state.question.starConfirmed ? 1 : 0,
      state.question.starEnabled ? 1 : 0,
      state.ui.projectorMode,
      state.notice || null,
      JSON.stringify(state),
      roomId,
    ],
  );
}

function normalizePatch(current, patch) {
  let nextPatch = clone(patch || {});
  if (nextPatch.timer) {
    if (nextPatch.timer.seconds !== undefined && nextPatch.timer.durationMs === undefined) {
      nextPatch.timer.durationMs = Math.round(Number(nextPatch.timer.seconds || 0) * 1000);
    }
    if (nextPatch.timer.remaining !== undefined && nextPatch.timer.remainingMs === undefined) {
      nextPatch.timer.remainingMs = Math.round(Number(nextPatch.timer.remaining || 0) * 1000);
    }
    if (nextPatch.timer.startedAt === null) {
      nextPatch.timer.startedAtMs = null;
    }
    if (nextPatch.timer.running === false && nextPatch.timer.remainingMs === undefined && nextPatch.timer.remaining === undefined) {
      nextPatch.timer = { ...timerSnapshot(current.timer), ...nextPatch.timer };
    }
    nextPatch.timer = normalizeTimer(deepMerge(current.timer || {}, nextPatch.timer));
  }
  if (nextPatch.rulePreset && isKnownPreset(nextPatch.rulePreset)) {
    const preset = getRulePreset(nextPatch.rulePreset);
    nextPatch = deepMerge(nextPatch, {
      rules: preset,
      speed: {
        timings: preset.speed.questionSeconds,
      },
      finish: {
        packagePoints: preset.finish.packages,
        activePackagePoints: preset.finish.packages[0],
        starLockedUntilDecision: preset.finish.starBeforeQuestion,
        stealWindowSeconds: preset.finish.stealWindowSeconds,
      },
      tieBreaker: {
        armed: false,
        foulContestantIds: [],
        winnerContestantId: null,
        finished: false,
      },
    });
  }

  const nextRound = nextPatch.round || current.round;
  if (nextPatch.question?.visible && !nextPatch.question.key) {
    nextPatch.question.key = `${nextRound}-${Date.now()}`;
  }
  if (nextRound !== "finish" && nextPatch.question) {
    nextPatch.question.starConfirmed = true;
    nextPatch.question.starEnabled = false;
  }
  const historyPatch = questionHistoryPatch(current, nextPatch, nextRound);
  if (historyPatch) {
    nextPatch.history = historyPatch;
  }
  return nextPatch;
}

async function patchState(io, room, patch) {
  const current = stateCache.get(room.id) || (await loadRoomState(room.id));
  const normalizedPatch = normalizePatch(current, patch);
  const next = normalizeState(deepMerge(current, normalizedPatch));
  stateCache.set(room.id, next);
  await persistState(room.id, next);
  io.to(room.room_code).emit("state:patch", normalizedPatch);
  return next;
}

function elapsedMs(state) {
  if (!state.timer.startedAt) return null;
  const started = new Date(state.timer.startedAt).getTime();
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Date.now() - started);
}

async function applyScore(roomId, contestantId, delta, allowNegativeScore) {
  const scoreDelta = Number(delta || 0);
  if (!contestantId || !Number.isFinite(scoreDelta) || scoreDelta === 0) return;
  const candidate = await one("SELECT score FROM contestants WHERE id = ? AND room_id = ?", [contestantId, roomId]);
  if (!candidate) return;
  const currentScore = Number(candidate.score || 0);
  const nextScore = allowNegativeScore ? currentScore + scoreDelta : Math.max(0, currentScore + scoreDelta);
  await query("UPDATE contestants SET score = ? WHERE id = ? AND room_id = ?", [nextScore, contestantId, roomId]);
}

function computeManualDefaultPoints(state, isCorrect) {
  const rules = activeRules(state);
  if (state.round === "warmup") {
    if (state.warmup?.mode === "common") return isCorrect ? rules.warmup.correctPoints : rules.warmup.commonWrongPenalty;
    return isCorrect ? rules.warmup.correctPoints : 0;
  }
  if (state.round === "obstacle") {
    return isCorrect ? (state.puzzle?.centerSelected ? rules.obstacle.centerCorrectPoints : rules.obstacle.rowCorrectPoints) : 0;
  }
  if (state.round === "finish") {
    const point = Number(state.question?.point || state.finish?.activePackagePoints || rules.finish.packages[0] || 20);
    if (state.question?.starEnabled) return isCorrect ? point * rules.finish.starCorrectMultiplier : -point;
    return isCorrect ? point : -point;
  }
  return isCorrect ? 10 : 0;
}

async function buildNextWarmupPatch(room, state, reason = "manual") {
  const rules = activeRules(state);
  const questionSetId = questionSetIdFromRoom(room);
  const mode = state.warmup?.mode === "common" ? "common" : "individual";
  const maxQuestions = mode === "common" ? rules.warmup.commonQuestions : rules.warmup.individualQuestions;
  const nextIndex = Number(state.warmup?.questionIndex || 0) + 1;
  if (nextIndex > maxQuestions) {
    return {
      warmup: { finished: true, autoAdvanceRequestedAt: new Date().toISOString(), buzzedContestantId: null },
      timer: stoppedTimerPatch(),
      ring: { locked: true, firstContestantId: null, lastStatus: {} },
      question: { visible: false, answerVisible: false },
      notice: "Khoi dong: da het so cau theo preset.",
    };
  }

  const offset = Math.max(0, nextIndex - 1);
  const row = await one(
    "SELECT stt, question, answer FROM warmup_questions WHERE question_set_id = ? ORDER BY stt ASC LIMIT 1 OFFSET ?",
    [questionSetId, offset],
  );
  if (!row) {
    return {
      warmup: { finished: true, autoAdvanceRequestedAt: new Date().toISOString(), buzzedContestantId: null },
      timer: stoppedTimerPatch(),
      ring: { locked: true, firstContestantId: null, lastStatus: {} },
      question: { visible: false, answerVisible: false },
      notice: "Khởi động: không còn câu hỏi trong bộ đề của phòng.",
    };
  }

  const seconds = mode === "common" ? rules.warmup.commonAnswerSeconds : rules.warmup.individualSeconds;
  return {
    round: "warmup",
    warmup: {
      questionIndex: nextIndex,
      buzzedContestantId: null,
      autoAdvanceRequestedAt: reason === "no_buzz" ? new Date().toISOString() : null,
      finished: false,
    },
    question: {
      key: `warmup-${row.stt}`,
      text: row.question,
      answer: row.answer ? "true" : "false",
      mediaUrl: "",
      visible: true,
      answerVisible: false,
      starConfirmed: true,
      starEnabled: false,
      point: rules.warmup.correctPoints,
    },
    timer: mode === "individual"
      ? startTimerPatch(seconds)
      : stoppedTimerPatch({
        seconds,
        remaining: seconds,
        durationMs: Number(seconds || 0) * 1000,
        remainingMs: Number(seconds || 0) * 1000,
      }),
    ring: { locked: mode !== "common", firstContestantId: null, lastStatus: {} },
  };
}

async function advanceWarmupQuestion(io, room, reason = "manual") {
  clearScheduledTimer(warmupNoBuzzTimers, room.id);
  clearScheduledTimer(warmupAnswerTimers, room.id);
  const state = stateCache.get(room.id) || (await loadRoomState(room.id));
  const patch = await buildNextWarmupPatch(room, state, reason);
  return patchState(io, room, patch);
}

function scheduleWarmupNoBuzz(io, room, state) {
  const rules = activeRules(state);
  if (state.round !== "warmup" || state.warmup?.mode !== "common" || !rules.warmup.noBuzzAutoNext) return;
  clearScheduledTimer(warmupNoBuzzTimers, room.id);
  const questionKey = state.question?.key || null;
  const seconds = Number(rules.warmup.commonAnswerSeconds || 5);
  const timer = setTimeout(async () => {
    try {
      const current = stateCache.get(room.id) || (await loadRoomState(room.id));
      if (
        current.round === "warmup" &&
        current.warmup?.mode === "common" &&
        current.question?.key === questionKey &&
        !current.ring?.firstContestantId
      ) {
        await advanceWarmupQuestion(io, room, "no_buzz");
      }
    } catch (error) {
      console.error(error);
    }
  }, seconds * 1000);
  warmupNoBuzzTimers.set(room.id, timer);
}

function scheduleWarmupNoAnswer(io, room, state, contestantId, questionKey) {
  const rules = activeRules(state);
  if (state.round !== "warmup" || state.warmup?.mode !== "common") return;
  clearScheduledTimer(warmupAnswerTimers, room.id);
  const seconds = Number(rules.warmup.commonAnswerSeconds || 5);
  const timer = setTimeout(async () => {
    try {
      const current = stateCache.get(room.id) || (await loadRoomState(room.id));
      if (
        current.round !== "warmup" ||
        current.warmup?.mode !== "common" ||
        current.question?.key !== questionKey ||
        Number(current.ring?.firstContestantId) !== Number(contestantId)
      ) {
        return;
      }
      const existingAnswer = await one(
        "SELECT id FROM answer_submissions WHERE room_id = ? AND round_key = 'warmup' AND question_key <=> ? AND contestant_id = ? LIMIT 1",
        [room.id, questionKey, contestantId],
      );
      if (existingAnswer) return;
      const penalty = Number(rules.warmup.commonWrongPenalty || -5);
      await query(
        "INSERT INTO answer_submissions (room_id, contestant_id, round_key, question_key, answer_text, elapsed_ms, is_correct, awarded_points) VALUES (?, ?, 'warmup', ?, ?, ?, 0, ?)",
        [room.id, contestantId, questionKey, "[NO ANSWER]", elapsedMs(current), penalty],
      );
      await applyScore(room.id, contestantId, penalty, current.scoring.allowNegativeScore);
      const fresh = await loadRoomState(room.id);
      await patchState(io, room, {
        answers: fresh.answers,
        candidates: fresh.candidates,
        timer: { running: false },
        ring: {
          locked: true,
          firstContestantId: null,
          lastStatus: { ...(current.ring?.lastStatus || {}), [contestantId]: "timeout" },
        },
        warmup: { buzzedContestantId: null },
        notice: "Khoi dong chung: thi sinh da bam chuong nhung khong tra loi trong 5 giay.",
      });
    } catch (error) {
      console.error(error);
    }
  }, seconds * 1000);
  warmupAnswerTimers.set(room.id, timer);
}

function isBuzzRound(state) {
  return ["obstacle", "finish", "tie_breaker", "jeopardy"].includes(state.round) || (state.round === "warmup" && state.warmup?.mode === "common");
}

function isAnswerWindowOpen(state, contestantId) {
  const id = Number(contestantId || 0);
  if (!id || !state.question?.visible || !state.timer?.running) return false;
  if (state.round === "warmup") {
    if (state.warmup?.mode === "common") return Number(state.ring?.firstContestantId || 0) === id;
    return !state.warmup?.activeContestantId || Number(state.warmup.activeContestantId) === id;
  }
  if (state.round === "speed" || state.round === "obstacle") return true;
  if (state.round === "finish") {
    const activeId = Number(state.finish?.activeContestantId || 0);
    const firstId = Number(state.ring?.firstContestantId || 0);
    return (activeId === id && !state.finish?.stealMode) || (firstId === id && id !== activeId);
  }
  if (state.round === "tie_breaker" || state.round === "jeopardy") {
    return Number(state.ring?.firstContestantId || 0) === id;
  }
  return state.round === "connecting_wall";
}

async function authenticatedContestant(socket, requestedContestantId = null) {
  const authenticatedId = Number(socket.data.contestantId || 0);
  const requestedId = Number(requestedContestantId || authenticatedId || 0);
  if (!authenticatedId || authenticatedId !== requestedId) return null;
  return one(
    "SELECT id, display_name, school, avatar_url, seat_no, score, is_active FROM contestants WHERE id = ? AND room_id = ? AND is_active = 1",
    [authenticatedId, socket.data.room.id],
  );
}

async function setupRealtime(io) {
  io.on("connection", (socket) => {
    const on = (eventName, handler) => {
      socket.on(eventName, (...args) => {
        Promise.resolve(handler(...args)).catch((err) => {
          console.error(`[socket:${eventName}]`, err);
          socket.emit("error:message", "Loi server khi xu ly yeu cau. Kiem tra console admin-web.");
        });
      });
    };
    const requireControl = () => {
      if (canControlSocket(socket)) return true;
      socket.emit("error:message", "Man hinh nay chi duoc xem, khong co quyen dieu khien tran dau.");
      return false;
    };

    on("room:join", async ({ roomCode, screenRole, role }) => {
      const room = await getRoomByCode(roomCode);
      if (!room) {
        socket.emit("error:message", "Khong tim thay phong.");
        return;
      }
      socket.join(room.room_code);
      socket.data.room = room;
      socket.data.screenRole = normalizedScreenRole(screenRole || role, SCREEN_ROLES.VIEWER);
      const state = await loadRoomState(room.id);
      socket.emit("state:init", state);
    });

    on("candidate:login", async ({ loginCode, screenRole, role }) => {
      const code = String(loginCode || "").trim();
      if (!code) {
        socket.emit("candidate:login:error", "Thiếu mã ID thí sinh.");
        return;
      }
      socket.data.screenRole = normalizedScreenRole(screenRole || role, SCREEN_ROLES.STUDENT);
      const login = await findContestantLogin(code, socket.data.room?.id);
      if (!login) {
        socket.emit("candidate:login:error", "Mã ID không hợp lệ hoặc tài khoản đã bị khóa.");
        return;
      }
      if (login.ambiguous) {
        socket.emit("candidate:login:error", "Mã ID này đang trùng ở nhiều phòng/server đang mở. Admin cần đổi mã ID thí sinh cho duy nhất.");
        return;
      }
      const { room, contestant } = login;
      if (!socket.data.room || Number(socket.data.room.id) !== Number(room.id)) {
        if (socket.data.room?.room_code) socket.leave(socket.data.room.room_code);
        socket.join(room.room_code);
        socket.data.room = room;
        const state = await loadRoomState(room.id);
        socket.emit("state:init", state);
      }
      socket.data.contestantId = Number(contestant.id);
      socket.emit("candidate:login:ok", {
        screenRole: socket.data.screenRole,
        contestant,
        room: {
          id: room.id,
          room_code: room.room_code,
          server_slot_id: room.server_slot_id,
          server_name: room.server_name,
          status: room.status,
        },
      });
    });

    on("admin:patch", async ({ patch }) => {
      if (!socket.data.room || !requireControl()) return;
      const current = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const nextRound = patch?.round || current.round;
      const nextRules = patch?.rulePreset ? getRulePreset(patch.rulePreset) : activeRules(current);
      const starConfirmed = patch?.question?.starConfirmed ?? current.question?.starConfirmed;
      if (nextRound === "finish" && patch?.question?.visible && nextRules.finish.starBeforeQuestion && !starConfirmed) {
        socket.emit("error:message", "Ve Dich: phai chot Chon/Khong chon Ngoi sao hy vong truoc khi hien cau hoi.");
        return;
      }
      await patchState(io, socket.data.room, patch);
    });

    on("timer:start", async ({ seconds } = {}) => {
      if (!socket.data.room || !requireControl()) return;
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const derivedSeconds = deriveTimerSeconds(state, seconds);
      await patchState(io, socket.data.room, {
        timer: startTimerPatch(derivedSeconds),
      });
    });

    on("timer:stop", async () => {
      if (!socket.data.room || !requireControl()) return;
      await patchState(io, socket.data.room, { timer: { running: false } });
    });

    on("ring:set", async ({ locked, delaySeconds }) => {
      if (!socket.data.room || !requireControl()) return;
      clearScheduledTimer(warmupNoBuzzTimers, socket.data.room.id);
      clearScheduledTimer(warmupAnswerTimers, socket.data.room.id);
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const delay = Math.max(0, Math.min(5, Number(delaySeconds || 0)));
      if (!locked && delay > 0) {
        await patchState(io, socket.data.room, {
          ring: { locked: true, delaySeconds: delay, firstContestantId: null, lastStatus: {} },
          notice: `Mo chuong sau ${delay}s.`,
        });
        setTimeout(async () => {
          const delayedState = await patchState(io, socket.data.room, {
            ring: { locked: false, delaySeconds: delay, firstContestantId: null, lastStatus: {} },
            notice: "",
          });
          scheduleWarmupNoBuzz(io, socket.data.room, delayedState);
        }, delay * 1000);
        return;
      }
      const nextState = await patchState(io, socket.data.room, {
        ring: { locked: Boolean(locked), delaySeconds: delay, firstContestantId: null, lastStatus: {} },
      });
      if (!locked) scheduleWarmupNoBuzz(io, socket.data.room, nextState);
    });

    on("media:play", async ({ url, title }) => {
      if (!socket.data.room || !requireControl()) return;
      if (!isMp3AudioUrl(url)) {
        socket.emit("error:message", "Trinh quan ly am thanh chi nhan file .mp3.");
        return;
      }
      await patchState(io, socket.data.room, { media: { playing: true, url: url || "", title: title || "", startedAt: new Date().toISOString(), volume: DEFAULT_AUDIO_VOLUME } });
    });

    on("media:stop", async () => {
      if (!socket.data.room || !requireControl()) return;
      await patchState(io, socket.data.room, { media: { playing: false, url: "", title: "", startedAt: null, volume: DEFAULT_AUDIO_VOLUME } });
    });

    on("warmup:next", async () => {
      if (!socket.data.room || !requireControl()) return;
      await advanceWarmupQuestion(io, socket.data.room);
    });

    on("candidate:answer", async ({ contestantId, answerText, questionKey }) => {
      if (!socket.data.room) return;
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const contestant = await authenticatedContestant(socket, contestantId);
      if (!contestant) {
        socket.emit("error:message", "Vui lòng đăng nhập bằng mã ID thí sinh hợp lệ.");
        return;
      }
      contestantId = Number(contestant.id);
      const rules = activeRules(state);
      const ms = elapsedMs(state);
      const qKey = questionKey || state.question.key || null;
      const expectedAnswer = state.question?.answer || "";
      const match = answerMatches(expectedAnswer, answerText);
      let isCorrect = match === null ? null : Boolean(match);
      let awarded = null;

      if (state.round === "tie_breaker" && (state.tieBreaker?.foulContestantIds || []).map(Number).includes(Number(contestantId))) {
        socket.emit("error:message", "Thi sinh da PHAM QUY va mat quyen tra loi cau nay.");
        return;
      }
      if (!isAnswerWindowOpen(state, contestantId)) {
        socket.emit("error:message", "Admin chưa mở quyền trả lời cho thí sinh này.");
        return;
      }
      if (
        state.round === "warmup" &&
        state.warmup?.mode !== "common" &&
        state.warmup?.activeContestantId &&
        Number(contestantId) !== Number(state.warmup.activeContestantId)
      ) {
        socket.emit("error:message", "Khoi dong ca nhan: chua den luot thi sinh nay.");
        return;
      }

      if (state.round === "warmup" && isCorrect !== null) {
        if (state.warmup?.mode === "common") {
          clearScheduledTimer(warmupAnswerTimers, socket.data.room.id);
          awarded = isCorrect ? rules.warmup.correctPoints : rules.warmup.commonWrongPenalty;
        } else {
          awarded = isCorrect ? rules.warmup.correctPoints : 0;
        }
      }

      if (state.round === "obstacle" && isCorrect !== null) {
        awarded = isCorrect ? (state.puzzle?.centerSelected ? rules.obstacle.centerCorrectPoints : rules.obstacle.rowCorrectPoints) : 0;
      }

      if (state.round === "speed" && isCorrect) {
        const existing = await query(
          "SELECT elapsed_ms, awarded_points FROM answer_submissions WHERE room_id = ? AND round_key = 'speed' AND question_key <=> ? AND is_correct = 1 ORDER BY elapsed_ms ASC",
          [socket.data.room.id, qKey],
        );
        const sameMs = existing.find((row) => Number(row.elapsed_ms) === Number(ms));
        if (sameMs) {
          awarded = sameMs.awarded_points;
        } else {
          const distinctTimes = [...new Set(existing.map((row) => Number(row.elapsed_ms)))];
          awarded = rules.speed.awards[Math.min(distinctTimes.length, rules.speed.awards.length - 1)];
        }
      } else if (state.round === "speed" && isCorrect === false) {
        awarded = 0;
      }

      if (state.round === "finish") {
        const activeId = Number(state.finish?.activeContestantId || 0);
        const isMainContestant = activeId && Number(contestantId) === activeId && !state.finish?.stealMode;
        const isStealContestant = state.finish?.stealMode || (state.ring?.firstContestantId && Number(contestantId) === Number(state.ring.firstContestantId) && Number(contestantId) !== activeId);
        if (isStealContestant) {
          if (state.ring?.firstContestantId && Number(contestantId) !== Number(state.ring.firstContestantId)) {
            socket.emit("error:message", "Chi thi sinh bam chuong dau tien duoc tra loi luot cuop diem.");
            return;
          }
          const existingSteal = await one(
            "SELECT id FROM answer_submissions WHERE room_id = ? AND round_key = 'finish' AND question_key <=> ? AND contestant_id <> ? LIMIT 1",
            [socket.data.room.id, qKey, activeId || 0],
          );
          if (existingSteal) {
            socket.emit("error:message", "Luot cuop diem chi ghi nhan dap an dau tien.");
            return;
          }
        }
        if (isMainContestant || (!isStealContestant && rules.finish.mainAnswerMode === "last")) {
          await query(
            "DELETE FROM answer_submissions WHERE room_id = ? AND round_key = 'finish' AND question_key <=> ? AND contestant_id = ?",
            [socket.data.room.id, qKey, contestantId],
          );
        }
      }

      await query(
        "INSERT INTO answer_submissions (room_id, contestant_id, round_key, question_key, answer_text, elapsed_ms, is_correct, awarded_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [socket.data.room.id, contestantId || null, state.round, qKey, answerText || "", ms, isCorrect, awarded],
      );
      if (contestantId && awarded !== null && Number(awarded) !== 0) {
        await applyScore(socket.data.room.id, contestantId, awarded, state.scoring.allowNegativeScore);
      }

      const postPatch = {};
      if (state.round === "warmup" && state.warmup?.mode === "common") {
        postPatch.ring = { locked: true, firstContestantId: null, lastStatus: state.ring?.lastStatus || {} };
        postPatch.warmup = { buzzedContestantId: null };
        postPatch.timer = { running: false };
      }
      if (state.round === "tie_breaker" && isCorrect && rules.tieBreaker.suddenDeath) {
        postPatch.tieBreaker = {
          armed: false,
          finished: true,
          winnerContestantId: Number(contestantId),
          foulContestantIds: state.tieBreaker?.foulContestantIds || [],
        };
        postPatch.ring = { locked: true, firstContestantId: Number(contestantId), lastStatus: state.ring?.lastStatus || {} };
        postPatch.timer = { running: false, remaining: 0 };
        postPatch.notice = `Cau hoi phu: ${contestantId} thang sudden death.`;
      }

      const fresh = await loadRoomState(socket.data.room.id);
      await patchState(io, socket.data.room, { ...postPatch, answers: fresh.answers, candidates: fresh.candidates });
    });

    on("candidate:buzz", async ({ contestantId }) => {
      if (!socket.data.room) return;
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const contestant = await authenticatedContestant(socket, contestantId);
      if (!contestant) {
        socket.emit("error:message", "Vui lòng đăng nhập bằng mã ID thí sinh hợp lệ.");
        return;
      }
      contestantId = Number(contestant.id);
      if (!isBuzzRound(state)) {
        socket.emit("error:message", "Admin chưa mở phần thi có quyền bấm chuông.");
        return;
      }
      const rules = activeRules(state);
      const ms = elapsedMs(state);
      let status = "accepted";
      const foulIds = new Set((state.tieBreaker?.foulContestantIds || []).map(Number));

      if (state.round === "tie_breaker" && rules.tieBreaker.foulOnEarlyBuzz && !state.tieBreaker?.armed) {
        status = "foul";
        foulIds.add(Number(contestantId));
      } else if (state.round === "tie_breaker" && foulIds.has(Number(contestantId))) {
        status = "foul";
      } else if (state.ring?.locked) {
        status = "locked";
      } else if (state.ring?.firstContestantId && Number(state.ring.firstContestantId) !== Number(contestantId)) {
        status = "locked";
      }

      await query(
        "INSERT INTO buzzer_events (room_id, contestant_id, round_key, elapsed_ms, status) VALUES (?, ?, ?, ?, ?)",
        [socket.data.room.id, contestantId || null, state.round, ms, status],
      );

      const patch = {
        ring: {
          firstContestantId: status === "accepted" && !state.ring?.firstContestantId ? Number(contestantId) : state.ring?.firstContestantId,
          lastStatus: { ...(state.ring?.lastStatus || {}), [contestantId]: status },
        },
      };
      if (state.round === "tie_breaker") {
        patch.tieBreaker = { foulContestantIds: [...foulIds] };
      }
      if (state.round === "warmup" && state.warmup?.mode === "common" && status === "accepted") {
        clearScheduledTimer(warmupNoBuzzTimers, socket.data.room.id);
        const seconds = Number(rules.warmup.commonAnswerSeconds || 5);
        patch.timer = startTimerPatch(seconds);
        patch.warmup = { buzzedContestantId: Number(contestantId) };
        scheduleWarmupNoAnswer(io, socket.data.room, state, contestantId, state.question?.key || null);
      }
      if (state.round === "finish" && status === "accepted") {
        const seconds = Number(rules.finish.stealWindowSeconds || 5);
        patch.finish = { stealMode: true };
        patch.timer = startTimerPatch(seconds);
      }

      await patchState(io, socket.data.room, patch);
      const fresh = await loadRoomState(socket.data.room.id);
      io.to(socket.data.room.room_code).emit("state:patch", { buzzers: fresh.buzzers });
    });

    on("admin:grade", async ({ answerId, contestantId, isCorrect, points }) => {
      if (!socket.data.room || !requireControl()) return;
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const delta = points === undefined || points === null || points === "" ? computeManualDefaultPoints(state, Boolean(isCorrect)) : Number(points || 0);
      await query("UPDATE answer_submissions SET is_correct = ?, awarded_points = ? WHERE id = ?", [
        isCorrect ? 1 : 0,
        delta,
        answerId,
      ]);
      if (contestantId && delta !== 0) {
        await applyScore(socket.data.room.id, contestantId, delta, state.scoring.allowNegativeScore);
      }

      const extraPatch = {};
      const rules = activeRules(state);
      if (state.round === "tie_breaker" && isCorrect && rules.tieBreaker.suddenDeath) {
        extraPatch.tieBreaker = {
          armed: false,
          finished: true,
          winnerContestantId: Number(contestantId),
          foulContestantIds: state.tieBreaker?.foulContestantIds || [],
        };
        extraPatch.ring = { locked: true, firstContestantId: Number(contestantId), lastStatus: state.ring?.lastStatus || {} };
        extraPatch.timer = { running: false, remaining: 0 };
        extraPatch.notice = `Cau hoi phu: ${contestantId} thang sudden death.`;
      }

      const fresh = await loadRoomState(socket.data.room.id);
      await patchState(io, socket.data.room, { ...extraPatch, candidates: fresh.candidates, answers: fresh.answers });
    });

    on("admin:score-set", async ({ contestantId, score }) => {
      if (!socket.data.room || !requireControl() || !contestantId) return;
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      const nextScore = state.scoring.allowNegativeScore ? Number(score || 0) : Math.max(0, Number(score || 0));
      await query("UPDATE contestants SET score = ? WHERE id = ? AND room_id = ?", [nextScore, contestantId, socket.data.room.id]);
      const fresh = await loadRoomState(socket.data.room.id);
      io.to(socket.data.room.room_code).emit("state:patch", { candidates: fresh.candidates });
    });

    on("admin:candidate-active", async ({ contestantId, active }) => {
      if (!socket.data.room || !requireControl() || !contestantId) return;
      await query("UPDATE contestants SET is_active = ? WHERE id = ? AND room_id = ?", [
        active ? 1 : 0,
        contestantId,
        socket.data.room.id,
      ]);
      const fresh = await loadRoomState(socket.data.room.id);
      io.to(socket.data.room.room_code).emit("state:patch", { candidates: fresh.candidates });
    });

    on("round:reset", async ({ round }) => {
      if (!socket.data.room || !requireControl()) return;
      clearScheduledTimer(warmupNoBuzzTimers, socket.data.room.id);
      clearScheduledTimer(warmupAnswerTimers, socket.data.room.id);
      await query("DELETE FROM answer_submissions WHERE room_id = ? AND round_key = ?", [socket.data.room.id, round]);
      await query("DELETE FROM buzzer_events WHERE room_id = ? AND round_key = ?", [socket.data.room.id, round]);
      const rules = activeRules(stateCache.get(socket.data.room.id) || {});
      const patch = {
        round,
        warmup: { questionIndex: 0, buzzedContestantId: null, autoAdvanceRequestedAt: null, finished: false },
        timer: stoppedTimerPatch(),
        ring: { locked: true, firstContestantId: null, lastStatus: {} },
        question: { key: null, text: "", answer: "", note: "", mediaUrl: "", visible: false, answerVisible: false, starConfirmed: false, starEnabled: false, point: 0 },
        puzzle: { selectedRow: null, revealed: [false, false, false, false, false], centerSelected: false },
        speed: { questionIndex: 1, timings: rules.speed?.questionSeconds || [20, 20, 30, 30] },
        finish: { activePackagePoints: rules.finish?.packages?.[0] || 20, stealMode: false, activeContestantId: null },
        tieBreaker: { armed: false, foulContestantIds: [], winnerContestantId: null, finished: false },
        answers: [],
        buzzers: [],
      };
      await patchState(io, socket.data.room, patch);
    });

    on("wall:submit", async ({ contestantId, cellIds }) => {
      if (!socket.data.room || !Array.isArray(cellIds) || cellIds.length !== 4) return;
      const contestant = await authenticatedContestant(socket, contestantId);
      if (!contestant) {
        socket.emit("error:message", "Vui lòng đăng nhập bằng mã ID thí sinh hợp lệ.");
        return;
      }
      contestantId = Number(contestant.id);
      const cells = await query(
        `SELECT id, group_no, group_answer
         FROM connecting_wall_cells
         WHERE id IN (${cellIds.map(() => "?").join(",")})`,
        cellIds,
      );
      if (cells.length !== 4) return;
      const firstGroup = cells[0].group_no;
      const correct = cells.every((cell) => cell.group_no === firstGroup);
      const state = stateCache.get(socket.data.room.id) || (await loadRoomState(socket.data.room.id));
      if (state.round !== "connecting_wall" || !state.timer?.running) {
        socket.emit("error:message", "Admin chưa mở quyền Tường liên kết.");
        return;
      }
      if (correct) {
        const solvedGroups = [...(state.connectingWall.solvedGroups || [])];
        if (!solvedGroups.some((group) => group.groupNo === firstGroup)) {
          solvedGroups.push({ groupNo: firstGroup, answer: cells[0].group_answer, cellIds });
          if (contestantId) {
            await applyScore(socket.data.room.id, contestantId, 10, state.scoring.allowNegativeScore);
          }
        }
        const fresh = await loadRoomState(socket.data.room.id);
        await patchState(io, socket.data.room, { connectingWall: { solvedGroups }, candidates: fresh.candidates });
      } else {
        socket.emit("wall:wrong", { cellIds });
      }
    });
  });
}

module.exports = {
  DEFAULT_STATE,
  SCREEN_ROLES,
  RULE_PRESETS,
  getDefaultRoom,
  getRoomByCode,
  loadRoomState,
  patchState,
  setupRealtime,
};
