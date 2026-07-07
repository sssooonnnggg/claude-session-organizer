import * as vscode from "vscode";
import type { SessionMeta } from "./types";
import { buildGroups } from "./sessionsModel";
import { formatRelative } from "./relativeTime";
import { sessionLabel } from "./display";
import type { SessionStores } from "./sessionStores";
import { resolveDropAction, type DropTarget } from "./dropLogic";

const DND_MIME = "application/vnd.code.tree.claudeSessionOrganizer";

type Node =
  | { kind: "group"; key: string; label: string; children: SessionMeta[] }
  | { kind: "session"; meta: SessionMeta; pinned: boolean }
  | { kind: "empty"; label: string };

export class SessionsTreeProvider
  implements vscode.TreeDataProvider<Node>, vscode.TreeDragAndDropController<Node>
{
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  readonly dragMimeTypes = [DND_MIME];
  readonly dropMimeTypes = [DND_MIME];

  constructor(
    private readonly load: () => Promise<SessionMeta[]>,
    private readonly stores: SessionStores,
    private readonly now: () => number = () => Date.now(),
  ) {}

  refresh(): void { this._onDidChange.fire(); }

  handleDrag(source: readonly Node[], dataTransfer: vscode.DataTransfer): void {
    const ids = source
      .filter((n): n is Extract<Node, { kind: "session" }> => n.kind === "session")
      .map((n) => n.meta.sessionId);
    if (ids.length > 0) dataTransfer.set(DND_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
  }

  async handleDrop(target: Node | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const item = dataTransfer.get(DND_MIME);
    if (!item) return;
    let ids: unknown;
    try { ids = JSON.parse(await item.asString()); } catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    const dropTarget: DropTarget =
      !target ? undefined
        : target.kind === "group" ? { kind: "group", key: target.key }
          : target.kind === "session" ? { kind: "session", group: this.stores.groups.get(target.meta.sessionId) }
            : undefined;
    const action = resolveDropAction(dropTarget);
    if (action.type === "ignore") return;
    for (const id of ids) {
      if (typeof id !== "string") continue;
      if (action.type === "set") await this.stores.groups.set(id, action.group);
      else await this.stores.groups.clear(id);
    }
    this.refresh();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "empty") {
      return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    }
    if (node.kind === "group") {
      const expanded = node.key === "pinned" || node.key === "today";
      const state = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(`${node.label} (${node.children.length})`, state);
      item.contextValue = "group";
      return item;
    }
    const item = new vscode.TreeItem(sessionLabel(node.meta, this.stores), vscode.TreeItemCollapsibleState.None);
    item.description = formatRelative(node.meta.mtimeMs, this.now());
    item.tooltip = `${node.meta.title}\n${node.meta.sessionId}`;
    item.contextValue = node.pinned ? "pinnedSession" : "unpinnedSession";
    item.iconPath = new vscode.ThemeIcon(node.pinned ? "pinned" : "comment-discussion");
    item.command = { command: "claudeSessionOrganizer.sessions.open", title: "Open Session", arguments: [node.meta.sessionId] };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      if (node.kind === "group") {
        const pinnedSet = new Set(this.stores.pins.list());
        return node.children.map((meta) => ({ kind: "session", meta, pinned: pinnedSet.has(meta.sessionId) }));
      }
      return [];
    }
    const sessions = await this.load();
    if (sessions.length === 0) return [{ kind: "empty", label: "No sessions for this workspace" }];
    const groups = buildGroups(
      sessions,
      new Set(this.stores.pins.list()),
      this.now(),
      (id) => this.stores.groups.get(id),
    );
    return groups.map((g) => ({ kind: "group", key: g.key, label: g.label, children: g.items }));
  }
}
