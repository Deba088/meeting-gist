const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");

function formatTimestamp(ts) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderSession(entry) {
  const card = document.createElement("article");
  card.className = "session";

  const header = document.createElement("div");
  header.className = "session__header";
  header.textContent = formatTimestamp(entry.timestamp);

  const body = document.createElement("div");
  body.className = "session__body";

  const summarySection = document.createElement("div");
  summarySection.className = "session__section";
  summarySection.innerHTML = "<h2>Summary</h2>";
  const summaryText = document.createElement("p");
  summaryText.className = "session__text";
  summaryText.textContent = entry.summary;
  summarySection.appendChild(summaryText);

  const transcriptSection = document.createElement("div");
  transcriptSection.className = "session__section";
  transcriptSection.innerHTML = "<h2>Transcript</h2>";
  const transcriptText = document.createElement("p");
  transcriptText.className = "session__text";
  transcriptText.textContent = entry.transcript;
  transcriptSection.appendChild(transcriptText);

  body.appendChild(summarySection);
  body.appendChild(transcriptSection);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

async function loadHistory() {
  const { sessionHistory = [] } = await chrome.storage.local.get("sessionHistory");
  emptyEl.classList.toggle("hidden", sessionHistory.length > 0);
  listEl.innerHTML = "";
  sessionHistory.forEach((entry) => listEl.appendChild(renderSession(entry)));
}

loadHistory();
