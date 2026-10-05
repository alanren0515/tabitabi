import test from 'node:test';
import assert from 'node:assert/strict';
import {offerResearchHtml} from '../src/offer-research-ui.js';
const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const now=Date.parse('2026-10-03T00:00:00Z');
const proposal={offerId:'synthetic-consumer',offerVersion:'v1',audience:'consumer',status:'active',activeForResearch:true,researchOnly:true,purchaseAvailable:false,price:{currency:'JPY',amountMinor:350,taxTreatment:'included'},period:{unit:'one_time',count:1},validity:{startsAt:'2026-10-01T00:00:00Z',expiresAt:'2026-10-10T00:00:00Z'},scope:{maxItems:5,reviewsPerItem:1,noRealtimeAvailability:true,noBookingGuarantee:true},dataScope:{contactCollection:false}};
const config=()=>({schemaVersion:1,enabled:true,offers:[structuredClone(proposal)]});
test('hides inactive, expired, business and unbounded proposals',()=>{
  assert.equal(offerResearchHtml({schemaVersion:1,enabled:false,offers:[]},{esc,now}),'');
  for(const alter of [offer=>offer.validity.expiresAt='2026-10-02T00:00:00Z',offer=>offer.audience='business_maintenance',offer=>offer.price.amountMinor=null,offer=>offer.scope.maxItems=100,offer=>offer.purchaseAvailable=true,offer=>offer.dataScope.contactCollection=true]) {
    const value=config();alter(value.offers[0]);assert.equal(offerResearchHtml(value,{esc,now}),'');
  }
});
test('local synthetic proposal renders optional interest without purchase or contact fields in each language',()=>{
  for(const locale of ['ja','en','zh-CN']) {
    const html=offerResearchHtml(config(),{esc,now,locale});
    assert.ok(html.includes('350'));assert.equal((html.match(/type="radio"/g)||[]).length,4);
    assert.doesNotMatch(html,/type="email"|name="email"|name="payment"/);
    assert.match(html,/予約・課金にはなりません|does not purchase|不会购买、预约或扣款/);
  }
});
