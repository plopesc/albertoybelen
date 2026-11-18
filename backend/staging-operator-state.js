const automaticStatuses=new Set(['synced','idle','busy','stale','disabled','failed']);

/** Durable private staging controls; old documents default to automatic sync OFF. */
export function stagingOperatorState(state) {
  const control=state.stagingOperator??={syncDisabled:true,epoch:0,receipts:{},audit:[]};
  control.autoSyncEnabled??=false;
  control.autoSyncEpoch??=0;
  control.lastAutomaticSync??=null;
  if(typeof control.syncDisabled!=='boolean'||!Number.isSafeInteger(control.epoch)||control.epoch<0||
    typeof control.autoSyncEnabled!=='boolean'||!Number.isSafeInteger(control.autoSyncEpoch)||control.autoSyncEpoch<0||
    (control.lastAutomaticSync!==null&&(!control.lastAutomaticSync||Object.keys(control.lastAutomaticSync).sort().join()!=='at,status'||typeof control.lastAutomaticSync.at!=='string'||!Number.isFinite(Date.parse(control.lastAutomaticSync.at))||!automaticStatuses.has(control.lastAutomaticSync.status))))throw Error('staging_operator_state_invalid');
  return control;
}

export function automaticSyncStatus(status) {
  return automaticStatuses.has(status)?status:'failed';
}
