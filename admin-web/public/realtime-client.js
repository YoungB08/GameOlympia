(function () {
  const socket = io();
  const DEFAULT_AUDIO_VOLUME = 0.5;
  let state = {};
  let timerInterval = null;
  let lastRenderedRemainingMs = null;
  let sharedAudio = null;
  let lastMediaToken = "";
  let blockedMediaToken = "";
  let audioGestureSeen = false;
  const CONTROL_SCREEN_ROLE = "CONTROL";

  function screenRole() {
    return String(window.SCREEN_ROLE || "VIEWER").trim().toUpperCase();
  }

  function canAdminControl() {
    return screenRole() === CONTROL_SCREEN_ROLE;
  }

  function canStudentControl() {
    const role = screenRole();
    return role === "STUDENT" || role === CONTROL_SCREEN_ROLE;
  }

  function controlEmit(eventName, payload) {
    if (!canAdminControl()) {
      console.warn("Man hinh read-only khong duoc phat lenh dieu khien:", eventName);
      return;
    }
    socket.emit(eventName, payload);
  }

  function studentEmit(eventName, payload) {
    if (!canStudentControl()) {
      console.warn("Man hinh read-only khong duoc gui lenh thi sinh:", eventName);
      return;
    }
    socket.emit(eventName, payload);
  }

  function merge(target, patch) {
    const next = Array.isArray(target) ? target.slice() : { ...target };
    Object.entries(patch || {}).forEach(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value) && next[key] && typeof next[key] === "object" && !Array.isArray(next[key])) {
        next[key] = merge(next[key], value);
      } else {
        next[key] = value;
      }
    });
    return next;
  }

  function startedAtMs(timer) {
    const explicit = Number(timer?.startedAtMs);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const parsed = new Date(timer?.startedAt || "").getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  function timerDurationMs(timer) {
    const explicit = Number(timer?.durationMs);
    if (Number.isFinite(explicit) && explicit >= 0) return explicit;
    const seconds = Number(timer?.seconds || 0);
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
  }

  function timerSnapshot(timer) {
    const durationMs = timerDurationMs(timer);
    const fallbackMs = Number.isFinite(Number(timer?.remainingMs))
      ? Number(timer.remainingMs)
      : Number(timer?.remaining ?? timer?.seconds ?? 0) * 1000;
    let remainingMs = Number.isFinite(fallbackMs) ? fallbackMs : durationMs;
    if (timer?.running) {
      const start = startedAtMs(timer);
      if (start) remainingMs = durationMs - (Date.now() - start);
    }
    remainingMs = Math.max(0, Math.min(durationMs || Math.max(0, remainingMs), Math.round(remainingMs)));
    return {
      durationMs,
      remainingMs,
      remaining: Math.ceil(remainingMs / 1000),
    };
  }

  function render(force = false) {
    const timer = timerSnapshot(state.timer);
    state.timer = { ...(state.timer || {}), ...timer };
    if (!force && timer.remainingMs === lastRenderedRemainingMs) return;
    lastRenderedRemainingMs = timer.remainingMs;
    if (window.renderRealtimeState) window.renderRealtimeState(state);
  }

  function startTimerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(render, 50);
  }

  function isMp3AudioUrl(url) {
    return /\.mp3(?:[?#].*)?$/i.test(String(url || "").trim());
  }

  function audioElement() {
    if (!sharedAudio) {
      sharedAudio = new Audio();
      sharedAudio.preload = "auto";
      sharedAudio.volume = DEFAULT_AUDIO_VOLUME;
      sharedAudio.addEventListener("error", () => {
        const failedUrl = sharedAudio.currentSrc || sharedAudio.src || state.media?.url || "";
        if (failedUrl) console.warn("Không tải được file âm thanh:", failedUrl);
      });
    }
    return sharedAudio;
  }

  function syncMediaPlayback(force = false) {
    const media = state.media || {};
    const token = media.playing && media.url ? `${media.url}|${media.startedAt || ""}` : "";
    if (!token) {
      if (sharedAudio) {
        sharedAudio.pause();
        sharedAudio.currentTime = 0;
      }
      lastMediaToken = "";
      blockedMediaToken = "";
      return;
    }
    if (!force && token === lastMediaToken && token !== blockedMediaToken) return;
    blockedMediaToken = "";
    lastMediaToken = token;
    if (!isMp3AudioUrl(media.url)) {
      console.warn("Trình quản lý âm thanh chỉ phát file .mp3:", media.url);
      return;
    }
    const audio = audioElement();
    const playToken = token;
    audio.pause();
    audio.volume = Number.isFinite(Number(media.volume)) ? Number(media.volume) : DEFAULT_AUDIO_VOLUME;
    audio.src = media.url;
    audio.currentTime = 0;
    audio.play().catch((error) => {
      if (error?.name === "AbortError") return;
      if (error?.name === "NotAllowedError") {
        blockedMediaToken = playToken;
        if (!audioGestureSeen) {
          console.info("Trình duyệt cần click/phím đầu tiên trên trang trước khi cho phát âm thanh.");
        }
        return;
      }
      console.warn("Không phát được âm thanh:", media.url, error);
    });
  }

  function unlockAudioFromGesture() {
    audioGestureSeen = true;
    if (!blockedMediaToken) return;
    lastMediaToken = "";
    syncMediaPlayback(true);
  }

  document.addEventListener("pointerdown", unlockAudioFromGesture, true);
  document.addEventListener("keydown", unlockAudioFromGesture, true);

  window.OlympiaSocket = {
    socket,
    getState: () => state,
    patch: (patch) => controlEmit("admin:patch", { patch }),
    startTimer: (seconds) => controlEmit("timer:start", { seconds }),
    stopTimer: () => controlEmit("timer:stop"),
    setRing: (locked, delaySeconds) => controlEmit("ring:set", { locked, delaySeconds }),
    playMedia: (url, title) => controlEmit("media:play", { url, title }),
    stopMedia: () => controlEmit("media:stop"),
    submitAnswer: (contestantId, answerText, questionKey) => studentEmit("candidate:answer", { contestantId, answerText, questionKey }),
    buzz: (contestantId) => studentEmit("candidate:buzz", { contestantId }),
    loginCandidate: (loginCode) => studentEmit("candidate:login", { loginCode, screenRole: screenRole() }),
    grade: (answerId, contestantId, isCorrect, points) => controlEmit("admin:grade", { answerId, contestantId, isCorrect, points }),
    resetRound: (round) => controlEmit("round:reset", { round }),
    setScore: (contestantId, score) => controlEmit("admin:score-set", { contestantId, score }),
    setCandidateActive: (contestantId, active) => controlEmit("admin:candidate-active", { contestantId, active }),
    submitWall: (contestantId, cellIds) => studentEmit("wall:submit", { contestantId, cellIds }),
    nextWarmup: () => controlEmit("warmup:next"),
  };

  socket.on("connect", () => {
    if (window.ROOM_CODE) socket.emit("room:join", { roomCode: window.ROOM_CODE, screenRole: screenRole() });
  });

  socket.on("state:init", (nextState) => {
    state = nextState || {};
    render(true);
    syncMediaPlayback();
    if (window.handleStateInitialized) window.handleStateInitialized(state);
    startTimerLoop();
  });

  socket.on("state:patch", (patch) => {
    state = merge(state, patch || {});
    render(true);
    syncMediaPlayback();
  });

  socket.on("error:message", (message) => {
    console.error(message);
    alert(message);
  });

  socket.on("candidate:login:ok", (payload) => {
    if (window.handleCandidateLoginOk) window.handleCandidateLoginOk(payload);
  });

  socket.on("candidate:login:error", (message) => {
    if (window.handleCandidateLoginError) window.handleCandidateLoginError(message);
    else alert(message);
  });
})();
