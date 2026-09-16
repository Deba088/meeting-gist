// Runs inside the hidden offscreen document. Owns the MediaRecorder so that
// recording keeps running regardless of whether the popup is open, focused,
// or the user has switched tabs — none of which affect this document.

let mediaRecorder = null;
let recordedChunks = [];
let recordingStartedAt = 0;

// chrome.action isn't available inside an offscreen document, so the badge
// update is relayed through background.js (the service worker). Triggered
// from here rather than popup.js so it reflects the offscreen document's
// actual recorder state — it stays correct even if the popup never reopens
// while recording is running.
function setRecordingBadge(isRecording) {
  chrome.runtime.sendMessage({ type: "set-recording-badge", recording: isRecording });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function startRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    return { ok: false, error: "Already recording." };
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream);

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  };

  const stopped = new Promise((resolve, reject) => {
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      blobToDataUrl(blob)
        .then((dataUrl) => resolve({ dataUrl, mimeType: blob.type }))
        .catch(reject);
    };
  });
  mediaRecorder._stoppedPromise = stopped;

  mediaRecorder.start();
  recordingStartedAt = Date.now();
  setRecordingBadge(true);
  return { ok: true };
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    return { ok: false, error: "Not recording." };
  }
  const stoppedPromise = mediaRecorder._stoppedPromise;
  mediaRecorder.stop();
  const recording = await stoppedPromise;
  setRecordingBadge(false);
  return { ok: true, recording };
}

function getStatus() {
  const recording = Boolean(mediaRecorder && mediaRecorder.state === "recording");
  return {
    recording,
    startedAt: recording ? recordingStartedAt : null,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  if (message.type === "start-recording") {
    startRecording().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "stop-recording") {
    stopRecording().then(sendResponse).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "get-status") {
    sendResponse(getStatus());
    return true;
  }

  return false;
});
