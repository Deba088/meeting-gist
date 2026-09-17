// MV3 service worker. Keeps exactly one offscreen document alive so recording
// can survive the popup closing or losing focus (a popup document is torn
// down on blur; an offscreen document is not) — and owns the transcribe/
// summarize pipeline itself, so that work also survives the popup closing.
// The service worker can be killed too, but unlike a popup it is revived by
// incoming messages and kept alive for the duration of in-flight fetches, so
// starting the pipeline here (rather than in popup.js) is what makes it
// durable against the popup closing mid-processing.

importScripts("prompts.js", "openai.js");

const OFFSCREEN_PATH = "offscreen.html";
const MAX_HISTORY = 5;

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["USER_MEDIA"],
    justification: "Records microphone audio for transcription across tab switches.",
  });
}

// chrome.action is only available to the service worker, not to offscreen
// documents, so offscreen.js messages here to update the toolbar badge.
function setRecordingBadge(isRecording) {
  chrome.action.setBadgeText({ text: isRecording ? "●" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#dc2626" });
  chrome.action.setTitle({
    title: isRecording ? "MeetingGist — recording…" : "MeetingGist",
  });
}

// Processing state lives in chrome.storage.local (not just memory) so that if
// the service worker itself gets killed and revived mid-fetch, a reopened
// popup can still tell "still processing" from "done" from "errored" apart,
// and so results aren't lost even if no popup is open when they land.
async function setProcessingState(state) {
  await chrome.storage.local.set({ processingState: state });
}

async function saveToHistory(entry) {
  const { sessionHistory = [] } = await chrome.storage.local.get("sessionHistory");
  const updated = [entry, ...sessionHistory].slice(0, MAX_HISTORY);
  await chrome.storage.local.set({ sessionHistory: updated });
}

function notifyDone(title, message) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
  });
}

async function processRecording(dataUrl, fileName) {
  await setProcessingState({ status: "transcribing" });

  try {
    const { unlockedApiKey: apiKey } = await chrome.storage.session.get("unlockedApiKey");
    if (!apiKey) throw new Error("No API key available. Unlock MeetingGist and try again.");

    const blob = await (await fetch(dataUrl)).blob();

    const transcript = await transcribeAudio(blob, apiKey, fileName);
    await setProcessingState({ status: "summarizing" });

    const summary = await summarize(transcript, apiKey);
    const entry = { transcript, summary, timestamp: Date.now() };

    await saveToHistory(entry);
    await setProcessingState({ status: "done", result: entry });
    notifyDone("MeetingGist", "Your summary is ready.");
  } catch (err) {
    await setProcessingState({ status: "error", error: err.message });
    notifyDone("MeetingGist", `Processing failed: ${err.message}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ensure-offscreen") {
    ensureOffscreenDocument()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "set-recording-badge") {
    setRecordingBadge(message.recording);
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "process-recording") {
    // Not awaited on purpose: the caller (popup) should not need to stay
    // open for this to run, so we ack immediately and let it continue.
    processRecording(message.dataUrl, message.fileName);
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
