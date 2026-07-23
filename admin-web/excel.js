const ExcelJS = require("exceljs");
const { query } = require("./db");

function normalizeQuestionSetId(questionSetId) {
  const parsed = Number(questionSetId || 1);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function cellValue(row, names) {
  for (const name of names) {
    const index = row.headerMap[name.toLowerCase()];
    if (index) {
      const value = row.values[index];
      if (value && typeof value === "object" && "text" in value) return value.text;
      if (value && typeof value === "object" && "hyperlink" in value) return value.hyperlink;
      return value ?? null;
    }
  }
  return null;
}

function readRows(sheet) {
  if (!sheet) return [];
  const headers = {};
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    headers[String(cell.value || "").trim().toLowerCase()] = colNumber;
  });
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.headerMap = headers;
    if (row.values.some((value, index) => index > 0 && value !== null && value !== undefined && value !== "")) {
      rows.push(row);
    }
  });
  return rows;
}

async function workbookFromTemplate(format) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Game Olympia Admin";
  if (format === "lct3") {
    const sheet = workbook.addWorksheet("LCT3");
    sheet.addRow(["Round", "STT", "Question", "AnswerA", "AnswerB", "AnswerC", "AnswerD", "Answer", "Point", "Image", "Audio", "Video", "Group"]);
    sheet.addRow(["warmup", 1, "Câu đúng/sai mẫu", "", "", "", "", "TRUE", "", "", "", "", ""]);
    sheet.addRow(["speed", 1, "Câu tăng tốc mẫu", "A", "B", "C", "D", "A", "", "https://example.com/image1.jpg", "", "", ""]);
    sheet.addRow(["connecting_wall", 1, "Từ khóa 1", "", "", "", "", "Nhóm A", "", "", "", "", 1]);
    sheet.columns.forEach((col) => { col.width = 18; });
    return workbook;
  }

  const start = workbook.addWorksheet("Start");
  start.addRow(["STT", "Question", "Answer", "Audio"]);
  start.addRow([1, "Câu đúng/sai mẫu", "TRUE", ""]);

  const obstacle = workbook.addWorksheet("Obstacle");
  obstacle.addRow(["STT", "RowNo", "Question", "Answer", "CellCount", "Image"]);
  obstacle.addRow([1, 0, "Câu hỏi từ khóa", "tukhoa", 6, "https://example.com/puzzle.jpg"]);
  obstacle.addRow([1, 1, "Hàng ngang 1", "hangmot", 7, ""]);

  const speed = workbook.addWorksheet("Speed");
  speed.addRow(["STT", "Question", "AnswerA", "AnswerB", "AnswerC", "AnswerD", "Answer", "ImageSequence", "Durations"]);
  speed.addRow([1, "Câu tăng tốc mẫu", "A", "B", "C", "D", "A", "https://example.com/1.jpg\nhttps://example.com/2.jpg", "5\n5"]);

  const finish = workbook.addWorksheet("Finish");
  finish.addRow(["STT", "Question", "AnswerA", "AnswerB", "AnswerC", "AnswerD", "Answer", "Point"]);
  finish.addRow([1, "Câu về đích mẫu", "A", "B", "C", "D", "A", 20]);

  const tie = workbook.addWorksheet("TieBreaker");
  tie.addRow(["STT", "Question", "Answer", "Media"]);
  tie.addRow([1, "Câu hỏi phụ mẫu", "dap an", ""]);

  const media = workbook.addWorksheet("Media");
  media.addRow(["Title", "Type", "URL", "DurationSeconds"]);
  media.addRow(["Nhạc hiệu", "audio", "https://example.com/jingle.mp3", 10]);

  workbook.worksheets.forEach((sheet) => sheet.columns.forEach((col) => { col.width = 22; }));
  return workbook;
}

async function exportDataset() {
  const tables = {
    warmup_questions: "SELECT * FROM warmup_questions ORDER BY question_set_id, stt",
    obstacle_keys: "SELECT * FROM obstacle_keys ORDER BY question_set_id, stt",
    obstacle_rows: "SELECT * FROM obstacle_rows ORDER BY question_set_id, stt, row_no",
    speed_questions: "SELECT * FROM speed_questions ORDER BY question_set_id, stt",
    speed_media_sequences: "SELECT * FROM speed_media_sequences ORDER BY question_set_id, speed_stt, sort_order",
    finish_questions: "SELECT * FROM finish_questions ORDER BY question_set_id, point, stt",
    tie_breaker_questions: "SELECT * FROM tie_breaker_questions ORDER BY question_set_id, stt",
    media_assets: "SELECT * FROM media_assets ORDER BY id",
  };
  const result = {};
  for (const [name, sql] of Object.entries(tables)) {
    result[name] = await query(sql);
  }
  return result;
}

async function workbookFromDataset(dataset) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Game Olympia Admin";
  Object.entries(dataset).forEach(([table, rows]) => {
    const sheet = workbook.addWorksheet(table.slice(0, 31));
    const headers = rows[0] ? Object.keys(rows[0]) : ["empty"];
    sheet.addRow(headers);
    rows.forEach((row) => sheet.addRow(headers.map((key) => row[key])));
    sheet.columns.forEach((col) => { col.width = 20; });
  });
  return workbook;
}

async function importStandardWorkbook(filePath, questionSetId = 1) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const setId = normalizeQuestionSetId(questionSetId);
  let imported = 0;

  for (const row of readRows(workbook.getWorksheet("Start") || workbook.getWorksheet("Warmup"))) {
    await query(
      "REPLACE INTO warmup_questions (question_set_id, stt, question, answer) VALUES (?, ?, ?, ?)",
      [setId, Number(cellValue(row, ["STT"]) || 0), cellValue(row, ["Question"]), String(cellValue(row, ["Answer"]) || "").toLowerCase().startsWith("t") ? 1 : 0],
    );
    imported += 1;
  }

  for (const row of readRows(workbook.getWorksheet("Obstacle") || workbook.getWorksheet("VCNV"))) {
    const rowNo = Number(cellValue(row, ["RowNo", "Row"]) || 0);
    const stt = Number(cellValue(row, ["STT"]) || 0);
    if (rowNo === 0) {
      await query(
        "REPLACE INTO obstacle_keys (question_set_id, stt, question, answer, cell_count, image_path) VALUES (?, ?, ?, ?, ?, ?)",
        [setId, stt, cellValue(row, ["Question"]), cellValue(row, ["Answer"]), Number(cellValue(row, ["CellCount", "SoOHN"]) || 0), cellValue(row, ["Image", "Path"])],
      );
    } else {
      await query(
        "REPLACE INTO obstacle_rows (question_set_id, stt, row_no, cell_count, question, answer) VALUES (?, ?, ?, ?, ?, ?)",
        [setId, stt, rowNo, Number(cellValue(row, ["CellCount", "SoOHN"]) || 0), cellValue(row, ["Question"]), cellValue(row, ["Answer"])],
      );
    }
    imported += 1;
  }

  for (const row of readRows(workbook.getWorksheet("Speed") || workbook.getWorksheet("TangToc"))) {
    const stt = Number(cellValue(row, ["STT"]) || 0);
    await query(
      "REPLACE INTO speed_questions (question_set_id, stt, question, answer_a, answer_b, answer_c, answer_d, answer, media_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        setId,
        stt,
        cellValue(row, ["Question"]),
        cellValue(row, ["AnswerA"]),
        cellValue(row, ["AnswerB"]),
        cellValue(row, ["AnswerC"]),
        cellValue(row, ["AnswerD"]),
        cellValue(row, ["Answer"]),
        String(cellValue(row, ["ImageSequence", "Image"]) || "").split(/\r?\n/)[0] || null,
      ],
    );
    await saveImageSequence(setId, stt, String(cellValue(row, ["ImageSequence", "Images"]) || ""), String(cellValue(row, ["Durations"]) || ""));
    imported += 1;
  }

  for (const row of readRows(workbook.getWorksheet("Finish") || workbook.getWorksheet("VeDich"))) {
    await query(
      "REPLACE INTO finish_questions (question_set_id, stt, question, answer_a, answer_b, answer_c, answer_d, answer, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        setId,
        Number(cellValue(row, ["STT"]) || 0),
        cellValue(row, ["Question"]),
        cellValue(row, ["AnswerA"]),
        cellValue(row, ["AnswerB"]),
        cellValue(row, ["AnswerC"]),
        cellValue(row, ["AnswerD"]),
        cellValue(row, ["Answer"]),
        Number(cellValue(row, ["Point"]) || 20),
      ],
    );
    imported += 1;
  }

  for (const row of readRows(workbook.getWorksheet("TieBreaker") || workbook.getWorksheet("Tie"))) {
    await query(
      "INSERT INTO tie_breaker_questions (question_set_id, question, answer, media_path) VALUES (?, ?, ?, ?)",
      [setId, cellValue(row, ["Question"]), cellValue(row, ["Answer"]), cellValue(row, ["Media"])],
    );
    imported += 1;
  }

  return imported;
}

async function importLct3Workbook(filePath, questionSetId = 1) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet("LCT3") || workbook.worksheets[0];
  const setId = normalizeQuestionSetId(questionSetId);
  let imported = 0;
  for (const row of readRows(sheet)) {
    const round = String(cellValue(row, ["Round", "PhanThi"]) || "").toLowerCase();
    const stt = Number(cellValue(row, ["STT"]) || 0);
    if (round === "warmup" || round === "start") {
      await query("REPLACE INTO warmup_questions (question_set_id, stt, question, answer) VALUES (?, ?, ?, ?)", [
        setId,
        stt,
        cellValue(row, ["Question"]),
        String(cellValue(row, ["Answer"]) || "").toLowerCase().startsWith("t") ? 1 : 0,
      ]);
      imported += 1;
    } else if (round === "speed" || round === "acceleration") {
      await query(
        "REPLACE INTO speed_questions (question_set_id, stt, question, answer_a, answer_b, answer_c, answer_d, answer, media_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          setId,
          stt,
          cellValue(row, ["Question"]),
          cellValue(row, ["AnswerA"]),
          cellValue(row, ["AnswerB"]),
          cellValue(row, ["AnswerC"]),
          cellValue(row, ["AnswerD"]),
          cellValue(row, ["Answer"]),
          cellValue(row, ["Image", "Video"]),
        ],
      );
      imported += 1;
    } else if (round === "finish") {
      await query(
        "REPLACE INTO finish_questions (question_set_id, stt, question, answer_a, answer_b, answer_c, answer_d, answer, point) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          setId,
          stt,
          cellValue(row, ["Question"]),
          cellValue(row, ["AnswerA"]),
          cellValue(row, ["AnswerB"]),
          cellValue(row, ["AnswerC"]),
          cellValue(row, ["AnswerD"]),
          cellValue(row, ["Answer"]),
          Number(cellValue(row, ["Point"]) || 20),
        ],
      );
      imported += 1;
    } else if (round === "connecting_wall") {
      let wallId = Number(cellValue(row, ["WallID"]) || 0);
      if (!wallId) {
        const result = await query("INSERT INTO connecting_wall_sets (question_set_id, title) VALUES (?, ?)", [setId, `LCT3 Wall ${Date.now()}`]);
        wallId = result.insertId;
      }
      await query(
        "INSERT INTO connecting_wall_cells (wall_id, group_no, word_text, group_answer, sort_order) VALUES (?, ?, ?, ?, ?)",
        [
          wallId,
          Number(cellValue(row, ["Group"]) || 1),
          cellValue(row, ["Question", "Word"]),
          cellValue(row, ["Answer"]),
          stt,
        ],
      );
      imported += 1;
    }
  }
  return imported;
}

async function saveImageSequence(questionSetId, speedStt, rawUrls, rawDurations) {
  const setId = normalizeQuestionSetId(questionSetId);
  const urls = rawUrls.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
  if (!urls.length) return;
  const durations = rawDurations.split(/\r?\n|,/).map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value > 0);
  const fallback = durations.length ? durations[0] : Math.max(1, Math.round(30 / urls.length));
  await query("DELETE FROM speed_media_sequences WHERE question_set_id = ? AND speed_stt = ?", [setId, speedStt]);
  for (let i = 0; i < urls.length; i += 1) {
    await query(
      "INSERT INTO speed_media_sequences (question_set_id, speed_stt, media_url, duration_seconds, sort_order) VALUES (?, ?, ?, ?, ?)",
      [setId, speedStt, urls[i], durations[i] || fallback, i + 1],
    );
  }
}

module.exports = {
  workbookFromTemplate,
  exportDataset,
  workbookFromDataset,
  importStandardWorkbook,
  importLct3Workbook,
  saveImageSequence,
};
