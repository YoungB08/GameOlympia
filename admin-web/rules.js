const DEFAULT_RULE_PRESET = "olympia26";

const RULE_PRESETS = {
  olympia26: {
    id: "olympia26",
    label: "Olympia 26 (Mới nhất)",
    warmup: {
      individualQuestions: 6,
      individualSeconds: 5,
      commonQuestions: 12,
      commonAnswerSeconds: 5,
      correctPoints: 10,
      commonWrongPenalty: -5,
      noBuzzAutoNext: true,
    },
    obstacle: {
      rowSeconds: 15,
      rowCorrectPoints: 10,
      centerCorrectPoints: 20,
    },
    speed: {
      questionSeconds: [20, 20, 30, 30],
      awards: [40, 30, 20, 10],
    },
    finish: {
      packages: [20, 40],
      questionsPerPackage: 3,
      stealWindowSeconds: 5,
      starBeforeQuestion: true,
      starCorrectMultiplier: 2,
      starWrongPenaltyMode: "question_point",
      mainAnswerMode: "last",
      stealAnswerMode: "first",
    },
    tieBreaker: {
      seconds: 15,
      suddenDeath: true,
      foulOnEarlyBuzz: true,
    },
  },
  olympia24: {
    id: "olympia24",
    label: "Olympia 24 / Tùy chỉnh",
    warmup: {
      individualQuestions: 12,
      individualSeconds: 5,
      commonQuestions: 12,
      commonAnswerSeconds: 5,
      correctPoints: 10,
      commonWrongPenalty: 0,
      noBuzzAutoNext: false,
    },
    obstacle: {
      rowSeconds: 15,
      rowCorrectPoints: 10,
      centerCorrectPoints: 20,
    },
    speed: {
      questionSeconds: [30, 30, 30, 30],
      awards: [40, 30, 20, 10],
    },
    finish: {
      packages: [20, 30, 40],
      questionsPerPackage: 3,
      stealWindowSeconds: 5,
      starBeforeQuestion: false,
      starCorrectMultiplier: 2,
      starWrongPenaltyMode: "question_point",
      mainAnswerMode: "last",
      stealAnswerMode: "first",
    },
    tieBreaker: {
      seconds: 15,
      suddenDeath: false,
      foulOnEarlyBuzz: true,
    },
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getRulePreset(id) {
  return clone(RULE_PRESETS[id] || RULE_PRESETS[DEFAULT_RULE_PRESET]);
}

function isKnownPreset(id) {
  return Boolean(RULE_PRESETS[id]);
}

function deriveTimerSeconds(state, requestedSeconds) {
  const requested = Number(requestedSeconds);
  if (Number.isFinite(requested) && requested > 0) return requested;

  const rules = state.rules || getRulePreset(state.rulePreset || DEFAULT_RULE_PRESET);
  if (state.round === "warmup") {
    return state.warmup?.mode === "common" ? rules.warmup.commonAnswerSeconds : rules.warmup.individualSeconds;
  }
  if (state.round === "obstacle") return rules.obstacle.rowSeconds;
  if (state.round === "speed") {
    const index = Math.max(0, Number(state.speed?.questionIndex || 1) - 1);
    return Number(rules.speed.questionSeconds[index] || rules.speed.questionSeconds[0] || 30);
  }
  if (state.round === "finish") return Number(state.finish?.activePackagePoints || rules.finish.packages[0] || 20);
  if (state.round === "tie_breaker") return rules.tieBreaker.seconds;
  if (state.round === "connecting_wall") return Number(state.connectingWall?.timeLimitSeconds || 150);
  return 15;
}

module.exports = {
  DEFAULT_RULE_PRESET,
  RULE_PRESETS,
  getRulePreset,
  isKnownPreset,
  deriveTimerSeconds,
};
