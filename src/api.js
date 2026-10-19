export class ButeemjClient {
  constructor(options = {}) {
    this.baseUrl = (options.url ?? process.env.BUTEEMJ_URL ?? 'http://localhost').replace(/\/$/, '');
    this.user = options.user ?? process.env.BUTEEMJ_USER ?? 'admin';
    this.pass = options.pass ?? process.env.BUTEEMJ_PASS ?? 'changeme123';
    this.token = options.token ?? null;
    this.orgCode = options.orgCode ?? null;
  }

  async health() {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { method: 'GET' });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async login() {
    const res = await fetch(`${this.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.user, password: this.pass })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) {
      throw new Error(`Нэвтэрч чадсангүй (${this.baseUrl}): ${body.error ?? res.statusText}`);
    }
    this.token = body.token;

    // Сонгогдсон байгууллагыг тогтоох
    const orgsRes = await fetch(`${this.baseUrl}/api/auth/organisations`, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    const orgsBody = await orgsRes.json().catch(() => ({}));
    const orgs = orgsBody.organisations ?? [];
    if (orgs.length > 0) {
      const pick = this.orgCode ? orgs.find(o => String(o.orgCode ?? o.code) === String(this.orgCode)) : orgs[0];
      if (pick) {
        this.orgCode = String(pick.orgCode ?? pick.code);
        const selRes = await fetch(`${this.baseUrl}/api/auth/select-organisation`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgCode: this.orgCode })
        });
        const selBody = await selRes.json().catch(() => ({}));
        if (selBody.token) {
          this.token = selBody.token;
        }
      }
    }
    return this.token;
  }

  async request(method, path, body = undefined) {
    if (!this.token) {
      await this.login();
    }
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  }

  async lint(files) {
    const res = await this.request('POST', '/admin/solutions/lint', { files });
    return res.body;
  }

  async importSolution(files) {
    const res = await this.request('POST', '/admin/solutions/import', { files });
    if (res.status !== 200) {
      throw new Error(`Импорт амжилтгүй (${res.status}): ${res.body?.error ?? JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async generatePlan(key, resolutions = {}) {
    const res = await this.request('POST', `/admin/solutions/${encodeURIComponent(key)}/plan`, { resolutions });
    if (res.status !== 200) {
      throw new Error(`Plan үүсгэж чадсангүй (${res.status}): ${res.body?.error ?? JSON.stringify(res.body)}`);
    }
    return res.body.plan;
  }

  async applyPlan(key, planHash, resolutions = {}) {
    const res = await this.request('POST', `/admin/solutions/${encodeURIComponent(key)}/apply`, {
      planHash,
      resolutions
    });
    if (res.status !== 200) {
      throw new Error(`Apply амжилтгүй (${res.status}): ${res.body?.error ?? JSON.stringify(res.body)}`);
    }
    return res.body;
  }

  async exportSolution(key, source = 'package') {
    const res = await this.request('GET', `/admin/solutions/${encodeURIComponent(key)}/export?source=${encodeURIComponent(source)}`);
    if (res.status !== 200) {
      throw new Error(`Экспорт амжилтгүй (${res.status}): ${res.body?.error ?? JSON.stringify(res.body)}`);
    }
    return res.body;
  }
}
