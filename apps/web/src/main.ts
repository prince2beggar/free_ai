import { examples, getReply, validateDemoConfig, type Language } from './mock.js';

function element<T extends HTMLElement>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error('The demo interface could not load.');
  return value;
}
const form = element<HTMLFormElement>('#composer');
const input = element<HTMLTextAreaElement>('#message');
const messages = element<HTMLDivElement>('#messages');
const welcome = element<HTMLDivElement>('#welcome');
const examplesPanel = element<HTMLDivElement>('#examples');
const send = element<HTMLButtonElement>('#send');
const stop = element<HTMLButtonElement>('#stop');
const status = element<HTMLParagraphElement>('#status');
const counter = element<HTMLSpanElement>('#counter');
let language: Language = 'en';
let messageCount = 0;
let generation = 0;
let busy = false;

async function start(): Promise<void> {
  const response = await fetch('/demo.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('The demo configuration could not load.');
  const config = validateDemoConfig((await response.json()) as unknown);
  input.maxLength = config.maxInputChars;
  input.disabled = false;
  send.disabled = false;

  function updateInput(): void {
    counter.textContent = `${input.value.length} / ${config.maxInputChars}`;
    send.disabled = busy || input.value.trim().length === 0 || messageCount >= config.maxMessages;
  }
  function renderExamples(): void {
    examplesPanel.replaceChildren();
    for (const [index, prompt] of examples[language].entries()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'prompt-card';
      const mark = document.createElement('span');
      mark.className = 'prompt-icon';
      mark.textContent = ['≡', '文', '↗'][index] ?? '↗';
      const label = document.createElement('span');
      label.textContent = prompt;
      button.append(mark, label);
      button.addEventListener('click', () => {
        input.value = prompt;
        updateInput();
        input.focus();
      });
      examplesPanel.append(button);
    }
  }
  function addMessage(role: 'user' | 'assistant', content: string): HTMLParagraphElement {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    article.lang = language;
    const label = document.createElement('p');
    label.className = 'message-label';
    label.textContent =
      role === 'user'
        ? language === 'bn'
          ? 'আপনি'
          : 'You'
        : language === 'bn'
          ? 'নমুনা উত্তর'
          : 'Sample response';
    const text = document.createElement('p');
    text.className = 'message-body';
    text.textContent = content;
    article.append(label, text);
    messages.append(article);
    article.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return text;
  }
  function finish(): void {
    busy = false;
    stop.hidden = true;
    send.hidden = false;
    updateInput();
  }
  function cancel(): void {
    generation += 1;
    finish();
    status.textContent =
      language === 'bn' ? 'ডেমো উত্তর থামানো হয়েছে।' : 'Sample response stopped.';
  }
  stop.addEventListener('click', cancel);
  input.addEventListener('input', updateInput);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });
  element<HTMLButtonElement>('#new-chat').addEventListener('click', () => {
    generation += 1;
    finish();
    messages.replaceChildren();
    welcome.hidden = false;
    messageCount = 0;
    input.value = '';
    status.textContent = '';
    updateInput();
    input.focus();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-language]')) {
    button.addEventListener('click', () => {
      if (busy) cancel();
      language = button.dataset.language === 'bn' ? 'bn' : 'en';
      input.lang = language;
      input.placeholder =
        language === 'bn' ? 'একটি নমুনা বার্তা লিখুন…' : 'Try a synthetic demo message…';
      for (const other of document.querySelectorAll<HTMLButtonElement>('[data-language]'))
        other.setAttribute('aria-pressed', String(other === button));
      renderExamples();
    });
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || messageCount >= config.maxMessages) return;
    const content = input.value;
    let reply: string;
    try {
      reply = getReply(content, language, config);
    } catch {
      status.textContent = 'Use a shorter synthetic demo message.';
      return;
    }
    const current = ++generation;
    messageCount += 2;
    busy = true;
    welcome.hidden = true;
    addMessage('user', content);
    const target = addMessage('assistant', '');
    input.value = '';
    updateInput();
    send.hidden = true;
    stop.hidden = false;
    status.textContent =
      language === 'bn' ? 'ডেমো উত্তর দেখানো হচ্ছে…' : 'Showing a sample response…';
    for (let offset = 0; offset < reply.length; offset += 12) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, config.chunkDelayMs));
      if (current !== generation) return;
      target.textContent = reply.slice(0, offset + 12);
    }
    finish();
    status.textContent =
      messageCount >= config.maxMessages ? 'Demo limit reached. Start a new chat to reset.' : '';
    input.focus();
  });
  renderExamples();
  updateInput();
}
void start().catch(() => {
  status.textContent = 'The local demo could not load. Restart the preview and try again.';
});
