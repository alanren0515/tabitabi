import { searchSavedPlans, sortSavedPlansByUrgency } from "./saved-plans.js";
import { pendingWork, batchProgress } from "./analysis-queue.js";

export function taskNavigationHtml(active, { tx }) {
  return `<nav class="task-navigation" aria-label="${tx("navLabel")}">${[["queue", "navQueue"], ["saved", "navSaved"], ["history", "navHistory"]].map(([view, key]) => `<button data-action="${view}"${active === view ? ' aria-current="page"' : ""}>${tx(key)}</button>`).join("")}</nav>`;
}
export function taskRecoveryHtml({ tx }) {
  return `<div class="empty-state" role="status"><h3>${tx("recoveryTitle")}</h3><p>${tx("recoveryBody")}</p></div>`;
}
export function taskListActions(domain, { tx, esc, count = 0, canUndo = false, needsRecovery = false }) {
  if (!count && !canUndo && !needsRecovery) return "";
  return `<div class="task-list-actions">${count || needsRecovery ? `<button data-export-domain="${esc(domain)}">${tx("export")}</button><details class="task-management"><summary>${tx("manageList")}</summary><button class="destructive-button" data-clear-domain="${esc(domain)}">${tx("clear")}</button></details>` : ""}${canUndo ? `<button data-undo-domain="${esc(domain)}">${tx("undo")}</button>` : ""}</div>`;
}
export function savedListHtml(state, { t, tx, esc, formatTime, needsRecovery = false }) {
  const items = sortSavedPlansByUrgency(searchSavedPlans(state.saved, state.savedSearch));
  return `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">${t("common.backHome")}</button>
    ${taskNavigationHtml("saved", { tx })}
    <div class="section-heading"><span class="step-chip">${t("saved.step")}</span><h2>${t("saved.title")}</h2><p>${tx("localOnly")}</p></div>
    ${state.saved.length ? `<form id="saved-search-form" class="task-search"><label>${tx("search")}<input type="search" name="query" value="${esc(state.savedSearch)}"></label><button>${tx("search")}</button></form>` : ""}
    <div class="saved-list">${items.map(item => `<article><div class="saved-main"><span class="plan-status">${tx(item.userProgress || "want_to_go")}</span>${item.sourceMode === "demo" ? `<span class="example-list-badge">${t("example.badge")}</span>` : ""}<h3>${esc(item.name)}</h3><p>${esc(item.planDate || t("saved.dateUnknown"))} ${esc(item.planTime)} · ${t("saved.people",{count:item.partySize})}</p>${item.note ? `<p class="personal-note">${esc(item.note)}</p>` : ""}<small>${tx("reviewTime")}: ${item.lastReviewedAt ? esc(formatTime(item.lastReviewedAt)) : tx("noReview")}</small></div><div class="saved-controls"><button data-open-saved="${esc(item.id)}">${tx("open")}</button>${item.sourceMode === "live" && item.placeId ? `<button data-recheck-saved="${esc(item.id)}">${tx("recheck")}</button>` : ""}<button class="delete-plan" data-delete-saved="${esc(item.id)}" aria-label="${t("saved.deleteAria",{name:esc(item.name)})}">×</button></div></article>`).join("")}</div>
    ${items.length ? "" : needsRecovery && !state.saved.length ? taskRecoveryHtml({tx}) : state.saved.length && state.savedSearch ? `<div class="empty-state" role="status"><h3>${tx("noSearchResults")}</h3><p>${tx("noSearchResultsBody")}</p><button class="secondary-button" data-reset-saved-search>${tx("resetSearch")}</button></div>` : `<div class="empty-state"><h3>${t("saved.emptyTitle")}</h3><p>${tx("savedEmptyBody")}</p><button class="primary-button" data-action="home">${t("saved.start")}</button></div>`}${taskListActions("saved",{tx,esc,count:state.saved.length,canUndo:state.localUndo?.domain === "saved",needsRecovery})}
  </section>`;
}
export function localRecordHtml(item, domain, { t, tx, esc, formatTime }) {
  return `<section class="content-view narrow saved-view"><button class="back-button" data-action="${domain === "saved" ? "saved" : "history"}">${tx("backToList")}</button><div class="section-heading"><h2>${esc(item.name)}</h2><p>${tx("localOnly")}</p></div>
    <section class="panel"><p>${tx("reviewTime")}: ${item.lastReviewedAt ? esc(formatTime(item.lastReviewedAt)) : tx("noReview")}</p>
    ${domain === "saved" ? `<form id="local-plan-form"><label>${tx("note")}<textarea name="note" maxlength="500" rows="4">${esc(item.note)}</textarea></label><div class="plan-fields"><label>${t("plan.date")}<input type="date" name="planDate" value="${esc(item.planDate)}"></label><label>${t("plan.time")}<input type="time" name="planTime" value="${esc(item.planTime)}"></label><label>${t("plan.party")}<input type="number" name="partySize" min="1" max="20" value="${item.partySize}"></label><label>${tx("progress")}<select name="userProgress">${["want_to_go","reserved_by_user","visited","skipped"].map(value=>`<option value="${value}" ${item.userProgress===value?"selected":""}>${tx(value)}</option>`).join("")}</select></label></div><button class="primary-button">${tx("save")}</button></form>` : `<p>${esc(item.planDate)} ${esc(item.planTime)}</p>`}</section>
    ${item.sourceMode === "live" && item.placeId ? `<button class="primary-button" data-recheck-local>${tx("recheck")}</button>` : ""}${item.sourceMode === "demo" ? `<button data-open-demo>${t("example.badge")}</button>` : ""}
  </section>`;
}
export function batchSummaryHtml(items, { tx }) {
  return batchProgress(items).map(group=>`<p class="batch-progress" role="status">${tx("batch",{done:group.completed,total:group.total,skipped:group.skipped,failed:group.failed})}</p>`).join("");
}
export function queueWorkCount(items) { return pendingWork(items).length; }

export function queueListHtml(state, { t, tx, esc, formatTime, needsRecovery = false }) {
  return `<section class="content-view narrow saved-view"><button class="back-button" data-action="home">${t("common.backHome")}</button>
    ${taskNavigationHtml("queue", { tx })}
    <div class="section-heading"><span class="step-chip">${t("queue.step")}</span><h2>${t("queue.title")}</h2><p>${t("queue.body")}</p></div>
    ${batchSummaryHtml(state.pending,{tx})}
    ${needsRecovery && !state.pending.length ? taskRecoveryHtml({tx}) : pendingWork(state.pending).length ? "" : `<div class="empty-state queue-empty"><h3>${tx("queueEmptyTitle")}</h3><p>${tx("queueEmptyBody")}</p><button class="primary-button" data-action="home">${t("saved.start")}</button></div>`}
    <details class="batch-entry"><summary>${t("queue.batchTitle")}</summary><section class="panel batch-queue-panel"><p>${t("queue.batchBody")}</p><form id="batch-queue-form"><label>${t("queue.batch")}<textarea name="restaurants" rows="6" maxlength="10000" placeholder="${esc(t("queue.placeholder"))}"></textarea></label><small>${t("queue.limit")}</small><button type="submit">${t("queue.add")}</button></form></section></details>
    <div class="saved-list queue-list">${state.pending.map(item=>`<article><div class="saved-main"><span class="plan-status">${tx(item.paused?"paused":item.status)}</span><h3>${esc(item.draft.clues.name)}</h3><p>${esc([item.draft.clues.branch,item.draft.clues.address||item.draft.clues.area].filter(Boolean).join(" · "))}</p><small>${formatTime(item.updatedAt)}</small></div><div class="saved-controls">${["completed","skipped"].includes(item.status)?"":`<button data-open-pending="${esc(item.id)}">${tx("resume")}</button><button data-skip-pending="${esc(item.id)}">${tx("skip")}</button>`}<button class="delete-plan" data-delete-pending="${esc(item.id)}" aria-label="${t("saved.deleteAria",{name:esc(item.draft.clues.name)})}">×</button></div></article>`).join("")}</div>
    ${state.pending.length ? `<p class="queue-image-boundary">${tx("imageBoundary")}</p>` : ""}${state.pending.some(item => ["completed", "skipped"].includes(item.status)) ? `<button class="text-button" data-clear-finished>${tx("clearFinished")}</button>` : ""}${taskListActions("pending",{tx,esc,count:state.pending.length,canUndo:state.localUndo?.domain === "pending",needsRecovery})}
  </section>`;
}

export function verificationSummaryHtml(result, { tx, esc, formatTime }) {
  const verification = result.verification;
  if (!verification) return "";
  return `<section class="verification-summary" aria-label="${tx("times")}"><p>${tx("resultTime")}: <time>${esc(formatTime(verification.resultGeneratedAt))}</time></p><details><summary>${tx("times")}</summary>${verification.identityConfirmedAt ? `<p>${tx("branchConfirmTime")}: ${esc(formatTime(verification.identityConfirmedAt))}</p>` : ""}<ul>${verification.sources.map(source=>`<li><strong>${esc(source.name)}</strong> · ${esc(formatTime(source.retrievedAt))}</li>`).join("")}</ul><p>${tx("timeBoundary")}</p></details></section>`;
}
