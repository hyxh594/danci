(() => {
  // Keep a direct fallback for older/portable Electron runtimes where the
  // preload bridge may not be injected. The app is local-only and runs with
  // Node integration enabled, so both paths use the same main-process IPC.
  if (!window.fuciDesktop && typeof window.require === "function") {
    try {
      const { ipcRenderer } = window.require("electron");
      window.fuciDesktop = {
        loadState: () => ipcRenderer.sendSync("fuci:load-state"),
        stateStatus: () => ipcRenderer.sendSync("fuci:state-status"),
        saveState: (state) => ipcRenderer.send("fuci:save-state", JSON.stringify(state)),
        setSuperMode: (enabled, size) => ipcRenderer.send("fuci:set-super-mode", { enabled: Boolean(enabled), size: size || null }),
        hideWindow: () => ipcRenderer.send("fuci:hide-window"),
        fitToContent: (width, height) => ipcRenderer.send("fuci:fit-window", { width, height }),
        resizeStart: (edge, screenX, screenY) => ipcRenderer.send("fuci:resize-start", { edge, screenX, screenY }),
        resizeMove: (screenX, screenY) => ipcRenderer.send("fuci:resize-move", { screenX, screenY }),
        resizeEnd: () => ipcRenderer.send("fuci:resize-end"),
        onWindowResized: (callback) => ipcRenderer.on("fuci:window-resized", (_event, size) => callback(size))
      };
    } catch {}
  }
  const now = () => Date.now();
  const DAY = 86400000;
  const TEN_MINUTES = 600000;
  const cloneSeed = () => CET6_CORE_WORDS.map((word) => ({ ...word, createdAt: now() }));
  const initialState = () => ({ version: 4, words: cloneSeed(), progress: {}, history: [], settings: { dailyNew: 20, opacity: 1, autoNext: true, reminder: true, superMode: true, superSize: null, dailyNewBatch: null } });
  let stateLoadStatus = { persisted: false, blocked: false };
  let state = loadState();
  let queue = [];
  let queuePosition = 0;
  let currentWord = null;
  let revealed = false;
  let saveTimer;
  let fitTimer;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const progressFor = (id) => state.progress[id] || { status: "new", interval: 0, ease: 2.3, streak: 0, reviewCount: 0, successCount: 0, failCount: 0, nextReviewAt: 0, lastResult: "" };
  const meaningFor = (word) => CET6_MEANING_EXPANSIONS[word?.word?.toLowerCase()] || word?.meaning || "暂无释义，请在词库中补充";
  const phoneticFor = (word) => {
    const value = word?.phonetic || word?.ipa || word?.pronunciation || "";
    return typeof value === "string" ? value.trim() : "";
  };
  function stopSpeaking() {
    try { window.speechSynthesis?.cancel?.(); } catch {}
    const button = $("#speak-btn");
    button?.classList.remove("speaking");
    button?.removeAttribute("aria-busy");
  }
  function speakWord() {
    if (!currentWord) return;
    const synth = window.speechSynthesis;
    const button = $("#speak-btn");
    if (!synth || typeof window.SpeechSynthesisUtterance !== "function") {
      toast("当前系统没有可用的英语朗读引擎");
      return;
    }
    if (button?.classList.contains("speaking")) { stopSpeaking(); return; }
    stopSpeaking();
    const utterance = new window.SpeechSynthesisUtterance(String(currentWord.word));
    utterance.lang = "en-US";
    utterance.rate = 0.82;
    utterance.pitch = 1;
    try {
      const voice = synth.getVoices?.().find((item) => /^en([-_]|$)/i.test(item.lang));
      if (voice) utterance.voice = voice;
    } catch {}
    const reset = () => {
      button?.classList.remove("speaking");
      button?.removeAttribute("aria-busy");
    };
    utterance.onstart = () => { button?.classList.add("speaking"); button?.setAttribute("aria-busy", "true"); };
    utterance.onend = reset;
    utterance.onerror = reset;
    try { synth.speak(utterance); } catch { reset(); toast("朗读启动失败，请检查系统语音设置"); }
  }
  const save = () => {
    if (stateLoadStatus.blocked) {
      $("#save-indicator").textContent = "未保存：数据文件异常";
      return;
    }
    try {
      if (window.fuciDesktop?.saveState) window.fuciDesktop.saveState(state);
      else return;
    } catch {
      $("#save-indicator").textContent = "未保存：桌面端不可用";
      return;
    }
    clearTimeout(saveTimer);
    $("#save-indicator").textContent = "已保存";
  };
  const scheduleSave = () => { $("#save-indicator").textContent = "保存中…"; clearTimeout(saveTimer); saveTimer = setTimeout(save, 120); };
  function loadState() {
    try {
      const saved = window.fuciDesktop?.loadState?.() || null;
      if (saved?.words?.length) {
        stateLoadStatus = { persisted: true, blocked: false };
        const fresh = initialState();
        const migrated = { ...fresh, ...saved, version: 4, words: saved.words, progress: saved.progress || {}, history: saved.history || [], settings: { ...fresh.settings, ...(saved.settings || {}) } };
        if (migrated.settings.superSize && (Number(migrated.settings.superSize.width) < 220 || Number(migrated.settings.superSize.height) < 176)) migrated.settings.superSize = null;
        if (!migrated.settings.dailyNewBatch || typeof migrated.settings.dailyNewBatch !== "object") migrated.settings.dailyNewBatch = null;
        // Super mode is the launch default. Leaving it off is a temporary
        // session choice; the next launch intentionally returns to the card.
        migrated.settings.superMode = true;
        return migrated;
      }
      // An existing but unreadable desktop file must never be silently
      // replaced by the initial vocabulary on startup.
      const status = window.fuciDesktop?.stateStatus?.();
      if (window.fuciDesktop?.loadState && status?.exists) stateLoadStatus = { persisted: false, blocked: true };
    } catch {
      if (window.fuciDesktop?.loadState) stateLoadStatus = { persisted: false, blocked: true };
    }
    return initialState();
  }
  function dateKey(value = new Date()) { const d = value instanceof Date ? value : new Date(value); const month = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0"); return `${d.getFullYear()}-${month}-${day}`; }
  function introducedTodayIds(today = dateKey()) { return state.words.filter((word) => { const progress = progressFor(word.id); if (progress.introducedAt) return dateKey(progress.introducedAt) === today; return progress.status !== "new" && progress.reviewCount === 1 && progress.lastReviewAt && dateKey(progress.lastReviewAt) === today; }).map((word) => word.id); }
  function introducedTodayCount() { return introducedTodayIds().length; }
  function reviewedTodayCount(today = dateKey()) { const introduced = new Set(introducedTodayIds(today)); return new Set(state.history.filter((item) => item.reviewedAt && dateKey(item.reviewedAt) === today && (item.kind === "review" || (!item.kind && !introduced.has(item.wordId)))).map((item) => item.wordId)).size; }
  function formatPlanDate(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`; }
  function updateDashboard() {
    const total = state.words.length;
    const remaining = state.words.filter((word) => progressFor(word.id).status === "new").length;
    const learnedToday = introducedTodayCount();
    const reviewedToday = reviewedTodayCount();
    const dailyLimit = Math.max(1, Number(state.settings.dailyNew) || 20);
    const capacityToday = Math.max(0, dailyLimit - learnedToday);
    const daysAfterToday = remaining <= capacityToday ? 0 : Math.ceil((remaining - capacityToday) / dailyLimit);
    const finishDate = new Date();
    finishDate.setHours(12, 0, 0, 0);
    finishDate.setDate(finishDate.getDate() + daysAfterToday);
    $("#overview-total").textContent = total;
    $("#overview-remaining").textContent = remaining;
    $("#overview-learned-today").textContent = learnedToday;
    $("#overview-reviewed-today").textContent = reviewedToday;
    $("#overview-finish").textContent = remaining ? formatPlanDate(finishDate) : "首轮已完成";
    $("#overview-plan-detail").textContent = remaining ? `按每天 ${dailyLimit} 个新词估算` : "继续按计划巩固复习";
  }
  function uniqueWords(ids) {
    const wanted = new Set(ids);
    return state.words.filter((word) => wanted.has(word.id));
  }
  function detailData(type) {
    const totalWords = state.words;
    const today = dateKey();
    const learningWords = totalWords.filter((word) => progressFor(word.id).status === "learning");
    const masteredWords = totalWords.filter((word) => progressFor(word.id).status === "mastered");
    const remainingWords = totalWords.filter((word) => progressFor(word.id).status === "new");
    const due = dueWords();
    const learnedToday = uniqueWords(introducedTodayIds(today));
    const learnedTodayIds = new Set(learnedToday.map((word) => word.id));
    const reviewedTodayIds = [...new Set(state.history.filter((item) => item.reviewedAt && dateKey(item.reviewedAt) === today && (item.kind === "review" || (!item.kind && !learnedTodayIds.has(item.wordId)))).map((item) => item.wordId))];
    const reviewedToday = uniqueWords(reviewedTodayIds);
    const dailyLimit = Math.max(1, Number(state.settings.dailyNew) || 20);
    const capacityToday = Math.max(0, dailyLimit - learnedToday.length);
    const daysAfterToday = remainingWords.length <= capacityToday ? 0 : Math.ceil((remainingWords.length - capacityToday) / dailyLimit);
    const finishDate = new Date(); finishDate.setHours(12, 0, 0, 0); finishDate.setDate(finishDate.getDate() + daysAfterToday);
    const definitions = {
      total: { title: "词库总数", summary: `共 ${totalWords.length} 个词条；学习中 ${learningWords.length}，已掌握 ${masteredWords.length}，待学习 ${remainingWords.length}。`, words: totalWords },
      remaining: { title: "还剩未学习", summary: `还有 ${remainingWords.length} 个词条尚未首次学习。`, words: remainingWords },
      "learned-today": { title: "今日新学", summary: `今天首次学习了 ${learnedToday.length} 个词条。`, words: learnedToday },
      "reviewed-today": { title: "今日复习", summary: `今天复习了 ${reviewedToday.length} 个已学词条。`, words: reviewedToday },
      learning: { title: "学习中", summary: `共有 ${learningWords.length} 个词条处于学习中状态。`, words: learningWords },
      mastered: { title: "已掌握", summary: `共有 ${masteredWords.length} 个词条已掌握。`, words: masteredWords },
      due: { title: "待复习", summary: `当前有 ${due.length} 个词条需要复习。`, words: due },
      plan: { title: "首轮计划", summary: remainingWords.length ? `按每天 ${dailyLimit} 个新词，预计 ${formatPlanDate(finishDate)} 完成首轮。` : "首轮词汇已经完成，接下来按复习间隔巩固。", words: [] }
    };
    return definitions[type] || definitions.total;
  }
  function openDetail(type) {
    const detail = detailData(type);
    $("#detail-title").textContent = detail.title;
    $("#detail-summary").textContent = detail.summary;
    const visibleWords = detail.words.slice(0, 80);
    $("#detail-body").innerHTML = visibleWords.length
      ? visibleWords.map((word) => `<div class="detail-item"><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(meaningFor(word))}</span></div>`).join("") + (detail.words.length > visibleWords.length ? `<p class="detail-more">仅显示前 ${visibleWords.length} 个词条</p>` : "")
      : `<p class="detail-empty">暂无对应词条</p>`;
    $("#detail-modal").classList.remove("hidden");
  }
  function closeDetail() { $("#detail-modal").classList.add("hidden"); }
  function ensureDailyNewBatch() {
    const today = dateKey();
    const current = state.settings.dailyNewBatch;
    const limit = Math.max(1, Number(state.settings.dailyNew) || 20);

    // Keep today's allocation stable. Increasing the limit only appends the
    // difference; decreasing it never takes words away from today's batch.
    // The smaller limit naturally takes effect when a new day starts.
    if (current?.date === today && Array.isArray(current.ids)) {
      const ids = [...new Set(current.ids)];
      const missing = Math.max(0, limit - ids.length);
      if (missing > 0) {
        const allocated = new Set(ids);
        const fresh = state.words
          .filter((word) => progressFor(word.id).status === "new" && !allocated.has(word.id))
          .slice(0, missing)
          .map((word) => word.id);
        ids.push(...fresh);
      }
      if (ids.length !== current.ids.length || ids.some((id, index) => id !== current.ids[index])) {
        state.settings.dailyNewBatch = { date: today, ids };
        save();
      }
      return state.settings.dailyNewBatch;
    }

    // On first run after upgrading, retain words already introduced today so
    // a restart cannot silently advance to a fresh batch.
    const learnedToday = introducedTodayIds(today);
    const remaining = Math.max(0, limit - learnedToday.length);
    const fresh = state.words.filter((word) => progressFor(word.id).status === "new" && !learnedToday.includes(word.id)).slice(0, remaining).map((word) => word.id);
    const ids = [...new Set([...learnedToday, ...fresh])];
    state.settings.dailyNewBatch = { date: today, ids };
    save();
    return state.settings.dailyNewBatch;
  }
  function dueWords() {
    const dailyBatch = ensureDailyNewBatch();
    const dailyIds = new Set(dailyBatch.ids || []);
    const due = state.words.filter((w) => { const p = progressFor(w.id); return p.status === "new" || !p.nextReviewAt || p.nextReviewAt <= now(); });
    const known = due.filter((w) => progressFor(w.id).status !== "new").sort((a,b) => progressFor(a.id).nextReviewAt - progressFor(b.id).nextReviewAt);
    const limit = Math.max(1, Number(state.settings.dailyNew) || 20);
    const remaining = Math.max(0, limit - introducedTodayCount());
    const fresh = due.filter((w) => progressFor(w.id).status === "new" && dailyIds.has(w.id)).slice(0, remaining);
    return [...known, ...fresh];
  }
  function startSession() { queue = dueWords(); queuePosition = 0; currentWord = queue[0] || null; revealed = false; renderCard(); }
  function updateWordNav() {
    const previous = $("#prev-btn");
    const next = $("#next-btn");
    if (!previous || !next) return;
    previous.disabled = !currentWord || queuePosition <= 0;
    next.disabled = !currentWord || queuePosition >= queue.length - 1;
  }
  function renderCard() {
    stopSpeaking();
    const total = queue.length;
    $("#progress-label").textContent = total ? `${Math.min(queuePosition + 1, total)} / ${total}` : "0 / 0";
    $("#progress-bar").style.width = total ? `${Math.min((queuePosition / total) * 100, 100)}%` : "0%";
    if (!currentWord) { $("#review-title").textContent = "今天完成了"; $("#word-main").textContent = "太棒了"; $("#word-phonetic").textContent = "暂时没有待复习的词"; $("#word-answer").textContent = "去词库添加新词，或者明天再来看看。"; $("#word-answer").classList.add("visible"); $("#reveal-btn").disabled = true; $("#forgot-btn").disabled = true; $("#remember-btn").disabled = true; $("#skip-btn").disabled = true; $("#speak-btn").disabled = true; updateWordNav(); return; }
    const p = progressFor(currentWord.id);
    $("#review-title").textContent = p.status === "new" ? "认识新词" : "巩固记忆";
    $("#word-main").textContent = currentWord.word;
    const phonetic = phoneticFor(currentWord);
    $("#word-phonetic").textContent = phonetic ? `${phonetic.startsWith("/") ? phonetic : `/${phonetic}/`} · 点击朗读` : "点击扬声器朗读 · R";
    $("#speak-btn").disabled = false;
    $("#speak-btn").title = `朗读 ${currentWord.word}（R）`;
    $("#speak-btn").setAttribute("aria-label", `朗读 ${currentWord.word}`);
    $("#word-level").textContent = currentWord.level || "CET6 CORE";
    $("#word-status").textContent = statusLabel(p.status);
    $("#word-answer").textContent = meaningFor(currentWord);
    $("#word-answer").classList.toggle("visible", revealed);
    $("#reveal-btn").textContent = revealed ? "已显示释义" : "显示释义 ";
    if (!revealed) { const hint = document.createElement("span"); hint.textContent = "Space"; $("#reveal-btn").appendChild(hint); }
    $("#reveal-btn").disabled = revealed;
    $("#forgot-btn").disabled = !revealed; $("#remember-btn").disabled = !revealed; $("#skip-btn").disabled = false;
    updateWordNav();
  }
  function statusLabel(status) { return status === "mastered" ? "已掌握" : status === "learning" ? "学习中" : "新词"; }
  function reveal() { if (!currentWord || revealed) return; revealed = true; renderCard(); }
  function review(result) {
    if (!currentWord || !revealed) return;
    const old = progressFor(currentWord.id);
    const wasNew = old.status === "new";
    const reviewedAt = now();
    const p = { ...old, reviewCount: old.reviewCount + 1, lastResult: result, lastReviewAt: reviewedAt, introducedAt: old.introducedAt || (old.status === "new" ? reviewedAt : undefined) };
    if (result === "remembered") {
      p.successCount += 1; p.streak += 1; p.ease = Math.min(2.8, p.ease + 0.08); p.interval = p.interval ? Math.round(p.interval * p.ease) : 1; p.interval = Math.min(p.interval, 60); p.nextReviewAt = now() + p.interval * DAY; p.status = p.streak >= 3 && p.interval >= 14 ? "mastered" : "learning";
    } else {
      p.failCount += 1; p.streak = 0; p.ease = Math.max(1.3, p.ease - 0.2); p.interval = 0; p.nextReviewAt = now() + TEN_MINUTES; p.status = "learning";
    }
    state.progress[currentWord.id] = p; state.history.unshift({ wordId: currentWord.id, result, reviewedAt, kind: wasNew ? "new" : "review" }); state.history = state.history.slice(0, 1000); save(); updateStats(); toast(result === "remembered" ? `已记住 · ${p.interval} 天后复习` : "已加入稍后复习");
    queuePosition += 1;
    const dailyLimit = Math.max(1, Number(state.settings.dailyNew) || 20);
    if (introducedTodayCount() >= dailyLimit) queue = [...queue.slice(0, queuePosition), ...queue.slice(queuePosition).filter((word) => progressFor(word.id).status !== "new")];
    currentWord = queue[queuePosition] || null; revealed = false; renderCard();
  }
  function skip() { if (!currentWord) return; queue.push(currentWord); queuePosition += 1; currentWord = queue[queuePosition] || null; revealed = false; renderCard(); }
  function navigateWord(direction) {
    if (!currentWord || !queue.length) return;
    const nextPosition = queuePosition + direction;
    if (nextPosition < 0 || nextPosition >= queue.length) return;
    queuePosition = nextPosition;
    currentWord = queue[queuePosition];
    revealed = false;
    renderCard();
  }
  function updateStats() {
    const all = state.words; $("#stat-total").textContent = all.length; $("#stat-learning").textContent = all.filter((w) => progressFor(w.id).status === "learning").length; $("#stat-mastered").textContent = all.filter((w) => progressFor(w.id).status === "mastered").length; $("#stat-due").textContent = dueWords().length; updateDashboard(); renderTable();
  }
  function formatDue(p) { if (!p.nextReviewAt) return "待学习"; if (p.nextReviewAt <= now()) return "现在"; const mins = Math.ceil((p.nextReviewAt - now()) / 60000); if (mins < 60) return `${mins} 分钟后`; const days = Math.ceil(mins / 1440); return `${days} 天后`; }
  function renderTable() { const keyword = ($("#search-input")?.value || "").trim().toLowerCase(); const rows = state.words.filter((w) => !keyword || `${w.word} ${meaningFor(w)}`.toLowerCase().includes(keyword)).slice(0, 200); $("#word-table").innerHTML = rows.map((w) => { const p = progressFor(w.id); return `<tr><td>${escapeHtml(w.word)}</td><td>${escapeHtml(meaningFor(w))}</td><td><span class="status-pill ${p.status}">${statusLabel(p.status)}</span></td><td>${formatDue(p)}</td></tr>`; }).join("") || `<tr><td colspan="4" style="text-align:center;color:#9aa0ae;padding:24px">没有找到匹配词条</td></tr>`; }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c])); }
  function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 1800); }
  function switchView(name) { $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name)); $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.target === name)); if (name === "library") updateStats(); }
  function arrangeSuperLayout(enabled) { const card = $("#word-card"); const topbar = document.querySelector(".topbar"); const toolbar = document.querySelector(".review-toolbar"); const actions = document.querySelector(".top-actions"); const progress = document.querySelector(".progress-wrap"); if (!card || !topbar || !toolbar || !actions || !progress) return; if (enabled) { if (!card.contains(actions)) card.appendChild(actions); if (!card.contains(progress)) card.appendChild(progress); } else { if (!topbar.contains(actions)) topbar.appendChild(actions); if (!toolbar.contains(progress)) toolbar.appendChild(progress); } }
  function hasStoredSuperSize() { const size = state.settings.superSize; return Number(size?.width) >= 220 && Number(size?.height) >= 176; }
  function fitDesktopWindow() { if (!state.settings.superMode || hasStoredSuperSize() || !window.fuciDesktop?.fitToContent) return; clearTimeout(fitTimer); fitTimer = setTimeout(() => { const card = $("#word-card"); if (!card) return; const rect = card.getBoundingClientRect(); window.fuciDesktop.fitToContent(Math.max(220, Math.ceil(rect.width)), Math.max(176, Math.ceil(card.scrollHeight || rect.height))); }, 90); }
  function applySuperMode(enabled, persist = true) { state.settings.superMode = Boolean(enabled); document.body.classList.toggle("super-float", state.settings.superMode); arrangeSuperLayout(state.settings.superMode); $("#super-mode").checked = state.settings.superMode; const toggle = $("#super-toggle-btn"); toggle.classList.toggle("active", state.settings.superMode); toggle.title = state.settings.superMode ? "退出超级悬浮模式" : "进入超级悬浮模式"; toggle.setAttribute("aria-label", toggle.title); if (state.settings.superMode) switchView("review"); if (window.fuciDesktop?.setSuperMode) window.fuciDesktop.setSuperMode(state.settings.superMode, state.settings.superSize); fitDesktopWindow(); if (persist) save(); }
  function addWord(word, meaning, phonetic = "") { const clean = word.trim().toLowerCase(); if (!clean || state.words.some((w) => w.word === clean)) return false; const entry = { id: `custom-${clean}-${Date.now()}`, word: clean, meaning: meaning.trim(), level: "自定义", source: "用户添加", createdAt: now() }; const cleanPhonetic = String(phonetic || "").trim(); if (cleanPhonetic) entry.phonetic = cleanPhonetic; state.words.unshift(entry); save(); updateStats(); return true; }
  function importText(text, fileName) {
    let parsed;
    let imported = [];
    try {
      if (fileName.endsWith(".json")) {
        parsed = JSON.parse(text);
        if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.words) && parsed.progress && typeof parsed.progress === "object" && Array.isArray(parsed.history)) {
          if (!window.confirm("导入完整备份会覆盖当前词库、学习进度、复习历史和设置，确定继续吗？")) return;
          const fresh = initialState();
          state = {
            ...fresh,
            ...parsed,
            version: 4,
            words: parsed.words.filter((word) => word && word.id && word.word),
            progress: parsed.progress,
            history: parsed.history,
            settings: { ...fresh.settings, ...(parsed.settings || {}) }
          };
          state.settings.superMode = true;
          if (state.settings.superSize && (Number(state.settings.superSize.width) < 220 || Number(state.settings.superSize.height) < 176)) state.settings.superSize = null;
          save();
          applySuperMode(true, false);
          startSession();
          updateStats();
          toast("完整备份已恢复");
          return;
        }
        imported = Array.isArray(parsed) ? parsed : parsed.words || [];
      } else imported = text.split(/\r?\n/).map((line) => { const parts = line.split(/[,\t|]/); return { word: parts[0], meaning: parts.slice(1).join("，") }; });
    } catch { toast("文件格式无法识别"); return; }
    let count = 0; imported.forEach((item) => { const word = item.word || item.term || item.单词; const meaning = item.meaning || item.translation || item.释义 || ""; const phonetic = item.phonetic || item.ipa || item.pronunciation || item.音标 || ""; if (word && addWord(String(word), String(meaning), String(phonetic))) count += 1; }); toast(`已导入 ${count} 个新词`); updateStats();
  }
  function exportBackup() { const blob = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `fuci-cet6-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); toast("备份已导出"); }
  function bind() {
    $$(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.target)));
    $("#reveal-btn").addEventListener("click", reveal); $("#speak-btn").addEventListener("click", speakWord); $("#remember-btn").addEventListener("click", () => review("remembered")); $("#forgot-btn").addEventListener("click", () => review("forgotten")); $("#skip-btn").addEventListener("click", skip);
    $("#prev-btn").addEventListener("click", () => navigateWord(-1)); $("#next-btn").addEventListener("click", () => navigateWord(1));
    $$("[data-detail]").forEach((button) => button.addEventListener("click", () => openDetail(button.dataset.detail)));
    $("#detail-close").addEventListener("click", closeDetail); $("#detail-modal").addEventListener("click", (event) => { if (event.target.id === "detail-modal") closeDetail(); });
    document.addEventListener("keydown", (event) => { if (event.target.matches("input, textarea, select, [contenteditable='true']")) return; if (event.key.toLowerCase() === "r") { event.preventDefault(); speakWord(); } if (event.code === "Space") { event.preventDefault(); reveal(); } if (event.key === "1") review("forgotten"); if (event.key === "2") review("remembered"); });
    $("#search-input").addEventListener("input", renderTable); $("#export-btn").addEventListener("click", exportBackup); $("#import-btn").addEventListener("click", () => $("#import-file").click()); $("#restore-btn").addEventListener("click", () => $("#import-file").click()); $("#import-file").addEventListener("change", (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => importText(String(reader.result), file.name.toLowerCase()); reader.readAsText(file); e.target.value = ""; });
    $("#add-word-btn").addEventListener("click", () => $("#add-modal").classList.remove("hidden")); [$("#close-modal"), $("#cancel-add")].forEach((b) => b.addEventListener("click", () => $("#add-modal").classList.add("hidden"))); $("#confirm-add").addEventListener("click", () => { const ok = addWord($("#new-word").value, $("#new-meaning").value); if (!ok) return toast("请输入新单词，或该词已存在"); $("#new-word").value = ""; $("#new-meaning").value = ""; $("#add-modal").classList.add("hidden"); toast("单词已加入词库"); });
    $("#daily-new").value = state.settings.dailyNew; $("#opacity-range").value = state.settings.opacity; $("#quick-opacity").value = state.settings.opacity; $("#super-mode").checked = Boolean(state.settings.superMode); $("#reminder").checked = state.settings.reminder; $("#daily-new").addEventListener("change", (e) => { state.settings.dailyNew = Math.max(1, Math.min(100, Number(e.target.value) || 20)); save(); startSession(); updateStats(); }); const updateOpacity = (e) => { state.settings.opacity = Number(e.target.value); $("#opacity-range").value = state.settings.opacity; $("#quick-opacity").value = state.settings.opacity; document.querySelector(".app-shell").style.opacity = state.settings.opacity; save(); }; $("#opacity-range").addEventListener("input", updateOpacity); $("#quick-opacity").addEventListener("input", updateOpacity); $("#super-mode").addEventListener("change", (e) => applySuperMode(e.target.checked)); $("#super-toggle-btn").addEventListener("click", () => applySuperMode(!state.settings.superMode)); $("#minimize-btn").addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); if (window.fuciDesktop?.hideWindow) window.fuciDesktop.hideWindow(); }); window.fuciDesktop?.onWindowResized?.((size) => { if (!state.settings.superMode || !size) return; const width = Math.round(Number(size.width)); const height = Math.round(Number(size.height)); if (width < 220 || height < 176) return; state.settings.superSize = { width, height }; save(); }); $("#reminder").addEventListener("change", (e) => { state.settings.reminder = e.target.checked; save(); });
    $$(".resize-handle").forEach((handle) => handle.addEventListener("mousedown", (event) => { if (!window.fuciDesktop?.resizeStart) return; event.preventDefault(); const edge = handle.dataset.edge; window.fuciDesktop.resizeStart(edge, event.screenX, event.screenY); const move = (e) => window.fuciDesktop.resizeMove(e.screenX, e.screenY); const end = () => { window.fuciDesktop.resizeEnd(); window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); }; window.addEventListener("mousemove", move); window.addEventListener("mouseup", end, { once: true }); }));
  }
  document.querySelector(".app-shell").style.opacity = state.settings.opacity; bind(); applySuperMode(state.settings.superMode, false); startSession(); updateStats(); save(); fitDesktopWindow(); if (stateLoadStatus.blocked) setTimeout(() => toast("数据文件读取失败，原文件未被覆盖，请检查备份"), 400); else if (state.settings.reminder && dueWords().length) setTimeout(() => toast(`今天有 ${dueWords().length} 个词待复习`), 500);
})();
