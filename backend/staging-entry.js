import localBackend from './d1/entry.js';

/** Synthetic staging API only: reuse the backend and DB schema, export no schedule/OAuth. */
export default {
  async fetch(request, env) {
    if (env.APP_ENV !== 'staging-fixtures' || !env.DB) return Response.json({error:'staging_unavailable'}, {status:503,headers:{'Cache-Control':'no-store'}});
    return localBackend.fetch(request, {APP_ENV:'local-fixtures',DB:env.DB});
  },
};
