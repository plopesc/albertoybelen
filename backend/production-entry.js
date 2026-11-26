import {createProductionWorker} from './production-worker.js';

const app = createProductionWorker();
export default {
  fetch(request,env) { return app.fetch(request,env); },
  scheduled(event,env,ctx) { ctx.waitUntil(app.scheduled(event,env)); },
};
