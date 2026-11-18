import {createStagingMvp,createMvpRateLimit} from './staging-mvp.js';
let previous,application;
const admit=createMvpRateLimit();
function app(env){if(previous!==env){previous=env;application=createStagingMvp(env,{admit});}return application;}
export default {
  fetch(request,env) {return app(env).fetch(request);},
  scheduled(event,env,context) {return app(env).scheduled(event,env,context);},
};
