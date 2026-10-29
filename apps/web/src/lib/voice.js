const SPEECH_LOCALES = {
  en: 'en-IN',
  hi: 'hi-IN',
  mr: 'mr-IN'
};

export function speak(text, language = 'en') {
  if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const locale = SPEECH_LOCALES[language] || 'en-IN';
  utterance.lang = locale;
  utterance.rate = 0.92;
  utterance.pitch = 1;
  utterance.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const exact = voices.find((voice) => voice.lang === locale);
  const languageMatch = voices.find((voice) => voice.lang.startsWith(locale.split('-')[0]));
  utterance.voice = exact || languageMatch || null;

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function unlockSpeech() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}
