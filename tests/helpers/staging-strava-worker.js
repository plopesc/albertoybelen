// Workerd-only synthetic HTTP provider. No real outbound path or personal data.
import {WorkerEntrypoint} from 'cloudflare:workers';
let requests=0;
export default class extends WorkerEntrypoint {
  count(){return requests;}
  async fetch(request) {
    const url=new URL(request.url);if(url.origin!=='https://www.strava.com')return new Response('Mock rejected',{status:502});requests++;
    if(url.pathname==='/oauth/token'&&request.method==='POST') {
      const body=new URLSearchParams(await request.text()),raw=body.get(body.get('grant_type')==='refresh_token'?'refresh_token':'code');
      const id=Number(raw?.split('-').at(-1));if(![101,202].includes(id))return Response.json({error:'invalid_grant'},{status:400});
      return Response.json({access_token:`synthetic-access-${id}`,refresh_token:`synthetic-refresh-${id}`,expires_at:Math.floor(Date.now()/1000)+3600,athlete:{id},scope:'activity:read_all'});
    }
    if(url.pathname==='/api/v3/athlete/activities'&&request.method==='GET') {
      if(!['Bearer synthetic-access-101','Bearer synthetic-access-202'].includes(request.headers.get('Authorization')))return new Response('Mock rejected',{status:401});
      return Response.json(url.searchParams.get('page')==='1'?[{id:1,distance:1000,start_date:'2026-11-01T10:00:00Z',sport_type:'Run',manual:false,private:true}]:[]);
    }
    return new Response('Mock rejected',{status:502});
  }
}
