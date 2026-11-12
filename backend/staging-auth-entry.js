import {createStagingAuth} from './staging-auth.js';
export default {
  async fetch(request,env) {
    try {return await createStagingAuth(env).fetch(request);}
    catch {return Response.json({error:'staging_auth_unavailable'},{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
  },
  // No scheduled handler, sync endpoint or public administration route.
};
