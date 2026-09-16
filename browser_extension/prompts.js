// Model names and prompt text for OpenAI calls, kept separate from request
// plumbing in openai.js so they're easy to find and tune independently.

const VOICE_MODEL_NAME = "whisper-1";
const SUMMARY_MODEL_NAME = "gpt-5.4-nano";

const SUMMARY_INSTRUCTIONS = `You are a summary agent.
Your task is to generate a english summary from the audio transcription.
Analysed the fundamental things discussed in the meeting.
What a user should take note into account.
What is the next step mentioned.`;
