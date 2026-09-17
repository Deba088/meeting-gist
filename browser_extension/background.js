// MV3 service worker. Its only job is to keep exactly one offscreen document
// alive so recording can survive the popup closing or losing focus (a popup
// document is torn down on blur; an offscreen document is not).

const OFFSCREEN_PATH = "offscreen.html";

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

  return false;
});
