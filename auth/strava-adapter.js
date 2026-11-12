export function createStravaAdapter({ clientId, clientSecret, fetchProvider = fetch, enabled = false } = {}) {
  function allowed() { if (!enabled || !clientId || !clientSecret) throw new Error('provider_disabled'); }
  return {
    authorizeUrl({ state, redirectUri }) {
      allowed();
      const url = new URL('https://www.strava.com/oauth/authorize');
      url.search = new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',approval_prompt:'force',scope:'activity:read_all',state});
      return url.href;
    },
    async exchange(code) { allowed(); return token({code,grant_type:'authorization_code'}); },
    async refresh(refreshToken) { allowed(); return token({refresh_token:refreshToken,grant_type:'refresh_token'}); },
  };
  async function token(fields) {
    let response;
    try { response = await fetchProvider('https://www.strava.com/oauth/token', {method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,...fields})}); }
    catch { throw new Error('provider_unavailable'); }
    if (!response.ok) {
      if(response.status===429)throw new Error('provider_rate_limited');
      // A bad application secret is not evidence that a participant revoked access.
      const detail=await response.json().catch(()=>null);
      const revoked=detail?.error==='invalid_grant'||(Array.isArray(detail?.errors)&&detail.errors.some(item=>['RefreshToken','AccessToken'].includes(item?.resource)&&item?.code==='invalid'));
      throw new Error(revoked?'provider_revoked':'provider_unavailable');
    }
    try { return await response.json(); } catch { throw new Error('provider_unavailable'); }
  }
}

/** Fake provider: never contacts Strava. Codes exist only in this local mock's memory. */
export function createMockProvider(origin) {
  const codes = new Map();
  return {
    authorizeUrl({state}) { return `${origin}/oauth/mock/authorize?${new URLSearchParams({state})}`; },
    issueCode({athleteId,scopes=['activity:read_all']}) {
      const code = crypto.randomUUID(); codes.set(code,{athleteId,scopes}); return code;
    },
    async exchange(code) {
      const record=codes.get(code);codes.delete(code);if(!record)throw new Error('provider_revoked');
      return {access_token:`fixture-access-${crypto.randomUUID()}`,refresh_token:`fixture-refresh-${crypto.randomUUID()}`,expires_at:Math.floor(Date.now()/1000)+3600,athlete:{id:record.athleteId},scope:record.scopes.join(',')};
    },
    async refresh() { return {access_token:`fixture-access-${crypto.randomUUID()}`,refresh_token:`fixture-refresh-${crypto.randomUUID()}`,expires_at:Math.floor(Date.now()/1000)+3600}; },
  };
}
