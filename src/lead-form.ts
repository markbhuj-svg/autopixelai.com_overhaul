type Turnstile = {
  render: (target: HTMLElement, options: {
    sitekey: string;
    action: string;
    size: 'normal' | 'compact';
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => string;
  reset: (widget: string) => void;
};

export function bindLeadForm(form: HTMLFormElement, options: {
  requestType: string | ((fields: FormData) => string);
  preview: (fields: FormData) => void;
}) {
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const note = form.querySelector<HTMLElement>('[data-lead-note]')!;
  const status = form.querySelector<HTMLElement>('[data-lead-status]')!;
  const challenge = form.querySelector<HTMLElement>('[data-lead-security]')!;
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  let token = '';
  let widget: string | undefined;
  let pending = false;
  let reference: string | undefined;

  form.addEventListener('input', () => {
    if (!pending) {
      reference = undefined;
      status.textContent = '';
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const fields = new FormData(form);
    if (localPreview) {
      options.preview(fields);
      return;
    }
    if (!token) return;

    const details = Object.fromEntries(fields);
    const name = details.name;
    delete details.name;
    delete details.topic;
    const [firstName, ...lastName] = typeof name === 'string' ? name.trim().split(/\s+/) : [];
    const requestType = typeof options.requestType === 'function' ? options.requestType(fields) : options.requestType;
    const leadId = reference ??= crypto.randomUUID();
    const payload = {
      ...details,
      ...(typeof name === 'string' ? { firstName, lastName: lastName.join(' ') } : {}),
      consent: fields.has('consent'),
      sourcePage: location.pathname,
      requestType,
      leadId,
      turnstileToken: token,
    };
    const controls = [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')]
      .filter((control) => !control.disabled);
    pending = true;
    submit.disabled = true;
    controls.forEach((control) => { control.disabled = true; });
    status.textContent = 'Sending your enquiry…';
    try {
      const result = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45000),
      });
      const response = await result.json();
      if (result.status === 202) {
        form.reset();
        reference = undefined;
        status.textContent = `We received your enquiry. Reference ${leadId.slice(0, 8)}.`;
      } else {
        status.textContent = response.message || 'Submission failed. Please try again.';
      }
    } catch {
      status.textContent = 'We couldn’t confirm your enquiry. Your entries are still here. Try again or email team@autopixelai.com.';
    } finally {
      pending = false;
      token = '';
      controls.forEach((control) => { control.disabled = false; });
      if (widget !== undefined) turnstile()?.reset(widget);
    }
  });

  if (localPreview) {
    note.hidden = false;
    submit.disabled = false;
    return;
  }

  async function prepare() {
    try {
      const response = await fetch('/api/lead-config', { signal: AbortSignal.timeout(8000) });
      const config = await response.json();
      if (!response.ok || !config.enabled || !config.turnstileSiteKey) throw Error('Unavailable');
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(reject, 15000);
        script.onload = () => { clearTimeout(timeout); resolve(); };
        script.onerror = () => { clearTimeout(timeout); reject(); };
        document.head.append(script);
      });
      widget = turnstile()!.render(challenge, {
        sitekey: config.turnstileSiteKey,
        action: 'lead',
        size: challenge.clientWidth < 300 ? 'compact' : 'normal',
        callback: (value) => {
          token = value;
          submit.disabled = pending;
        },
        'expired-callback': () => { token = ''; submit.disabled = true; },
        'error-callback': () => {
          token = '';
          submit.disabled = true;
          status.textContent = 'The security check did not load. Please reload or email team@autopixelai.com.';
        },
      });
    } catch {
      status.textContent = 'Online enquiries are temporarily unavailable. Please email team@autopixelai.com.';
    }
  }

  void prepare();
}

function turnstile() {
  return (window as Window & { turnstile?: Turnstile }).turnstile;
}
