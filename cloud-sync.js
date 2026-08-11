/*
 * OoFR cloud sync uses Supabase Auth and PostgREST without a bundled SDK.
 * The public anon key is safe to expose in a browser only when the database
 * RLS policies in supabase-schema.sql are enabled. Never put service_role here.
 */
(function attachOoFRCloud(global) {
  const SESSION_KEY = "oofr.cloud.session.v1";

  function getConfig() {
    const config = global.OOFR_SUPABASE_CONFIG || {};
    return {
      url: String(config.url || "").replace(/\/$/, ""),
      anonKey: String(config.anonKey || "")
    };
  }

  function isConfigured() {
    const config = getConfig();
    return Boolean(config.url && config.anonKey);
  }

  function readStoredSession() {
    try {
      const raw = global.localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    if (!session) {
      global.localStorage.removeItem(SESSION_KEY);
      return;
    }
    global.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function headers(accessToken = "") {
    const config = getConfig();
    return {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken || config.anonKey}`,
      "Content-Type": "application/json"
    };
  }

  async function readResponse(response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = body.error_description || body.msg || body.message || body.error || `云端请求失败（${response.status}）`;
      throw new Error(message);
    }
    return body;
  }

  function sessionFromLocation() {
    const hash = new URLSearchParams(global.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    if (!accessToken || !refreshToken) return null;

    const session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: hash.get("token_type") || "bearer",
      expires_in: Number(hash.get("expires_in") || 3600),
      expires_at: Math.floor(Date.now() / 1000) + Number(hash.get("expires_in") || 3600),
      user: null
    };
    saveSession(session);
    global.history.replaceState({}, global.document.title, `${global.location.pathname}${global.location.search}`);
    return session;
  }

  async function refreshSession(session) {
    const config = getConfig();
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const next = await readResponse(response);
    const refreshed = { ...next, expires_at: Math.floor(Date.now() / 1000) + Number(next.expires_in || 3600) };
    saveSession(refreshed);
    return refreshed;
  }

  async function getSession() {
    if (!isConfigured()) return null;
    const fromLocation = sessionFromLocation();
    const session = fromLocation || readStoredSession();
    if (!session?.access_token) return null;
    if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60) {
      if (!session.refresh_token) return null;
      try {
        return await refreshSession(session);
      } catch {
        saveSession(null);
        return null;
      }
    }
    if (!session.user?.id) {
      const config = getConfig();
      const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: headers(session.access_token)
      });
      session.user = await readResponse(response);
      saveSession(session);
    }
    return session;
  }

  async function requestMagicLink(email) {
    const config = getConfig();
    if (!isConfigured()) throw new Error("尚未配置 Supabase 云端参数");
    const response = await fetch(`${config.url}/auth/v1/otp`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        email,
        create_user: true,
        gotrue_meta_security: {},
        email_redirect_to: global.location.href.split("#")[0]
      })
    });
    await readResponse(response);
  }

  async function signOut(session) {
    const config = getConfig();
    if (session?.access_token && isConfigured()) {
      await fetch(`${config.url}/auth/v1/logout`, {
        method: "POST",
        headers: headers(session.access_token)
      }).catch(() => {});
    }
    saveSession(null);
  }

  async function fetchSnapshot(session) {
    const config = getConfig();
    const userId = session?.user?.id;
    if (!userId) return null;
    const query = encodeURIComponent(userId);
    const response = await fetch(`${config.url}/rest/v1/oofr_user_data?select=payload,updated_at&user_id=eq.${query}`, {
      headers: headers(session.access_token)
    });
    const rows = await readResponse(response);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async function saveSnapshot(session, payload) {
    const config = getConfig();
    const userId = session?.user?.id;
    if (!userId) throw new Error("登录状态中缺少用户 ID");
    const response = await fetch(`${config.url}/rest/v1/oofr_user_data?on_conflict=user_id`, {
      method: "POST",
      headers: {
        ...headers(session.access_token),
        Prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify([{ user_id: userId, payload, updated_at: new Date().toISOString() }])
    });
    const rows = await readResponse(response);
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  global.OoFRCloud = {
    isConfigured,
    getSession,
    requestMagicLink,
    signOut,
    fetchSnapshot,
    saveSnapshot
  };
})(window);
