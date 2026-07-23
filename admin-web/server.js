const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { Server } = require("socket.io");
const { authenticate, requireAuth } = require("./auth");
const { query, one } = require("./db");
const { ensureRealtimeSchema } = require("./migrations");
const { TABLES, getMeta, writableColumns, quote } = require("./tables");
const {
  exportDataset,
  importLct3Workbook,
  importStandardWorkbook,
  saveImageSequence,
  workbookFromDataset,
  workbookFromTemplate,
} = require("./excel");
const { getDefaultRoom, getRoomByCode, loadRoomState, setupRealtime } = require("./realtime");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const SEEDED_SERVER_KEYS = [
  "server-1",
  "server-2",
  "server-3",
  "server-4",
  "server-5",
  "server-6",
  "server-backup-a",
  "server-backup-b",
];

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(path.join(__dirname, "..", "assets")));
app.use("/resources", express.static(path.join(__dirname, "..", "Resources")));
app.use("/sounds", express.static(path.join(__dirname, "..", "Sounds")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "game-olympia-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);

setupRealtime(io);

function buildWhere(meta, data) {
  const clauses = meta.primaryKey.map((pk) => `${quote(pk)} = ?`);
  const values = meta.primaryKey.map((pk) => data[pk]);
  return { clause: clauses.join(" AND "), values };
}

function bodyValue(col, body, file) {
  if (col.name === "local_path" && file) {
    return `/uploads/${file.filename}`;
  }
  if (col.type === "boolean") {
    return body[col.name] === "1" || body[col.name] === "on" ? 1 : 0;
  }
  const value = body[col.name];
  if (value === undefined || value === "" || value === null) {
    if (!col.required) return null;
    if (col.type === "number") return 0;
    if (col.type === "datetime-local") return toMysqlDateTime(new Date());
    if (col.type === "select") return col.options?.[0] ?? "";
    return "";
  }
  if (col.type === "number") return Number(value || 0);
  if (col.type === "datetime-local") return toMysqlDateTime(coerceDateTime(value, new Date()));
  return value;
}

async function dashboardCounts() {
  const entries = await Promise.all(
    Object.entries(TABLES).map(async ([key, meta]) => {
      const row = await one(`SELECT COUNT(*) AS count FROM ${quote(meta.table)}`);
      return [key, row.count];
    }),
  );
  return Object.fromEntries(entries);
}

function randomCode(prefix = "ROOM") {
  return `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toMysqlDateTime(date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-") + " " + [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join(":");
}

function coerceDateTime(value, fallbackDate = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value || "").trim();
  if (!raw) return fallbackDate;
  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
}

function normalizeSchedule(body = {}) {
  const now = new Date();
  const scheduledFrom = body.now === "1" ? now : coerceDateTime(body.scheduled_from, now);
  let scheduledTo = coerceDateTime(body.scheduled_to, addHours(scheduledFrom, 2));
  if (scheduledTo.getTime() <= scheduledFrom.getTime()) scheduledTo = addHours(scheduledFrom, 2);
  return {
    scheduledFrom: toMysqlDateTime(scheduledFrom),
    scheduledTo: toMysqlDateTime(scheduledTo),
  };
}

function textOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeServerSlotId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function resolveServerSlot(serverSlotId, fallbackName = "") {
  const id = normalizeServerSlotId(serverSlotId);
  if (id) return one("SELECT * FROM server_slots WHERE id = ?", [id]);

  const name = String(fallbackName || "").trim();
  if (name) {
    const byName = await one(
      "SELECT * FROM server_slots WHERE display_name = ? OR server_key = ? ORDER BY id ASC LIMIT 1",
      [name, name],
    );
    if (byName) return byName;
  }

  return one("SELECT * FROM server_slots ORDER BY is_primary DESC, sort_order ASC, id ASC LIMIT 1");
}

async function serverSlotHasActiveRoom(serverSlotId, ignoreRoomId = null) {
  const id = normalizeServerSlotId(serverSlotId);
  if (!id) return false;
  const params = [id];
  const ignoreClause = ignoreRoomId ? " AND id <> ?" : "";
  if (ignoreRoomId) params.push(ignoreRoomId);
  const activeRoom = await one(
    `SELECT id
     FROM match_rooms
     WHERE server_slot_id = ?
       AND status IN ('scheduled', 'live', 'paused')${ignoreClause}
     LIMIT 1`,
    params,
  );
  return Boolean(activeRoom);
}

async function syncServerSlotStatus(serverSlotId) {
  const id = normalizeServerSlotId(serverSlotId);
  if (!id) return;
  const isBooked = await serverSlotHasActiveRoom(id);
  await query(
    "UPDATE server_slots SET status = ? WHERE id = ? AND status <> 'maintenance'",
    [isBooked ? "booked" : "available", id],
  );
}

async function listControlServerSlots() {
  const seededKeyPlaceholders = SEEDED_SERVER_KEYS.map(() => "?").join(", ");
  return query(
    `SELECT s.*
     FROM server_slots s
     WHERE NOT (
       s.server_key IN (${seededKeyPlaceholders})
       AND EXISTS (
         SELECT 1
         FROM server_slots local_slots
         WHERE local_slots.id <> s.id
           AND local_slots.sort_order = s.sort_order
           AND local_slots.server_key NOT IN (${seededKeyPlaceholders})
       )
     )
     ORDER BY s.sort_order ASC, s.id ASC`,
    SEEDED_SERVER_KEYS.concat(SEEDED_SERVER_KEYS),
  );
}

function normalizeRoomBody(body) {
  const roomCode = textOrDefault(body.room_code, randomCode("ROOM"));
  const schedule = normalizeSchedule(body);
  body.question_set_id = positiveNumber(body.question_set_id, 1);
  body.server_slot_id = normalizeServerSlotId(body.server_slot_id);
  body.server_name = textOrDefault(body.server_name, "Server 1");
  body.purpose = textOrDefault(body.purpose, "Test");
  body.room_code = roomCode;
  body.quick_token = textOrDefault(body.quick_token, `${roomCode}-QUICK`);
  body.login_password = textOrDefault(body.login_password, randomCode("PASS"));
  body.recovery_password = textOrDefault(body.recovery_password, randomCode("RECOVER"));
  body.status = textOrDefault(body.status, "scheduled");
  body.scheduled_from = schedule.scheduledFrom;
  body.scheduled_to = schedule.scheduledTo;
}

function normalizeContestantBody(body, fallback = {}) {
  body.room_id = positiveNumber(body.room_id, fallback.room_id || 1);
  body.seat_no = positiveNumber(body.seat_no, fallback.seat_no || 0);
  body.login_code = textOrDefault(body.login_code, fallback.login_code || String(body.seat_no || fallback.id || ""));
  body.display_name = textOrDefault(body.display_name, fallback.display_name || "Thí sinh");
  body.school = textOrDefault(body.school, fallback.school || "");
  body.avatar_url = textOrDefault(body.avatar_url, fallback.avatar_url || "");
  body.score = Number.isFinite(Number(body.score)) ? Number(body.score) : Number(fallback.score || 0);
  body.is_active = body.is_active === "0" || body.is_active === 0 ? 0 : 1;
}

function normalizeAdminTableBody(tableKey, body) {
  if (tableKey === "rooms") normalizeRoomBody(body);
  if (tableKey === "contestants") normalizeContestantBody(body);
  if (tableKey === "question-sets") {
    body.set_code = textOrDefault(body.set_code, randomCode("SET"));
    body.name = textOrDefault(body.name, "Bộ đề mới");
    body.access_password = textOrDefault(body.access_password, "");
    body.visibility = textOrDefault(body.visibility, "private");
    body.is_active = body.is_active === "0" ? 0 : 1;
  }
}

function publicBase(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function questionSetIdFromRoom(room) {
  const parsed = Number(room?.question_set_id || 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

async function generateContestantLoginCode(roomId, seatNo) {
  const preferred = String(seatNo || "").trim();
  if (preferred) {
    const existing = await one("SELECT id FROM contestants WHERE room_id = ? AND login_code = ?", [roomId, preferred]);
    if (!existing) return preferred;
  }
  for (let i = 0; i < 20; i += 1) {
    const code = crypto.randomBytes(2).toString("hex").toUpperCase();
    const existing = await one("SELECT id FROM contestants WHERE room_id = ? AND login_code = ?", [roomId, code]);
    if (!existing) return code;
  }
  return randomCode("TS");
}

async function nextContestantSeatNo(roomId) {
  const row = await one("SELECT COALESCE(MAX(seat_no), 0) + 1 AS next_seat FROM contestants WHERE room_id = ?", [roomId]);
  return Number(row?.next_seat || 1);
}

async function emitCandidatesForRoom(room) {
  const fresh = await loadRoomState(room.id);
  io.to(room.room_code).emit("state:patch", { candidates: fresh.candidates });
}

app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/dashboard");
});

app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

app.post("/login", async (req, res, next) => {
  try {
    const user = await authenticate(req.body.username || "", req.body.password || "");
    if (!user) return res.status(401).render("login", { error: "Sai tài khoản hoặc mật khẩu." });
    req.session.user = user;
    res.redirect("/dashboard");
  } catch (err) {
    next(err);
  }
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.get("/dashboard", requireAuth, async (req, res, next) => {
  try {
    const counts = await dashboardCounts();
    const rooms = await query("SELECT * FROM match_rooms ORDER BY id DESC LIMIT 6");
    const events = await query("SELECT * FROM contestant_events ORDER BY id DESC LIMIT 10");
    res.render("dashboard", {
      user: req.session.user,
      tables: TABLES,
      counts,
      rooms,
      events,
      current: "dashboard",
    });
  } catch (err) {
    next(err);
  }
});

app.get("/technician", requireAuth, async (req, res, next) => {
  try {
    const room = await getDefaultRoom();
    res.redirect(`/technician/${room.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.get("/technician/:roomCode", requireAuth, async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    const state = await loadRoomState(room.id);
    const questionSetId = questionSetIdFromRoom(room);
    const servers = await listControlServerSlots();
    const serverSlot = await resolveServerSlot(room.server_slot_id, room.server_name);
    const rooms = await query(
      `SELECT r.*, qs.set_code AS question_set_code, qs.name AS question_set_name
       FROM match_rooms r
       LEFT JOIN question_sets qs ON qs.id = r.question_set_id
       WHERE (r.server_slot_id <=> ? OR r.server_name = ?)
       ORDER BY r.id DESC
       LIMIT 20`,
      [serverSlot?.id || null, room.server_name],
    );
    const questionSets = await query("SELECT id, set_code, name, visibility, is_active FROM question_sets WHERE is_active = 1 ORDER BY id ASC");
    const contestants = await query("SELECT * FROM contestants WHERE room_id = ? ORDER BY seat_no ASC, id ASC", [room.id]);
    const media = await query("SELECT * FROM media_assets WHERE question_set_id = ? OR question_set_id IS NULL ORDER BY id DESC LIMIT 40", [questionSetId]);
    const speedQuestions = await query("SELECT stt, question FROM speed_questions WHERE question_set_id = ? ORDER BY stt ASC", [questionSetId]);
    const walls = await query("SELECT * FROM connecting_wall_sets WHERE question_set_id = ? ORDER BY id DESC LIMIT 20", [questionSetId]);
    res.render("technician", {
      user: req.session.user,
      tables: TABLES,
      current: "technician",
      room,
      rooms,
      servers,
      serverSlot,
      questionSets,
      state,
      contestants,
      media,
      speedQuestions,
      walls,
      questionSetId,
      baseUrl: publicBase(req),
    });
  } catch (err) {
    next(err);
  }
});

app.get("/candidate/:roomCode/:mode?", async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    const contestants = await query(
      "SELECT id, display_name, school, seat_no FROM contestants WHERE room_id = ? AND is_active = 1 ORDER BY seat_no ASC, id ASC",
      [room.id],
    );
    res.render("candidate", {
      room,
      contestants,
      mode: req.params.mode === "olympia" ? "olympia" : "default",
    });
  } catch (err) {
    next(err);
  }
});

app.get("/quick/:token/:mode?", async (req, res, next) => {
  try {
    const room = await one("SELECT room_code FROM match_rooms WHERE quick_token = ? OR room_code = ?", [req.params.token, req.params.token]);
    if (!room) return res.status(404).send("Mã chọn server/phòng không hợp lệ.");
    res.redirect(`/candidate/${room.room_code}/${req.params.mode === "olympia" ? "olympia" : "default"}?quick=1`);
  } catch (err) {
    next(err);
  }
});

app.get("/projector/:roomCode", async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    res.render("projector", { room, overlay: false });
  } catch (err) {
    next(err);
  }
});

app.get("/overlay/:roomCode", async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    res.render("projector", { room, overlay: true });
  } catch (err) {
    next(err);
  }
});

app.get("/host/:roomCode", async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    res.render("host", { room });
  } catch (err) {
    next(err);
  }
});

app.get("/scoreboard/:roomCode", async (req, res, next) => {
  try {
    const room = await getRoomByCode(req.params.roomCode);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    res.render("scoreboard", { room });
  } catch (err) {
    next(err);
  }
});

app.post("/rooms/book", requireAuth, async (req, res, next) => {
  try {
    const serverSlot = await resolveServerSlot(req.body.server_slot_id, req.body.server_name);
    if (!serverSlot) return res.status(400).send("Vui lòng chọn server trước khi tạo phòng.");
    if (serverSlot.status === "maintenance") return res.status(409).send("Server đang bảo trì, không thể tạo phòng.");
    if (await serverSlotHasActiveRoom(serverSlot.id)) {
      return res.status(409).send("Server này đang có phòng scheduled/live/paused. Hãy chọn server khác hoặc kết thúc phòng cũ trước.");
    }
    req.body.server_slot_id = serverSlot.id;
    req.body.server_name = serverSlot.display_name;
    normalizeRoomBody(req.body);
    await query(
      `INSERT INTO match_rooms
       (question_set_id, server_slot_id, server_name, purpose, room_code, quick_token, login_password, recovery_password, status, scheduled_from, scheduled_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)`,
      [
        Number(req.body.question_set_id),
        req.body.server_slot_id,
        req.body.server_name,
        req.body.purpose,
        req.body.room_code,
        req.body.quick_token,
        req.body.login_password,
        req.body.recovery_password,
        req.body.scheduled_from,
        req.body.scheduled_to,
      ],
    );
    const room = await one("SELECT * FROM match_rooms WHERE room_code = ?", [req.body.room_code]);
    await query("INSERT IGNORE INTO room_settings (room_id) VALUES (?)", [room.id]);
    await syncServerSlotStatus(serverSlot.id);
    res.redirect(`/technician/${req.body.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/rooms/:id/question-set", requireAuth, async (req, res, next) => {
  try {
    const questionSetId = Number(req.body.question_set_id || 1);
    const room = await one("SELECT * FROM match_rooms WHERE id = ?", [req.params.id]);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    const questionSet = await one("SELECT id FROM question_sets WHERE id = ? AND is_active = 1", [questionSetId]);
    if (!questionSet) return res.status(400).send("Bộ đề không hợp lệ hoặc đang bị tắt.");
    await query("UPDATE match_rooms SET question_set_id = ? WHERE id = ?", [questionSetId, req.params.id]);
    res.redirect(`/technician/${room.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/rooms/:id/status", requireAuth, async (req, res, next) => {
  try {
    const status = ["draft", "scheduled", "live", "paused", "finished", "cancelled"].includes(req.body.status) ? req.body.status : "scheduled";
    const room = await one("SELECT * FROM match_rooms WHERE id = ?", [req.params.id]);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    await query("UPDATE match_rooms SET status = ? WHERE id = ?", [status, req.params.id]);
    await syncServerSlotStatus(room.server_slot_id);
    io.to(room.room_code).emit("state:patch", { notice: `Trạng thái phòng: ${status}` });
    res.redirect(`/technician/${room.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/rooms/:id/contestants", requireAuth, async (req, res, next) => {
  try {
    const room = await one("SELECT * FROM match_rooms WHERE id = ?", [req.params.id]);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    const seatNo = req.body.seat_no ? Number(req.body.seat_no) : await nextContestantSeatNo(room.id);
    const loginCode = String(req.body.login_code || "").trim() || (await generateContestantLoginCode(room.id, seatNo));
    normalizeContestantBody(req.body, { room_id: room.id, seat_no: seatNo, login_code: loginCode });
    await query(
      `INSERT INTO contestants (room_id, login_code, display_name, school, avatar_url, seat_no, score, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.body.room_id,
        req.body.login_code,
        req.body.display_name,
        req.body.school,
        req.body.avatar_url,
        req.body.seat_no,
        req.body.score,
        req.body.is_active,
      ],
    );
    await emitCandidatesForRoom(room);
    res.redirect(`/technician/${room.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/contestants/:id/update", requireAuth, async (req, res, next) => {
  try {
    const contestant = await one(
      `SELECT c.*, r.room_code
       FROM contestants c
       JOIN match_rooms r ON r.id = c.room_id
       WHERE c.id = ?`,
      [req.params.id],
    );
    if (!contestant) return res.status(404).send("Không tìm thấy thí sinh.");
    normalizeContestantBody(req.body, contestant);
    await query(
      `UPDATE contestants
       SET login_code = ?,
           display_name = ?,
           school = ?,
           avatar_url = ?,
           seat_no = ?,
           score = ?,
           is_active = ?
       WHERE id = ?`,
      [
        req.body.login_code,
        req.body.display_name,
        req.body.school,
        req.body.avatar_url,
        req.body.seat_no,
        req.body.score,
        req.body.is_active,
        req.params.id,
      ],
    );
    await emitCandidatesForRoom({ id: contestant.room_id, room_code: contestant.room_code });
    res.redirect(`/technician/${contestant.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/contestants/:id/delete", requireAuth, async (req, res, next) => {
  try {
    const contestant = await one(
      `SELECT c.room_id, r.room_code
       FROM contestants c
       JOIN match_rooms r ON r.id = c.room_id
       WHERE c.id = ?`,
      [req.params.id],
    );
    if (!contestant) return res.status(404).send("Không tìm thấy thí sinh.");
    await query("DELETE FROM contestants WHERE id = ?", [req.params.id]);
    await emitCandidatesForRoom({ id: contestant.room_id, room_code: contestant.room_code });
    res.redirect(`/technician/${contestant.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/rooms/:id/unbook", requireAuth, async (req, res, next) => {
  try {
    const room = await one("SELECT * FROM match_rooms WHERE id = ?", [req.params.id]);
    if (!room) return res.status(404).send("Không tìm thấy phòng.");
    const scheduled = room.scheduled_from ? new Date(room.scheduled_from).getTime() : Date.now();
    if (Date.now() > scheduled - 3 * 60 * 1000 && room.status !== "draft") {
      return res.status(400).send("Chỉ được hủy trước giờ bắt đầu tối thiểu 3 phút.");
    }
    await query("UPDATE match_rooms SET status = 'cancelled' WHERE id = ?", [req.params.id]);
    await syncServerSlotStatus(room.server_slot_id);
    res.redirect("/technician");
  } catch (err) {
    next(err);
  }
});

app.post("/rooms/:id/recover", async (req, res, next) => {
  try {
    const room = await one("SELECT * FROM match_rooms WHERE id = ? AND recovery_password = ?", [req.params.id, req.body.recovery_password || ""]);
    if (!room) return res.status(403).send("Mật khẩu cấp 2 không đúng.");
    await query("UPDATE match_rooms SET login_password = ? WHERE id = ?", [req.body.login_password || randomCode("PASS"), req.params.id]);
    res.redirect(`/technician/${room.room_code}`);
  } catch (err) {
    next(err);
  }
});

app.post("/media/upload", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Thiếu file." });
    const url = `/uploads/${req.file.filename}`;
    await query(
      "INSERT INTO media_assets (question_set_id, title, media_type, local_path, duration_seconds) VALUES (?, ?, ?, ?, ?)",
      [
        positiveNumber(req.body.question_set_id, 1),
        textOrDefault(req.body.title, req.file.originalname),
        textOrDefault(req.body.media_type, "image"),
        url,
        Number.isFinite(Number(req.body.duration_seconds)) ? Number(req.body.duration_seconds) : 0,
      ],
    );
    res.json({ url, absoluteUrl: `${publicBase(req)}${url}` });
  } catch (err) {
    next(err);
  }
});

app.post("/api/speed-sequence", requireAuth, async (req, res, next) => {
  try {
    const questionSetId = Number(req.body.question_set_id || 1);
    await saveImageSequence(questionSetId, Number(req.body.speed_stt), req.body.urls || "", req.body.durations || "");
    const rows = await query(
      "SELECT * FROM speed_media_sequences WHERE question_set_id = ? AND speed_stt = ? ORDER BY sort_order",
      [questionSetId, Number(req.body.speed_stt)],
    );
    res.json({ ok: true, rows });
  } catch (err) {
    next(err);
  }
});

app.get("/api/wall/:id", requireAuth, async (req, res, next) => {
  try {
    const wall = await one("SELECT id, title, time_limit_seconds FROM connecting_wall_sets WHERE id = ?", [req.params.id]);
    if (!wall) return res.status(404).json({ error: "Không tìm thấy wall." });
    const cells = await query(
      "SELECT id, word_text FROM connecting_wall_cells WHERE wall_id = ? ORDER BY sort_order ASC, id ASC",
      [req.params.id],
    );
    res.json({ wall, cells });
  } catch (err) {
    next(err);
  }
});

app.get("/templates/:format.xlsx", requireAuth, async (req, res, next) => {
  try {
    const format = req.params.format === "lct3" ? "lct3" : "q2t_standard";
    const workbook = await workbookFromTemplate(format);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${format}_template.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

app.get("/admin/export.json", requireAuth, async (req, res, next) => {
  try {
    const dataset = await exportDataset();
    res.setHeader("Content-Disposition", "attachment; filename=\"game_olympia_export.json\"");
    res.json(dataset);
  } catch (err) {
    next(err);
  }
});

app.get("/admin/export.xlsx", requireAuth, async (req, res, next) => {
  try {
    const dataset = await exportDataset();
    const workbook = await workbookFromDataset(dataset);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=\"game_olympia_export.xlsx\"");
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

app.post("/admin/import", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).send("Thiếu file Excel.");
    const format = req.body.format === "lct3" ? "lct3" : "q2t_standard";
    const questionSetId = Number(req.body.question_set_id || 1);
    const imported = format === "lct3" ? await importLct3Workbook(req.file.path, questionSetId) : await importStandardWorkbook(req.file.path, questionSetId);
    await query(
      "INSERT INTO import_jobs (file_name, format_key, status, message) VALUES (?, ?, 'imported', ?)",
      [req.file.originalname, format, `Imported ${imported} rows into question_set_id=${questionSetId}`],
    );
    res.redirect("/admin/question-sets");
  } catch (err) {
    if (req.file) {
      await query(
        "INSERT INTO import_jobs (file_name, format_key, status, message) VALUES (?, ?, 'failed', ?)",
        [req.file.originalname, req.body.format === "lct3" ? "lct3" : "q2t_standard", err.message],
      ).catch(() => {});
    }
    next(err);
  }
});

app.get("/admin/:table", requireAuth, async (req, res, next) => {
  try {
    const meta = getMeta(req.params.table);
    if (!meta) return res.status(404).send("Unknown table");
    const rows = await query(`SELECT * FROM ${quote(meta.table)} ORDER BY ${meta.orderBy}`);
    res.render("table", { user: req.session.user, tables: TABLES, current: req.params.table, key: req.params.table, meta, rows });
  } catch (err) {
    next(err);
  }
});

app.get("/admin/:table/new", requireAuth, (req, res) => {
  const meta = getMeta(req.params.table);
  if (!meta) return res.status(404).send("Unknown table");
  res.render("form", {
    user: req.session.user,
    tables: TABLES,
    current: req.params.table,
    key: req.params.table,
    meta,
    row: {},
    mode: "insert",
  });
});

app.get("/admin/:table/edit", requireAuth, async (req, res, next) => {
  try {
    const meta = getMeta(req.params.table);
    if (!meta) return res.status(404).send("Unknown table");
    const where = buildWhere(meta, req.query);
    const row = await one(`SELECT * FROM ${quote(meta.table)} WHERE ${where.clause}`, where.values);
    if (!row) return res.status(404).send("Không tìm thấy bản ghi.");
    res.render("form", {
      user: req.session.user,
      tables: TABLES,
      current: req.params.table,
      key: req.params.table,
      meta,
      row,
      mode: "update",
    });
  } catch (err) {
    next(err);
  }
});

app.post("/admin/:table", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const meta = getMeta(req.params.table);
    if (!meta) return res.status(404).send("Unknown table");
    normalizeAdminTableBody(req.params.table, req.body);
    const cols = writableColumns(meta, "insert");
    const names = cols.map((col) => col.name);
    const values = cols.map((col) => bodyValue(col, req.body, req.file));
    const placeholders = cols.map(() => "?").join(", ");
    const result = await query(
      `INSERT INTO ${quote(meta.table)} (${names.map(quote).join(", ")}) VALUES (${placeholders})`,
      values,
    );
    if (req.params.table === "rooms" && result.insertId) {
      const room = await one("SELECT server_slot_id FROM match_rooms WHERE id = ?", [result.insertId]);
      await syncServerSlotStatus(room?.server_slot_id);
    }
    res.redirect(`/admin/${req.params.table}`);
  } catch (err) {
    next(err);
  }
});

app.post("/admin/:table/update", requireAuth, upload.single("file"), async (req, res, next) => {
  try {
    const meta = getMeta(req.params.table);
    if (!meta) return res.status(404).send("Unknown table");
    normalizeAdminTableBody(req.params.table, req.body);
    const cols = writableColumns(meta, "update").filter((col) => !meta.primaryKey.includes(col.name));
    const assignments = cols.map((col) => `${quote(col.name)} = ?`);
    const values = cols.map((col) => bodyValue(col, req.body, req.file));
    const where = buildWhere(meta, req.body);
    const previousRoom = req.params.table === "rooms"
      ? await one(`SELECT server_slot_id FROM ${quote(meta.table)} WHERE ${where.clause}`, where.values)
      : null;
    await query(
      `UPDATE ${quote(meta.table)} SET ${assignments.join(", ")} WHERE ${where.clause}`,
      values.concat(where.values),
    );
    if (req.params.table === "rooms") {
      const currentRoom = await one(`SELECT server_slot_id FROM ${quote(meta.table)} WHERE ${where.clause}`, where.values);
      const serverSlotIds = new Set([previousRoom?.server_slot_id, currentRoom?.server_slot_id].filter(Boolean));
      for (const serverSlotId of serverSlotIds) await syncServerSlotStatus(serverSlotId);
    }
    res.redirect(`/admin/${req.params.table}`);
  } catch (err) {
    next(err);
  }
});

app.post("/admin/:table/delete", requireAuth, async (req, res, next) => {
  try {
    const meta = getMeta(req.params.table);
    if (!meta) return res.status(404).send("Unknown table");
    const where = buildWhere(meta, req.body);
    const deletingRoom = req.params.table === "rooms"
      ? await one(`SELECT server_slot_id FROM ${quote(meta.table)} WHERE ${where.clause}`, where.values)
      : null;
    await query(`DELETE FROM ${quote(meta.table)} WHERE ${where.clause}`, where.values);
    if (req.params.table === "rooms") await syncServerSlotStatus(deletingRoom?.server_slot_id);
    res.redirect(`/admin/${req.params.table}`);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("error", {
    user: req.session.user,
    tables: TABLES,
    current: "",
    error: err,
  });
});

const port = Number(process.env.ADMIN_WEB_PORT || 3000);
ensureRealtimeSchema()
  .then(() => {
    server.listen(port, () => {
      console.log(`Game Olympia admin web running at http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Cannot initialize realtime schema", err);
    process.exitCode = 1;
  });
