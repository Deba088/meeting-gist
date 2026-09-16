const apiKeyInput = document.getElementById("apiKey");
const passwordInput = document.getElementById("password");
const passwordConfirmInput = document.getElementById("passwordConfirm");
const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");
const savedMsg = document.getElementById("savedMsg");
const historyBtn = document.getElementById("historyBtn");

historyBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") });
});

function flashMessage(text, isError) {
  savedMsg.textContent = text;
  savedMsg.classList.toggle("saved-msg--error", Boolean(isError));
  savedMsg.classList.remove("hidden");
  setTimeout(() => savedMsg.classList.add("hidden"), 2000);
}

async function load() {
  const { encryptedApiKey } = await chrome.storage.local.get("encryptedApiKey");
  if (encryptedApiKey) {
    apiKeyInput.placeholder = "•••••••••••••••••••• (key already set — leave blank to keep)";
  }
}

saveBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const password = passwordInput.value;
  const passwordConfirm = passwordConfirmInput.value;

  if (!password) {
    flashMessage("Choose a password to lock the key with.", true);
    return;
  }
  if (password !== passwordConfirm) {
    flashMessage("Passwords don't match.", true);
    return;
  }

  let keyToEncrypt = apiKey;
  if (!keyToEncrypt) {
    // No new key typed — re-encrypt under the (possibly new) password only if we can
    // still decrypt the existing one. Otherwise require the key to be re-entered.
    flashMessage("Enter your OpenAI API key to save.", true);
    return;
  }

  const bundle = await encryptWithPassword(keyToEncrypt, password);
  await chrome.storage.local.set({ encryptedApiKey: bundle });
  await chrome.storage.session.remove("unlockedApiKey");

  apiKeyInput.value = "";
  passwordInput.value = "";
  passwordConfirmInput.value = "";
  apiKeyInput.placeholder = "•••••••••••••••••••• (key already set — leave blank to keep)";
  flashMessage("Saved and encrypted ✓", false);
});

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("encryptedApiKey");
  await chrome.storage.session.remove("unlockedApiKey");
  apiKeyInput.placeholder = "sk-...";
  flashMessage("Stored key removed.", false);
});

load();
