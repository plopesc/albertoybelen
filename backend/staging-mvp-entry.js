import {createStagingMvp,createMvpRateLimit} from './staging-mvp.js';
let previous,application;
const admit=createMvpRateLimit();
export default {
  fetch(request,env) {
    if(previous!==env){previous=env;application=createStagingMvp(env,{admit});}
    return application.fetch(request);
  },
  // Manual sync only. No scheduled handler, RPC binding or second Worker.
};
