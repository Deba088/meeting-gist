// Thin wrapper around the OpenAI REST API, mirroring voice_agent/model/__init__.py:
// - transcribeAudio() ports transcribe_audio() (Whisper, chunked under 20MB)
// - summarize() ports create_summary_agent()'s instructions via chat completions

const VOICE_MODEL_NAME = "whisper-1";
const SUMMARY_MODEL_NAME = "gpt-5.4-nano";
const MAX_CHUNK_BYTES = 20 * 1024 * 1024; // stay safely under OpenAI's 25MB limit

const SUMMARY_INSTRUCTIONS = `You are a summary agent.
Your task is to generate a english summary from the audio transcription.
Analysed the fundamental things discussed in the meeting.
What a user should take note into account.
What is the next step mentioned.`;

function splitBlobIntoChunks(blob, maxBytes) {
  if (blob.size <= maxBytes) {
    return [blob];
  }
  const chunks = [];
  const numChunks = Math.ceil(blob.size / maxBytes);
  const chunkSize = Math.ceil(blob.size / numChunks);
  for (let start = 0; start < blob.size; start += chunkSize) {
    chunks.push(blob.slice(start, Math.min(start + chunkSize, blob.size), blob.type));
  }
  return chunks;
}

async function transcribeAudio(audioBlob, apiKey, fileName = "audio.webm") {
  const chunks = splitBlobIntoChunks(audioBlob, MAX_CHUNK_BYTES);
  const transcripts = [];

  for (let i = 0; i < chunks.length; i++) {
    const formData = new FormData();
    formData.append("model", VOICE_MODEL_NAME);
    formData.append("file", chunks[i], chunks.length > 1 ? `chunk${i}_${fileName}` : fileName);

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Transcription failed (${response.status}): ${errText}`);
    }

    const data = await response.json();
    transcripts.push(data.text);
  }

  return transcripts.join(" ");
}

async function summarize(transcript, apiKey) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL_NAME,
      messages: [
        { role: "system", content: SUMMARY_INSTRUCTIONS },
        { role: "user", content: transcript },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Summary failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
