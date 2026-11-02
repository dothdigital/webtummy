import { expect, it } from 'vitest';
import { websitePlanEvidenceJson } from './website-plan-evidence.js';
it('serializes missing website, opportunity, Growth evidence and optional business facts without the reported slice crash', () => {
 for(const value of [undefined,null]) expect(websitePlanEvidenceJson(value,12000)).toBe('null');
 expect(websitePlanEvidenceJson({website:null,domain:null,address:null,phone:null,services:['cleaning']},12000)).toContain('"services":["cleaning"]');
});
