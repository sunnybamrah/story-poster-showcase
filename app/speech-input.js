// Browser speech only. No audio files, automatic restarts, or paid fallback.
export function createSpeechInput({ Recognition, getOwner, getText, onText, onState, requestMicrophone, maxLength = 2000, lang = 'en-US' }) {
  let active = null;
  const report = (state, message = '', interim = '', reason = '') => onState({ state, message, interim, reason });
  const current = run => active === run && getOwner() === run.owner;
  const detach = run => { run.recognition.onresult = null; run.recognition.onerror = null; run.recognition.onend = null; };
  const finish = (run, keepPartial = true) => {
    if (!current(run)) return;
    if (keepPartial && run.interim) onText((getText().trimEnd() + ' ' + run.interim).trim().slice(0, maxLength));
    active = null; detach(run); report('idle', 'Stopped. Check and edit your words before creating.');
    try { run.recognition.abort(); } catch {}
  };
  return {
    supported: typeof Recognition === 'function',
    start() {
      if (active) return;
      if (typeof Recognition !== 'function') { report('idle', 'Talk is not available in this browser. You can still type or use the microphone on your phone keyboard.'); return; }
      const run = { recognition: new Recognition(), owner: getOwner(), interim: '' };
      active = run;
      const r = run.recognition; r.lang = lang; r.continuous = true; r.interimResults = true;
      r.onresult = event => {
        if (!current(run)) return;
        const finals = []; const partials = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i], words = String(result[0]?.transcript ?? '').trim();
          if (words) (result.isFinal ? finals : partials).push(words);
        }
        run.interim = partials.join(' ');
        if (finals.length) onText((getText().trimEnd() + ' ' + finals.join(' ')).trim().slice(0, maxLength));
        report('listening', 'Listening. Tap Stop when you finish.', run.interim);
        if (getText().length >= maxLength) finish(run, false);
      };
      r.onerror = event => {
        if (!current(run)) return;
        finish(run);
        report('idle', ['not-allowed', 'service-not-allowed'].includes(event.error) ? 'Microphone or speech access was not allowed. Your words are kept. Check microphone access below, then tap Talk again.' : event.error === 'audio-capture' ? 'No microphone was available. Close another recording app, then try again.' : event.error === 'no-speech' ? 'No speech was heard. Tap Talk to try again, or type here.' : 'Talk stopped. Your words are kept. Try again or keep typing.', '', event.error);
      };
      // Safari may end after one utterance. A new tap always starts the next one.
      r.onend = () => finish(run);
      report('listening', 'Listening. Tap Stop when you finish.');
      try { r.start(); } catch { finish(run, false); report('idle', 'Talk could not start. You can still type here.'); }
    },
    async checkMicrophone() {
      if (active) finish(active);
      const owner = getOwner();
      if (!requestMicrophone) { report('idle', 'Open this page in Safari or Chrome. You can also use the microphone on your phone keyboard.'); return; }
      report('checking', 'Checking microphone access…');
      let stream;
      try {
        stream = await requestMicrophone();
        if (getOwner() === owner) report('idle', 'Microphone access is ready. Tap Talk again. If speech stays unavailable, use the microphone on your phone keyboard.');
      } catch {
        if (getOwner() === owner) report('idle', 'Microphone access is still blocked. On iPhone, open the page menu, Website Settings, then allow Microphone. Your typed words stay here.', '', 'not-allowed');
      } finally { for (const track of stream?.getTracks?.() ?? []) track.stop(); }
    },
    stop() { if (active) finish(active); },
    cancel() {
      const run = active; active = null;
      if (!run) return;
      detach(run); try { run.recognition.abort(); } catch {}
    },
  };
}
