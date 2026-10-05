import { isDeepStrictEqual } from "node:util";
import { summarizeRequestCosts } from "./cost-summary.mjs";

const MONEY_KINDS = ["quote", "receipt", "refund", "customer_support", "channel", "fixed_allocation"];
const WORK_CATEGORIES = ["initial_verification", "repeat_verification", "correction", "communication", "rework", "customer_service"];
const COMPONENTS = ["quote", "receivedGross", "refunds", "apiListPrice", "apiBilled", "labor", "customerSupport", "channel", "fixedAllocation"];
const MONEY_COMPONENT = { quote: "quote", receipt: "receivedGross", refund: "refunds", customer_support: "customerSupport", channel: "channel", fixed_allocation: "fixedAllocation" };
const id = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
const currency = value => typeof value === "string" && /^[A-Z]{3}$/.test(value);
const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const time = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value);
const inCycle = (value, cycle) => time(value) && Date.parse(cycle.startsAt) <= Date.parse(value) && Date.parse(value) < Date.parse(cycle.endsAt);
const issue = (collection, reason) => { collection[reason] = (collection[reason] || 0) + 1; };
const gap = (component, reason) => { component.complete = false; issue(component.missingReasons, reason); };
const component = () => ({ knownSubtotal: 0, knownRecords: 0, complete: true, missingReasons: {} });
function add(target, value) {
  if (!amount(value) || !Number.isFinite(target.knownSubtotal + value)) { gap(target, "invalid_or_overflow_amount"); return; }
  target.knownSubtotal += value; target.knownRecords++;
}
function unique(records, key, valid, diagnostics, label) {
  const items = new Map(), conflicts = new Set(), conflictOwners = new Set();
  for (const record of records) {
    if (!valid(record)) { issue(diagnostics.invalidRecords, label); continue; }
    if (!items.has(record[key])) items.set(record[key], record);
    else {
      diagnostics.duplicateRecords++;
      if (!isDeepStrictEqual(items.get(record[key]), record)) {
        conflicts.add(record[key]);
        if (record.cycleId) conflictOwners.add(record.cycleId);
        if (items.get(record[key]).cycleId) conflictOwners.add(items.get(record[key]).cycleId);
      }
    }
  }
  diagnostics.conflictingRecords += conflicts.size;
  return { items, conflicts, conflictOwners };
}

// An internal, bounded snapshot calculator. No storage, network, billing, entitlement or public API side effects.
export function summarizeCustomerCosts(snapshot) {
  const keys = ["cycles", "tasks", "workLogs", "laborRates", "requestRecords", "apiBills", "moneyEntries"];
  if (!snapshot || snapshot.schemaVersion !== 1 || !keys.every(key => Array.isArray(snapshot[key]))
    || keys.reduce((sum, key) => sum + snapshot[key].length, 0) > 50_000 || snapshot.cycles.length > 100) throw new Error("INVALID_CUSTOMER_COST_SNAPSHOT");
  const diagnostics = { duplicateRecords: 0, conflictingRecords: 0, invalidRecords: {}, unallocatedTasks: 0, unallocatedRequests: 0,
    unallocatedWorkLogs: 0, unallocatedMoneyEntries: 0, unallocatedApiBills: 0, allocationConflicts: 0 };
  const cycles = unique(snapshot.cycles, "cycleId", row => row && id(row.cycleId) && id(row.customerId)
    && time(row.startsAt) && time(row.endsAt) && Date.parse(row.startsAt) < Date.parse(row.endsAt)
    && Array.isArray(row.currencies) && row.currencies.length > 0 && row.currencies.length <= 10
    && row.currencies.every(currency) && new Set(row.currencies).size === row.currencies.length,
  diagnostics, "cycle");
  const tasks = unique(snapshot.tasks.map(row => row && Array.isArray(row.requestIds) ? { ...row, requestIds: [...new Set(row.requestIds)].sort() } : row),
    "taskId", row => row && id(row.taskId) && id(row.cycleId) && Array.isArray(row.requestIds) && row.requestIds.every(id), diagnostics, "task");
  const logs = unique(snapshot.workLogs, "workLogId", row => row && id(row.workLogId) && id(row.taskId) && id(row.operatorId)
    && WORK_CATEGORIES.includes(row.category) && time(row.occurredAt) && currency(row.currency)
    && (row.actualMinutes === null || amount(row.actualMinutes)) && (row.rateVersion === null || id(row.rateVersion)), diagnostics, "work_log");
  const rates = unique(snapshot.laborRates, "version", row => row && id(row.version) && id(row.rateKey) && currency(row.currency)
    && amount(row.perHour) && time(row.effectiveFrom) && time(row.effectiveUntil) && Date.parse(row.effectiveFrom) < Date.parse(row.effectiveUntil), diagnostics, "labor_rate");
  const bills = unique(snapshot.apiBills, "billId", row => row && id(row.billId) && id(row.requestId) && currency(row.currency)
    && (row.amount === null || amount(row.amount)) && time(row.billedAt), diagnostics, "api_bill");
  const money = unique(snapshot.moneyEntries, "entryId", row => row && id(row.entryId) && id(row.cycleId) && MONEY_KINDS.includes(row.kind)
    && currency(row.currency) && (row.amount === null || amount(row.amount)) && time(row.occurredAt)
    && (row.kind !== "fixed_allocation" || (id(row.methodVersion) && time(row.effectiveFrom) && time(row.effectiveUntil)
      && Date.parse(row.effectiveFrom) <= Date.parse(row.occurredAt) && Date.parse(row.occurredAt) < Date.parse(row.effectiveUntil))), diagnostics, "money_entry");
  const rateConflicts = new Set(rates.conflicts);
  const rateValues = [...rates.items.values()].sort((a, b) => a.rateKey.localeCompare(b.rateKey) || Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
  let longestRate;
  for (const rate of rateValues) {
    if (longestRate?.rateKey === rate.rateKey && Date.parse(rate.effectiveFrom) < Date.parse(longestRate.effectiveUntil)) {
      rateConflicts.add(longestRate.version); rateConflicts.add(rate.version);
    }
    if (longestRate?.rateKey !== rate.rateKey || Date.parse(rate.effectiveUntil) > Date.parse(longestRate.effectiveUntil)) longestRate = rate;
  }
  diagnostics.conflictingLaborRateVersions = rateConflicts.size;
  const requestOwners = new Map(), conflictingRequests = new Set();
  const validTasks = [...tasks.items.values()].filter(row => !tasks.conflicts.has(row.taskId) && cycles.items.has(row.cycleId) && !cycles.conflicts.has(row.cycleId));
  const validTaskIds = new Set(validTasks.map(task => task.taskId));
  diagnostics.unallocatedTasks = [...tasks.items.values()].filter(task => !validTaskIds.has(task.taskId)).length;
  for (const task of validTasks) for (const requestId of task.requestIds) {
    if (requestOwners.has(requestId) && requestOwners.get(requestId).taskId !== task.taskId) conflictingRequests.add(requestId);
    else requestOwners.set(requestId, task);
  }
  // Conflicting tasks cannot let their first occurrence assign a request to another customer.
  for (const task of snapshot.tasks) if (tasks.conflicts.has(task?.taskId)) for (const requestId of task.requestIds || []) conflictingRequests.add(requestId);
  diagnostics.allocationConflicts = conflictingRequests.size + tasks.conflicts.size;
  const requestRecords = new Map();
  for (const record of snapshot.requestRecords) {
    if (!["attempt_started", "attempt_finished", "cache_access"].includes(record?.recordType)) { issue(diagnostics.invalidRecords, "request_record"); continue; }
    if (record.recordType === "cache_access") continue; // Beneficiary receipts never become a second upstream cost.
    if (!id(record.requestId)) { issue(diagnostics.invalidRecords, "request_record"); continue; }
    const records = requestRecords.get(record.requestId) || []; records.push(record); requestRecords.set(record.requestId, records);
  }
  diagnostics.unallocatedRequests = [...requestRecords.keys()].filter(key => !requestOwners.has(key) || conflictingRequests.has(key)).length;
  const billByRequest = new Map(), conflictingBills = new Set();
  for (const bill of bills.items.values()) {
    if (bills.conflicts.has(bill.billId)) conflictingBills.add(bill.requestId);
    if (billByRequest.has(bill.requestId)) conflictingBills.add(bill.requestId);
    else billByRequest.set(bill.requestId, bill);
    if (!requestOwners.has(bill.requestId) || !requestRecords.has(bill.requestId) || conflictingRequests.has(bill.requestId)) diagnostics.unallocatedApiBills++;
  }
  const logsByTask = new Map();
  for (const log of logs.items.values()) {
    if (!validTaskIds.has(log.taskId)) diagnostics.unallocatedWorkLogs++;
    const group = logsByTask.get(log.taskId) || []; group.push(log); logsByTask.set(log.taskId, group);
  }
  for (const entry of money.items.values()) if (!cycles.items.has(entry.cycleId) || cycles.conflicts.has(entry.cycleId)) diagnostics.unallocatedMoneyEntries++;
  const customerReferences = new Map();
  const reports = [];
  for (const cycle of cycles.items.values()) {
    if (cycles.conflicts.has(cycle.cycleId)) continue;
    if (!customerReferences.has(cycle.customerId)) customerReferences.set(cycle.customerId, `customer-${customerReferences.size + 1}`);
    const byCurrency = Object.fromEntries(cycle.currencies.map(key => [key, Object.fromEntries(COMPONENTS.map(name => [name, component()]))]));
    const cycleGaps = {};
    const markAll = (names, reason) => { issue(cycleGaps, reason); for (const values of Object.values(byCurrency)) for (const name of names) gap(values[name], reason); };
    const addCost = (code, name, value) => {
      if (!Object.hasOwn(byCurrency, code)) { markAll([name], "undeclared_currency"); return; }
      add(byCurrency[code][name], value);
    };
    const markCurrency = (code, name, reason) => {
      if (!Object.hasOwn(byCurrency, code)) markAll([name], "undeclared_currency");
      else gap(byCurrency[code][name], reason);
    };
    for (const [key, names] of [["tasks", COMPONENTS], ["apiRequests", ["apiListPrice", "apiBilled"]], ["apiBills", ["apiBilled"]],
      ["workLogs", ["labor", "customerSupport"]], ["moneyEntries", ["quote", "receivedGross", "refunds", "customerSupport", "channel", "fixedAllocation"]]]) {
      if (cycle.coverage?.[key] !== "complete") markAll(names, `coverage_unknown_${key}`);
    }
    if (tasks.conflictOwners.has(cycle.cycleId)) markAll(["apiListPrice", "apiBilled", "labor", "customerSupport"], "conflicting_task_allocation");
    if (Object.keys(diagnostics.invalidRecords).length) markAll(COMPONENTS, "invalid_snapshot_records");
    if (diagnostics.conflictingRecords) markAll(COMPONENTS, "conflicting_snapshot_records");
    if (diagnostics.unallocatedTasks + diagnostics.unallocatedRequests + diagnostics.unallocatedWorkLogs + diagnostics.unallocatedMoneyEntries + diagnostics.unallocatedApiBills)
      markAll(["apiListPrice", "apiBilled", "labor", "customerSupport", "channel", "fixedAllocation", "receivedGross", "refunds"], "unallocated_snapshot_records");
    const cycleTasks = validTasks.filter(task => task.cycleId === cycle.cycleId);
    const allocatedIds = new Set(cycleTasks.flatMap(task => task.requestIds));
    let knownMinutes = 0, unknownMinuteLogs = 0, explicitZeroMinuteLogs = 0, laborLogCount = 0, requestCount = 0;
    for (const requestId of allocatedIds) {
      if (conflictingRequests.has(requestId)) { markAll(["apiListPrice", "apiBilled"], "conflicting_request_allocation"); continue; }
      requestCount++;
      const records = requestRecords.get(requestId) || [];
      const summary = summarizeRequestCosts(records);
      diagnostics.duplicateRecords += summary.duplicateRecords;
      if (!summary.completeEstimateForObservedAttempts) markAll(["apiListPrice"], records.length ? "unknown_api_list_price" : "missing_api_request");
      const dated = records.filter(row => row.recordType === "attempt_started");
      if (!dated.length || dated.some(row => !inCycle(row.occurredAt, cycle))) markAll(["apiListPrice", "apiBilled"], "request_outside_cycle_or_time_unknown");
      for (const [code, values] of Object.entries(summary.currencies)) addCost(code, "apiListPrice", values.knownListPriceSubtotal);
      const bill = billByRequest.get(requestId);
      if (!bill || conflictingBills.has(requestId)) markAll(["apiBilled"], bill ? "conflicting_api_bill" : "missing_api_bill");
      else if (bill.amount === null) markCurrency(bill.currency, "apiBilled", "unknown_api_bill_amount");
      else addCost(bill.currency, "apiBilled", bill.amount);
    }
    for (const task of cycleTasks) {
      const taskLogs = logsByTask.get(task.taskId) || [];
      if (!taskLogs.length) { unknownMinuteLogs++; markAll(["labor"], "missing_work_log"); }
      for (const log of taskLogs) {
        laborLogCount++;
        const name = log.category === "customer_service" ? "customerSupport" : "labor";
        if (logs.conflicts.has(log.workLogId)) { unknownMinuteLogs++; markCurrency(log.currency, name, "conflicting_work_log"); continue; }
        if (!inCycle(log.occurredAt, cycle)) { unknownMinuteLogs++; markCurrency(log.currency, name, "work_log_outside_cycle"); continue; }
        if (log.actualMinutes === null) { unknownMinuteLogs++; markCurrency(log.currency, name, "actual_minutes_unknown"); continue; }
        if (!Number.isFinite(knownMinutes + log.actualMinutes)) { unknownMinuteLogs++; markCurrency(log.currency, name, "minutes_overflow"); continue; }
        knownMinutes += log.actualMinutes; if (log.actualMinutes === 0) explicitZeroMinuteLogs++;
        const rate = rates.items.get(log.rateVersion);
        if (!rate || rateConflicts.has(log.rateVersion) || rate.currency !== log.currency
          || !(Date.parse(rate.effectiveFrom) <= Date.parse(log.occurredAt) && Date.parse(log.occurredAt) < Date.parse(rate.effectiveUntil))) {
          markCurrency(log.currency, name, "labor_rate_unknown_invalid_or_expired"); continue;
        }
        addCost(log.currency, name, log.actualMinutes / 60 * rate.perHour);
      }
    }
    const seenMoney = new Set();
    for (const entry of money.items.values()) {
      if (entry.cycleId !== cycle.cycleId) continue;
      const name = MONEY_COMPONENT[entry.kind]; seenMoney.add(`${entry.currency}:${entry.kind}`);
      if (money.conflicts.has(entry.entryId)) { markCurrency(entry.currency, name, "conflicting_money_entry"); continue; }
      if (entry.amount === null) { markCurrency(entry.currency, name, "unknown_money_amount"); continue; }
      addCost(entry.currency, name, entry.amount);
    }
    for (const code of cycle.currencies) for (const kind of MONEY_KINDS) if (!seenMoney.has(`${code}:${kind}`)) gap(byCurrency[code][MONEY_COMPONENT[kind]], `missing_${kind}_entry`);
    const required = ["receivedGross", "refunds", "apiListPrice", "apiBilled", "labor", "customerSupport", "channel", "fixedAllocation"];
    const missingCycleComponents = Object.entries(byCurrency).flatMap(([code, values]) => required.filter(name => !values[name].complete).map(name => `${code}:${name}`));
    for (const values of Object.values(byCurrency)) {
      values.receivedNet = derived(values, ["receivedGross", "refunds"], [1, -1]);
      values.contribution = {
        listPriceEstimateBeforeAcquisition: contribution(values, "apiListPrice", false, missingCycleComponents),
        listPriceEstimateAfterAcquisition: contribution(values, "apiListPrice", true, missingCycleComponents),
        billedBeforeAcquisition: contribution(values, "apiBilled", false, missingCycleComponents),
        billedAfterAcquisition: contribution(values, "apiBilled", true, missingCycleComponents)
      };
    }
    reports.push({ cycleReference: `cycle-${reports.length + 1}`, customerReference: customerReferences.get(cycle.customerId),
      startsAt: cycle.startsAt, endsAt: cycle.endsAt, taskCount: cycleTasks.length, allocatedRequestCount: requestCount,
      work: { logCount: laborLogCount, knownActualMinutesSubtotal: knownMinutes, explicitZeroMinuteLogs, unknownMinuteLogs,
        // Minute completeness depends on work coverage/allocation, not whether its price is known.
        completeActualMinutes: unknownMinuteLogs === 0 && cycle.coverage?.workLogs === "complete" && cycle.coverage?.tasks === "complete"
          && diagnostics.unallocatedTasks === 0 && diagnostics.unallocatedWorkLogs === 0 && tasks.conflicts.size === 0 && logs.conflicts.size === 0
          && !["cycle", "task", "work_log"].some(kind => diagnostics.invalidRecords[kind]) },
      currencies: byCurrency, completeCostForDeclaredCycle: missingCycleComponents.length === 0, scopeGaps: cycleGaps });
  }
  const hasDiagnostics = diagnostics.conflictingRecords + diagnostics.allocationConflicts + diagnostics.unallocatedTasks + diagnostics.unallocatedRequests + diagnostics.unallocatedWorkLogs
    + diagnostics.unallocatedMoneyEntries + diagnostics.unallocatedApiBills + Object.values(diagnostics.invalidRecords).reduce((a, b) => a + b, 0) > 0;
  return { schemaVersion: 1, scope: "internal_customer_cycle_snapshot_only", billingLedger: false, realEntitlementsChanged: false,
    completeOperationalCoverage: false, realWorldEvidence: false, releaseGateEvidence: false, reports, diagnostics,
    completeCostForDeclaredSnapshot: reports.length > 0 && !hasDiagnostics && reports.every(report => Object.values(report.currencies)
      .every(values => values.contribution.billedAfterAcquisition.complete && values.apiListPrice.complete)),
    limitations: ["All completeness assertions describe only the supplied bounded snapshot; no account-wide billing or business coverage is verified.",
      "List-price and observed supplier-billed contributions are separate. Free tiers and exchange rates are not inferred; currencies cannot be added.",
      "Contribution subtracts assigned API, labor, support, fixed allocation and (after acquisition) channel costs. It is not company-wide profit.",
      "Missing receipts, actual minutes, valid rates, bills, required cost entries or allocation evidence leave complete amounts null.",
      "Repeated records are deduplicated; conflicting allocations are withheld. Known subtotals are not complete costs or margins.",
      "This tool cannot establish paid renewal, customer delivery, acceptance, G1/GB or release evidence."] };
}

function derived(values, names, signs) {
  const missing = names.filter(name => !values[name].complete);
  const subtotal = names.reduce((sum, name, index) => sum + signs[index] * values[name].knownSubtotal, 0);
  if (!Number.isFinite(subtotal)) missing.push("amount_overflow");
  return { knownSubtotal: Number.isFinite(subtotal) ? subtotal : null, complete: missing.length === 0,
    completeAmount: missing.length ? null : subtotal, missingComponents: missing };
}
function contribution(values, api, acquisition, missingCycleComponents) {
  // Both API price and billing completeness are required before claiming a complete contribution.
  const names = ["receivedNet", api, "labor", "customerSupport", "fixedAllocation", ...(acquisition ? ["channel"] : [])];
  const result = derived(values, names, names.map((_, index) => index === 0 ? 1 : -1));
  for (const name of ["apiListPrice", "apiBilled", "channel"]) if (!values[name].complete && !result.missingComponents.includes(name)) result.missingComponents.push(name);
  result.complete = result.missingComponents.length === 0 && missingCycleComponents.length === 0;
  result.completeAmount = result.complete ? result.knownSubtotal : null;
  return { ...result, missingCycleComponents: [...missingCycleComponents], knownSubtotalIsNotMargin: !result.complete };
}
