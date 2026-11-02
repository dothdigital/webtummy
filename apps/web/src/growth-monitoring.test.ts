import { expect,it } from 'vitest';
import {monitoringGuide} from './growth-monitoring.js';
const source={key:'analytics',status:'skipped',recordCount:0,restrictionReason:null,skipReason:'Source is not due for collection yet.'};
it('does not ask users to restart a check that is not due',()=>{expect(monitoringGuide(source,'p')).toMatchObject({label:'Waiting for next check',needsAction:false});});
it('gives missing business-profile data a relevant setup action',()=>{expect(monitoringGuide({...source,key:'google_business_profile',status:'restricted',restrictionReason:'No snapshot'},'p')).toMatchObject({label:'Needs setup or data',needsAction:true,url:'/local-seo?projectId=p'});});
it('does not treat a completed check as completed growth work',()=>{expect(monitoringGuide({...source,status:'completed',recordCount:1},'p').instruction).toContain('does not mean every issue is fixed');});
