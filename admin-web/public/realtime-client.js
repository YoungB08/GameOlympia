(function () {
  const socket = io();
  let state = {};
  let timerInterval = null;
  let lastRenderedRemaining = null;
  let sharedAudio = null;
  let lastMediaToken = "";

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

  function secondsRemaining(timer) {
    if (!timer || !timer.running || !timer.startedAt) return Number(timer?.remaining ?? timer?.seconds ?? 0);
    const elapsed = Math.floor((Date.now() - new Date(timer.startedAt).getTime()) / 1000);
    return Math.max(0, Number(timer.seconds || 0) - elapsed);
  }

  function render(force = false) {
    const remaining = secondsRemaining(state.timer);
    state.timer = { ...(state.timer || {}), remaining };
    if (!force && remaining === lastRenderedRemaining) return;
    lastRenderedRemaining = remaining;
    if (window.renderRealtimeState) window.renderRealtimeState(state);
  }

  function startTimerLoop() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(render, 250);
  }

  function audioElement() {
    if (!sharedAudio) {
      sharedAudio = new Audio();
      sharedAudio.preload = "auto";
    }
    return sharedAudio;
  }

  function syncMediaPlayback() {
    const media = state.media || {};
    const token = media.playing && media.url ? `${media.url}|${media.startedAt || ""}` : "";
    if (!token) {
      if (sharedAudio) {
        sharedAudio.pause();
        sharedAudio.currentTime = 0;
      }
      lastMediaToken = "";
      return;
    }
    if (token === lastMediaToken) return;
    lastMediaToken = token;
    const audio = audioElement();
    audio.pause();
    audio.src = media.url;
    audio.currentTime = 0;
    audio.play().catch((error) => {
      console.warn("Browser blocked audio playback until the page receives a user gesture.", error);
    });
  }

  window.OlympiaSocket = {
    socket,
    getState: () => state,
    patch: (patch) => socket.emit("admin:patch", { patch }),
    startTimer: (seconds) => socket.emit("timer:start", { seconds }),
    stopTimer: () => socket.emit("timer:stop"),
    setRing: (locked, delaySeconds) => socket.emit("ring:set", { locked, delaySeconds }),
    playMedia: (url, title) => socket.emit("media:play", { url, title }),
    stopMedia: () => socket.emit("media:stop"),
    submitAnswer: (contestantId, answerText, questionKey) => socket.emit("candidate:answer", { contestantId, answerText, questionKey }),
    buzz: (contestantId) => socket.emit("candidate:buzz", { contestantId }),
    loginCandidate: (loginCode) => socket.emit("candidate:login", { loginCode }),
    grade: (answerId, contestantId, isCorrect, points) => socket.emit("admin:grade", { answerId, contestantId, isCorrect, points }),
    resetRound: (round) => socket.emit("round:reset", { round }),
    setScore: (contestantId, score) => socket.emit("admin:score-set", { contestantId, score }),
    setCandidateActive: (contestantId, active) => socket.emit("admin:candidate-active", { contestantId, active }),
    submitWall: (contestantId, cellIds) => socket.emit("wall:submit", { contestantId, cellIds }),
    nextWarmup: () => socket.emit("warmup:next"),
  };

  socket.on("connect", () => {
    if (window.ROOM_CODE) socket.emit("room:join", { roomCode: window.ROOM_CODE });
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
