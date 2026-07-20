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
  | { kind: "session"; meta: SessionMeta; pinned: boolean; archived: boolean }
  | { kind: "empty"; label: string };

export class SessionsTreeProvider
  implements vscode.TreeDataProvider<Node>, vscode.TreeDragAndDropController<Node>
{
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  readonly dragMimeTypes = [DND_MIME];
  readonly dropMimeTypes = [DND_MIME];

  /** Remembered per-group expand/collapse state (by group key). */
  private readonly expansion = new Map<string, boolean>();

  /** sessionId -> its tree node and the group node it lives under (rebuilt on each root load). */
  private readonly index = new Map<string, { node: Node; parent: Node }>();

  constructor(
    private readonly load: () => Promise<SessionMeta[]>,
    private readonly stores: SessionStores,
    private readonly now: () => number = () => Date.now(),
  ) {}

  refresh(): void { this._onDidChange.fire(); }

  /** Record a group's expand/collapse so a refresh keeps it, instead of resetting to the default. */
  setGroupExpanded(key: string, expanded: boolean): void {
    this.expansion.set(key, expanded);
  }

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
      const def = node.key === "pinned" || node.key === "today";
      const expanded = this.expansion.get(node.key) ?? def;
      const state = expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
      const item = new vscode.TreeItem(`${node.label} (${node.children.length})`, state);
      item.id = node.key;
      item.contextValue = "group";
      return item;
    }
    const item = new vscode.TreeItem(sessionLabel(node.meta, this.stores), vscode.TreeItemCollapsibleState.None);
    item.id = node.meta.sessionId;
    item.description = formatRelative(node.meta.mtimeMs, this.now());
    item.tooltip = `${node.meta.title}\n${node.meta.sessionId}`;
    item.contextValue = node.archived ? "archivedSession" : node.pinned ? "pinnedSession" : "unpinnedSession";
    item.iconPath = new vscode.ThemeIcon(node.archived ? "archive" : node.pinned ? "pinned" : "comment-discussion");
    item.command = { command: "claudeSessionOrganizer.sessions.open", title: "Open Session", arguments: [node.meta.sessionId] };
    return item;
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      if (node.kind === "group") {
        return node.children
          .map((meta) => this.index.get(meta.sessionId)?.node)
          .filter((n): n is Node => n !== undefined);
      }
      return [];
    }
    const sessions = await this.load();
    this.index.clear();
    if (sessions.length === 0) return [{ kind: "empty", label: "No sessions for this workspace" }];

    const pinnedSet = new Set(this.stores.pins.list());
    const archivedSet = new Set(this.stores.archive.list());
    const groups = buildGroups(
      sessions,
      pinnedSet,
      this.now(),
      (id) => this.stores.groups.get(id),
      archivedSet,
    );

    const roots: Node[] = [];
    for (const g of groups) {
      const groupNode: Node = { kind: "group", key: g.key, label: g.label, children: g.items };
      roots.push(groupNode);
      for (const meta of g.items) {
        const sessionNode: Node = {
          kind: "session",
          meta,
          pinned: pinnedSet.has(meta.sessionId),
          archived: archivedSet.has(meta.sessionId),
        };
        this.index.set(meta.sessionId, { node: sessionNode, parent: groupNode });
      }
    }
    return roots;
  }

  /** Required for TreeView.reveal to expand the ancestor chain. */
  getParent(node: Node): Node | undefined {
    return node.kind === "session" ? this.index.get(node.meta.sessionId)?.parent : undefined;
  }

  /** The tree node for a session, once the tree has been built. */
  nodeFor(sessionId: string): Node | undefined {
    return this.index.get(sessionId)?.node;
  }
}
