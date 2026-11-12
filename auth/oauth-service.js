import { hashSecret, newSecret, transitionInvitation } from './invitation-machine.js';
const owner = Object.freeze({authenticated:true,role:'owner'});
export const requiredScopes = value => {
  const scopes=Array.isArray(value)?value:String(value ?? '').split(/[ ,]+/).filter(Boolean);
  if(!scopes.includes('activity:read_all') || scopes.some(scope=>!['read','activity:read_all'].includes(scope))) throw new Error('authorization_failed');
  return ['activity:read_all'];
};
function normalizeTokens(raw, scopes, now, previous) {
  if(typeof raw.access_token!=='string'||!raw.access_token||raw.access_token.length>8192||typeof raw.refresh_token!=='string'||!raw.refresh_token||raw.refresh_token.length>8192||!Number.isFinite(raw.expires_at)||raw.expires_at<=Math.floor(now/1000)) throw new Error('authorization_failed');
  const athleteId=raw.athlete?.id ?? previous?.athleteId;
  if(!Number.isSafeInteger(athleteId)||athleteId<=0 || (previous&&athleteId!==previous.athleteId)) throw new Error('authorization_failed');
  if(raw.scope!==undefined) requiredScopes(raw.scope);
  return {accessToken:raw.access_token,refreshToken:raw.refresh_token,expiresAt:raw.expires_at,athleteId,scopes};
}
export function createOAuthService({repository,provider,vault,origin='https://albertoybelen.ddev.site',clock=Date.now}) {
  const redirectUri=`${origin}/oauth/callback`;
  async function failAttempt({stateHash,sessionHash,leaseHash,cancelled=false}) {
    await repository.updatePrivate(state=>{
      const attempt=state.auth.attempts[stateHash];
      if(!attempt||attempt.exchangeLease?.hash!==leaseHash)return;
      const next=transitionInvitation(state.auth,{type:'callback',now:clock(),stateHash,sessionHash,cancelled,providerStatus:'invalid',scopes:[]});state.auth=next.state;
    });
  }
  return {
    async session(existing) {
      const now=clock();
      const raw=typeof existing==='string'&&/^[\w-]{43}$/.test(existing)?existing:newSecret();
      const hash=hashSecret(raw);
      await repository.updatePrivate(state=>{
        for(const [id,s] of Object.entries(state.oauthSessions)) if(s.expiresAt<=now)delete state.oauthSessions[id];
        if(!state.oauthSessions[hash] && raw===existing)throw new Error('invalid_session');
        if(Object.keys(state.oauthSessions).length>=1000)throw new Error('temporarily_unavailable');
        state.oauthSessions[hash]={expiresAt:now+600000};
      });
      return raw;
    },
    async start({token,session}) {
      await vault.ready();
      if(typeof token!=='string'||!/^[\w-]{43}$/.test(token)||typeof session!=='string')throw new Error('authorization_failed');
      const stateSecret=newSecret(),now=clock();
      const ok=await repository.updatePrivate(state=>{
        if((state.oauthSessions[hashSecret(session)]?.expiresAt??0)<=now)return false;
        const next=transitionInvitation(state.auth,{type:'begin',now,tokenHash:hashSecret(token),stateHash:hashSecret(stateSecret),sessionHash:hashSecret(session)});state.auth=next.state;return next.result.ok;
      });
      if(!ok)throw new Error('authorization_failed');
      return provider.authorizeUrl({state:stateSecret,redirectUri});
    },
    async callback({state:stateSecret,session,code,scope,error}) {
      await vault.ready();
      if(typeof stateSecret!=='string'||!/^[\w-]{43}$/.test(stateSecret)||typeof session!=='string')throw new Error('authorization_failed');
      const stateHash=hashSecret(stateSecret),sessionHash=hashSecret(session),leaseHash=hashSecret(newSecret());
      const claimed=await repository.updatePrivate(state=>{
        const attempt=state.auth.attempts[stateHash];const invite=attempt&&state.auth.invitations[attempt.invitationHash];
        if(!attempt||attempt.status!=='pending'||attempt.sessionHash!==sessionHash||attempt.expiresAt<=clock()||invite?.status!=='reserved'||invite.expiresAt<=clock()||attempt.exchangeLease||(state.oauthSessions[sessionHash]?.expiresAt??0)<=clock())return false;
        const slot=state.auth.slots.find(s=>s.id===attempt.slot);if(!slot||slot.generation!==attempt.generation)return false;
        attempt.exchangeLease={hash:leaseHash};return true;
      });
      if(!claimed)throw new Error('authorization_failed');
      try {
        if(error) {await failAttempt({stateHash,sessionHash,leaseHash,cancelled:true});return false;}
        const scopes=requiredScopes(scope);
        if(typeof code!=='string'||!code||code.length>2048)throw new Error('authorization_failed');
        const raw=await provider.exchange(code);
        const tokens=normalizeTokens(raw,scopes,clock());
        const success=await repository.updatePrivate(async state=>{
          const attempt=state.auth.attempts[stateHash];if(!attempt||attempt.exchangeLease?.hash!==leaseHash)return false;
          const next=transitionInvitation(state.auth,{type:'callback',now:clock(),stateHash,sessionHash,accountHash:hashSecret(String(tokens.athleteId)),providerStatus:'valid',scopes});
          state.auth=next.state;if(!next.result.ok)return false;
          for(const event of next.effects) repository.applyPrivateEffect(state,event);
          const slot=state.auth.slots.find(s=>s.id===attempt.slot);
          const version=(state.sealedTokens[slot.id]?.version??0)+1;
          state.sealedTokens[slot.id]=await vault.seal(tokens,{slot:slot.id,generation:slot.generation,version});return true;
        });
        return success;
      } catch {await failAttempt({stateHash,sessionHash,leaseHash});throw new Error('authorization_failed');}
    },
    async credentials(slotId) {
      const read=await repository.read();const row=read.state.sealedTokens[slotId];const slot=read.state.auth.slots.find(s=>s.id===slotId);
      if(!row||slot?.status!=='connected'||slot.generation!==row.generation)throw new Error('authorization_required');
      if(row.refreshRetryAt>clock())throw new Error('refresh_deferred');
      const tokens=await vault.open(row,{slot:slotId,generation:slot.generation,version:row.version});
      if(tokens.expiresAt>Math.floor(clock()/1000)+60) {
        const latest=(await repository.read()).state;
        if(latest.auth.slots.find(s=>s.id===slotId)?.status!=='connected'||latest.sealedTokens[slotId]?.version!==row.version||latest.sealedTokens[slotId]?.generation!==row.generation)throw new Error('authorization_required');
        return tokens;
      }
      const leaseHash=hashSecret(newSecret());
      const reserved=await repository.updatePrivate(state=>{
        const current=state.sealedTokens[slotId];if(!current||current.version!==row.version||current.generation!==slot.generation)return false;
        if(current.refreshLease?.expiresAt>clock())return false;
        current.refreshLease={hash:leaseHash,expiresAt:clock()+30000};return true;
      });
      if(!reserved)throw new Error('refresh_in_progress');
      try {
        const next=normalizeTokens(await provider.refresh(tokens.refreshToken),tokens.scopes,clock(),tokens);
        const saved=await repository.updatePrivate(async state=>{
          const current=state.sealedTokens[slotId];if(!current||current.version!==row.version||current.refreshLease?.hash!==leaseHash||state.auth.slots.find(s=>s.id===slotId)?.status!=='connected')return false;
          state.sealedTokens[slotId]=await vault.seal(next,{slot:slotId,generation:slot.generation,version:row.version+1});return true;
        });
        if(!saved)throw new Error('authorization_required');return next;
      } catch(error) {
        await repository.updatePrivate(state=>{
          const current=state.sealedTokens[slotId];if(current?.refreshLease?.hash!==leaseHash)return;
          if(error.message==='provider_revoked') {
            const next=transitionInvitation(state.auth,{type:'revoke',now:clock(),slot:slotId,actor:owner});state.auth=next.state;for(const event of next.effects)repository.applyPrivateEffect(state,event);
          } else {delete current.refreshLease;current.refreshRetryAt=clock()+60000;const p=state.policy.participants.find(p=>p.id===slotId);if(p?.connected)p.stale=true;}
        });
        throw new Error('refresh_failed');
      }
    },
    async rotate(slotId) {
      await vault.ready();
      return repository.updatePrivate(async state=>{
        const row=state.sealedTokens[slotId];if(!row||row.refreshLease?.expiresAt>clock())throw new Error('vault_unavailable');
        const tokens=await vault.open(row,{slot:slotId,generation:row.generation,version:row.version});
        state.sealedTokens[slotId]=await vault.seal(tokens,{slot:slotId,generation:row.generation,version:row.version+1});
      });
    },
  };
}
