import * as network from "./chatgpt-api.js";
import { conversationMatchesProjectSelection } from "./project-selection.js";
import { timestampMs } from "./resume-state.js";

export function selectConversations(inventory, options) {
  return [...inventory.values()].filter(item => conversationMatchesProjectSelection(item, options.selectedProjectIds)).filter(item => {
    const time = timestampMs(item.create_time);
    return (!options.dateFrom || time >= Date.parse(options.dateFrom)) && (!options.dateTo || time <= Date.parse(options.dateTo + "T23:59:59.999Z"));
  });
}
export async function conversationInventory(api, token, projects, projectByConversation, projectRows, issue, report = {}, status = () => {}) {
  const inventory = new Map();
      report.inventory = {
        complete: false, active: 0, archived: 0, projects: projects.length,
        deletionInference: "disabled", scopes: {},
      };
      const inventoryList = async (isArchived) => {
        const scopeName = isArchived ? "archived" : "active";
        const scope = { complete: false, discovered: 0, pageCount: 0, missingTotalPages: 0,
          firstTotal: null, lastTotal: null, totalChanges: 0, terminal: null,
          warnings: [], diagnostics: [], omittedDiagnostics: 0 };
        report.inventory.scopes[scopeName] = scope;
        const seen = new Set();
        let offset = 0;
        for (let page = 0; ; page++) {
          if (page >= 10000) { scope.terminal = "page-limit"; throw new Error(`${scopeName} conversation inventory pagination limit`); }
          const diagnostic = { page: page + 1, requestedOffset: offset, received: false,
            returnedOffset: null, itemCount: null, total: null, hasMore: null };
          scope.pageCount++;
          scope.diagnostics.push(diagnostic);
          if (scope.diagnostics.length > 20) { scope.diagnostics.shift(); scope.omittedDiagnostics++; }
          status(`Reading ${scopeName} conversations: page ${page + 1}; ${scope.discovered} found so far…`);
          let data;
          try {
            data = await api.apiGet(`conversations?offset=${offset}&limit=${network.PAGE_SIZE}&order=updated&is_archived=${isArchived}`, token);
            // Numeric/boolean page metadata only: diagnostics must not capture
            // titles, conversation IDs, credentials or raw provider responses.
            diagnostic.received = true;
            diagnostic.returnedOffset = Number.isSafeInteger(data?.offset) ? data.offset : null;
            diagnostic.itemCount = Array.isArray(data?.items) ? data.items.length : null;
            diagnostic.total = Number.isSafeInteger(data?.total) ? data.total : null;
            diagnostic.hasMore = typeof data?.has_more === "boolean" ? data.has_more : null;
            api.validateConversationInventory(data);
            if (data.offset !== undefined && data.offset !== offset) throw new Error("Unexpected inventory offset");
            if (!data.items.length && data.has_more === true) throw new Error("Empty inventory page advertises more items");
            for (const row of data.items) {
              if (seen.has(row.id) || inventory.has(row.id)) throw new Error("Repeated conversation inventory ID");
            }
          } catch (error) {
            scope.terminal = error instanceof network.RateLimitStopError ? "rate-limited" : "invalid-or-failed-page";
            if (error instanceof network.RateLimitStopError) throw error;
            throw new Error(`${scopeName} inventory page ${page + 1} at offset ${offset}: ${api.redactSecrets(error.message)}`);
          }
          if (data.total !== undefined) {
            if (scope.firstTotal === null) scope.firstTotal = data.total;
            if (scope.lastTotal !== null && scope.lastTotal !== data.total) scope.totalChanges++;
            scope.lastTotal = data.total;
          } else scope.missingTotalPages++;
          for (const row of data.items) {
            seen.add(row.id);
            inventory.set(row.id, { ...row, isArchived, projectId: projectByConversation.get(row.id)?.gizmoId });
          }
          offset += data.items.length;
          scope.discovered = seen.size;
          // Totals are advisory. A stale count must not truncate enumeration,
          // and an omitted optional count is not evidence that the count changed.
          if (data.has_more === false) { scope.terminal = "has-more-false"; break; }
          if (!data.items.length) { scope.terminal = "empty-page"; break; }
        }
        scope.totalDrift = scope.totalChanges > 0;
        // A changing advisory count is diagnostic only when the final count agrees.
        if (scope.totalChanges && (scope.lastTotal === null || scope.discovered !== scope.lastTotal)) scope.warnings.push("total-drift");
        if (scope.lastTotal !== null && scope.discovered !== scope.lastTotal) scope.warnings.push("total-count-mismatch");
        scope.complete = scope.warnings.length === 0;
        if (!scope.complete) issue("inventory-consistency", scopeName,
          `${scopeName} inventory is inconsistent: ${scope.warnings.join(", ")} (first total=${scope.firstTotal}, last total=${scope.lastTotal}, discovered=${scope.discovered}). Only discovered conversations enter the export queue; inventory coverage may be incomplete.`);
      };
      await inventoryList(false); await inventoryList(true);
      for (const row of projectRows) if (!inventory.has(row.id)) inventory.set(row.id, row);
      report.inventory.complete = Object.values(report.inventory.scopes).every(scope => scope.complete);
      report.inventory.active = [...inventory.values()].filter(c => !c.isArchived).length;
      report.inventory.archived = [...inventory.values()].filter(c => c.isArchived).length;
      report.archived = report.inventory.archived;
  return { inventory, details: report.inventory };
}
