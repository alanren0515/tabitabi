const COPY = {
  ja: {title:"任意の料金調査",body:"この案を検討しますか？現在は研究案です。回答しても購入・予約・課金にはなりません。",scope:"最大 {items} 店舗、各 {reviews} 回の確認",period:{one_time:"1回",week:"{count}週間",month:"{count}か月"},tax:{included:"税込",excluded:"税別"},boundary:"リアルタイムの空席や予約成立を保証しません。連絡先は収集しません。",choices:{interested:"検討したい",not_needed:"必要ない",too_expensive:"高すぎる",unsure:"わからない"},submit:"この案について回答",accepted:"料金調査の回答を受け付けました。購入は発生していません。",failed:"送信できませんでした。入力は残っています。"},
  en: {title:"Optional price research",body:"Would you consider this proposal? It is a research proposal. Answering does not purchase, book or charge anything.",scope:"Up to {items} restaurants, {reviews} checks each",period:{one_time:"one time",week:"{count} weeks",month:"{count} months"},tax:{included:"tax included",excluded:"tax excluded"},boundary:"No real-time availability or booking guarantee. No contact details collected.",choices:{interested:"Interested",not_needed:"Not needed",too_expensive:"Too expensive",unsure:"Not sure"},submit:"Respond to this proposal",accepted:"Research response received. No purchase was made.",failed:"Could not send. Your choice remains."},
  "zh-CN": {title:"可选价格研究",body:"你会考虑这个方案吗？目前是研究方案，回答不会购买、预约或扣款。",scope:"最多 {items} 家餐厅，每家核对 {reviews} 次",period:{one_time:"一次",week:"{count} 周",month:"{count} 个月"},tax:{included:"含税",excluded:"未含税"},boundary:"不保证实时空席或预约成立，不收集联系方式。",choices:{interested:"有兴趣",not_needed:"不需要",too_expensive:"太贵",unsure:"不确定"},submit:"回答此方案",accepted:"已收到价格研究回答，没有发生购买。",failed:"提交失败，你的选择仍保留。"}
};
export function offerResearchCopy(locale) {return COPY[locale] || COPY.ja;}
export function offerResearchHtml(config, {locale="ja", esc, now=Date.now()}={}) {
  if(config?.schemaVersion!==1 || config.enabled!==true || !Array.isArray(config.offers)) return "";
  const offer=config.offers.find(item=>item.audience==="consumer" && item.status==="active" && item.activeForResearch===true && item.researchOnly===true && item.purchaseAvailable===false
    && Date.parse(item.validity?.startsAt)<=now && now<Date.parse(item.validity?.expiresAt));
  const copy=offerResearchCopy(locale); const decimals={JPY:0,USD:2,EUR:2};
  if(!offer || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(offer.offerId) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(offer.offerVersion)
    || !Object.hasOwn(decimals,offer.price?.currency) || !Number.isSafeInteger(offer.price.amountMinor) || offer.price.amountMinor<0
    || !copy.tax[offer.price.taxTreatment] || !copy.period[offer.period?.unit] || !Number.isSafeInteger(offer.period.count) || offer.period.count<1
    || !Number.isSafeInteger(offer.scope?.maxItems) || offer.scope.maxItems<1 || offer.scope.maxItems>20 || !Number.isSafeInteger(offer.scope.reviewsPerItem) || offer.scope.reviewsPerItem<1
    || offer.scope.noRealtimeAvailability!==true || offer.scope.noBookingGuarantee!==true || offer.dataScope?.contactCollection!==false) return "";
  const price=new Intl.NumberFormat(locale,{style:"currency",currency:offer.price.currency}).format(offer.price.amountMinor/10**decimals[offer.price.currency]);
  const period=copy.period[offer.period.unit].replace("{count}",offer.period.count);
  const scope=copy.scope.replace("{items}",offer.scope.maxItems).replace("{reviews}",offer.scope.reviewsPerItem);
  return '<section class="panel offer-research"><h2>'+copy.title+'</h2><p>'+copy.body+'</p><strong>'+esc(price)+' / '+esc(period)+' · '+copy.tax[offer.price.taxTreatment]+'</strong><p>'+esc(scope)+'</p><p>'+copy.boundary+'</p><form id="offer-research-form" data-offer-id="'+esc(offer.offerId)+'" data-offer-version="'+esc(offer.offerVersion)+'"><fieldset><legend>'+copy.title+'</legend>'+Object.entries(copy.choices).map(([value,label])=>'<label><input type="radio" name="choice" value="'+value+'" required>'+label+'</label>').join("")+'</fieldset><button type="submit">'+copy.submit+'</button><p role="status"></p></form></section>';
}
