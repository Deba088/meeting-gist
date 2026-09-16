const recordBtn = document.getElementById("recordBtn");
const stopBtn = document.getElementById("stopBtn");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const timerEl = document.getElementById("timer");
const fileInput = document.getElementById("fileInput");
const progress = document.getElementById("progress");
const progressText = document.getElementById("progressText");
const results = document.getElementById("results");
const summaryText = document.getElementById("summaryText");
const transcriptText = document.getElementById("transcriptText");
const errorBox = document.getElementById("errorBox");
const noKeyWarning = document.getElementById("noKeyWarning");
const openOptions = document.getElementById("openOptions");
const goToOptions = document.getElementById("goToOptions");
const unlockSection = document.getElementById("unlockSection");
const unlockPassword = document.getElementById("unlockPassword");
const unlockBtn = document.getElementById("unlockBtn");
const unlockError = document.getElementById("unlockError");
const mainSection = document.getElementById("mainSection");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");

const MAX_HISTORY = 5;

let timerInterval = null;
let cachedApiKey = null;

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function setStatus(text, recording) {
  statusText.textContent = text;
  statusDot.classList.toggle("dot--recording", Boolean(recording));
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function clearError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function setProgress(visible, text) {
  progress.classList.toggle("hidden", !visible);
  if (text) progressText.textContent = text;
  recordBtn.disabled = visible;
  fileInput.disabled = visible;
}

// Three states: no key stored at all; key stored but locked (need password);
// key stored and already unlocked this browser session (cached in session storage).
async function getLockState() {
  const { encryptedApiKey } = await chrome.storage.local.get("encryptedApiKey");
  if (!encryptedApiKey) return "no-key";

  const { unlockedApiKey } = await chrome.storage.session.get("unlockedApiKey");
  if (unlockedApiKey) return "unlocked";

  return "locked";
}

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey;
  const { unlockedApiKey } = await chrome.storage.session.get("unlockedApiKey");
  if (unlockedApiKey) {
    cachedApiKey = unlockedApiKey;
    return unlockedApiKey;
  }
  return "";
}

async function refreshGate() {
  const state = await getLockState();
  noKeyWarning.classList.toggle("hidden", state !== "no-key");
  unlockSection.classList.toggle("hidden", state !== "locked");
  mainSection.classList.toggle("hidden", state !== "unlocked");
  return state;
}

async function unlock() {
  unlockError.classList.add("hidden");
  const password = unlockPassword.value;
  if (!password) return;

  const { encryptedApiKey } = await chrome.storage.local.get("encryptedApiKey");
  if (!encryptedApiKey) return;

  try {
    const apiKey = await decryptWithPassword(encryptedApiKey, password);
    cachedApiKey = apiKey;
    // Session storage clears when the browser closes, so the plaintext key
    // never survives past the current browser session.
    await chrome.storage.session.set({ unlockedApiKey: apiKey });
    unlockPassword.value = "";
    await refreshGate();
    await resyncRecordingUi();
  } catch (err) {
    unlockError.classList.remove("hidden");
  }
}

// Recording itself runs in a persistent offscreen document (see offscreen.js),
// not in this popup — a popup document is destroyed the instant it loses
// focus (switching tabs, clicking elsewhere), which would otherwise kill an
// in-progress MediaRecorder. The popup only sends start/stop messages and
// polls status, so recording survives regardless of what the popup does.

function sendToOffscreen(message) {
  return chrome.runtime.sendMessage({ target: "offscreen", ...message });
}

function startTimerFrom(startedAt) {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerEl.textContent = formatTime(Date.now() - startedAt);
  }, 250);
}

async function startRecording() {
  clearError();
  const apiKey = await getApiKey();
  if (!apiKey) return;

  try {
    await chrome.runtime.sendMessage({ type: "ensure-offscreen" });
    const result = await sendToOffscreen({ type: "start-recording" });
    if (!result.ok) throw new Error(result.error || "Could not start recording.");

    startTimerFrom(Date.now());
    setStatus("Recording…", true);
    recordBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
  } catch (err) {
    showError(`Microphone access failed: ${err.message}`);
  }
}

async function stopRecording() {
  clearInterval(timerInterval);
  timerEl.textContent = "00:00";
  setStatus("Processing…", false);
  recordBtn.classList.remove("hidden");
  stopBtn.classList.add("hidden");

  const result = await sendToOffscreen({ type: "stop-recording" });
  if (!result.ok || !result.recording) {
    showError(result.error || "Could not stop recording.");
    setStatus("Ready", false);
    return;
  }

  const blob = await (await fetch(result.recording.dataUrl)).blob();
  await handleAudio(blob, "recording.webm");
}

// If the popup was closed mid-recording (offscreen doc kept recording) and
// reopened, resync the UI to whatever the offscreen document is doing.
async function resyncRecordingUi() {
  let status;
  try {
    status = await sendToOffscreen({ type: "get-status" });
  } catch {
    return; // no offscreen document exists yet — nothing recording
  }
  if (status && status.recording) {
    startTimerFrom(status.startedAt);
    setStatus("Recording…", true);
    recordBtn.classList.add("hidden");
    stopBtn.classList.remove("hidden");
  }
}

async function handleAudio(blob, fileName) {
  clearError();
  results.classList.add("hidden");
  const apiKey = await getApiKey();
  if (!apiKey) return;

  try {
    setProgress(true, "Transcribing…");
    const transcript = await transcribeAudio(blob, apiKey, fileName);

    setProgress(true, "Summarizing…");
    const summary = await summarize(transcript, apiKey);

    transcriptText.textContent = transcript;
    summaryText.textContent = summary;
    results.classList.remove("hidden");
    setStatus("Done", false);

    await saveToHistory({ transcript, summary, timestamp: Date.now() });
  } catch (err) {
    showError(err.message);
    setStatus("Ready", false);
  } finally {
    setProgress(false);
  }
}

// Keeps the last MAX_HISTORY sessions in chrome.storage.local so they survive
// browser restarts. Transcripts/summaries aren't secret the way the API key
// is, so they're stored in plain (unencrypted) storage.
async function saveToHistory(entry) {
  const { sessionHistory = [] } = await chrome.storage.local.get("sessionHistory");
  const updated = [entry, ...sessionHistory].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ sessionHistory: updated });
  renderHistory(updated);
}

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderHistory(entries) {
  historyList.innerHTML = "";
  historyEmpty.classList.toggle("hidden", entries.length > 0);

  entries.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "history__item";

    const top = document.createElement("div");
    top.className = "history__item-top";
    top.textContent = formatTimestamp(entry.timestamp);

    const preview = document.createElement("div");
    preview.className = "history__item-preview";
    preview.textContent = entry.summary.split("\n")[0];

    li.appendChild(top);
    li.appendChild(preview);
    li.addEventListener("click", () => {
      transcriptText.textContent = entry.transcript;
      summaryText.textContent = entry.summary;
      results.classList.remove("hidden");
      clearError();
    });

    historyList.appendChild(li);
  });
}

async function loadHistory() {
  const { sessionHistory = [] } = await chrome.storage.local.get("sessionHistory");
  renderHistory(sessionHistory);
}

recordBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) {
    handleAudio(file, file.name);
    fileInput.value = "";
  }
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("tab--active"));
    tab.classList.add("tab--active");
    const target = tab.dataset.tab;
    document.getElementById("summaryPane").classList.toggle("hidden", target !== "summary");
    document.getElementById("transcriptPane").classList.toggle("hidden", target !== "transcript");
  });
});

document.querySelectorAll("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const el = document.getElementById(btn.dataset.copy);
    navigator.clipboard.writeText(el.textContent);
    const original = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = original), 1200);
  });
});

openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
goToOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

unlockBtn.addEventListener("click", unlock);
unlockPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlock();
});

(async () => {
  const state = await refreshGate();
  if (state === "unlocked") {
    await resyncRecordingUi();
  }
  await loadHistory();
})();
