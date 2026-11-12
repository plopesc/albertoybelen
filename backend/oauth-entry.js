import {createD1Repository} from './d1/repository.js';
import {createWorker} from './worker.js';
import {createTokenVault} from '../auth/token-vault.js';
import {createOAuthService} from '../auth/oauth-service.js';
import {createMockProvider,createStravaAdapter} from '../auth/strava-adapter.js';
import {createOAuthRouter} from './oauth-http.js';
const origin='https://albertoybelen.ddev.site';
const mockProvider=createMockProvider(origin);
export function localOAuth(env,providerOverride) {
 if(env.APP_ENV!=='local-fixtures'||!env.DB||!['mock','real'].includes(env.OAUTH_MODE))throw new Error('local_oauth_disabled');
 if(env.OAUTH_MODE==='real'&&env.ALLOW_REAL_OAUTH!=='explicit-owner-opt-in')throw new Error('real_oauth_disabled');
 const repository=createD1Repository(env.DB);
 const version=env.TOKEN_ENCRYPTION_KEY_VERSION||'v1';
 const keys={[version]:env.TOKEN_ENCRYPTION_KEY};
 if(env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION===version)throw new Error('vault_unavailable');
 if(env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION)keys[env.TOKEN_PREVIOUS_ENCRYPTION_KEY_VERSION]=env.TOKEN_PREVIOUS_ENCRYPTION_KEY;
 const vault=createTokenVault({keys,activeVersion:version});
 const provider=providerOverride??(env.OAUTH_MODE==='mock'?mockProvider:createStravaAdapter({enabled:true,clientId:env.STRAVA_CLIENT_ID,clientSecret:env.STRAVA_CLIENT_SECRET}));
 const service=createOAuthService({repository,provider,vault,origin});
 return {repository,service,vault,router:createOAuthRouter({service,provider,origin,mock:env.OAUTH_MODE==='mock',publicWorker:createWorker({repository,loadFixture:async()=>[]})})};
}
export default {async fetch(request,env) {
 try{return await localOAuth(env).router.fetch(request);}catch{return new Response('Local authorization unavailable',{status:503,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
}};
