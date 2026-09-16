// Password-based encryption for the OpenAI API key, using WebCrypto.
// The password itself is never stored anywhere — only a PBKDF2-derived
// AES-GCM key is used transiently to encrypt/decrypt, and the decrypted
// API key is cached only in chrome.storage.session (memory-only, cleared
// when the browser closes).

const PBKDF2_ITERATIONS = 250000;

function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Encrypts plaintext with a fresh random salt + IV. Returns a bundle safe
// to persist to disk (chrome.storage.local) — no secret material in it.
async function encryptWithPassword(plaintext, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  };
}

// Throws if the password is wrong (AES-GCM authentication failure).
async function decryptWithPassword(bundle, password) {
  const salt = fromBase64(bundle.salt);
  const iv = fromBase64(bundle.iv);
  const ciphertext = fromBase64(bundle.ciphertext);
  const key = await deriveKey(password, salt);

  const plaintextBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintextBytes);
}
