// Shared renderer state and constants.
import { t } from './i18n.js';


export const SATS = ['node', 'script', 'hash', 'merkle'];
// Why 'Senza supervisione' cannot be chosen yet (it works in a Git worktree), or '' when it can.
export const unattendedBlocked = () => (S.git && !S.git.repo ? t('E_WORKTREE_NO_REPO') : S.git && S.git.repo && !S.git.hasCommits ? t('E_WORKTREE_NO_COMMIT') : '');
export const MODES = ['manual', 'assisted', 'unattended'];
export const S = {
  selecting: null, selected: new Set(),
  queue: new Map(), files: null, filesProject: null, reasoning: new Map(), reasoningOpen: false,
  view: 'chat', info: null, status: null, settings: null, projects: [], projectId: null, sessions: [], sessionId: null, session: null,
  work: new Map(), closing: new Map(), attachments: [], collapsed: new Set(), tree: new Map(), expanded: new Set(['.']), git: null, tabs: [], active: null, panel: null, runs: new Map(), pending: [],
  sats: Object.fromEntries(SATS.map(s => [s, { st: 'idle' }])), live: new Map(), agentLog: [], worktrees: [], models: [], agent: '', commitMsg: '', draft: '', commands: [], menu: { items: [], index: 0 }, picker: { open: false, data: null, filter: '', loading: false }, notes: [], newModel: null, search: '', searching: false, renaming: null, expandedProjects: new Set(), sideHidden: (() => { try { return localStorage.getItem('bitcode.sideHidden') === '1'; } catch { return false; } })()
};
