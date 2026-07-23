import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import { encodeProjectDir } from "./pathEncoder";
import { scanSessions } from "./sessionScanner";
import { PinStore } from "./pinStore";
import { NameStore } from "./nameStore";
import { EmojiStore, ColorStore, GroupStore, ArchiveStore } from "./sessionStores";
import type { SessionStores } from "./sessionStores";
import { SessionsTreeProvider } from "./treeProvider";
import { registerCommands } from "./commands";
import { registerTabSync } from "./tabSync";

function projectsDirFor(workspacePath: string): string {
  return path.join(os.homedir(), ".claude", "projects", encodeProjectDir(workspacePath));
}

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const dir = folder ? projectsDirFor(folder.uri.fsPath) : undefined;

  const stores: SessionStores = {
    pins: new PinStore(context.globalState),
    names: new NameStore(context.globalState),
    emojis: new EmojiStore(context.globalState),
    colors: new ColorStore(context.globalState),
    groups: new GroupStore(context.globalState),
    archive: new ArchiveStore(context.globalState),
  };
  const load = () => (dir ? scanSessions(dir) : Promise.resolve([]));
  const provider = new SessionsTreeProvider(load, stores);

  const treeView = vscode.window.createTreeView("claudeSessionOrganizer.sessions", {
    treeDataProvider: provider,
    dragAndDropController: provider,
    canSelectMany: true,
  });
  treeView.onDidExpandElement((e) => { if (e.element.kind === "group") provider.setGroupExpanded(e.element.key, true); });
  treeView.onDidCollapseElement((e) => { if (e.element.kind === "group") provider.setGroupExpanded(e.element.key, false); });
  context.subscriptions.push(treeView);

  const reveal = async (sessionId: string): Promise<void> => {
    const node = provider.nodeFor(sessionId);
    if (!node) return;
    try {
      await treeView.reveal(node, { select: true, expand: true });
    } catch {
      // the view may be hidden or the node may have gone away — nothing to reveal
    }
  };

  const tabSync = registerTabSync(context, stores.pins, provider);
  registerCommands(context, stores, provider, load, tabSync.track, reveal);

  if (dir) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dir, "*.jsonl"),
    );
    watcher.onDidCreate(() => provider.refresh());
    watcher.onDidChange(() => provider.refresh());
    watcher.onDidDelete(() => provider.refresh());
    context.subscriptions.push(watcher);
  }
}

export function deactivate(): void {}
