// Browser fixture values only; production profiles are loaded from FastAPI.
export const intentProfilesFixture = [
  {profile_id:'standard',name:'Standard',priority:'NORMAL',require_reachability:true,max_loss_percent:5,max_avg_rtt_ms:100},
  {profile_id:'interactive',name:'Interactive / Low Latency',priority:'HIGH',require_reachability:true,max_loss_percent:1,max_avg_rtt_ms:25},
  {profile_id:'reliable',name:'Reliable',priority:'CRITICAL',require_reachability:true,max_loss_percent:0,max_avg_rtt_ms:100},
  {profile_id:'bulk',name:'Bulk / Throughput-Tolerant',priority:'LOW',require_reachability:true,max_loss_percent:10,max_avg_rtt_ms:250},
];
